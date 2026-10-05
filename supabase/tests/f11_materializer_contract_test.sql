begin;
select plan(5);
select has_function('public','materialize_reconciliation_cases',array['uuid'],'materializer RPC exists');
select ok((select count(*)=1 from pg_indexes where schemaname='public' and indexname='reconciliation_cases_open_natural_key'),'open case natural key is unique');
select ok((select proconfig @> array['search_path=public, app_private, pg_temp'] from pg_proc where oid='public.materialize_reconciliation_cases(uuid)'::regprocedure),'materializer has locked search_path');
select is(has_function_privilege('anon','public.materialize_reconciliation_cases(uuid)','EXECUTE'),false,'anon cannot materialize reconciliation');
select ok(position('CONCILIACION_FINAL' in pg_get_functiondef('public.materialize_reconciliation_cases(uuid)'::regprocedure))>0,'materializer defers system-only findings until final reconciliation');
select * from finish();
rollback;
