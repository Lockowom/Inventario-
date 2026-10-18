-- CUT2-08H: a private SECURITY DEFINER predicate avoids invoking a revoked
-- helper with the request role.  It is the same deny-by-default matrix used
-- by CUT2-06, scoped to the supplied actor/resource and inaccessible to API
-- roles.
create or replace function app_private.finding_actor_has_capability(
  p_actor uuid,
  p_capability public.cut2_capability,
  p_inventory_id uuid,
  p_warehouse_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select p.user_id, p.role, p.user_type
    from public.profiles p
    where p.user_id = p_actor and p.active
  ), resource as (
    select i.id inventory_id, i.warehouse_id
    from public.inventories i
    where i.id = p_inventory_id
  ), eligible_assignment as (
    select 1
    from public.inventory_assignments a
    join actor x on x.user_id = a.user_id
    where a.inventory_id = p_inventory_id
      and a.active
      and a.valid_from <= now()
      and (a.valid_until is null or a.valid_until > now())
  ), allowed_type as (
    select 1
    from actor x
    join public.cut2_user_type_capability_allowlist l on l.user_type = x.user_type
    where l.capability = p_capability
  ), default_policy as (
    select 1
    from actor x
    join public.cut2_default_capability_policies d
      on d.role = x.role and d.user_type = x.user_type
     and d.capability = p_capability and d.active
    where d.scope = 'GLOBAL'
       or (d.scope = 'INVENTORY' and exists (select 1 from eligible_assignment))
       or (
         d.scope = 'WAREHOUSE'
         and exists (select 1 from eligible_assignment)
         and exists (
           select 1 from resource r
           where r.warehouse_id = coalesce(p_warehouse_id, r.warehouse_id)
         )
       )
  ), explicit_grant as (
    select 1
    from actor x
    join public.inventory_capability_grants g on g.user_id = x.user_id
    where g.capability = p_capability
      and g.valid_from <= now()
      and (g.valid_until is null or g.valid_until > now())
      and (
        g.scope = 'GLOBAL'
        or (g.scope = 'INVENTORY' and g.inventory_id = p_inventory_id and exists (select 1 from eligible_assignment))
        or (
          g.scope = 'WAREHOUSE'
          and g.warehouse_id = coalesce(p_warehouse_id, (select warehouse_id from resource))
          and exists (select 1 from eligible_assignment)
        )
      )
  )
  select exists (select 1 from actor)
     and exists (select 1 from allowed_type)
     and (exists (select 1 from default_policy) or exists (select 1 from explicit_grant))
$$;

create or replace function app_private.require_finding_capability(
  p_actor uuid,
  p_capability public.cut2_capability,
  p_inventory_id uuid,
  p_warehouse_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.require_active_actor();
  if p_actor is null
     or p_actor <> auth.uid()
     or not app_private.finding_actor_has_capability(
       p_actor, p_capability, p_inventory_id, p_warehouse_id
     ) then
    raise exception 'CAPABILITY_REQUIRED'
      using errcode = '42501', detail = p_capability::text;
  end if;
end
$$;

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
  select app_private.finding_actor_has_capability(
    p_actor,
    'FINDING_RESOLVE'::public.cut2_capability,
    p_inventory_id,
    p_warehouse_id
  )
$$;

revoke all on function app_private.finding_actor_has_capability(uuid,public.cut2_capability,uuid,uuid),
  app_private.require_finding_capability(uuid,public.cut2_capability,uuid,uuid),
  app_private.can_be_finding_assignee(uuid,uuid,uuid)
from public, anon, authenticated;
