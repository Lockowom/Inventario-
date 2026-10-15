begin;
select plan(10);

select ok(
  (select relrowsecurity from pg_class where oid='public.reconciliation_cases'::regclass),
  'reconciliation cases enforce RLS'
);

select is(
  (select has_table_privilege('authenticated','public.reconciliation_cases','INSERT')),
  false,
  'authenticated cannot insert reconciliation cases directly'
);

select is(
  (select has_table_privilege('authenticated','public.reconciliation_cases','UPDATE')),
  false,
  'authenticated cannot update reconciliation cases directly'
);

select is(
  (select has_table_privilege('authenticated','public.reconciliation_cases','DELETE')),
  false,
  'authenticated cannot delete reconciliation cases directly'
);

select is(
  has_function_privilege('anon','public.claim_next_recount_mission(uuid)','EXECUTE'),
  false,
  'anon cannot claim recount missions'
);

select is(
  has_function_privilege('authenticated','public.claim_next_recount_mission(uuid)','EXECUTE'),
  true,
  'authenticated may invoke guarded queue claim RPC'
);

select is(
  to_regprocedure('public.add_my_recount_observation(uuid,uuid)') is null,
  true,
  'separate recount observation RPC is removed'
);

select is(
  has_function_privilege('anon','public.complete_my_recount_mission(uuid)','EXECUTE')
  or has_function_privilege('anon','public.complete_my_recount_mission_zero(uuid)','EXECUTE'),
  false,
  'anon cannot complete recount missions'
);

select is(
  to_regprocedure('public.record_my_recount(uuid,uuid)') is null,
  true,
  'legacy single-record recount bridge is removed'
);

select is(
  to_regprocedure('public.assign_second_recount(uuid,uuid)') is null
  and to_regprocedure('public.assign_third_recount(uuid,uuid)') is null,
  true,
  'legacy manual assignment RPCs are removed'
);

select * from finish();
rollback;
