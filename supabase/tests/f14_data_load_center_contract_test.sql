begin;
select plan(7);

select has_function(
  'public',
  'import_inventory_master',
  array['uuid','jsonb','text','text'],
  'F14 keeps canonical master import RPC'
);

select ok(
  position('on conflict(inventory_id,codigo) do update' in lower(replace(pg_get_functiondef('public.import_inventory_master(uuid,jsonb,text,text)'::regprocedure),' ','')))>0,
  'master import uses smart upsert instead of delete-all replacement'
);

select ok(
  position('delete from public.inventory_system_reference_items' in lower(pg_get_functiondef('public.import_inventory_master(uuid,jsonb,text,text)'::regprocedure)))>0,
  'replacing master invalidates the old RP evidence snapshot'
);

select ok(
  position('SMART_MERGE_V2' in pg_get_functiondef('public.import_inventory_master(uuid,jsonb,text,text)'::regprocedure))>0,
  'master import audit identifies smart merge v2'
);

select ok(
  not exists(
    select 1
    from pg_constraint
    where conrelid='public.inventory_missing_batch_exceptions'::regclass
      and confrelid='public.inventory_master_items'::regclass
      and contype='f'
  ),
  'missing-batch history no longer blocks master row retirement'
);

select is(
  (
    select confdeltype::text
    from pg_constraint
    where conrelid='public.inventory_master_exceptions'::regclass
      and conname='inventory_master_exceptions_master_item_id_fkey'
  ),
  'n',
  'master exception historical link uses ON DELETE SET NULL'
);

select is(
  has_function_privilege('anon','public.import_inventory_master(uuid,jsonb,text,text)','EXECUTE'),
  false,
  'anon cannot import master data'
);

select * from finish();
rollback;
