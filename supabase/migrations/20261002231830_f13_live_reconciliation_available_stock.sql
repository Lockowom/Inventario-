-- F13: the physical-inventory baseline is Softland Disponible, never Stock Total.
-- Stock Total is retained as source evidence only and is not used by reconciliation.
alter table public.inventory_system_reference_items
  add column source_total_quantity integer,
  add column unit_code text,
  add column expiration_date date;

update public.inventory_system_reference_items
set source_total_quantity = quantity
where source_total_quantity is null;

alter table public.inventory_system_reference_items
  alter column source_total_quantity set not null,
  add constraint inventory_system_reference_source_total_nonnegative check(source_total_quantity >= 0);

create index inventory_system_reference_items_live_lookup_idx
  on public.inventory_system_reference_items(inventory_id,codigo,reference_type,coalesce(reference_value,''));
create index count_records_live_reconciliation_idx
  on public.count_records(inventory_id,codigo,partida,serie,received_at desc);

create or replace function app_private.system_reference_fingerprint(p_inventory_id uuid)
returns text language sql stable security definer set search_path=public,pg_temp as $$
 select encode(extensions.digest(coalesce((
   select string_agg(
     codigo||E'\x1f'||reference_type::text||E'\x1f'||coalesce(reference_value,'')||E'\x1f'||
     quantity::text||E'\x1f'||source_total_quantity::text||E'\x1f'||coalesce(unit_code,'')||E'\x1f'||coalesce(expiration_date::text,''),
     E'\x1e' order by codigo,reference_type,reference_value nulls first,expiration_date nulls first
   ) from public.inventory_system_reference_items where inventory_id=p_inventory_id
 ),''),'sha256'),'hex')
$$;
revoke all on function app_private.system_reference_fingerprint(uuid) from public,anon,authenticated;

create or replace function public.import_inventory_system_reference(p_inventory_id uuid,p_items jsonb,p_source text,p_import_identifier text default null)
returns table(reference_version integer,row_count integer,fingerprint text)
language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare actor uuid:=app_private.require_active_actor(); src text:=nullif(btrim(p_source),'');
begin
 if not app_private.can_manage_inventory(p_inventory_id) then raise exception 'Not authorized to import system reference' using errcode='42501'; end if;
 if src is null then raise exception 'System reference source is required' using errcode='23514'; end if;
 if not exists(select 1 from public.inventories where id=p_inventory_id and status in('BORRADOR','PREPARADO')) then raise exception 'System reference import is only allowed in BORRADOR or PREPARADO' using errcode='23514'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'System reference requires at least one row' using errcode='23514'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where nullif(upper(btrim(x->>'codigo')),'') is null or (x->>'quantity') is null or (x->>'quantity')::integer<0 or coalesce((x->>'available_quantity')::integer,(x->>'quantity')::integer)<0) then raise exception 'Invalid system reference row' using errcode='23514'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where nullif(x->>'expiration_date','') is not null and (x->>'expiration_date') !~ '^\d{4}-\d{2}-\d{2}$') then raise exception 'Invalid system reference expiration date' using errcode='23514'; end if;

 delete from public.inventory_system_reference_items where inventory_id=p_inventory_id;
 insert into public.inventory_system_reference_items(inventory_id,codigo,reference_type,reference_value,quantity,source_total_quantity,unit_code,expiration_date)
 select p_inventory_id,upper(btrim(x->>'codigo')),m.control_type,nullif(btrim(x->>'reference_value'),''),
   coalesce((x->>'available_quantity')::integer,(x->>'quantity')::integer),
   (x->>'quantity')::integer,
   nullif(btrim(x->>'unit_code'),''),
   nullif(x->>'expiration_date','')::date
 from jsonb_array_elements(p_items) x join public.inventory_master_items m on m.inventory_id=p_inventory_id and m.codigo=upper(btrim(x->>'codigo'));
 if (select count(*) from public.inventory_system_reference_items where inventory_id=p_inventory_id)<>jsonb_array_length(p_items) then raise exception 'Every system reference row must match the inventory master and be unique' using errcode='23514'; end if;
 if exists(select 1 from public.inventory_system_reference_items where inventory_id=p_inventory_id and ((reference_type='SERIAL' and (reference_value is null or quantity not in(0,1))) or (reference_type='PARTIDA' and reference_value is null))) then raise exception 'System reference control fields do not match master type' using errcode='23514'; end if;

 insert into public.inventory_system_reference_metadata(inventory_id,reference_version,row_count,source,import_identifier,fingerprint,imported_by)
 values(p_inventory_id,1,jsonb_array_length(p_items),src,nullif(btrim(p_import_identifier),''),app_private.system_reference_fingerprint(p_inventory_id),actor)
 on conflict(inventory_id) do update set reference_version=public.inventory_system_reference_metadata.reference_version+1,row_count=excluded.row_count,source=excluded.source,import_identifier=excluded.import_identifier,fingerprint=excluded.fingerprint,imported_by=excluded.imported_by,imported_at=now()
 returning inventory_system_reference_metadata.reference_version,inventory_system_reference_metadata.row_count,inventory_system_reference_metadata.fingerprint into reference_version,row_count,fingerprint;
 insert into public.audit_events(inventory_id,actor_user_id,event_type,entity_type,entity_id,payload)
 values(p_inventory_id,actor,'MASTER_IMPORTED','inventory_system_reference',p_inventory_id,jsonb_build_object('reference_version',reference_version,'row_count',row_count,'source',src,'import_identifier',nullif(btrim(p_import_identifier),''),'fingerprint',fingerprint,'baseline','DISPONIBLE'));
 return next;
end $$;
revoke all on function public.import_inventory_system_reference(uuid,jsonb,text,text) from public,anon;
grant execute on function public.import_inventory_system_reference(uuid,jsonb,text,text) to authenticated;

create function public.get_live_reconciliation_workspace(p_inventory_id uuid,p_search text default null,p_status text default 'TODOS',p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path=public,app_private,pg_temp as $$
declare result jsonb; normalized_search text:=nullif(lower(btrim(p_search)), ''); normalized_status text:=upper(coalesce(nullif(btrim(p_status),''),'TODOS'));
begin
 perform app_private.require_active_actor();
 if not app_private.can_manage_inventory(p_inventory_id) then raise exception 'Not authorized for live reconciliation' using errcode='42501'; end if;
 if p_limit<1 or p_limit>200 then raise exception 'Live reconciliation limit must be between 1 and 200' using errcode='22023'; end if;
 if not exists(select 1 from public.inventory_system_reference_metadata where inventory_id=p_inventory_id) then raise exception 'System reference snapshot is required' using errcode='23514'; end if;
 with physical as (
   select c.codigo,m.control_type,case when m.control_type='SERIAL' then c.serie when m.control_type='PARTIDA' then c.partida else null end reference_value,
     sum(c.cantidad_contada)::integer quantity,max(c.received_at) last_received_at,max(c.fecha_vencimiento) expiration_date
   from public.count_records c join public.inventory_master_items m on m.inventory_id=c.inventory_id and m.codigo=c.codigo
   where c.inventory_id=p_inventory_id group by c.codigo,m.control_type,case when m.control_type='SERIAL' then c.serie when m.control_type='PARTIDA' then c.partida else null end
 ), rows as (
   select coalesce(s.codigo,p.codigo) codigo,coalesce(m.descripcion,'Sin descripción') descripcion,coalesce(s.unit_code,'—') unit_code,
     coalesce(s.reference_type,p.control_type) reference_type,coalesce(s.reference_value,p.reference_value) reference_value,
     coalesce(s.expiration_date,p.expiration_date) expiration_date,coalesce(s.quantity,0) available_quantity,coalesce(p.quantity,0) counted_quantity,p.last_received_at,
     case when s.codigo is null and coalesce(p.quantity,0)>0 then 'NUEVO_LOTE_SERIE'
          when coalesce(s.quantity,0)=0 and s.source_total_quantity>0 and coalesce(p.quantity,0)>0 then 'FUERA_DE_DISPONIBLE'
          when coalesce(s.expiration_date,p.expiration_date) is distinct from p.expiration_date and p.expiration_date is not null then 'VENCIMIENTO_DISTINTO'
          when coalesce(s.quantity,0)=coalesce(p.quantity,0) then 'CUADRADO' else 'DIFERENCIA' end status
   from public.inventory_system_reference_items s full join physical p on p.codigo=s.codigo and p.control_type=s.reference_type and coalesce(p.reference_value,'')=coalesce(s.reference_value,'')
   left join public.inventory_master_items m on m.inventory_id=p_inventory_id and m.codigo=coalesce(s.codigo,p.codigo)
   where coalesce(s.inventory_id,p_inventory_id)=p_inventory_id
 ), filtered as (
   select * from rows where (normalized_search is null or lower(codigo) like '%'||normalized_search||'%' or lower(descripcion) like '%'||normalized_search||'%' or lower(coalesce(reference_value,'')) like '%'||normalized_search||'%')
     and (normalized_status='TODOS' or status=normalized_status)
 ), metrics as (
   select count(distinct codigo)::integer total_skus,count(distinct codigo) filter(where counted_quantity>0)::integer counted_skus,
     count(*) filter(where status='CUADRADO')::integer matched_items,count(*) filter(where status='DIFERENCIA')::integer difference_items,
     count(*) filter(where status='NUEVO_LOTE_SERIE')::integer new_references,count(*) filter(where status='FUERA_DE_DISPONIBLE')::integer non_available_items,coalesce(sum(available_quantity),0)::bigint available_units,coalesce(sum(counted_quantity),0)::bigint counted_units
   from rows
 )
 select jsonb_build_object('inventory_id',p_inventory_id,'refreshed_at',now(),
   'metrics',(select jsonb_build_object('total_skus',total_skus,'counted_skus',counted_skus,'matched_items',matched_items,'difference_items',difference_items,'new_references',new_references,'non_available_items',non_available_items,'available_units',available_units,'counted_units',counted_units,'difference_units',counted_units-available_units) from metrics),
   'rows',coalesce((select jsonb_agg(jsonb_build_object('codigo',codigo,'descripcion',descripcion,'unit_code',unit_code,'reference_type',reference_type,'reference_value',reference_value,'expiration_date',expiration_date,'available_quantity',available_quantity,'counted_quantity',counted_quantity,'difference_quantity',counted_quantity-available_quantity,'status',status,'last_received_at',last_received_at) order by codigo,reference_value nulls first) from (select * from filtered order by codigo,reference_value nulls first limit p_limit) page),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.get_live_reconciliation_workspace(uuid,text,text,integer) from public,anon;
grant execute on function public.get_live_reconciliation_workspace(uuid,text,text,integer) to authenticated;
