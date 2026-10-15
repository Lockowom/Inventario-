-- C2.0 follow-up: serialized stock reconciles identities, never only totals.
create or replace function public.finish_my_serial_sweep(p_subtask_id uuid)
returns jsonb
language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  actor uuid:=app_private.require_active_actor();
  s public.recount_mission_subtasks;
  m public.recount_missions;
  r public.reconciliation_cases;
  scan_count integer;
  missing_count integer:=0;
  unexpected_count integer:=0;
begin
  select s.* into s from public.recount_mission_subtasks s where s.id=p_subtask_id for update;
  select * into m from public.recount_missions where id=s.mission_id;
  select * into r from public.reconciliation_cases where id=m.case_id;
  if m.id is null or m.status<>'ACTIVE' or m.assigned_user_id<>actor or s.strategy<>'SERIAL_SWEEP' then raise exception 'Active serial sweep is not assigned to actor' using errcode='42501'; end if;
  select count(*)::integer into scan_count from public.recount_subtask_serial_scans where subtask_id=s.id;
  if scan_count=0 then raise exception 'Serial sweep requires at least one scan; use zero confirmation when nothing was found' using errcode='23514'; end if;
  select count(*)::integer into missing_count from (
    select distinct upper(btrim(c.serie)) as serie
    from public.count_records c
    where c.inventory_id=m.inventory_id and c.codigo=r.codigo and c.ubicacion=s.location and nullif(btrim(c.serie),'') is not null
    except select serie from public.recount_subtask_serial_scans where subtask_id=s.id
  ) missing;
  select count(*)::integer into unexpected_count from (
    select serie from public.recount_subtask_serial_scans where subtask_id=s.id
    except
    select distinct upper(btrim(c.serie)) as serie
    from public.count_records c
    where c.inventory_id=m.inventory_id and c.codigo=r.codigo and c.ubicacion=s.location and nullif(btrim(c.serie),'') is not null
  ) unexpected;
  update public.recount_mission_subtasks
  set status='COUNTED',counted_quantity=scan_count,completed_at=now(),completed_by=actor,
      result_metadata=result_metadata || jsonb_build_object('identity_match',missing_count=0 and unexpected_count=0,'missing_series_count',missing_count,'unexpected_series_count',unexpected_count)
  where id=s.id;
  return app_private.recount_mission_json(m.id);
end
$function$;

create or replace function app_private.complete_recount_mission_internal(p_mission_id uuid,p_actor uuid,p_zero_confirmed boolean)
returns jsonb
language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  mission public.recount_missions; r public.reconciliation_cases;
  total integer:=0; completed_count integer:=0; review_required boolean:=false; identity_mismatch boolean:=false;
  c2_total integer; legacy_observation_count integer:=0; legacy_total integer:=0;
begin
  select * into mission from public.recount_missions where id=p_mission_id for update;
  if mission.id is null or mission.status<>'ACTIVE' or mission.assigned_user_id<>p_actor then raise exception 'Active recount mission is not assigned to actor' using errcode='42501'; end if;
  select * into r from public.reconciliation_cases where id=mission.case_id for update;
  perform app_private.ensure_recount_mission_subtasks(mission.id);
  select count(*)::integer,coalesce(sum(c.cantidad_contada),0)::integer into legacy_observation_count,legacy_total
  from public.recount_mission_observations o join public.count_records c on c.id=o.count_record_id where o.mission_id=mission.id;
  if legacy_observation_count > 0 then
    completed_count:=legacy_observation_count; total:=legacy_total;
  else
    if p_zero_confirmed then
      update public.recount_mission_subtasks set status='ZERO_CONFIRMED',counted_quantity=0,started_at=coalesce(started_at,now()),completed_at=now(),completed_by=p_actor
      where mission_id=mission.id and status in('PENDING','ACTIVE');
    end if;
    if exists(select 1 from public.recount_mission_subtasks where mission_id=mission.id and status in('PENDING','ACTIVE')) then raise exception 'Every location subtask must be resolved before finalizing' using errcode='23514'; end if;
    select count(*)::integer,
      coalesce(sum(case when status='COUNTED' then counted_quantity else 0 end),0)::integer,
      bool_or(status in('INACCESSIBLE','ESCALATED')),
      coalesce(bool_or(strategy='SERIAL_SWEEP' and coalesce((result_metadata->>'identity_match')::boolean,false)=false),false)
    into completed_count,total,review_required,identity_mismatch
    from public.recount_mission_subtasks where mission_id=mission.id;
  end if;
  if p_zero_confirmed and total<>0 then raise exception 'Zero confirmation conflicts with completed subtask quantities' using errcode='23514'; end if;
  update public.recount_missions set status='COMPLETED',total_quantity=total,completed_at=now() where id=mission.id;
  if review_required then
    update public.reconciliation_cases set status='PENDIENTE_ANALISIS',confirmed_physical_quantity=null where id=r.id;
  elsif mission.round=2 and (total<>r.physical_quantity or identity_mismatch) then
    update public.reconciliation_cases set status='REQUIERE_3ER_CONTEO',confirmed_physical_quantity=null where id=r.id;
    insert into public.recount_missions(case_id,inventory_id,round,created_by) values(r.id,r.inventory_id,3,p_actor) on conflict(case_id,round) do nothing;
  elsif mission.round=3 and identity_mismatch then
    update public.reconciliation_cases set status='PENDIENTE_ANALISIS',confirmed_physical_quantity=null where id=r.id;
  elsif mission.round=3 then
    select total_quantity into c2_total from public.recount_missions where case_id=r.id and round=2 and status='COMPLETED';
    if total=r.physical_quantity then update public.reconciliation_cases set status='FISICO_CONFIRMADO',confirmed_physical_quantity=r.physical_quantity where id=r.id;
    elsif total=c2_total then update public.reconciliation_cases set status='FISICO_CONFIRMADO',confirmed_physical_quantity=c2_total where id=r.id;
    else update public.reconciliation_cases set status='PENDIENTE_ANALISIS',confirmed_physical_quantity=null where id=r.id; end if;
  else
    update public.reconciliation_cases set status='FISICO_CONFIRMADO',confirmed_physical_quantity=total where id=r.id;
  end if;
  perform app_private.append_reconciliation_event(r.id,r.inventory_id,case when mission.round=2 then 'SECOND_RECORDED' else 'THIRD_RECORDED' end,p_actor,jsonb_build_object('mission_id',mission.id,'round',mission.round,'subtask_count',completed_count,'total_quantity',total,'identity_mismatch',identity_mismatch,'review_required',review_required));
  return jsonb_build_object('mission_id',mission.id,'round',mission.round,'total_quantity',total,'subtask_count',completed_count,'observation_count',completed_count,'case_id',r.id,'case_status',(select status::text from public.reconciliation_cases where id=r.id),'confirmed_physical_quantity',(select confirmed_physical_quantity from public.reconciliation_cases where id=r.id),'next_round',case when mission.round=2 and not review_required and (total<>r.physical_quantity or identity_mismatch) then 3 else null end,'review_required',review_required or identity_mismatch);
end
$function$;

revoke all on function public.finish_my_serial_sweep(uuid), app_private.complete_recount_mission_internal(uuid,uuid,boolean) from public,anon;
grant execute on function public.finish_my_serial_sweep(uuid) to authenticated;
