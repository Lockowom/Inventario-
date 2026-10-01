begin;
select plan(4);
-- F11 adversarial recount tests use the production ingestion path.
insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('91000000-0000-0000-0000-000000000001','authenticated','authenticated','f11-admin@example.invalid','','{}','{}',now(),now()),
('91000000-0000-0000-0000-000000000002','authenticated','authenticated','f11-analyst@example.invalid','','{}','{}',now(),now()),
('91000000-0000-0000-0000-000000000003','authenticated','authenticated','f11-c1@example.invalid','','{}','{}',now(),now()),
('91000000-0000-0000-0000-000000000004','authenticated','authenticated','f11-c2@example.invalid','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,active) values
('91000000-0000-0000-0000-000000000001','F11 Admin','ADMIN',true),
('91000000-0000-0000-0000-000000000002','F11 Analyst','ANALISTA',true),
('91000000-0000-0000-0000-000000000003','F11 C1','CONTADOR',true),
('91000000-0000-0000-0000-000000000004','F11 C2','CONTADOR',true);
insert into public.inventories(id,name,created_by) values('92000000-0000-0000-0000-000000000001','F11 ADVERSARIAL','91000000-0000-0000-0000-000000000001');
insert into public.inventory_assignments(inventory_id,user_id,assigned_by) select '92000000-0000-0000-0000-000000000001',user_id,'91000000-0000-0000-0000-000000000001' from public.profiles where user_id::text like '91000000-%' and user_id<>'91000000-0000-0000-0000-000000000001';
insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by) values('92000000-0000-0000-0000-000000000001','SER-F11','Serial F11','SERIAL','TEST','91000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000001',true); set local role authenticated;
select public.prepare_inventory('92000000-0000-0000-0000-000000000001'); select public.open_inventory('92000000-0000-0000-0000-000000000001'); reset role;
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000003',true); set local role authenticated;
select public.register_sync_device('93000000-0000-0000-0000-000000000003','WEB','1.0.0','F11 C1');
select * from public.sync_counts('92000000-0000-0000-0000-000000000001','93000000-0000-0000-0000-000000000003','WEB','1.0.0','F11 C1','[{"client_count_id":"94000000-0000-0000-0000-000000000003","ubicacion":"A-01-01","codigo":"SER-F11","serie":"000SERIE","cantidad_contada":1,"captured_at":"2026-10-01T10:00:00Z"}]');
reset role;
insert into public.reconciliation_cases(inventory_id,codigo,reference_type,reference_value,anomaly_type,system_quantity,physical_quantity,first_count_record_id,created_by)
select '92000000-0000-0000-0000-000000000001','SER-F11','SERIAL','000SERIE','SERIE_FISICA_NO_EN_SISTEMA',0,1,id,'91000000-0000-0000-0000-000000000002' from public.count_records where client_count_id='94000000-0000-0000-0000-000000000003';

select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000002',true); set local role authenticated;
select throws_ok(format('select public.assign_second_recount(%L,%L)',(select id from public.reconciliation_cases where inventory_id='92000000-0000-0000-0000-000000000001'),'91000000-0000-0000-0000-000000000003'), '23514','Invalid second counter','C1 cannot be assigned as C2');
select lives_ok(format('select public.assign_second_recount(%L,%L)',(select id from public.reconciliation_cases where inventory_id='92000000-0000-0000-0000-000000000001'),'91000000-0000-0000-0000-000000000004'),'different assigned counter may become C2');
reset role;
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000003',true); set local role authenticated;
select is((select count(*) from public.reconciliation_cases where inventory_id='92000000-0000-0000-0000-000000000001'),0::bigint,'C1 has no direct reconciliation row visibility');
reset role;
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000004',true); set local role authenticated;
select is((select count(*) from public.reconciliation_cases where inventory_id='92000000-0000-0000-0000-000000000001'),0::bigint,'C2 remains blind through table RLS');
reset role;
select * from finish(); rollback;
