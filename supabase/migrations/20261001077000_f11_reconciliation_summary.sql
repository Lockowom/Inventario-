-- F11 current-snapshot reconciliation operational summary.
create function public.get_reconciliation_summary(p_inventory_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=public,app_private,pg_temp as $$
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

 select jsonb_build_object(
  'inventory_id',p_inventory_id,
  'source_reference',metadata,
  'summary',jsonb_build_object(
    'total',count(*) filter(where fp is not null and r.source_fingerprint=fp),
    'open',count(*) filter(where fp is not null and r.source_fingerprint=fp and r.status<>'RESUELTO'),
    'pending_analysis',count(*) filter(where fp is not null and r.source_fingerprint=fp and r.status in('PENDIENTE_ANALISIS','REQUIERE_2DO_CONTEO')),
    'second_recount',count(*) filter(where fp is not null and r.source_fingerprint=fp and r.status='2DO_CONTEO_ASIGNADO'),
    'third_recount',count(*) filter(where fp is not null and r.source_fingerprint=fp and r.status in('REQUIERE_3ER_CONTEO','3ER_CONTEO_ASIGNADO')),
    'physical_confirmed',count(*) filter(where fp is not null and r.source_fingerprint=fp and r.status='FISICO_CONFIRMADO'),
    'resolved',count(*) filter(where fp is not null and r.source_fingerprint=fp and r.status='RESUELTO')
  ),
  'anomalies',coalesce((
    select jsonb_object_agg(x.anomaly_type,x.total order by x.anomaly_type)
    from (
      select rc.anomaly_type,count(*)::integer total
      from public.reconciliation_cases rc
      where fp is not null and rc.inventory_id=p_inventory_id and rc.source_fingerprint=fp
      group by rc.anomaly_type
    ) x
  ),'{}'::jsonb),
  'last_materialized_at',(
    select max(a.created_at)
    from public.audit_events a
    where a.inventory_id=p_inventory_id and a.entity_type='reconciliation_materialization'
  )
 )
 into result
 from public.reconciliation_cases r
 where r.inventory_id=p_inventory_id;

 return result;
end $$;

revoke all on function public.get_reconciliation_summary(uuid) from public,anon;
grant execute on function public.get_reconciliation_summary(uuid) to authenticated;
