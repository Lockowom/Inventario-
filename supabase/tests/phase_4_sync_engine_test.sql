begin;
select plan(25);

insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('71000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'phase4-admin@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('71000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'phase4-counter@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('71000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'phase4-other@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.profiles (user_id, display_name, role) values
  ('71000000-0000-0000-0000-000000000001', 'F4 Admin', 'ADMIN'),
  ('71000000-0000-0000-0000-000000000002', 'F4 Counter', 'CONTADOR'),
  ('71000000-0000-0000-0000-000000000003', 'F4 Other', 'CONTADOR');
insert into public.inventories (id, name, created_by) values ('72000000-0000-0000-0000-000000000001', 'PHASE4_SYNC', '71000000-0000-0000-0000-000000000001');
insert into public.inventory_assignments (inventory_id, user_id, assigned_by) values
  ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000001'),
  ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000003', '71000000-0000-0000-0000-000000000001');
insert into public.inventory_master_items (inventory_id, codigo, descripcion, control_type, source, created_by) values
  ('72000000-0000-0000-0000-000000000001', '00001', 'Producto legacy', 'LEGACY', 'TEST', '71000000-0000-0000-0000-000000000001'),
  ('72000000-0000-0000-0000-000000000001', 'SERIAL1', 'Producto serial', 'SERIAL', 'TEST', '71000000-0000-0000-0000-000000000001'),
  ('72000000-0000-0000-0000-000000000001', 'BATCH1', 'Producto partida', 'PARTIDA', 'TEST', '71000000-0000-0000-0000-000000000001');

select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true); set local role authenticated;
select lives_ok($$select public.prepare_inventory('72000000-0000-0000-0000-000000000001')$$, 'admin prepares Phase 4 inventory');
select lives_ok($$select public.open_inventory('72000000-0000-0000-0000-000000000001')$$, 'admin opens Phase 4 inventory');
reset role;

select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000002', true); set local role authenticated;
select lives_ok($$select public.register_sync_device('73000000-0000-0000-0000-000000000001', 'ANDROID', '0.1.0', 'INVEN3 ANDROID')$$, 'assigned counter registers opaque device id via RPC');
select throws_ok($$insert into public.sync_devices (id, user_id, platform, app_version, device_label) values ('73000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000002', 'ANDROID', '0.1', 'direct')$$, '42501', 'permission denied for table sync_devices', 'direct device writes are revoked');
select is((select result_status from public.sync_counts('72000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', 'ANDROID', '0.1.0', 'INVEN3 ANDROID', '[{"client_count_id":"74000000-0000-0000-0000-000000000001","ubicacion":"F-32-03","codigo":"00001","cantidad_contada":2,"captured_at":"2026-09-17T12:00:00Z"}]'::jsonb)), 'ACCEPTED', 'valid ABIERTO record is accepted');
select is((select result_status from public.sync_counts('72000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', 'ANDROID', '0.1.0', 'INVEN3 ANDROID', '[{"client_count_id":"74000000-0000-0000-0000-000000000001","ubicacion":"F-32-03","codigo":"00001","cantidad_contada":2,"captured_at":"2026-09-17T12:00:00Z"}]'::jsonb)), 'ALREADY_ACCEPTED', 'same physical replay is acknowledged idempotently');
select is((select result_status from public.sync_counts('72000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', 'ANDROID', '0.1.0', 'INVEN3 ANDROID', '[{"client_count_id":"74000000-0000-0000-0000-000000000001","ubicacion":"F-32-03","codigo":"00001","cantidad_contada":3,"captured_at":"2026-09-17T12:00:00Z"}]'::jsonb)), 'CONFLICT', 'same client_count_id with changed physical fields conflicts');
select is((select cantidad_contada from public.count_records where client_count_id = '74000000-0000-0000-0000-000000000001'), 2, 'conflict never overwrites accepted physical data');
reset role;
select is((select count(*) from public.audit_events where entity_id = (select id from public.count_records where client_count_id = '74000000-0000-0000-0000-000000000001') and event_type in ('COUNT_CREATED', 'COUNT_SYNCED')), 2::bigint, 'accepted replay does not duplicate audit events');
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000002', true); set local role authenticated;
select is((select result_status from public.sync_counts('72000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', 'ANDROID', '0.1.0', 'INVEN3 ANDROID', '[{"client_count_id":"74000000-0000-0000-0000-000000000002","ubicacion":"F-32-03","codigo":"SERIAL1","cantidad_contada":2,"captured_at":"2026-09-17T12:00:00Z"}]'::jsonb)), 'REJECTED', 'server validates SERIAL control type');
select is((select result_status from public.sync_counts('72000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', 'ANDROID', '0.1.0', 'INVEN3 ANDROID', '[{"client_count_id":"74000000-0000-0000-0000-000000000006","ubicacion":"F-32-03","codigo":"BATCH1","cantidad_contada":2,"captured_at":"2026-09-17T12:00:00Z"}]'::jsonb)), 'REJECTED', 'server validates PARTIDA control type');
select is((select result_status from public.sync_counts('72000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', 'ANDROID', '0.1.0', 'INVEN3 ANDROID', '[{"client_count_id":"74000000-0000-0000-0000-000000000007","ubicacion":"F-32-03","codigo":"BATCH1","partida":"L-1","cantidad_contada":2,"captured_at":"2026-09-17T12:00:00Z"}]'::jsonb)), 'ACCEPTED', 'valid PARTIDA record is accepted');
select throws_ok($$select * from public.sync_counts('72000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', 'ANDROID', '0.1.0', 'INVEN3 ANDROID', (select jsonb_agg(jsonb_build_object('client_count_id', gen_random_uuid(), 'ubicacion','F-32-03','codigo','00001','cantidad_contada',1,'captured_at','2026-09-17T12:00:00Z')) from generate_series(1,21)))$$, '23514', 'sync_counts requires 1 to 20 records', 'server enforces a maximum batch of 20');
select lives_ok($$select public.report_device_sync_state('72000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', 3)$$, 'device reports known pending work');
reset role;
select is((select pending_count from public.inventory_freeze_guards where inventory_id = '72000000-0000-0000-0000-000000000001' and resolved_at is null), 3, 'open freeze guard reflects latest pending count');
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000002', true); set local role authenticated;
select lives_ok($$select public.report_device_sync_state('72000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', 0)$$, 'device resolves known pending work');
reset role;
select ok(not exists(select 1 from public.inventory_freeze_guards where inventory_id = '72000000-0000-0000-0000-000000000001' and resolved_at is null), 'zero pending resolves the guard');

select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000003', true); set local role authenticated;
select throws_ok($$select public.register_sync_device('73000000-0000-0000-0000-000000000001', 'IOS', '0.1.0', 'INVEN3 IOS')$$, '42501', 'Device registration belongs to another user', 'another user cannot reuse an existing device registration');
reset role;

select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true); set local role authenticated;
select lives_ok($$select public.close_inventory('72000000-0000-0000-0000-000000000001')$$, 'admin closes after active capture');
reset role;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000002', true); set local role authenticated;
select is((select result_status from public.sync_counts('72000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', 'ANDROID', '0.1.0', 'INVEN3 ANDROID', '[{"client_count_id":"74000000-0000-0000-0000-000000000003","ubicacion":"F-32-04","codigo":"00001","cantidad_contada":1,"captured_at":"2000-01-01T00:00:00Z"}]'::jsonb)), 'ACCEPTED', 'CERRADO accepts a previously captured offline record');
select is((select inventory_status_at_receive from public.count_records where client_count_id = '74000000-0000-0000-0000-000000000003'), 'CERRADO'::public.inventory_status, 'CERRADO reception is auditable');
select is((select captured_after_closed_at from public.count_records where client_count_id = '74000000-0000-0000-0000-000000000003'), false, 'CERRADO capture timing is stored explicitly');
reset role;

select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true); set local role authenticated;
select lives_ok($$select public.freeze_inventory('72000000-0000-0000-0000-000000000001')$$, 'admin freezes once known guards are resolved');
reset role;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000002', true); set local role authenticated;
select is((select result_status from public.sync_counts('72000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', 'ANDROID', '0.1.0', 'INVEN3 ANDROID', '[{"client_count_id":"74000000-0000-0000-0000-000000000004","ubicacion":"F-32-05","codigo":"00001","cantidad_contada":1,"captured_at":"2026-09-17T12:00:00Z"}]'::jsonb)), 'REJECTED', 'CONGELADO rejects new synchronization records');
select throws_ok($$insert into public.count_records (client_count_id, inventory_id, user_id, device_id, ubicacion, codigo, cantidad_contada, descripcion, captured_at) values ('74000000-0000-0000-0000-000000000005', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', '73000000-0000-0000-0000-000000000001', 'F-32-06', '00001', 1, 'forbidden', now())$$, '42501', 'permission denied for table count_records', 'direct count inserts remain forbidden');
reset role;

select * from finish();
rollback;
