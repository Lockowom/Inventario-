-- CUT2-06C: C1, rolling-cut and Monitor consumers use capability + scope.
-- The guarded textual rewrites are intentional: these mature RPCs carry
-- business invariants that must not be copied or weakened in an auth change.

do $migration$
declare
  v_definition text;
  v_old text := E'  if not app_private.can_access_inventory(p_inventory_id) then raise exception \'Not authorized for inventory\' using errcode=\'42501\'; end if;\n  v_inventory:=app_private.lock_inventory(p_inventory_id);';
  v_new text := E'  -- CUT2_06_COUNT_CAPABILITY_GUARD: every accepted C1/C2/C3 record is\n  -- authorized below against its actual stage; this outer check blocks an\n  -- otherwise unscoped parser/legacy-adapter entry.\n  if not (app_private.actor_has_capability(v_actor,\'COUNT_C1\',p_inventory_id)\n    or app_private.actor_has_capability(v_actor,\'RECOUNT_C2\',p_inventory_id)\n    or app_private.actor_has_capability(v_actor,\'RECOUNT_C3\',p_inventory_id)) then\n    raise exception \'CAPABILITY_REQUIRED\' using errcode=\'42501\', detail=\'COUNT_C1_OR_RECOUNT\';\n  end if;\n  v_inventory:=app_private.lock_inventory(p_inventory_id);';
  v_count_anchor text := E'    v_recount_id:=app_private.active_recount_mission_for_count(p_inventory_id,v_actor,v_codigo,v_serie,v_partida);';
  v_count_guard text := E'    v_recount_id:=app_private.active_recount_mission_for_count(p_inventory_id,v_actor,v_codigo,v_serie,v_partida);\n    -- CUT2_06_COUNT_STAGE_CAPABILITY: C1 and recount evidence have separate\n    -- capabilities even though both travel through the same offline outbox.\n    if v_recount_id is null then\n      if not app_private.actor_has_capability(v_actor,\'COUNT_C1\',p_inventory_id,v_inventory.warehouse_id) then\n        raise exception \'CAPABILITY_REQUIRED\' using errcode=\'42501\', detail=\'COUNT_C1\';\n      end if;\n    elsif not exists (\n      select 1 from public.recount_missions rm\n      where rm.id=v_recount_id and (\n        (rm.round=2 and app_private.actor_has_capability(v_actor,\'RECOUNT_C2\',p_inventory_id,v_inventory.warehouse_id))\n        or (rm.round=3 and app_private.actor_has_capability(v_actor,\'RECOUNT_C3\',p_inventory_id,v_inventory.warehouse_id))\n      )\n    ) then\n      raise exception \'CAPABILITY_REQUIRED\' using errcode=\'42501\', detail=\'RECOUNT_STAGE\';\n    end if;';
begin
  select pg_get_functiondef('public.sync_counts(uuid,uuid,public.device_platform,text,text,jsonb)'::regprocedure) into v_definition;
  if position('CUT2_06_COUNT_CAPABILITY_GUARD' in v_definition)=0 then
    if position(v_old in v_definition)=0 or position(v_count_anchor in v_definition)=0 then
      raise exception 'CUT2-06 C1 authorization anchors changed; refusing blind rewrite' using errcode='P0001';
    end if;
    v_definition:=replace(v_definition,v_old,v_new);
    v_definition:=replace(v_definition,v_count_anchor,v_count_guard);
    execute v_definition;
  end if;
end
$migration$;

do $migration$
declare
  v_definition text;
  v_old text := E'  perform app_private.require_active_actor();\n  if not app_private.can_manage_inventory(p_inventory_id) then\n    raise exception \'Not authorized for rolling cut preview\' using errcode = \'42501\';\n  end if;';
  v_new text := E'  -- CUT2_06_ROLLING_PREVIEW_CAPABILITY\n  perform app_private.require_inventory_capability(p_inventory_id,\'ROLLING_CUT_PREVIEW\',p_warehouse_id);';
begin
  select pg_get_functiondef('app_private.preview_rolling_cut_v2_base(uuid,uuid,jsonb)'::regprocedure) into v_definition;
  if position('CUT2_06_ROLLING_PREVIEW_CAPABILITY' in v_definition)=0 then
    if position(v_old in v_definition)=0 then
      raise exception 'CUT2-06 rolling preview authorization anchor changed' using errcode='P0001';
    end if;
    execute replace(v_definition,v_old,v_new);
  end if;
end
$migration$;

do $migration$
declare
  v_definition text;
  v_old text := E'  if not app_private.can_manage_inventory(p_inventory_id) then raise exception \'Not authorized for rolling cut\' using errcode=\'42501\'; end if;';
  v_new text := E'  -- CUT2_06_ROLLING_CREATE_CAPABILITY\n  perform app_private.require_inventory_capability(p_inventory_id,\'ROLLING_CUT_CREATE\');';
begin
  select pg_get_functiondef('public.create_rolling_cut_v2(uuid,uuid,text,jsonb)'::regprocedure) into v_definition;
  if position('CUT2_06_ROLLING_CREATE_CAPABILITY' in v_definition)=0 then
    if position(v_old in v_definition)=0 then
      raise exception 'CUT2-06 rolling create authorization anchor changed' using errcode='P0001';
    end if;
    execute replace(v_definition,v_old,v_new);
  end if;
end
$migration$;

do $migration$
declare
  v_proc regprocedure;
  v_definition text;
  v_old text := E'  perform app_private.require_active_actor();\n  if not app_private.can_manage_inventory(p_inventory_id) then\n    raise exception \'Not authorized for live monitor\' using errcode = \'42501\';\n  end if;';
  v_new text := E'  -- CUT2_06_VIEW_MONITOR_CAPABILITY: payload and aggregates are\n  -- evaluated only after the scoped capability guard.\n  perform app_private.require_inventory_capability(p_inventory_id,\'VIEW_MONITOR\');';
begin
  foreach v_proc in array array[
    'public.get_live_monitor_summary(uuid)'::regprocedure,
    'public.get_live_monitor_coverage(uuid,text,text,integer,integer)'::regprocedure,
    'public.get_live_monitor_activity(uuid,integer,timestamp with time zone,uuid,text,text)'::regprocedure,
    'public.get_live_monitor_missions(uuid,integer)'::regprocedure
  ] loop
    select pg_get_functiondef(v_proc) into v_definition;
    if position('CUT2_06_VIEW_MONITOR_CAPABILITY' in v_definition)=0 then
      if position(v_old in v_definition)=0 then
        raise exception 'CUT2-06 monitor authorization anchor changed for %',v_proc using errcode='P0001';
      end if;
      execute replace(v_definition,v_old,v_new);
    end if;
  end loop;
end
$migration$;

revoke all on function app_private.require_inventory_capability(uuid,public.cut2_capability,uuid) from public,anon,authenticated;
