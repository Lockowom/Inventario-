-- CUT2-08H: RLS is evaluated as the caller.  Use the private definer
-- predicate instead of directly invoking the intentionally non-executable
-- actor_has_capability helper.
drop policy if exists reference_finding_events_scoped_read on public.reference_finding_events;
create policy reference_finding_events_scoped_read
on public.reference_finding_events
for select
to authenticated
using (
  exists (
    select 1
    from public.reference_findings f
    where f.id = finding_id
      and app_private.finding_actor_has_capability(
        auth.uid(),
        'VIEW_MONITOR'::public.cut2_capability,
        f.inventory_id,
        f.warehouse_id
      )
  )
);
