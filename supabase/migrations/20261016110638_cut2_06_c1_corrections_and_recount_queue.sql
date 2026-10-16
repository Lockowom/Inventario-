-- CUT2-06F: remaining C1 correction and C2/C3 queue entry paths.
do $migration$
declare
  v_definition text;
  v_new text := E'  -- CUT2_06_CORRECTION_CAPABILITY: the original C1 actor needs COUNT_C1;\n  -- a distinct reconciliation authority is required to correct another user.\n  if v_count.user_id=v_actor then\n    perform app_private.require_inventory_capability(v_count.inventory_id,\'COUNT_C1\',v_inventory.warehouse_id);\n  else\n    perform app_private.require_inventory_capability(v_count.inventory_id,\'MANAGE_RECONCILIATION\',v_inventory.warehouse_id);\n  end if;';
begin
  select pg_get_functiondef('public.correct_uncut_count(uuid,jsonb,text)'::regprocedure) into v_definition;
  if position('CUT2_06_CORRECTION_CAPABILITY' in v_definition)=0 then
    v_definition:=regexp_replace(v_definition,
      E'  if not \\(app_private\\.can_manage_inventory\\(v_count\\.inventory_id\\) or\\s*\\(v_count\\.user_id = v_actor and exists \\(\\s*select 1 from public\\.inventory_assignments a\\s*where a\\.inventory_id = v_count\\.inventory_id and a\\.user_id = v_actor and a\\.active\\s*\\)\\)\\) then\\s*raise exception ''Not authorized to correct this count'' using errcode = ''42501'';\\s*end if;',
      v_new,'n');
    if position('CUT2_06_CORRECTION_CAPABILITY' in v_definition)=0 then
      raise exception 'CUT2-06 correction authorization anchor changed' using errcode='P0001';
    end if;
    execute v_definition;
  end if;
end
$migration$;

create or replace function public.get_my_recount_queue(p_inventory_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=public,app_private,pg_temp
as $function$
declare v_actor uuid:=app_private.require_active_actor(); v_active uuid; v_round integer; v_queued integer:=0; v_c1_done boolean:=false;
begin
  if app_private.actor_has_capability(v_actor,'RECOUNT_C3',p_inventory_id) then
    v_round:=3;
  elsif app_private.actor_has_capability(v_actor,'RECOUNT_C2',p_inventory_id) then
    v_round:=2;
  else
    raise exception 'CAPABILITY_REQUIRED' using errcode='42501', detail='RECOUNT_C2_OR_RECOUNT_C3';
  end if;
  select c1_completed_at is not null into v_c1_done from public.inventories where id=p_inventory_id;
  select id into v_active from public.recount_missions where inventory_id=p_inventory_id and assigned_user_id=v_actor and status='ACTIVE' order by claimed_at,id limit 1;
  select count(*)::integer into v_queued from public.recount_missions m
  where m.inventory_id=p_inventory_id and m.round=v_round and m.status='QUEUED'
    and (v_c1_done or (v_round=2 and m.source_cut_id is not null))
    and (v_round<>2 or m.source_cut_id is not null or not exists(
      select 1 from public.reconciliation_cases rc
      join public.count_records cr on cr.inventory_id=rc.inventory_id and cr.codigo=rc.codigo
        and ((rc.reference_type='SERIAL' and coalesce(cr.serie,'')=coalesce(rc.reference_value,''))
          or (rc.reference_type='PARTIDA' and coalesce(cr.partida,'')=coalesce(rc.reference_value,''))
          or rc.reference_type='LEGACY')
      where rc.id=m.case_id and cr.user_id=v_actor
        and not exists(select 1 from public.recount_mission_observations rmo where rmo.count_record_id=cr.id)
    ));
  return jsonb_build_object('inventory_id',p_inventory_id,'round',v_round,'c1_completed',coalesce(v_c1_done,false),'queued_count',v_queued,'active',case when v_active is null then null else app_private.recount_mission_json(v_active) end);
end
$function$;

revoke all on function public.get_my_recount_queue(uuid) from public,anon;
grant execute on function public.get_my_recount_queue(uuid) to authenticated;
