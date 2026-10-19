begin;
select plan(38);

-- CUT2-09B4: identity invariants are validated at the sealed-reference
-- boundary; the release authority only ever receives canonical identities.
insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('c9d10000-0000-0000-0000-000000000001','authenticated','authenticated','c09-b4@example.test','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,user_type,active)
values ('c9d10000-0000-0000-0000-000000000001','C09 B4 analyst','ANALISTA','PERMANENT',true);
insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by)
values ('c9d20000-0000-0000-0000-000000000001','C09 B4 identities','ABIERTO','00000000-0000-0000-0000-00000000c202','c9d10000-0000-0000-0000-000000000001',now(),'c9d10000-0000-0000-0000-000000000001',now(),'c9d10000-0000-0000-0000-000000000001');
insert into public.inventory_assignments(inventory_id,user_id,assigned_by)
values ('c9d20000-0000-0000-0000-000000000001','c9d10000-0000-0000-0000-000000000001','c9d10000-0000-0000-0000-000000000001');
insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by) values
 ('c9d20000-0000-0000-0000-000000000001','C09-LEG-A','Legacy A','LEGACY','CUT2-09','c9d10000-0000-0000-0000-000000000001'),
 ('c9d20000-0000-0000-0000-000000000001','C09-LEG-B','Legacy B','LEGACY','CUT2-09','c9d10000-0000-0000-0000-000000000001'),
 ('c9d20000-0000-0000-0000-000000000001','C09-LOT','Lots','PARTIDA','CUT2-09','c9d10000-0000-0000-0000-000000000001'),
 ('c9d20000-0000-0000-0000-000000000001','C09-SER','Serials','SERIAL','CUT2-09','c9d10000-0000-0000-0000-000000000001'),
 ('c9d20000-0000-0000-0000-000000000001','C09-ZERO','Zero is valid','LEGACY','CUT2-09','c9d10000-0000-0000-0000-000000000001'),
 ('c9d20000-0000-0000-0000-000000000001','C09-STALE','Stale fixture','LEGACY','CUT2-09','c9d10000-0000-0000-0000-000000000001');

select throws_ok($$insert into public.inventory_sealed_references(inventory_id,warehouse_id,reference_type,codigo,normalized_reference_key,state,request_id,physical_quantity,sealed_at,sealed_by) values ('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','LEGACY','C09-NEG',public.normalize_reference_key('LEGACY','C09-NEG',null),'SEALED','c9d40000-0000-0000-0000-000000000001',-1,now(),'c9d10000-0000-0000-0000-000000000001')$$,'23514',null,'B4: negative sealed quantity is rejected before RP eligibility');
select throws_ok($$insert into public.inventory_sealed_references(inventory_id,warehouse_id,reference_type,codigo,normalized_reference_key,state,request_id,physical_quantity,sealed_at,sealed_by) values ('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','LEGACY','',public.normalize_reference_key('LEGACY','',null),'SEALED','c9d40000-0000-0000-0000-000000000002',1,now(),'c9d10000-0000-0000-0000-000000000001')$$,'23514',null,'B4: empty LEGACY SKU is rejected at canonical identity boundary');
select throws_ok($$insert into public.inventory_sealed_references(inventory_id,warehouse_id,reference_type,codigo,normalized_reference_key,state,request_id,physical_quantity,sealed_at,sealed_by) values ('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','PARTIDA','C09-LOT',public.normalize_reference_key('PARTIDA','C09-LOT',null),'SEALED','c9d40000-0000-0000-0000-000000000003',1,now(),'c9d10000-0000-0000-0000-000000000001')$$,'23514',null,'B4: PARTIDA without lot is rejected at canonical identity boundary');
select throws_ok($$insert into public.inventory_sealed_references(inventory_id,warehouse_id,reference_type,codigo,normalized_reference_key,state,request_id,physical_quantity,sealed_at,sealed_by) values ('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','SERIAL','C09-SER',public.normalize_reference_key('SERIAL','C09-SER',null),'SEALED','c9d40000-0000-0000-0000-000000000004',1,now(),'c9d10000-0000-0000-0000-000000000001')$$,'23514',null,'B4: SERIAL without serial is rejected at canonical identity boundary');

insert into public.inventory_sealed_references(id,inventory_id,warehouse_id,reference_type,codigo,reference_value,normalized_reference_key,state,request_id,physical_quantity,sealed_at,sealed_by) values
 ('c9d30000-0000-0000-0000-000000000001','c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','LEGACY','C09-LEG-A',null,public.normalize_reference_key('LEGACY','C09-LEG-A',null),'SEALED','c9d40000-0000-0000-0000-000000000011',1,now(),'c9d10000-0000-0000-0000-000000000001'),
 ('c9d30000-0000-0000-0000-000000000002','c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','LEGACY','C09-LEG-B',null,public.normalize_reference_key('LEGACY','C09-LEG-B',null),'SEALED','c9d40000-0000-0000-0000-000000000012',1,now(),'c9d10000-0000-0000-0000-000000000001'),
 ('c9d30000-0000-0000-0000-000000000003','c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','PARTIDA','C09-LOT','LOT-A',public.normalize_reference_key('PARTIDA','C09-LOT','LOT-A'),'SEALED','c9d40000-0000-0000-0000-000000000013',1,now(),'c9d10000-0000-0000-0000-000000000001'),
 ('c9d30000-0000-0000-0000-000000000004','c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','PARTIDA','C09-LOT','LOT-B',public.normalize_reference_key('PARTIDA','C09-LOT','LOT-B'),'SEALED','c9d40000-0000-0000-0000-000000000014',1,now(),'c9d10000-0000-0000-0000-000000000001'),
 ('c9d30000-0000-0000-0000-000000000005','c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','SERIAL','C09-SER','SER-001',public.normalize_reference_key('SERIAL','C09-SER','SER-001'),'SEALED','c9d40000-0000-0000-0000-000000000015',1,now(),'c9d10000-0000-0000-0000-000000000001'),
 ('c9d30000-0000-0000-0000-000000000006','c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','SERIAL','C09-SER','SER-002',public.normalize_reference_key('SERIAL','C09-SER','SER-002'),'SEALED','c9d40000-0000-0000-0000-000000000016',1,now(),'c9d10000-0000-0000-0000-000000000001'),
 ('c9d30000-0000-0000-0000-000000000007','c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','LEGACY','C09-ZERO',null,public.normalize_reference_key('LEGACY','C09-ZERO',null),'SEALED','c9d40000-0000-0000-0000-000000000017',0,now(),'c9d10000-0000-0000-0000-000000000001'),
 ('c9d30000-0000-0000-0000-000000000008','c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','LEGACY','C09-STALE',null,public.normalize_reference_key('LEGACY','C09-STALE',null),'SEALED','c9d40000-0000-0000-0000-000000000018',1,now(),'c9d10000-0000-0000-0000-000000000001');

select throws_ok($$insert into public.inventory_sealed_references(inventory_id,warehouse_id,reference_type,codigo,reference_value,normalized_reference_key,state,request_id,physical_quantity,sealed_at,sealed_by) values ('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','SERIAL','C09-SER','SER-001',public.normalize_reference_key('SERIAL','C09-SER','SER-001'),'SEALED','c9d40000-0000-0000-0000-000000000019',1,now(),'c9d10000-0000-0000-0000-000000000001')$$,'23505',null,'B4: duplicate SERIAL identity is rejected before RP eligibility');

select set_config('request.jwt.claim.sub','c9d10000-0000-0000-0000-000000000001',true);
set local role authenticated;
select set_config('c09d.zero',public.preview_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000007'::uuid])::text,true);
select is((current_setting('c09d.zero')::jsonb->>'eligible_references')::integer,1,'B4: zero quantity is valid and is not NEGATIVE_QUANTITY');
select ok(not (select item->'blocker_codes' ? 'NEGATIVE_QUANTITY' from jsonb_array_elements(current_setting('c09d.zero')::jsonb->'items') item),'B4: zero quantity has no negative-quantity blocker');

select set_config('c09d.legacy_a_before',public.preview_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000001'::uuid])::text,true);
select set_config('c09d.legacy_b',public.report_c1_reference_finding('c9d20000-0000-0000-0000-000000000001','LEGACY','C09-LEG-B',null,'OTHER','Legacy B blocks only itself',true,'c09d-legacy-b',now(),false,jsonb_build_object('note','identity-local blocker'))::text,true);
select is((public.preview_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000001'::uuid])->>'fingerprint'),current_setting('c09d.legacy_a_before')::jsonb->>'fingerprint','B4: LEGACY blocker on SKU-B does not alter SKU-A subset fingerprint');
select is((public.preview_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000002'::uuid])->>'eligible_references')::integer,0,'B4: LEGACY SKU-B is independently blocked');

select set_config('c09d.lot_combined_before',public.preview_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000003'::uuid,'c9d30000-0000-0000-0000-000000000004'::uuid])::text,true);
select set_config('c09d.lot_a_before',public.preview_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000003'::uuid])::text,true);
select set_config('c09d.lot_b',public.report_c1_reference_finding('c9d20000-0000-0000-0000-000000000001','PARTIDA','C09-LOT','LOT-B','OTHER','LOT-B blocks only itself',true,'c09d-lot-b',now(),false,jsonb_build_object('note','batch-local blocker'))::text,true);
select is((public.preview_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000003'::uuid])->>'eligible_references')::integer,1,'B4: LOT-A remains eligible');
select is((public.preview_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000004'::uuid])->>'eligible_references')::integer,0,'B4: LOT-B is independently blocked');
select isnt((public.preview_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000003'::uuid,'c9d30000-0000-0000-0000-000000000004'::uuid])->>'fingerprint'),current_setting('c09d.lot_combined_before')::jsonb->>'fingerprint','B4: LOT-B material blocker changes combined fingerprint');
select is((public.preview_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000003'::uuid])->>'fingerprint'),current_setting('c09d.lot_a_before')::jsonb->>'fingerprint','B4: LOT-B material blocker does not contaminate LOT-A subset fingerprint');
select set_config('c09d.lot_a_release',public.create_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000003'::uuid],current_setting('c09d.lot_a_before')::jsonb->>'fingerprint','c9d40000-0000-0000-0000-000000000031')::text,true);
select is((current_setting('c09d.lot_a_release')::jsonb->>'state'),'DRAFT','B4: LOT-A alone creates a DRAFT release');
select set_config('c09d.lot_b_preview',public.preview_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000004'::uuid])::text,true);
select set_config('c09d.batch_before_blocked',(select count(*)::text from public.rp_release_batches where inventory_id='c9d20000-0000-0000-0000-000000000001'),true);
select throws_ok($$select public.create_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000004'::uuid],current_setting('c09d.lot_b_preview')::jsonb->>'fingerprint','c9d40000-0000-0000-0000-000000000032')$$,'23514','RP_RELEASE_BLOCKED','B4: LOT-B cannot create release');
select is((select count(*)::text from public.rp_release_batches where inventory_id='c9d20000-0000-0000-0000-000000000001'),current_setting('c09d.batch_before_blocked'),'B4: blocked create leaves no partial batch');
select set_config('c09d.lot_mixed_preview',public.preview_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000003'::uuid,'c9d30000-0000-0000-0000-000000000004'::uuid])::text,true);
select throws_ok($$select public.create_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000003'::uuid,'c9d30000-0000-0000-0000-000000000004'::uuid],current_setting('c09d.lot_mixed_preview')::jsonb->>'fingerprint','c9d40000-0000-0000-0000-000000000033')$$,'23514','RP_RELEASE_BLOCKED','B4: mixed LOT-A/LOT-B request is all-or-nothing');

select set_config('c09d.ser_combined_before',public.preview_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000005'::uuid,'c9d30000-0000-0000-0000-000000000006'::uuid])::text,true);
select set_config('c09d.ser_a_before',public.preview_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000005'::uuid])::text,true);
select set_config('c09d.ser_b',public.report_c1_reference_finding('c9d20000-0000-0000-0000-000000000001','SERIAL','C09-SER','SER-002','OTHER','SER-002 blocks only itself',true,'c09d-ser-b',now(),false,jsonb_build_object('note','serial-local blocker'))::text,true);
select is((public.preview_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000005'::uuid])->>'eligible_references')::integer,1,'B4: SER-001 remains eligible');
select is((public.preview_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000006'::uuid])->>'eligible_references')::integer,0,'B4: SER-002 is independently blocked');
select isnt((public.preview_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000005'::uuid,'c9d30000-0000-0000-0000-000000000006'::uuid])->>'fingerprint'),current_setting('c09d.ser_combined_before')::jsonb->>'fingerprint','B4: SER-002 material blocker changes combined fingerprint');
select is((public.preview_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000005'::uuid])->>'fingerprint'),current_setting('c09d.ser_a_before')::jsonb->>'fingerprint','B4: SER-002 does not contaminate SER-001 subset fingerprint');
select set_config('c09d.ser_a_release',public.create_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000005'::uuid],current_setting('c09d.ser_a_before')::jsonb->>'fingerprint','c9d40000-0000-0000-0000-000000000041')::text,true);
select is((current_setting('c09d.ser_a_release')::jsonb->>'state'),'DRAFT','B4: SER-001 alone creates a DRAFT release');
select set_config('c09d.ser_b_preview',public.preview_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000006'::uuid])::text,true);
select throws_ok($$select public.create_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000006'::uuid],current_setting('c09d.ser_b_preview')::jsonb->>'fingerprint','c9d40000-0000-0000-0000-000000000042')$$,'23514','RP_RELEASE_BLOCKED','B4: SER-002 cannot create release');
select set_config('c09d.ser_mixed_preview',public.preview_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000005'::uuid,'c9d30000-0000-0000-0000-000000000006'::uuid])::text,true);
select throws_ok($$select public.create_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000005'::uuid,'c9d30000-0000-0000-0000-000000000006'::uuid],current_setting('c09d.ser_mixed_preview')::jsonb->>'fingerprint','c9d40000-0000-0000-0000-000000000043')$$,'23514','RP_RELEASE_BLOCKED','B4: mixed serial request is all-or-nothing');

-- Preview is read-only. Capture the operational state only after fixtures are
-- complete, then create an eligible zero-quantity DRAFT release.
reset role;
select set_config('c09d.count_before',(select count(*)::text from public.count_records where inventory_id='c9d20000-0000-0000-0000-000000000001'),true);
select set_config('c09d.movement_before',(select count(*)::text from public.inventory_movement_events where inventory_id='c9d20000-0000-0000-0000-000000000001'),true);
select set_config('c09d.finding_before',(select count(*)::text from public.reference_findings where inventory_id='c9d20000-0000-0000-0000-000000000001'),true);
select set_config('c09d.evidence_before',(select count(*)::text from public.finding_evidence e join public.reference_findings f on f.id=e.finding_id where f.inventory_id='c9d20000-0000-0000-0000-000000000001'),true);
select set_config('c09d.recount_before',(select count(*)::text from public.recount_missions where inventory_id='c9d20000-0000-0000-0000-000000000001'),true);
select set_config('c09d.system_before',(select coalesce(string_agg(id::text||':'||quantity::text,',' order by id),'') from public.inventory_system_reference_items where inventory_id='c9d20000-0000-0000-0000-000000000001'),true);
select set_config('c09d.lifecycle_before',(select status::text||'|'||coalesce(closed_at::text,'') from public.inventories where id='c9d20000-0000-0000-0000-000000000001'),true);
select set_config('request.jwt.claim.sub','c9d10000-0000-0000-0000-000000000001',true); set local role authenticated;
select set_config('c09d.zero_again',public.preview_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000007'::uuid])::text,true);
reset role;
select is((select count(*)::text from public.count_records where inventory_id='c9d20000-0000-0000-0000-000000000001'),current_setting('c09d.count_before'),'B4: preview has no C1 mutation');
select is((select count(*)::text from public.inventory_movement_events where inventory_id='c9d20000-0000-0000-0000-000000000001'),current_setting('c09d.movement_before'),'B4: preview has no movement/ERP mutation');
select set_config('request.jwt.claim.sub','c9d10000-0000-0000-0000-000000000001',true); set local role authenticated;
select set_config('c09d.zero_release',public.create_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000007'::uuid],current_setting('c09d.zero_again')::jsonb->>'fingerprint','c9d40000-0000-0000-0000-000000000051')::text,true);
reset role;
select is((select count(*)::text from public.count_records where inventory_id='c9d20000-0000-0000-0000-000000000001'),current_setting('c09d.count_before'),'B4: successful release has no C1 mutation');
select is((select count(*)::text from public.inventory_movement_events where inventory_id='c9d20000-0000-0000-0000-000000000001'),current_setting('c09d.movement_before'),'B4: successful release has no movement/ERP mutation');
select is((select count(*)::text from public.reference_findings where inventory_id='c9d20000-0000-0000-0000-000000000001'),current_setting('c09d.finding_before'),'B4: successful release does not mutate finding decisions');
select is((select count(*)::text from public.finding_evidence e join public.reference_findings f on f.id=e.finding_id where f.inventory_id='c9d20000-0000-0000-0000-000000000001'),current_setting('c09d.evidence_before'),'B4: successful release does not mutate finding evidence');
select is((select count(*)::text from public.recount_missions where inventory_id='c9d20000-0000-0000-0000-000000000001'),current_setting('c09d.recount_before'),'B4: successful release does not mutate C2/C3 missions');
select is((select coalesce(string_agg(id::text||':'||quantity::text,',' order by id),'') from public.inventory_system_reference_items where inventory_id='c9d20000-0000-0000-0000-000000000001'),current_setting('c09d.system_before'),'B4: successful release does not mutate source stock');
select is((select status::text||'|'||coalesce(closed_at::text,'') from public.inventories where id='c9d20000-0000-0000-0000-000000000001'),current_setting('c09d.lifecycle_before'),'B4: successful release does not mutate lifecycle');
select set_config('request.jwt.claim.sub','c9d10000-0000-0000-0000-000000000001',true); set local role authenticated;
select set_config('c09d.zero_retry',public.create_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000007'::uuid],current_setting('c09d.zero_again')::jsonb->>'fingerprint','c9d40000-0000-0000-0000-000000000051')::text,true);
select is((current_setting('c09d.zero_retry')::jsonb->>'release_id'),current_setting('c09d.zero_release')::jsonb->>'release_id','B4: idempotent retry does not create another release');
select is((select count(*) from public.rp_release_audits where release_id=(current_setting('c09d.zero_release')::jsonb->>'release_id')::uuid),1::bigint,'B4: idempotent retry does not create another audit');

select set_config('c09d.stale_preview',public.preview_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000008'::uuid])::text,true);
reset role;
update public.inventory_sealed_references set physical_quantity=2 where id='c9d30000-0000-0000-0000-000000000008';
select set_config('c09d.batch_before_fail',(select count(*)::text from public.rp_release_batches where inventory_id='c9d20000-0000-0000-0000-000000000001'),true);
select set_config('c09d.audit_before_fail',(select count(*)::text from public.rp_release_audits a join public.rp_release_batches b on b.id=a.release_id where b.inventory_id='c9d20000-0000-0000-0000-000000000001'),true);
select set_config('request.jwt.claim.sub','c9d10000-0000-0000-0000-000000000001',true); set local role authenticated;
select throws_ok($$select public.create_rp_release('c9d20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9d30000-0000-0000-0000-000000000008'::uuid],current_setting('c09d.stale_preview')::jsonb->>'fingerprint','c9d40000-0000-0000-0000-000000000052')$$,'40001','PREVIEW_STALE','B4: stale create does not write a release');
reset role;
select is((select count(*)::text from public.rp_release_batches where inventory_id='c9d20000-0000-0000-0000-000000000001'),current_setting('c09d.batch_before_fail'),'B4: stale failure leaves no partial batch');
select is((select count(*)::text from public.rp_release_audits a join public.rp_release_batches b on b.id=a.release_id where b.inventory_id='c9d20000-0000-0000-0000-000000000001'),current_setting('c09d.audit_before_fail'),'B4: stale failure leaves no partial audit');

select * from finish();
rollback;
