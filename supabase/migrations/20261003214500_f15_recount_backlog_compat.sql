-- F15 compatibility for reconciliation cases materialized by the pre-F15 engine.
-- Old untouched Softland rows remain preserved in history, but are no longer exposed
-- as active work. If a legacy case now has a real physical observation, materialize
-- promotes that same case into the mission workflow instead of creating a duplicate.

create or replace function public.materialize_reconciliation_cases(p_inventory_id uuid)
returns table(created_count integer,existing_count integer,source_fingerprint text)
language plpgsql
security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  actor uuid:=app_private.require_active_actor();
  fp text;
  made integer:=0;
  existed integer:=0;
begin
  if not app_private.can_manage_inventory(p_inventory_id) then
    raise exception 'Not authorized for reconciliation materialization' using errcode='42501';
  end if;
  if not exists(select 1 from public.inventories where id=p_inventory_id and status='ABIERTO') then
    raise exception 'Reconciliation materialization requires an open inventory' using errcode='23514';
  end if;

  select fingerprint into fp
  from public.inventory_system_reference_metadata
  where inventory_id=p_inventory_id;
  if fp is null then
    raise exception 'System reference snapshot is required' using errcode='23514';
  end if;

  with physical_base as (
    select
      c.*,
      m.control_type,
      case when m.control_type='SERIAL' then c.serie when m.control_type='PARTIDA' then c.partida else null end reference_value
    from public.count_records c
    join public.inventory_master_items m on m.inventory_id=c.inventory_id and m.codigo=c.codigo
    where c.inventory_id=p_inventory_id
      and not exists(
        select 1 from public.recount_mission_observations o where o.count_record_id=c.id
      )
  ), physical as (
    select
      codigo,
      control_type,
      reference_value,
      sum(cantidad_contada)::integer quantity,
      count(*)::integer observation_count,
      (array_agg(id order by received_at,captured_at,created_at,id))[1] first_count_record_id
    from physical_base
    group by codigo,control_type,reference_value
  ), joined as (
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
  ), anomalies as (
    select j.*,'DUPLICADO_SERIE'::text anomaly_type
    from joined j
    where j.reference_type='SERIAL' and j.physical_observation_count>1

    union all
    select j.*,'SERIE_FISICA_NO_EN_SISTEMA'
    from joined j
    where j.reference_type='SERIAL' and j.system_quantity=0 and j.physical_quantity>0

    union all
    select j.*,'PARTIDA_FISICA_NO_EN_SISTEMA'
    from joined j
    where j.reference_type='PARTIDA' and j.system_quantity=0 and j.physical_quantity>0

    union all
    select j.*,'DIFERENCIA_CANTIDAD_PARTIDA'
    from joined j
    where j.reference_type='PARTIDA'
      and j.system_quantity>0
      and j.physical_quantity>0
      and j.system_quantity<>j.physical_quantity

    union all
    select j.*,'DIFERENCIA_CANTIDAD_SKU'
    from joined j
    where j.reference_type='LEGACY'
      and j.physical_quantity>0
      and j.system_quantity<>j.physical_quantity
  ), promoted as (
    update public.reconciliation_cases rc
    set system_quantity=a.system_quantity,
        physical_quantity=a.physical_quantity,
        first_count_record_id=coalesce(rc.first_count_record_id,a.first_count_record_id),
        status=case
          when rc.status='PENDIENTE_ANALISIS' then 'REQUIERE_2DO_CONTEO'::public.reconciliation_status
          else rc.status
        end
    from anomalies a
    where rc.inventory_id=p_inventory_id
      and rc.source_fingerprint=fp
      and rc.status<>'RESUELTO'
      and rc.codigo=a.codigo
      and rc.reference_type=a.reference_type
      and coalesce(rc.reference_value,'')=coalesce(a.reference_value,'')
      and rc.anomaly_type=a.anomaly_type
    returning rc.id
  ), ins as (
    insert into public.reconciliation_cases(
      inventory_id,codigo,reference_type,reference_value,anomaly_type,
      system_quantity,physical_quantity,status,first_count_record_id,created_by,source_fingerprint
    )
    select
      p_inventory_id,a.codigo,a.reference_type,a.reference_value,a.anomaly_type,
      a.system_quantity,a.physical_quantity,'REQUIERE_2DO_CONTEO',a.first_count_record_id,actor,fp
    from anomalies a
    where not exists(
      select 1
      from public.reconciliation_cases rc
      where rc.inventory_id=p_inventory_id
        and rc.source_fingerprint=fp
        and rc.status<>'RESUELTO'
        and rc.codigo=a.codigo
        and rc.reference_type=a.reference_type
        and coalesce(rc.reference_value,'')=coalesce(a.reference_value,'')
        and rc.anomaly_type=a.anomaly_type
    )
    on conflict do nothing
    returning id
  )
  select count(*)::integer into made from ins;

  insert into public.recount_missions(case_id,inventory_id,round,created_by)
  select rc.id,rc.inventory_id,2,actor
  from public.reconciliation_cases rc
  where rc.inventory_id=p_inventory_id
    and rc.source_fingerprint=fp
    and rc.status='REQUIERE_2DO_CONTEO'
    and rc.first_count_record_id is not null
  on conflict(case_id,round) do nothing;

  select count(*)::integer into existed
  from public.reconciliation_cases rc
  where rc.inventory_id=p_inventory_id
    and rc.source_fingerprint=fp
    and rc.status<>'RESUELTO'
    and not (
      rc.status='PENDIENTE_ANALISIS'
      and rc.physical_quantity=0
      and rc.first_count_record_id is null
    );

  insert into public.audit_events(inventory_id,actor_user_id,event_type,entity_type,entity_id,payload)
  values(
    p_inventory_id,actor,'MASTER_IMPORTED','reconciliation_materialization',p_inventory_id,
    jsonb_build_object(
      'source_fingerprint',fp,
      'created_count',made,
      'active_case_count',existed,
      'mode','OBSERVED_REFERENCES_ONLY',
      'recount_mode','MISSION_QUEUE',
      'legacy_backlog_hidden',true
    )
  );

  created_count:=made;
  existing_count:=existed;
  source_fingerprint:=fp;
  return next;
end
$function$;

create or replace function public.list_reconciliation_cases(p_inventory_id uuid)
returns setof public.reconciliation_cases
language plpgsql
stable security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  fp text;
begin
  perform app_private.require_active_actor();
  if not app_private.can_manage_inventory(p_inventory_id) then
    raise exception 'Not authorized for reconciliation' using errcode='42501';
  end if;

  select fingerprint into fp
  from public.inventory_system_reference_metadata
  where inventory_id=p_inventory_id;

  return query
  select r.*
  from public.reconciliation_cases r
  where r.inventory_id=p_inventory_id
    and fp is not null
    and r.source_fingerprint=fp
    and not (
      r.status='PENDIENTE_ANALISIS'
      and r.physical_quantity=0
      and r.first_count_record_id is null
    )
  order by r.created_at desc,r.id;
end
$function$;

create or replace function public.get_reconciliation_summary(p_inventory_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  actor uuid:=app_private.require_active_actor();
  fp text;
  metadata jsonb;
  result jsonb;
begin
  if not app_private.can_manage_inventory(p_inventory_id) then
    raise exception 'Not authorized for reconciliation summary' using errcode='42501';
  end if;
  if not exists(select 1 from public.inventories where id=p_inventory_id) then
    raise exception 'Inventory not found' using errcode='P0002';
  end if;

  select m.fingerprint,
         jsonb_build_object(
           'reference_version',m.reference_version,
           'row_count',m.row_count,
           'fingerprint',m.fingerprint,
           'source',m.source,
           'import_identifier',m.import_identifier,
           'imported_at',m.imported_at
         )
  into fp,metadata
  from public.inventory_system_reference_metadata m
  where m.inventory_id=p_inventory_id;

  with visible as (
    select r.*
    from public.reconciliation_cases r
    where r.inventory_id=p_inventory_id
      and fp is not null
      and r.source_fingerprint=fp
      and not (
        r.status='PENDIENTE_ANALISIS'
        and r.physical_quantity=0
        and r.first_count_record_id is null
      )
  ), totals as (
    select
      count(*)::integer total,
      count(*) filter(where status<>'RESUELTO')::integer open,
      count(*) filter(where status in('PENDIENTE_ANALISIS','REQUIERE_2DO_CONTEO'))::integer pending_analysis,
      count(*) filter(where status='2DO_CONTEO_ASIGNADO')::integer second_recount,
      count(*) filter(where status in('REQUIERE_3ER_CONTEO','3ER_CONTEO_ASIGNADO'))::integer third_recount,
      count(*) filter(where status='FISICO_CONFIRMADO')::integer physical_confirmed,
      count(*) filter(where status='RESUELTO')::integer resolved
    from visible
  )
  select jsonb_build_object(
    'inventory_id',p_inventory_id,
    'source_reference',metadata,
    'summary',jsonb_build_object(
      'total',t.total,
      'open',t.open,
      'pending_analysis',t.pending_analysis,
      'second_recount',t.second_recount,
      'third_recount',t.third_recount,
      'physical_confirmed',t.physical_confirmed,
      'resolved',t.resolved
    ),
    'anomalies',coalesce((
      select jsonb_object_agg(x.anomaly_type,x.total order by x.anomaly_type)
      from (
        select v.anomaly_type,count(*)::integer total
        from visible v
        group by v.anomaly_type
      ) x
    ),'{}'::jsonb),
    'last_materialized_at',(
      select max(a.created_at)
      from public.audit_events a
      where a.inventory_id=p_inventory_id
        and a.entity_type='reconciliation_materialization'
    )
  )
  into result
  from totals t;

  return result;
end
$function$;

revoke all on function public.materialize_reconciliation_cases(uuid),
  public.list_reconciliation_cases(uuid),
  public.get_reconciliation_summary(uuid)
from public,anon;

grant execute on function public.materialize_reconciliation_cases(uuid),
  public.list_reconciliation_cases(uuid),
  public.get_reconciliation_summary(uuid)
to authenticated;
