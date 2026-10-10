-- Phase 12: ADMIN-only user lifecycle. Passwords never enter PostgreSQL or audit payloads.
create type public.user_management_event_type as enum (
  'USER_CREATED',
  'USER_UPDATED',
  'USER_PASSWORD_RESET'
);

create table public.user_management_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.profiles(user_id) on delete restrict,
  target_user_id uuid not null references public.profiles(user_id) on delete restrict,
  event_type public.user_management_event_type not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (payload ?& array['display_name', 'role', 'active'])
);

create index user_management_events_target_created_idx
  on public.user_management_events (target_user_id, created_at desc);

alter table public.user_management_events enable row level security;
revoke all on public.user_management_events from public, anon, authenticated;

create policy user_management_events_select_admin
  on public.user_management_events for select to authenticated
  using ((select app_private.is_admin()));

grant select on public.user_management_events to authenticated;

create function public.admin_upsert_user_profile(
  p_target_user_id uuid,
  p_display_name text,
  p_role public.app_role,
  p_active boolean,
  p_inventory_ids uuid[] default '{}'::uuid[],
  p_event_type public.user_management_event_type default 'USER_UPDATED'
) returns public.profiles
language plpgsql security definer
set search_path = public, app_private, auth, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
  v_result public.profiles;
  v_name text := btrim(p_display_name);
  v_inventory_ids uuid[] := coalesce(p_inventory_ids, '{}'::uuid[]);
  v_existing public.profiles;
begin
  if v_actor_id is null or not app_private.is_admin() then
    raise exception 'Administrator authorization is required' using errcode = '42501';
  end if;
  if p_target_user_id is null or v_name = '' or length(v_name) > 160 then
    raise exception 'Invalid managed user profile' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_target_user_id) then
    raise exception 'Authentication user not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from unnest(v_inventory_ids) as supplied(id) where id is null)
    or cardinality(v_inventory_ids) <> cardinality(array(select distinct id from unnest(v_inventory_ids) as distinct_ids(id))) then
    raise exception 'Inventory assignments must be unique UUIDs' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_inventory_ids) as supplied(id) where not exists (select 1 from public.inventories where id = supplied.id)) then
    raise exception 'An assigned inventory does not exist' using errcode = '23503';
  end if;

  select * into v_existing from public.profiles where user_id = p_target_user_id for update;
  if found and v_existing.role = 'ADMIN' and v_existing.active
    and (p_role <> 'ADMIN' or not p_active)
    and not exists (select 1 from public.profiles where user_id <> p_target_user_id and role = 'ADMIN' and active) then
    raise exception 'At least one active administrator is required' using errcode = '23514';
  end if;

  insert into public.profiles (user_id, display_name, role, active)
  values (p_target_user_id, v_name, p_role, p_active)
  on conflict (user_id) do update set display_name = excluded.display_name, role = excluded.role, active = excluded.active
  returning * into v_result;

  update public.inventory_assignments
  set active = false
  where user_id = p_target_user_id and active
    and not (inventory_id = any(v_inventory_ids));

  insert into public.inventory_assignments (inventory_id, user_id, active, assigned_by)
  select supplied.id, p_target_user_id, true, v_actor_id
  from unnest(v_inventory_ids) as supplied(id)
  on conflict (inventory_id, user_id) do update set active = true, assigned_by = excluded.assigned_by;

  insert into public.user_management_events (actor_user_id, target_user_id, event_type, payload)
  values (v_actor_id, p_target_user_id, p_event_type,
    jsonb_build_object('display_name', v_result.display_name, 'role', v_result.role, 'active', v_result.active,
      'assigned_inventory_count', cardinality(v_inventory_ids)));
  return v_result;
end;
$$;

create function public.admin_record_user_password_reset(p_target_user_id uuid)
returns void language plpgsql security definer
set search_path = public, app_private, pg_temp
as $$
declare v_actor_id uuid := auth.uid(); v_profile public.profiles;
begin
  if v_actor_id is null or not app_private.is_admin() then
    raise exception 'Administrator authorization is required' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where user_id = p_target_user_id;
  if not found then raise exception 'Managed user profile not found' using errcode = 'P0002'; end if;
  insert into public.user_management_events (actor_user_id, target_user_id, event_type, payload)
  values (v_actor_id, p_target_user_id, 'USER_PASSWORD_RESET',
    jsonb_build_object('display_name', v_profile.display_name, 'role', v_profile.role, 'active', v_profile.active));
end;
$$;

revoke all on function public.admin_upsert_user_profile(uuid, text, public.app_role, boolean, uuid[], public.user_management_event_type) from public, anon;
revoke all on function public.admin_record_user_password_reset(uuid) from public, anon;
grant execute on function public.admin_upsert_user_profile(uuid, text, public.app_role, boolean, uuid[], public.user_management_event_type) to authenticated;
grant execute on function public.admin_record_user_password_reset(uuid) to authenticated;
