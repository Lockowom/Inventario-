begin;
select plan(8);

select ok(to_regprocedure('public.get_server_time()') is not null, 'get_server_time exists without parameters');
select is(pg_get_function_result('public.get_server_time()'::regprocedure), 'timestamp with time zone', 'get_server_time returns timestamptz');
select is((select prosecdef from pg_proc where oid = 'public.get_server_time()'::regprocedure), false, 'get_server_time is security invoker');
select ok((select position('search_path=' in coalesce(array_to_string(proconfig, ','), '')) > 0 from pg_proc where oid = 'public.get_server_time()'::regprocedure), 'get_server_time sets an empty search path');
select ok(not has_function_privilege('anon', 'public.get_server_time()', 'EXECUTE'), 'anon cannot execute get_server_time');
select ok(not exists (
  select 1
  from pg_proc procedure,
       lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) privilege
  where procedure.oid = 'public.get_server_time()'::regprocedure
    and privilege.grantee = 0
    and privilege.privilege_type = 'EXECUTE'
), 'public cannot execute get_server_time');
select ok(has_function_privilege('authenticated', 'public.get_server_time()', 'EXECUTE'), 'authenticated can execute get_server_time');
select ok(abs(extract(epoch from (public.get_server_time() - pg_catalog.clock_timestamp()))) < 2, 'get_server_time returns current UTC server time');

select * from finish();
rollback;
