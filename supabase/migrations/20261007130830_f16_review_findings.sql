-- Forward-only repairs for the P1/P2 review of the F14/F16 implementation.
-- These migrations have already been applied to QA, so they are corrected here
-- rather than rewriting history.

-- A serial in a non-Disponible state remains evidence, but is not an
-- operationally countable unit. Preserve the signed source columns for audit.
update public.inventory_system_reference_items
set quantity = 0
where reference_type = 'SERIAL'
  and coalesce(source_available_quantity, quantity, 0) <= 0
  and quantity <> 0;

alter function public.import_inventory_system_reference(uuid, jsonb, text, text)
  rename to import_inventory_system_reference_f14_legacy;

create function public.import_inventory_system_reference(
  p_inventory_id uuid,
  p_items jsonb,
  p_source text,
  p_import_identifier text default null
)
returns table(reference_version integer, row_count integer, fingerprint text)
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
begin
  return query
    select * from public.import_inventory_system_reference_f14_legacy(
      p_inventory_id, p_items, p_source, p_import_identifier
    );

  update public.inventory_system_reference_items
  set quantity = 0
  where inventory_id = p_inventory_id
    and reference_type = 'SERIAL'
    and coalesce(source_available_quantity, quantity, 0) <= 0
    and quantity <> 0;
end;
$$;

revoke all on function public.import_inventory_system_reference(uuid, jsonb, text, text) from public, anon;
grant execute on function public.import_inventory_system_reference(uuid, jsonb, text, text) to authenticated;

-- Scope the reference side before the FULL JOIN. The former predicate after
-- the join allowed a physical C1 row from this inventory to pair with a
-- matching reference belonging to another inventory.
do $$
declare
  definition text;
  previous_fragment constant text := 'from public.inventory_system_reference_items s' || E'\n' || '    full join c1_physical p';
  corrected_fragment constant text := 'from (select * from public.inventory_system_reference_items where inventory_id = p_inventory_id) s' || E'\n' || '    full join c1_physical p';
begin
  select pg_get_functiondef('public.get_live_monitor_coverage(uuid,text,text,integer,integer)'::regprocedure)
    into definition;
  if position(previous_fragment in definition) = 0 then
    raise exception 'Expected live monitor coverage query shape was not found';
  end if;
  execute replace(definition, previous_fragment, corrected_fragment);
end;
$$;
