begin;
select plan(7);

select has_column('public','inventory_system_reference_items','source_total_quantity','source total remains as source evidence');
select has_column('public','inventory_system_reference_items','unit_code','unit of measure is retained for live reconciliation');
select has_column('public','inventory_system_reference_items','expiration_date','expiration date is retained for live reconciliation');

select is(
  has_function_privilege('anon','public.get_live_reconciliation_workspace(uuid,text,text,integer)','EXECUTE'),
  false,
  'anon cannot access the live reconciliation workspace'
);
select is(
  has_function_privilege('authenticated','public.get_live_reconciliation_workspace(uuid,text,text,integer)','EXECUTE'),
  true,
  'authenticated can invoke the guarded live reconciliation workspace'
);
select ok(
  position('CAN_MANAGE_INVENTORY' in upper(pg_get_functiondef('public.get_live_reconciliation_workspace(uuid,text,text,integer)'::regprocedure))) > 0,
  'live reconciliation workspace enforces manager authorization'
);
select ok(
  position('AVAILABLE_QUANTITY' in upper(pg_get_functiondef('public.get_live_reconciliation_workspace(uuid,text,text,integer)'::regprocedure))) > 0,
  'live reconciliation output is explicitly based on available quantity'
);

select * from finish();
rollback;
