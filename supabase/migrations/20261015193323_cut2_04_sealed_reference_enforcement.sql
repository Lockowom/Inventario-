-- CUT2-04: a reference seal is immutable for ordinary C1 capture.  A count
-- captured offline before the seal is never inserted into count_records after
-- it reconnects; its complete physical payload is preserved once as a
-- reviewable finding, keyed by client_count_id for idempotency.

alter table public.reference_findings
  add column if not exists source_client_count_id uuid,
  add column if not exists late_count_payload jsonb,
  add column if not exists late_count_captured_at timestamptz;

alter table public.reference_findings
  add constraint reference_findings_source_client_count_id_key unique (source_client_count_id),
  add constraint reference_findings_late_count_payload_check check (
    source_client_count_id is null
    or (late_count_payload is not null and jsonb_typeof(late_count_payload) = 'object')
  ),
  add constraint reference_findings_late_count_captured_at_check check (
    source_client_count_id is null or late_count_captured_at is not null
  );

create index if not exists reference_findings_postseal_review_idx
  on public.reference_findings (inventory_id, warehouse_id, reference_id, state, created_at desc)
  where source_client_count_id is not null and state in ('OPEN', 'HELD');

create or replace function app_private.record_postseal_count_finding(
  p_inventory_id uuid,
  p_warehouse_id uuid,
  p_reference_id uuid,
  p_reference_type public.master_control_type,
  p_normalized_reference_key text,
  p_client_count_id uuid,
  p_captured_at timestamptz,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $function$
declare
  v_actor uuid := app_private.require_active_actor();
  v_finding_id uuid;
  v_finding_type public.cut2_finding_type;
begin
  if p_reference_id is null or p_client_count_id is null or p_captured_at is null
    or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid post-seal evidence' using errcode = '23514';
  end if;

  v_finding_type := case p_reference_type
    when 'SERIAL' then 'SERIAL_FOUND_AFTER_SEAL'::public.cut2_finding_type
    when 'PARTIDA' then 'BATCH_FOUND_AFTER_SEAL'::public.cut2_finding_type
    else 'ADDITIONAL_QUANTITY_FOUND'::public.cut2_finding_type
  end;

  -- The immutable client id is the retry key.  The conflict WHERE prevents a
  -- reused UUID from silently attaching evidence to another reference.
  insert into public.reference_findings (
    inventory_id, warehouse_id, reference_id, reference_type, normalized_reference_key,
    finding_type, critical, description, created_by, source_client_count_id,
    late_count_payload, late_count_captured_at
  ) values (
    p_inventory_id, p_warehouse_id, p_reference_id, p_reference_type, p_normalized_reference_key,
    v_finding_type, true, 'Conteo offline recibido después del sello; requiere revisión.', v_actor,
    p_client_count_id, p_payload, p_captured_at
  )
  on conflict (source_client_count_id) do update
    set updated_at = public.reference_findings.updated_at
    where public.reference_findings.inventory_id = excluded.inventory_id
      and public.reference_findings.warehouse_id = excluded.warehouse_id
      and public.reference_findings.reference_id = excluded.reference_id
      and public.reference_findings.reference_type = excluded.reference_type
      and public.reference_findings.normalized_reference_key = excluded.normalized_reference_key
      and public.reference_findings.late_count_payload = excluded.late_count_payload
      and public.reference_findings.late_count_captured_at = excluded.late_count_captured_at
  returning id into v_finding_id;

  if v_finding_id is null then
    raise exception 'CLIENT_COUNT_ID_PAYLOAD_CONFLICT' using errcode = '23505';
  end if;
  return v_finding_id;
end
$function$;

-- Replaces only the public C1 entrypoint.  The private F16 implementation
-- remains the only code that writes accepted count_records and attaches C2
-- observations.  An assigned active C2 mission is explicitly forwarded.
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
  v_sealed public.inventory_sealed_references;
  v_recount_id uuid;
  v_existing public.count_records;
  v_physical_uom text;
  v_captured_at timestamptz;
  v_result record;
  v_result_uom text;
begin
  -- C1_COMPLETED and recount_mission_observations remain enforced by
  -- app_private.sync_counts_pre_cut2_03.  This wrapper performs the sealed
  -- preflight only, and forwards an assigned active recount unchanged.
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
      v_physical_uom:=nullif(upper(btrim(v_record->>'physical_uom')),'');
      v_captured_at:=(v_record->>'captured_at')::timestamptz;
      if v_physical_uom is not null and (length(v_physical_uom)>32 or v_physical_uom !~ '^[A-Z0-9._/-]+$') then
        client_count_id:=v_client_count_id; result_status:='REJECTED'; server_count_id:=null; received_at:=null; reason:='INVALID_PHYSICAL_UOM'; return next; continue;
      end if;
      select mi.* into v_master from public.inventory_master_items mi where mi.inventory_id=p_inventory_id and mi.codigo=v_codigo;
      if v_master.codigo is null then raise exception 'defer'; end if;
      v_key:=public.normalize_reference_key(v_master.control_type,v_codigo,case when v_master.control_type='SERIAL' then v_serie when v_master.control_type='PARTIDA' then v_partida else null end);
    exception when others then
      v_forwarded:=v_forwarded || jsonb_build_array(v_record);
      continue;
    end;
    select c.* into v_existing from public.count_records c where c.client_count_id=v_client_count_id;
    if v_existing.id is not null then
      if coalesce(v_existing.physical_uom,'') <> coalesce(v_physical_uom,'') then
        client_count_id:=v_client_count_id; result_status:='CONFLICT'; server_count_id:=v_existing.id; received_at:=v_existing.received_at; reason:='CLIENT_COUNT_ID_PAYLOAD_CONFLICT'; return next;
      end if;
      v_forwarded:=v_forwarded || jsonb_build_array(v_record);
      continue;
    end if;
    v_recount_id:=app_private.active_recount_mission_for_count(p_inventory_id,v_actor,v_codigo,v_serie,v_partida);
    select sr.* into v_sealed from public.inventory_sealed_references sr
      where sr.inventory_id=p_inventory_id and sr.warehouse_id=v_inventory.warehouse_id
        and sr.normalized_reference_key=v_key and sr.state in ('SEALING','SEALED');
    if v_sealed.id is not null and v_recount_id is null then
      perform app_private.record_postseal_count_finding(
        p_inventory_id, v_inventory.warehouse_id, v_sealed.id, v_sealed.reference_type,
        v_key, v_client_count_id, v_captured_at,
        jsonb_build_object('record', v_record, 'device_id', p_device_id, 'platform', p_platform, 'app_version', p_app_version)
      );
      client_count_id:=v_client_count_id; result_status:='REJECTED'; server_count_id:=null; received_at:=null; reason:='REFERENCE_SEALED'; return next; continue;
    end if;
    v_forwarded:=v_forwarded || jsonb_build_array(v_record);
  end loop;
  if jsonb_array_length(v_forwarded) = 0 then return; end if;
  for v_result in select * from app_private.sync_counts_pre_cut2_03(p_inventory_id,p_device_id,p_platform,p_app_version,p_device_label,v_forwarded) loop
    if v_result.result_status='ACCEPTED' and v_result.server_count_id is not null then
      select nullif(upper(btrim(value->>'physical_uom')),'') into v_result_uom
      from jsonb_array_elements(v_forwarded) value
      where (value->>'client_count_id')::uuid=v_result.client_count_id;
      update public.count_records
      set physical_uom=v_result_uom,
          uom_source=case when v_result_uom is null then 'LEGACY_UNKNOWN' else 'EXPLICIT' end
      where id=v_result.server_count_id;
      insert into public.preseal_guard_events(inventory_id,warehouse_id,reference_type,normalized_reference_key,count_record_id,event_type,actor_user_id,payload)
      select p_inventory_id,v_inventory.warehouse_id,m.control_type,
        public.normalize_reference_key(m.control_type,c.codigo,case when m.control_type='SERIAL' then c.serie when m.control_type='PARTIDA' then c.partida else null end),
        c.id,'UOM_EVIDENCE_RECORDED',v_actor,jsonb_build_object('physical_uom',v_result_uom,'uom_source',case when v_result_uom is null then 'LEGACY_UNKNOWN' else 'EXPLICIT' end)
      from public.count_records c join public.inventory_master_items m on m.inventory_id=c.inventory_id and m.codigo=c.codigo
      where c.id=v_result.server_count_id;
    end if;
    client_count_id:=v_result.client_count_id; result_status:=v_result.result_status; server_count_id:=v_result.server_count_id; received_at:=v_result.received_at; reason:=v_result.reason; return next;
  end loop;
end
$function$;

-- Correcting an uncaught legacy row after the same identity has sealed would
-- mutate the post-cut physical history.  Keep the existing validation and
-- permission implementation, inserting only this race-safe server guard.
do $migration$
declare
  v_definition text;
  v_marker constant text := 'CUT2_04_SEALED_CORRECTION_GUARD';
  v_anchor constant text := '  v_old_values := jsonb_build_object(';
  v_guard constant text := E'  -- CUT2_04_SEALED_CORRECTION_GUARD\n  if exists (\n    select 1 from public.inventory_sealed_references sr\n    where sr.inventory_id = v_count.inventory_id\n      and sr.warehouse_id = v_inventory.warehouse_id\n      and sr.reference_type = v_master.control_type\n      and sr.normalized_reference_key = public.normalize_reference_key(v_master.control_type, v_codigo, case when v_master.control_type = ''SERIAL'' then v_serie when v_master.control_type = ''PARTIDA'' then v_partida else null end)\n      and sr.state in (''SEALING'', ''SEALED'')\n  ) then\n    raise exception ''REFERENCE_SEALED'' using errcode = ''23514'';\n  end if;\n\n  v_old_values := jsonb_build_object(';
begin
  select pg_get_functiondef('public.correct_uncut_count(uuid,jsonb,text)'::regprocedure) into v_definition;
  if position(v_marker in v_definition) = 0 then
    if position(v_anchor in v_definition) = 0 then
      raise exception 'CUT2-04 correction anchor changed; refusing blind rewrite' using errcode = 'P0001';
    end if;
    execute replace(v_definition, v_anchor, v_guard);
  end if;
end
$migration$;

revoke all on function app_private.record_postseal_count_finding(uuid,uuid,uuid,public.master_control_type,text,uuid,timestamptz,jsonb) from public, anon, authenticated;
