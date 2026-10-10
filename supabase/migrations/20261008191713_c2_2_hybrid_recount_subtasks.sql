-- C2 2.0: physical execution is location/subtask based; reconciliation stays
-- bound to a logical reference (SKU+serial, SKU+batch, or SKU).
do $$ begin
  create type public.recount_subtask_status as enum ('PENDING','ACTIVE','COUNTED','ZERO_CONFIRMED','INACCESSIBLE','ESCALATED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.recount_subtask_strategy as enum ('BATCH_LOCATION_RECOUNT','TARGETED_SERIAL_SEARCH','SERIAL_SWEEP','LEGACY_LOCATION_RECOUNT');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.recount_finding_type as enum ('DAMAGED','EXPIRED','ILLEGIBLE_SERIAL','ILLEGIBLE_BATCH','WRONG_LOCATION','WRONG_LABEL','DUPLICATE_PHYSICAL_LABEL','OTHER');
exception when duplicate_object then null; end $$;

create table if not exists public.recount_mission_subtasks (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.recount_missions(id) on delete restrict,
  inventory_id uuid not null references public.inventories(id) on delete restrict,
  location text not null check (location ~ '^(TECHO|(A|B|C|C2|D|F|G|H|I)-[0-9]{2}-[0-9]{2})$'),
  strategy public.recount_subtask_strategy not null,
  status public.recount_subtask_status not null default 'PENDING',
  logistic_unit text,
  counted_quantity integer check (counted_quantity is null or counted_quantity >= 0),
  result_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(result_metadata) = 'object'),
  exception_reason text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references public.profiles(user_id) on delete restrict,
  unique(mission_id, location),
  check (
    (status in ('PENDING','ACTIVE') and counted_quantity is null and completed_at is null)
    or (status='COUNTED' and counted_quantity is not null and counted_quantity > 0 and completed_at is not null and completed_by is not null)
    or (status='ZERO_CONFIRMED' and counted_quantity=0 and completed_at is not null and completed_by is not null)
    or (status in ('INACCESSIBLE','ESCALATED') and counted_quantity is null and exception_reason is not null and completed_at is not null and completed_by is not null)
  )
);
create index if not exists recount_mission_subtasks_execution_idx on public.recount_mission_subtasks(mission_id,status,location);

create table if not exists public.recount_subtask_serial_scans (
  id uuid primary key default gen_random_uuid(),
  subtask_id uuid not null references public.recount_mission_subtasks(id) on delete restrict,
  serie text not null check (btrim(serie)<>'' and length(serie)<=19),
  scanned_at timestamptz not null default now(),
  scanned_by uuid not null references public.profiles(user_id) on delete restrict,
  unique(subtask_id,serie)
);
create index if not exists recount_subtask_serial_scans_subtask_idx on public.recount_subtask_serial_scans(subtask_id,scanned_at desc);

create table if not exists public.recount_subtask_findings (
  id uuid primary key default gen_random_uuid(),
  subtask_id uuid not null references public.recount_mission_subtasks(id) on delete restrict,
  finding_type public.recount_finding_type not null,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(user_id) on delete restrict
);
create index if not exists recount_subtask_findings_subtask_idx on public.recount_subtask_findings(subtask_id,created_at desc);

alter table public.recount_mission_subtasks enable row level security;
alter table public.recount_subtask_serial_scans enable row level security;
alter table public.recount_subtask_findings enable row level security;
revoke all on public.recount_mission_subtasks, public.recount_subtask_serial_scans, public.recount_subtask_findings from anon, authenticated;

-- Exactly one place owns the serial thresholds. The client mirrors these
-- constants for an immediate offline preview, but the database decides the
-- persisted strategy.
create or replace function app_private.serial_recount_strategy(p_series integer, p_anomalies integer)
returns public.recount_subtask_strategy
language sql immutable security invoker
set search_path = ''
as $$
  select case
    when greatest(coalesce(p_series,0),0) >= 70 then 'SERIAL_SWEEP'::public.recount_subtask_strategy
    when greatest(coalesce(p_series,0),0) > 0
      and greatest(coalesce(p_anomalies,0),0)::numeric / greatest(p_series,1) >= 0.20
      then 'SERIAL_SWEEP'::public.recount_subtask_strategy
    else 'TARGETED_SERIAL_SEARCH'::public.recount_subtask_strategy
  end
$$;
revoke all on function app_private.serial_recount_strategy(integer,integer) from public,anon,authenticated;

create or replace function app_private.ensure_recount_mission_subtasks(p_mission_id uuid)
returns void
language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  m public.recount_missions;
  r public.reconciliation_cases;
  row_location text;
  series_at_location integer;
  anomalies_at_location integer;
  selected_strategy public.recount_subtask_strategy;
begin
  select * into m from public.recount_missions where id=p_mission_id;
  if m.id is null then raise exception 'Recount mission not found' using errcode='P0002'; end if;
  select * into r from public.reconciliation_cases where id=m.case_id;

  for row_location in
    select c.ubicacion
    from public.count_records c
    where c.inventory_id=m.inventory_id
      and c.codigo=r.codigo
      and not exists(select 1 from public.recount_mission_observations o where o.count_record_id=c.id)
      and (
        (r.reference_type='SERIAL' and coalesce(c.serie,'')=coalesce(r.reference_value,''))
        or (r.reference_type='PARTIDA' and coalesce(c.partida,'')=coalesce(r.reference_value,''))
        or r.reference_type='LEGACY'
      )
    group by c.ubicacion
    order by case when c.ubicacion='TECHO' then 1 else 0 end, c.ubicacion
  loop
    if r.reference_type='PARTIDA' then
      selected_strategy:='BATCH_LOCATION_RECOUNT';
    elsif r.reference_type='LEGACY' then
      selected_strategy:='LEGACY_LOCATION_RECOUNT';
    else
      select count(distinct c.serie)::integer into series_at_location
      from public.count_records c
      where c.inventory_id=m.inventory_id and c.codigo=r.codigo and c.ubicacion=row_location
        and c.serie is not null
        and not exists(select 1 from public.recount_mission_observations o where o.count_record_id=c.id);
      select count(*)::integer into anomalies_at_location
      from public.reconciliation_cases rc
      join public.count_records c on c.inventory_id=rc.inventory_id and c.codigo=rc.codigo
        and rc.reference_type='SERIAL' and c.serie=rc.reference_value
      where rc.inventory_id=m.inventory_id and rc.codigo=r.codigo and c.ubicacion=row_location
        and rc.status in('REQUIERE_2DO_CONTEO','2DO_CONTEO_ASIGNADO');
      selected_strategy:=app_private.serial_recount_strategy(series_at_location,anomalies_at_location);
    end if;
    insert into public.recount_mission_subtasks(mission_id,inventory_id,location,strategy)
    values(m.id,m.inventory_id,row_location,selected_strategy)
    on conflict(mission_id,location) do nothing;
  end loop;

  -- A system-only reference has no C1 location. Keep it visible for an
  -- operator to add the actual location without inventing a C1 observation.
  if not exists(select 1 from public.recount_mission_subtasks where mission_id=m.id) then
    insert into public.recount_mission_subtasks(mission_id,inventory_id,location,strategy,result_metadata)
    values(m.id,m.inventory_id,'TECHO',case r.reference_type when 'PARTIDA' then 'BATCH_LOCATION_RECOUNT'::public.recount_subtask_strategy when 'SERIAL' then 'TARGETED_SERIAL_SEARCH'::public.recount_subtask_strategy else 'LEGACY_LOCATION_RECOUNT'::public.recount_subtask_strategy end,jsonb_build_object('location_source','OPERATOR_DISCOVERY_REQUIRED'))
    on conflict(mission_id,location) do nothing;
  end if;
end
$function$;
revoke all on function app_private.ensure_recount_mission_subtasks(uuid) from public,anon,authenticated;

create or replace function app_private.recount_mission_json(p_mission_id uuid)
returns jsonb
language sql stable security definer
set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'id',m.id,'case_id',m.case_id,'inventory_id',m.inventory_id,'round',m.round,'status',m.status,
    'codigo',r.codigo,'descripcion',mi.descripcion,'reference_type',r.reference_type,'reference_value',r.reference_value,
    'known_locations',app_private.recount_case_locations(r.id),
    'subtasks',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',s.id,'location',s.location,'strategy',s.strategy,'status',s.status,'logistic_unit',s.logistic_unit,
          'counted_quantity',s.counted_quantity,'exception_reason',s.exception_reason,'created_at',s.created_at,
          'started_at',s.started_at,'completed_at',s.completed_at,
          'scanned_series_count',(select count(*)::integer from public.recount_subtask_serial_scans scan where scan.subtask_id=s.id),
          'recent_series',coalesce((select jsonb_agg(scan.serie order by scan.scanned_at desc) from (select serie,scanned_at from public.recount_subtask_serial_scans where subtask_id=s.id order by scanned_at desc limit 5) scan),'[]'::jsonb)
        ) order by case when s.location='TECHO' then 1 else 0 end,s.location
      )
      from public.recount_mission_subtasks s
      where s.mission_id=m.id
    ),'[]'::jsonb),
    'observations',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'client_count_id',c.client_count_id,'ubicacion',c.ubicacion,'cantidad',c.cantidad_contada,'captured_at',c.captured_at) order by c.captured_at,c.id) from public.recount_mission_observations o join public.count_records c on c.id=o.count_record_id where o.mission_id=m.id),'[]'::jsonb)
  )
  from public.recount_missions m
  join public.reconciliation_cases r on r.id=m.case_id
  join public.inventory_master_items mi on mi.inventory_id=r.inventory_id and mi.codigo=r.codigo
  where m.id=p_mission_id
$$;
revoke all on function app_private.recount_mission_json(uuid) from public,anon,authenticated;

create or replace function public.claim_next_recount_mission(p_inventory_id uuid)
returns jsonb
language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  actor uuid:=app_private.require_active_actor(); actor_role public.app_role; wanted_round integer;
  mission public.recount_missions; existing_id uuid; transitioned integer:=0;
begin
  if not app_private.can_access_inventory(p_inventory_id) then raise exception 'Not authorized for inventory' using errcode='42501'; end if;
  select role into actor_role from public.profiles where user_id=actor and active;
  wanted_round:=case when actor_role='CONTADOR' then 2 when actor_role in('ANALISTA','ADMIN') then 3 else null end;
  if wanted_round is null then raise exception 'Role does not admit recount missions' using errcode='42501'; end if;
  select id into existing_id from public.recount_missions where inventory_id=p_inventory_id and assigned_user_id=actor and status='ACTIVE' order by claimed_at,id limit 1;
  if existing_id is not null then perform app_private.ensure_recount_mission_subtasks(existing_id); return app_private.recount_mission_json(existing_id); end if;
  if not exists(select 1 from public.inventories where id=p_inventory_id and status='ABIERTO' and c1_completed_at is not null) then return null; end if;
  select m.* into mission from public.recount_missions m
  where m.inventory_id=p_inventory_id and m.round=wanted_round and m.status='QUEUED'
    and (wanted_round<>2 or not exists(select 1 from public.reconciliation_cases r join public.count_records c on c.inventory_id=r.inventory_id and c.codigo=r.codigo and ((r.reference_type='SERIAL' and coalesce(c.serie,'')=coalesce(r.reference_value,'')) or (r.reference_type='PARTIDA' and coalesce(c.partida,'')=coalesce(r.reference_value,'')) or r.reference_type='LEGACY') where r.id=m.case_id and c.user_id=actor and not exists(select 1 from public.recount_mission_observations o where o.count_record_id=c.id)))
  order by m.created_at,m.id for update skip locked limit 1;
  if mission.id is null then return null; end if;
  update public.recount_missions set assigned_user_id=actor,status='ACTIVE',claimed_at=now() where id=mission.id;
  update public.reconciliation_cases set status=case when wanted_round=2 then '2DO_CONTEO_ASIGNADO'::public.reconciliation_status else '3ER_CONTEO_ASIGNADO'::public.reconciliation_status end where id=mission.case_id and status=case when wanted_round=2 then 'REQUIERE_2DO_CONTEO'::public.reconciliation_status else 'REQUIERE_3ER_CONTEO'::public.reconciliation_status end;
  get diagnostics transitioned=row_count; if transitioned<>1 then raise exception 'Recount case state changed before mission claim' using errcode='40001'; end if;
  perform app_private.ensure_recount_mission_subtasks(mission.id);
  perform app_private.append_reconciliation_event(mission.case_id,p_inventory_id,case when wanted_round=2 then 'SECOND_ASSIGNED' else 'THIRD_ASSIGNED' end,actor,jsonb_build_object('mission_id',mission.id,'round',wanted_round,'assignment_mode','QUEUE_CLAIM','c2_version','2.0'));
  return app_private.recount_mission_json(mission.id);
end
$function$;

create or replace function public.start_my_recount_subtask(p_subtask_id uuid)
returns jsonb
language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare actor uuid:=app_private.require_active_actor(); s public.recount_mission_subtasks; m public.recount_missions;
begin
  select * into s from public.recount_mission_subtasks where id=p_subtask_id for update;
  if s.id is null then raise exception 'Recount subtask not found' using errcode='P0002'; end if;
  select * into m from public.recount_missions where id=s.mission_id;
  if m.id is null or m.status<>'ACTIVE' or m.assigned_user_id<>actor then raise exception 'Active recount mission is not assigned to actor' using errcode='42501'; end if;
  if s.status='PENDING' then update public.recount_mission_subtasks set status='ACTIVE',started_at=now() where id=s.id; end if;
  return app_private.recount_mission_json(m.id);
end
$function$;

create or replace function public.record_my_recount_subtask(
  p_subtask_id uuid,p_location text,p_quantity integer default null,p_serial text default null,p_batch text default null,p_logistic_unit text default null
)
returns jsonb
language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare actor uuid:=app_private.require_active_actor(); s public.recount_mission_subtasks; m public.recount_missions; r public.reconciliation_cases; normalized_serial text:=nullif(upper(btrim(p_serial)), '');
begin
  select s.* into s from public.recount_mission_subtasks s where s.id=p_subtask_id for update;
  select * into m from public.recount_missions where id=s.mission_id;
  select * into r from public.reconciliation_cases where id=m.case_id;
  if m.id is null or m.status<>'ACTIVE' or m.assigned_user_id<>actor then raise exception 'Active recount mission is not assigned to actor' using errcode='42501'; end if;
  if upper(btrim(p_location))<>s.location then raise exception 'Scanned location does not match the active subtask' using errcode='23514'; end if;
  if s.status not in('PENDING','ACTIVE') then raise exception 'Subtask is already completed' using errcode='23514'; end if;
  if s.strategy='SERIAL_SWEEP' then
    if normalized_serial is null or length(normalized_serial)>19 then raise exception 'A valid serial is required for sweep' using errcode='23514'; end if;
    insert into public.recount_subtask_serial_scans(subtask_id,serie,scanned_by) values(s.id,normalized_serial,actor);
    update public.recount_mission_subtasks set status='ACTIVE',started_at=coalesce(started_at,now()),logistic_unit=coalesce(nullif(btrim(p_logistic_unit),''),logistic_unit) where id=s.id;
  else
    if s.strategy='TARGETED_SERIAL_SEARCH' and normalized_serial is distinct from r.reference_value then raise exception 'Serial does not match the directed search' using errcode='23514'; end if;
    if s.strategy='BATCH_LOCATION_RECOUNT' and nullif(upper(btrim(p_batch)),'') is distinct from r.reference_value then raise exception 'Batch does not match the mission' using errcode='23514'; end if;
    if coalesce(p_quantity,0)<=0 then raise exception 'Positive quantity is required' using errcode='23514'; end if;
    update public.recount_mission_subtasks set status='COUNTED',counted_quantity=case when s.strategy='TARGETED_SERIAL_SEARCH' then 1 else p_quantity end,started_at=coalesce(started_at,now()),completed_at=now(),completed_by=actor,logistic_unit=coalesce(nullif(btrim(p_logistic_unit),''),logistic_unit) where id=s.id;
  end if;
  perform app_private.append_reconciliation_event(m.case_id,m.inventory_id,'C2_SUBTASK_RECORDED',actor,jsonb_build_object('mission_id',m.id,'subtask_id',s.id,'location',s.location,'strategy',s.strategy));
  return app_private.recount_mission_json(m.id);
end
$function$;

create or replace function public.finish_my_serial_sweep(p_subtask_id uuid)
returns jsonb
language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare actor uuid:=app_private.require_active_actor(); s public.recount_mission_subtasks; m public.recount_missions; scan_count integer;
begin
  select s.* into s from public.recount_mission_subtasks s where s.id=p_subtask_id for update;
  select * into m from public.recount_missions where id=s.mission_id;
  if m.id is null or m.status<>'ACTIVE' or m.assigned_user_id<>actor or s.strategy<>'SERIAL_SWEEP' then raise exception 'Active serial sweep is not assigned to actor' using errcode='42501'; end if;
  select count(*)::integer into scan_count from public.recount_subtask_serial_scans where subtask_id=s.id;
  if scan_count=0 then raise exception 'Serial sweep requires at least one scan; use zero confirmation when nothing was found' using errcode='23514'; end if;
  update public.recount_mission_subtasks set status='COUNTED',counted_quantity=scan_count,completed_at=now(),completed_by=actor where id=s.id;
  return app_private.recount_mission_json(m.id);
end
$function$;

create or replace function public.resolve_my_recount_subtask(p_subtask_id uuid,p_status public.recount_subtask_status,p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare actor uuid:=app_private.require_active_actor(); s public.recount_mission_subtasks; m public.recount_missions;
begin
  select * into s from public.recount_mission_subtasks where id=p_subtask_id for update; select * into m from public.recount_missions where id=s.mission_id;
  if m.id is null or m.status<>'ACTIVE' or m.assigned_user_id<>actor then raise exception 'Active recount mission is not assigned to actor' using errcode='42501'; end if;
  if p_status not in('ZERO_CONFIRMED','INACCESSIBLE','ESCALATED') then raise exception 'Unsupported subtask resolution' using errcode='22023'; end if;
  if p_status in('INACCESSIBLE','ESCALATED') and length(btrim(coalesce(p_reason,'')))<3 then raise exception 'A reason is required' using errcode='23514'; end if;
  update public.recount_mission_subtasks set status=p_status,counted_quantity=case when p_status='ZERO_CONFIRMED' then 0 else null end,exception_reason=case when p_status='ZERO_CONFIRMED' then null else btrim(p_reason) end,started_at=coalesce(started_at,now()),completed_at=now(),completed_by=actor where id=s.id;
  return app_private.recount_mission_json(m.id);
end
$function$;

create or replace function public.add_my_recount_location(p_mission_id uuid,p_location text,p_logistic_unit text default null)
returns jsonb
language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare actor uuid:=app_private.require_active_actor(); m public.recount_missions; r public.reconciliation_cases; strategy public.recount_subtask_strategy;
begin
  select * into m from public.recount_missions where id=p_mission_id for update; select * into r from public.reconciliation_cases where id=m.case_id;
  if m.id is null or m.status<>'ACTIVE' or m.assigned_user_id<>actor then raise exception 'Active recount mission is not assigned to actor' using errcode='42501'; end if;
  if upper(btrim(p_location)) !~ '^(TECHO|(A|B|C|C2|D|F|G|H|I)-[0-9]{2}-[0-9]{2})$' then raise exception 'Invalid location' using errcode='23514'; end if;
  strategy:=case r.reference_type when 'PARTIDA' then 'BATCH_LOCATION_RECOUNT'::public.recount_subtask_strategy when 'SERIAL' then 'SERIAL_SWEEP'::public.recount_subtask_strategy else 'LEGACY_LOCATION_RECOUNT'::public.recount_subtask_strategy end;
  insert into public.recount_mission_subtasks(mission_id,inventory_id,location,strategy,logistic_unit,result_metadata) values(m.id,m.inventory_id,upper(btrim(p_location)),strategy,nullif(btrim(p_logistic_unit),''),jsonb_build_object('discovered_by_operator',true)) on conflict(mission_id,location) do nothing;
  return app_private.recount_mission_json(m.id);
end
$function$;

create or replace function public.report_my_recount_finding(p_subtask_id uuid,p_finding public.recount_finding_type,p_note text default null)
returns void
language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare actor uuid:=app_private.require_active_actor(); s public.recount_mission_subtasks; m public.recount_missions;
begin
  select * into s from public.recount_mission_subtasks where id=p_subtask_id; select * into m from public.recount_missions where id=s.mission_id;
  if m.id is null or m.status<>'ACTIVE' or m.assigned_user_id<>actor then raise exception 'Active recount mission is not assigned to actor' using errcode='42501'; end if;
  insert into public.recount_subtask_findings(subtask_id,finding_type,note,created_by) values(s.id,p_finding,nullif(btrim(p_note),''),actor);
end
$function$;

create or replace function app_private.complete_recount_mission_internal(p_mission_id uuid,p_actor uuid,p_zero_confirmed boolean)
returns jsonb
language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare mission public.recount_missions; r public.reconciliation_cases; total integer:=0; completed_count integer:=0; review_required boolean:=false; c2_total integer; legacy_observation_count integer:=0; legacy_total integer:=0;
begin
  select * into mission from public.recount_missions where id=p_mission_id for update;
  if mission.id is null or mission.status<>'ACTIVE' or mission.assigned_user_id<>p_actor then raise exception 'Active recount mission is not assigned to actor' using errcode='42501'; end if;
  select * into r from public.reconciliation_cases where id=mission.case_id for update;
  perform app_private.ensure_recount_mission_subtasks(mission.id);
  select count(*)::integer,coalesce(sum(c.cantidad_contada),0)::integer
    into legacy_observation_count,legacy_total
  from public.recount_mission_observations o
  join public.count_records c on c.id=o.count_record_id
  where o.mission_id=mission.id;
  -- Compatibility bridge: an older offline C2 client may still have immutable
  -- observations attached by sync_counts. It can finish its already-assigned
  -- mission, but all new C2.0 work must explicitly resolve each subtask.
  if legacy_observation_count > 0 then
    completed_count:=legacy_observation_count;
    total:=legacy_total;
    review_required:=false;
  else
    if p_zero_confirmed then
      update public.recount_mission_subtasks
      set status='ZERO_CONFIRMED',counted_quantity=0,started_at=coalesce(started_at,now()),completed_at=now(),completed_by=p_actor
      where mission_id=mission.id and status in('PENDING','ACTIVE');
    end if;
    if exists(select 1 from public.recount_mission_subtasks where mission_id=mission.id and status in('PENDING','ACTIVE')) then raise exception 'Every location subtask must be resolved before finalizing' using errcode='23514'; end if;
    select count(*)::integer,coalesce(sum(case when status='COUNTED' then counted_quantity else 0 end),0)::integer,bool_or(status in('INACCESSIBLE','ESCALATED')) into completed_count,total,review_required from public.recount_mission_subtasks where mission_id=mission.id;
  end if;
  if p_zero_confirmed and total<>0 then raise exception 'Zero confirmation conflicts with completed subtask quantities' using errcode='23514'; end if;
  update public.recount_missions set status='COMPLETED',total_quantity=total,completed_at=now() where id=mission.id;
  if review_required then
    update public.reconciliation_cases set status='PENDIENTE_ANALISIS',confirmed_physical_quantity=null where id=r.id;
  elsif mission.round=2 and total<>r.physical_quantity then
    update public.reconciliation_cases set status='REQUIERE_3ER_CONTEO',confirmed_physical_quantity=null where id=r.id;
    insert into public.recount_missions(case_id,inventory_id,round,created_by) values(r.id,r.inventory_id,3,p_actor) on conflict(case_id,round) do nothing;
  elsif mission.round=3 then
    select total_quantity into c2_total from public.recount_missions where case_id=r.id and round=2 and status='COMPLETED';
    if total=r.physical_quantity then update public.reconciliation_cases set status='FISICO_CONFIRMADO',confirmed_physical_quantity=r.physical_quantity where id=r.id;
    elsif total=c2_total then update public.reconciliation_cases set status='FISICO_CONFIRMADO',confirmed_physical_quantity=c2_total where id=r.id;
    else update public.reconciliation_cases set status='PENDIENTE_ANALISIS',confirmed_physical_quantity=null where id=r.id; end if;
  else
    update public.reconciliation_cases set status='FISICO_CONFIRMADO',confirmed_physical_quantity=total where id=r.id;
  end if;
  perform app_private.append_reconciliation_event(r.id,r.inventory_id,case when mission.round=2 then 'SECOND_RECORDED' else 'THIRD_RECORDED' end,p_actor,jsonb_build_object('mission_id',mission.id,'round',mission.round,'subtask_count',completed_count,'total_quantity',total,'review_required',review_required));
  return jsonb_build_object('mission_id',mission.id,'round',mission.round,'total_quantity',total,'subtask_count',completed_count,'observation_count',completed_count,'case_id',r.id,'case_status',(select status::text from public.reconciliation_cases where id=r.id),'confirmed_physical_quantity',(select confirmed_physical_quantity from public.reconciliation_cases where id=r.id),'next_round',case when mission.round=2 and not review_required and total<>r.physical_quantity then 3 else null end,'review_required',review_required);
end
$function$;

create or replace function public.get_c2_execution_metrics(p_inventory_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,app_private,pg_temp
as $function$
begin
  perform app_private.require_active_actor(); if not app_private.can_manage_inventory(p_inventory_id) then raise exception 'Not authorized for C2 monitor' using errcode='42501'; end if;
  return (select jsonb_build_object('queued_missions',count(distinct m.id) filter(where m.round=2 and m.status='QUEUED'),'active_missions',count(distinct m.id) filter(where m.round=2 and m.status='ACTIVE'),'pending_subtasks',count(s.id) filter(where s.status='PENDING'),'completed_subtasks',count(s.id) filter(where s.status in('COUNTED','ZERO_CONFIRMED')),'serial_sweeps_active',count(s.id) filter(where s.strategy='SERIAL_SWEEP' and s.status='ACTIVE'),'targeted_searches',count(s.id) filter(where s.strategy='TARGETED_SERIAL_SEARCH'),'blocked',count(s.id) filter(where s.status='INACCESSIBLE'),'escalated',count(s.id) filter(where s.status='ESCALATED')) from public.recount_missions m left join public.recount_mission_subtasks s on s.mission_id=m.id where m.inventory_id=p_inventory_id);
end $function$;

alter table public.recount_mission_subtasks replica identity full;
alter table public.recount_subtask_serial_scans replica identity full;
alter table public.recount_subtask_findings replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.recount_mission_subtasks, public.recount_subtask_serial_scans, public.recount_subtask_findings;
exception when duplicate_object then null; end $$;

revoke all on function public.claim_next_recount_mission(uuid), public.start_my_recount_subtask(uuid), public.record_my_recount_subtask(uuid,text,integer,text,text,text), public.finish_my_serial_sweep(uuid), public.resolve_my_recount_subtask(uuid,public.recount_subtask_status,text), public.add_my_recount_location(uuid,text,text), public.report_my_recount_finding(uuid,public.recount_finding_type,text), public.get_c2_execution_metrics(uuid) from public,anon;
grant execute on function public.claim_next_recount_mission(uuid), public.start_my_recount_subtask(uuid), public.record_my_recount_subtask(uuid,text,integer,text,text,text), public.finish_my_serial_sweep(uuid), public.resolve_my_recount_subtask(uuid,public.recount_subtask_status,text), public.add_my_recount_location(uuid,text,text), public.report_my_recount_finding(uuid,public.recount_finding_type,text), public.get_c2_execution_metrics(uuid) to authenticated;
