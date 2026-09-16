begin;
select plan(24);

insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('30000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin.test@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('30000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'analyst.test@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('30000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'counter.test@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('30000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'other-counter.test@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('30000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'unassigned-analyst.test@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles (user_id, display_name, role) values
  ('30000000-0000-0000-0000-000000000001', 'Admin', 'ADMIN'),
  ('30000000-0000-0000-0000-000000000002', 'Analista asignado', 'ANALISTA'),
  ('30000000-0000-0000-0000-000000000003', 'Contador', 'CONTADOR'),
  ('30000000-0000-0000-0000-000000000004', 'Otro contador', 'CONTADOR'),
  ('30000000-0000-0000-0000-000000000005', 'Analista sin asignacion', 'ANALISTA');

insert into public.inventories (id, name, created_by) values
  ('40000000-0000-0000-0000-000000000001', 'TEST_RLS_A', '30000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000002', 'TEST_RLS_B', '30000000-0000-0000-0000-000000000001');
insert into public.inventory_assignments (inventory_id, user_id, assigned_by) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001');
insert into public.sync_devices (id, user_id, platform, app_version, device_label) values
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'ANDROID', '0.1.0', 'TEST'),
  ('50000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000004', 'ANDROID', '0.1.0', 'OTHER');
insert into public.inventory_master_items (inventory_id, codigo, descripcion, control_type, source, created_by) values
  ('40000000-0000-0000-0000-000000000001', '00001', 'TEST', 'LEGACY', 'TEST', '30000000-0000-0000-0000-000000000001');
insert into public.count_records (id, client_count_id, inventory_id, user_id, device_id, ubicacion, codigo, cantidad_contada, descripcion, captured_at) values
  ('60000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001', 'A-01-01', '00001', 1, 'TEST', now());

select throws_ok('set local role anon; select * from public.inventories', '42501', 'permission denied for table inventories', 'anon has no access to protected tables');
reset role;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000003', true); set local role authenticated;
select throws_ok('update public.inventories set status = ''PREPARADO'' where id = ''40000000-0000-0000-0000-000000000001''', '42501', 'permission denied for table inventories', 'CONTADOR cannot change inventory status directly');
select is((select count(*) from public.count_records), 1::bigint, 'CONTADOR reads own count');
reset role;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000004', true); set local role authenticated;
select is((select count(*) from public.count_records), 0::bigint, 'CONTADOR cannot read another user count');
reset role;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000002', true); set local role authenticated;
select lives_ok('select public.prepare_inventory(''40000000-0000-0000-0000-000000000001'')', 'assigned ANALISTA can prepare an inventory');
select is((select status from public.inventories where id = '40000000-0000-0000-0000-000000000001'), 'PREPARADO'::public.inventory_status, 'valid transition changes status');
select ok(exists (select 1 from public.audit_events where event_type = 'INVENTORY_PREPARED'), 'transition writes an audit event');
select throws_ok('select public.prepare_inventory(''40000000-0000-0000-0000-000000000001'')', '23514', 'Invalid inventory transition from PREPARADO to PREPARADO', 'invalid transition fails');
reset role;

select throws_ok($$insert into public.count_records (client_count_id, inventory_id, user_id, device_id, ubicacion, codigo, cantidad_contada, descripcion, captured_at) values ('70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001', 'A-01-02', '00001', 1, 'TEST', now())$$, '23505', 'duplicate key value violates unique constraint "count_records_client_count_id_key"', 'duplicate client_count_id fails');
select lives_ok($$insert into public.count_records (client_count_id, inventory_id, user_id, device_id, ubicacion, codigo, cantidad_contada, descripcion, captured_at) values ('70000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001', 'A-01-02', '00001', 1, 'TEST', now())$$, 'same SKU can exist in another location');
select throws_ok($$insert into public.inventory_master_items (inventory_id, codigo, descripcion, control_type, source, created_by) values ('40000000-0000-0000-0000-000000000001', '00001', 'DUPLICADO', 'LEGACY', 'TEST', '30000000-0000-0000-0000-000000000001')$$, '23505', 'duplicate key value violates unique constraint "inventory_master_items_inventory_id_codigo_key"', 'duplicate inventory master SKU fails');
select throws_ok($$insert into public.count_records (client_count_id, inventory_id, user_id, device_id, ubicacion, codigo, cantidad_contada, descripcion, captured_at) values ('70000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001', 'A-01-03', 'MISSING', 1, 'TEST', now())$$, '23503', 'insert or update on table "count_records" violates foreign key constraint "count_records_inventory_id_codigo_fkey"', 'count cannot reference a SKU outside the inventory master');
select throws_ok($$insert into public.count_records (client_count_id, inventory_id, user_id, device_id, ubicacion, codigo, cantidad_contada, descripcion, captured_at) values ('70000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000002', 'A-01-04', '00001', 1, 'TEST', now())$$, '23503', 'insert or update on table "count_records" violates foreign key constraint "count_records_device_id_user_id_fkey"', 'count device must belong to its user');

insert into public.inventory_cuts (id, inventory_id, cut_number, created_by) values
  ('80000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 1, '30000000-0000-0000-0000-000000000001'),
  ('80000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 1, '30000000-0000-0000-0000-000000000001');
update public.count_records set cut_id = '80000000-0000-0000-0000-000000000001', export_seq = 1 where id = '60000000-0000-0000-0000-000000000001';
select throws_ok($$update public.count_records set cut_id = '80000000-0000-0000-0000-000000000001', export_seq = 1 where client_count_id = '70000000-0000-0000-0000-000000000002'$$, '23505', 'duplicate key value violates unique constraint "count_records_inventory_export_seq_unique"', 'export sequence is unique per inventory');
select throws_ok($$update public.count_records set cut_id = '80000000-0000-0000-0000-000000000002', export_seq = 2 where id = '60000000-0000-0000-0000-000000000001'$$, '23503', 'insert or update on table "count_records" violates foreign key constraint "count_records_cut_id_inventory_id_fkey"', 'count cannot reference a cut from another inventory');
select throws_ok($$insert into public.inventory_cut_items (inventory_id, cut_id, count_record_id, snapshot) values ('40000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', '{}'::jsonb)$$, '23503', 'insert or update on table "inventory_cut_items" violates foreign key constraint "inventory_cut_items_count_record_id_cut_id_inventory_id_fkey"', 'cut item must match count, cut, and inventory');

select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('profiles', 'inventories', 'inventory_assignments', 'inventory_master_items', 'sync_devices', 'count_records', 'count_revisions', 'inventory_cuts', 'inventory_cut_items', 'cut_rectifications', 'generated_files', 'inventory_freeze_guards', 'audit_events') and c.relrowsecurity), 13::bigint, 'RLS is enabled on every Phase 1 public table');
select ok(not has_function_privilege('anon', 'public.prepare_inventory(uuid)', 'EXECUTE'), 'anon cannot execute lifecycle RPCs');
select is(to_regprocedure('public.is_admin()'), null, 'authorization helper is not exposed in public');

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000005', true); set local role authenticated;
select throws_ok('select public.open_inventory(''40000000-0000-0000-0000-000000000001'')', '42501', 'Not authorized to manage inventory', 'unassigned ANALISTA cannot transition an inventory');
reset role;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true); set local role authenticated;
select lives_ok($$update public.profiles set display_name = 'Admin actualizado' where user_id = '30000000-0000-0000-0000-000000000004'$$, 'ADMIN can manage profiles');
reset role;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000002', true); set local role authenticated;
select lives_ok('select public.open_inventory(''40000000-0000-0000-0000-000000000001'')', 'assigned ANALISTA can open a prepared inventory');
select lives_ok('select public.close_inventory(''40000000-0000-0000-0000-000000000001'')', 'assigned ANALISTA can close an open inventory');
reset role;
insert into public.inventory_freeze_guards (inventory_id, device_id, pending_count) values ('40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 1);
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000002', true); set local role authenticated;
select throws_ok('select public.freeze_inventory(''40000000-0000-0000-0000-000000000001'')', '23514', 'Inventory has known pending synchronization records', 'freeze guard blocks freezing while pending work exists');

select * from finish();
rollback;
