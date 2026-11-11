-- Preserve the certified zero-argument RPC signature while removing its old
-- multi-inventory "AMBIGUOUS" semantics. Both entry points now require an
-- explicit choice only when one is actually needed.
create or replace function public.get_my_counting_authorization_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,app_private,pg_temp
as $function$
begin
  return public.get_my_counting_authorization_snapshot(null::uuid);
end
$function$;

revoke all on function public.get_my_counting_authorization_snapshot() from public, anon;
grant execute on function public.get_my_counting_authorization_snapshot() to authenticated;
