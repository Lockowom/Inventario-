-- CUT2-06B: migrate operational consumers to the canonical capability model.
-- This migration deliberately replaces only public entry points.  Domain
-- invariants (blindness, CUT2 seals, idempotency and SLA transitions) remain
-- in their existing implementations.

create or replace function app_private.require_inventory_capability(
  p_inventory_id uuid,
  p_capability public.cut2_capability,
  p_warehouse_id uuid default null
)
returns uuid
language plpgsql
stable
security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  v_actor uuid := app_private.require_active_actor();
begin
  if not app_private.actor_has_capability(v_actor,p_capability,p_inventory_id,p_warehouse_id) then
    raise exception 'CAPABILITY_REQUIRED' using errcode='42501', detail=p_capability::text;
  end if;
  return v_actor;
end
$function$;

-- C2 capability determines the eligible execution round.  C3 remains
-- intentionally distinct: a user with both capabilities keeps the historic
-- analyst behaviour (C3 first), while a C2-only operator can only claim C2.
create or replace function public.claim_next_recount_mission(p_inventory_id uuid)
returns jsonb language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  v_actor uuid:=app_private.require_active_actor();
  v_round integer;
  v_mission public.recount_missions;
  v_existing uuid;
  v_c1_done boolean:=false;
  v_transitioned integer:=0;
  v_max_reassignments integer;
begin
  if app_private.actor_has_capability(v_actor,'RECOUNT_C3',p_inventory_id) then
    v_round:=3;
  elsif app_private.actor_has_capability(v_actor,'RECOUNT_C2',p_inventory_id) then
    v_round:=2;
  else
    raise exception 'CAPABILITY_REQUIRED' using errcode='42501', detail='RECOUNT_C2_OR_RECOUNT_C3';
  end if;
  select id into v_existing from public.recount_missions where inventory_id=p_inventory_id and assigned_user_id=v_actor and status='ACTIVE' order by claimed_at,id limit 1;
  if v_existing is not null then perform app_private.ensure_recount_mission_subtasks(v_existing); return app_private.recount_mission_json(v_existing); end if;
  select c1_completed_at is not null into v_c1_done from public.inventories where id=p_inventory_id and status='ABIERTO';
  select p.max_reassignments into v_max_reassignments from public.inventories i join public.recount_sla_policies p on p.warehouse_id=i.warehouse_id and p.active where i.id=p_inventory_id;
  select m.* into v_mission from public.recount_missions m
  where m.inventory_id=p_inventory_id and m.round=v_round and m.status='QUEUED'
    and (v_c1_done or (v_round=2 and m.source_cut_id is not null))
    and (v_round<>2 or (m.last_assigned_user_id is distinct from v_actor and m.reassignment_count<=coalesce(v_max_reassignments,0)))
    and (v_round<>2 or m.source_cut_id is not null or not exists(select 1 from public.reconciliation_cases rc join public.count_records cr on cr.inventory_id=rc.inventory_id and cr.codigo=rc.codigo and ((rc.reference_type='SERIAL' and coalesce(cr.serie,'')=coalesce(rc.reference_value,'')) or (rc.reference_type='PARTIDA' and coalesce(cr.partida,'')=coalesce(rc.reference_value,'')) or rc.reference_type='LEGACY') where rc.id=m.case_id and cr.user_id=v_actor and not exists(select 1 from public.recount_mission_observations rmo where rmo.count_record_id=cr.id)))
  order by case when v_round=2 and m.claim_due_at<=now() then 0 else 1 end,m.created_at,m.id for update skip locked limit 1;
  if v_mission.id is null then return null; end if;
  update public.recount_missions set assigned_user_id=v_actor,status='ACTIVE',claimed_at=now(),abandoned_at=null,abandoned_reason=null where id=v_mission.id;
  update public.reconciliation_cases set status=case when v_round=2 then '2DO_CONTEO_ASIGNADO'::public.reconciliation_status else '3ER_CONTEO_ASIGNADO'::public.reconciliation_status end where id=v_mission.case_id and status=case when v_round=2 then 'REQUIERE_2DO_CONTEO'::public.reconciliation_status else 'REQUIERE_3ER_CONTEO'::public.reconciliation_status end;
  get diagnostics v_transitioned=row_count;
  if v_transitioned<>1 then raise exception 'Recount case state changed before mission claim' using errcode='40001'; end if;
  perform app_private.ensure_recount_mission_subtasks(v_mission.id);
  perform app_private.append_reconciliation_event(v_mission.case_id,p_inventory_id,case when v_round=2 then 'SECOND_ASSIGNED' else 'THIRD_ASSIGNED' end,v_actor,jsonb_build_object('mission_id',v_mission.id,'round',v_round,'assignment_mode','QUEUE_CLAIM','cut2_05_sla_due_at',v_mission.c2_due_at));
  return app_private.recount_mission_json(v_mission.id);
end
$function$;

create or replace function public.process_recount_sla(p_inventory_id uuid)
returns jsonb language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare v_actor uuid:=app_private.require_inventory_capability(p_inventory_id,'REASSIGN_C2'); v_marked integer:=0; v_requeued integer:=0; v_row public.recount_missions;
begin
  for v_row in select * from public.recount_missions where inventory_id=p_inventory_id and round=2 and status in ('QUEUED','ACTIVE') and ((status='QUEUED' and claim_due_at<=now()) or (status='ACTIVE' and c2_due_at<=now())) order by c2_due_at nulls last,id for update skip locked loop
    if v_row.overdue_at is null then
      update public.recount_missions set overdue_at=now() where id=v_row.id;
      insert into public.recount_mission_lifecycle_events(mission_id,inventory_id,event_type,actor_user_id,payload) values(v_row.id,p_inventory_id,'C2_OVERDUE_OPERATIONAL',v_actor,jsonb_build_object('status',v_row.status,'claim_due_at',v_row.claim_due_at,'c2_due_at',v_row.c2_due_at));
      v_marked:=v_marked+1;
    end if;
    if v_row.status='ACTIVE' and v_row.started_at is null and v_row.reassignment_count < (select max_reassignments from public.inventories i join public.recount_sla_policies p on p.warehouse_id=i.warehouse_id where i.id=p_inventory_id and p.active) then
      update public.recount_missions set status='QUEUED',last_assigned_user_id=v_row.assigned_user_id,assigned_user_id=null,claimed_at=null,abandoned_at=now(),abandoned_reason='SLA operational timeout before physical evidence',reassignment_count=reassignment_count+1 where id=v_row.id;
      update public.reconciliation_cases set status='REQUIERE_2DO_CONTEO' where id=v_row.case_id and status='2DO_CONTEO_ASIGNADO';
      v_requeued:=v_requeued+1;
    end if;
  end loop;
  return jsonb_build_object('inventory_id',p_inventory_id,'overdue_marked',v_marked,'requeued_without_evidence',v_requeued);
end
$function$;

create or replace function public.reassign_recount_mission(p_mission_id uuid,p_reason text)
returns jsonb language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare v_mission public.recount_missions; v_has_evidence boolean;
begin
  perform app_private.require_active_actor();
  if length(btrim(coalesce(p_reason,'')))<3 then raise exception 'Reassignment reason must contain at least 3 characters' using errcode='23514'; end if;
  select * into v_mission from public.recount_missions where id=p_mission_id for update;
  if v_mission.id is null or v_mission.round<>2 then raise exception 'Not authorized for C2 reassignment' using errcode='42501'; end if;
  perform app_private.require_inventory_capability(v_mission.inventory_id,'REASSIGN_C2');
  if v_mission.status='QUEUED' then return app_private.recount_mission_json(v_mission.id); end if;
  if v_mission.status<>'ACTIVE' then raise exception 'Only active C2 missions can be reassigned' using errcode='23514'; end if;
  select exists(select 1 from public.recount_mission_observations where mission_id=v_mission.id) or exists(select 1 from public.recount_mission_subtasks where mission_id=v_mission.id and status<>'PENDING') into v_has_evidence;
  if v_has_evidence then raise exception 'Started C2 cannot be reassigned; escalate it to preserve blind evidence' using errcode='23514'; end if;
  update public.recount_missions set status='QUEUED',last_assigned_user_id=v_mission.assigned_user_id,assigned_user_id=null,claimed_at=null,abandoned_at=now(),abandoned_reason=btrim(p_reason),reassignment_count=reassignment_count+1 where id=v_mission.id;
  update public.reconciliation_cases set status='REQUIERE_2DO_CONTEO' where id=v_mission.case_id and status='2DO_CONTEO_ASIGNADO';
  return app_private.recount_mission_json(v_mission.id);
end
$function$;

create or replace function public.get_c2_execution_metrics(p_inventory_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=public,app_private,pg_temp
as $function$
begin
  perform app_private.require_inventory_capability(p_inventory_id,'VIEW_MONITOR');
  return (select jsonb_build_object(
    'queued_missions',count(distinct m.id) filter(where m.round=2 and m.status='QUEUED'),
    'claimed_missions',count(distinct m.id) filter(where m.round=2 and m.status='ACTIVE' and m.started_at is null),
    'active_missions',count(distinct m.id) filter(where m.round=2 and m.status='ACTIVE' and m.started_at is not null),
    'overdue_operational',count(distinct m.id) filter(where m.round=2 and m.status in ('QUEUED','ACTIVE') and (m.overdue_at is not null or (m.status='QUEUED' and m.claim_due_at<=now()) or (m.status='ACTIVE' and m.c2_due_at<=now()))),
    'reassignment_pending',count(distinct m.id) filter(where m.round=2 and m.status='QUEUED' and m.reassignment_count>0),
    'pending_subtasks',count(s.id) filter(where s.status='PENDING'),
    'completed_subtasks',count(s.id) filter(where s.status in('COUNTED','ZERO_CONFIRMED')),
    'serial_sweeps_active',count(s.id) filter(where s.strategy='SERIAL_SWEEP' and s.status='ACTIVE'),
    'targeted_searches',count(s.id) filter(where s.strategy='TARGETED_SERIAL_SEARCH'),
    'blocked',count(s.id) filter(where s.status='INACCESSIBLE'),
    'escalated',count(s.id) filter(where s.status='ESCALATED')
  ) from public.recount_missions m left join public.recount_mission_subtasks s on s.mission_id=m.id where m.inventory_id=p_inventory_id);
end
$function$;

create or replace function public.get_c2_operational_missions(p_inventory_id uuid)
returns table(mission_id uuid, execution_state text, sla_state text, c2_due_at timestamptz, claim_due_at timestamptz, reassignment_count integer, reassignable boolean)
language plpgsql stable security definer
set search_path=public,app_private,pg_temp
as $function$
begin
  perform app_private.require_inventory_capability(p_inventory_id,'VIEW_MONITOR');
  return query
  select m.id,
    case when m.status='ACTIVE' and m.started_at is null then 'CLAIMED' when m.status='ACTIVE' then 'ACTIVE' else m.status::text end,
    case when m.overdue_at is not null or (m.status='QUEUED' and m.claim_due_at<=now()) or (m.status='ACTIVE' and m.c2_due_at<=now()) then 'C2_OVERDUE_OPERATIONAL' else 'ON_TIME' end,
    m.c2_due_at,m.claim_due_at,m.reassignment_count,
    m.status='ACTIVE' and m.started_at is null
      and not exists(select 1 from public.recount_mission_observations o where o.mission_id=m.id)
      and not exists(select 1 from public.recount_mission_subtasks s where s.mission_id=m.id and s.status<>'PENDING')
  from public.recount_missions m
  where m.inventory_id=p_inventory_id and m.round=2
  order by m.c2_due_at nulls last,m.created_at,m.id;
end
$function$;

revoke all on function app_private.require_inventory_capability(uuid,public.cut2_capability,uuid) from public,anon,authenticated;
revoke all on function public.claim_next_recount_mission(uuid),public.process_recount_sla(uuid),public.reassign_recount_mission(uuid,text),public.get_c2_execution_metrics(uuid),public.get_c2_operational_missions(uuid) from public,anon;
grant execute on function public.claim_next_recount_mission(uuid),public.process_recount_sla(uuid),public.reassign_recount_mission(uuid,text),public.get_c2_execution_metrics(uuid),public.get_c2_operational_missions(uuid) to authenticated;
