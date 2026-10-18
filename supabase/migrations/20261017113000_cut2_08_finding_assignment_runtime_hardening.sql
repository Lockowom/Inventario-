-- CUT2-08H: assignment must validate the assignee through an internal
-- definer boundary.  The capability helper intentionally has no public
-- EXECUTE grant, so calling it directly from a public RPC is not valid.
create or replace function app_private.can_be_finding_assignee(
  p_actor uuid,
  p_inventory_id uuid,
  p_warehouse_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.actor_has_capability(
    p_actor,
    'FINDING_RESOLVE'::public.cut2_capability,
    p_inventory_id,
    p_warehouse_id
  )
$$;

create or replace function public.assign_reference_finding(
  p_finding_id uuid,
  p_assigned_to uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_active_actor();
  v_finding public.reference_findings;
begin
  select * into v_finding
  from public.reference_findings
  where id = p_finding_id
  for update;

  if v_finding.id is null then
    raise exception 'FINDING_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform app_private.require_finding_capability(
    v_actor, 'FINDING_ASSIGN', v_finding.inventory_id, v_finding.warehouse_id
  );

  if v_finding.state not in ('OPEN', 'HELD') then
    raise exception 'FINDING_NOT_OPEN' using errcode = '23514';
  end if;

  if p_assigned_to is not null
     and not app_private.can_be_finding_assignee(
       p_assigned_to, v_finding.inventory_id, v_finding.warehouse_id
     ) then
    raise exception 'ASSIGNEE_CANNOT_RESOLVE_FINDING' using errcode = '42501';
  end if;

  -- A retry with the same assignee is a genuine idempotent no-op: no row
  -- update, no timestamp churn and no duplicate ASSIGNED timeline event.
  if v_finding.assigned_to is not distinct from p_assigned_to then
    return v_finding.id;
  end if;

  update public.reference_findings
  set assigned_to = p_assigned_to,
      assigned_at = case when p_assigned_to is null then null else now() end,
      updated_at = now()
  where id = v_finding.id;

  return v_finding.id;
end
$$;

revoke all on function app_private.can_be_finding_assignee(uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.assign_reference_finding(uuid,uuid) from public, anon;
grant execute on function public.assign_reference_finding(uuid,uuid) to authenticated;
