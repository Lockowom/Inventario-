-- F14: RP may legitimately expose positive stock for a PARTIDA SKU without
-- Partida/Talla. Preserve that quantity as evidence and materialize a dedicated
-- reconciliation finding instead of blocking the complete RP snapshot.

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.inventory_system_reference_items'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%reference_type%'
      and pg_get_constraintdef(oid) ilike '%PARTIDA%'
  loop
    execute format(
      'alter table public.inventory_system_reference_items drop constraint %I',
      constraint_name
    );
  end loop;
end;
$$;

alter table public.inventory_system_reference_items
  add constraint inventory_system_reference_control_shape check (
    (reference_type = 'SERIAL' and reference_value is not null and quantity in (0, 1))
    or reference_type = 'PARTIDA'
    or reference_type = 'LEGACY'
  );

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
    select 1
    from public.inventories
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
       or (x->>'quantity')::integer<0
  ) then
    raise exception 'Invalid system reference row' using errcode='23514';
  end if;

  delete from public.inventory_system_reference_items
  where inventory_id=p_inventory_id;

  insert into public.inventory_system_reference_items(
    inventory_id,codigo,reference_type,reference_value,quantity
  )
  select
    p_inventory_id,
    upper(btrim(x->>'codigo')),
    m.control_type,
    nullif(btrim(x->>'reference_value'),''),
    (x->>'quantity')::integer
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
      and reference_type='SERIAL'
      and (reference_value is null or quantity not in(0,1))
  ) then
    raise exception 'System reference control fields do not match master type' using errcode='23514';
  end if;

  insert into public.inventory_system_reference_metadata(
    inventory_id,reference_version,row_count,source,import_identifier,fingerprint,imported_by
  )
  values(
    p_inventory_id,1,jsonb_array_length(p_items),src,
    nullif(btrim(p_import_identifier),''),
    app_private.system_reference_fingerprint(p_inventory_id),
    actor
  )
  on conflict(inventory_id) do update set
    reference_version=public.inventory_system_reference_metadata.reference_version+1,
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
    p_inventory_id,actor,'MASTER_IMPORTED','inventory_system_reference',p_inventory_id,
    jsonb_build_object(
      'reference_version',reference_version,
      'row_count',row_count,
      'source',src,
      'import_identifier',nullif(btrim(p_import_identifier),''),
      'fingerprint',fingerprint
    )
  );

  return next;
end;
$$;

revoke all on function public.import_inventory_system_reference(uuid,jsonb,text,text) from public,anon;
grant execute on function public.import_inventory_system_reference(uuid,jsonb,text,text) to authenticated;

create or replace function public.materialize_reconciliation_cases(p_inventory_id uuid)
returns table(created_count integer,existing_count integer,source_fingerprint text)
language plpgsql
security definer
set search_path=public,app_private,pg_temp
as $$
declare
  actor uuid:=app_private.require_active_actor();
  fp text;
  made integer:=0;
  existed integer:=0;
begin
  if not app_private.can_manage_inventory(p_inventory_id) then
    raise exception 'Not authorized for reconciliation materialization' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.inventories
    where id=p_inventory_id and status='ABIERTO'
  ) then
    raise exception 'Reconciliation materialization requires an open inventory' using errcode='23514';
  end if;

  select fingerprint
  into fp
  from public.inventory_system_reference_metadata
  where inventory_id=p_inventory_id;

  if fp is null then
    raise exception 'System reference snapshot is required' using errcode='23514';
  end if;

  with physical_base as (
    select
      c.*,
      m.control_type,
      case
        when m.control_type='SERIAL' then c.serie
        when m.control_type='PARTIDA' then c.partida
        else null
      end reference_value
    from public.count_records c
    join public.inventory_master_items m
      on m.inventory_id=c.inventory_id and m.codigo=c.codigo
    where c.inventory_id=p_inventory_id
  ),
  physical as (
    select
      codigo,
      control_type,
      reference_value,
      sum(cantidad_contada)::integer quantity,
      count(*)::integer observation_count,
      (array_agg(id order by received_at,captured_at,created_at,id))[1] first_count_record_id
    from physical_base
    group by codigo,control_type,reference_value
  ),
  joined as (
    select
      coalesce(s.codigo,p.codigo) codigo,
      coalesce(s.reference_type,p.control_type) reference_type,
      coalesce(s.reference_value,p.reference_value) reference_value,
      coalesce(s.quantity,0) system_quantity,
      coalesce(p.quantity,0) physical_quantity,
      coalesce(p.observation_count,0) physical_observation_count,
      p.first_count_record_id
    from public.inventory_system_reference_items s
    full join physical p
      on p.codigo=s.codigo
     and p.control_type=s.reference_type
     and coalesce(p.reference_value,'')=coalesce(s.reference_value,'')
    where coalesce(s.inventory_id,p_inventory_id)=p_inventory_id
  ),
  anomalies as (
    select j.*,'DUPLICADO_SERIE'::text anomaly_type
    from joined j
    where j.reference_type='SERIAL' and j.physical_observation_count>1

    union all
    select j.*,'SERIE_FISICA_NO_EN_SISTEMA'
    from joined j
    where j.reference_type='SERIAL' and j.system_quantity=0 and j.physical_quantity>0

    union all
    select j.*,'SERIE_SISTEMA_NO_CONTADA'
    from joined j
    where j.reference_type='SERIAL' and j.system_quantity>0 and j.physical_quantity=0

    union all
    select j.*,'PARTIDA_SISTEMA_SIN_REFERENCIA'
    from joined j
    where j.reference_type='PARTIDA'
      and j.reference_value is null
      and j.system_quantity>0

    union all
    select j.*,'PARTIDA_FISICA_NO_EN_SISTEMA'
    from joined j
    where j.reference_type='PARTIDA'
      and j.reference_value is not null
      and j.system_quantity=0
      and j.physical_quantity>0

    union all
    select j.*,'PARTIDA_SISTEMA_NO_CONTADA'
    from joined j
    where j.reference_type='PARTIDA'
      and j.reference_value is not null
      and j.system_quantity>0
      and j.physical_quantity=0

    union all
    select j.*,'DIFERENCIA_CANTIDAD_PARTIDA'
    from joined j
    where j.reference_type='PARTIDA'
      and j.reference_value is not null
      and j.system_quantity>0
      and j.physical_quantity>0
      and j.system_quantity<>j.physical_quantity

    union all
    select j.*,'DIFERENCIA_CANTIDAD_SKU'
    from joined j
    where j.reference_type='LEGACY'
      and j.system_quantity<>j.physical_quantity
  ),
  ins as (
    insert into public.reconciliation_cases(
      inventory_id,codigo,reference_type,reference_value,anomaly_type,
      system_quantity,physical_quantity,first_count_record_id,created_by,source_fingerprint
    )
    select
      p_inventory_id,codigo,reference_type,reference_value,anomaly_type,
      system_quantity,physical_quantity,first_count_record_id,actor,fp
    from anomalies
    on conflict do nothing
    returning 1
  )
  select count(*)::integer into made from ins;

  select count(*)::integer
  into existed
  from public.reconciliation_cases rc
  where rc.inventory_id=p_inventory_id
    and rc.source_fingerprint=fp
    and rc.status<>'RESUELTO';

  insert into public.audit_events(
    inventory_id,actor_user_id,event_type,entity_type,entity_id,payload
  )
  values(
    p_inventory_id,actor,'MASTER_IMPORTED','reconciliation_materialization',p_inventory_id,
    jsonb_build_object(
      'source_fingerprint',fp,
      'created_count',made,
      'open_case_count',existed
    )
  );

  created_count:=made;
  existing_count:=existed;
  source_fingerprint:=fp;
  return next;
end;
$$;

revoke all on function public.materialize_reconciliation_cases(uuid) from public,anon;
grant execute on function public.materialize_reconciliation_cases(uuid) to authenticated;
