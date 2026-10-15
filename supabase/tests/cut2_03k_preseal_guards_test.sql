begin;
select plan(18);

insert into auth.users (id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('f3010000-0000-0000-0000-000000000001','authenticated','authenticated','cut03k-admin@example.invalid','', '{}'::jsonb,'{}'::jsonb,now(),now()),
 ('f3010000-0000-0000-0000-000000000002','authenticated','authenticated','cut03k-counter@example.invalid','', '{}'::jsonb,'{}'::jsonb,now(),now());
insert into public.profiles(user_id,display_name,role,user_type) values
 ('f3010000-0000-0000-0000-000000000001','CUT03K Admin','ADMIN','PERMANENT'),
 ('f3010000-0000-0000-0000-000000000002','CUT03K Counter','CONTADOR','PERMANENT');
insert into public.warehouses(id,code,name,timezone,operational_hours_id)
values ('f3f30000-0000-0000-0000-000000000002','CUT03K-B','CUT03K Bodega B','America/Santiago','00000000-0000-0000-0000-00000000c201');
insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by) values
 ('f3020000-0000-0000-0000-000000000001','CUT03K A','ABIERTO','00000000-0000-0000-0000-00000000c202','f3010000-0000-0000-0000-000000000001',now(),'f3010000-0000-0000-0000-000000000001',now(),'f3010000-0000-0000-0000-000000000001'),
 ('f3020000-0000-0000-0000-000000000002','CUT03K B','ABIERTO','f3f30000-0000-0000-0000-000000000002','f3010000-0000-0000-0000-000000000001',now(),'f3010000-0000-0000-0000-000000000001',now(),'f3010000-0000-0000-0000-000000000001');
insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values
 ('f3020000-0000-0000-0000-000000000001','f3010000-0000-0000-0000-000000000002','f3010000-0000-0000-0000-000000000001');
insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by) values
 ('f3020000-0000-0000-0000-000000000001','UOM-MATCH','Match','LEGACY','CUT03K','f3010000-0000-0000-0000-000000000001'),
 ('f3020000-0000-0000-0000-000000000001','UOM-MISMATCH','Mismatch','LEGACY','CUT03K','f3010000-0000-0000-0000-000000000001'),
 ('f3020000-0000-0000-0000-000000000001','UOM-MIXED','Mixed','LEGACY','CUT03K','f3010000-0000-0000-0000-000000000001'),
 ('f3020000-0000-0000-0000-000000000001','UOM-MISSING','Missing','LEGACY','CUT03K','f3010000-0000-0000-0000-000000000001'),
 ('f3020000-0000-0000-0000-000000000001','FIND-CRIT','Critical','LEGACY','CUT03K','f3010000-0000-0000-0000-000000000001'),
 ('f3020000-0000-0000-0000-000000000001','FIND-LINK','Link','LEGACY','CUT03K','f3010000-0000-0000-0000-000000000001'),
 ('f3020000-0000-0000-0000-000000000001','WAREHOUSE-ISO','A','LEGACY','CUT03K','f3010000-0000-0000-0000-000000000001'),
 ('f3020000-0000-0000-0000-000000000002','WAREHOUSE-ISO','B','LEGACY','CUT03K','f3010000-0000-0000-0000-000000000001');
insert into public.inventory_system_reference_items(inventory_id,codigo,reference_type,quantity,source_total_quantity,source_available_quantity,unit_code)
select i, code, 'LEGACY', 1, 1, 1, 'UN'
from (values
 ('f3020000-0000-0000-0000-000000000001'::uuid,'UOM-MATCH'),
 ('f3020000-0000-0000-0000-000000000001'::uuid,'UOM-MISMATCH'),
 ('f3020000-0000-0000-0000-000000000001'::uuid,'UOM-MIXED'),
 ('f3020000-0000-0000-0000-000000000001'::uuid,'UOM-MISSING'),
 ('f3020000-0000-0000-0000-000000000001'::uuid,'FIND-CRIT'),
 ('f3020000-0000-0000-0000-000000000001'::uuid,'FIND-LINK'),
 ('f3020000-0000-0000-0000-000000000001'::uuid,'WAREHOUSE-ISO'),
 ('f3020000-0000-0000-0000-000000000002'::uuid,'WAREHOUSE-ISO')
) v(i,code);
insert into public.sync_devices(id,user_id,platform,app_version,device_label) values
 ('f3030000-0000-0000-0000-000000000001','f3010000-0000-0000-0000-000000000002','WEB','test','CUT03K');

-- This first C1 row uses the public offline-sync contract, proving the UOM
-- evidence is reachable without a sealed-reference fixture.
select set_config('request.jwt.claim.sub','f3010000-0000-0000-0000-000000000002',true); set local role authenticated;
select is((select result_status from public.sync_counts('f3020000-0000-0000-0000-000000000001','f3030000-0000-0000-0000-000000000001','WEB','test','CUT03K',jsonb_build_array(jsonb_build_object('client_count_id','f3040000-0000-0000-0000-000000000001','ubicacion','A-01-01','codigo','UOM-MATCH','cantidad_contada',1,'physical_uom','UN','captured_at','2026-10-14T00:00:00Z')))),'ACCEPTED','K01: C1 sync accepts explicit physical UOM');
reset role;
insert into public.count_records(id,client_count_id,inventory_id,user_id,device_id,ubicacion,codigo,cantidad_contada,descripcion,physical_uom,uom_source,captured_at,received_at) values
 ('f3040000-0000-0000-0000-000000000002','f3050000-0000-0000-0000-000000000002','f3020000-0000-0000-0000-000000000001','f3010000-0000-0000-0000-000000000002','f3030000-0000-0000-0000-000000000001','A-01-02','UOM-MISMATCH',1,'Mismatch','CJ','EXPLICIT',now(),now()),
 ('f3040000-0000-0000-0000-000000000003','f3050000-0000-0000-0000-000000000003','f3020000-0000-0000-0000-000000000001','f3010000-0000-0000-0000-000000000002','f3030000-0000-0000-0000-000000000001','A-01-03','UOM-MIXED',1,'Mixed','UN','EXPLICIT',now(),now()),
 ('f3040000-0000-0000-0000-000000000004','f3050000-0000-0000-0000-000000000004','f3020000-0000-0000-0000-000000000001','f3010000-0000-0000-0000-000000000002','f3030000-0000-0000-0000-000000000001','A-01-04','UOM-MIXED',1,'Mixed','CJ','EXPLICIT',now(),now()),
 ('f3040000-0000-0000-0000-000000000005','f3050000-0000-0000-0000-000000000005','f3020000-0000-0000-0000-000000000001','f3010000-0000-0000-0000-000000000002','f3030000-0000-0000-0000-000000000001','A-01-05','UOM-MISSING',1,'Missing',null,'LEGACY_UNKNOWN',now(),now()),
 ('f3040000-0000-0000-0000-000000000006','f3050000-0000-0000-0000-000000000006','f3020000-0000-0000-0000-000000000001','f3010000-0000-0000-0000-000000000002','f3030000-0000-0000-0000-000000000001','A-01-06','FIND-CRIT',1,'Critical','UN','EXPLICIT',now(),now()),
 ('f3040000-0000-0000-0000-000000000007','f3050000-0000-0000-0000-000000000007','f3020000-0000-0000-0000-000000000001','f3010000-0000-0000-0000-000000000002','f3030000-0000-0000-0000-000000000001','A-01-07','FIND-LINK',1,'Link','UN','EXPLICIT',now(),now()),
 ('f3040000-0000-0000-0000-000000000008','f3050000-0000-0000-0000-000000000008','f3020000-0000-0000-0000-000000000001','f3010000-0000-0000-0000-000000000002','f3030000-0000-0000-0000-000000000001','A-01-08','WAREHOUSE-ISO',1,'A','UN','EXPLICIT',now(),now()),
 ('f3040000-0000-0000-0000-000000000009','f3050000-0000-0000-0000-000000000009','f3020000-0000-0000-0000-000000000002','f3010000-0000-0000-0000-000000000002','f3030000-0000-0000-0000-000000000001','B-01-01','WAREHOUSE-ISO',1,'B','UN','EXPLICIT',now(),now());

select set_config('request.jwt.claim.sub','f3010000-0000-0000-0000-000000000001',true); set local role authenticated;
select is((select item->>'uom_status' from jsonb_array_elements(public.preview_rolling_cut_v2('f3020000-0000-0000-0000-000000000001')->'items') item where item->>'codigo'='UOM-MATCH'),'MATCH','K02: pre-seal matching UOM is visible');
select is((select item->>'block_reason' from jsonb_array_elements(public.preview_rolling_cut_v2('f3020000-0000-0000-0000-000000000001')->'items') item where item->>'codigo'='UOM-MISMATCH'),'UOM_MISMATCH','K03: pre-seal UOM mismatch blocks preview');
select is((select item->>'block_reason' from jsonb_array_elements(public.preview_rolling_cut_v2('f3020000-0000-0000-0000-000000000001')->'items') item where item->>'codigo'='UOM-MIXED'),'UOM_CONFLICT','K04: mixed physical UOM never sums blindly');
select is((select item->>'uom_status' from jsonb_array_elements(public.preview_rolling_cut_v2('f3020000-0000-0000-0000-000000000001')->'items') item where item->>'codigo'='UOM-MISSING'),'MISSING_EVIDENCE','K05: NULL is visible as missing evidence, not a match');
reset role;
update public.inventories set require_physical_uom_evidence=true where id='f3020000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','f3010000-0000-0000-0000-000000000001',true); set local role authenticated;
select is((select item->>'block_reason' from jsonb_array_elements(public.preview_rolling_cut_v2('f3020000-0000-0000-0000-000000000001')->'items') item where item->>'codigo'='UOM-MISSING'),'UOM_EVIDENCE_MISSING','K06: strict UOM policy blocks missing evidence');
select set_config('cut03k.bad_fp',public.preview_rolling_cut_v2('f3020000-0000-0000-0000-000000000001',null,jsonb_build_object('normalized_reference_keys',jsonb_build_array('UOM-MISMATCH')))->>'preview_fingerprint',true);
select throws_ok($$select public.create_rolling_cut_v2('f3020000-0000-0000-0000-000000000001','f3060000-0000-0000-0000-000000000001',current_setting('cut03k.bad_fp'),jsonb_build_object('normalized_reference_keys',jsonb_build_array('UOM-MISMATCH')))$$,'23514','REFERENCE_NOT_ELIGIBLE','K07: rolling cut revalidates UOM before first seal');
select is((select count(*) from public.inventory_sealed_references where inventory_id='f3020000-0000-0000-0000-000000000001' and normalized_reference_key='UOM-MISMATCH'),0::bigint,'K08: blocked UOM creates no seal');

select set_config('cut03k.crit',public.create_preseal_reference_finding('f3020000-0000-0000-0000-000000000001','LEGACY','FIND-CRIT','PHYSICAL_MISMATCH','Critical finding before first seal',true)::text,true);
select is((select item->>'block_reason' from jsonb_array_elements(public.preview_rolling_cut_v2('f3020000-0000-0000-0000-000000000001')->'items') item where item->>'codigo'='FIND-CRIT'),'CRITICAL_FINDING_OPEN','K09: critical finding is reachable before seal and blocks preview');
reset role; select set_config('request.jwt.claim.sub','f3010000-0000-0000-0000-000000000002',true); set local role authenticated;
select throws_ok($$select public.create_preseal_reference_finding('f3020000-0000-0000-0000-000000000001','LEGACY','FIND-CRIT','PHYSICAL_MISMATCH','Counter may not classify',true)$$,'42501','Not authorized to classify a pre-seal finding','K10: only a manager can classify a critical finding');
reset role; select set_config('request.jwt.claim.sub','f3010000-0000-0000-0000-000000000001',true); set local role authenticated;
select public.resolve_preseal_reference_finding(current_setting('cut03k.crit')::uuid,'Physical review completed');
select is((select item->>'block_reason' from jsonb_array_elements(public.preview_rolling_cut_v2('f3020000-0000-0000-0000-000000000001')->'items') item where item->>'codigo'='FIND-CRIT'),null,'K11: authorized resolution removes only the finding block');
select is((select count(*) from public.preseal_guard_events where finding_id=current_setting('cut03k.crit')::uuid and event_type='PRESEAL_FINDING_RESOLVED'),1::bigint,'K12: finding resolution is append-only audited');

select public.create_preseal_reference_finding('f3020000-0000-0000-0000-000000000001','LEGACY','WAREHOUSE-ISO','PHYSICAL_MISMATCH','Warehouse A only',true);
select is((select item->>'block_reason' from jsonb_array_elements(public.preview_rolling_cut_v2('f3020000-0000-0000-0000-000000000002')->'items') item where item->>'codigo'='WAREHOUSE-ISO'),null,'K13: finding in warehouse A does not block warehouse B');
select set_config('cut03k.link_finding',public.create_preseal_reference_finding('f3020000-0000-0000-0000-000000000001','LEGACY','FIND-LINK','OTHER','Non-critical evidence before seal',false)::text,true);
select set_config('cut03k.link_fp',public.preview_rolling_cut_v2('f3020000-0000-0000-0000-000000000001',null,jsonb_build_object('normalized_reference_keys',jsonb_build_array('FIND-LINK')))->>'preview_fingerprint',true);
select lives_ok($$select public.create_rolling_cut_v2('f3020000-0000-0000-0000-000000000001','f3060000-0000-0000-0000-000000000002',current_setting('cut03k.link_fp'),jsonb_build_object('normalized_reference_keys',jsonb_build_array('FIND-LINK')))$$,'K14: non-critical pre-seal finding permits seal');
select is((select reference_id is not null from public.reference_findings where id=current_setting('cut03k.link_finding')::uuid),true,'K15: pre-seal finding links to its sealed reference');
select is((select count(*) from public.preseal_guard_events where finding_id=current_setting('cut03k.link_finding')::uuid and event_type='PRESEAL_FINDING_LINKED'),1::bigint,'K16: post-seal finding linkage is audited');
select is((select count(*) from public.preseal_guard_events where event_type='UOM_EVIDENCE_RECORDED' and count_record_id=(select id from public.count_records where client_count_id='f3040000-0000-0000-0000-000000000001')),1::bigint,'K17: synced UOM evidence has canonical audit trace');
select is((select physical_uom from public.count_records where client_count_id='f3040000-0000-0000-0000-000000000001'),'UN','K18: public sync persisted the physical UOM');

reset role;
select * from finish();
rollback;
