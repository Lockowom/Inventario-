-- F11 system-reference hardening: null-safe natural key and LEGACY reference invariant.
alter table public.inventory_system_reference_items
  add constraint inventory_system_reference_legacy_reference_null
  check (reference_type <> 'LEGACY' or reference_value is null);

create unique index inventory_system_reference_items_natural_key
  on public.inventory_system_reference_items(
    inventory_id,
    codigo,
    reference_type,
    coalesce(reference_value,'')
  );
