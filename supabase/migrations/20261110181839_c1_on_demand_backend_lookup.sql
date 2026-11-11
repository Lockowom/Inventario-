-- C1 online is demand-driven: no client-side master snapshot is an authority.
-- These read RPCs are intentionally narrow and retain the canonical active
-- actor, capability, inventory and ABIERTO lifecycle checks at the server.

create or replace function public.c1_lookup_sku(
  p_inventory_id uuid,
  p_codigo text
)
returns table(
  codigo text,
  descripcion text,
  control_type public.master_control_type
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_warehouse_id uuid;
  v_codigo text := upper(btrim(coalesce(p_codigo, '')));
begin
  perform app_private.require_active_actor();

  select i.warehouse_id
    into v_warehouse_id
  from public.inventories i
  where i.id = p_inventory_id
    and i.status = 'ABIERTO';

  if not found then
    raise exception 'C1_INVENTORY_NOT_AVAILABLE' using errcode = '42501';
  end if;

  perform app_private.require_inventory_capability(
    p_inventory_id,
    'COUNT_C1'::public.cut2_capability,
    v_warehouse_id
  );

  if v_codigo = '' then
    raise exception 'C1_SKU_REQUIRED' using errcode = '22023';
  end if;

  return query
  select m.codigo, m.descripcion, m.control_type
  from public.inventory_master_items m
  where m.inventory_id = p_inventory_id
    and m.codigo = v_codigo;
end
$function$;

create or replace function public.c1_lookup_traceability(
  p_inventory_id uuid,
  p_codigo text,
  p_control_type public.master_control_type
)
returns table(
  reference_value text,
  expiration_date date
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_warehouse_id uuid;
  v_codigo text := upper(btrim(coalesce(p_codigo, '')));
begin
  perform app_private.require_active_actor();

  if p_control_type is null
    or p_control_type not in ('PARTIDA'::public.master_control_type, 'SERIAL'::public.master_control_type) then
    raise exception 'C1_TRACEABILITY_CONTROL_INVALID' using errcode = '22023';
  end if;

  select i.warehouse_id
    into v_warehouse_id
  from public.inventories i
  where i.id = p_inventory_id
    and i.status = 'ABIERTO';

  if not found then
    raise exception 'C1_INVENTORY_NOT_AVAILABLE' using errcode = '42501';
  end if;

  perform app_private.require_inventory_capability(
    p_inventory_id,
    'COUNT_C1'::public.cut2_capability,
    v_warehouse_id
  );

  if v_codigo = '' then
    raise exception 'C1_SKU_REQUIRED' using errcode = '22023';
  end if;

  -- The counter receives only identifiers needed to capture physical evidence;
  -- system quantities and expected/difference values remain server-side.
  return query
  select s.reference_value, s.expiration_date
  from public.inventory_system_reference_items s
  join public.inventory_master_items m
    on m.inventory_id = s.inventory_id
   and m.codigo = s.codigo
   and m.control_type = p_control_type
  where s.inventory_id = p_inventory_id
    and s.codigo = v_codigo
    and s.reference_type = p_control_type
    and s.reference_value is not null
  order by s.reference_value, s.expiration_date nulls last;
end
$function$;

revoke all on function public.c1_lookup_sku(uuid, text) from public, anon, authenticated;
revoke all on function public.c1_lookup_traceability(uuid, text, public.master_control_type) from public, anon, authenticated;
grant execute on function public.c1_lookup_sku(uuid, text) to authenticated;
grant execute on function public.c1_lookup_traceability(uuid, text, public.master_control_type) to authenticated;
