-- F14: Softland is source evidence. For SERIAL rows, preserve the signed
-- source quantities but materialize the operational baseline as presence (0/1).
-- This keeps the existing SERIAL invariant without rejecting ERP anomalies.

create or replace function public.import_inventory_system_reference(
  p_inventory_id uuid,
  p_items jsonb,
  p_source text,
  p_import_identifier text default null
)
returns table(reference_version integer,row_count integer,fingerprint text)
language plpgsql
security definer
set search_path=public,app_private,pg_temp
as $$
declare
  actor uuid:=app_private.require_active_actor();
  src text:=nullif(btrim(p_source),'');
begin
  if not app_private.can_manage_inventory(p_inventory_id) then
    raise exception 'Not authorized to import system reference' using errcode='42501';
  end if;
  if src is null then
    raise exception 'System reference source is required' using errcode='23514';
  end if;
  if not exists(
    select 1 from public.inventories
    where id=p_inventory_id and status in('BORRADOR','PREPARADO')
  ) then
    raise exception 'System reference import is only allowed in BORRADOR or PREPARADO' using errcode='23514';
  end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'System reference requires at least one row' using errcode='23514';
  end if;
  if exists(
    select 1
    from jsonb_array_elements(p_items) x
    where nullif(upper(btrim(x->>'codigo')),'') is null
       or (x->>'quantity') is null
       or coalesce((x->>'available_quantity')::integer,(x->>'quantity')::integer) is null
  ) then
    raise exception 'Invalid system reference row' using errcode='23514';
  end if;
  if exists(
    select 1
    from jsonb_array_elements(p_items) x
    where nullif(x->>'expiration_date','') is not null
      and (x->>'expiration_date') !~ '^\d{4}-\d{2}-\d{2}$'
  ) then
    raise exception 'Invalid system reference expiration date' using errcode='23514';
  end if;
  if exists(
    select 1
    from jsonb_array_elements(p_items) x
    where (x->>'reference_value') like 'EXC-SIN-PARTIDA:%'
      and not exists(
        select 1
        from public.inventory_missing_batch_exceptions e
        where e.inventory_id=p_inventory_id
          and e.codigo=upper(btrim(x->>'codigo'))
          and e.active
          and x->>'reference_value'='EXC-SIN-PARTIDA:'||e.codigo
      )
  ) then
    raise exception 'Missing batch exception is not authorized' using errcode='42501';
  end if;

  delete from public.inventory_system_reference_items
  where inventory_id=p_inventory_id;

  insert into public.inventory_system_reference_items(
    inventory_id,
    codigo,
    reference_type,
    reference_value,
    quantity,
    source_total_quantity,
    source_available_quantity,
    unit_code,
    expiration_date
  )
  select
    p_inventory_id,
    upper(btrim(x->>'codigo')),
    m.control_type,
    nullif(btrim(x->>'reference_value'),''),
    case
      when m.control_type='SERIAL'::public.master_control_type then
        case
          when nullif(btrim(x->>'reference_value'),'') is null then 0
          when coalesce((x->>'available_quantity')::integer,(x->>'quantity')::integer) > 0 then 1
          when (x->>'quantity')::integer > 0 then 1
          else 0
        end
      else greatest(coalesce((x->>'available_quantity')::integer,(x->>'quantity')::integer),0)
    end,
    (x->>'quantity')::integer,
    coalesce((x->>'available_quantity')::integer,(x->>'quantity')::integer),
    nullif(btrim(x->>'unit_code'),''),
    nullif(x->>'expiration_date','')::date
  from jsonb_array_elements(p_items) x
  join public.inventory_master_items m
    on m.inventory_id=p_inventory_id
   and m.codigo=upper(btrim(x->>'codigo'));

  if (
    select count(*)
    from public.inventory_system_reference_items
    where inventory_id=p_inventory_id
  )<>jsonb_array_length(p_items) then
    raise exception 'Every system reference row must match the inventory master and be unique' using errcode='23514';
  end if;

  if exists(
    select 1
    from public.inventory_system_reference_items
    where inventory_id=p_inventory_id
      and (
        (reference_type='SERIAL' and (reference_value is null or quantity not in(0,1)))
        or (reference_type='PARTIDA' and reference_value is null)
      )
  ) then
    raise exception 'System reference control fields do not match master type' using errcode='23514';
  end if;

  insert into public.inventory_system_reference_metadata(
    inventory_id,reference_version,row_count,source,import_identifier,fingerprint,imported_by
  )
  values(
    p_inventory_id,
    1,
    jsonb_array_length(p_items),
    src,
    nullif(btrim(p_import_identifier),''),
    app_private.system_reference_fingerprint(p_inventory_id),
    actor
  )
  on conflict(inventory_id) do update
  set reference_version=public.inventory_system_reference_metadata.reference_version+1,
      row_count=excluded.row_count,
      source=excluded.source,
      import_identifier=excluded.import_identifier,
      fingerprint=excluded.fingerprint,
      imported_by=excluded.imported_by,
      imported_at=now()
  returning
    inventory_system_reference_metadata.reference_version,
    inventory_system_reference_metadata.row_count,
    inventory_system_reference_metadata.fingerprint
  into reference_version,row_count,fingerprint;

  insert into public.audit_events(
    inventory_id,actor_user_id,event_type,entity_type,entity_id,payload
  )
  values(
    p_inventory_id,
    actor,
    'MASTER_IMPORTED',
    'inventory_system_reference',
    p_inventory_id,
    jsonb_build_object(
      'reference_version',reference_version,
      'row_count',row_count,
      'source',src,
      'import_identifier',nullif(btrim(p_import_identifier),''),
      'fingerprint',fingerprint,
      'baseline','DISPONIBLE_NO_NEGATIVO_SERIAL_PRESENCE'
    )
  );

  return next;
end;
$$;

revoke all on function public.import_inventory_system_reference(uuid,jsonb,text,text) from public,anon;
grant execute on function public.import_inventory_system_reference(uuid,jsonb,text,text) to authenticated;
