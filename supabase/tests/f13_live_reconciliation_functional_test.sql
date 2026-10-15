begin;
select plan(9);

insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('f1300000-0000-0000-0000-000000000001','authenticated','authenticated','f13-admin@example.invalid','','{}','{}',now(),now()),
('f1300000-0000-0000-0000-000000000002','authenticated','authenticated','f13-counter@example.invalid','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,active) values
('f1300000-0000-0000-0000-000000000001','F13 Admin','ADMIN',true),
('f1300000-0000-0000-0000-000000000002','F13 Counter','CONTADOR',true);
insert into public.inventories(id,name,created_by) values('f1300000-0000-0000-0000-000000000010','F13 Available baseline','f1300000-0000-0000-0000-000000000001');
insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values
('f1300000-0000-0000-0000-000000000010','f1300000-0000-0000-0000-000000000002','f1300000-0000-0000-0000-000000000001');
insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by) values
('f1300000-0000-0000-0000-000000000010','F13LEG','Legacy available item','LEGACY','TEST','f1300000-0000-0000-0000-000000000001'),
('f1300000-0000-0000-0000-000000000010','F13BATP','Batch available item','PARTIDA','TEST','f1300000-0000-0000-0000-000000000001');

select set_config('request.jwt.claim.sub','f1300000-0000-0000-0000-000000000001',true); set local role authenticated;
select * from public.import_inventory_system_reference('f1300000-0000-0000-0000-000000000010',
'[{"codigo":"F13LEG","quantity":31,"available_quantity":11,"unit_code":"UNI"},{"codigo":"F13BATP","reference_value":"LOT-01","quantity":25,"available_quantity":0,"unit_code":"UNI","expiration_date":"2027-12-31"}]','F13','F13-AVAILABLE');
select public.prepare_inventory('f1300000-0000-0000-0000-000000000010'); select public.open_inventory('f1300000-0000-0000-0000-000000000010'); reset role;

select set_config('request.jwt.claim.sub','f1300000-0000-0000-0000-000000000002',true); set local role authenticated;
select * from public.sync_counts('f1300000-0000-0000-0000-000000000010','f1300000-0000-0000-0000-000000000020','WEB','1.0.0','F13',
'[{"client_count_id":"f1300000-0000-0000-0000-000000000031","ubicacion":"A-01-01","codigo":"F13LEG","cantidad_contada":11,"captured_at":"2026-10-02T12:00:00Z"},{"client_count_id":"f1300000-0000-0000-0000-000000000032","ubicacion":"A-02-01","codigo":"F13BATP","partida":"LOT-01","fecha_vencimiento":"2027-12-31","cantidad_contada":7,"captured_at":"2026-10-02T12:01:00Z"}]');
reset role;

select set_config('request.jwt.claim.sub','f1300000-0000-0000-0000-000000000001',true); set local role authenticated;
select is((public.get_live_reconciliation_workspace('f1300000-0000-0000-0000-000000000010')->'metrics'->>'available_units')::integer,11,'only Disponible is summed as the live baseline');
select is((public.get_live_reconciliation_workspace('f1300000-0000-0000-0000-000000000010')->'metrics'->>'counted_units')::integer,18,'physical units are visible in the live workspace');
select is((public.get_live_reconciliation_workspace('f1300000-0000-0000-0000-000000000010')->'metrics'->>'difference_units')::integer,7,'only the available baseline produces the operational difference');
select is((select source_total_quantity from public.inventory_system_reference_items where inventory_id='f1300000-0000-0000-0000-000000000010' and codigo='F13LEG'),31,'source Stock Total stays as evidence');
select is((select quantity from public.inventory_system_reference_items where inventory_id='f1300000-0000-0000-0000-000000000010' and codigo='F13LEG'),11,'persisted baseline is Disponible');
select is((select item->>'expiration_date' from jsonb_array_elements(public.get_live_reconciliation_workspace('f1300000-0000-0000-0000-000000000010')->'rows') item where item->>'codigo'='F13BATP'),'2027-12-31','batch expiration is available to the live workspace');
select is((select item->>'status' from jsonb_array_elements(public.get_live_reconciliation_workspace('f1300000-0000-0000-0000-000000000010')->'rows') item where item->>'codigo'='F13LEG'),'CUADRADO','available baseline marks matching legacy item as squared');
select is((select item->>'status' from jsonb_array_elements(public.get_live_reconciliation_workspace('f1300000-0000-0000-0000-000000000010')->'rows') item where item->>'codigo'='F13BATP'),'FUERA_DE_DISPONIBLE','known transitory/reserved source reference is never labelled as a new lot');
reset role;

select set_config('request.jwt.claim.sub','f1300000-0000-0000-0000-000000000002',true); set local role authenticated;
select throws_ok($$select public.get_live_reconciliation_workspace('f1300000-0000-0000-0000-000000000010')$$,'42501','Not authorized for live reconciliation','counter cannot read live reconciliation quantities');
reset role;

select * from finish();
rollback;
