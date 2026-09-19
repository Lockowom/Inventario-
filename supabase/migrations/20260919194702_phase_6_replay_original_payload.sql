-- Fase 6 corrective migration: a client_count_id identifies the immutable
-- ingestion observation, not its later canonical correction.
create or replace function app_private.original_count_physical_values(p_count_record_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, app_private, pg_temp
as $$
  select coalesce(
    (select r.old_values from public.count_revisions r
      where r.count_record_id = p_count_record_id order by r.revision_number asc limit 1),
    (select jsonb_build_object(
      'ubicacion', c.ubicacion, 'codigo', c.codigo, 'serie', c.serie, 'partida', c.partida,
      'pieza_producto', c.pieza_producto, 'fecha_vencimiento', c.fecha_vencimiento,
      'talla', c.talla, 'color', c.color, 'cantidad_contada', c.cantidad_contada
    ) from public.count_records c where c.id = p_count_record_id)
  )
$$;

create or replace function app_private.matches_original_count_replay(
  p_count_record_id uuid,
  p_inventory_id uuid,
  p_user_id uuid,
  p_device_id uuid,
  p_ubicacion text,
  p_codigo text,
  p_serie text,
  p_partida text,
  p_pieza_producto text,
  p_fecha_vencimiento date,
  p_talla text,
  p_color text,
  p_cantidad_contada integer,
  p_captured_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public, app_private, pg_temp
as $$
  with count_row as (
    select * from public.count_records where id = p_count_record_id
  ), original as (
    select app_private.original_count_physical_values(p_count_record_id) as physical_values
  )
  select coalesce((select
    c.inventory_id = p_inventory_id and c.user_id = p_user_id and c.device_id = p_device_id and c.captured_at = p_captured_at
    and o.physical_values ->> 'ubicacion' = p_ubicacion
    and o.physical_values ->> 'codigo' = p_codigo
    and o.physical_values ->> 'serie' is not distinct from p_serie
    and o.physical_values ->> 'partida' is not distinct from p_partida
    and o.physical_values ->> 'pieza_producto' is not distinct from p_pieza_producto
    and nullif(o.physical_values ->> 'fecha_vencimiento', '')::date is not distinct from p_fecha_vencimiento
    and o.physical_values ->> 'talla' is not distinct from p_talla
    and o.physical_values ->> 'color' is not distinct from p_color
    and (o.physical_values ->> 'cantidad_contada')::integer = p_cantidad_contada
    from count_row c cross join original o), false)
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
      if app_private.matches_original_count_replay(v_existing.id, p_inventory_id, v_actor_id, p_device_id, v_ubicacion, v_codigo, v_serie, v_partida, v_pieza_producto, v_fecha_vencimiento, v_talla, v_color, v_cantidad, v_captured_at) then
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
    ) on conflict on constraint count_records_client_count_id_key do nothing
      returning count_records.id, count_records.received_at into v_new_id, received_at;
    if v_new_id is null then
      select * into v_existing from public.count_records where count_records.client_count_id = v_client_count_id;
      if app_private.matches_original_count_replay(v_existing.id, p_inventory_id, v_actor_id, p_device_id, v_ubicacion, v_codigo, v_serie, v_partida, v_pieza_producto, v_fecha_vencimiento, v_talla, v_color, v_cantidad, v_captured_at) then
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

revoke all on function app_private.original_count_physical_values(uuid), app_private.matches_original_count_replay(uuid, uuid, uuid, uuid, text, text, text, text, text, date, text, text, integer, timestamptz) from public, anon, authenticated;
