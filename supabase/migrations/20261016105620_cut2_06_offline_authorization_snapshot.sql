-- CUT2-06D: the offline lease is a server-verified capability snapshot,
-- never a cached role or "isAdmin" flag.  It is deliberately limited to the
-- active C1 capture context; all mutations are still revalidated on sync.
create or replace function public.get_my_counting_authorization_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  v_actor uuid:=app_private.require_active_actor();
  v_profile public.profiles;
  v_context record;
  v_context_count integer;
  v_capabilities jsonb;
  v_inventory_scopes jsonb;
  v_warehouse_scopes jsonb;
begin
  select * into v_profile from public.profiles where user_id=v_actor and active;
  select count(*) into v_context_count
  from public.inventories i
  where i.status='ABIERTO'
    and app_private.actor_has_capability(v_actor,'COUNT_C1',i.id,i.warehouse_id);
  if v_context_count=0 then
    return jsonb_build_object('status','NOT_AUTHORIZED','schema_version',1,'verified_at',now());
  end if;
  if v_context_count<>1 then
    return jsonb_build_object('status','AMBIGUOUS','schema_version',1,'verified_at',now());
  end if;
  select i.id,i.warehouse_id into v_context
  from public.inventories i
  where i.status='ABIERTO'
    and app_private.actor_has_capability(v_actor,'COUNT_C1',i.id,i.warehouse_id);

  select coalesce(jsonb_agg(capability order by capability),'[]'::jsonb)
  into v_capabilities
  from (
    select distinct capability::text as capability
    from unnest(enum_range(null::public.cut2_capability)) capability
    where app_private.actor_has_capability(v_actor,capability,v_context.id,v_context.warehouse_id)
  ) permitted;
  v_inventory_scopes:=jsonb_build_array(v_context.id);
  v_warehouse_scopes:=jsonb_build_array(v_context.warehouse_id);
  return jsonb_build_object(
    'status','AUTHORIZED',
    'schema_version',1,
    'actor_id',v_actor,
    'role',v_profile.role,
    'user_type',v_profile.user_type,
    'capabilities',v_capabilities,
    'inventory_scopes',v_inventory_scopes,
    'warehouse_scopes',v_warehouse_scopes,
    'inventory_id',v_context.id,
    'warehouse_id',v_context.warehouse_id,
    'verified_at',now()
  );
end
$function$;

revoke all on function public.get_my_counting_authorization_snapshot() from public,anon;
grant execute on function public.get_my_counting_authorization_snapshot() to authenticated;
