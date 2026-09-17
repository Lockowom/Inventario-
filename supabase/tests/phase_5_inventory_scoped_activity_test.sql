begin;
select plan(20);

insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('91000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'f5-scope-admin@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('91000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'f5-scope-analyst@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('91000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'f5-scope-cross@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.profiles (user_id, display_name, role) values
  ('91000000-0000-0000-0000-000000000001', 'Scope Admin', 'ADMIN'),
  ('91000000-0000-0000-0000-000000000002', 'Scope Analyst', 'ANALISTA'),
  ('91000000-0000-0000-0000-000000000003', 'Scope B only device', 'CONTADOR');
insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('91100000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'authenticated', 'authenticated', 'f5-scope-counter-' || n || '@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()
from generate_series(1, 47) as n;
insert into public.profiles (user_id, display_name, role)
select ('91100000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'Scope Counter ' || lpad(n::text, 2, '0'), 'CONTADOR'
from generate_series(1, 47) as n;

insert into public.inventories (id, name, created_by) values
  ('92000000-0000-0000-0000-000000000001', 'SCOPE_A', '91000000-0000-0000-0000-000000000001'),
  ('92000000-0000-0000-0000-000000000002', 'SCOPE_B', '91000000-0000-0000-0000-000000000001');
insert into public.inventory_assignments (inventory_id, user_id, assigned_by)
select '92000000-0000-0000-0000-000000000001'::uuid, ('91100000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '91000000-0000-0000-0000-000000000001'::uuid from generate_series(1, 47) as n;
insert into public.inventory_assignments (inventory_id, user_id, assigned_by) values
  ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000001'),
  ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000001'),
  ('92000000-0000-0000-0000-000000000002', '91100000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001'),
  ('92000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000001');
insert into public.inventory_master_items (inventory_id, codigo, descripcion, control_type, source, created_by) values
  ('92000000-0000-0000-0000-000000000001', 'LEG-A', 'Legacy A', 'LEGACY', 'TEST', '91000000-0000-0000-0000-000000000001'),
  ('92000000-0000-0000-0000-000000000002', 'LEG-B', 'Legacy B', 'LEGACY', 'TEST', '91000000-0000-0000-0000-000000000001');

select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', true); set local role authenticated;
select lives_ok($$select public.prepare_inventory('92000000-0000-0000-0000-000000000001')$$, 'admin prepares A');
select lives_ok($$select public.open_inventory('92000000-0000-0000-0000-000000000001')$$, 'admin opens A');
select lives_ok($$select public.prepare_inventory('92000000-0000-0000-0000-000000000002')$$, 'admin prepares B');
select lives_ok($$select public.open_inventory('92000000-0000-0000-0000-000000000002')$$, 'admin opens B');
reset role;

-- Every one of the 47 counters has an accepted count and inventory-scoped device activity in A.
do $$
declare n integer; v_user uuid; v_device uuid; v_count uuid; v_captured timestamptz;
begin
  for n in 1..47 loop
    v_user := ('91100000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
    v_device := ('93000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
    v_count := ('94000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
    v_captured := case when n = 1 then '2026-09-18T02:30:00Z'::timestamptz else '2026-09-17T12:00:00Z'::timestamptz end;
    perform set_config('request.jwt.claim.sub', v_user::text, true);
    perform public.register_sync_device(v_device, 'ANDROID', '0.1.0', 'SCOPE A');
    perform public.sync_counts('92000000-0000-0000-0000-000000000001', v_device, 'ANDROID', '0.1.0', 'SCOPE A', jsonb_build_array(jsonb_build_object(
      'client_count_id', v_count, 'ubicacion', 'A-' || lpad(n::text, 2, '0') || '-01', 'codigo', 'LEG-A', 'cantidad_contada', n, 'captured_at', v_captured)));
  end loop;
end;
$$;

-- Device D2 and the cross-assigned user work exclusively in B.
select set_config('request.jwt.claim.sub', '91100000-0000-0000-0000-000000000001', true);
select lives_ok($$select public.sync_counts('92000000-0000-0000-0000-000000000002', '95000000-0000-0000-0000-000000000001', 'IOS', '0.1.0', 'SCOPE B', '[{"client_count_id":"96000000-0000-0000-0000-000000000001","ubicacion":"B-01-01","codigo":"LEG-B","cantidad_contada":5,"captured_at":"2026-09-17T14:00:00Z"}]'::jsonb)$$, 'counter 01 sends B through D2');
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000003', true);
select lives_ok($$select public.sync_counts('92000000-0000-0000-0000-000000000002', '95000000-0000-0000-0000-000000000003', 'WEB', '0.1.0', 'SCOPE B ONLY', '[{"client_count_id":"96000000-0000-0000-0000-000000000003","ubicacion":"B-03-01","codigo":"LEG-B","cantidad_contada":1,"captured_at":"2026-09-17T14:01:00Z"}]'::jsonb)$$, 'cross-assigned user sends only B activity');
select set_config('request.jwt.claim.sub', '91100000-0000-0000-0000-000000000047', true);
select lives_ok($$select public.report_device_sync_state('92000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000047', 2)$$, 'counter 47 reports known A pending work');

select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', true); set local role authenticated;
select is((select (public.get_inventory_supervision('92000000-0000-0000-0000-000000000001')->'summary'->>'received_counts')::integer), 47, '47 counters contribute exactly one received count each');
select is((select (public.get_inventory_supervision('92000000-0000-0000-0000-000000000001')->'summary'->>'counted_units')::integer), 1128, 'A counted units are the exact distributed total');
select is((select (x->>'received_counts')::integer from jsonb_array_elements(public.get_inventory_supervision('92000000-0000-0000-0000-000000000001')->'counters') x where x->>'user_id' = '91100000-0000-0000-0000-000000000001'), 1, 'counter 01 aggregate is not mixed');
select is((select (x->>'counted_units')::integer from jsonb_array_elements(public.get_inventory_supervision('92000000-0000-0000-0000-000000000001')->'counters') x where x->>'user_id' = '91100000-0000-0000-0000-000000000047'), 47, 'counter 47 units remain its own');
select is((select (x->>'known_devices')::integer from jsonb_array_elements(public.get_inventory_supervision('92000000-0000-0000-0000-000000000001')->'counters') x where x->>'user_id' = '91100000-0000-0000-0000-000000000047'), 1, 'counter 47 has one A-scoped device');
select is((select (x->>'known_pending')::integer from jsonb_array_elements(public.get_inventory_supervision('92000000-0000-0000-0000-000000000001')->'counters') x where x->>'user_id' = '91100000-0000-0000-0000-000000000047'), 2, 'counter 47 pending is scoped to A');
select is((select (public.get_inventory_supervision('92000000-0000-0000-0000-000000000001')->'summary'->>'known_devices')::integer), 47, 'A contains only the 47 devices with A evidence');
select is((select (public.get_inventory_supervision('92000000-0000-0000-0000-000000000002')->'summary'->>'known_devices')::integer), 2, 'B contains only D2 and the B-only device');
select ok(not exists (select 1 from jsonb_array_elements(public.get_inventory_supervision('92000000-0000-0000-0000-000000000001')->'devices') x where x->>'id' = '95000000-0000-0000-0000-000000000001'), 'A never includes D2 activity exclusive to B');
select ok(not exists (select 1 from jsonb_array_elements(public.get_inventory_supervision('92000000-0000-0000-0000-000000000002')->'devices') x where x->>'id' = '93000000-0000-0000-0000-000000000001'), 'B never includes D1 activity exclusive to A');
select is((select x->>'last_seen_at' from jsonb_array_elements(public.get_inventory_supervision('92000000-0000-0000-0000-000000000001')->'counters') x where x->>'user_id' = '91000000-0000-0000-0000-000000000003'), null, 'recent activity from B does not label the counter active in A');
select ok((select x->>'last_seen_at' is not null from jsonb_array_elements(public.get_inventory_supervision('92000000-0000-0000-0000-000000000002')->'counters') x where x->>'user_id' = '91000000-0000-0000-0000-000000000003'), 'B exposes the counter activity observed in B');
select is((select count(*) from public.search_inventory_counts('92000000-0000-0000-0000-000000000001', 50, null, null, null, null, null, null, null, '2026-09-17T03:00:00Z'::timestamptz, '2026-09-18T03:00:00Z'::timestamptz) where captured_at = '2026-09-18T02:30:00Z'::timestamptz), 1::bigint, '23:30 local capture remains in local calendar day 17 via absolute bounds');
reset role;

select * from finish();
rollback;
