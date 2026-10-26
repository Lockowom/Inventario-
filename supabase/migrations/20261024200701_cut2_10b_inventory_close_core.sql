-- CUT2-10B: one compositional, read-only close-readiness authority and one
-- scoped writer.  It deliberately reuses lifecycle, reconciliation, findings
-- and RP sources; it neither creates ERP records nor changes physical stock.

alter table public.inventory_close_requests
  add column if not exists request_fingerprint text,
  add column if not exists result jsonb;

create or replace function app_private.inventory_close_readiness(p_inventory_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_inventory public.inventories;
  v_open_cases integer := 0;
  v_c2 integer := 0;
  v_c3 integer := 0;
  v_findings integer := 0;
  v_reviews integer := 0;
  v_unsealed integer := 0;
  v_orphans integer := 0;
  v_identity integer := 0;
  v_uom integer := 0;
  v_negative integer := 0;
  v_rp_pending integer := 0;
  v_rp_drafts integer := 0;
  v_rp_ready integer := 0;
  v_rectification integer := 0;
  v_discard integer := 0;
  v_outbox integer := 0;
  v_integrity integer := 0;
  v_blockers jsonb := '[]'::jsonb;
  v_material jsonb;
  v_fingerprint text;
begin
  select * into v_inventory from public.inventories where id=p_inventory_id;
  if v_inventory.id is null then raise exception 'INVENTORY_NOT_FOUND' using errcode='P0002'; end if;

  select count(*)::integer into v_open_cases from public.reconciliation_cases
   where inventory_id=p_inventory_id and status<>'RESUELTO';
  select count(*) filter(where round=2)::integer, count(*) filter(where round=3)::integer
    into v_c2,v_c3 from public.recount_missions
   where inventory_id=p_inventory_id and status in ('QUEUED','ACTIVE');
  select count(*)::integer into v_findings from public.reference_findings
   where inventory_id=p_inventory_id and state in ('OPEN','HELD') and (blocks_close or blocks_rp);
  select count(*)::integer into v_reviews from public.reference_findings
   where inventory_id=p_inventory_id and state in ('OPEN','HELD')
     and (finding_type::text='AUTHORIZATION_REVOKED_OFFLINE' or source_stage::text='OFFLINE_LATE_COUNT');
  select count(*)::integer into v_unsealed from public.inventory_sealed_references
   where inventory_id=p_inventory_id and state<>'SEALED';
  select count(*)::integer into v_orphans from public.orphan_references
   where inventory_id=p_inventory_id and state<>'RESOLVED';
  select count(*)::integer into v_identity from public.reference_findings
   where inventory_id=p_inventory_id and state in ('OPEN','HELD')
     and finding_type::text in ('DUPLICATE_SERIAL','INTEGRITY_FAILURE','SERIAL_FOUND_AFTER_SEAL','BATCH_FOUND_AFTER_SEAL');
  select count(*)::integer into v_uom from public.uom_resolution_cases
   where inventory_id=p_inventory_id and state in ('OPEN','HELD');
  select count(*)::integer into v_negative from public.inventory_sealed_references
   where inventory_id=p_inventory_id and (physical_quantity is null or physical_quantity<0);
  select count(*)::integer into v_outbox from public.inventory_freeze_guards
   where inventory_id=p_inventory_id and resolved_at is null and pending_count>0;
  select count(*) filter(where state='DRAFT')::integer, count(*) filter(where state='READY')::integer,
         count(*) filter(where state='INTEGRITY_FAILURE' or (state='READY' and (manifest is null or manifest_digest is null)))::integer
    into v_rp_drafts,v_rp_ready,v_integrity
    from public.rp_release_batches where inventory_id=p_inventory_id;
  select count(*)::integer into v_rectification from public.rp_release_rectifications rr
   join public.rp_release_batches rb on rb.id=rr.original_release_id
   where rb.inventory_id=p_inventory_id and rr.superseding_release_id is null;
  select count(*)::integer into v_discard from public.rp_release_discards d
   join public.rp_release_batches rb on rb.id=d.release_id
   where rb.inventory_id=p_inventory_id and rb.state<>'READY';

  select count(*)::integer into v_rp_pending
  from app_private.rp_release_eligibility(p_inventory_id,v_inventory.warehouse_id,null) e
  where e.eligible and not exists (
    select 1 from public.rp_release_batches b
    join public.rp_release_audits a on a.release_id=b.id
    where b.inventory_id=p_inventory_id and b.warehouse_id=v_inventory.warehouse_id and b.state='READY'
      and a.references_snapshot @> jsonb_build_array(jsonb_build_object('reference_id',e.reference_id::text))
  );

  v_blockers := (
    select coalesce(jsonb_agg(jsonb_build_object('code',code,'count',count,'blocks_close',true) order by code),'[]'::jsonb)
    from (values
      ('INVALID_LIFECYCLE',case when v_inventory.status='ABIERTO' then 0 else 1 end),
      ('C1_NOT_FINALIZED',case when v_inventory.c1_completed_at is null then 1 else 0 end),
      ('PENDING_SYNC_GUARD',v_outbox),('OPEN_RECONCILIATION_CASE',v_open_cases),
      ('OPEN_C2',v_c2),('OPEN_C3',v_c3),('FINDING_BLOCKS_CLOSE',v_findings),
      ('UNRESOLVED_OFFLINE_REVIEW',v_reviews),('UNSEALED_REFERENCE',v_unsealed),
      ('ORPHAN_REFERENCE_OPEN',v_orphans),('IDENTITY_CONFLICT',v_identity),
      ('UOM_CONFLICT',v_uom),('NEGATIVE_QUANTITY',v_negative),
      ('RP_REFERENCE_OMITTED',v_rp_pending),('RP_RELEASE_DRAFT',v_rp_drafts),
      ('RP_RELEASE_INTEGRITY_FAILURE',v_integrity),('RECTIFICATION_CHAIN_OPEN',v_rectification),
      ('DISCARD_PENDING',v_discard)
    ) as b(code,count) where count>0
  );

  select jsonb_build_object(
    'inventory',jsonb_build_object('id',v_inventory.id,'status',v_inventory.status,'c1_completed_at',v_inventory.c1_completed_at,'warehouse_id',v_inventory.warehouse_id),
    'blockers',v_blockers,
    'sealed_refs',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'state',r.state,'quantity',r.physical_quantity,'identity',r.normalized_reference_key) order by r.id) from public.inventory_sealed_references r where r.inventory_id=p_inventory_id),'[]'::jsonb),
    'missions',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'round',m.round,'status',m.status) order by m.id) from public.recount_missions m where m.inventory_id=p_inventory_id and m.status in ('QUEUED','ACTIVE')),'[]'::jsonb),
    'findings',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'state',f.state,'severity',f.severity,'close',f.blocks_close,'rp',f.blocks_rp) order by f.id) from public.reference_findings f where f.inventory_id=p_inventory_id and f.state in ('OPEN','HELD')),'[]'::jsonb),
    'releases',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'state',b.state,'manifest_digest',b.manifest_digest,'reference_count',a.reference_count) order by b.id) from public.rp_release_batches b left join public.rp_release_audits a on a.release_id=b.id where b.inventory_id=p_inventory_id),'[]'::jsonb)
  ) into v_material;
  v_fingerprint:=encode(extensions.digest(convert_to(v_material::text,'utf8'),'sha256'),'hex');

  return jsonb_build_object(
    'inventory_id',v_inventory.id,'warehouse_id',v_inventory.warehouse_id,'current_status',v_inventory.status,'target_status','CERRADO',
    'is_ready',jsonb_array_length(v_blockers)=0,'blocker_codes',coalesce((select jsonb_agg(x->>'code' order by x->>'code') from jsonb_array_elements(v_blockers) x),'[]'::jsonb),
    'blockers',v_blockers,'blocker_counts',jsonb_build_object('open_reconciliation_cases',v_open_cases,'open_c2_count',v_c2,'open_c3_count',v_c3,'blocking_findings_count',v_findings,'unresolved_reviews_count',v_reviews,'unsealed_refs_count',v_unsealed,'orphan_refs_count',v_orphans,'identity_conflict_count',v_identity,'uom_conflict_count',v_uom,'negative_qty_count',v_negative,'rp_pending_refs_count',v_rp_pending,'rp_draft_count',v_rp_drafts,'rp_ready_count',v_rp_ready,'rectification_pending_count',v_rectification,'discard_pending_count',v_discard,'critical_outbox_count',v_outbox,'release_integrity_count',v_integrity),
    'fingerprint',v_fingerprint,'material_summary',v_material
  );
end
$fn$;

create or replace function public.preview_inventory_close(p_inventory_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_inventory public.inventories;
begin
  select * into v_inventory from public.inventories where id=p_inventory_id;
  if v_inventory.id is null then raise exception 'INVENTORY_NOT_FOUND' using errcode='P0002'; end if;
  perform app_private.require_inventory_capability(p_inventory_id,'CLOSE_INVENTORY'::public.cut2_capability,v_inventory.warehouse_id);
  return app_private.inventory_close_readiness(p_inventory_id);
end $fn$;

create or replace function public.close_inventory_final(p_inventory_id uuid,p_expected_fingerprint text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v_inventory public.inventories; v_actor uuid; v_existing public.inventory_close_requests; v_readiness jsonb; v_result jsonb;
begin
  if p_request_id is null or p_expected_fingerprint is null or p_expected_fingerprint !~ '^[A-Fa-f0-9]{64}$' then raise exception 'INVALID_CLOSE_REQUEST' using errcode='22023'; end if;
  select * into v_inventory from public.inventories where id=p_inventory_id;
  if v_inventory.id is null then raise exception 'INVENTORY_NOT_FOUND' using errcode='P0002'; end if;
  v_actor:=app_private.require_inventory_capability(p_inventory_id,'CLOSE_INVENTORY'::public.cut2_capability,v_inventory.warehouse_id);
  select * into v_inventory from public.inventories where id=p_inventory_id for update;
  select * into v_existing from public.inventory_close_requests where inventory_id=p_inventory_id and request_id=p_request_id for update;
  if v_existing.id is not null then
    if v_existing.request_fingerprint is distinct from lower(p_expected_fingerprint) then raise exception 'REQUEST_REPLAY_CONFLICT' using errcode='23505'; end if;
    if v_existing.state='COMPLETED' then return coalesce(v_existing.result,jsonb_build_object('inventory_id',p_inventory_id)) || jsonb_build_object('idempotent',true); end if;
  end if;
  if v_inventory.status='CERRADO' then raise exception 'INVENTORY_ALREADY_CLOSED' using errcode='23514'; end if;
  v_readiness:=app_private.inventory_close_readiness(p_inventory_id);
  if lower(v_readiness->>'fingerprint')<>lower(p_expected_fingerprint) then raise exception 'PREVIEW_STALE' using errcode='40001'; end if;
  if not coalesce((v_readiness->>'is_ready')::boolean,false) then raise exception 'INVENTORY_NOT_READY' using errcode='23514',detail=coalesce(v_readiness->'blocker_codes','[]'::jsonb)::text; end if;
  if v_existing.id is null then
    insert into public.inventory_close_requests(inventory_id,request_id,started_by,request_fingerprint,state)
    values(p_inventory_id,p_request_id,v_actor,lower(p_expected_fingerprint),'REQUESTED') returning * into v_existing;
  end if;
  update public.inventories set status='CERRADO',closed_at=now(),closed_by=v_actor,close_request_id=v_existing.id,updated_at=now() where id=p_inventory_id;
  v_result:=jsonb_build_object('inventory_id',p_inventory_id,'close_request_id',v_existing.id,'status','CERRADO','fingerprint',lower(p_expected_fingerprint),'idempotent',false);
  update public.inventory_close_requests set state='COMPLETED',completed_at=now(),result=v_result where id=v_existing.id;
  insert into public.audit_events(inventory_id,actor_user_id,event_type,entity_type,entity_id,payload)
  values(p_inventory_id,v_actor,'INVENTORY_CLOSED','inventory',p_inventory_id,jsonb_build_object('request_id',p_request_id,'fingerprint',lower(p_expected_fingerprint),'readiness',v_readiness->'blocker_counts','version','CUT2_10B'));
  return v_result;
end $fn$;

create or replace function app_private.guard_closed_recount_creation()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if exists(select 1 from public.inventories i where i.id=new.inventory_id and i.status='CERRADO') then raise exception 'INVENTORY_CLOSED' using errcode='23514'; end if;
  return new;
end $fn$;
drop trigger if exists recount_missions_reject_closed_inventory on public.recount_missions;
create trigger recount_missions_reject_closed_inventory before insert on public.recount_missions for each row execute function app_private.guard_closed_recount_creation();

create or replace function app_private.guard_closed_rp_release()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if exists(select 1 from public.inventories i where i.id=new.inventory_id and i.status='CERRADO') then raise exception 'INVENTORY_CLOSED' using errcode='23514'; end if;
  return new;
end $fn$;
drop trigger if exists rp_release_batches_reject_closed_inventory on public.rp_release_batches;
create trigger rp_release_batches_reject_closed_inventory before insert on public.rp_release_batches for each row execute function app_private.guard_closed_rp_release();

-- A pre-seal finding is a classification of an open C1 reference.  It must
-- not become a back door that mutates the operational finding state after the
-- final lifecycle transition.  Late/offline evidence continues through its
-- dedicated CUT2-04/CUT2-08 intake, not this pre-seal writer.
create or replace function public.create_preseal_reference_finding(
  p_inventory_id uuid,
  p_reference_type public.master_control_type,
  p_normalized_reference_key text,
  p_finding_type public.cut2_finding_type,
  p_description text,
  p_critical boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $fn$
declare
  v_actor uuid := app_private.require_active_actor();
  v_inventory public.inventories;
  v_reference_id uuid;
  v_finding_id uuid;
begin
  if not app_private.can_manage_inventory(p_inventory_id) then
    raise exception 'Not authorized to classify a pre-seal finding' using errcode = '42501';
  end if;
  if p_normalized_reference_key is null or length(btrim(p_normalized_reference_key)) not between 1 and 512 then
    raise exception 'Canonical reference identity is required' using errcode = '23514';
  end if;
  v_inventory := app_private.lock_inventory(p_inventory_id);
  if v_inventory.status <> 'ABIERTO' then
    raise exception 'INVENTORY_CLOSED' using errcode = '23514';
  end if;
  if not exists (
    select 1
    from public.inventory_master_items m
    where m.inventory_id = p_inventory_id
      and m.control_type = p_reference_type
      and exists (
        select 1 from public.count_records c
        where c.inventory_id = p_inventory_id and c.codigo = m.codigo
          and public.normalize_reference_key(m.control_type, c.codigo, case when m.control_type='SERIAL' then c.serie when m.control_type='PARTIDA' then c.partida else null end) = p_normalized_reference_key
      )
    union all
    select 1
    from public.inventory_system_reference_items s
    where s.inventory_id = p_inventory_id and s.reference_type = p_reference_type
      and public.normalize_reference_key(s.reference_type, s.codigo, s.reference_value) = p_normalized_reference_key
  ) then
    raise exception 'Canonical reference identity is unknown for inventory' using errcode = '23514';
  end if;
  select id into v_reference_id
  from public.inventory_sealed_references
  where inventory_id = p_inventory_id and warehouse_id = v_inventory.warehouse_id
    and reference_type = p_reference_type and normalized_reference_key = p_normalized_reference_key;
  insert into public.reference_findings(
    inventory_id, warehouse_id, reference_id, reference_type, normalized_reference_key,
    finding_type, critical, description, created_by
  ) values (
    p_inventory_id, v_inventory.warehouse_id, v_reference_id, p_reference_type, p_normalized_reference_key,
    p_finding_type, p_critical, p_description, v_actor
  ) returning id into v_finding_id;
  insert into public.preseal_guard_events(inventory_id, warehouse_id, reference_type, normalized_reference_key, finding_id, event_type, actor_user_id, payload)
  values (p_inventory_id, v_inventory.warehouse_id, p_reference_type, p_normalized_reference_key, v_finding_id, 'PRESEAL_FINDING_CREATED', v_actor,
    jsonb_build_object('finding_type', p_finding_type, 'critical', p_critical, 'sealed_reference_id', v_reference_id));
  return v_finding_id;
end
$fn$;

revoke all on function app_private.inventory_close_readiness(uuid),app_private.guard_closed_recount_creation(),app_private.guard_closed_rp_release() from public,anon,authenticated;
revoke all on function public.preview_inventory_close(uuid),public.close_inventory_final(uuid,text,uuid) from public,anon;
grant execute on function public.preview_inventory_close(uuid),public.close_inventory_final(uuid,text,uuid) to authenticated;
