begin;
select plan(6);

select is((select has_table_privilege('authenticated', 'public.ota_bundles', 'SELECT')), false, 'authenticated clients cannot read OTA bundles directly');
select is((select has_function_privilege('anon', 'public.assign_ota_device_channel(text,text)', 'EXECUTE')), false, 'anon cannot assign an OTA channel');
select is((select has_function_privilege('authenticated', 'public.get_live_monitor_ota_devices(integer)', 'EXECUTE')), true, 'authenticated users may call the guarded OTA monitor RPC');
select throws_ok($$insert into public.ota_channels(name) values ('production')$$, '23514', null, 'database has no production OTA channel');

insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('0a710000-0000-0000-0000-000000000001','authenticated','authenticated','ota-admin@example.invalid','','{}','{}',now(),now()),
('0a710000-0000-0000-0000-000000000002','authenticated','authenticated','ota-counter@example.invalid','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,active) values
('0a710000-0000-0000-0000-000000000001','OTA Admin','ADMIN',true),
('0a710000-0000-0000-0000-000000000002','OTA Counter','CONTADOR',true);
insert into public.ota_devices(device_id,user_id,native_version) values ('device-qa-0001','0a710000-0000-0000-0000-000000000002','1.0.0');

select set_config('request.jwt.claim.sub','0a710000-0000-0000-0000-000000000002',true); set local role authenticated;
select throws_ok($$select public.assign_ota_device_channel('device-qa-0001','qa-beta')$$, '42501', 'Only ADMIN can assign OTA channels', 'counter cannot self-assign qa-beta');
reset role;

select set_config('request.jwt.claim.sub','0a710000-0000-0000-0000-000000000001',true); set local role authenticated;
select is((select channel_name from public.assign_ota_device_channel('device-qa-0001','qa-beta')), 'qa-beta', 'ADMIN assigns the only QA OTA channel');
reset role;

select * from finish();
rollback;
