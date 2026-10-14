begin;
select plan(31);

-- CUT2-03L: real canonical identities must remain distinguishable before a
-- rolling seal.  The fixture intentionally uses only synthetic local data.
insert into auth.users (id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('fa310000-0000-0000-0000-000000000001','authenticated','authenticated','cut03l-admin@example.invalid','', '{}'::jsonb,'{}'::jsonb,now(),now()),
 ('fa310000-0000-0000-0000-000000000002','authenticated','authenticated','cut03l-counter@example.invalid','', '{}'::jsonb,'{}'::jsonb,now(),now());
insert into public.profiles(user_id,display_name,role,user_type) values
 ('fa310000-0000-0000-0000-000000000001','CUT03L Admin','ADMIN','PERMANENT'),
 ('fa310000-0000-0000-0000-000000000002','CUT03L Counter','CONTADOR','PERMANENT');
insert into public.warehouses(id,code,name,timezone,operational_hours_id)
values ('fa350000-0000-0000-0000-000000000002','CUT03L-B','CUT03L Bodega B','America/Santiago','00000000-0000-0000-0000-00000000c201');
insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by) values
 ('fa320000-0000-0000-0000-000000000001','CUT03L A','ABIERTO','00000000-0000-0000-0000-00000000c202','fa310000-0000-0000-0000-000000000001',now(),'fa310000-0000-0000-0000-000000000001',now(),'fa310000-0000-0000-0000-000000000001'),
 ('fa320000-0000-0000-0000-000000000002','CUT03L B','ABIERTO','fa350000-0000-0000-0000-000000000002','fa310000-0000-0000-0000-000000000001',now(),'fa310000-0000-0000-0000-000000000001',now(),'fa310000-0000-0000-0000-000000000001');
insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values
 ('fa320000-0000-0000-0000-000000000001','fa310000-0000-0000-0000-000000000002','fa310000-0000-0000-0000-000000000001');
insert into public.sync_devices(id,user_id,platform,app_version,device_label)
values ('fa330000-0000-0000-0000-000000000001','fa310000-0000-0000-0000-000000000002','WEB','test','CUT03L');

insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by)
select 'fa320000-0000-0000-0000-000000000001',codigo,codigo,control_type,'CUT03L','fa310000-0000-0000-0000-000000000001'
from (values
 ('P-MATCH','PARTIDA'::public.master_control_type),('P-MULTI','PARTIDA'::public.master_control_type),
 ('P-MISMATCH','PARTIDA'::public.master_control_type),('S-MATCH','SERIAL'::public.master_control_type),
 ('S-MISMATCH','SERIAL'::public.master_control_type),('S-DUP','SERIAL'::public.master_control_type),
 ('LEG-VALID','LEGACY'::public.master_control_type),('ORPHAN','LEGACY'::public.master_control_type),('NEG','LEGACY'::public.master_control_type),
 ('WH-SAME','LEGACY'::public.master_control_type)
) v(codigo,control_type);
insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by)
values ('fa320000-0000-0000-0000-000000000002','WH-SAME','WH-SAME','LEGACY','CUT03L','fa310000-0000-0000-0000-000000000001');

insert into public.inventory_system_reference_items(inventory_id,codigo,reference_type,reference_value,quantity,source_total_quantity,source_available_quantity,unit_code) values
 ('fa320000-0000-0000-0000-000000000001','P-MATCH','PARTIDA','LOTE-A',10,10,10,'UN'),
 ('fa320000-0000-0000-0000-000000000001','P-MULTI','PARTIDA','LOTE-X',10,10,10,'UN'),
 ('fa320000-0000-0000-0000-000000000001','P-MISMATCH','PARTIDA','LOTE-A',10,10,10,'UN'),
 ('fa320000-0000-0000-0000-000000000001','S-MATCH','SERIAL','SER-001',1,1,1,'UN'),
 ('fa320000-0000-0000-0000-000000000001','S-MISMATCH','SERIAL','SER-001',1,1,1,'UN'),
 ('fa320000-0000-0000-0000-000000000001','S-DUP','SERIAL','SER-001',1,1,1,'UN'),
 ('fa320000-0000-0000-0000-000000000001','LEG-VALID','LEGACY',null,1,1,1,'UN'),
 ('fa320000-0000-0000-0000-000000000001','NEG','LEGACY',null,0,0,-2,'UN'),
 ('fa320000-0000-0000-0000-000000000001','WH-SAME','LEGACY',null,1,1,1,'UN'),
 ('fa320000-0000-0000-0000-000000000002','WH-SAME','LEGACY',null,1,1,1,'UN');

insert into public.count_records(id,client_count_id,inventory_id,user_id,device_id,ubicacion,codigo,serie,partida,cantidad_contada,descripcion,physical_uom,uom_source,captured_at,received_at)
select id,client_id,'fa320000-0000-0000-0000-000000000001','fa310000-0000-0000-0000-000000000002','fa330000-0000-0000-0000-000000000001',ubicacion,codigo,serie,partida,cantidad,codigo,'UN','EXPLICIT',now(),now()
from (values
 ('fa340000-0000-0000-0000-000000000001'::uuid,'fa360000-0000-0000-0000-000000000001'::uuid,'A-01','P-MATCH',null,'LOTE-A',10),
 ('fa340000-0000-0000-0000-000000000002'::uuid,'fa360000-0000-0000-0000-000000000002'::uuid,'A-02','P-MULTI',null,'LOTE-X',4),
 ('fa340000-0000-0000-0000-000000000003'::uuid,'fa360000-0000-0000-0000-000000000003'::uuid,'A-03','P-MULTI',null,'LOTE-X',6),
 ('fa340000-0000-0000-0000-000000000004'::uuid,'fa360000-0000-0000-0000-000000000004'::uuid,'A-04','P-MISMATCH',null,'LOTE-B',10),
 ('fa340000-0000-0000-0000-000000000005'::uuid,'fa360000-0000-0000-0000-000000000005'::uuid,'A-05','S-MATCH','SER-001',null,1),
 ('fa340000-0000-0000-0000-000000000006'::uuid,'fa360000-0000-0000-0000-000000000006'::uuid,'A-06','S-MISMATCH','SER-999',null,1),
 ('fa340000-0000-0000-0000-000000000007'::uuid,'fa360000-0000-0000-0000-000000000007'::uuid,'A-07','S-DUP','SER-001',null,1),
 ('fa340000-0000-0000-0000-000000000008'::uuid,'fa360000-0000-0000-0000-000000000008'::uuid,'A-08','S-DUP','SER-001',null,1),
 ('fa340000-0000-0000-0000-000000000009'::uuid,'fa360000-0000-0000-0000-000000000009'::uuid,'A-09','LEG-VALID',null,null,1),
 ('fa340000-0000-0000-0000-000000000010'::uuid,'fa360000-0000-0000-0000-000000000010'::uuid,'A-10','ORPHAN',null,null,1),
 ('fa340000-0000-0000-0000-000000000011'::uuid,'fa360000-0000-0000-0000-000000000011'::uuid,'A-11','NEG',null,null,1),
 ('fa340000-0000-0000-0000-000000000012'::uuid,'fa360000-0000-0000-0000-000000000012'::uuid,'A-12','WH-SAME',null,null,1)
) v(id,client_id,ubicacion,codigo,serie,partida,cantidad);
insert into public.count_records(id,client_count_id,inventory_id,user_id,device_id,ubicacion,codigo,cantidad_contada,descripcion,physical_uom,uom_source,captured_at,received_at)
values ('fa340000-0000-0000-0000-000000000013','fa360000-0000-0000-0000-000000000013','fa320000-0000-0000-0000-000000000002','fa310000-0000-0000-0000-000000000002','fa330000-0000-0000-0000-000000000001','B-01','WH-SAME',1,'WH-SAME','UN','EXPLICIT',now(),now());
insert into public.orphan_references(inventory_id,warehouse_id,codigo,reference_type,normalized_reference_key,created_by)
select id,warehouse_id,'ORPHAN','LEGACY',public.normalize_reference_key('LEGACY','ORPHAN',null),'fa310000-0000-0000-0000-000000000001'
from public.inventories where id='fa320000-0000-0000-0000-000000000001';

select set_config('request.jwt.claim.sub','fa310000-0000-0000-0000-000000000001',true); set local role authenticated;
select is((select item->>'uom_status' from jsonb_array_elements(public.preview_rolling_cut_v2('fa320000-0000-0000-0000-000000000001')->'items') item where item->>'normalized_reference_key'='P-MATCH::LOTE-A'),'MATCH','L01: PARTIDA match retains explicit UOM match');
select is((select item->>'estimated_result' from jsonb_array_elements(public.preview_rolling_cut_v2('fa320000-0000-0000-0000-000000000001')->'items') item where item->>'normalized_reference_key'='P-MATCH::LOTE-A'),'RP_READY_ESTIMATE','L02: matched PARTIDA is RP-ready estimate');
select set_config('cut03l.pmatchfp',public.preview_rolling_cut_v2('fa320000-0000-0000-0000-000000000001',null,jsonb_build_object('normalized_reference_keys',jsonb_build_array('P-MATCH::LOTE-A')))->>'preview_fingerprint',true);
select set_config('cut03l.pmatchcut',public.create_rolling_cut_v2('fa320000-0000-0000-0000-000000000001','fa370000-0000-0000-0000-000000000001',current_setting('cut03l.pmatchfp'),jsonb_build_object('normalized_reference_keys',jsonb_build_array('P-MATCH::LOTE-A')))->>'cut_id',true);
reset role;
select is((select count(*) from public.recount_missions where source_cut_id=current_setting('cut03l.pmatchcut')::uuid),0::bigint,'L03: matched PARTIDA creates no C2');

set local role authenticated;
select is((select item->>'c1_quantity' from jsonb_array_elements(public.preview_rolling_cut_v2('fa320000-0000-0000-0000-000000000001')->'items') item where item->>'normalized_reference_key'='P-MULTI::LOTE-X'),'10','L04: multi-location PARTIDA aggregates physical quantity');
select set_config('cut03l.pmultifp',public.preview_rolling_cut_v2('fa320000-0000-0000-0000-000000000001',null,jsonb_build_object('normalized_reference_keys',jsonb_build_array('P-MULTI::LOTE-X')))->>'preview_fingerprint',true);
select set_config('cut03l.pmulticut',public.create_rolling_cut_v2('fa320000-0000-0000-0000-000000000001','fa370000-0000-0000-0000-000000000002',current_setting('cut03l.pmultifp'),jsonb_build_object('normalized_reference_keys',jsonb_build_array('P-MULTI::LOTE-X')))->>'cut_id',true);
reset role;
select is((select count(*) from public.inventory_sealed_references where cut_id=current_setting('cut03l.pmulticut')::uuid),1::bigint,'L05: multi-location PARTIDA seals one canonical identity');
select is((select count(*) from public.rolling_cut_reference_snapshots where cut_id=current_setting('cut03l.pmulticut')::uuid),2::bigint,'L06: multi-location PARTIDA retains two location evidences');
select is((select count(*) from public.recount_missions where source_cut_id=current_setting('cut03l.pmulticut')::uuid),0::bigint,'L07: balanced multi-location PARTIDA creates no C2');

set local role authenticated;
select is((select item->>'estimated_result' from jsonb_array_elements(public.preview_rolling_cut_v2('fa320000-0000-0000-0000-000000000001')->'items') item where item->>'normalized_reference_key'='P-MISMATCH::LOTE-B'),'C2_REQUIRED_ESTIMATE','L08: new PARTIDA identity is never falsely RP-ready');
select is((select item->>'c1_quantity' from jsonb_array_elements(public.preview_rolling_cut_v2('fa320000-0000-0000-0000-000000000001')->'items') item where item->>'normalized_reference_key'='P-MISMATCH::LOTE-A'),'0','L09: missing system PARTIDA remains independently visible');
select set_config('cut03l.pmisfp',public.preview_rolling_cut_v2('fa320000-0000-0000-0000-000000000001',null,jsonb_build_object('normalized_reference_keys',jsonb_build_array('P-MISMATCH::LOTE-B')))->>'preview_fingerprint',true);
select set_config('cut03l.pmiscut',public.create_rolling_cut_v2('fa320000-0000-0000-0000-000000000001','fa370000-0000-0000-0000-000000000003',current_setting('cut03l.pmisfp'),jsonb_build_object('normalized_reference_keys',jsonb_build_array('P-MISMATCH::LOTE-B')))->>'cut_id',true);
reset role;
select is((select count(*) from public.recount_missions where source_cut_id=current_setting('cut03l.pmiscut')::uuid),1::bigint,'L10: PARTIDA mismatch creates exactly one C2 for the physical identity');

set local role authenticated;
select set_config('cut03l.smatchfp',public.preview_rolling_cut_v2('fa320000-0000-0000-0000-000000000001',null,jsonb_build_object('normalized_reference_keys',jsonb_build_array('S-MATCH::SER-001')))->>'preview_fingerprint',true);
select set_config('cut03l.smatchcut',public.create_rolling_cut_v2('fa320000-0000-0000-0000-000000000001','fa370000-0000-0000-0000-000000000004',current_setting('cut03l.smatchfp'),jsonb_build_object('normalized_reference_keys',jsonb_build_array('S-MATCH::SER-001')))->>'cut_id',true);
reset role;
select is((select count(*) from public.recount_missions where source_cut_id=current_setting('cut03l.smatchcut')::uuid),0::bigint,'L11: matched SERIAL creates no C2');
set local role authenticated;
select set_config('cut03l.smisfp',public.preview_rolling_cut_v2('fa320000-0000-0000-0000-000000000001',null,jsonb_build_object('normalized_reference_keys',jsonb_build_array('S-MISMATCH::SER-999')))->>'preview_fingerprint',true);
select set_config('cut03l.smiscut',public.create_rolling_cut_v2('fa320000-0000-0000-0000-000000000001','fa370000-0000-0000-0000-000000000005',current_setting('cut03l.smisfp'),jsonb_build_object('normalized_reference_keys',jsonb_build_array('S-MISMATCH::SER-999')))->>'cut_id',true);
reset role;
select is((select count(*) from public.recount_missions where source_cut_id=current_setting('cut03l.smiscut')::uuid),1::bigint,'L12: SERIAL mismatch creates C2 rather than a false RP-ready');
set local role authenticated;
select is((select item->>'block_reason' from jsonb_array_elements(public.preview_rolling_cut_v2('fa320000-0000-0000-0000-000000000001')->'items') item where item->>'normalized_reference_key'='S-DUP::SER-001'),'DUPLICATE_SERIAL','L13: duplicate SERIAL is blocked before seal');
select set_config('cut03l.sdupfp',public.preview_rolling_cut_v2('fa320000-0000-0000-0000-000000000001',null,jsonb_build_object('normalized_reference_keys',jsonb_build_array('S-DUP::SER-001')))->>'preview_fingerprint',true);
select throws_ok($$select public.create_rolling_cut_v2('fa320000-0000-0000-0000-000000000001','fa370000-0000-0000-0000-000000000006',current_setting('cut03l.sdupfp'),jsonb_build_object('normalized_reference_keys',jsonb_build_array('S-DUP::SER-001')))$$,'23514','REFERENCE_NOT_ELIGIBLE','L14: duplicate SERIAL creates no valid rolling seal');

-- The remaining blocks include preview RPC calls and are intentionally made
-- under the manager role; table assertions reset that role afterwards.
select is((select item->>'block_reason' from jsonb_array_elements(public.preview_rolling_cut_v2('fa320000-0000-0000-0000-000000000001')->'items') item where item->>'normalized_reference_key'='ORPHAN'),'ORPHAN_REFERENCE','L15: orphan identity blocks seal');
select set_config('cut03l.orphanfp',public.preview_rolling_cut_v2('fa320000-0000-0000-0000-000000000001',null,jsonb_build_object('normalized_reference_keys',jsonb_build_array('LEG-VALID','ORPHAN')))->>'preview_fingerprint',true);
select throws_ok($$select public.create_rolling_cut_v2('fa320000-0000-0000-0000-000000000001','fa370000-0000-0000-0000-000000000007',current_setting('cut03l.orphanfp'),jsonb_build_object('normalized_reference_keys',jsonb_build_array('LEG-VALID','ORPHAN')))$$,'23514','REFERENCE_NOT_ELIGIBLE','L16: selection with orphan rolls back atomically');
reset role;
select is((select count(*) from public.inventory_sealed_references where inventory_id='fa320000-0000-0000-0000-000000000001' and normalized_reference_key='LEG-VALID'),0::bigint,'L17: valid neighbour is not partially sealed with orphan');
set local role authenticated;
select is((select item->>'block_reason' from jsonb_array_elements(public.preview_rolling_cut_v2('fa320000-0000-0000-0000-000000000001')->'items') item where item->>'normalized_reference_key'='NEG'),'RISK_NEGATIVE_BALANCE','L18: negative available balance blocks seal');
select set_config('cut03l.negfp',public.preview_rolling_cut_v2('fa320000-0000-0000-0000-000000000001',null,jsonb_build_object('normalized_reference_keys',jsonb_build_array('NEG')))->>'preview_fingerprint',true);
select throws_ok($$select public.create_rolling_cut_v2('fa320000-0000-0000-0000-000000000001','fa370000-0000-0000-0000-000000000008',current_setting('cut03l.negfp'),jsonb_build_object('normalized_reference_keys',jsonb_build_array('NEG')))$$,'23514','REFERENCE_NOT_ELIGIBLE','L19: negative balance creates no rolling cut');

-- Warehouse B has no assignment; the manager may still preview it.
select is((select item->>'block_reason' from jsonb_array_elements(public.preview_rolling_cut_v2('fa320000-0000-0000-0000-000000000002')->'items') item where item->>'normalized_reference_key'='WH-SAME'),null,'L20: warehouse B is not blocked by warehouse A records');
select lives_ok($$select public.preview_rolling_cut_v2('fa320000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202')$$,'L21: matching warehouse scope works');
select throws_ok($$select public.preview_rolling_cut_v2('fa320000-0000-0000-0000-000000000001','fa350000-0000-0000-0000-000000000002')$$,'23514','Warehouse does not belong to inventory','L22: cross-warehouse preview is rejected before selection');
reset role;
select is((select count(*) from public.inventory_sealed_references where inventory_id='fa320000-0000-0000-0000-000000000002'),0::bigint,'L23: warehouse B remains untouched by A rolling cuts');
select is((select count(*) from public.rolling_cut_reference_snapshots where cut_id=current_setting('cut03l.pmiscut')::uuid),1::bigint,'L24: PARTIDA mismatch snapshot contains only its physical evidence');
select is((select count(*) from public.rolling_cut_reference_snapshots where cut_id=current_setting('cut03l.smiscut')::uuid),1::bigint,'L25: SERIAL mismatch snapshot contains only its physical evidence');
select is((select state::text from public.inventory_sealed_references where cut_id=current_setting('cut03l.smatchcut')::uuid),'SEALED','L26: SERIAL match reaches SEALED state');
select is((select physical_uom from public.count_records where id='fa340000-0000-0000-0000-000000000004'),'UN','L27: PARTIDA mismatch preserves physical UOM evidence');
select is((select count(*) from public.reconciliation_cases where source_cut_id=current_setting('cut03l.pmiscut')::uuid),1::bigint,'L28: PARTIDA mismatch creates one reconciliation case');
select is((select count(*) from public.reconciliation_cases where source_cut_id=current_setting('cut03l.smiscut')::uuid),1::bigint,'L29: SERIAL mismatch creates one reconciliation case');
select is((select count(*) from public.inventory_sealed_references where inventory_id='fa320000-0000-0000-0000-000000000001' and normalized_reference_key='NEG'),0::bigint,'L30: negative identity has no seal');
select is((select count(*) from public.recount_missions where inventory_id='fa320000-0000-0000-0000-000000000001' and source_cut_id is not null),2::bigint,'L31: only the two intended identity mismatches create C2');

select * from finish();
rollback;
