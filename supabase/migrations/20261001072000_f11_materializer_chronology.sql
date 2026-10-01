-- F11: select the actual earliest accepted observation as C1.
create or replace function public.materialize_reconciliation_cases(p_inventory_id uuid)
returns table(created_count integer,existing_count integer,source_fingerprint text)
language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare actor uuid:=app_private.require_active_actor(); fp text; made integer:=0; existed integer:=0;
begin
 if not app_private.can_manage_inventory(p_inventory_id) then raise exception 'Not authorized for reconciliation materialization' using errcode='42501'; end if;
 select fingerprint into fp from public.inventory_system_reference_metadata where inventory_id=p_inventory_id;
 if fp is null then raise exception 'System reference snapshot is required' using errcode='23514'; end if;
 with physical_base as (
  select c.*,m.control_type,case when m.control_type='SERIAL' then c.serie when m.control_type='PARTIDA' then c.partida else null end reference_value
  from public.count_records c join public.inventory_master_items m on m.inventory_id=c.inventory_id and m.codigo=c.codigo where c.inventory_id=p_inventory_id
 ), physical as (
  select codigo,control_type,reference_value,sum(cantidad_contada)::integer quantity,
   (array_agg(id order by received_at,captured_at,created_at,id))[1] first_count_record_id
  from physical_base group by codigo,control_type,reference_value
 ), joined as (
  select coalesce(s.codigo,p.codigo) codigo,coalesce(s.reference_type,p.control_type) reference_type,
   coalesce(s.reference_value,p.reference_value) reference_value,coalesce(s.quantity,0) system_quantity,
   coalesce(p.quantity,0) physical_quantity,p.first_count_record_id
  from public.inventory_system_reference_items s full join physical p on p.codigo=s.codigo and p.control_type=s.reference_type and coalesce(p.reference_value,'')=coalesce(s.reference_value,'')
  where coalesce(s.inventory_id,p_inventory_id)=p_inventory_id
 ), anomalies as (
  select *,case
   when reference_type='SERIAL' and system_quantity=0 and physical_quantity>0 then 'SERIE_FISICA_NO_EN_SISTEMA'
   when reference_type='SERIAL' and system_quantity>0 and physical_quantity=0 then 'SERIE_SISTEMA_NO_CONTADA'
   when reference_type='PARTIDA' and system_quantity=0 and physical_quantity>0 then 'PARTIDA_FISICA_NO_EN_SISTEMA'
   when reference_type='PARTIDA' and system_quantity>0 and physical_quantity=0 then 'PARTIDA_SISTEMA_NO_CONTADA'
   when reference_type='PARTIDA' and system_quantity<>physical_quantity then 'DIFERENCIA_CANTIDAD_PARTIDA'
   when reference_type='LEGACY' and system_quantity<>physical_quantity then 'DIFERENCIA_CANTIDAD_SKU' end anomaly_type
  from joined where system_quantity<>physical_quantity
 ), ins as (
  insert into public.reconciliation_cases(inventory_id,codigo,reference_type,reference_value,anomaly_type,system_quantity,physical_quantity,first_count_record_id,created_by,source_fingerprint)
  select p_inventory_id,codigo,reference_type,reference_value,anomaly_type,system_quantity,physical_quantity,first_count_record_id,actor,fp from anomalies where anomaly_type is not null
  on conflict do nothing returning 1
 )
 select count(*)::integer into made from ins;
 select count(*)::integer into existed from public.reconciliation_cases where inventory_id=p_inventory_id and source_fingerprint=fp and status<>'RESUELTO';
 insert into public.audit_events(inventory_id,actor_user_id,event_type,entity_type,entity_id,payload)
 values(p_inventory_id,actor,'MASTER_IMPORTED','reconciliation_materialization',p_inventory_id,jsonb_build_object('source_fingerprint',fp,'created_count',made,'open_case_count',existed));
 created_count:=made;existing_count:=existed;source_fingerprint:=fp;return next;
end $$;
