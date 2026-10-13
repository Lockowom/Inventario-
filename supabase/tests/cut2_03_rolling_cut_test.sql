begin;
select plan(21);

insert into auth.users (id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('e3010000-0000-0000-0000-000000000001','authenticated','authenticated','cut03-admin@example.invalid','', '{}'::jsonb,'{}'::jsonb,now(),now()),
 ('e3010000-0000-0000-0000-000000000002','authenticated','authenticated','cut03-counter@example.invalid','', '{}'::jsonb,'{}'::jsonb,now(),now());
insert into public.profiles(user_id,display_name,role,user_type) values
 ('e3010000-0000-0000-0000-000000000001','CUT03 Admin','ADMIN','PERMANENT'),
 ('e3010000-0000-0000-0000-000000000002','CUT03 Counter','CONTADOR','PERMANENT');
insert into public.inventories(id,name,status,created_by,prepared_at,prepared_by,opened_at,opened_by)
values('e3020000-0000-0000-0000-000000000001','CUT03','ABIERTO','e3010000-0000-0000-0000-000000000001',now(),'e3010000-0000-0000-0000-000000000001',now(),'e3010000-0000-0000-0000-000000000001');
insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values('e3020000-0000-0000-0000-000000000001','e3010000-0000-0000-0000-000000000002','e3010000-0000-0000-0000-000000000001');
insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by) values
 ('e3020000-0000-0000-0000-000000000001','SKU-OK','OK','LEGACY','CUT03','e3010000-0000-0000-0000-000000000001'),
 ('e3020000-0000-0000-0000-000000000001','SKU-DIFF','Diff','LEGACY','CUT03','e3010000-0000-0000-0000-000000000001'),
 ('e3020000-0000-0000-0000-000000000001','SKU-OPEN','Open','LEGACY','CUT03','e3010000-0000-0000-0000-000000000001');
insert into public.inventory_system_reference_items(inventory_id,codigo,reference_type,quantity,source_total_quantity,source_available_quantity,unit_code) values
 ('e3020000-0000-0000-0000-000000000001','SKU-OK','LEGACY',5,5,5,'UNI'),
 ('e3020000-0000-0000-0000-000000000001','SKU-DIFF','LEGACY',5,5,5,'UNI'),
 ('e3020000-0000-0000-0000-000000000001','SKU-OPEN','LEGACY',1,1,1,'UNI');
insert into public.sync_devices(id,user_id,platform,app_version,device_label) values('e3030000-0000-0000-0000-000000000001','e3010000-0000-0000-0000-000000000002','WEB','test','counter');
insert into public.count_records(id,client_count_id,inventory_id,user_id,device_id,ubicacion,codigo,cantidad_contada,descripcion,captured_at,received_at) values
 ('e3040000-0000-0000-0000-000000000001','e3050000-0000-0000-0000-000000000001','e3020000-0000-0000-0000-000000000001','e3010000-0000-0000-0000-000000000002','e3030000-0000-0000-0000-000000000001','A-01-01','SKU-OK',5,'OK',now(),now()),
 ('e3040000-0000-0000-0000-000000000002','e3050000-0000-0000-0000-000000000002','e3020000-0000-0000-0000-000000000001','e3010000-0000-0000-0000-000000000002','e3030000-0000-0000-0000-000000000001','A-01-02','SKU-DIFF',3,'Diff',now(),now()),
 ('e3040000-0000-0000-0000-000000000003','e3050000-0000-0000-0000-000000000003','e3020000-0000-0000-0000-000000000001','e3010000-0000-0000-0000-000000000002','e3030000-0000-0000-0000-000000000001','A-01-03','SKU-OPEN',1,'Open',now(),now());

select set_config('request.jwt.claim.sub','e3010000-0000-0000-0000-000000000001',true); set local role authenticated;
select set_config('cut2.fp',public.preview_rolling_cut_v2('e3020000-0000-0000-0000-000000000001',null,'{"normalized_reference_keys":["SKU-DIFF","SKU-OK"]}'::jsonb)->>'preview_fingerprint',true);
select set_config('cut2.cut',public.create_rolling_cut_v2('e3020000-0000-0000-0000-000000000001','e3060000-0000-0000-0000-000000000001',current_setting('cut2.fp'),'{"normalized_reference_keys":["SKU-DIFF","SKU-OK"]}'::jsonb)->>'cut_id',true);
reset role;
select is((select cut_mode::text from public.inventory_cuts where id=current_setting('cut2.cut')::uuid),'ROLLING_REFERENCE','T01: rolling cut is distinct from legacy mode');
select is((select status::text from public.inventory_cuts where id=current_setting('cut2.cut')::uuid),'ROLLING_SEALED','T01: rolling cut finalizes its atomic snapshot state');
select is((select count(*) from public.inventory_sealed_references where cut_id=current_setting('cut2.cut')::uuid),2::bigint,'T01: selected references are sealed');
select is((select count(*) from public.rolling_cut_reference_snapshots where cut_id=current_setting('cut2.cut')::uuid),2::bigint,'T12: all selected C1 records enter immutable snapshots');
select is((select count(*) from public.reconciliation_cases where source_cut_id=current_setting('cut2.cut')::uuid),1::bigint,'T07: only the difference creates a reconciliation case');
select is((select count(*) from public.recount_missions where source_cut_id=current_setting('cut2.cut')::uuid and round=2),1::bigint,'T07: difference creates exactly one C2 mission');
select is((select count(*) from public.inventory_sealed_references where inventory_id='e3020000-0000-0000-0000-000000000001' and normalized_reference_key='SKU-OPEN'),0::bigint,'T16: unselected identity remains open C1');
select is((select count(*) from public.rolling_cut_events where cut_id=current_setting('cut2.cut')::uuid and event_type='ROLLING_CUT_CREATED'),1::bigint,'T26: cut audit event is append-only and exactly once');
select is((select count(*) from public.generated_files where inventory_id='e3020000-0000-0000-0000-000000000001'),0::bigint,'T28: no XLSX generated');
select is((select count(*) from public.rp_release_batches where inventory_id='e3020000-0000-0000-0000-000000000001'),0::bigint,'T27: no RP release generated');
select is((select c1_completed_at is null from public.inventories where id='e3020000-0000-0000-0000-000000000001'),true,'T29: C1 global remains open');
select set_config('request.jwt.claim.sub','e3010000-0000-0000-0000-000000000002',true); set local role authenticated;
select is((public.get_my_recount_queue('e3020000-0000-0000-0000-000000000001')->>'queued_count')::integer,1,'T24: C2 from rolling cut is visible while global C1 remains open');
select is(public.claim_next_recount_mission('e3020000-0000-0000-0000-000000000001')->>'round','2','T24: counter can claim rolling C2 without global C1 completion');
reset role;
select set_config('request.jwt.claim.sub','e3010000-0000-0000-0000-000000000001',true); set local role authenticated;
select is((public.create_rolling_cut_v2('e3020000-0000-0000-0000-000000000001','e3060000-0000-0000-0000-000000000001',current_setting('cut2.fp'),'{"normalized_reference_keys":["SKU-DIFF","SKU-OK"]}'::jsonb)->>'cut_id'),current_setting('cut2.cut'),'T04: request retry returns the same cut');
select throws_ok($$select public.create_rolling_cut_v2('e3020000-0000-0000-0000-000000000001','e3060000-0000-0000-0000-000000000001',repeat('b',64),'{"normalized_reference_keys":["SKU-DIFF","SKU-OK"]}'::jsonb)$$,'23505','IDEMPOTENCY_CONFLICT','T05: request conflict creates no new cut');
select throws_ok($$select public.create_rolling_cut_v2('e3020000-0000-0000-0000-000000000001','e3060000-0000-0000-0000-000000000099',current_setting('cut2.fp'),'{"normalized_reference_keys":[]}'::jsonb)$$,'23514','EMPTY_SELECTION','T03: empty selection is rejected');
select set_config('cut2.open_fp',public.preview_rolling_cut_v2('e3020000-0000-0000-0000-000000000001',null,'{"normalized_reference_keys":["SKU-OPEN"]}'::jsonb)->>'preview_fingerprint',true);
reset role;
update public.count_records set cantidad_contada=2 where id='e3040000-0000-0000-0000-000000000003';
select set_config('request.jwt.claim.sub','e3010000-0000-0000-0000-000000000001',true); set local role authenticated;
select throws_ok($$select public.create_rolling_cut_v2('e3020000-0000-0000-0000-000000000001','e3060000-0000-0000-0000-000000000002',current_setting('cut2.open_fp'),'{"normalized_reference_keys":["SKU-OPEN"]}'::jsonb)$$,'P0001','PREVIEW_STALE','T02: material C1 change aborts stale preview');
select is((select count(*) from public.inventory_sealed_references where normalized_reference_key='SKU-OPEN'),0::bigint,'T02: stale preview leaves no partial seal');
reset role;
select set_config('request.jwt.claim.sub','e3010000-0000-0000-0000-000000000002',true); set local role authenticated;
select is((select result_status from public.sync_counts('e3020000-0000-0000-0000-000000000001','e3030000-0000-0000-0000-000000000001','WEB','test','counter','[{"client_count_id":"e3050000-0000-0000-0000-000000000099","ubicacion":"A-01-01","codigo":"SKU-OK","cantidad_contada":1,"captured_at":"2026-10-13T00:00:00Z"}]'::jsonb)),'REJECTED','T13: late/offline C1 is rejected after seal');
select is((select reason from public.sync_counts('e3020000-0000-0000-0000-000000000001','e3030000-0000-0000-0000-000000000001','WEB','test','counter','[{"client_count_id":"e3050000-0000-0000-0000-000000000098","ubicacion":"A-01-01","codigo":"SKU-OK","cantidad_contada":1,"captured_at":"2026-10-13T00:00:00Z"}]'::jsonb)),'REFERENCE_SEALED','T15: sealed rejection retains conflict context code');
reset role;
select set_config('request.jwt.claim.sub','e3010000-0000-0000-0000-000000000002',true); set local role authenticated;
select throws_ok($$select public.create_rolling_cut_v2('e3020000-0000-0000-0000-000000000001','e3060000-0000-0000-0000-000000000003',repeat('a',64),'{"normalized_reference_keys":["SKU-OPEN"]}'::jsonb)$$,'42501','Not authorized for rolling cut','T23: counter cannot create a rolling cut');
reset role;
select * from finish();
rollback;
