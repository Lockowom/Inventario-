begin;
select plan(11);

insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('30000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin.test@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('30000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'analyst.test@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('30000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'counter.test@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('30000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'other.test@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles (user_id, display_name, role) values
  ('30000000-0000-0000-0000-000000000001', 'Admin', 'ADMIN'),
  ('30000000-0000-0000-0000-000000000002', 'Analista', 'ANALISTA'),
  ('30000000-0000-0000-0000-000000000003', 'Contador', 'CONTADOR'),
  ('30000000-0000-0000-0000-000000000004', 'Otro', 'CONTADOR');
insert into public.inventories (id, name, created_by) values ('40000000-0000-0000-0000-000000000001', 'TEST_RLS', '30000000-0000-0000-0000-000000000001');
insert into public.inventory_assignments (inventory_id, user_id, assigned_by) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001');
insert into public.sync_devices (id, user_id, platform, app_version, device_label) values ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'ANDROID', '0.1.0', 'TEST');
insert into public.count_records (id, client_count_id, inventory_id, user_id, device_id, ubicacion, codigo, cantidad_contada, descripcion, captured_at) values
  ('60000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001', 'A-01-01', '00001', 1, 'TEST', now());
insert into public.inventory_master_items (inventory_id, codigo, descripcion, control_type, source, created_by) values ('40000000-0000-0000-0000-000000000001', '00001', 'TEST', 'LEGACY', 'TEST', '30000000-0000-0000-0000-000000000001');

select throws_ok('set local role anon; select * from public.inventories', '42501', 'anon cannot access protected tables');
reset role;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000003', true); set local role authenticated;
select is((with attempted as (update public.inventories set status = 'PREPARADO' where id = '40000000-0000-0000-0000-000000000001' returning *) select count(*) from attempted), 0::bigint, 'CONTADOR cannot change inventory status directly');
select is((select count(*) from public.count_records), 1::bigint, 'CONTADOR reads own count');
reset role;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000004', true); set local role authenticated;
select is((select count(*) from public.count_records), 0::bigint, 'CONTADOR cannot read another user count');
reset role;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000002', true); set local role authenticated;
select lives_ok('select public.prepare_inventory(''40000000-0000-0000-0000-000000000001'')', 'ANALISTA can prepare an assigned inventory');
select is((select status from public.inventories where id = '40000000-0000-0000-0000-000000000001'), 'PREPARADO'::public.inventory_status, 'valid transition succeeds');
select ok(exists (select 1 from public.audit_events where event_type = 'INVENTORY_PREPARED'), 'transition writes audit event');
select throws_ok('select public.prepare_inventory(''40000000-0000-0000-0000-000000000001'')', '23514', 'invalid transition fails');
reset role;
select throws_ok($$insert into public.count_records (client_count_id, inventory_id, user_id, device_id, ubicacion, codigo, cantidad_contada, descripcion, captured_at) values ('70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001', 'A-01-02', '00001', 1, 'TEST', now())$$, '23505', 'duplicate client_count_id fails');
select lives_ok($$insert into public.count_records (client_count_id, inventory_id, user_id, device_id, ubicacion, codigo, cantidad_contada, descripcion, captured_at) values ('70000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001', 'A-01-02', '00001', 1, 'TEST', now())$$, 'same SKU may exist in another location');
select throws_ok($$insert into public.inventory_master_items (inventory_id, codigo, descripcion, control_type, source, created_by) values ('40000000-0000-0000-0000-000000000001', '00001', 'DUPLICADO', 'LEGACY', 'TEST', '30000000-0000-0000-0000-000000000001')$$, '23505', 'duplicate inventory master SKU fails');
select ok((select relrowsecurity from pg_class where oid = 'public.count_records'::regclass), 'count_records has RLS enabled');

select * from finish();
rollback;
