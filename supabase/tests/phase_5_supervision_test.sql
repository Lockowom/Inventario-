begin;
select plan(30);

insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('81000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'phase5-admin@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('81000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'phase5-analyst@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('81000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'phase5-counter@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('81000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'phase5-outsider@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('81000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'phase5-inactive@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.profiles (user_id, display_name, role, active) values
  ('81000000-0000-0000-0000-000000000001', 'F5 Admin', 'ADMIN', true),
  ('81000000-0000-0000-0000-000000000002', 'F5 Analyst', 'ANALISTA', true),
  ('81000000-0000-0000-0000-000000000003', 'F5 Counter', 'CONTADOR', true),
  ('81000000-0000-0000-0000-000000000004', 'F5 Outsider', 'ANALISTA', true),
  ('81000000-0000-0000-0000-000000000005', 'F5 Inactive', 'CONTADOR', false);
-- A realistic supervision fixture: 47 additional assigned counters, not devices.
insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('85000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'authenticated', 'authenticated', 'phase5-counter-' || n || '@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()
from generate_series(1, 47) as n;
insert into public.profiles (user_id, display_name, role, active)
select ('85000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'F5 Counter ' || lpad(n::text, 2, '0'), 'CONTADOR', true
from generate_series(1, 47) as n;
insert into public.inventories (id, name, created_by) values ('82000000-0000-0000-0000-000000000001', 'PHASE5_SUPERVISION', '81000000-0000-0000-0000-000000000001');
insert into public.inventory_assignments (inventory_id, user_id, assigned_by) values
  ('82000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000002', '81000000-0000-0000-0000-000000000001'),
  ('82000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000003', '81000000-0000-0000-0000-000000000001');
insert into public.inventory_assignments (inventory_id, user_id, assigned_by)
select '82000000-0000-0000-0000-000000000001'::uuid, ('85000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '81000000-0000-0000-0000-000000000001'::uuid
from generate_series(1, 47) as n;
insert into public.inventory_master_items (inventory_id, codigo, descripcion, control_type, source, created_by) values
  ('82000000-0000-0000-0000-000000000001', 'SER-5', 'Serial de prueba', 'SERIAL', 'TEST', '81000000-0000-0000-0000-000000000001'),
  ('82000000-0000-0000-0000-000000000001', 'LOT-5', 'Partida de prueba', 'PARTIDA', 'TEST', '81000000-0000-0000-0000-000000000001'),
  ('82000000-0000-0000-0000-000000000001', 'LEG-5', 'Legacy de prueba', 'LEGACY', 'TEST', '81000000-0000-0000-0000-000000000001');

select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000001', true); set local role authenticated;
select lives_ok($$select public.prepare_inventory('82000000-0000-0000-0000-000000000001')$$, 'admin prepares supervision inventory');
select lives_ok($$select public.open_inventory('82000000-0000-0000-0000-000000000001')$$, 'admin opens supervision inventory');
reset role;

select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000003', true); set local role authenticated;
select lives_ok($$select public.register_sync_device('83000000-0000-0000-0000-000000000001', 'ANDROID', '0.1.0', 'F5 ANDROID')$$, 'counter registers known device');
select is((select result_status from public.sync_counts('82000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', 'ANDROID', '0.1.0', 'F5 ANDROID', '[{"client_count_id":"84000000-0000-0000-0000-000000000001","ubicacion":"A-01-01","codigo":"SER-5","serie":"S-5","cantidad_contada":1,"captured_at":"2026-09-17T10:00:00Z"}]'::jsonb)), 'ACCEPTED', 'first serial observation is received');
select is((select result_status from public.sync_counts('82000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', 'ANDROID', '0.1.0', 'F5 ANDROID', '[{"client_count_id":"84000000-0000-0000-0000-000000000002","ubicacion":"A-02-01","codigo":"SER-5","serie":"S-5","cantidad_contada":1,"captured_at":"2026-09-17T10:01:00Z"}]'::jsonb)), 'ACCEPTED', 'second serial observation remains non-blocking');
select is((select result_status from public.sync_counts('82000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', 'ANDROID', '0.1.0', 'F5 ANDROID', '[{"client_count_id":"84000000-0000-0000-0000-000000000003","ubicacion":"B-01-01","codigo":"LOT-5","partida":"P-5","cantidad_contada":3,"captured_at":"2026-09-17T10:02:00Z"}]'::jsonb)), 'ACCEPTED', 'batch observation is received');
select is((select (public.get_my_count_summary('82000000-0000-0000-0000-000000000001')->>'received_counts')::integer), 3, 'counter sees only own received count summary');
select throws_ok($$select public.get_inventory_supervision('82000000-0000-0000-0000-000000000001')$$, '42501', 'Not authorized for supervision', 'counter cannot call broad supervision model');
select throws_ok($$select * from public.search_inventory_counts('82000000-0000-0000-0000-000000000001')$$, '42501', 'Not authorized for supervision', 'counter cannot search inventory-wide receipts');
reset role;

select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000002', true); set local role authenticated;
select is((select (public.get_inventory_supervision('82000000-0000-0000-0000-000000000001')->'summary'->>'received_counts')::integer), 3, 'assigned analyst receives server-side inventory summary');
select is((select count(*) from public.inventory_assignments where inventory_id = '82000000-0000-0000-0000-000000000001' and user_id between '85000000-0000-0000-0000-000000000001'::uuid and '85000000-0000-0000-0000-000000000047'::uuid), 47::bigint, 'fixture includes exactly 47 additional assigned counters');
select is((select jsonb_array_length(public.get_inventory_supervision('82000000-0000-0000-0000-000000000001')->'counters')), 49, 'supervision includes all assigned observational rows without a per-counter client query');
select is((select (public.get_inventory_supervision('82000000-0000-0000-0000-000000000001')->'possible_duplicate_serials'->0->>'observations')::integer), 2, 'repeated serial is an alert only');
select is((select count(*) from public.search_inventory_counts('82000000-0000-0000-0000-000000000001', 50, null, null, null, 'SER-5')), 2::bigint, 'code filter is evaluated on the server');
select is((select count(*) from public.search_inventory_counts('82000000-0000-0000-0000-000000000001', 50, null, null, null, null, 'S-5')), 2::bigint, 'serial filter is evaluated on the server');
select is((select count(*) from public.search_inventory_counts('82000000-0000-0000-0000-000000000001', 50, null, null, null, null, null, 'P-5')), 1::bigint, 'batch filter is evaluated on the server');
select is((select count(*) from public.search_inventory_counts('82000000-0000-0000-0000-000000000001', 50, null, null, '81000000-0000-0000-0000-000000000003')), 3::bigint, 'counter filter is evaluated on the server');
select is((select count(*) from public.search_inventory_counts('82000000-0000-0000-0000-000000000001', 50, null, null, null, 'SER%')), 0::bigint, 'wildcard characters are escaped in server search');
select is((select count(*) from public.search_inventory_counts('82000000-0000-0000-0000-000000000001', 50, null, null, null, null, null, null, 'A-01-01')), 1::bigint, 'location filter is evaluated on the server');
select is((select count(*) from public.search_inventory_counts('82000000-0000-0000-0000-000000000001', 50, null, null, null, null, null, null, null, '2026-09-17T00:00:00Z'::timestamptz, '2026-09-18T00:00:00Z'::timestamptz)), 3::bigint, 'timestamp range is evaluated on the server');
select is((select count(*) from public.search_inventory_counts('82000000-0000-0000-0000-000000000001', 1, '2026-09-17T10:02:00Z', '84000000-0000-0000-0000-000000000003')), 1::bigint, 'cursor returns the next deterministic page');
select throws_ok($$select * from public.search_inventory_counts('82000000-0000-0000-0000-000000000001', 50, '2026-09-17T10:02:00Z', null)$$, '23514', 'Cursor requires captured_at and id together', 'partial cursor is rejected');
select throws_ok($$select * from public.search_inventory_counts('82000000-0000-0000-0000-000000000001', 101)$$, '23514', 'Limit must be between 1 and 100', 'search limit is bounded');
reset role;

select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000004', true); set local role authenticated;
select throws_ok($$select public.get_inventory_supervision('82000000-0000-0000-0000-000000000001')$$, '42501', 'Not authorized for supervision', 'unassigned analyst is isolated');
reset role;
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000005', true); set local role authenticated;
select throws_ok($$select public.get_my_count_summary('82000000-0000-0000-0000-000000000001')$$, '42501', 'Active authentication is required', 'inactive profile cannot use read model');
reset role;
set local role anon;
select throws_ok($$select public.get_inventory_supervision('82000000-0000-0000-0000-000000000001')$$, '42501', 'permission denied for function get_inventory_supervision', 'anon cannot execute supervision RPC');
reset role;

update public.inventories i
set c1_completed_at=now(),
    c1_completed_by='81000000-0000-0000-0000-000000000001',
    c1_count_records=(select count(*)::integer from public.count_records c where c.inventory_id=i.id),
    c1_counted_units=(select coalesce(sum(c.cantidad_contada),0)::bigint from public.count_records c where c.inventory_id=i.id),
    c1_master_fingerprint=repeat('c',64),
    c1_reference_fingerprint=repeat('d',64)
where i.id='82000000-0000-0000-0000-000000000001';

select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000001', true); set local role authenticated;
select lives_ok($q$select public.close_inventory('82000000-0000-0000-0000-000000000001')$q$, 'F16-complete closed inventory remains consultable');
select is((select public.get_inventory_supervision('82000000-0000-0000-0000-000000000001')->'inventory'->>'status'), 'CERRADO', 'closed inventory is still readable');
select lives_ok($$select public.freeze_inventory('82000000-0000-0000-0000-000000000001')$$, 'frozen inventory remains read-only and consultable');
select is((select public.get_inventory_supervision('82000000-0000-0000-0000-000000000001')->'inventory'->>'status'), 'CONGELADO', 'frozen state is returned as observation only');
reset role;

select * from finish();
rollback;
