begin;
select plan(8);

insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('cb510000-0000-0000-0000-000000000001','authenticated','authenticated','c10scope-owner@example.test','','{}','{}',now(),now()),
 ('cb510000-0000-0000-0000-000000000002','authenticated','authenticated','c10scope-counter@example.test','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,user_type,active) values
 ('cb510000-0000-0000-0000-000000000001','C10 scope analyst','ANALISTA','PERMANENT',true),
 ('cb510000-0000-0000-0000-000000000002','C10 scope counter','CONTADOR','PERMANENT',true);
insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by,c1_completed_at,c1_completed_by,c1_count_records,c1_counted_units,c1_master_fingerprint,c1_reference_fingerprint) values
 ('cb520000-0000-0000-0000-000000000001','C10 scope allowed','ABIERTO','00000000-0000-0000-0000-00000000c202','cb510000-0000-0000-0000-000000000001',now(),'cb510000-0000-0000-0000-000000000001',now(),'cb510000-0000-0000-0000-000000000001',now(),'cb510000-0000-0000-0000-000000000001',0,0,'scope-a','scope-a'),
 ('cb520000-0000-0000-0000-000000000002','C10 scope foreign','ABIERTO','00000000-0000-0000-0000-00000000c202','cb510000-0000-0000-0000-000000000001',now(),'cb510000-0000-0000-0000-000000000001',now(),'cb510000-0000-0000-0000-000000000001',now(),'cb510000-0000-0000-0000-000000000001',0,0,'scope-b','scope-b');
insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values
 ('cb520000-0000-0000-0000-000000000001','cb510000-0000-0000-0000-000000000001','cb510000-0000-0000-0000-000000000001'),
 ('cb520000-0000-0000-0000-000000000001','cb510000-0000-0000-0000-000000000002','cb510000-0000-0000-0000-000000000001');

select set_config('request.jwt.claim.sub','cb510000-0000-0000-0000-000000000001',true); set local role authenticated;
select ok((public.preview_inventory_close('cb520000-0000-0000-0000-000000000001')->>'is_ready')::boolean,'B4: scoped analyst can preview assigned inventory');
select throws_ok($$select public.preview_inventory_close('cb520000-0000-0000-0000-000000000002')$$,'42501','CAPABILITY_REQUIRED','B4: foreign inventory preview is denied without leaking readiness');
select throws_ok($$select public.close_inventory_final('cb520000-0000-0000-0000-000000000002',repeat('0',64),'cb530000-0000-0000-0000-000000000001')$$,'42501','CAPABILITY_REQUIRED','B4: foreign inventory close is denied before state disclosure');
reset role;

select set_config('request.jwt.claim.sub','cb510000-0000-0000-0000-000000000002',true); set local role authenticated;
select throws_ok($$select public.preview_inventory_close('cb520000-0000-0000-0000-000000000001')$$,'42501','CAPABILITY_REQUIRED','B4: assigned actor without CLOSE_INVENTORY is denied');
reset role;

update public.profiles set active=false where user_id='cb510000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','cb510000-0000-0000-0000-000000000001',true); set local role authenticated;
select throws_ok($$select public.preview_inventory_close('cb520000-0000-0000-0000-000000000001')$$,'42501','Active authentication is required','B4: inactive actor cannot preview');
select throws_ok($$select public.close_inventory_final('cb520000-0000-0000-0000-000000000001',repeat('0',64),'cb530000-0000-0000-0000-000000000002')$$,'42501','Active authentication is required','B4: inactive actor cannot close');
reset role;

select is((select status::text from public.inventories where id='cb520000-0000-0000-0000-000000000002'),'ABIERTO','B4: foreign attempts do not mutate lifecycle');
select is((select count(*) from public.audit_events where inventory_id='cb520000-0000-0000-0000-000000000002' and event_type='INVENTORY_CLOSED'),0::bigint,'B4: foreign attempts do not create audit');

select * from finish();
rollback;
