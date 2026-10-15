begin;
select plan(9);

insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('f13e0000-0000-0000-0000-000000000001','authenticated','authenticated','f13e-admin@example.invalid','','{}','{}',now(),now()),
('f13e0000-0000-0000-0000-000000000002','authenticated','authenticated','f13e-analyst@example.invalid','','{}','{}',now(),now()),
('f13e0000-0000-0000-0000-000000000003','authenticated','authenticated','f13e-counter@example.invalid','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,active) values
('f13e0000-0000-0000-0000-000000000001','F13E Admin','ADMIN',true),
('f13e0000-0000-0000-0000-000000000002','F13E Analyst','ANALISTA',true),
('f13e0000-0000-0000-0000-000000000003','F13E Counter','CONTADOR',true);
insert into public.inventories(id,name,created_by) values('f13e0000-0000-0000-0000-000000000010','F13E missing batch','f13e0000-0000-0000-0000-000000000001');
insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values
('f13e0000-0000-0000-0000-000000000010','f13e0000-0000-0000-0000-000000000002','f13e0000-0000-0000-0000-000000000001'),
('f13e0000-0000-0000-0000-000000000010','f13e0000-0000-0000-0000-000000000003','f13e0000-0000-0000-0000-000000000001');
insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by) values
('f13e0000-0000-0000-0000-000000000010','F13EBATP','F13E batch item','PARTIDA','TEST','f13e0000-0000-0000-0000-000000000001');

select is(has_function_privilege('anon','public.authorize_missing_batch_exceptions(uuid,text[],text)','execute'),false,'anon cannot authorize missing batch exceptions');
select is(has_function_privilege('authenticated','public.authorize_missing_batch_exceptions(uuid,text[],text)','execute'),true,'authenticated reaches the guarded authorization function');

select set_config('request.jwt.claim.sub','f13e0000-0000-0000-0000-000000000002',true); set local role authenticated;
select throws_ok($$select * from public.authorize_missing_batch_exceptions('f13e0000-0000-0000-0000-000000000010',array['F13EBATP'],'Softland source omission')$$,'42501','Only ADMIN can authorize missing batch exceptions','analyst cannot authorize the controlled exception');
reset role;

select set_config('request.jwt.claim.sub','f13e0000-0000-0000-0000-000000000001',true); set local role authenticated;
select throws_ok($$select * from public.import_inventory_system_reference('f13e0000-0000-0000-0000-000000000010','[{"codigo":"F13EBATP","reference_value":"EXC-SIN-PARTIDA:F13EBATP","quantity":5,"available_quantity":5,"unit_code":"UNI"}]','F13E','before-authorization')$$,'42501','Missing batch exception is not authorized','pseudo batch cannot be imported before ADMIN authorization');
select is((select placeholder from public.authorize_missing_batch_exceptions('f13e0000-0000-0000-0000-000000000010',array['F13EBATP'],'Softland source omission')),'EXC-SIN-PARTIDA:F13EBATP','authorization returns the explicit non-Softland placeholder');
select is((select count(*) from public.audit_events where inventory_id='f13e0000-0000-0000-0000-000000000010' and event_type='MISSING_BATCH_EXCEPTION_AUTHORIZED' and actor_user_id='f13e0000-0000-0000-0000-000000000001'),1::bigint,'authorization is auditable with the ADMIN actor');
select * from public.import_inventory_system_reference('f13e0000-0000-0000-0000-000000000010','[{"codigo":"F13EBATP","reference_value":"EXC-SIN-PARTIDA:F13EBATP","quantity":5,"available_quantity":5,"unit_code":"UNI"}]','F13E','after-authorization');
select is((select reference_value from public.inventory_system_reference_items where inventory_id='f13e0000-0000-0000-0000-000000000010' and codigo='F13EBATP'),'EXC-SIN-PARTIDA:F13EBATP','authorized exception is persisted as explicit evidence, never as a real batch');
reset role;

select set_config('request.jwt.claim.sub','f13e0000-0000-0000-0000-000000000003',true); set local role authenticated;
select is((select count(*) from public.inventory_missing_batch_exceptions where inventory_id='f13e0000-0000-0000-0000-000000000010'),0::bigint,'counter cannot read exception records through RLS');
reset role;

select ok((select relrowsecurity from pg_class where oid='public.inventory_missing_batch_exceptions'::regclass),'exception evidence table has RLS enabled');
select * from finish();
rollback;
