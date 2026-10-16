-- CUT2-06E: user administration is capability- and scope-checked twice:
-- once with the caller JWT for the Edge boundary and once inside each
-- service-role-only mutation.  The latter prevents a compromised Edge route
-- from turning its service key into a privilege-escalation bypass.
create or replace function app_private.require_user_management_scope(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_inventory_ids uuid[],
  p_requested_role public.app_role
)
returns void
language plpgsql
stable
security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  v_global boolean;
begin
  if p_actor_user_id is null
    or not exists(select 1 from public.profiles where user_id=p_actor_user_id and active) then
    raise exception 'ACTOR_INACTIVE' using errcode='42501';
  end if;
  if p_target_user_id is not null and p_target_user_id=p_actor_user_id then
    raise exception 'SELF_MODIFICATION_DENIED' using errcode='42501';
  end if;
  v_global:=app_private.actor_has_capability(p_actor_user_id,'MANAGE_USERS',null)
    and app_private.actor_has_capability(p_actor_user_id,'MANAGE_ASSIGNMENTS',null);
  if not v_global and not exists(
    select 1 from public.inventories i
    where app_private.actor_has_capability(p_actor_user_id,'MANAGE_USERS',i.id,i.warehouse_id)
      and app_private.actor_has_capability(p_actor_user_id,'MANAGE_ASSIGNMENTS',i.id,i.warehouse_id)
  ) then
    raise exception 'CAPABILITY_REQUIRED' using errcode='42501', detail='MANAGE_USERS_AND_ASSIGNMENTS';
  end if;
  if not v_global and p_requested_role='ADMIN' then
    raise exception 'ROLE_ESCALATION_DENIED' using errcode='42501';
  end if;
  if not v_global and exists(
    select 1 from unnest(coalesce(p_inventory_ids,'{}'::uuid[])) supplied(id)
    join public.inventories i on i.id=supplied.id
    where not app_private.actor_has_capability(p_actor_user_id,'MANAGE_USERS',i.id,i.warehouse_id)
       or not app_private.actor_has_capability(p_actor_user_id,'MANAGE_ASSIGNMENTS',i.id,i.warehouse_id)
  ) then
    raise exception 'INVENTORY_SCOPE_DENIED' using errcode='42501';
  end if;
  if not v_global and p_target_user_id is not null and exists(
    select 1 from public.inventory_assignments a
    join public.inventories i on i.id=a.inventory_id
    where a.user_id=p_target_user_id and a.active
      and (not app_private.actor_has_capability(p_actor_user_id,'MANAGE_USERS',i.id,i.warehouse_id)
        or not app_private.actor_has_capability(p_actor_user_id,'MANAGE_ASSIGNMENTS',i.id,i.warehouse_id))
  ) then
    raise exception 'TARGET_SCOPE_DENIED' using errcode='42501';
  end if;
end
$function$;

create or replace function public.get_my_user_management_scope()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  v_actor uuid:=app_private.require_active_actor();
  v_global boolean;
  v_inventory_ids jsonb;
begin
  v_global:=app_private.actor_has_capability(v_actor,'MANAGE_USERS',null)
    and app_private.actor_has_capability(v_actor,'MANAGE_ASSIGNMENTS',null);
  if v_global then
    select coalesce(jsonb_agg(i.id order by i.id),'[]'::jsonb) into v_inventory_ids from public.inventories i;
  else
    select coalesce(jsonb_agg(i.id order by i.id),'[]'::jsonb) into v_inventory_ids
    from public.inventories i
    where app_private.actor_has_capability(v_actor,'MANAGE_USERS',i.id,i.warehouse_id)
      and app_private.actor_has_capability(v_actor,'MANAGE_ASSIGNMENTS',i.id,i.warehouse_id);
  end if;
  if jsonb_array_length(v_inventory_ids)=0 then
    raise exception 'CAPABILITY_REQUIRED' using errcode='42501', detail='MANAGE_USERS_AND_ASSIGNMENTS';
  end if;
  return jsonb_build_object('actor_id',v_actor,'global',v_global,'inventory_ids',v_inventory_ids,'schema_version',1);
end
$function$;

create or replace function public.admin_upsert_user_profile_from_edge(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_display_name text,
  p_role public.app_role,
  p_active boolean,
  p_inventory_ids uuid[] default '{}'::uuid[],
  p_event_type public.user_management_event_type default 'USER_UPDATED'
) returns public.profiles
language plpgsql security definer
set search_path = public, app_private, auth, pg_temp
as $function$
declare
  v_result public.profiles;
  v_name text := btrim(p_display_name);
  v_inventory_ids uuid[] := coalesce(p_inventory_ids, '{}'::uuid[]);
  v_existing public.profiles;
begin
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
  perform app_private.require_user_management_scope(p_actor_user_id,p_target_user_id,v_inventory_ids,p_role);
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
  update public.inventory_assignments set active = false
  where user_id = p_target_user_id and active and not (inventory_id = any(v_inventory_ids));
  insert into public.inventory_assignments (inventory_id, user_id, active, assigned_by)
  select supplied.id, p_target_user_id, true, p_actor_user_id
  from unnest(v_inventory_ids) as supplied(id)
  on conflict (inventory_id, user_id) do update set active = true, assigned_by = excluded.assigned_by;
  insert into public.user_management_events (actor_user_id, target_user_id, event_type, payload)
  values (p_actor_user_id, p_target_user_id, p_event_type,
    jsonb_build_object('display_name',v_result.display_name,'role',v_result.role,'active',v_result.active,'assigned_inventory_count',cardinality(v_inventory_ids),'authorization_model','CUT2_06'));
  return v_result;
end
$function$;

create or replace function public.admin_record_user_password_reset_from_edge(p_actor_user_id uuid,p_target_user_id uuid)
returns void language plpgsql security definer
set search_path = public, app_private, pg_temp
as $function$
declare v_profile public.profiles;
begin
  select * into v_profile from public.profiles where user_id=p_target_user_id;
  if not found then raise exception 'Managed user profile not found' using errcode='P0002'; end if;
  perform app_private.require_user_management_scope(p_actor_user_id,p_target_user_id,array(select inventory_id from public.inventory_assignments where user_id=p_target_user_id and active),v_profile.role);
  insert into public.user_management_events(actor_user_id,target_user_id,event_type,payload)
  values(p_actor_user_id,p_target_user_id,'USER_PASSWORD_RESET',jsonb_build_object('display_name',v_profile.display_name,'role',v_profile.role,'active',v_profile.active,'authorization_model','CUT2_06'));
end
$function$;

revoke all on function app_private.require_user_management_scope(uuid,uuid,uuid[],public.app_role) from public,anon,authenticated;
revoke all on function public.get_my_user_management_scope() from public,anon;
grant execute on function public.get_my_user_management_scope() to authenticated;
revoke all on function public.admin_upsert_user_profile_from_edge(uuid,uuid,text,public.app_role,boolean,uuid[],public.user_management_event_type), public.admin_record_user_password_reset_from_edge(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_upsert_user_profile_from_edge(uuid,uuid,text,public.app_role,boolean,uuid[],public.user_management_event_type), public.admin_record_user_password_reset_from_edge(uuid,uuid) to service_role;
