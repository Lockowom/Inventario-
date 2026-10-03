begin;
select plan(13);

select has_column('public','inventories','c1_completed_at','inventory stores C1 completion timestamp');
select has_column('public','inventories','c1_completed_by','inventory stores C1 completion actor');
select has_column('public','inventories','c1_count_records','inventory stores immutable C1 record count');
select has_column('public','inventories','c1_reference_fingerprint','inventory locks the RP fingerprint used for C1');

select has_function('public','get_inventory_lifecycle',array['uuid'],'lifecycle RPC exists');
select has_function('public','finalize_c1_coverage',array['uuid','boolean'],'C1 finalization RPC exists');
select has_function('public','complete_my_recount_mission_zero',array['uuid'],'zero-result recount RPC exists');

select is(
 to_regprocedure('public.materialize_reconciliation_cases(uuid)') is null,
 true,
 'manual pre-C1 reconciliation materialization RPC is removed'
);

select is(
 to_regprocedure('public.add_my_recount_observation(uuid,uuid)') is null,
 true,
 'separate recount attachment RPC is removed'
);

select ok(
 position('C1_COMPLETED' in pg_get_functiondef('public.sync_counts(uuid,uuid,device_platform,text,text,jsonb)'::regprocedure))>0
 and position('recount_mission_observations' in pg_get_functiondef('public.sync_counts(uuid,uuid,device_platform,text,text,jsonb)'::regprocedure))>0,
 'sync blocks new C1 after coverage close and auto-attaches active recounts'
);

select ok(
 position('c1_completed_at' in lower(pg_get_functiondef('public.close_inventory(uuid)'::regprocedure)))>0
 and position('reconciliation_cases' in lower(pg_get_functiondef('public.close_inventory(uuid)'::regprocedure)))>0,
 'final inventory close requires completed C1 and resolved reconciliation'
);

select ok(
 exists(
   select 1
   from pg_trigger
   where tgrelid='public.count_records'::regclass
     and tgname='count_records_c1_physical_freeze'
     and not tgisinternal
 ),
 'count records have a physical freeze trigger after C1 completion'
);

select is(
 has_function_privilege('anon','public.finalize_c1_coverage(uuid,boolean)','EXECUTE'),
 false,
 'anonymous role cannot finalize C1'
);

select * from finish();
rollback;
