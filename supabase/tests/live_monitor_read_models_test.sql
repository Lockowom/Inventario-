begin;
select plan(13);

select is((select has_function_privilege('anon', 'public.get_live_monitor_summary(uuid)', 'EXECUTE')), false, 'anon cannot read the live monitor summary');
select is((select has_function_privilege('authenticated', 'public.get_live_monitor_summary(uuid)', 'EXECUTE')), true, 'authenticated may invoke the guarded summary RPC');
select is((select has_function_privilege('anon', 'public.get_live_monitor_coverage(uuid,text,text,integer,integer)', 'EXECUTE')), false, 'anon cannot read live coverage');

insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('a6100000-0000-0000-0000-000000000001','authenticated','authenticated','monitor-admin@example.invalid','','{}','{}',now(),now()),
('a6100000-0000-0000-0000-000000000002','authenticated','authenticated','monitor-counter@example.invalid','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,active) values
('a6100000-0000-0000-0000-000000000001','Monitor Admin','ADMIN',true),
('a6100000-0000-0000-0000-000000000002','Monitor Counter','CONTADOR',true);
insert into public.inventories(id,name,created_by) values
('a6200000-0000-0000-0000-000000000001','LIVE MONITOR TEST','a6100000-0000-0000-0000-000000000001');
insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values
('a6200000-0000-0000-0000-000000000001','a6100000-0000-0000-0000-000000000002','a6100000-0000-0000-0000-000000000001');
insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by) values
('a6200000-0000-0000-0000-000000000001','LIV001S','Serie disponible','SERIAL','TEST','a6100000-0000-0000-0000-000000000001'),
('a6200000-0000-0000-0000-000000000001','LIV002P','Partida disponible','PARTIDA','TEST','a6100000-0000-0000-0000-000000000001');
insert into public.inventory_master_metadata(inventory_id,master_version,row_count,fingerprint)
select 'a6200000-0000-0000-0000-000000000001'::uuid,1,count(*)::integer,
  app_private.master_fingerprint('a6200000-0000-0000-0000-000000000001'::uuid)
from public.inventory_master_items
where inventory_id='a6200000-0000-0000-0000-000000000001'::uuid;

select set_config('request.jwt.claim.sub','a6100000-0000-0000-0000-000000000001',true); set local role authenticated;
select * from public.import_inventory_system_reference('a6200000-0000-0000-0000-000000000001',
'[
 {"codigo":"LIV001S","reference_value":"SER-OK","quantity":1,"available_quantity":1},
 {"codigo":"LIV001S","reference_value":"SER-OUT","quantity":1,"available_quantity":0},
 {"codigo":"LIV002P","reference_value":"LOT-MISSING","quantity":2,"available_quantity":2}
]','TEST','LIVE-MONITOR');
select public.prepare_inventory('a6200000-0000-0000-0000-000000000001');
select public.open_inventory('a6200000-0000-0000-0000-000000000001');
reset role;

select set_config('request.jwt.claim.sub','a6100000-0000-0000-0000-000000000002',true); set local role authenticated;
select * from public.sync_counts('a6200000-0000-0000-0000-000000000001','a6300000-0000-0000-0000-000000000002','WEB','1.0.0','LIVE',
'[
 {"client_count_id":"a6400000-0000-0000-0000-000000000001","ubicacion":"A-01-01","codigo":"LIV001S","serie":"SER-OK","cantidad_contada":1,"captured_at":"2026-10-06T10:00:00Z"},
 {"client_count_id":"a6400000-0000-0000-0000-000000000002","ubicacion":"A-01-02","codigo":"LIV001S","serie":"SER-OUT","cantidad_contada":1,"captured_at":"2026-10-06T10:01:00Z"}
]');
select throws_ok(
  $$ select public.get_live_monitor_summary('a6200000-0000-0000-0000-000000000001') $$,
  '42501', 'Not authorized for live monitor', 'counter cannot read the monitor'
);
reset role;

select set_config('request.jwt.claim.sub','a6100000-0000-0000-0000-000000000001',true); set local role authenticated;
select is((select coverage_status from public.get_live_monitor_coverage('a6200000-0000-0000-0000-000000000001','TODOS',null,100,0) where reference_value='SER-OK'),'CUBIERTA','available serial counted in C1 is covered');
select is((select coverage_status from public.get_live_monitor_coverage('a6200000-0000-0000-0000-000000000001','TODOS',null,100,0) where reference_value='SER-OUT'),'SERIE_FUERA_DE_DISPONIBLE','counting a serial outside Disponible is visible without changing stock');
select is((select coverage_status from public.get_live_monitor_coverage('a6200000-0000-0000-0000-000000000001','TODOS',null,100,0) where reference_value='LOT-MISSING'),'PENDIENTE_DE_COBERTURA','unvisited Softland batch is pending while C1 is open');
select is(((public.get_live_monitor_summary('a6200000-0000-0000-0000-000000000001')->'counts'->>'observations')::integer),2,'summary exposes accepted count observations');
select is(((public.get_live_monitor_summary('a6200000-0000-0000-0000-000000000001')->'reference'->>'available_units')::bigint),3::bigint,'summary uses Disponible rather than source total');
select is((select stage from public.get_live_monitor_activity('a6200000-0000-0000-0000-000000000001',10,null,null,'C1','SER-OK') limit 1),'C1','activity stream labels accepted first-count evidence as C1');
select is((public.finalize_c1_coverage('a6200000-0000-0000-0000-000000000001'::uuid,true)->>'c1_status'),'COMPLETADO','manager can close C1 after reading the live monitor');
select is((select coverage_status from public.get_live_monitor_coverage('a6200000-0000-0000-0000-000000000001','TODOS',null,100,0) where reference_value='LOT-MISSING'),'PARTIDA_SISTEMA_NO_CONTADA','the same missing batch becomes an actionable absence after C1 closes');
select is((select round from public.get_live_monitor_missions('a6200000-0000-0000-0000-000000000001',100) where reference_value='LOT-MISSING'),2::smallint,'C2 monitor rows come from the real F15 mission queue');
reset role;

select * from finish();
rollback;
