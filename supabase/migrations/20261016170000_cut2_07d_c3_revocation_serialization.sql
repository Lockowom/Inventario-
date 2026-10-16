-- CUT2-07D: C3 mutations must serialize with capability and assignment
-- revocation.  A previously claimed mission is not a perpetual permission.
-- These helpers lock the authorization rows before checking the effective
-- capability, so a revocation either commits first (and the mutation is
-- denied) or waits for an already-authorized mutation to finish.

create or replace function app_private.lock_actor_authorization_context(
  p_actor uuid,
  p_inventory_id uuid
)
returns void
language plpgsql
security definer
set search_path=public,app_private,pg_temp
as $function$
declare v_profile public.profiles;
begin
  select * into v_profile
  from public.profiles
  where user_id=p_actor
  for update;

  if v_profile.user_id is null or not v_profile.active then
    raise exception 'ACTOR_INACTIVE' using errcode='42501';
  end if;

  -- Lock all rows that can narrow the actor's effective permission.  The
  -- capability check follows these locks in the calling transaction.
  perform 1 from public.inventory_assignments
  where user_id=p_actor and inventory_id=p_inventory_id
  for update;
  perform 1 from public.inventory_capability_grants
  where user_id=p_actor
  for update;
end
$function$;

create or replace function app_private.require_c3_mission_mutation_authority(
  p_mission_id uuid,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path=public,app_private,pg_temp
as $function$
declare v_mission public.recount_missions; v_warehouse_id uuid;
begin
  select * into v_mission from public.recount_missions where id=p_mission_id;
  if v_mission.id is null or v_mission.round<>3 or v_mission.status<>'ACTIVE'
     or v_mission.assigned_user_id is distinct from p_actor then
    raise exception 'MISSION_ASSIGNMENT_CHANGED' using errcode='42501';
  end if;

  perform app_private.lock_actor_authorization_context(p_actor,v_mission.inventory_id);
  select warehouse_id into v_warehouse_id from public.inventories where id=v_mission.inventory_id;
  if not app_private.actor_has_capability(p_actor,'RECOUNT_C3',v_mission.inventory_id,v_warehouse_id) then
    raise exception 'AUTHORIZATION_REVOKED' using errcode='42501', detail='RECOUNT_C3';
  end if;
end
$function$;

-- A C3 worker can mutate only its current, still-authorized mission.  The
-- guard covers the C2.0 direct-RPC path; sync_counts has an equivalent stage
-- guard below and shares the same authorization-row locks.
create or replace function app_private.enforce_c3_subtask_mutation_authority()
returns trigger
language plpgsql
security definer
set search_path=public,app_private,pg_temp
as $function$
declare v_mission_id uuid; v_actor uuid:=app_private.require_active_actor();
begin
  if tg_table_name='recount_mission_subtasks' then
    v_mission_id:=coalesce(new.mission_id,old.mission_id);
  elsif tg_table_name='recount_subtask_serial_scans' then
    select mission_id into v_mission_id from public.recount_mission_subtasks where id=new.subtask_id;
  elsif tg_table_name='recount_subtask_findings' then
    select mission_id into v_mission_id from public.recount_mission_subtasks where id=new.subtask_id;
  else
    raise exception 'Unexpected C3 authority trigger relation' using errcode='P0001';
  end if;
  if exists(select 1 from public.recount_missions where id=v_mission_id and round=3) then
    perform app_private.require_c3_mission_mutation_authority(v_mission_id,v_actor);
  end if;
  return coalesce(new,old);
end
$function$;

drop trigger if exists recount_subtasks_require_c3_authority on public.recount_mission_subtasks;
create trigger recount_subtasks_require_c3_authority
before insert or update on public.recount_mission_subtasks
for each row execute function app_private.enforce_c3_subtask_mutation_authority();

drop trigger if exists recount_serial_scans_require_c3_authority on public.recount_subtask_serial_scans;
create trigger recount_serial_scans_require_c3_authority
before insert on public.recount_subtask_serial_scans
for each row execute function app_private.enforce_c3_subtask_mutation_authority();

drop trigger if exists recount_findings_require_c3_authority on public.recount_subtask_findings;
create trigger recount_findings_require_c3_authority
before insert on public.recount_subtask_findings
for each row execute function app_private.enforce_c3_subtask_mutation_authority();

-- Rebuild only the finalizer's authorization-sensitive function, retaining
-- the established evidence-only C3 result semantics.
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
  if mission.round=3 then
    perform app_private.require_c3_mission_mutation_authority(mission.id,p_actor);
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

  update public.recount_missions set status='COMPLETED',total_quantity=total,completed_at=now() where id=mission.id;
  if mission.round=2 then
    if review_required then
      update public.reconciliation_cases set status='PENDIENTE_ANALISIS',confirmed_physical_quantity=null where id=r.id;
    elsif total<>r.physical_quantity or identity_mismatch then
      update public.reconciliation_cases set status='REQUIERE_3ER_CONTEO',confirmed_physical_quantity=null where id=r.id;
      insert into public.recount_missions(case_id,inventory_id,round,created_by) values(r.id,r.inventory_id,3,p_actor) on conflict(case_id,round) do nothing;
    else
      update public.reconciliation_cases set status='FISICO_CONFIRMADO',confirmed_physical_quantity=total where id=r.id;
    end if;
    perform app_private.append_reconciliation_event(r.id,r.inventory_id,'SECOND_RECORDED',p_actor,jsonb_build_object('mission_id',mission.id,'round',mission.round,'subtask_count',completed_count,'total_quantity',total,'identity_mismatch',identity_mismatch,'review_required',review_required));
  end if;
  return jsonb_build_object('mission_id',mission.id,'round',mission.round,'total_quantity',total,'subtask_count',completed_count,'observation_count',completed_count,'case_id',r.id,'case_status',(select status::text from public.reconciliation_cases where id=r.id),'confirmed_physical_quantity',(select confirmed_physical_quantity from public.reconciliation_cases where id=r.id),'next_round',case when mission.round=2 and not review_required and (total<>r.physical_quantity or identity_mismatch) then 3 else null end,'review_required',case when mission.round=3 then true else review_required or identity_mismatch end);
end
$function$;

-- The queued claim also serializes its authorization context.  The dynamic
-- change preserves the earlier C3 originator-separation patch verbatim.
do $migration$
declare v_definition text; v_old text:=E'begin\n  if app_private.actor_has_capability(v_actor,\'RECOUNT_C3\',p_inventory_id) then'; v_new text:=E'begin\n  perform app_private.lock_actor_authorization_context(v_actor,p_inventory_id); -- CUT2_07D_CLAIM_REVOCATION_LOCK\n  if app_private.actor_has_capability(v_actor,\'RECOUNT_C3\',p_inventory_id) then';
begin
  select pg_get_functiondef('public.claim_next_recount_mission(uuid)'::regprocedure) into v_definition;
  if position('CUT2_07D_CLAIM_REVOCATION_LOCK' in v_definition)=0 then
    if position(v_old in v_definition)=0 then raise exception 'CUT2-07D claim authorization anchor changed; refusing blind rewrite' using errcode='P0001'; end if;
    execute replace(v_definition,v_old,v_new);
  end if;
end
$migration$;

-- sync_counts is the alternate (scanner/bulk/offline) C3 write route.  Lock
-- the mutable authorization context before its existing stage-specific check.
do $migration$
declare v_definition text; v_old text:=E'  v_inventory:=app_private.lock_inventory(p_inventory_id);'; v_new text:=E'  v_inventory:=app_private.lock_inventory(p_inventory_id);\n  perform app_private.lock_actor_authorization_context(v_actor,p_inventory_id); -- CUT2_07D_SYNC_REVOCATION_LOCK';
begin
  select pg_get_functiondef('public.sync_counts(uuid,uuid,public.device_platform,text,text,jsonb)'::regprocedure) into v_definition;
  if position('CUT2_07D_SYNC_REVOCATION_LOCK' in v_definition)=0 then
    if position(v_old in v_definition)=0 then raise exception 'CUT2-07D sync authorization anchor changed; refusing blind rewrite' using errcode='P0001'; end if;
    execute replace(v_definition,v_old,v_new);
  end if;
end
$migration$;

revoke all on function app_private.lock_actor_authorization_context(uuid,uuid),app_private.require_c3_mission_mutation_authority(uuid,uuid),app_private.enforce_c3_subtask_mutation_authority() from public,anon,authenticated;
