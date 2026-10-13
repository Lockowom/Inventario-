-- CUT2-03A: preserve C2.0 behavior while removing PL/pgSQL record-variable
-- ambiguity reported by plpgsql_check.
create or replace function public.record_my_recount_subtask(
  p_subtask_id uuid,p_location text,p_quantity integer default null,p_serial text default null,p_batch text default null,p_logistic_unit text default null
)
returns jsonb
language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  v_actor uuid:=app_private.require_active_actor();
  v_subtask public.recount_mission_subtasks;
  v_mission public.recount_missions;
  v_case public.reconciliation_cases;
  v_normalized_serial text:=nullif(upper(btrim(p_serial)), '');
begin
  select rst.* into v_subtask from public.recount_mission_subtasks as rst where rst.id=p_subtask_id for update;
  select rm.* into v_mission from public.recount_missions as rm where rm.id=v_subtask.mission_id;
  select rc.* into v_case from public.reconciliation_cases as rc where rc.id=v_mission.case_id;
  if v_mission.id is null or v_mission.status<>'ACTIVE' or v_mission.assigned_user_id<>v_actor then raise exception 'Active recount mission is not assigned to actor' using errcode='42501'; end if;
  if upper(btrim(p_location))<>v_subtask.location then raise exception 'Scanned location does not match the active subtask' using errcode='23514'; end if;
  if v_subtask.status not in('PENDING','ACTIVE') then raise exception 'Subtask is already completed' using errcode='23514'; end if;
  if v_subtask.strategy='SERIAL_SWEEP' then
    if v_normalized_serial is null or length(v_normalized_serial)>19 then raise exception 'A valid serial is required for sweep' using errcode='23514'; end if;
    insert into public.recount_subtask_serial_scans(subtask_id,serie,scanned_by) values(v_subtask.id,v_normalized_serial,v_actor);
    update public.recount_mission_subtasks set status='ACTIVE',started_at=coalesce(started_at,now()),logistic_unit=coalesce(nullif(btrim(p_logistic_unit),''),logistic_unit) where id=v_subtask.id;
  else
    if v_subtask.strategy='TARGETED_SERIAL_SEARCH' and v_normalized_serial is distinct from v_case.reference_value then raise exception 'Serial does not match the directed search' using errcode='23514'; end if;
    if v_subtask.strategy='BATCH_LOCATION_RECOUNT' and nullif(upper(btrim(p_batch)),'') is distinct from v_case.reference_value then raise exception 'Batch does not match the mission' using errcode='23514'; end if;
    if coalesce(p_quantity,0)<=0 then raise exception 'Positive quantity is required' using errcode='23514'; end if;
    update public.recount_mission_subtasks set status='COUNTED',counted_quantity=case when v_subtask.strategy='TARGETED_SERIAL_SEARCH' then 1 else p_quantity end,started_at=coalesce(started_at,now()),completed_at=now(),completed_by=v_actor,logistic_unit=coalesce(nullif(btrim(p_logistic_unit),''),logistic_unit) where id=v_subtask.id;
  end if;
  perform app_private.append_reconciliation_event(v_mission.case_id,v_mission.inventory_id,'C2_SUBTASK_RECORDED',v_actor,jsonb_build_object('mission_id',v_mission.id,'subtask_id',v_subtask.id,'location',v_subtask.location,'strategy',v_subtask.strategy));
  return app_private.recount_mission_json(v_mission.id);
end
$function$;

create or replace function public.finish_my_serial_sweep(p_subtask_id uuid)
returns jsonb
language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  v_actor uuid:=app_private.require_active_actor();
  v_subtask public.recount_mission_subtasks;
  v_mission public.recount_missions;
  v_case public.reconciliation_cases;
  v_scan_count integer;
  v_missing_count integer:=0;
  v_unexpected_count integer:=0;
begin
  select rst.* into v_subtask from public.recount_mission_subtasks as rst where rst.id=p_subtask_id for update;
  select rm.* into v_mission from public.recount_missions as rm where rm.id=v_subtask.mission_id;
  select rc.* into v_case from public.reconciliation_cases as rc where rc.id=v_mission.case_id;
  if v_mission.id is null or v_mission.status<>'ACTIVE' or v_mission.assigned_user_id<>v_actor or v_subtask.strategy<>'SERIAL_SWEEP' then raise exception 'Active serial sweep is not assigned to actor' using errcode='42501'; end if;
  select count(*)::integer into v_scan_count from public.recount_subtask_serial_scans as rss where rss.subtask_id=v_subtask.id;
  if v_scan_count=0 then raise exception 'Serial sweep requires at least one scan; use zero confirmation when nothing was found' using errcode='23514'; end if;
  select count(*)::integer into v_missing_count from (
    select distinct upper(btrim(cr.serie)) as serie from public.count_records as cr
    where cr.inventory_id=v_mission.inventory_id and cr.codigo=v_case.codigo and cr.ubicacion=v_subtask.location and nullif(btrim(cr.serie),'') is not null
    except select rss.serie from public.recount_subtask_serial_scans as rss where rss.subtask_id=v_subtask.id
  ) as missing;
  select count(*)::integer into v_unexpected_count from (
    select rss.serie from public.recount_subtask_serial_scans as rss where rss.subtask_id=v_subtask.id
    except select distinct upper(btrim(cr.serie)) as serie from public.count_records as cr
    where cr.inventory_id=v_mission.inventory_id and cr.codigo=v_case.codigo and cr.ubicacion=v_subtask.location and nullif(btrim(cr.serie),'') is not null
  ) as unexpected;
  update public.recount_mission_subtasks
  set status='COUNTED',counted_quantity=v_scan_count,completed_at=now(),completed_by=v_actor,
      result_metadata=result_metadata || jsonb_build_object('identity_match',v_missing_count=0 and v_unexpected_count=0,'missing_series_count',v_missing_count,'unexpected_series_count',v_unexpected_count)
  where id=v_subtask.id;
  return app_private.recount_mission_json(v_mission.id);
end
$function$;
