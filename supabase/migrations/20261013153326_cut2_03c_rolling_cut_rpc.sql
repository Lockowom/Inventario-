-- CUT2-03C: atomic reference-scoped sealing. Inventory-row locking is shared
-- with sync_counts and correct_uncut_count, so a count/correction commits
-- either before the snapshot or is rejected after the reference is sealed.

alter function public.sync_counts(uuid,uuid,public.device_platform,text,text,jsonb)
  rename to sync_counts_pre_cut2_03;
alter function public.sync_counts_pre_cut2_03(uuid,uuid,public.device_platform,text,text,jsonb)
  set schema app_private;

create or replace function public.sync_counts(
  p_inventory_id uuid,p_device_id uuid,p_platform public.device_platform,p_app_version text,p_device_label text,p_records jsonb
)
returns table(client_count_id uuid,result_status text,server_count_id uuid,received_at timestamptz,reason text)
language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  v_actor uuid:=app_private.require_active_actor();
  v_inventory public.inventories;
  v_record jsonb;
  v_forwarded jsonb:='[]'::jsonb;
  v_client_count_id uuid;
  v_codigo text;
  v_serie text;
  v_partida text;
  v_master public.inventory_master_items;
  v_key text;
  v_sealed_id uuid;
  v_recount_id uuid;
begin
  -- C1_COMPLETED and recount_mission_observations remain enforced by the
  -- preserved F16 sync implementation after sealed-reference preflight.
  if p_records is null or jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)=0 or jsonb_array_length(p_records)>20 then
    return query select * from app_private.sync_counts_pre_cut2_03(p_inventory_id,p_device_id,p_platform,p_app_version,p_device_label,p_records);
    return;
  end if;
  if not app_private.can_access_inventory(p_inventory_id) then raise exception 'Not authorized for inventory' using errcode='42501'; end if;
  v_inventory:=app_private.lock_inventory(p_inventory_id);
  for v_record in select value from jsonb_array_elements(p_records) loop
    begin
      v_client_count_id:=(v_record->>'client_count_id')::uuid;
      v_codigo:=upper(btrim(v_record->>'codigo'));
      v_serie:=nullif(btrim(v_record->>'serie'),'');
      v_partida:=nullif(btrim(v_record->>'partida'),'');
      select mi.* into v_master from public.inventory_master_items mi where mi.inventory_id=p_inventory_id and mi.codigo=v_codigo;
      if v_master.codigo is null then raise exception 'defer'; end if;
      v_key:=public.normalize_reference_key(v_master.control_type,v_codigo,case when v_master.control_type='SERIAL' then v_serie when v_master.control_type='PARTIDA' then v_partida else null end);
    exception when others then
      v_forwarded:=v_forwarded || jsonb_build_array(v_record);
      continue;
    end;
    -- A replay that was accepted before sealing remains idempotently accepted.
    if exists(select 1 from public.count_records cr where cr.client_count_id=v_client_count_id) then
      v_forwarded:=v_forwarded || jsonb_build_array(v_record);
      continue;
    end if;
    v_recount_id:=app_private.active_recount_mission_for_count(p_inventory_id,v_actor,v_codigo,v_serie,v_partida);
    select sr.id into v_sealed_id from public.inventory_sealed_references sr
      where sr.inventory_id=p_inventory_id and sr.warehouse_id=v_inventory.warehouse_id
        and sr.normalized_reference_key=v_key and sr.state in ('SEALING','SEALED');
    if v_sealed_id is not null and v_recount_id is null then
      client_count_id:=v_client_count_id; result_status:='REJECTED'; server_count_id:=null; received_at:=null; reason:='REFERENCE_SEALED'; return next;
    else
      v_forwarded:=v_forwarded || jsonb_build_array(v_record);
    end if;
  end loop;
  if jsonb_array_length(v_forwarded)>0 then
    return query select * from app_private.sync_counts_pre_cut2_03(p_inventory_id,p_device_id,p_platform,p_app_version,p_device_label,v_forwarded);
  end if;
end
$function$;

create or replace function public.create_rolling_cut_v2(
  p_inventory_id uuid,
  p_request_id uuid,
  p_preview_fingerprint text,
  p_selection jsonb
)
returns jsonb
language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  v_actor uuid:=app_private.require_active_actor();
  v_inventory public.inventories;
  v_existing public.rolling_cut_requests;
  v_cut_id uuid:=gen_random_uuid();
  v_cut_number integer;
  v_preview jsonb;
  v_keys text[];
  v_selection_fingerprint text;
  v_item jsonb;
  v_reference public.inventory_sealed_references;
  v_case public.reconciliation_cases;
  v_source_count integer;
  v_source_root text;
  v_record_count integer:=0;
  v_c2_count integer:=0;
begin
  if p_request_id is null then raise exception 'request_id is required' using errcode='23514'; end if;
  if p_preview_fingerprint is null or p_preview_fingerprint !~ '^[A-Fa-f0-9]{64}$' then raise exception 'preview_fingerprint must be a SHA-256 hex value' using errcode='23514'; end if;
  if p_selection is null or jsonb_typeof(p_selection)<>'object' or jsonb_typeof(p_selection->'normalized_reference_keys')<>'array' then raise exception 'selection must contain normalized_reference_keys' using errcode='22023'; end if;
  select array_agg(distinct value order by value) into v_keys from jsonb_array_elements_text(p_selection->'normalized_reference_keys') value;
  if cardinality(v_keys) is null or cardinality(v_keys)=0 then raise exception 'EMPTY_SELECTION' using errcode='23514'; end if;
  if jsonb_array_length(p_selection->'normalized_reference_keys')<>cardinality(v_keys) then raise exception 'INVALID_SELECTION' using errcode='23514'; end if;
  if cardinality(v_keys)>500 then raise exception 'SELECTION_LIMIT_EXCEEDED' using errcode='23514'; end if;
  if exists(select 1 from unnest(v_keys) k where length(btrim(k))=0 or length(k)>512) then raise exception 'INVALID_SELECTION' using errcode='23514'; end if;
  v_selection_fingerprint:=encode(extensions.digest(convert_to(array_to_string(v_keys,E'\x1e'),'utf8'),'sha256'),'hex');
  if not app_private.can_manage_inventory(p_inventory_id) then raise exception 'Not authorized for rolling cut' using errcode='42501'; end if;
  v_inventory:=app_private.lock_inventory(p_inventory_id);
  if v_inventory.status<>'ABIERTO' then raise exception 'Rolling cuts require an open inventory' using errcode='23514'; end if;

  select r.* into v_existing from public.rolling_cut_requests r where r.inventory_id=p_inventory_id and r.request_id=p_request_id for update;
  if v_existing.id is not null then
    if v_existing.preview_fingerprint<>lower(p_preview_fingerprint) or v_existing.selection_fingerprint<>v_selection_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
    return jsonb_build_object('cut_id',v_existing.cut_id,'request_id',p_request_id,'idempotent_replay',true);
  end if;

  v_preview:=public.preview_rolling_cut_v2(p_inventory_id,v_inventory.warehouse_id,jsonb_build_object('normalized_reference_keys',to_jsonb(v_keys)));
  if lower(v_preview->>'preview_fingerprint')<>lower(p_preview_fingerprint) then raise exception 'PREVIEW_STALE' using errcode='P0001'; end if;
  if (select count(*) from jsonb_array_elements(v_preview->'items'))<>cardinality(v_keys)
     or exists(select 1 from jsonb_array_elements(v_preview->'items') i where coalesce(i->>'block_reason','')<>'' or coalesce((i->>'c1_quantity')::integer,0)<=0) then
    raise exception 'REFERENCE_NOT_ELIGIBLE' using errcode='23514';
  end if;

  select coalesce(max(c.cut_number),0)+1 into v_cut_number from public.inventory_cuts c where c.inventory_id=p_inventory_id;
  select count(*)::integer into v_record_count
  from public.count_records cr join public.inventory_master_items mi on mi.inventory_id=cr.inventory_id and mi.codigo=cr.codigo
  where cr.inventory_id=p_inventory_id and not exists(select 1 from public.recount_mission_observations o where o.count_record_id=cr.id)
    and public.normalize_reference_key(mi.control_type,cr.codigo,case when mi.control_type='SERIAL' then cr.serie when mi.control_type='PARTIDA' then cr.partida else null end)=any(v_keys);
  insert into public.inventory_cuts(id,inventory_id,request_id,cut_number,status,record_count,created_by,cut_mode,algorithm_version,merkle_root)
  values(v_cut_id,p_inventory_id,p_request_id,v_cut_number,'ROLLING_SEALED',v_record_count,v_actor,'ROLLING_REFERENCE','CUT2_03',lower(p_preview_fingerprint));

  for v_item in select value from jsonb_array_elements(v_preview->'items') order by value->>'normalized_reference_key' loop
    select count(*)::integer,encode(extensions.digest(convert_to(coalesce(string_agg(concat_ws(E'\x1f',cr.id::text,cr.cantidad_contada,cr.ubicacion,cr.received_at::text),E'\x1e' order by cr.received_at,cr.id),''),'utf8'),'sha256'),'hex')
      into v_source_count,v_source_root
    from public.count_records cr join public.inventory_master_items mi on mi.inventory_id=cr.inventory_id and mi.codigo=cr.codigo
    where cr.inventory_id=p_inventory_id and not exists(select 1 from public.recount_mission_observations o where o.count_record_id=cr.id)
      and public.normalize_reference_key(mi.control_type,cr.codigo,case when mi.control_type='SERIAL' then cr.serie when mi.control_type='PARTIDA' then cr.partida else null end)=v_item->>'normalized_reference_key';
    insert into public.inventory_sealed_references(inventory_id,warehouse_id,cut_id,reference_type,codigo,reference_value,normalized_reference_key,state,request_id,physical_quantity,source_count,source_merkle_root,algorithm_version)
    values(p_inventory_id,v_inventory.warehouse_id,v_cut_id,(v_item->>'reference_type')::public.master_control_type,v_item->>'codigo',nullif(v_item->>'reference_value',''),v_item->>'normalized_reference_key','SEALING',p_request_id,(v_item->>'c1_quantity')::integer,v_source_count,v_source_root,'CUT2_03')
    returning * into v_reference;
    insert into public.rolling_cut_reference_snapshots(cut_id,inventory_id,sealed_reference_id,count_record_id,snapshot)
    select v_cut_id,p_inventory_id,v_reference.id,cr.id,to_jsonb(cr)
    from public.count_records cr join public.inventory_master_items mi on mi.inventory_id=cr.inventory_id and mi.codigo=cr.codigo
    where cr.inventory_id=p_inventory_id and not exists(select 1 from public.recount_mission_observations o where o.count_record_id=cr.id)
      and public.normalize_reference_key(mi.control_type,cr.codigo,case when mi.control_type='SERIAL' then cr.serie when mi.control_type='PARTIDA' then cr.partida else null end)=v_reference.normalized_reference_key;
    update public.inventory_sealed_references set state='SEALED',sealed_at=now(),sealed_by=v_actor where id=v_reference.id;
    insert into public.rolling_cut_events(inventory_id,warehouse_id,cut_id,sealed_reference_id,request_id,event_type,actor_user_id,payload)
    values(p_inventory_id,v_inventory.warehouse_id,v_cut_id,v_reference.id,p_request_id,'REFERENCE_SEALED',v_actor,jsonb_build_object('normalized_reference_key',v_reference.normalized_reference_key,'source_merkle_root',v_source_root));
    if v_item->>'estimated_result'='C2_REQUIRED_ESTIMATE' then
      insert into public.reconciliation_cases(inventory_id,codigo,reference_type,reference_value,anomaly_type,system_quantity,physical_quantity,status,first_count_record_id,created_by,source_cut_id)
      select p_inventory_id,v_reference.codigo,v_reference.reference_type,v_reference.reference_value,'ROLLING_CUT_DIFFERENCE',(v_item->>'system_quantity_disponible')::integer,v_reference.physical_quantity,'REQUIERE_2DO_CONTEO',(array_agg(s.count_record_id order by s.count_record_id))[1],v_actor,v_cut_id
      from public.rolling_cut_reference_snapshots s where s.sealed_reference_id=v_reference.id
      returning * into v_case;
      insert into public.recount_missions(case_id,inventory_id,round,created_by,source_cut_id) values(v_case.id,p_inventory_id,2,v_actor,v_cut_id) on conflict(case_id,round) do nothing;
      insert into public.rolling_cut_events(inventory_id,warehouse_id,cut_id,sealed_reference_id,reconciliation_case_id,request_id,event_type,actor_user_id,payload)
      values(p_inventory_id,v_inventory.warehouse_id,v_cut_id,v_reference.id,v_case.id,p_request_id,'C2_CREATED_FROM_CUT',v_actor,jsonb_build_object('case_id',v_case.id,'reference_key',v_reference.normalized_reference_key));
      v_c2_count:=v_c2_count+1;
    end if;
  end loop;
  insert into public.rolling_cut_requests(inventory_id,warehouse_id,request_id,preview_fingerprint,selection_fingerprint,cut_id,created_by)
  values(p_inventory_id,v_inventory.warehouse_id,p_request_id,lower(p_preview_fingerprint),v_selection_fingerprint,v_cut_id,v_actor);
  insert into public.rolling_cut_events(inventory_id,warehouse_id,cut_id,request_id,event_type,actor_user_id,payload)
  values(p_inventory_id,v_inventory.warehouse_id,v_cut_id,p_request_id,'ROLLING_CUT_CREATED',v_actor,jsonb_build_object('preview_fingerprint',lower(p_preview_fingerprint),'selection_fingerprint',v_selection_fingerprint,'reference_count',cardinality(v_keys),'c2_count',v_c2_count));
  return jsonb_build_object('cut_id',v_cut_id,'request_id',p_request_id,'cut_mode','ROLLING_REFERENCE','reference_count',cardinality(v_keys),'snapshot_count',v_record_count,'c2_count',v_c2_count,'idempotent_replay',false);
end
$function$;

-- A C2 born from a sealed reference is safe to run while unrelated C1 remains
-- open. Legacy C2/C3 retains the F16 global-C1 gate.
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
      and (v_round<>2 or m.source_cut_id is not null or not exists(select 1 from public.reconciliation_cases rc join public.count_records cr on cr.inventory_id=rc.inventory_id and cr.codigo=rc.codigo and ((rc.reference_type='SERIAL' and coalesce(cr.serie,'')=coalesce(rc.reference_value,'')) or (rc.reference_type='PARTIDA' and coalesce(cr.partida,'')=coalesce(rc.reference_value,'')) or rc.reference_type='LEGACY') where rc.id=m.case_id and cr.user_id=v_actor and not exists(select 1 from public.recount_mission_observations rmo where rmo.count_record_id=cr.id)));
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
    and (v_round<>2 or m.source_cut_id is not null or not exists(select 1 from public.reconciliation_cases rc join public.count_records cr on cr.inventory_id=rc.inventory_id and cr.codigo=rc.codigo and ((rc.reference_type='SERIAL' and coalesce(cr.serie,'')=coalesce(rc.reference_value,'')) or (rc.reference_type='PARTIDA' and coalesce(cr.partida,'')=coalesce(rc.reference_value,'')) or rc.reference_type='LEGACY') where rc.id=m.case_id and cr.user_id=v_actor and not exists(select 1 from public.recount_mission_observations rmo where rmo.count_record_id=cr.id)))
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

revoke all on function app_private.sync_counts_pre_cut2_03(uuid,uuid,public.device_platform,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.sync_counts(uuid,uuid,public.device_platform,text,text,jsonb),public.create_rolling_cut_v2(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.sync_counts(uuid,uuid,public.device_platform,text,text,jsonb),public.create_rolling_cut_v2(uuid,uuid,text,jsonb) to authenticated;
