-- CUT2-08J3: the monitor must offer human-readable, server-scoped
-- assignees.  The client must not enumerate profiles and guess scope.
create or replace function public.list_reference_finding_assignees(p_finding_id uuid)
returns table(user_id uuid, display_name text)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := app_private.require_active_actor();
  v_finding public.reference_findings;
begin
  select * into v_finding
  from public.reference_findings
  where id = p_finding_id;

  if v_finding.id is null then
    raise exception 'FINDING_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform app_private.require_finding_capability(
    v_actor, 'FINDING_ASSIGN'::public.cut2_capability,
    v_finding.inventory_id, v_finding.warehouse_id
  );

  if v_finding.state not in ('OPEN', 'HELD') then
    raise exception 'FINDING_NOT_OPEN' using errcode = '23514';
  end if;

  return query
  select p.user_id, p.display_name
  from public.profiles p
  where p.active
    and app_private.can_be_finding_assignee(
      p.user_id, v_finding.inventory_id, v_finding.warehouse_id
    )
  order by p.display_name, p.user_id;
end
$function$;

revoke all on function public.list_reference_finding_assignees(uuid) from public, anon;
grant execute on function public.list_reference_finding_assignees(uuid) to authenticated;
