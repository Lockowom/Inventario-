begin;
select plan(25);

-- Every fixture below is a real persisted source consumed by the single
-- readiness authority.  Direct inserts are fixture setup only; preview and
-- close exercise the authenticated public RPC boundary.
insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('cb410000-0000-0000-0000-000000000001','authenticated','authenticated','c10b4@example.test','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,user_type,active)
values ('cb410000-0000-0000-0000-000000000001','C10 blocker analyst','ANALISTA','PERMANENT',true);
insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by,c1_completed_at,c1_completed_by,c1_count_records,c1_counted_units,c1_master_fingerprint,c1_reference_fingerprint)
values ('cb420000-0000-0000-0000-000000000001','C10 blocker matrix','ABIERTO','00000000-0000-0000-0000-00000000c202','cb410000-0000-0000-0000-000000000001',now(),'cb410000-0000-0000-0000-000000000001',now(),'cb410000-0000-0000-0000-000000000001',now(),'cb410000-0000-0000-0000-000000000001',0,0,'c10b4-master','c10b4-reference');
insert into public.inventory_assignments(inventory_id,user_id,assigned_by)
values ('cb420000-0000-0000-0000-000000000001','cb410000-0000-0000-0000-000000000001','cb410000-0000-0000-0000-000000000001');

-- A terminal lifecycle is a distinct close-readiness failure, not an implicit
-- success merely because its C1 metadata is complete.
insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by,closed_at,closed_by,c1_completed_at,c1_completed_by,c1_count_records,c1_counted_units,c1_master_fingerprint,c1_reference_fingerprint)
values ('cb420000-0000-0000-0000-000000000002','C10 terminal lifecycle','CERRADO','00000000-0000-0000-0000-00000000c202','cb410000-0000-0000-0000-000000000001',now(),'cb410000-0000-0000-0000-000000000001',now(),'cb410000-0000-0000-0000-000000000001',now(),'cb410000-0000-0000-0000-000000000001',now(),'cb410000-0000-0000-0000-000000000001',0,0,'c10b4-closed-master','c10b4-closed-reference');
insert into public.inventory_assignments(inventory_id,user_id,assigned_by)
values ('cb420000-0000-0000-0000-000000000002','cb410000-0000-0000-0000-000000000001','cb410000-0000-0000-0000-000000000001');

select set_config('request.jwt.claim.sub','cb410000-0000-0000-0000-000000000001',true);
set local role authenticated;
select set_config('c10b4.ready',public.preview_inventory_close('cb420000-0000-0000-0000-000000000001')::text,true);
select ok((current_setting('c10b4.ready')::jsonb->>'is_ready')::boolean,'B4: C1-complete inventory is initially ready');
select set_config('c10b4.closed',public.preview_inventory_close('cb420000-0000-0000-0000-000000000002')::text,true);
select ok(current_setting('c10b4.closed')::jsonb->'blocker_codes' ? 'INVALID_LIFECYCLE','B4: terminal inventory reports the explicit lifecycle blocker');
select throws_ok($$select public.close_inventory_final('cb420000-0000-0000-0000-000000000002',current_setting('c10b4.closed')::jsonb->>'fingerprint','cb490000-0000-0000-0000-000000000002')$$,'23514','INVENTORY_ALREADY_CLOSED','B4: writer rejects a terminal lifecycle');
reset role;

insert into public.inventory_sealed_references(id,inventory_id,warehouse_id,reference_type,codigo,normalized_reference_key,state,request_id,physical_quantity,sealed_at,sealed_by)
values
 ('cb430000-0000-0000-0000-000000000001','cb420000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','LEGACY','C10B4-UNSEALED',public.normalize_reference_key('LEGACY','C10B4-UNSEALED',null),'SEALING','cb440000-0000-0000-0000-000000000001',null,null,null),
 ('cb430000-0000-0000-0000-000000000002','cb420000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','LEGACY','C10B4-RP',public.normalize_reference_key('LEGACY','C10B4-RP',null),'SEALED','cb440000-0000-0000-0000-000000000002',1,now(),'cb410000-0000-0000-0000-000000000001'),
 ('cb430000-0000-0000-0000-000000000003','cb420000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','LEGACY','C10B4-NULLQTY',public.normalize_reference_key('LEGACY','C10B4-NULLQTY',null),'SEALED','cb440000-0000-0000-0000-000000000003',null,now(),'cb410000-0000-0000-0000-000000000001'),
 ('cb430000-0000-0000-0000-000000000004','cb420000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','LEGACY','C10B4-RP-OMIT',public.normalize_reference_key('LEGACY','C10B4-RP-OMIT',null),'SEALED','cb440000-0000-0000-0000-000000000004',1,now(),'cb410000-0000-0000-0000-000000000001');

insert into public.reconciliation_cases(id,inventory_id,codigo,reference_type,anomaly_type,system_quantity,physical_quantity,status,created_by)
values
 ('cb450000-0000-0000-0000-000000000001','cb420000-0000-0000-0000-000000000001','C10B4-UNSEALED','LEGACY','PENDING',1,2,'PENDIENTE_ANALISIS','cb410000-0000-0000-0000-000000000001'),
 ('cb450000-0000-0000-0000-000000000002','cb420000-0000-0000-0000-000000000001','C10B4-C2','LEGACY','C2',1,2,'REQUIERE_2DO_CONTEO','cb410000-0000-0000-0000-000000000001'),
 ('cb450000-0000-0000-0000-000000000003','cb420000-0000-0000-0000-000000000001','C10B4-C3','LEGACY','C3',1,2,'REQUIERE_3ER_CONTEO','cb410000-0000-0000-0000-000000000001'),
 ('cb450000-0000-0000-0000-000000000004','cb420000-0000-0000-0000-000000000001','C10B4-C2ACTIVE','LEGACY','C2_ACTIVE',1,2,'REQUIERE_2DO_CONTEO','cb410000-0000-0000-0000-000000000001'),
 ('cb450000-0000-0000-0000-000000000005','cb420000-0000-0000-0000-000000000001','C10B4-C3QUEUE','LEGACY','C3_QUEUED',1,2,'REQUIERE_3ER_CONTEO','cb410000-0000-0000-0000-000000000001');
insert into public.recount_missions(id,case_id,inventory_id,round,status,created_by)
values ('cb460000-0000-0000-0000-000000000001','cb450000-0000-0000-0000-000000000002','cb420000-0000-0000-0000-000000000001',2,'QUEUED','cb410000-0000-0000-0000-000000000001');
insert into public.recount_missions(id,case_id,inventory_id,round,status,assigned_user_id,claimed_at,created_by)
values ('cb460000-0000-0000-0000-000000000004','cb450000-0000-0000-0000-000000000004','cb420000-0000-0000-0000-000000000001',2,'ACTIVE','cb410000-0000-0000-0000-000000000001',now(),'cb410000-0000-0000-0000-000000000001');
insert into public.recount_missions(id,case_id,inventory_id,round,status,assigned_user_id,claimed_at,completed_at,total_quantity,created_by)
values ('cb460000-0000-0000-0000-000000000002','cb450000-0000-0000-0000-000000000003','cb420000-0000-0000-0000-000000000001',2,'COMPLETED','cb410000-0000-0000-0000-000000000001',now(),now(),2,'cb410000-0000-0000-0000-000000000001');
insert into public.recount_missions(id,case_id,inventory_id,round,status,assigned_user_id,claimed_at,created_by)
values ('cb460000-0000-0000-0000-000000000003','cb450000-0000-0000-0000-000000000003','cb420000-0000-0000-0000-000000000001',3,'ACTIVE','cb410000-0000-0000-0000-000000000001',now(),'cb410000-0000-0000-0000-000000000001');
insert into public.recount_missions(id,case_id,inventory_id,round,status,assigned_user_id,claimed_at,completed_at,total_quantity,created_by)
values ('cb460000-0000-0000-0000-000000000005','cb450000-0000-0000-0000-000000000005','cb420000-0000-0000-0000-000000000001',2,'COMPLETED','cb410000-0000-0000-0000-000000000001',now(),now(),2,'cb410000-0000-0000-0000-000000000001');
insert into public.recount_missions(id,case_id,inventory_id,round,status,created_by)
values ('cb460000-0000-0000-0000-000000000006','cb450000-0000-0000-0000-000000000005','cb420000-0000-0000-0000-000000000001',3,'QUEUED','cb410000-0000-0000-0000-000000000001');

insert into public.reference_findings(inventory_id,warehouse_id,reference_id,reference_type,normalized_reference_key,finding_type,state,critical,description,created_by,severity,source_stage,blocks_close,blocks_rp)
values
 ('cb420000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','cb430000-0000-0000-0000-000000000002','LEGACY',public.normalize_reference_key('LEGACY','C10B4-RP',null),'PHYSICAL_DAMAGE','OPEN',true,'C10 blocking finding','cb410000-0000-0000-0000-000000000001','CRITICAL','C1',true,true),
 ('cb420000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','cb430000-0000-0000-0000-000000000002','LEGACY',public.normalize_reference_key('LEGACY','C10B4-RP',null),'AUTHORIZATION_REVOKED_OFFLINE','OPEN',true,'C10 offline review','cb410000-0000-0000-0000-000000000001','HIGH','OFFLINE_LATE_COUNT',false,false),
 ('cb420000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','cb430000-0000-0000-0000-000000000002','LEGACY',public.normalize_reference_key('LEGACY','C10B4-RP',null),'DUPLICATE_SERIAL','OPEN',true,'C10 identity conflict','cb410000-0000-0000-0000-000000000001','CRITICAL','C1',false,false);
insert into public.orphan_references(inventory_id,warehouse_id,codigo,reference_type,normalized_reference_key,created_by)
values ('cb420000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','C10B4-ORPHAN','LEGACY',public.normalize_reference_key('LEGACY','C10B4-ORPHAN',null),'cb410000-0000-0000-0000-000000000001');
insert into public.uom_resolution_cases(inventory_id,warehouse_id,reference_id,source_uom,target_uom,created_by)
values ('cb420000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','cb430000-0000-0000-0000-000000000002','BOX','UN','cb410000-0000-0000-0000-000000000001');
insert into public.sync_devices(id,user_id,platform,app_version,device_label)
values ('cb470000-0000-0000-0000-000000000001','cb410000-0000-0000-0000-000000000001','WEB','1.0.0','C10 blocker device');
insert into public.inventory_freeze_guards(inventory_id,device_id,pending_count)
values ('cb420000-0000-0000-0000-000000000001','cb470000-0000-0000-0000-000000000001',1);
insert into public.rp_release_batches(id,inventory_id,warehouse_id,state,created_by)
values
 ('cb480000-0000-0000-0000-000000000001','cb420000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','DRAFT','cb410000-0000-0000-0000-000000000001'),
 ('cb480000-0000-0000-0000-000000000002','cb420000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','INTEGRITY_FAILURE','cb410000-0000-0000-0000-000000000001');
insert into public.rp_release_rectifications(original_release_id,reason,created_by)
values ('cb480000-0000-0000-0000-000000000001','C10 blocker rectification','cb410000-0000-0000-0000-000000000001');
insert into public.rp_release_discards(release_id,reference_id,reason,discarded_by)
values ('cb480000-0000-0000-0000-000000000001','cb430000-0000-0000-0000-000000000002',repeat('C10 pending discard evidence. ',4),'cb410000-0000-0000-0000-000000000001');

select set_config('request.jwt.claim.sub','cb410000-0000-0000-0000-000000000001',true);
set local role authenticated;
select set_config('c10b4.blocked',public.preview_inventory_close('cb420000-0000-0000-0000-000000000001')::text,true);
select ok(not (current_setting('c10b4.blocked')::jsonb->>'is_ready')::boolean,'B4: accumulated material blockers make preview not ready');
select ok(current_setting('c10b4.blocked')::jsonb->'blocker_codes' ? 'UNSEALED_REFERENCE','B4: unsealed reference blocks close');
select ok(current_setting('c10b4.blocked')::jsonb->'blocker_codes' ? 'OPEN_RECONCILIATION_CASE','B4: pending reconciliation blocks close');
select ok(current_setting('c10b4.blocked')::jsonb->'blocker_codes' ? 'OPEN_C2','B4: queued C2 blocks close');
select ok(current_setting('c10b4.blocked')::jsonb->'blocker_codes' ? 'OPEN_C3','B4: active C3 blocks close');
select is((current_setting('c10b4.blocked')::jsonb->'blocker_counts'->>'open_c2_count')::integer,2,'B4: queued and active C2 states are both counted');
select is((current_setting('c10b4.blocked')::jsonb->'blocker_counts'->>'open_c3_count')::integer,2,'B4: queued and active C3 states are both counted');
select ok(current_setting('c10b4.blocked')::jsonb->'blocker_codes' ? 'FINDING_BLOCKS_CLOSE','B4: canonical blocking finding blocks close');
select ok(current_setting('c10b4.blocked')::jsonb->'blocker_codes' ? 'UNRESOLVED_OFFLINE_REVIEW','B4: revoked/offline review blocks close');
select ok(current_setting('c10b4.blocked')::jsonb->'blocker_codes' ? 'ORPHAN_REFERENCE_OPEN','B4: orphan reference blocks close');
select ok(current_setting('c10b4.blocked')::jsonb->'blocker_codes' ? 'IDENTITY_CONFLICT','B4: serial/identity conflict blocks close');
select ok(current_setting('c10b4.blocked')::jsonb->'blocker_codes' ? 'UOM_CONFLICT','B4: UOM case blocks close');
select ok(current_setting('c10b4.blocked')::jsonb->'blocker_codes' ? 'NEGATIVE_QUANTITY','B4: sealed null quantity blocks close');
select ok(current_setting('c10b4.blocked')::jsonb->'blocker_codes' ? 'PENDING_SYNC_GUARD','B4: pending sync guard blocks close');
select ok(current_setting('c10b4.blocked')::jsonb->'blocker_codes' ? 'RP_REFERENCE_OMITTED','B4: uncovered RP reference blocks close');
select ok(current_setting('c10b4.blocked')::jsonb->'blocker_codes' ? 'RP_RELEASE_DRAFT','B4: RP draft blocks close');
select ok(current_setting('c10b4.blocked')::jsonb->'blocker_codes' ? 'RP_RELEASE_INTEGRITY_FAILURE','B4: RP integrity failure blocks close');
select ok(current_setting('c10b4.blocked')::jsonb->'blocker_codes' ? 'RECTIFICATION_CHAIN_OPEN','B4: open rectification chain blocks close');
select ok(current_setting('c10b4.blocked')::jsonb->'blocker_codes' ? 'DISCARD_PENDING','B4: pending discard blocks close');
select throws_ok($$select public.close_inventory_final('cb420000-0000-0000-0000-000000000001',current_setting('c10b4.blocked')::jsonb->>'fingerprint','cb490000-0000-0000-0000-000000000001')$$,'23514','INVENTORY_NOT_READY','B4: blocker preview cannot write close lifecycle');
select is((select status::text from public.inventories where id='cb420000-0000-0000-0000-000000000001'),'ABIERTO','B4: rejected close leaves lifecycle open');
select is((select count(*) from public.audit_events where inventory_id='cb420000-0000-0000-0000-000000000001' and event_type='INVENTORY_CLOSED'),0::bigint,'B4: rejected close creates no audit');
reset role;

select * from finish();
rollback;
