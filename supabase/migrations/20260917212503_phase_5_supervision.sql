-- Fase 5: read models protected for operational supervision. No ERP stock,
-- no count mutations, and no new presence assertion are introduced here.
create index count_records_supervision_order_idx on public.count_records (inventory_id, captured_at desc, id desc);
create index count_records_supervision_codigo_idx on public.count_records (inventory_id, codigo, captured_at desc);
create index count_records_supervision_serie_idx on public.count_records (inventory_id, serie) where serie is not null;
create index count_records_supervision_partida_idx on public.count_records (inventory_id, partida) where partida is not null;
create index count_records_supervision_ubicacion_idx on public.count_records (inventory_id, ubicacion, captured_at desc);
create index sync_devices_supervision_user_idx on public.sync_devices (user_id, last_seen_at desc);

create function app_private.require_active_actor()
returns uuid language plpgsql stable security definer set search_path = public, app_private, pg_temp as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (select 1 from public.profiles where user_id = v_actor and active) then
    raise exception 'Active authentication is required' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

create function public.get_inventory_supervision(p_inventory_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app_private, pg_temp as $$
declare v_result jsonb;
begin
  perform app_private.require_active_actor();
  if not app_private.can_manage_inventory(p_inventory_id) then raise exception 'Not authorized for supervision' using errcode = '42501'; end if;
  if not exists (select 1 from public.inventories where id = p_inventory_id) then raise exception 'Inventory not found' using errcode = 'P0002'; end if;

  select jsonb_build_object(
    'inventory', (select jsonb_build_object('id', i.id, 'name', i.name, 'status', i.status) from public.inventories i where i.id = p_inventory_id),
    'summary', jsonb_build_object(
      'assigned_counters', (select count(*) from public.inventory_assignments a join public.profiles p on p.user_id = a.user_id where a.inventory_id = p_inventory_id and a.active and p.role = 'CONTADOR'),
      'received_counts', (select count(*) from public.count_records c where c.inventory_id = p_inventory_id),
      'counted_units', (select coalesce(sum(c.cantidad_contada), 0) from public.count_records c where c.inventory_id = p_inventory_id),
      'last_received_at', (select max(c.received_at) from public.count_records c where c.inventory_id = p_inventory_id),
      'known_devices', (select count(distinct d.id) from public.sync_devices d join public.inventory_assignments a on a.user_id = d.user_id where a.inventory_id = p_inventory_id and a.active),
      'known_pending', (select coalesce(sum(g.pending_count), 0) from public.inventory_freeze_guards g where g.inventory_id = p_inventory_id and g.resolved_at is null)
    ),
    'counters', coalesce((select jsonb_agg(row_to_json(x)::jsonb order by x.display_name) from (
      select p.user_id, p.display_name, p.role, p.active,
        max(c.captured_at) as last_captured_at, max(c.received_at) as last_received_at,
        count(c.id)::integer as received_counts, coalesce(sum(c.cantidad_contada), 0)::bigint as counted_units,
        (select count(*) from public.sync_devices d where d.user_id = p.user_id and d.active) as known_devices,
        (select max(d.last_seen_at) from public.sync_devices d where d.user_id = p.user_id and d.active) as last_seen_at,
        (select max(d.last_sync_at) from public.sync_devices d where d.user_id = p.user_id and d.active) as last_sync_at,
        (select coalesce(sum(g.pending_count), 0) from public.inventory_freeze_guards g join public.sync_devices d on d.id = g.device_id where g.inventory_id = p_inventory_id and g.resolved_at is null and d.user_id = p.user_id) as known_pending
      from public.inventory_assignments a join public.profiles p on p.user_id = a.user_id
      left join public.count_records c on c.inventory_id = p_inventory_id and c.user_id = p.user_id
      where a.inventory_id = p_inventory_id and a.active
      group by p.user_id, p.display_name, p.role, p.active
    ) x), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(row_to_json(y)::jsonb order by y.last_seen_at desc nulls last) from (
      select d.id, d.user_id, d.platform, d.app_version, d.last_seen_at, d.last_sync_at, d.active,
        coalesce((select sum(g.pending_count) from public.inventory_freeze_guards g where g.inventory_id = p_inventory_id and g.device_id = d.id and g.resolved_at is null), 0) as known_pending
      from public.sync_devices d where exists (select 1 from public.inventory_assignments a where a.inventory_id = p_inventory_id and a.user_id = d.user_id and a.active)
    ) y), '[]'::jsonb),
    'possible_duplicate_serials', coalesce((select jsonb_agg(row_to_json(z)::jsonb order by z.codigo, z.serie) from (
      select c.codigo, c.serie, count(*)::integer as observations from public.count_records c
      join public.inventory_master_items m on m.inventory_id = c.inventory_id and m.codigo = c.codigo
      where c.inventory_id = p_inventory_id and m.control_type = 'SERIAL' and c.serie is not null
      group by c.codigo, c.serie having count(*) > 1
    ) z), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create function public.search_inventory_counts(
  p_inventory_id uuid, p_limit integer default 50, p_cursor_captured_at timestamptz default null, p_cursor_id uuid default null,
  p_user_id uuid default null, p_codigo text default null, p_serie text default null, p_partida text default null, p_ubicacion text default null,
  p_captured_from date default null, p_captured_to date default null
)
returns table(id uuid, captured_at timestamptz, received_at timestamptz, user_id uuid, display_name text, ubicacion text, codigo text, descripcion text, serie text, partida text, cantidad_contada integer, device_id uuid, device_platform public.device_platform, inventory_status_at_receive public.inventory_status)
language plpgsql stable security definer set search_path = public, app_private, pg_temp as $$
begin
  perform app_private.require_active_actor();
  if not app_private.can_manage_inventory(p_inventory_id) then raise exception 'Not authorized for supervision' using errcode = '42501'; end if;
  if p_limit < 1 or p_limit > 100 then raise exception 'Limit must be between 1 and 100' using errcode = '23514'; end if;
  return query
  select c.id, c.captured_at, c.received_at, c.user_id, p.display_name, c.ubicacion, c.codigo, c.descripcion, c.serie, c.partida, c.cantidad_contada, c.device_id, d.platform, c.inventory_status_at_receive
  from public.count_records c join public.profiles p on p.user_id = c.user_id join public.sync_devices d on d.id = c.device_id
  where c.inventory_id = p_inventory_id
    and (p_user_id is null or c.user_id = p_user_id)
    and (p_codigo is null or c.codigo ilike '%' || replace(replace(btrim(p_codigo), '%', E'\\%'), '_', E'\\_') || '%' escape E'\\')
    and (p_serie is null or c.serie ilike '%' || replace(replace(btrim(p_serie), '%', E'\\%'), '_', E'\\_') || '%' escape E'\\')
    and (p_partida is null or c.partida ilike '%' || replace(replace(btrim(p_partida), '%', E'\\%'), '_', E'\\_') || '%' escape E'\\')
    and (p_ubicacion is null or c.ubicacion ilike '%' || replace(replace(btrim(p_ubicacion), '%', E'\\%'), '_', E'\\_') || '%' escape E'\\')
    and (p_captured_from is null or c.captured_at >= (p_captured_from::timestamp at time zone 'UTC'))
    and (p_captured_to is null or c.captured_at < ((p_captured_to + 1)::timestamp at time zone 'UTC'))
    and (p_cursor_captured_at is null or (c.captured_at, c.id) < (p_cursor_captured_at, coalesce(p_cursor_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by c.captured_at desc, c.id desc limit p_limit;
end;
$$;

create function public.get_my_count_summary(p_inventory_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app_private, pg_temp as $$
declare v_actor uuid := app_private.require_active_actor();
begin
  if not app_private.can_access_inventory(p_inventory_id) then raise exception 'Not authorized for inventory' using errcode = '42501'; end if;
  return (select jsonb_build_object('received_counts', count(*), 'counted_units', coalesce(sum(cantidad_contada), 0), 'last_captured_at', max(captured_at), 'pending_known', coalesce((select sum(g.pending_count) from public.inventory_freeze_guards g join public.sync_devices d on d.id = g.device_id where g.inventory_id = p_inventory_id and d.user_id = v_actor and g.resolved_at is null), 0)) from public.count_records where inventory_id = p_inventory_id and user_id = v_actor);
end;
$$;

revoke all on schema app_private from public, anon, authenticated;
revoke all on function app_private.require_active_actor() from public, anon, authenticated;
revoke all on function public.get_inventory_supervision(uuid), public.search_inventory_counts(uuid, integer, timestamptz, uuid, uuid, text, text, text, text, date, date), public.get_my_count_summary(uuid) from public, anon;
grant execute on function public.get_inventory_supervision(uuid), public.search_inventory_counts(uuid, integer, timestamptz, uuid, uuid, text, text, text, text, date, date), public.get_my_count_summary(uuid) to authenticated;
