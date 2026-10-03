-- F14 Data Load Center: smart, auditable Maestro replacement.
-- A Maestro reimport in BORRADOR/PREPARADO must not DELETE every row first:
-- references and exception history may protect existing master rows.

alter table public.inventory_master_exceptions
  add column if not exists active boolean not null default true,
  add column if not exists retired_at timestamptz,
  add column if not exists retired_by uuid references public.profiles(user_id) on delete restrict,
  add column if not exists retired_reason text,
  add column if not exists retired_import_identifier text;

alter table public.inventory_master_exceptions
  drop constraint if exists inventory_master_exceptions_inventory_id_codigo_key;
alter table public.inventory_master_exceptions
  drop constraint if exists inventory_master_exceptions_master_item_id_key;

drop index if exists public.inventory_master_exceptions_active_code_unique;
create unique index inventory_master_exceptions_active_code_unique
  on public.inventory_master_exceptions(inventory_id,codigo)
  where active;

drop index if exists public.inventory_master_exceptions_active_item_unique;
create unique index inventory_master_exceptions_active_item_unique
  on public.inventory_master_exceptions(master_item_id)
  where active and master_item_id is not null;

alter table public.inventory_master_exceptions
  drop constraint if exists inventory_master_exceptions_master_item_id_fkey;
alter table public.inventory_master_exceptions
  alter column master_item_id drop not null;
alter table public.inventory_master_exceptions
  add constraint inventory_master_exceptions_master_item_id_fkey
  foreign key(master_item_id)
  references public.inventory_master_items(id)
  on delete set null;

-- Missing-batch authorization is an auditable business decision. Keep its row
-- even if a later Maestro no longer contains the SKU; the RPC still verifies
-- current master membership before it can reactivate/create an authorization.
alter table public.inventory_missing_batch_exceptions
  drop constraint if exists inventory_missing_batch_exceptions_inventory_id_codigo_fkey;

create or replace function public.import_inventory_master(
  target_inventory_id uuid,
  import_items jsonb,
  import_source text,
  import_identifier text default null
)
returns table(master_version integer,row_count integer,fingerprint text)
language plpgsql
security definer
set search_path=public,app_private,pg_temp
as $$
declare
  actor_id uuid:=auth.uid();
  locked_inventory public.inventories;
  normalized_items jsonb;
  normalized_source text:=nullif(btrim(import_source),'');
  normalized_identifier text:=nullif(btrim(import_identifier),'');
  previous_count integer:=0;
  removed_count integer:=0;
  reference_rows_removed integer:=0;
  protected_code text;
begin
  if actor_id is null then raise exception 'Authentication is required' using errcode='42501'; end if;
  if not app_private.is_admin() then raise exception 'Only ADMIN can import a master snapshot' using errcode='42501'; end if;

  locked_inventory:=app_private.lock_inventory(target_inventory_id);
  if locked_inventory.status not in('BORRADOR','PREPARADO') then
    raise exception 'Master import is only allowed in BORRADOR or PREPARADO' using errcode='23514';
  end if;
  if normalized_source is null then raise exception 'Import source is required' using errcode='23514'; end if;
  if jsonb_typeof(import_items)<>'array' or jsonb_array_length(import_items)=0 then
    raise exception 'Master import must contain at least one item' using errcode='23514';
  end if;

  select jsonb_agg(jsonb_build_object(
    'codigo',upper(btrim(item.value->>'codigo')),
    'descripcion',btrim(item.value->>'descripcion')
  ))
  into normalized_items
  from jsonb_array_elements(import_items) item(value);

  if exists(
    select 1 from jsonb_array_elements(normalized_items) item(value)
    where nullif(item.value->>'codigo','') is null
       or nullif(item.value->>'descripcion','') is null
  ) then
    raise exception 'Master items require non-empty codigo and descripcion' using errcode='23514';
  end if;

  if exists(
    select item.value->>'codigo'
    from jsonb_array_elements(normalized_items) item(value)
    group by item.value->>'codigo'
    having count(*)>1
  ) then
    raise exception 'Master import contains duplicate codigo' using errcode='23505';
  end if;

  select count(*)::integer into previous_count
  from public.inventory_master_items
  where inventory_id=target_inventory_id;

  -- Historical server counts are the one relation that must never be detached
  -- from a SKU. If such a row exists, fail closed with the exact protected code.
  select master.codigo
  into protected_code
  from public.inventory_master_items master
  where master.inventory_id=target_inventory_id
    and not exists(
      select 1
      from jsonb_array_elements(normalized_items) item(value)
      where item.value->>'codigo'=master.codigo
    )
    and exists(
      select 1 from public.count_records counts
      where counts.inventory_id=master.inventory_id
        and counts.codigo=master.codigo
    )
  order by master.codigo
  limit 1;

  if protected_code is not null then
    raise exception 'Master import cannot retire SKU % because it has server count records',protected_code
      using errcode='23503',
            detail='Create a new inventory instead of rewriting historical counted SKU.';
  end if;

  -- A system reference is evidence for one precise master universe. Replacing
  -- the Maestro invalidates that evidence and the user must confirm RP again.
  delete from public.inventory_system_reference_items
  where inventory_id=target_inventory_id;
  get diagnostics reference_rows_removed=row_count;

  delete from public.inventory_system_reference_metadata
  where inventory_id=target_inventory_id;

  -- Master exceptions belong to the previous baseline. Preserve history but
  -- retire active authorization before the new baseline is authoritative.
  update public.inventory_master_exceptions
  set active=false,
      retired_at=coalesce(retired_at,now()),
      retired_by=coalesce(retired_by,actor_id),
      retired_reason=coalesce(retired_reason,'MASTER_REIMPORT'),
      retired_import_identifier=coalesce(retired_import_identifier,normalized_identifier)
  where inventory_id=target_inventory_id
    and active;

  -- Missing-batch decisions can remain active only for SKU that still exist in
  -- the new master payload.
  update public.inventory_missing_batch_exceptions exception
  set active=false
  where exception.inventory_id=target_inventory_id
    and exception.active
    and not exists(
      select 1
      from jsonb_array_elements(normalized_items) item(value)
      where item.value->>'codigo'=exception.codigo
    );

  -- Keep stable IDs for existing SKU; insert only truly new codes.
  insert into public.inventory_master_items(
    inventory_id,codigo,descripcion,control_type,source,created_by
  )
  select
    target_inventory_id,
    item.value->>'codigo',
    item.value->>'descripcion',
    case
      when right(item.value->>'codigo',1)='S' then 'SERIAL'::public.master_control_type
      when right(item.value->>'codigo',1)='P' then 'PARTIDA'::public.master_control_type
      else 'LEGACY'::public.master_control_type
    end,
    normalized_source,
    actor_id
  from jsonb_array_elements(normalized_items) item(value)
  on conflict(inventory_id,codigo) do update
  set descripcion=excluded.descripcion,
      control_type=excluded.control_type,
      source=excluded.source;

  delete from public.inventory_master_items master
  where master.inventory_id=target_inventory_id
    and not exists(
      select 1
      from jsonb_array_elements(normalized_items) item(value)
      where item.value->>'codigo'=master.codigo
    );
  get diagnostics removed_count=row_count;

  if (select count(*) from public.inventory_master_items where inventory_id=target_inventory_id)<>jsonb_array_length(normalized_items) then
    raise exception 'Master smart import invariant failed' using errcode='23514';
  end if;

  insert into public.inventory_master_metadata as metadata(
    inventory_id,master_version,row_count,fingerprint,cached_at
  )
  values(
    target_inventory_id,
    1,
    jsonb_array_length(normalized_items),
    app_private.master_fingerprint(target_inventory_id),
    now()
  )
  on conflict(inventory_id) do update
  set master_version=metadata.master_version+1,
      row_count=excluded.row_count,
      fingerprint=excluded.fingerprint,
      cached_at=excluded.cached_at
  returning metadata.master_version,metadata.row_count,metadata.fingerprint
  into master_version,row_count,fingerprint;

  insert into public.audit_events(
    inventory_id,actor_user_id,event_type,entity_type,entity_id,payload
  )
  values(
    target_inventory_id,
    actor_id,
    'MASTER_IMPORTED',
    'inventory_master',
    target_inventory_id,
    jsonb_build_object(
      'mode','SMART_MERGE_V2',
      'source',normalized_source,
      'import_identifier',normalized_identifier,
      'master_version',master_version,
      'row_count',row_count,
      'fingerprint',fingerprint,
      'previous_count',previous_count,
      'removed_count',removed_count,
      'system_reference_rows_reset',reference_rows_removed
    )
  );

  return next;
end;
$$;

revoke all on function public.import_inventory_master(uuid,jsonb,text,text) from public,anon;
grant execute on function public.import_inventory_master(uuid,jsonb,text,text) to authenticated;
