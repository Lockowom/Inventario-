create function public.get_server_time()
returns timestamptz
language sql
security invoker
set search_path = ''
as $$
  select pg_catalog.clock_timestamp()
$$;

revoke execute on function public.get_server_time() from public;
revoke execute on function public.get_server_time() from anon;
grant execute on function public.get_server_time() to authenticated;
