-- LIVE-02: read-only operational monitor built on the F15/F16 mission model.
-- C1 evidence excludes recount observations: C2/C3 must never inflate stock.

create index if not exists count_records_live_monitor_received_idx
  on public.count_records (inventory_id, received_at desc, id desc);
create index if not exists recount_missions_live_monitor_status_idx
  on public.recount_missions (inventory_id, round, status, created_at desc, id desc);

create or replace function public.get_live_monitor_summary(p_inventory_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, app_private, pg_temp
as $$
begin
  perform app_private.require_active_actor();
  if not app_private.can_manage_inventory(p_inventory_id) then
    raise exception 'Not authorized for live monitor' using errcode = '42501';
  end if;
  if not exists (select 1 from public.inventories where id = p_inventory_id) then
    raise exception 'Inventory not found' using errcode = 'P0002';
  end if;

  return (
    with c1_counts as (
      select count(*)::integer as observations,
        count(distinct c.codigo)::integer as counted_skus,
        coalesce(sum(c.cantidad_contada), 0)::bigint as counted_units,
        max(c.received_at) as last_received_at
      from public.count_records c
      where c.inventory_id = p_inventory_id
        and not exists (select 1 from public.recount_mission_observations o where o.count_record_id = c.id)
    ), reference_summary as (
      select count(*)::integer as references,
        count(distinct s.codigo)::integer as reference_skus,
        coalesce(sum(coalesce(s.source_available_quantity, s.quantity)), 0)::bigint as available_units,
        coalesce(sum(s.source_total_quantity), 0)::bigint as source_total_units
      from public.inventory_system_reference_items s
      where s.inventory_id = p_inventory_id
    ), mission_summary as (
      select
        count(*) filter (where m.round = 2 and m.status = 'QUEUED')::integer as c2_pending,
        count(*) filter (where m.round = 2 and m.status = 'ACTIVE')::integer as c2_active,
        count(*) filter (where m.round = 2 and m.status = 'COMPLETED')::integer as c2_completed,
        count(*) filter (where m.round = 3 and m.status = 'QUEUED')::integer as c3_pending,
        count(*) filter (where m.round = 3 and m.status = 'ACTIVE')::integer as c3_active,
        count(*) filter (where m.round = 3 and m.status = 'COMPLETED')::integer as c3_completed,
        count(*) filter (where m.status = 'COMPLETED' and m.total_quantity = 0)::integer as confirmed_zero,
        count(*) filter (where r.status = 'FISICO_CONFIRMADO')::integer as physical_confirmed,
        count(*) filter (where r.status = 'RESUELTO')::integer as resolved
      from public.recount_missions m
      join public.reconciliation_cases r on r.id = m.case_id
      where m.inventory_id = p_inventory_id
    ), device_summary as (
      select count(*)::integer as known_devices,
        count(*) filter (where a.known_pending > 0)::integer as devices_with_pending,
        coalesce(sum(a.known_pending), 0)::integer as pending_records
      from app_private.inventory_device_activity a
      where a.inventory_id = p_inventory_id
    )
    select jsonb_build_object(
      'inventory', (select jsonb_build_object('id', i.id, 'name', i.name, 'status', i.status, 'c1_completed_at', i.c1_completed_at) from public.inventories i where i.id = p_inventory_id),
      'refreshed_at', now(),
      'counts', (select row_to_json(c1_counts)::jsonb from c1_counts),
      'reference', (select row_to_json(reference_summary)::jsonb from reference_summary),
      'missions', (select row_to_json(mission_summary)::jsonb from mission_summary),
      'devices', (select row_to_json(device_summary)::jsonb from device_summary)
    )
  );
end;
$$;

create or replace function public.get_live_monitor_coverage(
  p_inventory_id uuid,
  p_status text default 'TODOS',
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table(
  codigo text, descripcion text, reference_type public.master_control_type, reference_value text,
  unit_code text, expiration_date date, available_quantity integer, source_total_quantity integer,
  physical_quantity integer, observation_count integer, coverage_status text, last_received_at timestamptz
)
language plpgsql stable security definer
set search_path = public, app_private, pg_temp
as $$
declare
  lifecycle public.inventory_status;
  c1_completed boolean := false;
  normalized_status text := upper(coalesce(nullif(btrim(p_status), ''), 'TODOS'));
  normalized_search text := nullif(lower(btrim(p_search)), '');
begin
  perform app_private.require_active_actor();
  if not app_private.can_manage_inventory(p_inventory_id) then
    raise exception 'Not authorized for live monitor' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 200 then raise exception 'Live monitor limit must be between 1 and 200' using errcode = '22023'; end if;
  if p_offset < 0 then raise exception 'Live monitor offset cannot be negative' using errcode = '22023'; end if;
  select status, c1_completed_at is not null
  into lifecycle, c1_completed
  from public.inventories where id = p_inventory_id;
  if lifecycle is null then raise exception 'Inventory not found' using errcode = 'P0002'; end if;

  return query
  with c1_physical as (
    select c.codigo, m.control_type,
      case when m.control_type = 'SERIAL' then c.serie when m.control_type = 'PARTIDA' then c.partida else null end as reference_value,
      sum(c.cantidad_contada)::integer as quantity, count(*)::integer as observations,
      max(c.received_at) as last_received_at, max(c.fecha_vencimiento) as expiration_date
    from public.count_records c
    join public.inventory_master_items m on m.inventory_id = c.inventory_id and m.codigo = c.codigo
    where c.inventory_id = p_inventory_id
      and not exists (select 1 from public.recount_mission_observations o where o.count_record_id = c.id)
    group by c.codigo, m.control_type,
      case when m.control_type = 'SERIAL' then c.serie when m.control_type = 'PARTIDA' then c.partida else null end
  ), rows as (
    select coalesce(s.codigo, p.codigo) as codigo, coalesce(m.descripcion, 'Sin descripción') as descripcion,
      coalesce(s.reference_type, p.control_type) as reference_type,
      coalesce(s.reference_value, p.reference_value) as reference_value,
      s.unit_code, coalesce(s.expiration_date, p.expiration_date) as expiration_date,
      coalesce(s.source_available_quantity, s.quantity, 0)::integer as available_quantity,
      coalesce(s.source_total_quantity, 0)::integer as source_total_quantity,
      coalesce(p.quantity, 0)::integer as physical_quantity,
      coalesce(p.observations, 0)::integer as observation_count, p.last_received_at,
      case
        when s.codigo is null and coalesce(p.quantity, 0) > 0 and p.control_type = 'SERIAL' then 'SERIE_FISICA_NO_EN_SISTEMA'
        when s.codigo is null and coalesce(p.quantity, 0) > 0 and p.control_type = 'PARTIDA' then 'PARTIDA_FISICA_NO_EN_SISTEMA'
        when coalesce(s.source_available_quantity, s.quantity, 0) = 0 and coalesce(s.source_total_quantity, 0) > 0 and coalesce(p.quantity, 0) > 0 and s.reference_type = 'SERIAL' then 'SERIE_FUERA_DE_DISPONIBLE'
        when coalesce(s.source_available_quantity, s.quantity, 0) = 0 and coalesce(s.source_total_quantity, 0) > 0 and coalesce(p.quantity, 0) > 0 and s.reference_type = 'PARTIDA' then 'PARTIDA_FUERA_DE_DISPONIBLE'
        when coalesce(s.source_available_quantity, s.quantity, 0) > 0 and coalesce(p.quantity, 0) > 0 then 'CUBIERTA'
        when coalesce(s.source_available_quantity, s.quantity, 0) > 0 and not c1_completed then 'PENDIENTE_DE_COBERTURA'
        when coalesce(s.source_available_quantity, s.quantity, 0) > 0 and s.reference_type = 'SERIAL' then 'SERIE_SISTEMA_NO_CONTADA'
        when coalesce(s.source_available_quantity, s.quantity, 0) > 0 and s.reference_type = 'PARTIDA' then 'PARTIDA_SISTEMA_NO_CONTADA'
        when coalesce(s.source_available_quantity, s.quantity, 0) > 0 then 'SKU_SISTEMA_NO_CONTADO'
        else 'CUBIERTA'
      end as derived_coverage_status
    from public.inventory_system_reference_items s
    full join c1_physical p on p.codigo = s.codigo and p.control_type = s.reference_type
      and coalesce(p.reference_value, '') = coalesce(s.reference_value, '')
    left join public.inventory_master_items m on m.inventory_id = p_inventory_id and m.codigo = coalesce(s.codigo, p.codigo)
    where coalesce(s.inventory_id, p_inventory_id) = p_inventory_id
  )
  select r.codigo, r.descripcion, r.reference_type, r.reference_value, r.unit_code,
    r.expiration_date, r.available_quantity, r.source_total_quantity, r.physical_quantity,
    r.observation_count, r.derived_coverage_status, r.last_received_at
  from rows r
  where (normalized_status = 'TODOS' or r.derived_coverage_status = normalized_status)
    and (normalized_search is null or lower(r.codigo) like '%' || normalized_search || '%'
      or lower(r.descripcion) like '%' || normalized_search || '%'
      or lower(coalesce(r.reference_value, '')) like '%' || normalized_search || '%')
  order by r.codigo, r.reference_type, r.reference_value nulls first
  limit p_limit offset p_offset;
end;
$$;

-- Every recount count is attached to exactly one observation. This is the
-- authoritative C2/C3 stage marker; a case alone does not infer a stage.
create or replace function public.get_live_monitor_activity(
  p_inventory_id uuid,
  p_limit integer default 50,
  p_cursor_received_at timestamptz default null,
  p_cursor_id uuid default null,
  p_stage text default 'TODOS',
  p_search text default null
)
returns table(
  id uuid, stage text, event_type text, received_at timestamptz, captured_at timestamptz,
  display_name text, ubicacion text, codigo text, descripcion text, serie text, partida text,
  cantidad_contada integer, device_platform public.device_platform, inventory_status_at_receive public.inventory_status
)
language plpgsql stable security definer
set search_path = public, app_private, pg_temp
as $$
declare
  normalized_stage text := upper(coalesce(nullif(btrim(p_stage), ''), 'TODOS'));
  normalized_search text := nullif(lower(btrim(p_search)), '');
begin
  perform app_private.require_active_actor();
  if not app_private.can_manage_inventory(p_inventory_id) then
    raise exception 'Not authorized for live monitor' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 100 then raise exception 'Live monitor limit must be between 1 and 100' using errcode = '22023'; end if;
  if (p_cursor_received_at is null) is distinct from (p_cursor_id is null) then raise exception 'Cursor requires received_at and id together' using errcode = '22023'; end if;
  if normalized_stage not in ('TODOS', 'C1', 'C2', 'C3') then raise exception 'Unsupported monitor stage' using errcode = '22023'; end if;

  return query
  with events as (
    select c.id,
      case when m.round = 2 then 'C2' when m.round = 3 then 'C3' else 'C1' end as derived_stage,
      case when m.round = 2 then 'C2_OBSERVATION_RECEIVED' when m.round = 3 then 'C3_OBSERVATION_RECEIVED' else 'COUNT_RECEIVED' end as derived_event_type,
      c.received_at, c.captured_at, p.display_name, c.ubicacion, c.codigo, c.descripcion,
      c.serie, c.partida, c.cantidad_contada, d.platform, c.inventory_status_at_receive
    from public.count_records c
    join public.profiles p on p.user_id = c.user_id
    join public.sync_devices d on d.id = c.device_id
    left join public.recount_mission_observations o on o.count_record_id = c.id
    left join public.recount_missions m on m.id = o.mission_id and m.inventory_id = c.inventory_id
    where c.inventory_id = p_inventory_id
  )
  select e.id, e.derived_stage, e.derived_event_type, e.received_at, e.captured_at,
    e.display_name, e.ubicacion, e.codigo, e.descripcion, e.serie, e.partida,
    e.cantidad_contada, e.platform, e.inventory_status_at_receive
  from events e
  where (normalized_stage = 'TODOS' or e.derived_stage = normalized_stage)
    and (normalized_search is null or lower(e.codigo) like '%' || normalized_search || '%'
      or lower(e.descripcion) like '%' || normalized_search || '%'
      or lower(e.ubicacion) like '%' || normalized_search || '%'
      or lower(coalesce(e.serie, '')) like '%' || normalized_search || '%'
      or lower(coalesce(e.partida, '')) like '%' || normalized_search || '%')
    and (p_cursor_received_at is null or (e.received_at, e.id) < (p_cursor_received_at, p_cursor_id))
  order by e.received_at desc, e.id desc
  limit p_limit;
end;
$$;

create or replace function public.get_live_monitor_missions(
  p_inventory_id uuid,
  p_limit integer default 100
)
returns table(
  id uuid,
  round smallint,
  status text,
  created_at timestamptz,
  claimed_at timestamptz,
  completed_at timestamptz,
  codigo text,
  descripcion text,
  reference_type public.master_control_type,
  reference_value text,
  assigned_display_name text,
  observation_count integer,
  total_quantity integer,
  case_status text
)
language plpgsql stable security definer
set search_path = public, app_private, pg_temp
as $$
begin
  perform app_private.require_active_actor();
  if not app_private.can_manage_inventory(p_inventory_id) then
    raise exception 'Not authorized for live monitor' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 200 then
    raise exception 'Live monitor limit must be between 1 and 200' using errcode = '22023';
  end if;

  return query
  select m.id, m.round, m.status::text, m.created_at, m.claimed_at, m.completed_at,
    r.codigo, coalesce(mi.descripcion, 'Sin descripción'), r.reference_type, r.reference_value,
    p.display_name, count(o.id)::integer, m.total_quantity, r.status::text
  from public.recount_missions m
  join public.reconciliation_cases r on r.id = m.case_id
  left join public.inventory_master_items mi on mi.inventory_id = m.inventory_id and mi.codigo = r.codigo
  left join public.profiles p on p.user_id = m.assigned_user_id
  left join public.recount_mission_observations o on o.mission_id = m.id
  where m.inventory_id = p_inventory_id
  group by m.id, r.codigo, mi.descripcion, r.reference_type, r.reference_value, p.display_name, r.status
  order by case m.status when 'ACTIVE' then 0 when 'QUEUED' then 1 when 'COMPLETED' then 2 else 3 end,
    m.created_at desc, m.id desc
  limit p_limit;
end;
$$;

revoke all on function public.get_live_monitor_summary(uuid) from public, anon;
revoke all on function public.get_live_monitor_coverage(uuid, text, text, integer, integer) from public, anon;
revoke all on function public.get_live_monitor_activity(uuid, integer, timestamptz, uuid, text, text) from public, anon;
revoke all on function public.get_live_monitor_missions(uuid, integer) from public, anon;
grant execute on function public.get_live_monitor_summary(uuid) to authenticated;
grant execute on function public.get_live_monitor_coverage(uuid, text, text, integer, integer) to authenticated;
grant execute on function public.get_live_monitor_activity(uuid, integer, timestamptz, uuid, text, text) to authenticated;
grant execute on function public.get_live_monitor_missions(uuid, integer) to authenticated;
