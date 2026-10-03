-- F14: smart master replacement for offline-first operation.
-- Preserves audit history for master exceptions while allowing a new BORRADOR/PREPARADO
-- snapshot to replace the effective master without DELETE/REINSERT FK failures.

alter table public.inventory_master_exceptions
  add column if not exists active boolean not null default true,
  add column if not exists retired_at timestamptz,
  add column if not exists retired_by uuid references public.profiles(user_id) on delete restrict,
  add column if not exists retired_reason text,
  add column if not exists retired_import_identifier text;

alter table public.inventory_master_exceptions
  drop constraint if exists inventory_master_exceptions_inventory_id_codigo_key;

drop index if exists public.inventory_master_exceptions_active_code_unique;
create unique index inventory_master_exceptions_active_code_unique
  on public.inventory_master_exceptions (inventory_id, codigo)
  where active;

alter table public.inventory_master_exceptions
  drop constraint if exists inventory_master_exceptions_retirement_check;
alter table public.inventory_master_exceptions
  add constraint inventory_master_exceptions_retirement_check check (
    (
      active
      and retired_at is null
      and retired_by is null
      and retired_reason is null
    )
    or
    (
      not active
      and retired_at is not null
      and retired_by is not null
      and length(btrim(coalesce(retired_reason, ''))) > 0
    )
  );

alter table public.inventory_master_exceptions
  drop constraint if exists inventory_master_exceptions_master_item_id_fkey;
alter table public.inventory_master_exceptions
  alter column master_item_id drop not null;
alter table public.inventory_master_exceptions
  add constraint inventory_master_exceptions_master_item_id_fkey
  foreign key (master_item_id)
  references public.inventory_master_items(id)
  on delete set null;

create or replace function public.import_inventory_master(
  target_inventory_id uuid,
  import_items jsonb,
  import_source text,
  import_identifier text default null
)
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
  previous_count integer := 0;
  final_count integer := 0;
  retired_exception_count integer := 0;
  removed_count integer := 0;
  protected_code text;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not app_private.is_admin() then
    raise exception 'Only ADMIN can import a master snapshot' using errcode = '42501';
  end if;

  locked_inventory := app_private.lock_inventory(target_inventory_id);

  if normalized_source is null or normalized_source = '' then
    raise exception 'Import source is required' using errcode = '23514';
  end if;
  if jsonb_typeof(import_items) <> 'array' or jsonb_array_length(import_items) = 0 then
    raise exception 'Master import must contain at least one item' using errcode = '23514';
  end if;
  if locked_inventory.status not in ('BORRADOR', 'PREPARADO') then
    raise exception 'Master import is only allowed in BORRADOR or PREPARADO' using errcode = '23514';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'codigo', upper(btrim(item.value ->> 'codigo')),
      'descripcion', btrim(item.value ->> 'descripcion')
    )
  )
  into normalized_items
  from jsonb_array_elements(import_items) as item(value);

  if exists (
    select 1
    from jsonb_array_elements(normalized_items) as item(value)
    where nullif(item.value ->> 'codigo', '') is null
       or nullif(item.value ->> 'descripcion', '') is null
  ) then
    raise exception 'Master items require non-empty codigo and descripcion' using errcode = '23514';
  end if;

  if exists (
    select item.value ->> 'codigo'
    from jsonb_array_elements(normalized_items) as item(value)
    group by item.value ->> 'codigo'
    having count(*) > 1
  ) then
    raise exception 'Master import contains duplicate codigo' using errcode = '23505';
  end if;

  select count(*)::integer
  into previous_count
  from public.inventory_master_items
  where inventory_id = target_inventory_id;

  -- A BORRADOR/PREPARADO import should not have server count records. Fail with
  -- the concrete code instead of surfacing a generic FK error if legacy/test data
  -- violates that invariant.
  select master.codigo
  into protected_code
  from public.inventory_master_items as master
  where master.inventory_id = target_inventory_id
    and not exists (
      select 1
      from jsonb_array_elements(normalized_items) as item(value)
      where item.value ->> 'codigo' = master.codigo
    )
    and exists (
      select 1
      from public.count_records as counts
      where counts.inventory_id = master.inventory_id
        and counts.codigo = master.codigo
    )
  order by master.codigo
  limit 1;

  if protected_code is not null then
    raise exception 'Master import cannot retire SKU % because it has server count records', protected_code
      using errcode = '23503',
            detail = 'The current snapshot is protected by historical count traceability. Use a new inventory instead of replacing this SKU.';
  end if;

  -- Every new baseline invalidates prior exception authorization. The historical
  -- record remains queryable; if the SKU is still absent when the inventory opens,
  -- ANALISTA/ADMIN must explicitly authorize a new exception.
  update public.inventory_master_exceptions
  set
    active = false,
    retired_at = now(),
    retired_by = actor_id,
    retired_reason = 'MASTER_REIMPORT',
    retired_import_identifier = normalized_identifier
  where inventory_id = target_inventory_id
    and active;

  get diagnostics retired_exception_count = row_count;

  -- Preserve stable master item ids whenever the code remains in the new snapshot.
  -- This is the key difference from the previous delete/reinsert implementation.
  insert into public.inventory_master_items (
    inventory_id,
    codigo,
    descripcion,
    control_type,
    source,
    created_by
  )
  select
    target_inventory_id,
    item.value ->> 'codigo',
    item.value ->> 'descripcion',
    case
      when right(item.value ->> 'codigo', 1) = 'S' then 'SERIAL'::public.master_control_type
      when right(item.value ->> 'codigo', 1) = 'P' then 'PARTIDA'::public.master_control_type
      else 'LEGACY'::public.master_control_type
    end,
    normalized_source,
    actor_id
  from jsonb_array_elements(normalized_items) as item(value)
  on conflict (inventory_id, codigo) do update
  set
    descripcion = excluded.descripcion,
    control_type = excluded.control_type,
    source = excluded.source;

  -- Active exceptions were retired above. Omitted exception-only master rows may
  -- now be removed while their history survives through ON DELETE SET NULL.
  delete from public.inventory_master_items as master
  where master.inventory_id = target_inventory_id
    and not exists (
      select 1
      from jsonb_array_elements(normalized_items) as item(value)
      where item.value ->> 'codigo' = master.codigo
    );

  get diagnostics removed_count = row_count;

  select count(*)::integer
  into final_count
  from public.inventory_master_items
  where inventory_id = target_inventory_id;

  if final_count <> jsonb_array_length(normalized_items) then
    raise exception 'Master smart import invariant failed: expected % rows and materialized %',
      jsonb_array_length(normalized_items), final_count
      using errcode = '23514';
  end if;

  insert into public.inventory_master_metadata as metadata (
    inventory_id,
    master_version,
    row_count,
    fingerprint,
    cached_at
  )
  values (
    target_inventory_id,
    1,
    final_count,
    app_private.master_fingerprint(target_inventory_id),
    now()
  )
  on conflict (inventory_id) do update
  set
    master_version = metadata.master_version + 1,
    row_count = excluded.row_count,
    fingerprint = excluded.fingerprint,
    cached_at = excluded.cached_at
  returning metadata.master_version, metadata.row_count, metadata.fingerprint
  into master_version, row_count, fingerprint;

  insert into public.audit_events (
    inventory_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  )
  values (
    target_inventory_id,
    actor_id,
    'MASTER_IMPORTED',
    'inventory_master',
    target_inventory_id,
    jsonb_build_object(
      'mode', 'SMART_MERGE_V1',
      'total', jsonb_array_length(normalized_items),
      'valid', row_count,
      'source', normalized_source,
      'import_identifier', normalized_identifier,
      'master_version', master_version,
      'fingerprint', fingerprint,
      'previous_count', previous_count,
      'removed_count', removed_count,
      'retired_exceptions', retired_exception_count
    )
  );

  return next;
end;
$$;

revoke all on function public.import_inventory_master(uuid, jsonb, text, text) from public, anon;
grant execute on function public.import_inventory_master(uuid, jsonb, text, text) to authenticated;
