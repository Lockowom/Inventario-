alter table public.count_records
  add column inventory_status_at_receive public.inventory_status,
  add column captured_after_closed_at boolean;

alter table public.count_records
  add constraint count_records_closed_receive_metadata check (
    (inventory_status_at_receive = 'CERRADO' and captured_after_closed_at is not null)
    or (inventory_status_at_receive is distinct from 'CERRADO' and captured_after_closed_at is null)
  );

-- Device registrations are immutable in ownership. A client supplies only an
-- opaque per-user/per-installation UUID; no physical device identifier is kept.
create or replace function public.register_sync_device(
  p_device_id uuid,
  p_platform public.device_platform,
  p_app_version text,
  p_device_label text
)
returns public.sync_devices
language plpgsql security definer set search_path = public, app_private, pg_temp as $$
declare
  v_actor_id uuid := auth.uid();
  v_device public.sync_devices%rowtype;
begin
  if v_actor_id is null or not exists (select 1 from public.profiles where user_id = v_actor_id and active) then
    raise exception 'Active authentication is required' using errcode = '42501';
  end if;
  if nullif(btrim(p_app_version), '') is null or nullif(btrim(p_device_label), '') is null then
    raise exception 'Device metadata is required' using errcode = '23514';
  end if;

  select * into v_device from public.sync_devices where id = p_device_id for update;
  if found and v_device.user_id <> v_actor_id then
    raise exception 'Device registration belongs to another user' using errcode = '42501';
  end if;

  if found then
    update public.sync_devices
    set platform = p_platform, app_version = btrim(p_app_version), device_label = btrim(p_device_label), last_seen_at = now()
    where id = p_device_id
    returning * into v_device;
  else
    insert into public.sync_devices (id, user_id, platform, app_version, device_label, last_seen_at)
    values (p_device_id, v_actor_id, p_platform, btrim(p_app_version), btrim(p_device_label), now())
    returning * into v_device;
  end if;
  return v_device;
end;
$$;

create or replace function public.report_device_sync_state(
  p_inventory_id uuid,
  p_device_id uuid,
  p_pending_count integer
)
returns void
language plpgsql security definer set search_path = public, app_private, pg_temp as $$
declare v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null or not exists (select 1 from public.profiles where user_id = v_actor_id and active) then raise exception 'Active authentication is required' using errcode = '42501'; end if;
  if p_pending_count < 0 then raise exception 'Pending count cannot be negative' using errcode = '23514'; end if;
  if not app_private.can_access_inventory(p_inventory_id) then raise exception 'Not authorized for inventory' using errcode = '42501'; end if;
  if not exists (select 1 from public.sync_devices where id = p_device_id and user_id = v_actor_id and active) then raise exception 'Device registration is not owned by the user' using errcode = '42501'; end if;

  update public.sync_devices set last_seen_at = now() where id = p_device_id;
  if p_pending_count > 0 then
    insert into public.inventory_freeze_guards (inventory_id, device_id, pending_count, reported_at, resolved_at)
    values (p_inventory_id, p_device_id, p_pending_count, now(), null)
    on conflict (inventory_id, device_id) where resolved_at is null
    do update set pending_count = excluded.pending_count, reported_at = excluded.reported_at;
  else
    update public.inventory_freeze_guards
    set resolved_at = coalesce(resolved_at, now()), reported_at = now()
    where inventory_id = p_inventory_id and device_id = p_device_id and resolved_at is null;
  end if;
end;
$$;

create or replace function public.sync_counts(
  p_inventory_id uuid,
  p_device_id uuid,
  p_platform public.device_platform,
  p_app_version text,
  p_device_label text,
  p_records jsonb
)
returns table(client_count_id uuid, result_status text, server_count_id uuid, received_at timestamptz, reason text)
language plpgsql security definer set search_path = public, app_private, pg_temp as $$
declare
  v_actor_id uuid := auth.uid();
  v_inventory public.inventories%rowtype;
  v_master public.inventory_master_items%rowtype;
  v_existing public.count_records%rowtype;
  v_record jsonb;
  v_client_count_id uuid;
  v_ubicacion text;
  v_codigo text;
  v_serie text;
  v_partida text;
  v_pieza_producto text;
  v_fecha_vencimiento date;
  v_talla text;
  v_color text;
  v_cantidad integer;
  v_captured_at timestamptz;
  v_new_id uuid;
  v_now timestamptz := now();
begin
  if v_actor_id is null or not exists (select 1 from public.profiles where user_id = v_actor_id and active) then
    raise exception 'Active authentication is required' using errcode = '42501';
  end if;
  if p_records is null or jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) = 0 or jsonb_array_length(p_records) > 20 then
    raise exception 'sync_counts requires 1 to 20 records' using errcode = '23514';
  end if;
  if not app_private.can_access_inventory(p_inventory_id) then raise exception 'Not authorized for inventory' using errcode = '42501'; end if;
  select * into v_inventory from public.inventories where id = p_inventory_id for update;
  if not found then raise exception 'Inventory not found' using errcode = 'P0002'; end if;

  perform public.register_sync_device(p_device_id, p_platform, p_app_version, p_device_label);

  for v_record in select value from jsonb_array_elements(p_records) loop
    client_count_id := null; server_count_id := null; received_at := null; reason := null;
    begin
      if jsonb_typeof(v_record) <> 'object' then raise exception 'Invalid record'; end if;
      v_client_count_id := (v_record ->> 'client_count_id')::uuid;
      client_count_id := v_client_count_id;
      v_ubicacion := upper(btrim(v_record ->> 'ubicacion'));
      v_codigo := upper(btrim(v_record ->> 'codigo'));
      v_serie := nullif(btrim(v_record ->> 'serie'), '');
      v_partida := nullif(btrim(v_record ->> 'partida'), '');
      v_pieza_producto := nullif(btrim(v_record ->> 'pieza_producto'), '');
      v_fecha_vencimiento := nullif(v_record ->> 'fecha_vencimiento', '')::date;
      v_talla := nullif(btrim(v_record ->> 'talla'), '');
      v_color := nullif(btrim(v_record ->> 'color'), '');
      v_cantidad := (v_record ->> 'cantidad_contada')::integer;
      v_captured_at := (v_record ->> 'captured_at')::timestamptz;
    exception when others then
      result_status := 'REJECTED'; reason := 'INVALID_RECORD'; return next; continue;
    end;

    select * into v_existing from public.count_records where count_records.client_count_id = v_client_count_id;
    if found then
      if v_existing.inventory_id = p_inventory_id and v_existing.user_id = v_actor_id and v_existing.device_id = p_device_id
         and v_existing.ubicacion = v_ubicacion and v_existing.codigo = v_codigo
         and v_existing.serie is not distinct from v_serie and v_existing.partida is not distinct from v_partida
         and v_existing.pieza_producto is not distinct from v_pieza_producto and v_existing.fecha_vencimiento is not distinct from v_fecha_vencimiento
         and v_existing.talla is not distinct from v_talla and v_existing.color is not distinct from v_color
         and v_existing.cantidad_contada = v_cantidad and v_existing.captured_at = v_captured_at then
        result_status := 'ALREADY_ACCEPTED'; server_count_id := v_existing.id; received_at := v_existing.received_at; return next; continue;
      end if;
      result_status := 'CONFLICT'; reason := 'CLIENT_COUNT_ID_PAYLOAD_CONFLICT'; return next; continue;
    end if;

    if v_inventory.status = 'CONGELADO' then result_status := 'REJECTED'; reason := 'INVENTORY_FROZEN'; return next; continue; end if;
    if v_inventory.status not in ('ABIERTO', 'CERRADO') then result_status := 'REJECTED'; reason := 'INVENTORY_NOT_ACCEPTING_COUNTS'; return next; continue; end if;
    if v_ubicacion !~ '^(A|B|C|C2|D|F|G|H|I)-[0-9]{2}-[0-9]{2}$' then result_status := 'REJECTED'; reason := 'INVALID_LOCATION'; return next; continue; end if;
    if v_codigo is null or v_codigo = '' or v_cantidad is null or v_cantidad <= 0 or v_captured_at is null then result_status := 'REJECTED'; reason := 'INVALID_RECORD'; return next; continue; end if;

    select * into v_master from public.inventory_master_items where inventory_id = p_inventory_id and codigo = v_codigo;
    if not found then result_status := 'REJECTED'; reason := 'UNKNOWN_SKU'; return next; continue; end if;
    if v_master.control_type = 'SERIAL' and (v_serie is null or length(v_serie) > 19 or v_cantidad <> 1 or v_partida is not null) then result_status := 'REJECTED'; reason := 'INVALID_SERIAL'; return next; continue; end if;
    if v_master.control_type = 'PARTIDA' and (v_partida is null or v_serie is not null) then result_status := 'REJECTED'; reason := 'INVALID_BATCH'; return next; continue; end if;

    v_new_id := null;
    insert into public.count_records (
      client_count_id, inventory_id, user_id, device_id, ubicacion, codigo, serie, partida, pieza_producto,
      fecha_vencimiento, talla, color, cantidad_contada, descripcion, captured_at, received_at,
      inventory_status_at_receive, captured_after_closed_at
    ) values (
      v_client_count_id, p_inventory_id, v_actor_id, p_device_id, v_ubicacion, v_codigo, v_serie, v_partida, v_pieza_producto,
      v_fecha_vencimiento, v_talla, v_color, v_cantidad, v_master.descripcion, v_captured_at, v_now,
      v_inventory.status, case when v_inventory.status = 'CERRADO' then v_captured_at > v_inventory.closed_at else null end
    ) on conflict (client_count_id) do nothing
      returning id, count_records.received_at into v_new_id, received_at;

    if v_new_id is null then
      select * into v_existing from public.count_records where count_records.client_count_id = v_client_count_id;
      if v_existing.inventory_id = p_inventory_id and v_existing.user_id = v_actor_id and v_existing.device_id = p_device_id
         and v_existing.ubicacion = v_ubicacion and v_existing.codigo = v_codigo
         and v_existing.serie is not distinct from v_serie and v_existing.partida is not distinct from v_partida
         and v_existing.pieza_producto is not distinct from v_pieza_producto and v_existing.fecha_vencimiento is not distinct from v_fecha_vencimiento
         and v_existing.talla is not distinct from v_talla and v_existing.color is not distinct from v_color
         and v_existing.cantidad_contada = v_cantidad and v_existing.captured_at = v_captured_at then
        result_status := 'ALREADY_ACCEPTED'; server_count_id := v_existing.id; received_at := v_existing.received_at; return next; continue;
      end if;
      result_status := 'CONFLICT'; reason := 'CLIENT_COUNT_ID_PAYLOAD_CONFLICT'; return next; continue;
    end if;

    insert into public.audit_events (inventory_id, actor_user_id, device_id, event_type, entity_type, entity_id, payload)
    values
      (p_inventory_id, v_actor_id, p_device_id, 'COUNT_CREATED', 'count_record', v_new_id, jsonb_build_object('client_count_id', v_client_count_id, 'inventory_status_at_receive', v_inventory.status, 'captured_after_closed_at', case when v_inventory.status = 'CERRADO' then v_captured_at > v_inventory.closed_at else null end)),
      (p_inventory_id, v_actor_id, p_device_id, 'COUNT_SYNCED', 'count_record', v_new_id, jsonb_build_object('client_count_id', v_client_count_id));
    result_status := 'ACCEPTED'; server_count_id := v_new_id; return next;
  end loop;

  update public.sync_devices set last_seen_at = v_now, last_sync_at = v_now where id = p_device_id and user_id = v_actor_id;
end;
$$;

drop policy if exists devices_insert_own on public.sync_devices;
drop policy if exists devices_update_own on public.sync_devices;
revoke insert, update on public.sync_devices from authenticated;
revoke all on function public.register_sync_device(uuid, public.device_platform, text, text), public.report_device_sync_state(uuid, uuid, integer), public.sync_counts(uuid, uuid, public.device_platform, text, text, jsonb) from public, anon;
grant execute on function public.register_sync_device(uuid, public.device_platform, text, text), public.report_device_sync_state(uuid, uuid, integer), public.sync_counts(uuid, uuid, public.device_platform, text, text, jsonb) to authenticated;
