-- Fase 5 corrective migration: activity is evidence for one inventory/device,
-- never an inference from another inventory assigned to the same user.
create table app_private.inventory_device_activity (
  inventory_id uuid not null references public.inventories(id) on delete restrict,
  device_id uuid not null,
  user_id uuid not null,
  last_seen_at timestamptz not null,
  last_sync_at timestamptz not null,
  known_pending integer not null default 0 check (known_pending >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (inventory_id, device_id),
  foreign key (device_id, user_id) references public.sync_devices(id, user_id) on delete restrict
);
alter table app_private.inventory_device_activity enable row level security;
create index inventory_device_activity_inventory_user_idx on app_private.inventory_device_activity (inventory_id, user_id, last_seen_at desc);

-- Backfill accepted counts and currently-open guards. This migration is forward-only
-- and does not invent evidence for a device that has never acted in an inventory.
insert into app_private.inventory_device_activity (inventory_id, device_id, user_id, last_seen_at, last_sync_at, known_pending)
select c.inventory_id, c.device_id, c.user_id, max(c.received_at), max(c.received_at), 0
from public.count_records c
group by c.inventory_id, c.device_id, c.user_id
on conflict (inventory_id, device_id) do nothing;

insert into app_private.inventory_device_activity (inventory_id, device_id, user_id, last_seen_at, last_sync_at, known_pending)
select g.inventory_id, g.device_id, d.user_id, g.reported_at, g.reported_at, g.pending_count
from public.inventory_freeze_guards g
join public.sync_devices d on d.id = g.device_id
where g.resolved_at is null
on conflict (inventory_id, device_id) do update
set last_seen_at = greatest(app_private.inventory_device_activity.last_seen_at, excluded.last_seen_at),
    last_sync_at = greatest(app_private.inventory_device_activity.last_sync_at, excluded.last_sync_at),
    known_pending = excluded.known_pending,
    updated_at = now();

create function app_private.record_inventory_device_count_activity()
returns trigger language plpgsql security definer set search_path = public, app_private, pg_temp as $$
begin
  insert into app_private.inventory_device_activity (inventory_id, device_id, user_id, last_seen_at, last_sync_at, known_pending)
  values (new.inventory_id, new.device_id, new.user_id, new.received_at, new.received_at, 0)
  on conflict (inventory_id, device_id) do update
  set user_id = excluded.user_id,
      last_seen_at = greatest(app_private.inventory_device_activity.last_seen_at, excluded.last_seen_at),
      last_sync_at = greatest(app_private.inventory_device_activity.last_sync_at, excluded.last_sync_at),
      updated_at = now();
  return new;
end;
$$;
create trigger count_records_record_inventory_device_activity
after insert on public.count_records
for each row execute function app_private.record_inventory_device_count_activity();

-- report_device_sync_state is already the protected, inventory-aware Fase 4
-- operation. It is the sole writer of pending state in this read-support model.
create or replace function public.report_device_sync_state(
  p_inventory_id uuid,
  p_device_id uuid,
  p_pending_count integer
)
returns void language plpgsql security definer set search_path = public, app_private, pg_temp as $$
declare v_actor_id uuid := auth.uid(); v_now timestamptz := now();
begin
  if v_actor_id is null or not exists (select 1 from public.profiles where user_id = v_actor_id and active) then raise exception 'Active authentication is required' using errcode = '42501'; end if;
  if p_pending_count < 0 then raise exception 'Pending count cannot be negative' using errcode = '23514'; end if;
  if not app_private.can_access_inventory(p_inventory_id) then raise exception 'Not authorized for inventory' using errcode = '42501'; end if;
  if not exists (select 1 from public.sync_devices where id = p_device_id and user_id = v_actor_id and active) then raise exception 'Device registration is not owned by the user' using errcode = '42501'; end if;

  update public.sync_devices set last_seen_at = v_now where id = p_device_id;
  if p_pending_count > 0 then
    insert into public.inventory_freeze_guards (inventory_id, device_id, pending_count, reported_at, resolved_at)
    values (p_inventory_id, p_device_id, p_pending_count, v_now, null)
    on conflict (inventory_id, device_id) where resolved_at is null
    do update set pending_count = excluded.pending_count, reported_at = excluded.reported_at;
  else
    update public.inventory_freeze_guards set resolved_at = coalesce(resolved_at, v_now), reported_at = v_now
    where inventory_id = p_inventory_id and device_id = p_device_id and resolved_at is null;
  end if;
  insert into app_private.inventory_device_activity (inventory_id, device_id, user_id, last_seen_at, last_sync_at, known_pending)
  values (p_inventory_id, p_device_id, v_actor_id, v_now, v_now, p_pending_count)
  on conflict (inventory_id, device_id) do update
  set user_id = excluded.user_id, last_seen_at = excluded.last_seen_at, last_sync_at = excluded.last_sync_at,
      known_pending = excluded.known_pending, updated_at = v_now;
end;
$$;

create or replace function public.get_inventory_supervision(p_inventory_id uuid)
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
      'known_devices', (select count(*) from app_private.inventory_device_activity a where a.inventory_id = p_inventory_id),
      'known_pending', (select coalesce(sum(a.known_pending), 0) from app_private.inventory_device_activity a where a.inventory_id = p_inventory_id)
    ),
    'counters', coalesce((select jsonb_agg(row_to_json(x)::jsonb order by x.display_name) from (
      select p.user_id, p.display_name, p.role, p.active,
        max(c.captured_at) as last_captured_at, max(c.received_at) as last_received_at,
        count(c.id)::integer as received_counts, coalesce(sum(c.cantidad_contada), 0)::bigint as counted_units,
        coalesce((select count(*) from app_private.inventory_device_activity a where a.inventory_id = p_inventory_id and a.user_id = p.user_id), 0) as known_devices,
        (select max(a.last_seen_at) from app_private.inventory_device_activity a where a.inventory_id = p_inventory_id and a.user_id = p.user_id) as last_seen_at,
        (select max(a.last_sync_at) from app_private.inventory_device_activity a where a.inventory_id = p_inventory_id and a.user_id = p.user_id) as last_sync_at,
        coalesce((select sum(a.known_pending) from app_private.inventory_device_activity a where a.inventory_id = p_inventory_id and a.user_id = p.user_id), 0) as known_pending
      from public.inventory_assignments a join public.profiles p on p.user_id = a.user_id
      left join public.count_records c on c.inventory_id = p_inventory_id and c.user_id = p.user_id
      where a.inventory_id = p_inventory_id and a.active
      group by p.user_id, p.display_name, p.role, p.active
    ) x), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(row_to_json(y)::jsonb order by y.last_seen_at desc nulls last) from (
      select a.device_id as id, a.user_id, d.platform, d.app_version, a.last_seen_at, a.last_sync_at, d.active, a.known_pending
      from app_private.inventory_device_activity a join public.sync_devices d on d.id = a.device_id and d.user_id = a.user_id
      where a.inventory_id = p_inventory_id
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

create or replace function public.get_my_count_summary(p_inventory_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app_private, pg_temp as $$
declare v_actor uuid := app_private.require_active_actor();
begin
  if not app_private.can_access_inventory(p_inventory_id) then raise exception 'Not authorized for inventory' using errcode = '42501'; end if;
  return (select jsonb_build_object('received_counts', count(*), 'counted_units', coalesce(sum(cantidad_contada), 0), 'last_captured_at', max(captured_at),
    'pending_known', coalesce((select sum(a.known_pending) from app_private.inventory_device_activity a where a.inventory_id = p_inventory_id and a.user_id = v_actor), 0))
    from public.count_records where inventory_id = p_inventory_id and user_id = v_actor);
end;
$$;

drop function public.search_inventory_counts(uuid, integer, timestamptz, uuid, uuid, text, text, text, text, date, date);
create function public.search_inventory_counts(
  p_inventory_id uuid, p_limit integer default 50, p_cursor_captured_at timestamptz default null, p_cursor_id uuid default null,
  p_user_id uuid default null, p_codigo text default null, p_serie text default null, p_partida text default null, p_ubicacion text default null,
  p_captured_from timestamptz default null, p_captured_to_exclusive timestamptz default null
)
returns table(id uuid, captured_at timestamptz, received_at timestamptz, user_id uuid, display_name text, ubicacion text, codigo text, descripcion text, serie text, partida text, cantidad_contada integer, device_id uuid, device_platform public.device_platform, inventory_status_at_receive public.inventory_status)
language plpgsql stable security definer set search_path = public, app_private, pg_temp as $$
begin
  perform app_private.require_active_actor();
  if not app_private.can_manage_inventory(p_inventory_id) then raise exception 'Not authorized for supervision' using errcode = '42501'; end if;
  if p_limit < 1 or p_limit > 100 then raise exception 'Limit must be between 1 and 100' using errcode = '23514'; end if;
  if (p_cursor_captured_at is null) is distinct from (p_cursor_id is null) then raise exception 'Cursor requires captured_at and id together' using errcode = '23514'; end if;
  if p_captured_from is not null and p_captured_to_exclusive is not null and p_captured_to_exclusive <= p_captured_from then raise exception 'Captured range must be increasing' using errcode = '23514'; end if;
  return query
  select c.id, c.captured_at, c.received_at, c.user_id, p.display_name, c.ubicacion, c.codigo, c.descripcion, c.serie, c.partida, c.cantidad_contada, c.device_id, d.platform, c.inventory_status_at_receive
  from public.count_records c join public.profiles p on p.user_id = c.user_id join public.sync_devices d on d.id = c.device_id
  where c.inventory_id = p_inventory_id
    and (p_user_id is null or c.user_id = p_user_id)
    and (p_codigo is null or c.codigo ilike '%' || replace(replace(btrim(p_codigo), '%', E'\\%'), '_', E'\\_') || '%' escape E'\\')
    and (p_serie is null or c.serie ilike '%' || replace(replace(btrim(p_serie), '%', E'\\%'), '_', E'\\_') || '%' escape E'\\')
    and (p_partida is null or c.partida ilike '%' || replace(replace(btrim(p_partida), '%', E'\\%'), '_', E'\\_') || '%' escape E'\\')
    and (p_ubicacion is null or c.ubicacion ilike '%' || replace(replace(btrim(p_ubicacion), '%', E'\\%'), '_', E'\\_') || '%' escape E'\\')
    and (p_captured_from is null or c.captured_at >= p_captured_from)
    and (p_captured_to_exclusive is null or c.captured_at < p_captured_to_exclusive)
    and (p_cursor_captured_at is null or (c.captured_at, c.id) < (p_cursor_captured_at, p_cursor_id))
  order by c.captured_at desc, c.id desc limit p_limit;
end;
$$;

revoke all on schema app_private from public, anon, authenticated;
revoke all on table app_private.inventory_device_activity from public, anon, authenticated;
revoke all on function app_private.record_inventory_device_count_activity() from public, anon, authenticated;
revoke all on function public.get_inventory_supervision(uuid), public.get_my_count_summary(uuid), public.search_inventory_counts(uuid, integer, timestamptz, uuid, uuid, text, text, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_inventory_supervision(uuid), public.get_my_count_summary(uuid), public.search_inventory_counts(uuid, integer, timestamptz, uuid, uuid, text, text, text, text, timestamptz, timestamptz) to authenticated;
