begin;
select plan(9);

select has_table('public','recount_missions','F15 has recount mission queue');
select has_table('public','recount_mission_observations','F15 stores multi-location recount observations');

select has_function('public','get_my_recount_queue',array['uuid'],'queue read RPC exists');
select has_function('public','claim_next_recount_mission',array['uuid'],'atomic queue claim RPC exists');
select has_function('public','add_my_recount_observation',array['uuid','uuid'],'observation attachment RPC exists');
select has_function('public','complete_my_recount_mission',array['uuid'],'mission completion RPC exists');

select ok(
 position('for update skip locked' in lower(pg_get_functiondef('public.claim_next_recount_mission(uuid)'::regprocedure)))>0,
 'queue claim is concurrency safe'
);

select ok(
 position('recount_mission_observations' in lower(pg_get_functiondef('public.materialize_reconciliation_cases(uuid)'::regprocedure)))>0
 and position('physical_quantity>0' in replace(lower(pg_get_functiondef('public.materialize_reconciliation_cases(uuid)'::regprocedure)),' ',''))>0,
 'open-inventory materialization ignores recount rows and untouched references'
);

select is(
 has_function_privilege('anon','public.claim_next_recount_mission(uuid)','EXECUTE'),
 false,
 'anon cannot claim recount work'
);

select * from finish();
rollback;
