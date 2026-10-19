begin;
select plan(21);

insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('c9b10000-0000-0000-0000-000000000001','authenticated','authenticated','c09-b3@example.test','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,user_type,active)
values ('c9b10000-0000-0000-0000-000000000001','C09 B3 analyst','ANALISTA','PERMANENT',true);
insert into public.warehouses(id,code,name,timezone,operational_hours_id)
select 'c9b20000-0000-0000-0000-000000000002','C09-B','C09 warehouse B','America/Santiago',operational_hours_id from public.warehouses where id='00000000-0000-0000-0000-00000000c202';
insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by) values
 ('c9b20000-0000-0000-0000-000000000001','C09 B3 A','ABIERTO','00000000-0000-0000-0000-00000000c202','c9b10000-0000-0000-0000-000000000001',now(),'c9b10000-0000-0000-0000-000000000001',now(),'c9b10000-0000-0000-0000-000000000001'),
 ('c9b20000-0000-0000-0000-000000000002','C09 B3 B','ABIERTO','c9b20000-0000-0000-0000-000000000002','c9b10000-0000-0000-0000-000000000001',now(),'c9b10000-0000-0000-0000-000000000001',now(),'c9b10000-0000-0000-0000-000000000001');
insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values ('c9b20000-0000-0000-0000-000000000001','c9b10000-0000-0000-0000-000000000001','c9b10000-0000-0000-0000-000000000001');
insert into public.inventory_sealed_references(id,inventory_id,warehouse_id,reference_type,codigo,normalized_reference_key,state,request_id,physical_quantity,sealed_at,sealed_by) values
 ('c9b30000-0000-0000-0000-000000000001','c9b20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','LEGACY','C09-A',public.normalize_reference_key('LEGACY','C09-A',null),'SEALED','c9b40000-0000-0000-0000-000000000001',9,now(),'c9b10000-0000-0000-0000-000000000001'),
 ('c9b30000-0000-0000-0000-000000000002','c9b20000-0000-0000-0000-000000000002','c9b20000-0000-0000-0000-000000000002','LEGACY','C09-B',public.normalize_reference_key('LEGACY','C09-B',null),'SEALED','c9b40000-0000-0000-0000-000000000002',9,now(),'c9b10000-0000-0000-0000-000000000001'),
 ('c9b30000-0000-0000-0000-000000000003','c9b20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','LEGACY','C09-UNSEALED',public.normalize_reference_key('LEGACY','C09-UNSEALED',null),'SEALING','c9b40000-0000-0000-0000-000000000003',9,null,null);

select set_config('request.jwt.claim.sub','c9b10000-0000-0000-0000-000000000001',true);
set local role authenticated;
select set_config('c09b.preview',public.preview_rp_release('c9b20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9b30000-0000-0000-0000-000000000001'::uuid])::text,true);
select is((current_setting('c09b.preview')::jsonb->>'eligible_references')::integer,1,'B3: scoped sealed reference is eligible');
select throws_ok($$select public.preview_rp_release('c9b20000-0000-0000-0000-000000000002','c9b20000-0000-0000-0000-000000000002',array['c9b30000-0000-0000-0000-000000000002'::uuid])$$,'42501','CAPABILITY_REQUIRED','B3: foreign inventory and warehouse preview is denied');
select throws_ok($$select public.create_rp_release('c9b20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9b30000-0000-0000-0000-000000000001'::uuid,'c9b30000-0000-0000-0000-000000000002'::uuid],current_setting('c09b.preview')::jsonb->>'fingerprint','c9b40000-0000-0000-0000-000000000004')$$,'42501','REFERENCE_SCOPE_INVALID','B3: foreign reference injection is denied before snapshot');
select throws_ok($$select public.create_rp_release('c9b20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9b30000-0000-0000-0000-000000000003'::uuid],current_setting('c09b.preview')::jsonb->>'fingerprint','c9b40000-0000-0000-0000-000000000005')$$,'42501','REFERENCE_SCOPE_INVALID','B3: unsealed reference injection is denied');
select is((select count(*) from public.rp_release_batches where inventory_id='c9b20000-0000-0000-0000-000000000001'),0::bigint,'B3: injection attempts have no partial batch');
reset role;
select set_config('c09b.count_before',(select count(*)::text from public.count_records where inventory_id='c9b20000-0000-0000-0000-000000000001'),true);
select set_config('c09b.recount_before',(select count(*)::text from public.recount_missions where inventory_id='c9b20000-0000-0000-0000-000000000001'),true);
select set_config('c09b.ref_before',(select string_agg(id::text||':'||physical_quantity::text,',' order by id) from public.inventory_sealed_references where inventory_id='c9b20000-0000-0000-0000-000000000001'),true);
select set_config('request.jwt.claim.sub','c9b10000-0000-0000-0000-000000000001',true); set local role authenticated;
select set_config('c09b.release',public.create_rp_release('c9b20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9b30000-0000-0000-0000-000000000001'::uuid],current_setting('c09b.preview')::jsonb->>'fingerprint','c9b40000-0000-0000-0000-000000000006')::text,true);
reset role;
select is((select count(*)::text from public.count_records where inventory_id='c9b20000-0000-0000-0000-000000000001'),current_setting('c09b.count_before'),'B3: successful release does not write C1/count records');
select is((select count(*)::text from public.recount_missions where inventory_id='c9b20000-0000-0000-0000-000000000001'),current_setting('c09b.recount_before'),'B3: successful release does not write C2/C3');
select is((select string_agg(id::text||':'||physical_quantity::text,',' order by id) from public.inventory_sealed_references where inventory_id='c9b20000-0000-0000-0000-000000000001'),current_setting('c09b.ref_before'),'B3: successful release does not mutate sealed references');
select is((select count(*) from public.rp_release_batches where inventory_id='c9b20000-0000-0000-0000-000000000001'),1::bigint,'B3: success writes only one release batch');
select is((select count(*) from public.rp_release_audits where inventory_id='c9b20000-0000-0000-0000-000000000001'),1::bigint,'B3: success writes only one release audit');
select set_config('request.jwt.claim.sub','c9b10000-0000-0000-0000-000000000001',true); set local role authenticated;
select throws_ok($$update public.rp_release_batches set policy_snapshot='{}'::jsonb where id=(current_setting('c09b.release')::jsonb->>'release_id')::uuid$$,'42501',null,'B3: authenticated caller cannot mutate batch snapshot directly');
select throws_ok($$update public.rp_release_audits set references_snapshot='[]'::jsonb where release_id=(current_setting('c09b.release')::jsonb->>'release_id')::uuid$$,'42501',null,'B3: authenticated caller cannot mutate audit snapshot directly');
reset role;

insert into public.uom_resolution_cases(id,inventory_id,warehouse_id,reference_id,source_uom,target_uom,state,created_by)
values ('c9b50000-0000-0000-0000-000000000001','c9b20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','c9b30000-0000-0000-0000-000000000001','CAJA','UN','OPEN','c9b10000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','c9b10000-0000-0000-0000-000000000001',true); set local role authenticated;
select set_config('c09b.uom_preview',public.preview_rp_release('c9b20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9b30000-0000-0000-0000-000000000001'::uuid])::text,true);
select ok((select item->'blocker_codes' ? 'UOM_CONFLICT' from jsonb_array_elements(current_setting('c09b.uom_preview')::jsonb->'items') item),'B3: open UOM case blocks the canonical identity');
select throws_ok($$select public.create_rp_release('c9b20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9b30000-0000-0000-0000-000000000001'::uuid],current_setting('c09b.uom_preview')::jsonb->>'fingerprint','c9b40000-0000-0000-0000-000000000007')$$,'23514','RP_RELEASE_BLOCKED','B3: writer rejects UOM blocker');
reset role;
delete from public.uom_resolution_cases where id='c9b50000-0000-0000-0000-000000000001';
insert into public.orphan_references(id,inventory_id,warehouse_id,codigo,reference_type,normalized_reference_key,state,block_rp,created_by)
values ('c9b60000-0000-0000-0000-000000000001','c9b20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','C09-A','LEGACY',public.normalize_reference_key('LEGACY','C09-A',null),'OPEN',true,'c9b10000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','c9b10000-0000-0000-0000-000000000001',true); set local role authenticated;
select set_config('c09b.orphan_preview',public.preview_rp_release('c9b20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9b30000-0000-0000-0000-000000000001'::uuid])::text,true);
select ok((select item->'blocker_codes' ? 'ORPHAN_REFERENCE' from jsonb_array_elements(current_setting('c09b.orphan_preview')::jsonb->'items') item),'B3: open local orphan blocks RP');
select throws_ok($$select public.create_rp_release('c9b20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9b30000-0000-0000-0000-000000000001'::uuid],current_setting('c09b.orphan_preview')::jsonb->>'fingerprint','c9b40000-0000-0000-0000-000000000008')$$,'23514','RP_RELEASE_BLOCKED','B3: writer rejects local orphan');
reset role;
update public.orphan_references set state='RESOLVED',resolved_by='c9b10000-0000-0000-0000-000000000001',resolved_at=now() where id='c9b60000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','c9b10000-0000-0000-0000-000000000001',true); set local role authenticated;
select is((public.preview_rp_release('c9b20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9b30000-0000-0000-0000-000000000001'::uuid])->>'eligible_references')::integer,1,'B3: resolved orphan no longer blocks RP');
reset role;
insert into public.reference_findings(inventory_id,warehouse_id,reference_id,reference_type,normalized_reference_key,finding_type,state,critical,description,severity,source_stage,created_by)
values ('c9b20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','c9b30000-0000-0000-0000-000000000001','LEGACY',public.normalize_reference_key('LEGACY','C09-A',null),'AUTHORIZATION_REVOKED_OFFLINE','OPEN',true,'Revoked offline evidence requires review','CRITICAL','OFFLINE_LATE_COUNT','c9b10000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','c9b10000-0000-0000-0000-000000000001',true); set local role authenticated;
select set_config('c09b.review_preview',public.preview_rp_release('c9b20000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9b30000-0000-0000-0000-000000000001'::uuid])::text,true);
select ok((select item->'blocker_codes' ? 'UNRESOLVED_REVIEW' from jsonb_array_elements(current_setting('c09b.review_preview')::jsonb->'items') item),'B3: unresolved authorization-revoked offline review blocks RP');
select is((current_setting('c09b.review_preview')::jsonb->>'eligible_references')::integer,0,'B3: review blocker makes the identity ineligible');
reset role;
select is(has_function_privilege('anon','public.preview_rp_release(uuid,uuid,uuid[])','EXECUTE'),false,'B3: anon cannot preview');
select is(has_function_privilege('anon','public.create_rp_release(uuid,uuid,uuid[],text,uuid)','EXECUTE'),false,'B3: anon cannot create');

select * from finish();
rollback;
