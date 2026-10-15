-- CUT2-03D certification hardening.
-- A rolling C2 may be queued before global C1 completes, but it must retain
-- the F16 self-recount exclusion: the user who supplied the C1 evidence for a
-- reference cannot claim that reference's C2.

create or replace function public.get_my_recount_queue(p_inventory_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=public,app_private,pg_temp
as $function$
declare v_actor uuid:=app_private.require_active_actor(); v_role public.app_role; v_active uuid; v_round integer; v_queued integer:=0; v_c1_done boolean:=false;
begin
  if not app_private.can_access_inventory(p_inventory_id) then raise exception 'Not authorized for inventory' using errcode='42501'; end if;
  select role into v_role from public.profiles where user_id=v_actor and active;
  v_round:=case when v_role='CONTADOR' then 2 when v_role in('ANALISTA','ADMIN') then 3 else null end;
  select c1_completed_at is not null into v_c1_done from public.inventories where id=p_inventory_id;
  select id into v_active from public.recount_missions where inventory_id=p_inventory_id and assigned_user_id=v_actor and status='ACTIVE' order by claimed_at,id limit 1;
  if v_round is not null then
    select count(*)::integer into v_queued from public.recount_missions m
    where m.inventory_id=p_inventory_id and m.round=v_round and m.status='QUEUED'
      and (v_c1_done or (v_round=2 and m.source_cut_id is not null))
      and (v_round<>2 or not exists(
        select 1
        from public.reconciliation_cases rc
        join public.count_records cr on cr.inventory_id=rc.inventory_id and cr.codigo=rc.codigo
          and ((rc.reference_type='SERIAL' and coalesce(cr.serie,'')=coalesce(rc.reference_value,''))
            or (rc.reference_type='PARTIDA' and coalesce(cr.partida,'')=coalesce(rc.reference_value,''))
            or rc.reference_type='LEGACY')
        where rc.id=m.case_id and cr.user_id=v_actor
          and not exists(select 1 from public.recount_mission_observations rmo where rmo.count_record_id=cr.id)
      ));
  end if;
  return jsonb_build_object('inventory_id',p_inventory_id,'round',v_round,'c1_completed',coalesce(v_c1_done,false),'queued_count',v_queued,'active',case when v_active is null then null else app_private.recount_mission_json(v_active) end);
end
$function$;

create or replace function public.claim_next_recount_mission(p_inventory_id uuid)
returns jsonb language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare v_actor uuid:=app_private.require_active_actor(); v_role public.app_role; v_round integer; v_mission public.recount_missions; v_existing uuid; v_c1_done boolean:=false; v_transitioned integer:=0;
begin
  if not app_private.can_access_inventory(p_inventory_id) then raise exception 'Not authorized for inventory' using errcode='42501'; end if;
  select role into v_role from public.profiles where user_id=v_actor and active;
  v_round:=case when v_role='CONTADOR' then 2 when v_role in('ANALISTA','ADMIN') then 3 else null end;
  if v_round is null then raise exception 'Role does not admit recount missions' using errcode='42501'; end if;
  if v_round=2 and not public.cut2_has_capability(p_inventory_id,'RECOUNT_C2') then raise exception 'RECOUNT_C2 capability is required' using errcode='42501'; end if;
  select id into v_existing from public.recount_missions where inventory_id=p_inventory_id and assigned_user_id=v_actor and status='ACTIVE' order by claimed_at,id limit 1;
  if v_existing is not null then return app_private.recount_mission_json(v_existing); end if;
  select c1_completed_at is not null into v_c1_done from public.inventories where id=p_inventory_id and status='ABIERTO';
  select m.* into v_mission from public.recount_missions m
  where m.inventory_id=p_inventory_id and m.round=v_round and m.status='QUEUED'
    and (v_c1_done or (v_round=2 and m.source_cut_id is not null))
    and (v_round<>2 or not exists(
      select 1
      from public.reconciliation_cases rc
      join public.count_records cr on cr.inventory_id=rc.inventory_id and cr.codigo=rc.codigo
        and ((rc.reference_type='SERIAL' and coalesce(cr.serie,'')=coalesce(rc.reference_value,''))
          or (rc.reference_type='PARTIDA' and coalesce(cr.partida,'')=coalesce(rc.reference_value,''))
          or rc.reference_type='LEGACY')
      where rc.id=m.case_id and cr.user_id=v_actor
        and not exists(select 1 from public.recount_mission_observations rmo where rmo.count_record_id=cr.id)
    ))
  order by m.created_at,m.id for update skip locked limit 1;
  if v_mission.id is null then return null; end if;
  update public.recount_missions set assigned_user_id=v_actor,status='ACTIVE',claimed_at=now() where id=v_mission.id;
  update public.reconciliation_cases set status=case when v_round=2 then '2DO_CONTEO_ASIGNADO'::public.reconciliation_status else '3ER_CONTEO_ASIGNADO'::public.reconciliation_status end
  where id=v_mission.case_id and status=case when v_round=2 then 'REQUIERE_2DO_CONTEO'::public.reconciliation_status else 'REQUIERE_3ER_CONTEO'::public.reconciliation_status end;
  get diagnostics v_transitioned=row_count;
  if v_transitioned<>1 then raise exception 'Recount case state changed before mission claim' using errcode='40001'; end if;
  perform app_private.append_reconciliation_event(v_mission.case_id,p_inventory_id,case when v_round=2 then 'SECOND_ASSIGNED' else 'THIRD_ASSIGNED' end,v_actor,jsonb_build_object('mission_id',v_mission.id,'assigned_user_id',v_actor,'round',v_round,'assignment_mode','QUEUE_CLAIM'));
  return app_private.recount_mission_json(v_mission.id);
end
$function$;
