-- F15 Recount Missions
-- A reconciliation case is one physical reference (SKU + batch/serial, or SKU for LEGACY).
-- Locations are observations inside a recount round, never independent reconciliation cases.

create type public.recount_mission_status as enum ('QUEUED','ACTIVE','COMPLETED','CANCELLED');

create table public.recount_missions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.reconciliation_cases(id) on delete restrict,
  inventory_id uuid not null references public.inventories(id) on delete restrict,
  round smallint not null check (round in (2,3)),
  assigned_user_id uuid references public.profiles(user_id) on delete restrict,
  status public.recount_mission_status not null default 'QUEUED',
  total_quantity integer check (total_quantity is null or total_quantity >= 0),
  claimed_at timestamptz,
  completed_at timestamptz,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(case_id,round),
  check (
    (status='QUEUED' and assigned_user_id is null and claimed_at is null and completed_at is null and total_quantity is null)
    or (status='ACTIVE' and assigned_user_id is not null and claimed_at is not null and completed_at is null and total_quantity is null)
    or (status='COMPLETED' and assigned_user_id is not null and claimed_at is not null and completed_at is not null and total_quantity is not null)
    or status='CANCELLED'
  )
);

create trigger recount_missions_set_updated_at
before update on public.recount_missions
for each row execute function public.set_updated_at();

create index recount_missions_inventory_queue_idx
  on public.recount_missions(inventory_id,round,status,created_at,id);

create table public.recount_mission_observations (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.recount_missions(id) on delete restrict,
  count_record_id uuid not null unique references public.count_records(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(mission_id,count_record_id)
);

create index recount_mission_observations_mission_idx
  on public.recount_mission_observations(mission_id,created_at,id);

alter table public.recount_missions enable row level security;
alter table public.recount_mission_observations enable row level security;
revoke all on public.recount_missions,public.recount_mission_observations from anon,authenticated;

create or replace function app_private.recount_case_locations(p_case_id uuid)
returns text[]
language sql stable security definer
set search_path=public,pg_temp
as $$
  select coalesce(array_agg(distinct c.ubicacion order by c.ubicacion),array[]::text[])
  from public.reconciliation_cases r
  join public.count_records c
    on c.inventory_id=r.inventory_id
   and c.codigo=r.codigo
   and (
      (r.reference_type='SERIAL' and coalesce(c.serie,'')=coalesce(r.reference_value,''))
      or (r.reference_type='PARTIDA' and coalesce(c.partida,'')=coalesce(r.reference_value,''))
      or (r.reference_type='LEGACY')
   )
  where r.id=p_case_id
    and not exists(
      select 1 from public.recount_mission_observations o
      where o.count_record_id=c.id
    )
$$;
revoke all on function app_private.recount_case_locations(uuid) from public,anon,authenticated;

create or replace function app_private.recount_mission_json(p_mission_id uuid)
returns jsonb
language sql stable security definer
set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'id',m.id,
    'case_id',m.case_id,
    'inventory_id',m.inventory_id,
    'round',m.round,
    'status',m.status,
    'codigo',r.codigo,
    'descripcion',mi.descripcion,
    'reference_type',r.reference_type,
    'reference_value',r.reference_value,
    'known_locations',app_private.recount_case_locations(r.id),
    'observations',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',o.id,
          'client_count_id',c.client_count_id,
          'ubicacion',c.ubicacion,
          'cantidad',c.cantidad_contada,
          'captured_at',c.captured_at
        )
        order by c.captured_at,c.id
      )
      from public.recount_mission_observations o
      join public.count_records c on c.id=o.count_record_id
      where o.mission_id=m.id
    ),'[]'::jsonb)
  )
  from public.recount_missions m
  join public.reconciliation_cases r on r.id=m.case_id
  join public.inventory_master_items mi on mi.inventory_id=r.inventory_id and mi.codigo=r.codigo
  where m.id=p_mission_id
$$;
revoke all on function app_private.recount_mission_json(uuid) from public,anon,authenticated;

create or replace function public.get_my_recount_queue(p_inventory_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path=public,app_private,pg_temp
as $$
declare
  actor uuid:=app_private.require_active_actor();
  actor_role public.app_role;
  active_id uuid;
  queue_round integer;
  queued integer:=0;
begin
  if not app_private.can_access_inventory(p_inventory_id) then
    raise exception 'Not authorized for inventory' using errcode='42501';
  end if;

  select role into actor_role from public.profiles where user_id=actor and active;
  queue_round:=case when actor_role='CONTADOR' then 2 when actor_role in ('ANALISTA','ADMIN') then 3 else null end;

  select m.id into active_id
  from public.recount_missions m
  where m.inventory_id=p_inventory_id
    and m.assigned_user_id=actor
    and m.status='ACTIVE'
  order by m.claimed_at,m.id
  limit 1;

  if queue_round is not null then
    select count(*)::integer into queued
    from public.recount_missions m
    where m.inventory_id=p_inventory_id
      and m.round=queue_round
      and m.status='QUEUED'
      and (
        queue_round<>2
        or not exists(
          select 1
          from public.reconciliation_cases r
          join public.count_records c
            on c.inventory_id=r.inventory_id
           and c.codigo=r.codigo
           and (
             (r.reference_type='SERIAL' and coalesce(c.serie,'')=coalesce(r.reference_value,''))
             or (r.reference_type='PARTIDA' and coalesce(c.partida,'')=coalesce(r.reference_value,''))
             or r.reference_type='LEGACY'
           )
          where r.id=m.case_id
            and c.user_id=actor
            and not exists(
              select 1 from public.recount_mission_observations o where o.count_record_id=c.id
            )
        )
      );
  end if;

  return jsonb_build_object(
    'inventory_id',p_inventory_id,
    'round',queue_round,
    'queued_count',queued,
    'active',case when active_id is null then null else app_private.recount_mission_json(active_id) end
  );
end;
$$;

create or replace function public.claim_next_recount_mission(p_inventory_id uuid)
returns jsonb
language plpgsql security definer
set search_path=public,app_private,pg_temp
as $$
declare
  actor uuid:=app_private.require_active_actor();
  actor_role public.app_role;
  wanted_round integer;
  mission public.recount_missions;
  existing_id uuid;
begin
  if not app_private.can_access_inventory(p_inventory_id) then
    raise exception 'Not authorized for inventory' using errcode='42501';
  end if;

  select role into actor_role from public.profiles where user_id=actor and active;
  wanted_round:=case when actor_role='CONTADOR' then 2 when actor_role in ('ANALISTA','ADMIN') then 3 else null end;
  if wanted_round is null then
    raise exception 'Role does not admit recount missions' using errcode='42501';
  end if;

  select id into existing_id
  from public.recount_missions
  where inventory_id=p_inventory_id and assigned_user_id=actor and status='ACTIVE'
  order by claimed_at,id
  limit 1;

  if existing_id is not null then
    return app_private.recount_mission_json(existing_id);
  end if;

  select m.* into mission
  from public.recount_missions m
  where m.inventory_id=p_inventory_id
    and m.round=wanted_round
    and m.status='QUEUED'
    and (
      wanted_round<>2
      or not exists(
        select 1
        from public.reconciliation_cases r
        join public.count_records c
          on c.inventory_id=r.inventory_id
         and c.codigo=r.codigo
         and (
           (r.reference_type='SERIAL' and coalesce(c.serie,'')=coalesce(r.reference_value,''))
           or (r.reference_type='PARTIDA' and coalesce(c.partida,'')=coalesce(r.reference_value,''))
           or r.reference_type='LEGACY'
         )
        where r.id=m.case_id
          and c.user_id=actor
          and not exists(
            select 1 from public.recount_mission_observations o where o.count_record_id=c.id
          )
      )
    )
  order by m.created_at,m.id
  for update skip locked
  limit 1;

  if mission.id is null then
    return null;
  end if;

  update public.recount_missions
  set assigned_user_id=actor,status='ACTIVE',claimed_at=now()
  where id=mission.id;

  if wanted_round=2 then
    update public.reconciliation_cases
    set status='2DO_CONTEO_ASIGNADO',assigned_second_user_id=actor
    where id=mission.case_id and status='REQUIERE_2DO_CONTEO';
  else
    update public.reconciliation_cases
    set status='3ER_CONTEO_ASIGNADO',assigned_third_analyst_id=actor
    where id=mission.case_id and status='REQUIERE_3ER_CONTEO';
  end if;

  insert into public.audit_events(inventory_id,actor_user_id,event_type,entity_type,entity_id,payload)
  values(
    p_inventory_id,actor,'RECOUNT_ASSIGNED','recount_mission',mission.id,
    jsonb_build_object('case_id',mission.case_id,'round',wanted_round,'assignment_mode','QUEUE_CLAIM')
  );

  return app_private.recount_mission_json(mission.id);
end;
$$;

create or replace function public.add_my_recount_observation(p_mission_id uuid,p_client_count_id uuid)
returns jsonb
language plpgsql security definer
set search_path=public,app_private,pg_temp
as $$
declare
  actor uuid:=app_private.require_active_actor();
  mission public.recount_missions;
  r public.reconciliation_cases;
  c public.count_records;
begin
  select * into mission from public.recount_missions where id=p_mission_id for update;
  if mission.id is null or mission.status<>'ACTIVE' or mission.assigned_user_id<>actor then
    raise exception 'Active recount mission is not assigned to actor' using errcode='42501';
  end if;

  select * into r from public.reconciliation_cases where id=mission.case_id;
  select * into c
  from public.count_records
  where inventory_id=mission.inventory_id and user_id=actor and client_count_id=p_client_count_id;

  if c.id is null or c.codigo<>r.codigo then
    raise exception 'Confirmed recount observation not found' using errcode='23514';
  end if;
  if r.reference_type='SERIAL' and coalesce(c.serie,'')<>coalesce(r.reference_value,'') then
    raise exception 'Serial does not match recount mission' using errcode='23514';
  end if;
  if r.reference_type='PARTIDA' and coalesce(c.partida,'')<>coalesce(r.reference_value,'') then
    raise exception 'Batch does not match recount mission' using errcode='23514';
  end if;
  if exists(select 1 from public.recount_mission_observations where count_record_id=c.id) then
    raise exception 'Count record already belongs to a recount mission' using errcode='23505';
  end if;

  insert into public.recount_mission_observations(mission_id,count_record_id)
  values(mission.id,c.id);

  insert into public.audit_events(inventory_id,actor_user_id,device_id,event_type,entity_type,entity_id,payload)
  values(
    mission.inventory_id,actor,c.device_id,'RECOUNT_OBSERVATION_ADDED','recount_mission',mission.id,
    jsonb_build_object('case_id',mission.case_id,'round',mission.round,'count_record_id',c.id,'ubicacion',c.ubicacion)
  );

  return app_private.recount_mission_json(mission.id);
end;
$$;

create or replace function public.complete_my_recount_mission(p_mission_id uuid)
returns jsonb
language plpgsql security definer
set search_path=public,app_private,pg_temp
as $$
declare
  actor uuid:=app_private.require_active_actor();
  mission public.recount_missions;
  r public.reconciliation_cases;
  total integer;
  observations integer;
  next_mission_id uuid;
begin
  select * into mission from public.recount_missions where id=p_mission_id for update;
  if mission.id is null or mission.status<>'ACTIVE' or mission.assigned_user_id<>actor then
    raise exception 'Active recount mission is not assigned to actor' using errcode='42501';
  end if;

  select * into r from public.reconciliation_cases where id=mission.case_id for update;

  select count(*)::integer,coalesce(sum(c.cantidad_contada),0)::integer
  into observations,total
  from public.recount_mission_observations o
  join public.count_records c on c.id=o.count_record_id
  where o.mission_id=mission.id;

  if observations=0 then
    raise exception 'Recount mission requires at least one physical observation' using errcode='23514';
  end if;

  update public.recount_missions
  set status='COMPLETED',total_quantity=total,completed_at=now()
  where id=mission.id;

  if mission.round=2 then
    if total=r.physical_quantity then
      update public.reconciliation_cases
      set status='FISICO_CONFIRMADO',confirmed_physical_quantity=total
      where id=r.id;
    else
      update public.reconciliation_cases
      set status='REQUIERE_3ER_CONTEO',confirmed_physical_quantity=null
      where id=r.id;

      insert into public.recount_missions(case_id,inventory_id,round,created_by)
      values(r.id,r.inventory_id,3,actor)
      on conflict(case_id,round) do nothing
      returning id into next_mission_id;
    end if;
  else
    update public.reconciliation_cases
    set status='FISICO_CONFIRMADO',confirmed_physical_quantity=total
    where id=r.id;
  end if;

  insert into public.audit_events(inventory_id,actor_user_id,event_type,entity_type,entity_id,payload)
  values(
    mission.inventory_id,actor,'RECOUNT_RECORDED','recount_mission',mission.id,
    jsonb_build_object(
      'case_id',mission.case_id,
      'round',mission.round,
      'observation_count',observations,
      'total_quantity',total,
      'c1_total',r.physical_quantity,
      'next_round',case when mission.round=2 and total<>r.physical_quantity then 3 else null end
    )
  );

  return jsonb_build_object(
    'mission_id',mission.id,
    'round',mission.round,
    'total_quantity',total,
    'observation_count',observations,
    'case_id',r.id,
    'case_status',(select status from public.reconciliation_cases where id=r.id),
    'confirmed_physical_quantity',(select confirmed_physical_quantity from public.reconciliation_cases where id=r.id),
    'next_round',case when mission.round=2 and total<>r.physical_quantity then 3 else null end
  );
end;
$$;

-- Materialize only references that have actually been physically observed while the
-- inventory remains ABIERTO. An untouched Softland reference is not a discrepancy
-- until inventory coverage is explicitly completed.
create or replace function public.materialize_reconciliation_cases(p_inventory_id uuid)
returns table(created_count integer,existing_count integer,source_fingerprint text)
language plpgsql security definer
set search_path=public,app_private,pg_temp
as $$
declare
  actor uuid:=app_private.require_active_actor();
  fp text;
  made integer:=0;
  existed integer:=0;
begin
  if not app_private.can_manage_inventory(p_inventory_id) then
    raise exception 'Not authorized for reconciliation materialization' using errcode='42501';
  end if;
  if not exists(select 1 from public.inventories where id=p_inventory_id and status='ABIERTO') then
    raise exception 'Reconciliation materialization requires an open inventory' using errcode='23514';
  end if;

  select fingerprint into fp
  from public.inventory_system_reference_metadata
  where inventory_id=p_inventory_id;
  if fp is null then
    raise exception 'System reference snapshot is required' using errcode='23514';
  end if;

  with physical_base as (
    select
      c.*,
      m.control_type,
      case when m.control_type='SERIAL' then c.serie when m.control_type='PARTIDA' then c.partida else null end reference_value
    from public.count_records c
    join public.inventory_master_items m on m.inventory_id=c.inventory_id and m.codigo=c.codigo
    where c.inventory_id=p_inventory_id
      and not exists(
        select 1 from public.recount_mission_observations o where o.count_record_id=c.id
      )
  ), physical as (
    select
      codigo,
      control_type,
      reference_value,
      sum(cantidad_contada)::integer quantity,
      count(*)::integer observation_count,
      (array_agg(id order by received_at,captured_at,created_at,id))[1] first_count_record_id
    from physical_base
    group by codigo,control_type,reference_value
  ), joined as (
    select
      coalesce(s.codigo,p.codigo) codigo,
      coalesce(s.reference_type,p.control_type) reference_type,
      coalesce(s.reference_value,p.reference_value) reference_value,
      coalesce(s.quantity,0) system_quantity,
      coalesce(p.quantity,0) physical_quantity,
      coalesce(p.observation_count,0) physical_observation_count,
      p.first_count_record_id
    from public.inventory_system_reference_items s
    full join physical p
      on p.codigo=s.codigo
     and p.control_type=s.reference_type
     and coalesce(p.reference_value,'')=coalesce(s.reference_value,'')
    where coalesce(s.inventory_id,p_inventory_id)=p_inventory_id
  ), anomalies as (
    select j.*,'DUPLICADO_SERIE'::text anomaly_type
    from joined j
    where j.reference_type='SERIAL' and j.physical_observation_count>1

    union all
    select j.*,'SERIE_FISICA_NO_EN_SISTEMA'
    from joined j
    where j.reference_type='SERIAL' and j.system_quantity=0 and j.physical_quantity>0

    union all
    select j.*,'PARTIDA_FISICA_NO_EN_SISTEMA'
    from joined j
    where j.reference_type='PARTIDA' and j.system_quantity=0 and j.physical_quantity>0

    union all
    select j.*,'DIFERENCIA_CANTIDAD_PARTIDA'
    from joined j
    where j.reference_type='PARTIDA'
      and j.system_quantity>0
      and j.physical_quantity>0
      and j.system_quantity<>j.physical_quantity

    union all
    select j.*,'DIFERENCIA_CANTIDAD_SKU'
    from joined j
    where j.reference_type='LEGACY'
      and j.physical_quantity>0
      and j.system_quantity<>j.physical_quantity
  ), ins as (
    insert into public.reconciliation_cases(
      inventory_id,codigo,reference_type,reference_value,anomaly_type,
      system_quantity,physical_quantity,status,first_count_record_id,created_by,source_fingerprint
    )
    select
      p_inventory_id,codigo,reference_type,reference_value,anomaly_type,
      system_quantity,physical_quantity,'REQUIERE_2DO_CONTEO',first_count_record_id,actor,fp
    from anomalies
    on conflict do nothing
    returning id
  )
  select count(*)::integer into made from ins;

  insert into public.recount_missions(case_id,inventory_id,round,created_by)
  select rc.id,rc.inventory_id,2,actor
  from public.reconciliation_cases rc
  where rc.inventory_id=p_inventory_id
    and rc.source_fingerprint=fp
    and rc.status='REQUIERE_2DO_CONTEO'
    and rc.first_count_record_id is not null
  on conflict(case_id,round) do nothing;

  select count(*)::integer into existed
  from public.reconciliation_cases rc
  where rc.inventory_id=p_inventory_id
    and rc.source_fingerprint=fp
    and rc.status<>'RESUELTO';

  insert into public.audit_events(inventory_id,actor_user_id,event_type,entity_type,entity_id,payload)
  values(
    p_inventory_id,actor,'MASTER_IMPORTED','reconciliation_materialization',p_inventory_id,
    jsonb_build_object(
      'source_fingerprint',fp,
      'created_count',made,
      'open_case_count',existed,
      'mode','OBSERVED_REFERENCES_ONLY',
      'recount_mode','MISSION_QUEUE'
    )
  );

  created_count:=made;
  existing_count:=existed;
  source_fingerprint:=fp;
  return next;
end;
$$;

-- Live reconciliation must ignore C2/C3 observations when calculating the original C1 total.
create or replace function public.get_live_reconciliation_workspace(
  p_inventory_id uuid,
  p_search text default null,
  p_status text default 'TODOS',
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  result jsonb;
  normalized_search text:=nullif(lower(btrim(p_search)), '');
  normalized_status text:=upper(coalesce(nullif(btrim(p_status),''),'TODOS'));
begin
  perform app_private.require_active_actor();
  if not app_private.can_manage_inventory(p_inventory_id) then raise exception 'Not authorized for live reconciliation' using errcode='42501'; end if;
  if p_limit<1 or p_limit>200 then raise exception 'Live reconciliation limit must be between 1 and 200' using errcode='22023'; end if;
  if not exists(select 1 from public.inventory_system_reference_metadata where inventory_id=p_inventory_id) then raise exception 'System reference snapshot is required' using errcode='23514'; end if;

  with physical as (
    select c.codigo,m.control_type,
      case when m.control_type='SERIAL' then c.serie when m.control_type='PARTIDA' then c.partida else null end reference_value,
      sum(c.cantidad_contada)::integer quantity,
      max(c.received_at) last_received_at,
      max(c.fecha_vencimiento) expiration_date
    from public.count_records c
    join public.inventory_master_items m on m.inventory_id=c.inventory_id and m.codigo=c.codigo
    where c.inventory_id=p_inventory_id
      and not exists(
        select 1
        from public.recount_mission_observations o
        where o.count_record_id=c.id
      )
    group by c.codigo,m.control_type,
      case when m.control_type='SERIAL' then c.serie when m.control_type='PARTIDA' then c.partida else null end
  ), rows as (
    select coalesce(s.codigo,p.codigo) codigo,
      coalesce(m.descripcion,'Sin descripción') descripcion,
      coalesce(s.unit_code,'—') unit_code,
      coalesce(s.reference_type,p.control_type) reference_type,
      coalesce(s.reference_value,p.reference_value) reference_value,
      coalesce(s.expiration_date,p.expiration_date) expiration_date,
      coalesce(s.quantity,0) available_quantity,
      coalesce(p.quantity,0) counted_quantity,
      p.last_received_at,
      case when s.codigo is null and coalesce(p.quantity,0)>0 then 'NUEVO_LOTE_SERIE'
           when coalesce(s.quantity,0)=0 and s.source_total_quantity>0 and coalesce(p.quantity,0)>0 then 'FUERA_DE_DISPONIBLE'
           when coalesce(s.expiration_date,p.expiration_date) is distinct from p.expiration_date and p.expiration_date is not null then 'VENCIMIENTO_DISTINTO'
           when coalesce(s.quantity,0)=coalesce(p.quantity,0) then 'CUADRADO'
           else 'DIFERENCIA' end status
    from public.inventory_system_reference_items s
    full join physical p
      on p.codigo=s.codigo
     and p.control_type=s.reference_type
     and coalesce(p.reference_value,'')=coalesce(s.reference_value,'')
    left join public.inventory_master_items m
      on m.inventory_id=p_inventory_id and m.codigo=coalesce(s.codigo,p.codigo)
    where coalesce(s.inventory_id,p_inventory_id)=p_inventory_id
  ), filtered as (
    select *
    from rows
    where (
      normalized_search is null
      or lower(codigo) like '%'||normalized_search||'%'
      or lower(descripcion) like '%'||normalized_search||'%'
      or lower(coalesce(reference_value,'')) like '%'||normalized_search||'%'
    )
      and (normalized_status='TODOS' or status=normalized_status)
  ), metrics as (
    select count(distinct codigo)::integer total_skus,
      count(distinct codigo) filter(where counted_quantity>0)::integer counted_skus,
      count(*) filter(where status='CUADRADO')::integer matched_items,
      count(*) filter(where status='DIFERENCIA')::integer difference_items,
      count(*) filter(where status='NUEVO_LOTE_SERIE')::integer new_references,
      count(*) filter(where status='FUERA_DE_DISPONIBLE')::integer non_available_items,
      coalesce(sum(available_quantity),0)::bigint available_units,
      coalesce(sum(counted_quantity),0)::bigint counted_units
    from rows
  )
  select jsonb_build_object(
    'inventory_id',p_inventory_id,
    'refreshed_at',now(),
    'metrics',(select jsonb_build_object(
      'total_skus',total_skus,
      'counted_skus',counted_skus,
      'matched_items',matched_items,
      'difference_items',difference_items,
      'new_references',new_references,
      'non_available_items',non_available_items,
      'available_units',available_units,
      'counted_units',counted_units,
      'difference_units',counted_units-available_units
    ) from metrics),
    'rows',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'codigo',codigo,
          'descripcion',descripcion,
          'unit_code',unit_code,
          'reference_type',reference_type,
          'reference_value',reference_value,
          'expiration_date',expiration_date,
          'available_quantity',available_quantity,
          'counted_quantity',counted_quantity,
          'difference_quantity',counted_quantity-available_quantity,
          'status',status,
          'last_received_at',last_received_at
        )
        order by codigo,reference_value nulls first
      )
      from (
        select * from filtered
        order by codigo,reference_value nulls first
        limit p_limit
      ) page
    ),'[]'::jsonb)
  ) into result;

  return result;
end
$function$;

revoke all on function public.get_my_recount_queue(uuid),
  public.claim_next_recount_mission(uuid),
  public.add_my_recount_observation(uuid,uuid),
  public.complete_my_recount_mission(uuid),
  public.materialize_reconciliation_cases(uuid),
  public.get_live_reconciliation_workspace(uuid,text,text,integer)
from public,anon;

grant execute on function public.get_my_recount_queue(uuid),
  public.claim_next_recount_mission(uuid),
  public.add_my_recount_observation(uuid,uuid),
  public.complete_my_recount_mission(uuid),
  public.materialize_reconciliation_cases(uuid),
  public.get_live_reconciliation_workspace(uuid,text,text,integer)
to authenticated;
