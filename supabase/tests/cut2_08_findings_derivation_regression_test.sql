begin;
select plan(8);

insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('c8010000-0000-0000-0000-000000000001','authenticated','authenticated','c08-owner@example.test','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,user_type,active)
values ('c8010000-0000-0000-0000-000000000001','C08 owner','ADMIN','PERMANENT',true);
insert into public.inventories(id,name,status,created_by,prepared_at,prepared_by,opened_at,opened_by,c1_completed_at,c1_completed_by,c1_count_records,c1_counted_units,c1_master_fingerprint,c1_reference_fingerprint)
values ('c8020000-0000-0000-0000-000000000001','C08 derivation','ABIERTO','c8010000-0000-0000-0000-000000000001',now(),'c8010000-0000-0000-0000-000000000001',now(),'c8010000-0000-0000-0000-000000000001',now(),'c8010000-0000-0000-0000-000000000001',0,0,repeat('a',64),repeat('b',64));

insert into public.reference_findings(inventory_id,warehouse_id,reference_type,normalized_reference_key,finding_type,critical,description,created_by)
values ('c8020000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','LEGACY','C08-LEGACY','PHYSICAL_MISMATCH',true,'legacy critical without sealed reference','c8010000-0000-0000-0000-000000000001');

select is((select source_stage::text from public.reference_findings where normalized_reference_key='C08-LEGACY'),'PRE_SEAL','legacy critical without sealed reference derives PRE_SEAL');
select is((select severity::text from public.reference_findings where normalized_reference_key='C08-LEGACY'),'CRITICAL','legacy critical derives CRITICAL rather than MEDIUM');
select ok((select blocks_seal from public.reference_findings where normalized_reference_key='C08-LEGACY'),'legacy critical pre-seal finding blocks sealing');
select isnt((select source_stage::text from public.reference_findings where normalized_reference_key='C08-LEGACY'),'MANUAL_REVIEW','legacy critical never remains ambiguous MANUAL_REVIEW');
select is((select count(*) from public.reference_finding_events where finding_id=(select id from public.reference_findings where normalized_reference_key='C08-LEGACY') and event_type='REPORTED'),1::bigint,'canonical reported audit is exactly once');

insert into public.reference_findings(inventory_id,warehouse_id,reference_type,normalized_reference_key,finding_type,critical,description,created_by)
values ('c8020000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','LEGACY','C08-NORMAL','NEW_LOCATION_FOUND',false,'normal legacy finding','c8010000-0000-0000-0000-000000000001');
select is((select source_stage::text from public.reference_findings where normalized_reference_key='C08-NORMAL'),'PRE_SEAL','normal no-seal finding derives PRE_SEAL');
select is((select severity::text from public.reference_findings where normalized_reference_key='C08-NORMAL'),'MEDIUM','normal no-seal finding retains default MEDIUM severity');
select ok(not (select blocks_seal from public.reference_findings where normalized_reference_key='C08-NORMAL'),'noncritical pre-seal finding does not block sealing');

select * from finish();
rollback;
