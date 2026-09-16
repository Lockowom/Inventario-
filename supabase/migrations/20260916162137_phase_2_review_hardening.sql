create or replace function app_private.lock_inventory(target_inventory_id uuid)
returns public.inventories
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare locked_inventory public.inventories;
begin
  select * into locked_inventory
  from public.inventories
  where id = target_inventory_id
  for update;
  if not found then raise exception 'Inventory not found' using errcode = 'P0002'; end if;
  return locked_inventory;
end;
$$;

create or replace function app_private.transition_inventory(target_inventory_id uuid, expected_status public.inventory_status, next_status public.inventory_status, audit_type public.audit_event_type)
returns public.inventories
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare actor_id uuid := auth.uid(); updated_inventory public.inventories;
begin
  if actor_id is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if not app_private.can_manage_inventory(target_inventory_id) then raise exception 'Not authorized to manage inventory' using errcode = '42501'; end if;
  updated_inventory := app_private.lock_inventory(target_inventory_id);
  if updated_inventory.status <> expected_status then raise exception 'Invalid inventory transition from % to %', updated_inventory.status, next_status using errcode = '23514'; end if;
  update public.inventories set
    status = next_status,
    prepared_at = case when next_status = 'PREPARADO' then now() else prepared_at end,
    prepared_by = case when next_status = 'PREPARADO' then actor_id else prepared_by end,
    opened_at = case when next_status = 'ABIERTO' then now() else opened_at end,
    opened_by = case when next_status = 'ABIERTO' then actor_id else opened_by end,
    closed_at = case when next_status = 'CERRADO' then now() else closed_at end,
    closed_by = case when next_status = 'CERRADO' then actor_id else closed_by end,
    frozen_at = case when next_status = 'CONGELADO' then now() else frozen_at end,
    frozen_by = case when next_status = 'CONGELADO' then actor_id else frozen_by end
  where id = target_inventory_id returning * into updated_inventory;
  insert into public.audit_events (inventory_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (target_inventory_id, actor_id, audit_type, 'inventory', target_inventory_id, jsonb_build_object('from_status', expected_status, 'to_status', next_status));
  return updated_inventory;
end;
$$;

create or replace function public.import_inventory_master(target_inventory_id uuid, import_items jsonb, import_source text, import_identifier text default null)
returns table(master_version integer, row_count integer, fingerprint text)
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  locked_inventory public.inventories;
  normalized_items jsonb;
  normalized_source text := btrim(import_source);
  normalized_identifier text := nullif(btrim(import_identifier), '');
begin
  if actor_id is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if not app_private.is_admin() then raise exception 'Only ADMIN can import a master snapshot' using errcode = '42501'; end if;
  locked_inventory := app_private.lock_inventory(target_inventory_id);
  if normalized_source is null or normalized_source = '' then raise exception 'Import source is required' using errcode = '23514'; end if;
  if jsonb_typeof(import_items) <> 'array' or jsonb_array_length(import_items) = 0 then raise exception 'Master import must contain at least one item' using errcode = '23514'; end if;
  if locked_inventory.status not in ('BORRADOR', 'PREPARADO') then raise exception 'Master import is only allowed in BORRADOR or PREPARADO' using errcode = '23514'; end if;

  select jsonb_agg(jsonb_build_object('codigo', upper(btrim(item.value ->> 'codigo')), 'descripcion', btrim(item.value ->> 'descripcion')))
  into normalized_items
  from jsonb_array_elements(import_items) as item(value);
  if exists (select 1 from jsonb_array_elements(normalized_items) as item(value) where nullif(item.value ->> 'codigo', '') is null or nullif(item.value ->> 'descripcion', '') is null) then
    raise exception 'Master items require non-empty codigo and descripcion' using errcode = '23514';
  end if;
  if exists (select item.value ->> 'codigo' from jsonb_array_elements(normalized_items) as item(value) group by item.value ->> 'codigo' having count(*) > 1) then
    raise exception 'Master import contains duplicate codigo' using errcode = '23505';
  end if;

  delete from public.inventory_master_items where inventory_id = target_inventory_id;
  insert into public.inventory_master_items (inventory_id, codigo, descripcion, control_type, source, created_by)
  select target_inventory_id, item.value ->> 'codigo', item.value ->> 'descripcion',
    case when right(item.value ->> 'codigo', 1) = 'S' then 'SERIAL'::public.master_control_type
         when right(item.value ->> 'codigo', 1) = 'P' then 'PARTIDA'::public.master_control_type
         else 'LEGACY'::public.master_control_type end,
    normalized_source, actor_id
  from jsonb_array_elements(normalized_items) as item(value);

  insert into public.inventory_master_metadata (inventory_id, master_version, row_count, fingerprint, cached_at)
  values (target_inventory_id, 1, jsonb_array_length(normalized_items), app_private.master_fingerprint(target_inventory_id), now())
  on conflict (inventory_id) do update set master_version = public.inventory_master_metadata.master_version + 1, row_count = excluded.row_count, fingerprint = excluded.fingerprint, cached_at = excluded.cached_at
  returning inventory_master_metadata.master_version, inventory_master_metadata.row_count, inventory_master_metadata.fingerprint into master_version, row_count, fingerprint;
  insert into public.audit_events (inventory_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (target_inventory_id, actor_id, 'MASTER_IMPORTED', 'inventory_master', target_inventory_id,
    jsonb_build_object('total', jsonb_array_length(normalized_items), 'valid', row_count, 'source', normalized_source, 'import_identifier', normalized_identifier, 'master_version', master_version, 'fingerprint', fingerprint));
  return next;
end;
$$;

create or replace function public.add_master_exception(target_inventory_id uuid, raw_codigo text, raw_descripcion text, exception_reason text)
returns table(master_version integer, row_count integer, fingerprint text)
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  locked_inventory public.inventories;
  normalized_codigo text := upper(btrim(raw_codigo));
  normalized_descripcion text := btrim(raw_descripcion);
  normalized_reason text := btrim(exception_reason);
  derived_control_type public.master_control_type;
  new_master_item_id uuid;
  new_exception_id uuid;
begin
  if actor_id is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if not (app_private.is_admin() or app_private.is_analyst()) or not app_private.can_manage_inventory(target_inventory_id) then raise exception 'Only an assigned ANALISTA or ADMIN can add a master exception' using errcode = '42501'; end if;
  locked_inventory := app_private.lock_inventory(target_inventory_id);
  if normalized_codigo is null or normalized_codigo = '' then raise exception 'Master exception codigo is required' using errcode = '23514'; end if;
  if normalized_descripcion is null or normalized_descripcion = '' then raise exception 'Master exception descripcion is required' using errcode = '23514'; end if;
  if normalized_reason is null or normalized_reason = '' then raise exception 'Master exception reason is required' using errcode = '23514'; end if;
  if locked_inventory.status <> 'ABIERTO' then raise exception 'Master exceptions are only allowed while inventory is ABIERTO' using errcode = '23514'; end if;
  if exists (select 1 from public.inventory_master_items where inventory_id = target_inventory_id and codigo = normalized_codigo) then raise exception 'Master codigo already exists' using errcode = '23505'; end if;

  derived_control_type := case when right(normalized_codigo, 1) = 'S' then 'SERIAL'::public.master_control_type when right(normalized_codigo, 1) = 'P' then 'PARTIDA'::public.master_control_type else 'LEGACY'::public.master_control_type end;
  insert into public.inventory_master_items (inventory_id, codigo, descripcion, control_type, source, created_by)
  values (target_inventory_id, normalized_codigo, normalized_descripcion, derived_control_type, 'EXCEPTION', actor_id)
  returning id into new_master_item_id;
  insert into public.inventory_master_exceptions (inventory_id, master_item_id, codigo, descripcion, control_type, reason, created_by)
  values (target_inventory_id, new_master_item_id, normalized_codigo, normalized_descripcion, derived_control_type, normalized_reason, actor_id)
  returning id into new_exception_id;
  insert into public.inventory_master_metadata (inventory_id, master_version, row_count, fingerprint, cached_at)
  values (target_inventory_id, 1, 1, app_private.master_fingerprint(target_inventory_id), now())
  on conflict (inventory_id) do update set master_version = public.inventory_master_metadata.master_version + 1, row_count = (select count(*)::integer from public.inventory_master_items where inventory_id = target_inventory_id), fingerprint = excluded.fingerprint, cached_at = excluded.cached_at
  returning inventory_master_metadata.master_version, inventory_master_metadata.row_count, inventory_master_metadata.fingerprint into master_version, row_count, fingerprint;
  insert into public.audit_events (inventory_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (target_inventory_id, actor_id, 'MASTER_EXCEPTION_ADDED', 'inventory_master_exception', new_exception_id,
    jsonb_build_object('codigo', normalized_codigo, 'descripcion', normalized_descripcion, 'control_type', derived_control_type, 'reason', normalized_reason, 'master_version', master_version, 'fingerprint', fingerprint));
  return next;
end;
$$;

create or replace function public.prepare_inventory(target_inventory_id uuid)
returns public.inventories language plpgsql security definer set search_path = public, app_private, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if not app_private.can_manage_inventory(target_inventory_id) then raise exception 'Not authorized to manage inventory' using errcode = '42501'; end if;
  perform app_private.lock_inventory(target_inventory_id);
  if not exists (select 1 from public.inventory_master_items where inventory_id = target_inventory_id) then raise exception 'Inventory requires a non-empty master before preparation' using errcode = '23514'; end if;
  return app_private.transition_inventory(target_inventory_id, 'BORRADOR', 'PREPARADO', 'INVENTORY_PREPARED');
end;
$$;

create or replace function public.open_inventory(target_inventory_id uuid)
returns public.inventories language plpgsql security definer set search_path = public, app_private, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if not app_private.can_manage_inventory(target_inventory_id) then raise exception 'Not authorized to manage inventory' using errcode = '42501'; end if;
  perform app_private.lock_inventory(target_inventory_id);
  if not exists (select 1 from public.inventory_master_items where inventory_id = target_inventory_id) then raise exception 'Inventory requires a non-empty master before opening' using errcode = '23514'; end if;
  return app_private.transition_inventory(target_inventory_id, 'PREPARADO', 'ABIERTO', 'INVENTORY_OPENED');
end;
$$;

create or replace function public.close_inventory(target_inventory_id uuid)
returns public.inventories language plpgsql security definer set search_path = public, app_private, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if not app_private.can_manage_inventory(target_inventory_id) then raise exception 'Not authorized to manage inventory' using errcode = '42501'; end if;
  perform app_private.lock_inventory(target_inventory_id);
  return app_private.transition_inventory(target_inventory_id, 'ABIERTO', 'CERRADO', 'INVENTORY_CLOSED');
end;
$$;

create or replace function public.freeze_inventory(target_inventory_id uuid)
returns public.inventories language plpgsql security definer set search_path = public, app_private, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if not app_private.can_manage_inventory(target_inventory_id) then raise exception 'Not authorized to manage inventory' using errcode = '42501'; end if;
  perform app_private.lock_inventory(target_inventory_id);
  if exists (select 1 from public.inventory_freeze_guards where inventory_id = target_inventory_id and resolved_at is null) then raise exception 'Inventory has known pending synchronization records' using errcode = '23514'; end if;
  return app_private.transition_inventory(target_inventory_id, 'CERRADO', 'CONGELADO', 'INVENTORY_FROZEN');
end;
$$;

revoke all on function app_private.lock_inventory(uuid) from public, anon, authenticated;
revoke all on function public.import_inventory_master(uuid, jsonb, text, text), public.add_master_exception(uuid, text, text, text), public.prepare_inventory(uuid), public.open_inventory(uuid), public.close_inventory(uuid), public.freeze_inventory(uuid) from public;
grant execute on function public.import_inventory_master(uuid, jsonb, text, text), public.add_master_exception(uuid, text, text, text), public.prepare_inventory(uuid), public.open_inventory(uuid), public.close_inventory(uuid), public.freeze_inventory(uuid) to authenticated;
