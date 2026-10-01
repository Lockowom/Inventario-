begin;
select plan(7);

select ok((select relrowsecurity from pg_class where oid='public.reconciliation_cases'::regclass),'reconciliation cases enforce RLS');
select is((select count(*) from pg_policies where schemaname='public' and tablename='reconciliation_cases' and policyname='reconciliation_second_assignee_read'),0::bigint,'second counter has no direct table policy');
select is((select has_table_privilege('authenticated','public.reconciliation_cases','INSERT')),false,'authenticated cannot insert reconciliation cases directly');
select is((select has_table_privilege('authenticated','public.reconciliation_cases','UPDATE')),false,'authenticated cannot update reconciliation cases directly');
select is((select has_table_privilege('authenticated','public.reconciliation_cases','DELETE')),false,'authenticated cannot delete reconciliation cases directly');
select is((select has_function_privilege('anon','public.record_my_recount(uuid,uuid)','EXECUTE')),false,'anon cannot link recount records');
select is((select has_function_privilege('authenticated','public.record_my_recount(uuid,uuid)','EXECUTE')),true,'authenticated may invoke guarded recount RPC');

select * from finish();
rollback;
