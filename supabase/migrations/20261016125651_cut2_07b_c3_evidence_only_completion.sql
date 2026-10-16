-- CUT2-07B: C3 is evidence for a later analyst decision.  It must never
-- select a C1/C2/C3 "winner" nor confirm a physical quantity by itself.
create or replace function app_private.complete_recount_mission_internal(
  p_mission_id uuid,
  p_actor uuid,
  p_zero_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  mission public.recount_missions;
  r public.reconciliation_cases;
  total integer:=0;
  completed_count integer:=0;
  review_required boolean:=false;
  identity_mismatch boolean:=false;
  legacy_observation_count integer:=0;
  legacy_total integer:=0;
begin
  select * into mission from public.recount_missions where id=p_mission_id for update;
  if mission.id is null or mission.status<>'ACTIVE' or mission.assigned_user_id<>p_actor then
    raise exception 'Active recount mission is not assigned to actor' using errcode='42501';
  end if;

  select * into r from public.reconciliation_cases where id=mission.case_id for update;
  perform app_private.ensure_recount_mission_subtasks(mission.id);

  select count(*)::integer,coalesce(sum(c.cantidad_contada),0)::integer
    into legacy_observation_count,legacy_total
  from public.recount_mission_observations o
  join public.count_records c on c.id=o.count_record_id
  where o.mission_id=mission.id;

  if legacy_observation_count>0 then
    completed_count:=legacy_observation_count;
    total:=legacy_total;
  else
    if p_zero_confirmed then
      update public.recount_mission_subtasks
      set status='ZERO_CONFIRMED',counted_quantity=0,started_at=coalesce(started_at,now()),completed_at=now(),completed_by=p_actor
      where mission_id=mission.id and status in('PENDING','ACTIVE');
    end if;
    if exists(select 1 from public.recount_mission_subtasks where mission_id=mission.id and status in('PENDING','ACTIVE')) then
      raise exception 'Every location subtask must be resolved before finalizing' using errcode='23514';
    end if;
    select count(*)::integer,
      coalesce(sum(case when status='COUNTED' then counted_quantity else 0 end),0)::integer,
      bool_or(status in('INACCESSIBLE','ESCALATED')),
      coalesce(bool_or(strategy='SERIAL_SWEEP' and coalesce((result_metadata->>'identity_match')::boolean,false)=false),false)
      into completed_count,total,review_required,identity_mismatch
    from public.recount_mission_subtasks where mission_id=mission.id;
  end if;

  if p_zero_confirmed and total<>0 then
    raise exception 'Zero confirmation conflicts with completed subtask quantities' using errcode='23514';
  end if;

  update public.recount_missions
  set status='COMPLETED',total_quantity=total,completed_at=now()
  where id=mission.id;

  if mission.round=2 then
    if review_required then
      update public.reconciliation_cases set status='PENDIENTE_ANALISIS',confirmed_physical_quantity=null where id=r.id;
    elsif total<>r.physical_quantity or identity_mismatch then
      update public.reconciliation_cases set status='REQUIERE_3ER_CONTEO',confirmed_physical_quantity=null where id=r.id;
      insert into public.recount_missions(case_id,inventory_id,round,created_by)
      values(r.id,r.inventory_id,3,p_actor)
      on conflict(case_id,round) do nothing;
    else
      update public.reconciliation_cases set status='FISICO_CONFIRMADO',confirmed_physical_quantity=total where id=r.id;
    end if;
    perform app_private.append_reconciliation_event(
      r.id,r.inventory_id,'SECOND_RECORDED',p_actor,
      jsonb_build_object('mission_id',mission.id,'round',mission.round,'subtask_count',completed_count,
        'total_quantity',total,'identity_mismatch',identity_mismatch,'review_required',review_required)
    );
  end if;

  -- The C3 AFTER trigger persists the result and changes the case to
  -- PENDIENTE_ANALISIS.  Do not overwrite that state here.
  return jsonb_build_object(
    'mission_id',mission.id,'round',mission.round,'total_quantity',total,
    'subtask_count',completed_count,'observation_count',completed_count,'case_id',r.id,
    'case_status',(select status::text from public.reconciliation_cases where id=r.id),
    'confirmed_physical_quantity',(select confirmed_physical_quantity from public.reconciliation_cases where id=r.id),
    'next_round',case when mission.round=2 and not review_required and (total<>r.physical_quantity or identity_mismatch) then 3 else null end,
    'review_required',case when mission.round=3 then true else review_required or identity_mismatch end
  );
end
$function$;

revoke all on function app_private.complete_recount_mission_internal(uuid,uuid,boolean) from public,anon,authenticated;

-- Identity conflict is evidence too; it is neither a quantity vote nor a
-- stock adjustment.
create or replace function app_private.finalize_c3_decision_evidence()
returns trigger language plpgsql security definer
set search_path=public,app_private,pg_temp as $function$
declare v_case public.reconciliation_cases; v_result text;
begin
  if new.round<>3 or new.status<>'COMPLETED' or old.status='COMPLETED' then return new; end if;
  select * into v_case from public.reconciliation_cases where id=new.case_id for update;
  if exists(select 1 from public.recount_mission_subtasks where mission_id=new.id and status='INACCESSIBLE') then
    v_result:='C3_INACCESSIBLE';
  elsif exists(select 1 from public.recount_mission_subtasks where mission_id=new.id and status='ESCALATED') then
    v_result:='C3_HELD';
  elsif exists(select 1 from public.recount_mission_subtasks where mission_id=new.id and strategy='SERIAL_SWEEP' and coalesce((result_metadata->>'identity_match')::boolean,false)=false) then
    v_result:='C3_IDENTITY_CONFLICT';
  elsif new.total_quantity=v_case.system_quantity then
    v_result:='C3_CONFIRMS_MATCH';
  else
    v_result:='C3_CONFIRMS_DIFFERENCE';
  end if;
  update public.recount_missions set c3_result=v_result,c3_decision_ready_at=now() where id=new.id;
  update public.reconciliation_cases set status='PENDIENTE_ANALISIS',confirmed_physical_quantity=null where id=v_case.id;
  perform app_private.append_reconciliation_event(v_case.id,new.inventory_id,'THIRD_RECORDED',new.assigned_user_id,
    jsonb_build_object('mission_id',new.id,'source_c2_mission_id',new.source_c2_mission_id,'c3_result',v_result,'erp_adjusted',false));
  return new;
end $function$;
revoke all on function app_private.finalize_c3_decision_evidence() from public,anon,authenticated;
