-- F16: an explicit coverage gate separates an in-progress first count from
-- final reconciliation.  System references with no physical observation are
-- only actionable after the accountable C1 close.
alter type public.inventory_status add value if not exists 'C1_COMPLETADO' after 'ABIERTO';
alter type public.inventory_status add value if not exists 'CONCILIACION_FINAL' after 'C1_COMPLETADO';
alter type public.audit_event_type add value if not exists 'INVENTORY_C1_COMPLETED';
alter type public.audit_event_type add value if not exists 'INVENTORY_FINAL_RECONCILIATION_STARTED';

alter table public.inventories
  add column if not exists c1_completed_at timestamptz,
  add column if not exists c1_completed_by uuid references public.profiles(user_id) on delete restrict,
  add column if not exists final_reconciliation_started_at timestamptz,
  add column if not exists final_reconciliation_started_by uuid references public.profiles(user_id) on delete restrict;

-- A replacement no longer deletes and recreates the whole master.  Existing
-- identities are preserved, which keeps controlled historical exceptions
-- valid.  Removed exception codes are archived in audit_events before their
-- obsolete FK rows are removed.
create or replace function public.import_inventory_master(target_inventory_id uuid, import_items jsonb, import_source text, import_identifier text default null)
returns table(master_version integer, row_count integer, fingerprint text)
language plpgsql security definer set search_path = public, app_private, pg_temp as $$
declare
  actor_id uuid := auth.uid();
  locked_inventory public.inventories;
  normalized_items jsonb;
  normalized_source text := btrim(import_source);
  normalized_identifier text := nullif(btrim(import_identifier), '');
  retired_exception_codes text[] := '{}';
  invalidated_system_reference boolean := false;
begin
  if actor_id is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if not app_private.is_admin() then raise exception 'Only ADMIN can import a master snapshot' using errcode = '42501'; end if;
  locked_inventory := app_private.lock_inventory(target_inventory_id);
  if normalized_source is null or normalized_source = '' then raise exception 'Import source is required' using errcode = '23514'; end if;
  if jsonb_typeof(import_items) <> 'array' or jsonb_array_length(import_items) = 0 then raise exception 'Master import must contain at least one item' using errcode = '23514'; end if;
  if locked_inventory.status not in ('BORRADOR', 'PREPARADO') then raise exception 'Master import is only allowed in BORRADOR or PREPARADO' using errcode = '23514'; end if;

  select jsonb_agg(jsonb_build_object('codigo', upper(btrim(item.value ->> 'codigo')), 'descripcion', btrim(item.value ->> 'descripcion')))
    into normalized_items from jsonb_array_elements(import_items) as item(value);
  if exists (select 1 from jsonb_array_elements(normalized_items) as item(value) where nullif(item.value ->> 'codigo', '') is null or nullif(item.value ->> 'descripcion', '') is null) then
    raise exception 'Master items require non-empty codigo and descripcion' using errcode = '23514';
  end if;
  if exists (select item.value ->> 'codigo' from jsonb_array_elements(normalized_items) as item(value) group by item.value ->> 'codigo' having count(*) > 1) then
    raise exception 'Master import contains duplicate codigo' using errcode = '23505';
  end if;

  select coalesce(array_agg(e.codigo order by e.codigo), '{}') into retired_exception_codes
  from public.inventory_missing_batch_exceptions e
  where e.inventory_id = target_inventory_id
    and not exists (select 1 from jsonb_array_elements(normalized_items) item(value) where item.value ->> 'codigo' = e.codigo);

  -- A system snapshot is valid only for the master/control rules it was
  -- imported against.  Preserve it for description-only changes, but discard
  -- it atomically when a referenced SKU disappears or changes control type.
  select exists(
    select 1
    from public.inventory_system_reference_items s
    left join public.inventory_master_items current_master
      on current_master.inventory_id = s.inventory_id and current_master.codigo = s.codigo
    left join jsonb_array_elements(normalized_items) incoming(value)
      on incoming.value ->> 'codigo' = s.codigo
    where s.inventory_id = target_inventory_id
      and (
        incoming.value is null
        or s.reference_type <> case when right(incoming.value ->> 'codigo', 1) = 'S' then 'SERIAL'::public.master_control_type
                                  when right(incoming.value ->> 'codigo', 1) = 'P' then 'PARTIDA'::public.master_control_type
                                  else 'LEGACY'::public.master_control_type end
      )
  ) into invalidated_system_reference;
  if invalidated_system_reference then
    delete from public.inventory_system_reference_metadata where inventory_id = target_inventory_id;
    delete from public.inventory_system_reference_items where inventory_id = target_inventory_id;
  end if;

  -- The authorization itself remains permanently auditable; only its live
  -- FK row is removed when its SKU disappears from a replacement snapshot.
  delete from public.inventory_missing_batch_exceptions e
  where e.inventory_id = target_inventory_id
    and e.codigo = any(retired_exception_codes);

  insert into public.inventory_master_items (inventory_id, codigo, descripcion, control_type, source, created_by)
  select target_inventory_id, item.value ->> 'codigo', item.value ->> 'descripcion',
    case when right(item.value ->> 'codigo', 1) = 'S' then 'SERIAL'::public.master_control_type
         when right(item.value ->> 'codigo', 1) = 'P' then 'PARTIDA'::public.master_control_type
         else 'LEGACY'::public.master_control_type end,
    normalized_source, actor_id
  from jsonb_array_elements(normalized_items) as item(value)
  on conflict (inventory_id, codigo) do update set
    descripcion = excluded.descripcion,
    control_type = excluded.control_type,
    source = excluded.source;

  update public.inventory_missing_batch_exceptions e set active = false
  where e.inventory_id = target_inventory_id and e.active
    and not exists (
      select 1 from public.inventory_master_items m
      where m.inventory_id = target_inventory_id and m.codigo = e.codigo and m.control_type = 'PARTIDA'
    );

  delete from public.inventory_master_items m
  where m.inventory_id = target_inventory_id
    and not exists (select 1 from jsonb_array_elements(normalized_items) item(value) where item.value ->> 'codigo' = m.codigo);

  insert into public.inventory_master_metadata (inventory_id, master_version, row_count, fingerprint, cached_at)
  values (target_inventory_id, 1, jsonb_array_length(normalized_items), app_private.master_fingerprint(target_inventory_id), now())
  on conflict (inventory_id) do update set master_version = public.inventory_master_metadata.master_version + 1, row_count = excluded.row_count, fingerprint = excluded.fingerprint, cached_at = excluded.cached_at
  returning inventory_master_metadata.master_version, inventory_master_metadata.row_count, inventory_master_metadata.fingerprint into master_version, row_count, fingerprint;
  insert into public.audit_events (inventory_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (target_inventory_id, actor_id, 'MASTER_IMPORTED', 'inventory_master', target_inventory_id,
    jsonb_build_object('total', jsonb_array_length(normalized_items), 'valid', row_count, 'source', normalized_source, 'import_identifier', normalized_identifier, 'master_version', master_version, 'fingerprint', fingerprint, 'retired_missing_batch_exception_codes', retired_exception_codes, 'system_reference_invalidated', invalidated_system_reference));
  return next;
end;
$$;

create or replace function public.complete_first_count(target_inventory_id uuid)
returns public.inventories language plpgsql security definer set search_path = public, app_private, pg_temp as $$
declare actor uuid := app_private.require_active_actor(); updated public.inventories;
begin
  if not app_private.can_manage_inventory(target_inventory_id) then raise exception 'Not authorized to complete C1' using errcode = '42501'; end if;
  perform app_private.lock_inventory(target_inventory_id);
  if not exists (select 1 from public.inventories where id = target_inventory_id and status = 'ABIERTO') then raise exception 'C1 can only be completed from ABIERTO' using errcode = '23514'; end if;
  if not exists (select 1 from public.inventory_system_reference_metadata where inventory_id = target_inventory_id) then raise exception 'System reference snapshot is required before completing C1' using errcode = '23514'; end if;
  if exists (select 1 from public.inventory_freeze_guards where inventory_id = target_inventory_id and resolved_at is null) then raise exception 'Known pending synchronization must be resolved before completing C1' using errcode = '23514'; end if;
  update public.inventories set status = 'C1_COMPLETADO', c1_completed_at = now(), c1_completed_by = actor where id = target_inventory_id returning * into updated;
  insert into public.audit_events(inventory_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values(target_inventory_id, actor, 'INVENTORY_C1_COMPLETED', 'inventory', target_inventory_id, jsonb_build_object('from_status','ABIERTO','to_status','C1_COMPLETADO'));
  return updated;
end;
$$;

create or replace function public.start_final_reconciliation(target_inventory_id uuid)
returns public.inventories language plpgsql security definer set search_path = public, app_private, pg_temp as $$
declare actor uuid := app_private.require_active_actor(); updated public.inventories;
begin
  if not app_private.can_manage_inventory(target_inventory_id) then raise exception 'Not authorized to start final reconciliation' using errcode = '42501'; end if;
  perform app_private.lock_inventory(target_inventory_id);
  if not exists (select 1 from public.inventories where id = target_inventory_id and status = 'C1_COMPLETADO') then raise exception 'Final reconciliation requires C1_COMPLETADO' using errcode = '23514'; end if;
  update public.inventories set status = 'CONCILIACION_FINAL', final_reconciliation_started_at = now(), final_reconciliation_started_by = actor where id = target_inventory_id returning * into updated;
  insert into public.audit_events(inventory_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values(target_inventory_id, actor, 'INVENTORY_FINAL_RECONCILIATION_STARTED', 'inventory', target_inventory_id, jsonb_build_object('from_status','C1_COMPLETADO','to_status','CONCILIACION_FINAL'));
  return updated;
end;
$$;

create or replace function public.close_inventory(target_inventory_id uuid)
returns public.inventories language plpgsql security definer set search_path = public, app_private, pg_temp as $$
declare fp text; lifecycle public.inventory_status;
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if not app_private.can_manage_inventory(target_inventory_id) then raise exception 'Not authorized to manage inventory' using errcode = '42501'; end if;
  perform app_private.lock_inventory(target_inventory_id);
  select status into lifecycle from public.inventories where id = target_inventory_id;
  -- Backward-compatible close for inventories created before the F16 coverage
  -- workflow.  The F16 UI never exposes this path: new operations advance
  -- through C1 and final reconciliation below.
  if lifecycle = 'ABIERTO' then return app_private.transition_inventory(target_inventory_id, 'ABIERTO', 'CERRADO', 'INVENTORY_CLOSED'); end if;
  if lifecycle <> 'CONCILIACION_FINAL' then raise exception 'Inventory must complete final reconciliation before closing' using errcode = '23514'; end if;
  select fingerprint into fp from public.inventory_system_reference_metadata where inventory_id = target_inventory_id;
  if fp is null then raise exception 'System reference snapshot is required before closing inventory' using errcode = '23514'; end if;
  if exists (select 1 from public.reconciliation_cases where inventory_id = target_inventory_id and source_fingerprint = fp and status <> 'RESUELTO') then raise exception 'Final reconciliation has unresolved cases' using errcode = '23514'; end if;
  return app_private.transition_inventory(target_inventory_id, 'CONCILIACION_FINAL', 'CERRADO', 'INVENTORY_CLOSED');
end;
$$;

-- In-progress C1 can show live differences, but it does not open cases for a
-- reference which nobody has reached yet. Missing system stock becomes an
-- actionable case only after C1 is explicitly completed.
create or replace function public.materialize_reconciliation_cases(p_inventory_id uuid)
returns table(created_count integer,existing_count integer,source_fingerprint text)
language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare actor uuid:=app_private.require_active_actor(); fp text; made integer:=0; existed integer:=0; lifecycle public.inventory_status;
begin
 if not app_private.can_manage_inventory(p_inventory_id) then raise exception 'Not authorized for reconciliation materialization' using errcode='42501'; end if;
 select status into lifecycle from public.inventories where id=p_inventory_id for update;
 if lifecycle is null then raise exception 'Inventory not found' using errcode='P0002'; end if;
 select fingerprint into fp from public.inventory_system_reference_metadata where inventory_id=p_inventory_id;
 if fp is null then raise exception 'System reference snapshot is required' using errcode='23514'; end if;
 with physical_base as (
  select c.*,m.control_type,case when m.control_type='SERIAL' then c.serie when m.control_type='PARTIDA' then c.partida else null end reference_value
  from public.count_records c join public.inventory_master_items m on m.inventory_id=c.inventory_id and m.codigo=c.codigo where c.inventory_id=p_inventory_id
 ), physical as (
  select codigo,control_type,reference_value,sum(cantidad_contada)::integer quantity,count(*)::integer observation_count,(array_agg(id order by received_at,captured_at,created_at,id))[1] first_count_record_id
  from physical_base group by codigo,control_type,reference_value
 ), joined as (
  select coalesce(s.codigo,p.codigo) codigo,coalesce(s.reference_type,p.control_type) reference_type,coalesce(s.reference_value,p.reference_value) reference_value,coalesce(s.quantity,0) system_quantity,coalesce(p.quantity,0) physical_quantity,coalesce(p.observation_count,0) physical_observation_count,p.first_count_record_id
  from public.inventory_system_reference_items s full join physical p on p.codigo=s.codigo and p.control_type=s.reference_type and coalesce(p.reference_value,'')=coalesce(s.reference_value,'')
  where coalesce(s.inventory_id,p_inventory_id)=p_inventory_id
 ), anomalies as (
  select j.*,'DUPLICADO_SERIE'::text anomaly_type from joined j
   where j.reference_type='SERIAL' and j.physical_observation_count>1
  union all
  select j.*,'SERIE_FISICA_NO_EN_SISTEMA' from joined j
   where j.reference_type='SERIAL' and j.system_quantity=0 and j.physical_quantity>0
  union all
  select j.*,'SERIE_SISTEMA_NO_CONTADA' from joined j
   where j.reference_type='SERIAL' and j.system_quantity>0 and j.physical_quantity=0 and lifecycle in ('CONCILIACION_FINAL','CERRADO','CONGELADO')
  union all
  select j.*,'PARTIDA_FISICA_NO_EN_SISTEMA' from joined j
   where j.reference_type='PARTIDA' and j.system_quantity=0 and j.physical_quantity>0
  union all
  select j.*,'PARTIDA_SISTEMA_NO_CONTADA' from joined j
   where j.reference_type='PARTIDA' and j.system_quantity>0 and j.physical_quantity=0 and lifecycle in ('CONCILIACION_FINAL','CERRADO','CONGELADO')
  union all
  select j.*,'DIFERENCIA_CANTIDAD_PARTIDA' from joined j
   where j.reference_type='PARTIDA' and j.system_quantity>0 and j.physical_quantity>0 and j.system_quantity<>j.physical_quantity
  union all
  select j.*,'DIFERENCIA_CANTIDAD_SKU' from joined j
   where j.reference_type='LEGACY' and j.system_quantity<>j.physical_quantity and not (j.system_quantity>0 and j.physical_quantity=0 and lifecycle='ABIERTO')
 ), ins as (
  insert into public.reconciliation_cases(inventory_id,codigo,reference_type,reference_value,anomaly_type,system_quantity,physical_quantity,first_count_record_id,created_by,source_fingerprint)
  select p_inventory_id,codigo,reference_type,reference_value,anomaly_type,system_quantity,physical_quantity,first_count_record_id,actor,fp from anomalies
  on conflict do nothing returning 1
 )
 select count(*)::integer into made from ins;
 select count(*)::integer into existed from public.reconciliation_cases rc where rc.inventory_id=p_inventory_id and rc.source_fingerprint=fp and rc.status<>'RESUELTO';
 insert into public.audit_events(inventory_id,actor_user_id,event_type,entity_type,entity_id,payload)
 values(p_inventory_id,actor,'MASTER_IMPORTED','reconciliation_materialization',p_inventory_id,jsonb_build_object('source_fingerprint',fp,'created_count',made,'open_case_count',existed,'coverage_status',lifecycle));
 created_count:=made;existing_count:=existed;source_fingerprint:=fp;return next;
end;
$$;

revoke all on function public.complete_first_count(uuid), public.start_final_reconciliation(uuid) from public, anon;
grant execute on function public.complete_first_count(uuid), public.start_final_reconciliation(uuid) to authenticated;

-- A device that was legitimately offline at C1 close may still deliver a
-- count captured before the cutoff.  It is accepted exactly once; captures
-- made after C1 are rejected even when sent by a stale client.
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
  v_after_closed boolean;
  v_assigned_recount boolean;
begin
  if v_actor_id is null or not exists (select 1 from public.profiles where user_id = v_actor_id and active) then raise exception 'Active authentication is required' using errcode = '42501'; end if;
  if p_records is null or jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) = 0 or jsonb_array_length(p_records) > 20 then raise exception 'sync_counts requires 1 to 20 records' using errcode = '23514'; end if;
  if not app_private.can_access_inventory(p_inventory_id) then raise exception 'Not authorized for inventory' using errcode = '42501'; end if;
  select * into v_inventory from public.inventories where id = p_inventory_id for update;
  if not found then raise exception 'Inventory not found' using errcode = 'P0002'; end if;
  perform public.register_sync_device(p_device_id, p_platform, p_app_version, p_device_label);

  for v_record in select value from jsonb_array_elements(p_records) loop
    client_count_id := null; server_count_id := null; received_at := null; reason := null;
    begin
      if jsonb_typeof(v_record) <> 'object' then raise exception 'Invalid record'; end if;
      v_client_count_id := (v_record ->> 'client_count_id')::uuid; client_count_id := v_client_count_id;
      v_ubicacion := upper(btrim(v_record ->> 'ubicacion')); v_codigo := upper(btrim(v_record ->> 'codigo'));
      v_serie := nullif(btrim(v_record ->> 'serie'), ''); v_partida := nullif(btrim(v_record ->> 'partida'), '');
      v_pieza_producto := nullif(btrim(v_record ->> 'pieza_producto'), ''); v_fecha_vencimiento := nullif(v_record ->> 'fecha_vencimiento', '')::date;
      v_talla := nullif(btrim(v_record ->> 'talla'), ''); v_color := nullif(btrim(v_record ->> 'color'), '');
      v_cantidad := (v_record ->> 'cantidad_contada')::integer; v_captured_at := (v_record ->> 'captured_at')::timestamptz;
    exception when others then result_status := 'REJECTED'; reason := 'INVALID_RECORD'; return next; continue;
    end;
    select * into v_existing from public.count_records where count_records.client_count_id = v_client_count_id;
    if found then
      if app_private.matches_original_count_replay(v_existing.id, p_inventory_id, v_actor_id, p_device_id, v_ubicacion, v_codigo, v_serie, v_partida, v_pieza_producto, v_fecha_vencimiento, v_talla, v_color, v_cantidad, v_captured_at) then result_status := 'ALREADY_ACCEPTED'; server_count_id := v_existing.id; received_at := v_existing.received_at; return next; continue; end if;
      result_status := 'CONFLICT'; reason := 'CLIENT_COUNT_ID_PAYLOAD_CONFLICT'; return next; continue;
    end if;
    if v_inventory.status = 'CONGELADO' then result_status := 'REJECTED'; reason := 'INVENTORY_FROZEN'; return next; continue; end if;
    if v_inventory.status not in ('ABIERTO', 'C1_COMPLETADO', 'CONCILIACION_FINAL', 'CERRADO') then result_status := 'REJECTED'; reason := 'INVENTORY_NOT_ACCEPTING_COUNTS'; return next; continue; end if;
    if v_ubicacion !~ '^(A|B|C|C2|D|F|G|H|I)-[0-9]{2}-[0-9]{2}$' then result_status := 'REJECTED'; reason := 'INVALID_LOCATION'; return next; continue; end if;
    if v_codigo is null or v_codigo = '' or v_cantidad is null or v_cantidad <= 0 or v_captured_at is null then result_status := 'REJECTED'; reason := 'INVALID_RECORD'; return next; continue; end if;
    select * into v_master from public.inventory_master_items where inventory_id = p_inventory_id and codigo = v_codigo;
    if not found then result_status := 'REJECTED'; reason := 'UNKNOWN_SKU'; return next; continue; end if;
    if v_master.control_type = 'SERIAL' and (v_serie is null or length(v_serie) > 19 or v_cantidad <> 1 or v_partida is not null) then result_status := 'REJECTED'; reason := 'INVALID_SERIAL'; return next; continue; end if;
    if v_master.control_type = 'PARTIDA' and (v_partida is null or v_serie is not null) then result_status := 'REJECTED'; reason := 'INVALID_BATCH'; return next; continue; end if;
    if v_inventory.status in ('C1_COMPLETADO', 'CONCILIACION_FINAL') and (v_inventory.c1_completed_at is null or v_captured_at > v_inventory.c1_completed_at) then
      select exists(
        select 1 from public.reconciliation_cases r
        where r.inventory_id = p_inventory_id and r.codigo = v_codigo and r.reference_type = v_master.control_type
          and coalesce(r.reference_value, '') = coalesce(case when v_master.control_type = 'SERIAL' then v_serie when v_master.control_type = 'PARTIDA' then v_partida else null end, '')
          and ((r.status = '2DO_CONTEO_ASIGNADO' and r.assigned_second_user_id = v_actor_id)
            or (r.status = '3ER_CONTEO_ASIGNADO' and r.assigned_third_analyst_id = v_actor_id and app_private.is_analyst()))
      ) into v_assigned_recount;
      if not v_assigned_recount then result_status := 'REJECTED'; reason := 'C1_CLOSED_FOR_NEW_COUNTS'; return next; continue; end if;
    end if;
    v_after_closed := case when v_inventory.status = 'CERRADO' then v_captured_at > v_inventory.closed_at else null end;
    v_new_id := null;
    insert into public.count_records(client_count_id, inventory_id, user_id, device_id, ubicacion, codigo, serie, partida, pieza_producto, fecha_vencimiento, talla, color, cantidad_contada, descripcion, captured_at, received_at, inventory_status_at_receive, captured_after_closed_at)
    values(v_client_count_id, p_inventory_id, v_actor_id, p_device_id, v_ubicacion, v_codigo, v_serie, v_partida, v_pieza_producto, v_fecha_vencimiento, v_talla, v_color, v_cantidad, v_master.descripcion, v_captured_at, v_now, v_inventory.status, v_after_closed)
    on conflict on constraint count_records_client_count_id_key do nothing returning count_records.id, count_records.received_at into v_new_id, received_at;
    if v_new_id is null then
      select * into v_existing from public.count_records where count_records.client_count_id = v_client_count_id;
      if app_private.matches_original_count_replay(v_existing.id, p_inventory_id, v_actor_id, p_device_id, v_ubicacion, v_codigo, v_serie, v_partida, v_pieza_producto, v_fecha_vencimiento, v_talla, v_color, v_cantidad, v_captured_at) then result_status := 'ALREADY_ACCEPTED'; server_count_id := v_existing.id; received_at := v_existing.received_at; return next; continue; end if;
      result_status := 'CONFLICT'; reason := 'CLIENT_COUNT_ID_PAYLOAD_CONFLICT'; return next; continue;
    end if;
    insert into public.audit_events(inventory_id, actor_user_id, device_id, event_type, entity_type, entity_id, payload)
    values (p_inventory_id, v_actor_id, p_device_id, 'COUNT_CREATED', 'count_record', v_new_id, jsonb_build_object('client_count_id', v_client_count_id, 'inventory_status_at_receive', v_inventory.status, 'captured_after_closed_at', v_after_closed)), (p_inventory_id, v_actor_id, p_device_id, 'COUNT_SYNCED', 'count_record', v_new_id, jsonb_build_object('client_count_id', v_client_count_id));
    result_status := 'ACCEPTED'; server_count_id := v_new_id; return next;
  end loop;
  update public.sync_devices set last_seen_at = v_now, last_sync_at = v_now where id = p_device_id and user_id = v_actor_id;
end;
$$;
