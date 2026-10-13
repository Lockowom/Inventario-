begin;
select plan(19);

insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('c2010000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'cut2-admin@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('c2010000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'cut2-3pl@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.profiles (user_id, display_name, role, user_type) values
  ('c2010000-0000-0000-0000-000000000001', 'CUT2 Admin', 'ADMIN', 'PERMANENT'),
  ('c2010000-0000-0000-0000-000000000002', 'CUT2 3PL', 'CONTADOR', 'CONTRACTOR_3PL');
insert into public.inventories (id, name, status, created_by, prepared_at, prepared_by, opened_at, opened_by) values
  ('c2020000-0000-0000-0000-000000000001', 'CUT2 Warehouse A', 'ABIERTO', 'c2010000-0000-0000-0000-000000000001', now(), 'c2010000-0000-0000-0000-000000000001', now(), 'c2010000-0000-0000-0000-000000000001');
insert into public.inventory_assignments (inventory_id, user_id, assigned_by) values
  ('c2020000-0000-0000-0000-000000000001', 'c2010000-0000-0000-0000-000000000002', 'c2010000-0000-0000-0000-000000000001');

select is(public.normalize_reference_key('LEGACY', ' sku-01 ', null), 'SKU-01', 'BA: legacy normalized key trims and uppercases');
select is(public.normalize_reference_key('PARTIDA', 'sku-01', ' PaRT-ñ '), 'SKU-01::PART-Ñ', 'BA: partida key normalizes Unicode and case');
select throws_ok($$select public.normalize_reference_key('SERIAL', 'SKU::01', 'SERIE')$$, '23514', 'Reference fields cannot contain ::', 'BA: separator injection is rejected');
select throws_ok($$select public.normalize_reference_key('PARTIDA', 'SKU', '')$$, '23514', 'PARTIDA/SERIAL reference value is required', 'BA: empty batch is rejected');

insert into public.inventory_sealed_references (id, inventory_id, warehouse_id, reference_type, codigo, reference_value, normalized_reference_key, request_id, state, sealed_at, sealed_by)
select 'c2030000-0000-0000-0000-000000000001', i.id, i.warehouse_id, 'PARTIDA', 'SKU-01', 'LOTE-01', public.normalize_reference_key('PARTIDA', 'SKU-01', 'LOTE-01'), 'c2040000-0000-0000-0000-000000000001', 'SEALED', now(), 'c2010000-0000-0000-0000-000000000001'
from public.inventories i where i.id = 'c2020000-0000-0000-0000-000000000001';
select is((select normalized_reference_key from public.inventory_sealed_references where id = 'c2030000-0000-0000-0000-000000000001'), 'SKU-01::LOTE-01', 'BA: sealed reference retains canonical identity');
select throws_ok($$insert into public.inventory_sealed_references (inventory_id, warehouse_id, reference_type, codigo, reference_value, normalized_reference_key, request_id) select id, warehouse_id, 'PARTIDA', 'SKU-01', 'lote-01', public.normalize_reference_key('PARTIDA', 'SKU-01', 'lote-01'), 'c2040000-0000-0000-0000-000000000002' from public.inventories where id='c2020000-0000-0000-0000-000000000001'$$, '23505', null, 'BA: canonical collision is unique per inventory and warehouse');

insert into public.operational_hours (id, code, timezone, is_24x7) values ('c2050000-0000-0000-0000-000000000001', 'CUT2_24X7', 'America/Santiago', true);
insert into public.warehouses (id, code, name, timezone, operational_hours_id) values ('c2050000-0000-0000-0000-000000000002', 'CUT2-B', 'CUT2 Bodega B', 'America/Santiago', 'c2050000-0000-0000-0000-000000000001');
insert into public.inventories (id, name, status, warehouse_id, created_by, prepared_at, prepared_by, opened_at, opened_by) values
  ('c2020000-0000-0000-0000-000000000002', 'CUT2 Warehouse B', 'ABIERTO', 'c2050000-0000-0000-0000-000000000002', 'c2010000-0000-0000-0000-000000000001', now(), 'c2010000-0000-0000-0000-000000000001', now(), 'c2010000-0000-0000-0000-000000000001');
insert into public.inventory_sealed_references (inventory_id, warehouse_id, reference_type, codigo, reference_value, normalized_reference_key, request_id)
values ('c2020000-0000-0000-0000-000000000002', 'c2050000-0000-0000-0000-000000000002', 'PARTIDA', 'SKU-01', 'LOTE-01', public.normalize_reference_key('PARTIDA', 'SKU-01', 'LOTE-01'), 'c2040000-0000-0000-0000-000000000003');
select is((select count(*) from public.inventory_sealed_references where normalized_reference_key = 'SKU-01::LOTE-01'), 2::bigint, 'BJ: the same identity is isolated by warehouse inventory scope');

insert into public.count_zone_assignments (inventory_id, warehouse_id, zone_code, assigned_by)
select id, warehouse_id, 'A', 'c2010000-0000-0000-0000-000000000001' from public.inventories where id='c2020000-0000-0000-0000-000000000001';
select throws_ok($$insert into public.count_zone_assignments (inventory_id, warehouse_id, zone_code, assigned_by) select id, warehouse_id, 'A-01', 'c2010000-0000-0000-0000-000000000001' from public.inventories where id='c2020000-0000-0000-0000-000000000001'$$, '23P01', 'ZONE_OVERLAP_CONFLICT', 'zone overlap is blocked locally');

insert into public.operational_hours (id, code, timezone, is_24x7) values ('c2060000-0000-0000-0000-000000000001', 'CUT2_SHIFT', 'America/Santiago', false);
insert into public.operational_hour_shifts (operational_hours_id, code, day_of_week, starts_at, ends_at) values ('c2060000-0000-0000-0000-000000000001', 'MORNING', 1, '08:00', '16:00');
insert into public.operational_hour_breaks (operational_hours_id, day_of_week, starts_at, ends_at) values ('c2060000-0000-0000-0000-000000000001', 1, '12:00', '13:00');
select is(public.operational_minutes_between('c2060000-0000-0000-0000-000000000001', '2026-10-12 14:30:00+00', '2026-10-12 16:30:00+00'), 60, 'BB: breaks deduct operational SLA minutes in local time');
insert into public.operational_holidays (operational_hours_id, holiday_date, label) values ('c2060000-0000-0000-0000-000000000001', '2026-10-12', 'CUT2 holiday');
select is(public.operational_minutes_between('c2060000-0000-0000-0000-000000000001', '2026-10-12 14:30:00+00', '2026-10-12 16:30:00+00'), 0, 'BB: holiday removes operational SLA minutes');

select set_config('request.jwt.claim.sub', 'c2010000-0000-0000-0000-000000000002', true); set local role authenticated;
select ok(public.cut2_has_capability('c2020000-0000-0000-0000-000000000001', 'COUNT_C1'), 'BK: 3PL can count C1');
select ok(not public.cut2_has_capability('c2020000-0000-0000-0000-000000000001', 'MANAGE_RECONCILIATION'), 'BK: 3PL cannot manage reconciliation');
reset role;

insert into public.orphan_references (inventory_id, warehouse_id, codigo, reference_type, normalized_reference_key, created_by)
select id, warehouse_id, 'ORPHAN-1', 'LEGACY', public.normalize_reference_key('LEGACY', 'ORPHAN-1', null), 'c2010000-0000-0000-0000-000000000001' from public.inventories where id='c2020000-0000-0000-0000-000000000001';
select is((select count(*) from public.inventory_sealed_references where inventory_id='c2020000-0000-0000-0000-000000000001' and state='SEALED'), 1::bigint, 'BI: orphan evidence does not mutate or block unrelated sealed references');

insert into public.inventory_close_requests (id, inventory_id, request_id, started_by) values ('c2070000-0000-0000-0000-000000000001', 'c2020000-0000-0000-0000-000000000001', 'c2080000-0000-0000-0000-000000000001', 'c2010000-0000-0000-0000-000000000001');
select throws_ok($$insert into public.inventory_close_requests (inventory_id, request_id, started_by) values ('c2020000-0000-0000-0000-000000000001', 'c2080000-0000-0000-0000-000000000002', 'c2010000-0000-0000-0000-000000000001')$$, '23505', null, 'BD: concurrent close request is serialized per inventory');
select ok(not public.validate_inventory_close_backup('c2070000-0000-0000-0000-000000000001'), 'BL: closing is blocked before a validated backup');
insert into public.inventory_close_backups (close_request_id, storage_path, sha256, size_bytes, manifest, state, validated_at)
values ('c2070000-0000-0000-0000-000000000001', 'local/cut2.backup', repeat('a', 64), 42, '{"tables":{"inventories":1}}'::jsonb, 'VALIDATED', now());
select ok(public.validate_inventory_close_backup('c2070000-0000-0000-0000-000000000001'), 'BL: validated backup satisfies close contract');

insert into public.rp_release_batches (id, inventory_id, warehouse_id, state, xlsx_file_name, xlsx_storage_path, xlsx_sha256, xlsx_size_bytes, sidecar_storage_path, sidecar_sha256, created_by, finalized_at)
select 'c2090000-0000-0000-0000-000000000001', id, warehouse_id, 'READY', 'rp.xlsx', 'inventory-rp/cut2/rp.xlsx', repeat('b',64), 512, 'inventory-rp/cut2/RP_RELEASE_AUDIT.json', repeat('c',64), 'c2010000-0000-0000-0000-000000000001', now() from public.inventories where id='c2020000-0000-0000-0000-000000000001';
insert into public.rp_release_audits (release_id, inventory_id, warehouse_id, reference_count, release_fingerprint, xlsx_file_name, xlsx_sha256, xlsx_size_bytes, sidecar_sha256, algorithm_version, created_by)
select 'c2090000-0000-0000-0000-000000000001', id, warehouse_id, 1, repeat('d',64), 'rp.xlsx', repeat('b',64), 512, repeat('c',64), 'CUT2_V2_3', 'c2010000-0000-0000-0000-000000000001' from public.inventories where id='c2020000-0000-0000-0000-000000000001';
select is(public.verify_rp_release_integrity_metadata('c2090000-0000-0000-0000-000000000001'), 'VERIFIED', 'BE: sidecar schema and release metadata verify');
update public.rp_release_batches set sidecar_sha256=repeat('e',64) where id='c2090000-0000-0000-0000-000000000001';
select is(public.verify_rp_release_integrity_metadata('c2090000-0000-0000-0000-000000000001'), 'INTEGRITY_FAILURE', 'BF: sidecar hash mismatch blocks official release');
select throws_ok($$update public.rp_release_audits set xlsx_size_bytes=513 where release_id='c2090000-0000-0000-0000-000000000001'$$, '55000', 'CUT2 immutable history cannot be updated or deleted', 'release sidecar is append-only');

select * from finish();
rollback;
