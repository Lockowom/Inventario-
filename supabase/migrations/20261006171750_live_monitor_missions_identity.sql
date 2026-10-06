-- LIVE-06/07/08: monitor read models for the existing C2/C3 case lifecycle
-- and identity-aware SKU aggregation. No recount state or ERP stock is changed.

create or replace function public.get_live_monitor_missions(
  p_inventory_id uuid,
  p_stage text default 'TODOS',
  p_status text default 'TODOS',
  p_limit integer default 100
)
returns table(
  id uuid,
  stage text,
  mission_status text,
  codigo text,
  descripcion text,
  reference_type public.master_control_type,
  reference_value text,
  anomaly_type text,
  assigned_to text,
  observation_count integer,
  known_locations text[],
  physical_result integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql stable security definer
set search_path = public, app_private, pg_temp
as $$
declare
  normalized_stage text := upper(coalesce(nullif(btrim(p_stage), ''), 'TODOS'));
  normalized_status text := upper(coalesce(nullif(btrim(p_status), ''), 'TODOS'));
begin
  perform app_private.require_active_actor();
  if not app_private.can_manage_inventory(p_inventory_id) then
    raise exception 'Not authorized for live monitor' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 200 then raise exception 'Live monitor limit must be between 1 and 200' using errcode = '22023'; end if;
  if normalized_stage not in ('TODOS', 'C2', 'C3') then raise exception 'Unsupported mission stage' using errcode = '22023'; end if;

  return query
  with cases as (
    select r.*,
      case when r.status in ('REQUIERE_3ER_CONTEO', '3ER_CONTEO_ASIGNADO') or r.third_count_record_id is not null then 'C3' else 'C2' end as derived_stage,
      case when r.status = 'PENDIENTE_ANALISIS' then 'NUEVO'
           when r.status in ('REQUIERE_2DO_CONTEO', 'REQUIERE_3ER_CONTEO') then 'EN_COLA'
           when r.status in ('2DO_CONTEO_ASIGNADO', '3ER_CONTEO_ASIGNADO') then 'ASIGNADO'
           when r.status = 'FISICO_CONFIRMADO' and coalesce(r.confirmed_physical_quantity, 0) = 0 then 'CONFIRMADO_CERO'
           when r.status in ('FISICO_CONFIRMADO', 'RESUELTO') then 'COMPLETADO'
           else 'ACTIVO' end as derived_mission_status
    from public.reconciliation_cases r
    where r.inventory_id = p_inventory_id
  ), rendered as (
    select c.*,
      coalesce(p2.display_name, p3.display_name, 'Sin asignar') as assigned_name,
      coalesce(c.confirmed_physical_quantity,
        c3.cantidad_contada, c2.cantidad_contada, c1.cantidad_contada) as derived_physical_result,
      (select count(*)::integer from (values (c.first_count_record_id), (c.second_count_record_id), (c.third_count_record_id)) v(record_id) where v.record_id is not null) as derived_observation_count,
      (select array_agg(distinct cr.ubicacion order by cr.ubicacion)
       from public.count_records cr
       where cr.id in (c.first_count_record_id, c.second_count_record_id, c.third_count_record_id)) as derived_locations
    from cases c
    left join public.profiles p2 on p2.user_id = c.assigned_second_user_id
    left join public.profiles p3 on p3.user_id = c.assigned_third_analyst_id
    left join public.count_records c1 on c1.id = c.first_count_record_id
    left join public.count_records c2 on c2.id = c.second_count_record_id
    left join public.count_records c3 on c3.id = c.third_count_record_id
  )
  select r.id, r.derived_stage, r.derived_mission_status, r.codigo,
    coalesce(m.descripcion, 'Sin descripción'), r.reference_type, r.reference_value,
    r.anomaly_type, r.assigned_name, r.derived_observation_count,
    coalesce(r.derived_locations, '{}'::text[]), r.derived_physical_result,
    r.created_at, r.updated_at
  from rendered r
  left join public.inventory_master_items m on m.inventory_id = p_inventory_id and m.codigo = r.codigo
  where (normalized_stage = 'TODOS' or r.derived_stage = normalized_stage)
    and (normalized_status = 'TODOS' or r.derived_mission_status = normalized_status)
  order by r.updated_at desc, r.id desc
  limit p_limit;
end;
$$;

create or replace function public.get_live_monitor_identity(p_inventory_id uuid, p_limit integer default 100)
returns table(
  codigo text,
  descripcion text,
  reference_type public.master_control_type,
  system_available_quantity integer,
  physical_quantity integer,
  system_missing_references integer,
  physical_new_references integer,
  identity_status text,
  risk_inflation_stock boolean
)
language plpgsql stable security definer
set search_path = public, app_private, pg_temp
as $$
declare lifecycle public.inventory_status;
begin
  perform app_private.require_active_actor();
  if not app_private.can_manage_inventory(p_inventory_id) then raise exception 'Not authorized for live monitor' using errcode = '42501'; end if;
  if p_limit < 1 or p_limit > 200 then raise exception 'Live monitor limit must be between 1 and 200' using errcode = '22023'; end if;
  select status into lifecycle from public.inventories where id = p_inventory_id;
  if lifecycle is null then raise exception 'Inventory not found' using errcode = 'P0002'; end if;

  return query
  with physical as (
    select c.codigo, m.control_type,
      case when m.control_type = 'SERIAL' then c.serie when m.control_type = 'PARTIDA' then c.partida else null end as reference_value,
      sum(c.cantidad_contada)::integer as quantity
    from public.count_records c join public.inventory_master_items m on m.inventory_id = c.inventory_id and m.codigo = c.codigo
    where c.inventory_id = p_inventory_id
    group by c.codigo, m.control_type, case when m.control_type = 'SERIAL' then c.serie when m.control_type = 'PARTIDA' then c.partida else null end
  ), reference_rows as (
    select coalesce(s.codigo, p.codigo) as codigo,
      coalesce(s.reference_type, p.control_type) as reference_type,
      coalesce(s.quantity, 0)::integer as available_quantity,
      coalesce(s.source_total_quantity, 0)::integer as source_total_quantity,
      coalesce(p.quantity, 0)::integer as physical_quantity,
      s.codigo is null as physical_only
    from public.inventory_system_reference_items s
    full join physical p on p.codigo = s.codigo and p.control_type = s.reference_type
      and coalesce(p.reference_value, '') = coalesce(s.reference_value, '')
    where coalesce(s.inventory_id, p_inventory_id) = p_inventory_id
  ), sku as (
    select r.codigo, r.reference_type,
      coalesce(sum(r.available_quantity), 0)::integer as available_quantity,
      coalesce(sum(r.physical_quantity), 0)::integer as physical_quantity,
      count(*) filter (where r.available_quantity > 0 and r.physical_quantity = 0)::integer as missing_references,
      count(*) filter (where r.physical_quantity > 0 and (r.physical_only or (r.available_quantity = 0 and r.source_total_quantity > 0)))::integer as new_references
    from reference_rows r group by r.codigo, r.reference_type
  )
  select s.codigo, m.descripcion, s.reference_type, s.available_quantity,
    s.physical_quantity, s.missing_references, s.new_references,
    case
      when lifecycle = 'ABIERTO' and s.available_quantity > 0 and s.missing_references > 0 then 'PENDIENTE_COBERTURA'
      when s.available_quantity <> s.physical_quantity then 'DIFERENCIA_CANTIDAD'
      when s.missing_references > 0 or s.new_references > 0 then 'CUADRADO_CANTIDAD_CON_DIFERENCIA_REFERENCIAS'
      else 'CUADRADO_TOTAL'
    end,
    (s.missing_references > 0 and s.new_references > 0)
  from sku s join public.inventory_master_items m on m.inventory_id = p_inventory_id and m.codigo = s.codigo
  order by (s.missing_references > 0 and s.new_references > 0) desc, s.codigo
  limit p_limit;
end;
$$;

revoke all on function public.get_live_monitor_missions(uuid, text, text, integer) from public, anon;
revoke all on function public.get_live_monitor_identity(uuid, integer) from public, anon;
grant execute on function public.get_live_monitor_missions(uuid, text, text, integer) to authenticated;
grant execute on function public.get_live_monitor_identity(uuid, integer) to authenticated;
