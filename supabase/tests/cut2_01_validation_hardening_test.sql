begin;
select plan(13);

insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('f2010000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'cut2-hardening@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.profiles (user_id, display_name, role, user_type)
values ('f2010000-0000-0000-0000-000000000001', 'CUT2 Hardening Admin', 'ADMIN', 'PERMANENT');
insert into public.inventories (id, name, status, created_by, prepared_at, prepared_by, opened_at, opened_by)
values ('f2020000-0000-0000-0000-000000000001', 'CUT2 Hardening Inventory', 'ABIERTO', 'f2010000-0000-0000-0000-000000000001', now(), 'f2010000-0000-0000-0000-000000000001', now(), 'f2010000-0000-0000-0000-000000000001');

select is(
  public.normalize_reference_key('PARTIDA', U&'sku-\006e\0303', ' lote '),
  U&'SKU-\00d1::LOTE',
  'BA: canonical identity normalizes decomposed Unicode NFC'
);

insert into public.inventory_sealed_references (id, inventory_id, warehouse_id, reference_type, codigo, normalized_reference_key, request_id, state, sealed_at, sealed_by)
select 'f2030000-0000-0000-0000-000000000001', id, warehouse_id, 'LEGACY', 'SKU-HARD', public.normalize_reference_key('LEGACY', 'SKU-HARD', null), 'f2040000-0000-0000-0000-000000000001', 'SEALED', now(), 'f2010000-0000-0000-0000-000000000001'
from public.inventories where id = 'f2020000-0000-0000-0000-000000000001';

select ok(public.cut2_reference_is_critical('f2030000-0000-0000-0000-000000000001'), 'BG: unknown criticality is fail-safe critical');
insert into public.reference_criticality (reference_id, is_critical, decided_by)
values ('f2030000-0000-0000-0000-000000000001', false, 'f2010000-0000-0000-0000-000000000001');
select ok(not public.cut2_reference_is_critical('f2030000-0000-0000-0000-000000000001'), 'BG: explicit non-critical decision is respected');

insert into public.orphan_references (inventory_id, warehouse_id, codigo, reference_type, normalized_reference_key, created_by)
select id, warehouse_id, 'SKU-ORPHAN', 'LEGACY', public.normalize_reference_key('LEGACY', 'SKU-ORPHAN', null), 'f2010000-0000-0000-0000-000000000001'
from public.inventories where id = 'f2020000-0000-0000-0000-000000000001';
select ok(
  (select block_seal and block_rp from public.orphan_references where codigo = 'SKU-ORPHAN'),
  'BH: orphan evidence blocks seal and RP by default'
);
select throws_ok(
  $$insert into public.orphan_references (inventory_id, warehouse_id, codigo, reference_type, normalized_reference_key, created_by)
    select id, warehouse_id, 'SKU-BAD', 'LEGACY', 'NOT-CANONICAL', 'f2010000-0000-0000-0000-000000000001'
    from public.inventories where id = 'f2020000-0000-0000-0000-000000000001'$$,
  '23514', null,
  'BH: orphan identity must remain canonical'
);

select throws_ok(
  $$insert into public.reference_findings (inventory_id, warehouse_id, reference_id, finding_type, critical, description, created_by)
    select id, warehouse_id, 'f2030000-0000-0000-0000-000000000001', 'PHYSICAL_MISMATCH', false, 'Must remain blocking', 'f2010000-0000-0000-0000-000000000001'
    from public.inventories where id = 'f2020000-0000-0000-0000-000000000001'$$,
  '23514', null,
  'BC: mandatory critical finding cannot be downgraded'
);
insert into public.reference_findings (inventory_id, warehouse_id, reference_id, finding_type, critical, description, created_by)
select id, warehouse_id, 'f2030000-0000-0000-0000-000000000001', 'NEW_LOCATION_FOUND', false, 'Location-only finding can await review', 'f2010000-0000-0000-0000-000000000001'
from public.inventories where id = 'f2020000-0000-0000-0000-000000000001';
select is((select critical from public.reference_findings where finding_type = 'NEW_LOCATION_FOUND'), false, 'BC: location-only finding can be non-critical');

insert into public.tolerance_policies (id, inventory_id, warehouse_id, created_by)
select 'f2050000-0000-0000-0000-000000000001', id, warehouse_id, 'f2010000-0000-0000-0000-000000000001'
from public.inventories where id = 'f2020000-0000-0000-0000-000000000001';
select throws_ok(
  $$insert into public.reference_tolerance_decisions (reference_id, policy_id, decision, counted_quantity, system_quantity, exported_quantity, decided_at, decided_by)
    values ('f2030000-0000-0000-0000-000000000001', 'f2050000-0000-0000-0000-000000000001', 'EXPORT_COUNTED', 4, 3, 3, now(), 'f2010000-0000-0000-0000-000000000001')$$,
  '23514', null,
  'BD: tolerance export must equal the selected source quantity'
);

select throws_ok(
  $$insert into public.uom_resolution_cases (inventory_id, warehouse_id, source_uom, target_uom, state, resolved_by, resolved_at, created_by)
    select id, warehouse_id, 'CAJA', 'UNI', 'RESOLVED', 'f2010000-0000-0000-0000-000000000001', now(), 'f2010000-0000-0000-0000-000000000001'
    from public.inventories where id = 'f2020000-0000-0000-0000-000000000001'$$,
  '23514', null,
  'BE: a resolved UOM case requires an explicit conversion factor'
);
insert into public.uom_conversion_factors (id, from_uom, to_uom, factor, created_by)
values ('f2060000-0000-0000-0000-000000000001', 'CAJA', 'UNI', 12, 'f2010000-0000-0000-0000-000000000001');
insert into public.uom_resolution_cases (inventory_id, warehouse_id, source_uom, target_uom, state, resolved_factor_id, resolved_by, resolved_at, created_by)
select id, warehouse_id, 'CAJA', 'UNI', 'RESOLVED', 'f2060000-0000-0000-0000-000000000001', 'f2010000-0000-0000-0000-000000000001', now(), 'f2010000-0000-0000-0000-000000000001'
from public.inventories where id = 'f2020000-0000-0000-0000-000000000001';
select is((select state from public.uom_resolution_cases where resolved_factor_id = 'f2060000-0000-0000-0000-000000000001'), 'RESOLVED', 'BE: explicit UOM conversion resolves the case');

insert into public.operational_hours (id, code, timezone, is_24x7)
values ('f2070000-0000-0000-0000-000000000001', 'CUT2-24X7-HARD', 'America/Santiago', true);
select is(public.operational_minutes_between('f2070000-0000-0000-0000-000000000001', '2026-04-05 02:30:00+00', '2026-04-05 03:30:00+00'), 60, 'BB: 24x7 calendar preserves elapsed minutes through DST boundary');

insert into public.rp_release_batches (id, inventory_id, warehouse_id, state, xlsx_file_name, xlsx_storage_path, xlsx_sha256, xlsx_size_bytes, sidecar_storage_path, sidecar_sha256, created_by, finalized_at)
select 'f2080000-0000-0000-0000-000000000001', id, warehouse_id, 'READY', 'mismatch.xlsx', 'inventory-rp/cut2/mismatch.xlsx', repeat('a', 64), 12, 'inventory-rp/cut2/mismatch-audit.json', repeat('b', 64), 'f2010000-0000-0000-0000-000000000001', now()
from public.inventories where id = 'f2020000-0000-0000-0000-000000000001';
insert into public.rp_release_audits (release_id, inventory_id, warehouse_id, reference_count, release_fingerprint, xlsx_file_name, xlsx_sha256, xlsx_size_bytes, sidecar_sha256, algorithm_version, created_by)
select 'f2080000-0000-0000-0000-000000000001', id, warehouse_id, 1, repeat('c',64), 'mismatch.xlsx', repeat('d',64), 12, repeat('b',64), 'CUT2_V2_3', 'f2010000-0000-0000-0000-000000000001'
from public.inventories where id = 'f2020000-0000-0000-0000-000000000001';
select is(public.verify_rp_release_integrity_metadata('f2080000-0000-0000-0000-000000000001'), 'INTEGRITY_FAILURE', 'BF: mismatched RP sidecar metadata blocks official verification');

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_cuts' and column_name = 'cut_mode'
      and column_default like '%LEGACY_SNAPSHOT%'
  ),
  'BF: legacy cuts retain an explicit LEGACY_SNAPSHOT default'
);

select * from finish();
rollback;
