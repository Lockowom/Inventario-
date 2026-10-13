begin;
select plan(17);

insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('d2010000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'cut2-preview-admin@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('d2010000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'cut2-preview-analyst@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('d2010000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'cut2-preview-counter@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.profiles (user_id, display_name, role, user_type) values
  ('d2010000-0000-0000-0000-000000000001', 'CUT2 Preview Admin', 'ADMIN', 'PERMANENT'),
  ('d2010000-0000-0000-0000-000000000002', 'CUT2 Preview Analyst', 'ANALISTA', 'PERMANENT'),
  ('d2010000-0000-0000-0000-000000000003', 'CUT2 Preview Counter', 'CONTADOR', 'PERMANENT');
insert into public.inventories (id, name, status, created_by, prepared_at, prepared_by, opened_at, opened_by)
values ('d2020000-0000-0000-0000-000000000001', 'CUT2 Preview', 'ABIERTO', 'd2010000-0000-0000-0000-000000000001', now(), 'd2010000-0000-0000-0000-000000000001', now(), 'd2010000-0000-0000-0000-000000000001');
insert into public.inventory_assignments (inventory_id, user_id, assigned_by) values
  ('d2020000-0000-0000-0000-000000000001', 'd2010000-0000-0000-0000-000000000002', 'd2010000-0000-0000-0000-000000000001'),
  ('d2020000-0000-0000-0000-000000000001', 'd2010000-0000-0000-0000-000000000003', 'd2010000-0000-0000-0000-000000000001');
insert into public.inventory_master_items (inventory_id, codigo, descripcion, control_type, source, created_by) values
  ('d2020000-0000-0000-0000-000000000001', 'SKU-OK', 'Eligible', 'LEGACY', 'CUT2', 'd2010000-0000-0000-0000-000000000001'),
  ('d2020000-0000-0000-0000-000000000001', 'SKU-DIFF', 'Difference', 'LEGACY', 'CUT2', 'd2010000-0000-0000-0000-000000000001'),
  ('d2020000-0000-0000-0000-000000000001', 'SKU-SERIAL', 'Duplicate serial', 'SERIAL', 'CUT2', 'd2010000-0000-0000-0000-000000000001'),
  ('d2020000-0000-0000-0000-000000000001', 'SKU-ORPHAN', 'Orphan', 'LEGACY', 'CUT2', 'd2010000-0000-0000-0000-000000000001'),
  ('d2020000-0000-0000-0000-000000000001', 'SKU-NEG', 'Negative', 'LEGACY', 'CUT2', 'd2010000-0000-0000-0000-000000000001'),
  ('d2020000-0000-0000-0000-000000000001', 'SKU-HOLD', 'Hold', 'LEGACY', 'CUT2', 'd2010000-0000-0000-0000-000000000001'),
  ('d2020000-0000-0000-0000-000000000001', 'SKU-INVALID', 'Invalid identity', 'PARTIDA', 'CUT2', 'd2010000-0000-0000-0000-000000000001'),
  ('d2020000-0000-0000-0000-000000000001', 'SKU-OZ', 'Out zone', 'LEGACY', 'CUT2', 'd2010000-0000-0000-0000-000000000001');
insert into public.sync_devices (id, user_id, platform, app_version, device_label)
values ('d2030000-0000-0000-0000-000000000001', 'd2010000-0000-0000-0000-000000000003', 'WEB', 'test', 'CUT2 Preview Device');
insert into public.inventory_system_reference_items (inventory_id, codigo, reference_type, reference_value, quantity, source_total_quantity, source_available_quantity, unit_code) values
  ('d2020000-0000-0000-0000-000000000001', 'SKU-OK', 'LEGACY', null, 5, 5, 5, 'UNI'),
  ('d2020000-0000-0000-0000-000000000001', 'SKU-DIFF', 'LEGACY', null, 5, 5, 5, 'UNI'),
  ('d2020000-0000-0000-0000-000000000001', 'SKU-SERIAL', 'SERIAL', 'SER-1', 1, 1, 1, 'UNI'),
  ('d2020000-0000-0000-0000-000000000001', 'SKU-ORPHAN', 'LEGACY', null, 1, 1, 1, 'UNI'),
  ('d2020000-0000-0000-0000-000000000001', 'SKU-NEG', 'LEGACY', null, 0, 0, -1, 'UNI'),
  ('d2020000-0000-0000-0000-000000000001', 'SKU-HOLD', 'LEGACY', null, 1, 1, 1, 'UNI'),
  ('d2020000-0000-0000-0000-000000000001', 'SKU-OZ', 'LEGACY', null, 1, 1, 1, 'UNI');
insert into public.inventory_system_reference_metadata (inventory_id, reference_version, row_count, source, fingerprint, imported_by)
values ('d2020000-0000-0000-0000-000000000001', 1, 7, 'CUT2', repeat('a',64), 'd2010000-0000-0000-0000-000000000001');
insert into public.count_records (id, client_count_id, inventory_id, user_id, device_id, ubicacion, codigo, serie, cantidad_contada, descripcion, captured_at, received_at) values
  ('d2040000-0000-0000-0000-000000000001', 'd2050000-0000-0000-0000-000000000001', 'd2020000-0000-0000-0000-000000000001', 'd2010000-0000-0000-0000-000000000003', 'd2030000-0000-0000-0000-000000000001', 'A-01', 'SKU-OK', null, 5, 'Eligible', now(), now()),
  ('d2040000-0000-0000-0000-000000000002', 'd2050000-0000-0000-0000-000000000002', 'd2020000-0000-0000-0000-000000000001', 'd2010000-0000-0000-0000-000000000003', 'd2030000-0000-0000-0000-000000000001', 'A-02', 'SKU-DIFF', null, 3, 'Difference', now(), now()),
  ('d2040000-0000-0000-0000-000000000003', 'd2050000-0000-0000-0000-000000000003', 'd2020000-0000-0000-0000-000000000001', 'd2010000-0000-0000-0000-000000000003', 'd2030000-0000-0000-0000-000000000001', 'A-03', 'SKU-SERIAL', 'SER-1', 1, 'Duplicate serial', now(), now()),
  ('d2040000-0000-0000-0000-000000000004', 'd2050000-0000-0000-0000-000000000004', 'd2020000-0000-0000-0000-000000000001', 'd2010000-0000-0000-0000-000000000003', 'd2030000-0000-0000-0000-000000000001', 'A-04', 'SKU-SERIAL', 'SER-1', 1, 'Duplicate serial', now(), now()),
  ('d2040000-0000-0000-0000-000000000005', 'd2050000-0000-0000-0000-000000000005', 'd2020000-0000-0000-0000-000000000001', 'd2010000-0000-0000-0000-000000000003', 'd2030000-0000-0000-0000-000000000001', 'A-05', 'SKU-ORPHAN', null, 1, 'Orphan', now(), now()),
  ('d2040000-0000-0000-0000-000000000006', 'd2050000-0000-0000-0000-000000000006', 'd2020000-0000-0000-0000-000000000001', 'd2010000-0000-0000-0000-000000000003', 'd2030000-0000-0000-0000-000000000001', 'A-06', 'SKU-HOLD', null, 1, 'Hold', now(), now()),
  ('d2040000-0000-0000-0000-000000000008', 'd2050000-0000-0000-0000-000000000008', 'd2020000-0000-0000-0000-000000000001', 'd2010000-0000-0000-0000-000000000003', 'd2030000-0000-0000-0000-000000000001', 'A-07', 'SKU-INVALID', null, 1, 'Invalid identity', now(), now()),
  ('d2040000-0000-0000-0000-000000000007', 'd2050000-0000-0000-0000-000000000007', 'd2020000-0000-0000-0000-000000000001', 'd2010000-0000-0000-0000-000000000003', 'd2030000-0000-0000-0000-000000000001', 'X-01', 'SKU-OZ', null, 1, 'Out zone', now(), now());
insert into public.count_zone_assignments (inventory_id, warehouse_id, zone_code, assigned_by)
select id, warehouse_id, 'A', 'd2010000-0000-0000-0000-000000000001' from public.inventories where id='d2020000-0000-0000-0000-000000000001';
insert into public.orphan_references (inventory_id, warehouse_id, codigo, reference_type, normalized_reference_key, created_by)
select id, warehouse_id, 'SKU-ORPHAN', 'LEGACY', public.normalize_reference_key('LEGACY', 'SKU-ORPHAN', null), 'd2010000-0000-0000-0000-000000000001' from public.inventories where id='d2020000-0000-0000-0000-000000000001';
insert into public.inventory_sealed_references (id, inventory_id, warehouse_id, reference_type, codigo, normalized_reference_key, request_id)
select 'd2060000-0000-0000-0000-000000000001', id, warehouse_id, 'LEGACY', 'SKU-HOLD', public.normalize_reference_key('LEGACY', 'SKU-HOLD', null), 'd2070000-0000-0000-0000-000000000001' from public.inventories where id='d2020000-0000-0000-0000-000000000001';
insert into public.uom_resolution_cases (inventory_id, warehouse_id, reference_id, source_uom, target_uom, created_by)
select i.id, i.warehouse_id, 'd2060000-0000-0000-0000-000000000001', 'CAJA', 'UNI', 'd2010000-0000-0000-0000-000000000001' from public.inventories i where i.id='d2020000-0000-0000-0000-000000000001';
insert into public.reference_findings (inventory_id, warehouse_id, reference_id, finding_type, description, created_by)
select i.id, i.warehouse_id, 'd2060000-0000-0000-0000-000000000001', 'PHYSICAL_MISMATCH', 'Hold this reference', 'd2010000-0000-0000-0000-000000000001' from public.inventories i where i.id='d2020000-0000-0000-0000-000000000001';

select set_config('request.jwt.claim.sub', 'd2010000-0000-0000-0000-000000000001', true); set local role authenticated;
select is((public.preview_rolling_cut_v2('d2020000-0000-0000-0000-000000000001') #>> '{summary,rp_ready_estimate}')::integer, 1, 'T02: eligible reference is estimated RP ready');
select is((select item ->> 'estimated_result' from jsonb_array_elements(public.preview_rolling_cut_v2('d2020000-0000-0000-0000-000000000001') -> 'items') item where item ->> 'codigo' = 'SKU-DIFF'), 'C2_REQUIRED_ESTIMATE', 'T03: quantity difference is C2 estimate only');
select is((select item ->> 'block_reason' from jsonb_array_elements(public.preview_rolling_cut_v2('d2020000-0000-0000-0000-000000000001') -> 'items') item where item ->> 'codigo' = 'SKU-ORPHAN'), 'ORPHAN_REFERENCE', 'T04: orphan is blocked');
select is((select item ->> 'block_reason' from jsonb_array_elements(public.preview_rolling_cut_v2('d2020000-0000-0000-0000-000000000001') -> 'items') item where item ->> 'codigo' = 'SKU-NEG'), 'RISK_NEGATIVE_BALANCE', 'T06: negative available is blocked');
select is((select item ->> 'block_reason' from jsonb_array_elements(public.preview_rolling_cut_v2('d2020000-0000-0000-0000-000000000001') -> 'items') item where item ->> 'codigo' = 'SKU-SERIAL'), 'DUPLICATE_SERIAL', 'T07: duplicate serial is blocked');
select is((select item ->> 'block_reason' from jsonb_array_elements(public.preview_rolling_cut_v2('d2020000-0000-0000-0000-000000000001') -> 'items') item where item ->> 'codigo' = 'SKU-INVALID'), 'INVALID_IDENTITY', 'T09: malformed physical identity is visible and blocked');
select is((public.preview_rolling_cut_v2('d2020000-0000-0000-0000-000000000001') #>> '{summary,uom_mismatch_count}')::integer, 1, 'T05: UOM mismatch remains visible');
select is((public.preview_rolling_cut_v2('d2020000-0000-0000-0000-000000000001') #>> '{summary,critical_findings_count}')::integer, 1, 'T08: critical finding remains visible');
select is((select item ->> 'block_reason' from jsonb_array_elements(public.preview_rolling_cut_v2('d2020000-0000-0000-0000-000000000001') -> 'items') item where item ->> 'codigo' = 'SKU-OZ'), 'OUT_OF_ASSIGNED_ZONE_REVIEW', 'T10: out-of-zone item is blocked');
reset role;
select is((select count(*) from public.count_records where inventory_id='d2020000-0000-0000-0000-000000000001'), 8::bigint, 'T15: preview does not mutate counts');
select is((select count(*) from public.recount_missions where inventory_id='d2020000-0000-0000-0000-000000000001'), 0::bigint, 'T15: preview does not create missions');
select is((select count(*) from public.rp_release_batches where inventory_id='d2020000-0000-0000-0000-000000000001'), 0::bigint, 'T15: preview does not create RP releases');
select set_config('request.jwt.claim.sub', 'd2010000-0000-0000-0000-000000000001', true); set local role authenticated;
select is((public.preview_rolling_cut_v2('d2020000-0000-0000-0000-000000000001') ->> 'preview_fingerprint'), (public.preview_rolling_cut_v2('d2020000-0000-0000-0000-000000000001') ->> 'preview_fingerprint'), 'T14: fingerprint is deterministic');
select is(jsonb_array_length(public.preview_rolling_cut_v2('d2020000-0000-0000-0000-000000000001', null, '{"normalized_reference_keys":["SKU-OK"]}'::jsonb) -> 'items'), 1, 'T14: selection filter is read-only and deterministic');
select lives_ok($$select public.preview_rolling_cut_v2('d2020000-0000-0000-0000-000000000001', (select warehouse_id from public.inventories where id='d2020000-0000-0000-0000-000000000001'))$$, 'T12: matching warehouse scope is accepted');
reset role;
select set_config('request.jwt.claim.sub', 'd2010000-0000-0000-0000-000000000002', true); set local role authenticated;
select lives_ok($$select public.preview_rolling_cut_v2('d2020000-0000-0000-0000-000000000001')$$, 'T13: assigned analyst can query full preview');
reset role;
select set_config('request.jwt.claim.sub', 'd2010000-0000-0000-0000-000000000003', true); set local role authenticated;
select throws_ok($$select public.preview_rolling_cut_v2('d2020000-0000-0000-0000-000000000001')$$, '42501', 'Not authorized for rolling cut preview', 'T13: counter cannot query hidden system quantities');
reset role;

select * from finish();
rollback;
