begin;
select plan(4);

select has_index(
  'public',
  'inventory_system_reference_items',
  'inventory_system_reference_items_natural_key',
  'system reference has null-safe natural key index'
);

select is(
  (select indisunique from pg_index where indexrelid='public.inventory_system_reference_items_natural_key'::regclass),
  true,
  'system reference natural key is unique'
);

select ok(
  exists(
    select 1 from pg_constraint
    where conrelid='public.inventory_system_reference_items'::regclass
      and conname='inventory_system_reference_legacy_reference_null'
      and contype='c'
  ),
  'LEGACY system reference constraint exists'
);

select ok(
  position('COALESCE' in upper(pg_get_indexdef('public.inventory_system_reference_items_natural_key'::regclass)))>0,
  'natural key treats NULL reference values deterministically'
);

select * from finish();
rollback;
