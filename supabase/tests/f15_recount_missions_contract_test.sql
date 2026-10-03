begin;
select plan(18);

select has_table('public','recount_missions','F15 has recount mission queue');
select has_table('public','recount_mission_observations','F15 stores multi-location recount observations');

select has_function('public','get_my_recount_queue',array['uuid'],'queue read RPC exists');
select has_function('public','claim_next_recount_mission',array['uuid'],'atomic queue claim RPC exists');
select has_function('public','complete_my_recount_mission',array['uuid'],'mission completion RPC exists');
select has_function('public','complete_my_recount_mission_zero',array['uuid'],'zero-result mission completion RPC exists');

select ok(
 position('for update skip locked' in lower(pg_get_functiondef('public.claim_next_recount_mission(uuid)'::regprocedure)))>0,
 'queue claim is concurrency safe'
);

select ok(
 position('recount_mission_observations' in lower(pg_get_functiondef('public.sync_counts(uuid,uuid,device_platform,text,text,jsonb)'::regprocedure)))>0,
 'sync is the single server attachment path for recount observations'
);

select is(
 to_regprocedure('public.add_my_recount_observation(uuid,uuid)') is null,
 true,
 'separate recount observation attachment RPC is removed'
);

select is(
 to_regprocedure('public.get_my_recount_assignments(uuid)') is null,
 true,
 'legacy recount assignment list RPC is removed'
);

select is(
 to_regprocedure('public.record_my_recount(uuid,uuid)') is null,
 true,
 'legacy recount bridge RPC is removed'
);

select is(
 to_regprocedure('public.assign_second_recount(uuid,uuid)') is null,
 true,
 'legacy manual C2 assignment RPC is removed'
);

select is(
 to_regprocedure('public.assign_third_recount(uuid,uuid)') is null,
 true,
 'legacy manual C3 assignment RPC is removed'
);

select is(
 to_regprocedure('public.list_recount_candidates(uuid,integer)') is null,
 true,
 'legacy recount candidate RPC is removed'
);

select is(
 exists(
   select 1
   from information_schema.columns
   where table_schema='public'
     and table_name='reconciliation_cases'
     and column_name='first_count_record_id'
 ),
 true,
 'C1 provenance remains on reconciliation case'
);

select is(
 exists(
   select 1
   from information_schema.columns
   where table_schema='public'
     and table_name='reconciliation_cases'
     and column_name in ('second_count_record_id','third_count_record_id','assigned_second_user_id','assigned_third_analyst_id')
 ),
 false,
 'superseded single-record assignment columns are removed'
);

select ok(
 position('complete_recount_mission_internal' in lower(pg_get_functiondef('public.complete_my_recount_mission(uuid)'::regprocedure)))>0,
 'mission completion delegates to one internal transition implementation'
);

select is(
 has_function_privilege('anon','public.claim_next_recount_mission(uuid)','EXECUTE'),
 false,
 'anon cannot claim recount work'
);

select * from finish();
rollback;
