-- Fase 8B: rectificaciones append-only y reservas de artefactos. No genera bytes.

create type public.artifact_generation_status as enum ('REQUESTED', 'FILE_GENERATED', 'VALIDATED', 'READY', 'ERROR');
create type public.artifact_generation_scope as enum ('CUT_SNAPSHOT', 'CUT_READY_BACKUP', 'FINAL_FROZEN_BACKUP', 'RECTIFICATION_XLSX');
create type public.artifact_request_origin as enum ('USER', 'SYSTEM');

alter type public.audit_event_type add value if not exists 'ARTIFACT_REQUESTED';
alter type public.audit_event_type add value if not exists 'ARTIFACT_FILE_GENERATED';
alter type public.audit_event_type add value if not exists 'ARTIFACT_VALIDATED';
alter type public.audit_event_type add value if not exists 'ARTIFACT_READY';
alter type public.audit_event_type add value if not exists 'ARTIFACT_ERROR';
alter type public.audit_event_type add value if not exists 'ARTIFACT_DOWNLOADED';

alter table public.inventory_cuts add column ready_at timestamptz;
update public.inventory_cuts set ready_at = updated_at where status = 'READY' and ready_at is null;
alter table public.inventory_cuts add constraint inventory_cuts_ready_at_matches_status check (
  (status = 'READY' and ready_at is not null) or (status <> 'READY' and ready_at is null)
);

alter table public.generated_files add column mime_type text not null default 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
alter table public.generated_files add constraint generated_files_mime_type_matches_file_type check (
  (file_type in ('CUT_XLSX', 'RECTIFICATION_XLSX') and mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  or (file_type = 'SNAPSHOT' and mime_type = 'application/json')
  or (file_type = 'TECHNICAL_BACKUP' and mime_type = 'application/zip')
);

alter table public.cut_rectifications add column request_id uuid not null default gen_random_uuid();
alter table public.cut_rectifications add column request_fingerprint text not null default repeat('0', 64) check (request_fingerprint ~ '^[a-f0-9]{64}$');
alter table public.cut_rectifications add constraint cut_rectifications_cut_request_id_key unique (cut_id, request_id);
alter table public.cut_rectifications alter column request_id drop default;
alter table public.cut_rectifications alter column request_fingerprint drop default;

create table public.artifact_generations (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories(id) on delete restrict,
  cut_id uuid,
  rectification_id uuid,
  artifact_type public.generated_file_type not null,
  scope public.artifact_generation_scope not null,
  request_id uuid not null unique,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  request_origin public.artifact_request_origin not null,
  requested_by uuid not null references public.profiles(user_id) on delete restrict,
  status public.artifact_generation_status not null default 'REQUESTED',
  storage_path text not null unique check (length(btrim(storage_path)) > 0),
  sha256 text check (sha256 is null or sha256 ~ '^[A-Fa-f0-9]{64}$'),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  generator_version text,
  as_of_at timestamptz,
  error_safe text check (error_safe is null or length(error_safe) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, inventory_id),
  foreign key (cut_id, inventory_id) references public.inventory_cuts(id, inventory_id) on delete restrict,
  foreign key (rectification_id, inventory_id) references public.cut_rectifications(id, inventory_id) on delete restrict,
  check (
    (artifact_type = 'SNAPSHOT' and scope = 'CUT_SNAPSHOT' and cut_id is not null and rectification_id is null and as_of_at is not null)
    or (artifact_type = 'TECHNICAL_BACKUP' and scope = 'CUT_READY_BACKUP' and cut_id is not null and rectification_id is null and as_of_at is not null)
    or (artifact_type = 'TECHNICAL_BACKUP' and scope = 'FINAL_FROZEN_BACKUP' and cut_id is null and rectification_id is null and as_of_at is not null)
    or (artifact_type = 'RECTIFICATION_XLSX' and scope = 'RECTIFICATION_XLSX' and cut_id is not null and rectification_id is not null)
  ),
  check ((status = 'READY' and sha256 is not null and size_bytes is not null) or status <> 'READY')
);

create unique index artifact_generations_one_snapshot_per_cut on public.artifact_generations (cut_id) where scope = 'CUT_SNAPSHOT';
create unique index artifact_generations_one_cut_ready_backup_per_cut on public.artifact_generations (cut_id) where scope = 'CUT_READY_BACKUP';
create unique index artifact_generations_one_rectification_xlsx on public.artifact_generations (rectification_id) where scope = 'RECTIFICATION_XLSX';
create unique index artifact_generations_one_final_backup_per_inventory on public.artifact_generations (inventory_id) where scope = 'FINAL_FROZEN_BACKUP';
create index artifact_generations_inventory_created_idx on public.artifact_generations (inventory_id, created_at desc);
create trigger artifact_generations_set_updated_at before update on public.artifact_generations for each row execute function public.set_updated_at();

alter table public.artifact_generations enable row level security;
create policy artifact_generations_select_scoped on public.artifact_generations for select to authenticated using (
  (artifact_type = 'TECHNICAL_BACKUP' and (select app_private.is_admin()))
  or (artifact_type <> 'TECHNICAL_BACKUP' and (select app_private.can_manage_inventory(inventory_id)))
);

drop policy if exists files_select_manager on public.generated_files;
create policy files_select_f8_scoped on public.generated_files for select to authenticated using (
  (file_type = 'TECHNICAL_BACKUP' and (select app_private.is_admin()))
  or (file_type <> 'TECHNICAL_BACKUP' and (select app_private.can_manage_inventory(inventory_id)))
);

create or replace function app_private.artifact_fingerprint(
  p_inventory_id uuid,
  p_cut_id uuid,
  p_rectification_id uuid,
  p_artifact_type public.generated_file_type,
  p_scope public.artifact_generation_scope,
  p_as_of_at timestamptz,
  p_requested_by uuid
) returns text
language sql
immutable
security definer
set search_path = public, app_private, pg_temp
as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'artifact_type', p_artifact_type,
    'as_of_at', p_as_of_at,
    'cut_id', p_cut_id,
    'inventory_id', p_inventory_id,
    'rectification_id', p_rectification_id,
    'requested_by', p_requested_by,
    'scope', p_scope
  )::text, 'utf8'), 'sha256'), 'hex')
$$;

create or replace function app_private.reserve_artifact_generation(
  p_inventory_id uuid,
  p_cut_id uuid,
  p_rectification_id uuid,
  p_artifact_type public.generated_file_type,
  p_scope public.artifact_generation_scope,
  p_request_id uuid,
  p_request_origin public.artifact_request_origin,
  p_requested_by uuid,
  p_as_of_at timestamptz
) returns public.artifact_generations
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  v_existing public.artifact_generations%rowtype;
  v_row public.artifact_generations%rowtype;
  v_id uuid := gen_random_uuid();
  v_fingerprint text;
  v_path text;
begin
  if p_request_id is null or p_requested_by is null then
    raise exception 'Artifact request_id and requested_by are required' using errcode = '23514';
  end if;
  v_fingerprint := app_private.artifact_fingerprint(p_inventory_id, p_cut_id, p_rectification_id, p_artifact_type, p_scope, p_as_of_at, p_requested_by);

  select * into v_existing from public.artifact_generations where request_id = p_request_id for update;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23514';
    end if;
    return v_existing;
  end if;

  select * into v_existing from public.artifact_generations
  where inventory_id = p_inventory_id
    and scope = p_scope
    and cut_id is not distinct from p_cut_id
    and rectification_id is not distinct from p_rectification_id
  for update;
  if found then
    return v_existing;
  end if;

  v_path := case p_scope
    when 'CUT_SNAPSHOT' then format('inventory/%s/cuts/%s/snapshots/%s.json', p_inventory_id, p_cut_id, v_id)
    when 'CUT_READY_BACKUP' then format('inventory/%s/cuts/%s/backups/%s.zip', p_inventory_id, p_cut_id, v_id)
    when 'FINAL_FROZEN_BACKUP' then format('inventory/%s/backups/%s.zip', p_inventory_id, v_id)
    when 'RECTIFICATION_XLSX' then format('inventory/%s/cuts/%s/rectifications/%s/%s.xlsx', p_inventory_id, p_cut_id, p_rectification_id, v_id)
  end;

  insert into public.artifact_generations (
    id, inventory_id, cut_id, rectification_id, artifact_type, scope, request_id,
    request_fingerprint, request_origin, requested_by, storage_path, as_of_at
  ) values (
    v_id, p_inventory_id, p_cut_id, p_rectification_id, p_artifact_type, p_scope, p_request_id,
    v_fingerprint, p_request_origin, p_requested_by, v_path, p_as_of_at
  ) returning * into v_row;

  insert into public.audit_events (inventory_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (p_inventory_id, p_requested_by, 'ARTIFACT_REQUESTED', 'artifact_generation', v_row.id,
    jsonb_build_object(
      'artifact_generation_id', v_row.id, 'artifact_type', v_row.artifact_type,
      'scope', v_row.scope, 'cut_id', v_row.cut_id, 'rectification_id', v_row.rectification_id,
      'request_origin', v_row.request_origin, 'requested_by', v_row.requested_by,
      'as_of_at', v_row.as_of_at
    ));
  return v_row;
end;
$$;

create or replace function app_private.canonical_rectification_payload(p_payload jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  v_location text;
  v_codigo text;
  v_serie text;
  v_partida text;
  v_pieza_producto text;
  v_fecha date;
  v_talla text;
  v_color text;
  v_cantidad integer;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'INVALID_PHYSICAL_PAYLOAD' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_payload) as payload_keys(key_name)
    where key_name not in ('ubicacion', 'codigo', 'serie', 'partida', 'pieza_producto', 'fecha_vencimiento', 'talla', 'color', 'cantidad_contada')
  ) then
    raise exception 'UNEXPECTED_PHYSICAL_PAYLOAD_KEY' using errcode = '23514';
  end if;
  v_location := upper(nullif(btrim(p_payload ->> 'ubicacion'), ''));
  v_codigo := upper(nullif(btrim(p_payload ->> 'codigo'), ''));
  v_serie := nullif(btrim(p_payload ->> 'serie'), '');
  v_partida := nullif(btrim(p_payload ->> 'partida'), '');
  v_pieza_producto := nullif(btrim(p_payload ->> 'pieza_producto'), '');
  v_talla := nullif(btrim(p_payload ->> 'talla'), '');
  v_color := nullif(btrim(p_payload ->> 'color'), '');
  if nullif(p_payload ->> 'fecha_vencimiento', '') is not null then
    if (p_payload ->> 'fecha_vencimiento') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'INVALID_DATE' using errcode = '23514';
    end if;
    v_fecha := (p_payload ->> 'fecha_vencimiento')::date;
  end if;
  begin
    v_cantidad := (p_payload ->> 'cantidad_contada')::integer;
  exception when others then
    raise exception 'INVALID_QUANTITY' using errcode = '23514';
  end;
  if v_location is null or v_location !~ '^(A|B|C|C2|D|F|G|H|I)-[0-9]{2}-[0-9]{2}$' then
    raise exception 'INVALID_LOCATION' using errcode = '23514';
  end if;
  if v_codigo is null or v_cantidad is null or v_cantidad <= 0 then
    raise exception 'INVALID_PHYSICAL_PAYLOAD' using errcode = '23514';
  end if;
  return jsonb_build_object(
    'ubicacion', v_location, 'codigo', v_codigo, 'serie', v_serie, 'partida', v_partida,
    'pieza_producto', v_pieza_producto, 'fecha_vencimiento', v_fecha,
    'talla', v_talla, 'color', v_color, 'cantidad_contada', v_cantidad
  );
end;
$$;

create or replace function app_private.snapshot_rectification_values(p_snapshot jsonb)
returns jsonb
language sql
immutable
security definer
set search_path = public, app_private, pg_temp
as $$
  select jsonb_build_object(
    'ubicacion', p_snapshot ->> 'ubicacion',
    'codigo', p_snapshot ->> 'codigo',
    'serie', nullif(p_snapshot ->> 'serie', ''),
    'partida', nullif(p_snapshot ->> 'partida', ''),
    'pieza_producto', nullif(p_snapshot ->> 'pieza_producto', ''),
    'fecha_vencimiento', nullif(p_snapshot ->> 'fecha_vencimiento', ''),
    'talla', nullif(p_snapshot ->> 'talla', ''),
    'color', nullif(p_snapshot ->> 'color', ''),
    'cantidad_contada', (p_snapshot ->> 'cantidad_contada')::integer,
    'descripcion', p_snapshot ->> 'descripcion'
  )
$$;

create or replace function public.rectify_cut(
  p_cut_id uuid,
  p_count_record_id uuid,
  p_physical_payload jsonb,
  p_reason text,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  v_actor uuid := app_private.require_active_actor();
  v_cut public.inventory_cuts%rowtype;
  v_inventory public.inventories%rowtype;
  v_item public.inventory_cut_items%rowtype;
  v_master public.inventory_master_items%rowtype;
  v_existing public.cut_rectifications%rowtype;
  v_rectification public.cut_rectifications%rowtype;
  v_physical jsonb;
  v_new_values jsonb;
  v_old_values jsonb;
  v_reason text := nullif(btrim(p_reason), '');
  v_fingerprint text;
  v_number integer;
begin
  if p_request_id is null then raise exception 'Rectification request_id is required' using errcode = '23514'; end if;
  if v_reason is null or length(v_reason) > 500 then
    raise exception 'Rectification reason is required and must be at most 500 characters' using errcode = '23514';
  end if;

  select * into v_cut from public.inventory_cuts where id = p_cut_id;
  if not found then raise exception 'Cut not found' using errcode = 'P0002'; end if;
  perform app_private.lock_inventory(v_cut.inventory_id);
  select * into v_inventory from public.inventories where id = v_cut.inventory_id for update;
  select * into v_cut from public.inventory_cuts where id = p_cut_id for update;
  if not app_private.can_manage_inventory(v_cut.inventory_id) then
    raise exception 'Not authorized to rectify cut' using errcode = '42501';
  end if;
  if v_cut.status <> 'READY' then raise exception 'Cut must be READY for rectification' using errcode = '23514'; end if;
  if v_inventory.status not in ('ABIERTO', 'CERRADO', 'CONGELADO') then
    raise exception 'Inventory state does not permit rectification' using errcode = '23514';
  end if;

  v_physical := app_private.canonical_rectification_payload(p_physical_payload);
  select * into v_master from public.inventory_master_items where inventory_id = v_cut.inventory_id and codigo = v_physical ->> 'codigo';
  if not found then raise exception 'UNKNOWN_SKU' using errcode = '23514'; end if;
  if v_master.control_type = 'SERIAL' and ((v_physical ->> 'serie') is null or length(v_physical ->> 'serie') > 19 or (v_physical ->> 'partida') is not null or (v_physical ->> 'cantidad_contada')::integer <> 1) then
    raise exception 'INVALID_SERIAL' using errcode = '23514';
  end if;
  if v_master.control_type = 'PARTIDA' and ((v_physical ->> 'partida') is null or (v_physical ->> 'serie') is not null) then
    raise exception 'INVALID_BATCH' using errcode = '23514';
  end if;
  v_new_values := v_physical || jsonb_build_object('descripcion', v_master.descripcion);
  v_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'actor_user_id', v_actor, 'canonical_physical_payload', v_physical,
    'count_record_id', p_count_record_id, 'cut_id', p_cut_id, 'normalized_reason', v_reason
  )::text, 'utf8'), 'sha256'), 'hex');

  select * into v_existing from public.cut_rectifications where cut_id = p_cut_id and request_id = p_request_id for update;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23514';
    end if;
    return jsonb_build_object('id', v_existing.id, 'rectification_number', v_existing.rectification_number, 'idempotent', true);
  end if;

  select * into v_item from public.inventory_cut_items where cut_id = p_cut_id and count_record_id = p_count_record_id;
  if not found then raise exception 'Count record does not belong to cut snapshot' using errcode = '23514'; end if;
  select new_values into v_old_values from public.cut_rectifications
  where cut_id = p_cut_id and count_record_id = p_count_record_id
  order by rectification_number desc limit 1;
  if v_old_values is null then v_old_values := app_private.snapshot_rectification_values(v_item.snapshot); end if;
  select coalesce(max(rectification_number), 0) + 1 into v_number from public.cut_rectifications where cut_id = p_cut_id;

  insert into public.cut_rectifications (
    inventory_id, cut_id, count_record_id, rectification_number, old_values, new_values,
    reason, request_id, request_fingerprint, created_by
  ) values (
    v_cut.inventory_id, p_cut_id, p_count_record_id, v_number, v_old_values, v_new_values,
    v_reason, p_request_id, v_fingerprint, v_actor
  ) returning * into v_rectification;

  insert into public.audit_events (inventory_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (v_cut.inventory_id, v_actor, 'RECTIFICATION_CREATED', 'cut_rectification', v_rectification.id,
    jsonb_build_object(
      'cut_id', p_cut_id, 'count_record_id', p_count_record_id,
      'rectification_id', v_rectification.id, 'rectification_number', v_number,
      'request_id', p_request_id,
      'old_values_sha256', encode(extensions.digest(convert_to(v_old_values::text, 'utf8'), 'sha256'), 'hex'),
      'new_values_sha256', encode(extensions.digest(convert_to(v_new_values::text, 'utf8'), 'sha256'), 'hex')
    ));
  perform app_private.reserve_artifact_generation(
    v_cut.inventory_id, p_cut_id, v_rectification.id, 'RECTIFICATION_XLSX', 'RECTIFICATION_XLSX',
    p_request_id, 'SYSTEM', v_actor, null
  );
  return jsonb_build_object('id', v_rectification.id, 'rectification_number', v_number, 'idempotent', false);
end;
$$;

create or replace function public.finalize_cut_file(p_cut_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  v_cut public.inventory_cuts%rowtype;
  v_file public.generated_files%rowtype;
  v_ready_at timestamptz;
begin
  perform app_private.require_generator();
  select * into v_cut from public.inventory_cuts where id = p_cut_id for update;
  if not found or v_cut.generation_request_id <> p_request_id then raise exception 'Invalid finalize transition' using errcode = '23514'; end if;
  if v_cut.status = 'READY' then return jsonb_build_object('status', 'READY', 'file_name', v_cut.file_name, 'ready_at', v_cut.ready_at); end if;
  if v_cut.status <> 'VALIDATED' then raise exception 'Invalid finalize transition' using errcode = '23514'; end if;
  select * into v_file from public.generated_files where cut_id = p_cut_id and file_type = 'CUT_XLSX';
  if not found or v_file.sha256 <> v_cut.file_hash then raise exception 'Generated artifact is missing' using errcode = '23514'; end if;
  v_ready_at := now();
  update public.inventory_cuts set status = 'READY', ready_at = v_ready_at, generation_error = null where id = p_cut_id;
  insert into public.audit_events(inventory_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values(v_cut.inventory_id, v_cut.generation_requested_by, 'CUT_READY', 'inventory_cut', p_cut_id,
    jsonb_build_object('cut_id', p_cut_id, 'cut_number', v_cut.cut_number, 'file_name', v_file.file_name,
      'sha256', v_file.sha256, 'size_bytes', v_file.size_bytes, 'generator_version', v_cut.generator_version,
      'generation_requested_by', v_cut.generation_requested_by, 'ready_at', v_ready_at));
  perform app_private.reserve_artifact_generation(v_cut.inventory_id, p_cut_id, null, 'SNAPSHOT', 'CUT_SNAPSHOT', gen_random_uuid(), 'SYSTEM', v_cut.generation_requested_by, v_ready_at);
  perform app_private.reserve_artifact_generation(v_cut.inventory_id, p_cut_id, null, 'TECHNICAL_BACKUP', 'CUT_READY_BACKUP', gen_random_uuid(), 'SYSTEM', v_cut.generation_requested_by, v_ready_at);
  return jsonb_build_object('status', 'READY', 'file_name', v_file.file_name, 'ready_at', v_ready_at);
end;
$$;

create or replace function public.freeze_inventory(target_inventory_id uuid)
returns public.inventories
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  v_actor uuid := app_private.require_active_actor();
  v_inventory public.inventories%rowtype;
begin
  if not app_private.can_manage_inventory(target_inventory_id) then raise exception 'Not authorized to manage inventory' using errcode = '42501'; end if;
  perform app_private.lock_inventory(target_inventory_id);
  if exists (select 1 from public.inventory_freeze_guards where inventory_id = target_inventory_id and resolved_at is null) then
    raise exception 'Inventory has known pending synchronization records' using errcode = '23514';
  end if;
  v_inventory := app_private.transition_inventory(target_inventory_id, 'CERRADO', 'CONGELADO', 'INVENTORY_FROZEN');
  perform app_private.reserve_artifact_generation(v_inventory.id, null, null, 'TECHNICAL_BACKUP', 'FINAL_FROZEN_BACKUP', gen_random_uuid(), 'SYSTEM', v_actor, v_inventory.frozen_at);
  return v_inventory;
end;
$$;

revoke all on table public.artifact_generations from public, anon, authenticated;
grant select on public.artifact_generations to authenticated;
grant select on public.artifact_generations to service_role;
revoke insert, update, delete on public.cut_rectifications, public.generated_files, public.artifact_generations from authenticated;
revoke all on function app_private.artifact_fingerprint(uuid, uuid, uuid, public.generated_file_type, public.artifact_generation_scope, timestamptz, uuid), app_private.reserve_artifact_generation(uuid, uuid, uuid, public.generated_file_type, public.artifact_generation_scope, uuid, public.artifact_request_origin, uuid, timestamptz), app_private.canonical_rectification_payload(jsonb), app_private.snapshot_rectification_values(jsonb) from public, anon, authenticated;
revoke all on function public.rectify_cut(uuid, uuid, jsonb, text, uuid) from public, anon;
grant execute on function public.rectify_cut(uuid, uuid, jsonb, text, uuid) to authenticated;
revoke all on function public.finalize_cut_file(uuid, uuid) from public, anon, authenticated;
grant execute on function public.finalize_cut_file(uuid, uuid) to service_role;
