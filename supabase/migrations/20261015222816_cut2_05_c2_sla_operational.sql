-- CUT2-05: C2 per rolling cut, operational SLA and safe reassignment.
-- This is deliberately additive.  A C2 remains one blind mission per
-- reconciliation reference; lifecycle metadata never changes its quantity
-- evidence or gives a counter access to C1 / Softland quantities.

create table public.recount_sla_policies (
  warehouse_id uuid primary key references public.warehouses(id) on delete restrict,
  c2_operational_minutes integer not null default 240 check (c2_operational_minutes between 1 and 10080),
  claim_operational_minutes integer not null default 60 check (claim_operational_minutes between 1 and 10080),
  max_reassignments integer not null default 3 check (max_reassignments between 0 and 20),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.recount_sla_policies (warehouse_id)
select id from public.warehouses
on conflict (warehouse_id) do nothing;

create trigger recount_sla_policies_set_updated_at
before update on public.recount_sla_policies
for each row execute function public.set_updated_at();

alter table public.recount_sla_policies enable row level security;
revoke all on public.recount_sla_policies from anon, authenticated;

alter table public.recount_missions
  add column if not exists source_sealed_reference_id uuid references public.inventory_sealed_references(id) on delete restrict,
  add column if not exists operational_hours_id uuid references public.operational_hours(id) on delete restrict,
  add column if not exists c2_due_at timestamptz,
  add column if not exists claim_due_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists overdue_at timestamptz,
  add column if not exists abandoned_at timestamptz,
  add column if not exists abandoned_reason text,
  add column if not exists last_assigned_user_id uuid references public.profiles(user_id) on delete restrict,
  add column if not exists reassignment_count integer not null default 0,
  add column if not exists sla_operational_minutes integer,
  add column if not exists claim_operational_minutes integer;

alter table public.recount_missions
  add constraint recount_missions_reassignment_count_check check (reassignment_count >= 0),
  add constraint recount_missions_sla_minutes_check check (sla_operational_minutes is null or sla_operational_minutes between 1 and 10080),
  add constraint recount_missions_claim_minutes_check check (claim_operational_minutes is null or claim_operational_minutes between 1 and 10080),
  add constraint recount_missions_abandonment_reason_check check (abandoned_reason is null or length(btrim(abandoned_reason)) between 3 and 500);

create index recount_missions_c2_sla_queue_idx
  on public.recount_missions (inventory_id, round, status, claim_due_at, c2_due_at, created_at, id)
  where round = 2 and status in ('QUEUED','ACTIVE');
create unique index recount_missions_one_c2_per_sealed_reference
  on public.recount_missions (source_sealed_reference_id)
  where round = 2 and source_sealed_reference_id is not null;

create table public.recount_mission_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.recount_missions(id) on delete restrict,
  inventory_id uuid not null references public.inventories(id) on delete restrict,
  event_type text not null check (event_type in (
    'C2_CREATED','C2_REFERENCE_LINKED','C2_CLAIMED','C2_ACTIVATED',
    'C2_OVERDUE_OPERATIONAL','C2_ABANDONED','C2_REQUEUED','C2_REASSIGNED','C2_COMPLETED'
  )),
  actor_user_id uuid references public.profiles(user_id) on delete restrict,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now()
);
create index recount_mission_lifecycle_events_mission_idx
  on public.recount_mission_lifecycle_events (mission_id, created_at, id);
create unique index recount_mission_lifecycle_events_once_idx
  on public.recount_mission_lifecycle_events (mission_id, event_type)
  where event_type in ('C2_CREATED','C2_REFERENCE_LINKED','C2_ACTIVATED','C2_OVERDUE_OPERATIONAL','C2_COMPLETED');
alter table public.recount_mission_lifecycle_events enable row level security;
revoke all on public.recount_mission_lifecycle_events from anon, authenticated;

-- Finds the first UTC instant at which the requested operational minutes have
-- elapsed.  It uses the existing calendar function (including DST, shifts,
-- breaks and holidays) and binary-searches the result, rather than assuming a
-- fixed wall-clock workday.
create or replace function public.operational_deadline_after(
  p_operational_hours_id uuid,
  p_starts_at timestamptz,
  p_operational_minutes integer
)
returns timestamptz
language plpgsql
stable
security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  v_start timestamptz;
  v_lower timestamptz;
  v_upper timestamptz;
  v_middle timestamptz;
  v_minutes integer;
begin
  if p_starts_at is null or p_operational_minutes is null or p_operational_minutes < 1 or p_operational_minutes > 10080 then
    raise exception 'Operational SLA minutes must be between 1 and 10080' using errcode='22023';
  end if;
  if not exists(select 1 from public.operational_hours where id=p_operational_hours_id and active) then
    raise exception 'Active operational calendar is required' using errcode='23514';
  end if;
  v_start:=date_trunc('minute',p_starts_at);
  v_lower:=v_start;
  v_upper:=v_start + interval '1 minute';
  loop
    v_minutes:=public.operational_minutes_between(p_operational_hours_id,v_start,v_upper);
    exit when v_minutes >= p_operational_minutes;
    if v_upper >= v_start + interval '366 days' then
      raise exception 'Operational calendar cannot satisfy SLA within 366 days' using errcode='23514';
    end if;
    v_upper:=least(v_start + interval '366 days', v_start + greatest(interval '1 day',(v_upper-v_start)*2));
  end loop;
  while v_upper-v_lower > interval '1 minute' loop
    v_middle:=date_trunc('minute',v_lower + (v_upper-v_lower)/2);
    if v_middle<=v_lower then v_middle:=v_lower+interval '1 minute'; end if;
    if public.operational_minutes_between(p_operational_hours_id,v_start,v_middle) >= p_operational_minutes then v_upper:=v_middle; else v_lower:=v_middle; end if;
  end loop;
  return v_upper;
end
$function$;

create or replace function app_private.apply_c2_sla()
returns trigger
language plpgsql
security definer
set search_path=public,app_private,pg_temp
as $function$
declare v_policy public.recount_sla_policies; v_calendar uuid;
begin
  if new.round <> 2 then return new; end if;
  select w.operational_hours_id into v_calendar
  from public.inventories i join public.warehouses w on w.id=i.warehouse_id
  where i.id=new.inventory_id;
  select * into v_policy from public.recount_sla_policies p
  where p.warehouse_id=(select warehouse_id from public.inventories where id=new.inventory_id) and p.active;
  if v_calendar is null or v_policy.warehouse_id is null then
    raise exception 'C2 requires an active warehouse SLA policy and calendar' using errcode='23514';
  end if;
  if new.operational_hours_id is null then new.operational_hours_id:=v_calendar; end if;
  if new.sla_operational_minutes is null then new.sla_operational_minutes:=v_policy.c2_operational_minutes; end if;
  if new.claim_operational_minutes is null then new.claim_operational_minutes:=v_policy.claim_operational_minutes; end if;
  if new.c2_due_at is null then new.c2_due_at:=public.operational_deadline_after(new.operational_hours_id,coalesce(new.created_at,now()),new.sla_operational_minutes); end if;
  if new.claim_due_at is null then new.claim_due_at:=public.operational_deadline_after(new.operational_hours_id,coalesce(new.created_at,now()),new.claim_operational_minutes); end if;
  if new.source_cut_id is null then
    select source_cut_id into new.source_cut_id from public.reconciliation_cases where id=new.case_id;
  end if;
  if new.source_sealed_reference_id is null then
    select source_sealed_reference_id into new.source_sealed_reference_id
    from public.recount_missions prior
    where prior.case_id=new.case_id and prior.round=2 and prior.id<>coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid)
    order by prior.created_at limit 1;
  end if;
  return new;
end
$function$;
create trigger recount_missions_apply_c2_sla
before insert on public.recount_missions
for each row execute function app_private.apply_c2_sla();
revoke all on function app_private.apply_c2_sla() from public,anon,authenticated;

-- Upgrade-safe backfill for missions that already existed before CUT2-05.
update public.recount_missions m
set operational_hours_id=w.operational_hours_id,
    sla_operational_minutes=p.c2_operational_minutes,
    claim_operational_minutes=p.claim_operational_minutes,
    c2_due_at=public.operational_deadline_after(w.operational_hours_id,m.created_at,p.c2_operational_minutes),
    claim_due_at=public.operational_deadline_after(w.operational_hours_id,m.created_at,p.claim_operational_minutes)
from public.inventories i
join public.warehouses w on w.id=i.warehouse_id
join public.recount_sla_policies p on p.warehouse_id=w.id and p.active
where m.inventory_id=i.id and m.round=2
  and (m.operational_hours_id is null or m.c2_due_at is null or m.claim_due_at is null);

create or replace function app_private.capture_c2_lifecycle()
returns trigger
language plpgsql
security definer
set search_path=public,app_private,pg_temp
as $function$
begin
  if new.round<>2 then return new; end if;
  if tg_op='INSERT' then
    insert into public.recount_mission_lifecycle_events(mission_id,inventory_id,event_type,actor_user_id,payload)
    values(new.id,new.inventory_id,'C2_CREATED',new.created_by,jsonb_build_object('source_cut_id',new.source_cut_id,'source_sealed_reference_id',new.source_sealed_reference_id,'c2_due_at',new.c2_due_at,'claim_due_at',new.claim_due_at))
    on conflict do nothing;
  elsif old.assigned_user_id is distinct from new.assigned_user_id and new.status='ACTIVE' then
    insert into public.recount_mission_lifecycle_events(mission_id,inventory_id,event_type,actor_user_id,payload)
    values(new.id,new.inventory_id,case when new.reassignment_count>0 then 'C2_REASSIGNED' else 'C2_CLAIMED' end,new.assigned_user_id,jsonb_build_object('reassignment_count',new.reassignment_count,'c2_due_at',new.c2_due_at))
    on conflict do nothing;
  elsif old.status='ACTIVE' and new.status='QUEUED' then
    insert into public.recount_mission_lifecycle_events(mission_id,inventory_id,event_type,actor_user_id,payload)
    values(new.id,new.inventory_id,case when new.abandoned_at is not null then 'C2_ABANDONED' else 'C2_REQUEUED' end,coalesce(new.last_assigned_user_id,old.assigned_user_id),jsonb_build_object('reason',new.abandoned_reason,'reassignment_count',new.reassignment_count));
  elsif old.status<>'COMPLETED' and new.status='COMPLETED' then
    insert into public.recount_mission_lifecycle_events(mission_id,inventory_id,event_type,actor_user_id,payload)
    values(new.id,new.inventory_id,'C2_COMPLETED',new.assigned_user_id,jsonb_build_object('completed_at',new.completed_at));
  end if;
  return new;
end
$function$;
create trigger recount_missions_capture_c2_lifecycle
after insert or update on public.recount_missions
for each row execute function app_private.capture_c2_lifecycle();
revoke all on function app_private.capture_c2_lifecycle() from public,anon,authenticated;

create or replace function app_private.link_c2_to_sealed_reference()
returns trigger
language plpgsql
security definer
set search_path=public,app_private,pg_temp
as $function$
begin
  if new.event_type='C2_CREATED_FROM_CUT' and new.reconciliation_case_id is not null and new.sealed_reference_id is not null then
    update public.recount_missions
    set source_sealed_reference_id=new.sealed_reference_id
    where case_id=new.reconciliation_case_id and round=2 and source_cut_id=new.cut_id and source_sealed_reference_id is null;
    insert into public.recount_mission_lifecycle_events(mission_id,inventory_id,event_type,actor_user_id,payload)
    select m.id,m.inventory_id,'C2_REFERENCE_LINKED',new.actor_user_id,jsonb_build_object('source_cut_id',new.cut_id,'source_sealed_reference_id',new.sealed_reference_id)
    from public.recount_missions m
    where m.case_id=new.reconciliation_case_id and m.round=2 and m.source_cut_id=new.cut_id
    on conflict do nothing;
  end if;
  return new;
end
$function$;
create trigger rolling_cut_events_link_c2_to_reference
after insert on public.rolling_cut_events
for each row execute function app_private.link_c2_to_sealed_reference();
revoke all on function app_private.link_c2_to_sealed_reference() from public,anon,authenticated;

-- Existing CUT2-03 missions are backfilled from their immutable cut event.
update public.recount_missions m
set source_sealed_reference_id=e.sealed_reference_id
from public.rolling_cut_events e
where m.round=2 and m.source_sealed_reference_id is null and e.event_type='C2_CREATED_FROM_CUT'
  and e.reconciliation_case_id=m.case_id and e.cut_id=m.source_cut_id;

create or replace function app_private.mark_c2_started(p_mission_id uuid,p_actor uuid)
returns void
language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare v_mission public.recount_missions;
begin
  select * into v_mission from public.recount_missions where id=p_mission_id for update;
  if v_mission.round=2 and v_mission.status='ACTIVE' and v_mission.assigned_user_id=p_actor and v_mission.started_at is null then
    update public.recount_missions set started_at=now() where id=p_mission_id;
    insert into public.recount_mission_lifecycle_events(mission_id,inventory_id,event_type,actor_user_id,payload)
    values(p_mission_id,v_mission.inventory_id,'C2_ACTIVATED',p_actor,jsonb_build_object('started_at',now())) on conflict do nothing;
  end if;
end
$function$;
revoke all on function app_private.mark_c2_started(uuid,uuid) from public,anon,authenticated;

create or replace function app_private.mark_c2_started_from_subtask()
returns trigger
language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare v_actor uuid:=coalesce(auth.uid(),new.completed_by); v_mission uuid;
begin
  if (tg_op='INSERT' and new.status<>'PENDING') or (tg_op='UPDATE' and old.status='PENDING' and new.status<>'PENDING') then
    select id into v_mission from public.recount_missions where id=new.mission_id and round=2;
    if v_mission is not null then perform app_private.mark_c2_started(v_mission,v_actor); end if;
  end if;
  return new;
end
$function$;
create trigger recount_subtasks_mark_c2_started
after insert or update of status on public.recount_mission_subtasks
for each row execute function app_private.mark_c2_started_from_subtask();
revoke all on function app_private.mark_c2_started_from_subtask() from public,anon,authenticated;

create or replace function app_private.mark_c2_started_from_observation()
returns trigger
language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare v_actor uuid:=auth.uid();
begin
  perform app_private.mark_c2_started(new.mission_id,v_actor);
  return new;
end
$function$;
create trigger recount_observations_mark_c2_started
after insert on public.recount_mission_observations
for each row execute function app_private.mark_c2_started_from_observation();
revoke all on function app_private.mark_c2_started_from_observation() from public,anon,authenticated;

create or replace function app_private.recount_mission_json(p_mission_id uuid)
returns jsonb
language sql stable security definer
set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'id',m.id,'case_id',m.case_id,'inventory_id',m.inventory_id,'round',m.round,'status',m.status,
    'execution_state',case when m.status='ACTIVE' and m.started_at is null then 'CLAIMED' when m.status='ACTIVE' then 'ACTIVE' else m.status::text end,
    'sla_due_at',case when m.round=2 then m.c2_due_at else null end,
    'sla_state',case when m.round=2 and m.overdue_at is not null then 'C2_OVERDUE_OPERATIONAL' when m.round=2 and m.c2_due_at<=now() then 'C2_OVERDUE_OPERATIONAL' when m.round=2 then 'ON_TIME' else null end,
    'codigo',r.codigo,'descripcion',mi.descripcion,'reference_type',r.reference_type,'reference_value',r.reference_value,
    'known_locations',app_private.recount_case_locations(r.id),
    'subtasks',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'location',s.location,'strategy',s.strategy,'status',s.status,'logistic_unit',s.logistic_unit,'counted_quantity',s.counted_quantity,'exception_reason',s.exception_reason,'created_at',s.created_at,'started_at',s.started_at,'completed_at',s.completed_at,'scanned_series_count',(select count(*)::integer from public.recount_subtask_serial_scans scan where scan.subtask_id=s.id),'recent_series',coalesce((select jsonb_agg(scan.serie order by scan.scanned_at desc) from (select serie,scanned_at from public.recount_subtask_serial_scans where subtask_id=s.id order by scanned_at desc limit 5) scan),'[]'::jsonb)) order by case when s.location='TECHO' then 1 else 0 end,s.location) from public.recount_mission_subtasks s where s.mission_id=m.id),'[]'::jsonb),
    'observations',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'client_count_id',c.client_count_id,'ubicacion',c.ubicacion,'cantidad',c.cantidad_contada,'captured_at',c.captured_at) order by c.captured_at,c.id) from public.recount_mission_observations o join public.count_records c on c.id=o.count_record_id where o.mission_id=m.id),'[]'::jsonb)
  ) from public.recount_missions m join public.reconciliation_cases r on r.id=m.case_id join public.inventory_master_items mi on mi.inventory_id=r.inventory_id and mi.codigo=r.codigo where m.id=p_mission_id
$$;

-- Claiming preserves the original role, C1-separation, open-inventory and
-- rolling-cut gates. A released mission cannot be auto-claimed again by its
-- last operator, which prevents a timeout from silently becoming self-claim.
create or replace function public.claim_next_recount_mission(p_inventory_id uuid)
returns jsonb language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare v_actor uuid:=app_private.require_active_actor(); v_role public.app_role; v_round integer; v_mission public.recount_missions; v_existing uuid; v_c1_done boolean:=false; v_transitioned integer:=0; v_max_reassignments integer;
begin
  if not app_private.can_access_inventory(p_inventory_id) then raise exception 'Not authorized for inventory' using errcode='42501'; end if;
  select role into v_role from public.profiles where user_id=v_actor and active;
  v_round:=case when v_role='CONTADOR' then 2 when v_role in('ANALISTA','ADMIN') then 3 else null end;
  if v_round is null then raise exception 'Role does not admit recount missions' using errcode='42501'; end if;
  if v_round=2 and not public.cut2_has_capability(p_inventory_id,'RECOUNT_C2') then raise exception 'RECOUNT_C2 capability is required' using errcode='42501'; end if;
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
  get diagnostics v_transitioned=row_count; if v_transitioned<>1 then raise exception 'Recount case state changed before mission claim' using errcode='40001'; end if;
  perform app_private.ensure_recount_mission_subtasks(v_mission.id);
  perform app_private.append_reconciliation_event(v_mission.case_id,p_inventory_id,case when v_round=2 then 'SECOND_ASSIGNED' else 'THIRD_ASSIGNED' end,v_actor,jsonb_build_object('mission_id',v_mission.id,'round',v_round,'assignment_mode','QUEUE_CLAIM','cut2_05_sla_due_at',v_mission.c2_due_at));
  return app_private.recount_mission_json(v_mission.id);
end
$function$;

create or replace function public.abandon_my_recount_mission(p_mission_id uuid,p_reason text)
returns jsonb language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare v_actor uuid:=app_private.require_active_actor(); v_mission public.recount_missions; v_has_evidence boolean;
begin
  if length(btrim(coalesce(p_reason,'')))<3 then raise exception 'Abandonment reason must contain at least 3 characters' using errcode='23514'; end if;
  select * into v_mission from public.recount_missions where id=p_mission_id for update;
  if v_mission.id is null or v_mission.status<>'ACTIVE' or v_mission.assigned_user_id<>v_actor then raise exception 'Active recount mission is not assigned to actor' using errcode='42501'; end if;
  select exists(select 1 from public.recount_mission_observations where mission_id=v_mission.id) or exists(select 1 from public.recount_mission_subtasks where mission_id=v_mission.id and status<>'PENDING') into v_has_evidence;
  if v_has_evidence then raise exception 'Started C2 cannot be reassigned; escalate it to preserve blind evidence' using errcode='23514'; end if;
  update public.recount_missions set status='QUEUED',last_assigned_user_id=v_actor,assigned_user_id=null,claimed_at=null,abandoned_at=now(),abandoned_reason=btrim(p_reason),reassignment_count=reassignment_count+1 where id=v_mission.id;
  update public.reconciliation_cases set status=case when v_mission.round=2 then 'REQUIERE_2DO_CONTEO'::public.reconciliation_status else 'REQUIERE_3ER_CONTEO'::public.reconciliation_status end where id=v_mission.case_id;
  return app_private.recount_mission_json(v_mission.id);
end
$function$;

create or replace function public.process_recount_sla(p_inventory_id uuid)
returns jsonb language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare v_actor uuid:=app_private.require_active_actor(); v_marked integer:=0; v_requeued integer:=0; v_row public.recount_missions;
begin
  if not app_private.can_manage_inventory(p_inventory_id) then raise exception 'Not authorized for C2 SLA processing' using errcode='42501'; end if;
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

-- A manager may requeue an unstarted C2, but never nominate a user directly:
-- the normal guarded claim still enforces role, inventory assignment, C1
-- independence and the no-self-reclaim rule.
create or replace function public.reassign_recount_mission(p_mission_id uuid,p_reason text)
returns jsonb language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare v_mission public.recount_missions; v_has_evidence boolean;
begin
  perform app_private.require_active_actor();
  if length(btrim(coalesce(p_reason,'')))<3 then raise exception 'Reassignment reason must contain at least 3 characters' using errcode='23514'; end if;
  select * into v_mission from public.recount_missions where id=p_mission_id for update;
  if v_mission.id is null or v_mission.round<>2 or not app_private.can_manage_inventory(v_mission.inventory_id) then raise exception 'Not authorized for C2 reassignment' using errcode='42501'; end if;
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
  perform app_private.require_active_actor();
  if not app_private.can_manage_inventory(p_inventory_id) then raise exception 'Not authorized for C2 monitor' using errcode='42501'; end if;
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
  perform app_private.require_active_actor();
  if not app_private.can_manage_inventory(p_inventory_id) then raise exception 'Not authorized for C2 monitor' using errcode='42501'; end if;
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

revoke all on function public.operational_deadline_after(uuid,timestamptz,integer),public.abandon_my_recount_mission(uuid,text),public.reassign_recount_mission(uuid,text),public.process_recount_sla(uuid),public.get_c2_operational_missions(uuid) from public,anon;
grant execute on function public.operational_deadline_after(uuid,timestamptz,integer),public.abandon_my_recount_mission(uuid,text),public.reassign_recount_mission(uuid,text),public.process_recount_sla(uuid),public.get_c2_operational_missions(uuid) to authenticated;
grant select on public.recount_sla_policies to authenticated;
