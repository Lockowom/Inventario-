-- CUT2-11A9: the following SECURITY DEFINER helpers are internal-only.
-- Keep postgres/service_role execution for internal, trigger, and server paths;
-- remove every client-facing execution grant without changing function logic.
-- This event-trigger helper exists on QA but is absent from the reproducible
-- local migration lineage. Preserve a clean local reset while hardening QA.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;
revoke execute on function public.cut2_reference_is_critical(uuid) from public, anon, authenticated;
revoke execute on function public.operational_deadline_after(uuid, timestamptz, integer) from public, anon, authenticated;
revoke execute on function public.operational_minutes_between(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.validate_inventory_close_backup(uuid) from public, anon, authenticated;
revoke execute on function public.verify_rp_release_integrity_metadata(uuid) from public, anon, authenticated;
