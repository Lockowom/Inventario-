begin;
select plan(5);

insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('f13d0000-0000-0000-0000-000000000001','authenticated','authenticated','f13-signed-admin@example.invalid','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,active) values
('f13d0000-0000-0000-0000-000000000001','F13 Signed Admin','ADMIN',true);
insert into public.inventories(id,name,created_by) values
('f13d0000-0000-0000-0000-000000000010','F13 signed evidence','f13d0000-0000-0000-0000-000000000001');
insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by) values
('f13d0000-0000-0000-0000-000000000010','F13DBATP','Negative batch evidence','PARTIDA','TEST','f13d0000-0000-0000-0000-000000000001');

select set_config('request.jwt.claim.sub','f13d0000-0000-0000-0000-000000000001',true); set local role authenticated;
select lives_ok($$select * from public.import_inventory_system_reference('f13d0000-0000-0000-0000-000000000010','[{"codigo":"F13DBATP","reference_value":"LOT-NEG","quantity":-1,"available_quantity":-1,"unit_code":"UNI"}]','F13 signed','negative-evidence')$$,'negative Softland evidence is importable');
select is((select source_total_quantity from public.inventory_system_reference_items where inventory_id='f13d0000-0000-0000-0000-000000000010'),-1,'signed Stock Total is retained');
select is((select source_available_quantity from public.inventory_system_reference_items where inventory_id='f13d0000-0000-0000-0000-000000000010'),-1,'signed Disponible is retained');
select is((select quantity from public.inventory_system_reference_items where inventory_id='f13d0000-0000-0000-0000-000000000010'),0,'physical baseline is clamped to zero');
select is((select payload->>'baseline' from public.audit_events where inventory_id='f13d0000-0000-0000-0000-000000000010' order by created_at desc limit 1),'DISPONIBLE_NO_NEGATIVO_SERIAL_PRESENCE','audit describes the non-negative serial-presence baseline');
reset role;

select * from finish();
rollback;
