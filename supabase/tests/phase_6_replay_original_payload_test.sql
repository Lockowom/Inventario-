begin;
select plan(20);

insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('b6000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'f6r-admin@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
 ('b6000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'f6r-analyst@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
 ('b6000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'f6r-counter@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.profiles (user_id, display_name, role) values
 ('b6000000-0000-0000-0000-000000000001', 'Replay Admin', 'ADMIN'),
 ('b6000000-0000-0000-0000-000000000002', 'Replay Analyst', 'ANALISTA'),
 ('b6000000-0000-0000-0000-000000000003', 'Replay Counter', 'CONTADOR');
insert into public.inventories (id, name, status, created_by, prepared_at, prepared_by, opened_at, opened_by, closed_at, closed_by, frozen_at, frozen_by) values
 ('b6100000-0000-0000-0000-000000000001', 'REPLAY OPEN', 'ABIERTO', 'b6000000-0000-0000-0000-000000000001', now(), 'b6000000-0000-0000-0000-000000000001', now(), 'b6000000-0000-0000-0000-000000000001', null, null, null, null),
 ('b6100000-0000-0000-0000-000000000002', 'REPLAY CLOSED', 'CERRADO', 'b6000000-0000-0000-0000-000000000001', now(), 'b6000000-0000-0000-0000-000000000001', now(), 'b6000000-0000-0000-0000-000000000001', now(), 'b6000000-0000-0000-0000-000000000001', null, null),
 ('b6100000-0000-0000-0000-000000000003', 'REPLAY DRAFT', 'BORRADOR', 'b6000000-0000-0000-0000-000000000001', null, null, null, null, null, null, null, null),
 ('b6100000-0000-0000-0000-000000000004', 'REPLAY PREPARED', 'PREPARADO', 'b6000000-0000-0000-0000-000000000001', now(), 'b6000000-0000-0000-0000-000000000001', null, null, null, null, null, null),
 ('b6100000-0000-0000-0000-000000000005', 'REPLAY FROZEN', 'CONGELADO', 'b6000000-0000-0000-0000-000000000001', now(), 'b6000000-0000-0000-0000-000000000001', now(), 'b6000000-0000-0000-0000-000000000001', now(), 'b6000000-0000-0000-0000-000000000001', now(), 'b6000000-0000-0000-0000-000000000001');
insert into public.inventory_assignments (inventory_id, user_id, assigned_by)
select inventory_id, user_id, 'b6000000-0000-0000-0000-000000000001'::uuid
from (select id as inventory_id from public.inventories where id between 'b6100000-0000-0000-0000-000000000001'::uuid and 'b6100000-0000-0000-0000-000000000005'::uuid) i
cross join (values ('b6000000-0000-0000-0000-000000000002'::uuid), ('b6000000-0000-0000-0000-000000000003'::uuid)) u(user_id);
insert into public.inventory_master_items (inventory_id, codigo, descripcion, control_type, source, created_by)
select id, 'REPLAY', 'Replay SKU', 'LEGACY', 'TEST', 'b6000000-0000-0000-0000-000000000001'::uuid
from public.inventories where id between 'b6100000-0000-0000-0000-000000000001'::uuid and 'b6100000-0000-0000-0000-000000000005'::uuid;

select set_config('request.jwt.claim.sub', 'b6000000-0000-0000-0000-000000000003', true); set local role authenticated;
select lives_ok($$select public.register_sync_device('b6200000-0000-0000-0000-000000000001', 'WEB', 'test', 'Replay device')$$, 'counter registers the replay device');
select is((select result_status from public.sync_counts('b6100000-0000-0000-0000-000000000001', 'b6200000-0000-0000-0000-000000000001', 'WEB', 'test', 'Replay device', '[{"client_count_id":"b6300000-0000-0000-0000-000000000001","ubicacion":"A-01-01","codigo":"REPLAY","cantidad_contada":1,"captured_at":"2026-09-19T12:00:00Z"}]'::jsonb)), 'ACCEPTED', 'original ingestion is accepted');
select lives_ok($$select public.correct_uncut_count((select id from public.count_records where client_count_id='b6300000-0000-0000-0000-000000000001'), '{"ubicacion":"A-01-01","codigo":"REPLAY","cantidad_contada":9}'::jsonb, 'server correction')$$, 'server corrects original one to nine');
select is((select result_status from public.sync_counts('b6100000-0000-0000-0000-000000000001', 'b6200000-0000-0000-0000-000000000001', 'WEB', 'test', 'Replay device', '[{"client_count_id":"b6300000-0000-0000-0000-000000000001","ubicacion":"A-01-01","codigo":"REPLAY","cantidad_contada":1,"captured_at":"2026-09-19T12:00:00Z"}]'::jsonb)), 'ALREADY_ACCEPTED', 'lost ACK replay compares to original ingestion payload');
select is((select server_count_id from public.sync_counts('b6100000-0000-0000-0000-000000000001', 'b6200000-0000-0000-0000-000000000001', 'WEB', 'test', 'Replay device', '[{"client_count_id":"b6300000-0000-0000-0000-000000000001","ubicacion":"A-01-01","codigo":"REPLAY","cantidad_contada":1,"captured_at":"2026-09-19T12:00:00Z"}]'::jsonb)), (select id from public.count_records where client_count_id='b6300000-0000-0000-0000-000000000001'), 'valid replay returns original server_count_id');
select is((select received_at from public.sync_counts('b6100000-0000-0000-0000-000000000001', 'b6200000-0000-0000-0000-000000000001', 'WEB', 'test', 'Replay device', '[{"client_count_id":"b6300000-0000-0000-0000-000000000001","ubicacion":"A-01-01","codigo":"REPLAY","cantidad_contada":1,"captured_at":"2026-09-19T12:00:00Z"}]'::jsonb)), (select received_at from public.count_records where client_count_id='b6300000-0000-0000-0000-000000000001'), 'valid replay returns original received_at');
select is((select cantidad_contada from public.count_records where client_count_id='b6300000-0000-0000-0000-000000000001'), 9, 'valid replay preserves corrected canonical quantity');
select is((select result_status from public.sync_counts('b6100000-0000-0000-0000-000000000001', 'b6200000-0000-0000-0000-000000000001', 'WEB', 'test', 'Replay device', '[{"client_count_id":"b6300000-0000-0000-0000-000000000001","ubicacion":"A-01-01","codigo":"REPLAY","cantidad_contada":9,"captured_at":"2026-09-19T12:00:00Z"}]'::jsonb)), 'CONFLICT', 'corrected payload is not accepted as an ingestion replay');
select lives_ok($$select public.correct_uncut_count((select id from public.count_records where client_count_id='b6300000-0000-0000-0000-000000000001'), '{"ubicacion":"A-01-01","codigo":"REPLAY","cantidad_contada":4}'::jsonb, 'second server correction')$$, 'second correction remains canonical');
select is((select result_status from public.sync_counts('b6100000-0000-0000-0000-000000000001', 'b6200000-0000-0000-0000-000000000001', 'WEB', 'test', 'Replay device', '[{"client_count_id":"b6300000-0000-0000-0000-000000000001","ubicacion":"A-01-01","codigo":"REPLAY","cantidad_contada":1,"captured_at":"2026-09-19T12:00:00Z"}]'::jsonb)), 'ALREADY_ACCEPTED', 'multiple revisions continue to accept only original payload');
select is((select cantidad_contada from public.count_records where client_count_id='b6300000-0000-0000-0000-000000000001'), 4, 'multiple revisions preserve current canonical quantity');
reset role;

insert into public.count_records (id, client_count_id, inventory_id, user_id, device_id, ubicacion, codigo, cantidad_contada, descripcion, captured_at, received_at) values
 ('b6300000-0000-0000-0000-000000000002', 'b6310000-0000-0000-0000-000000000002', 'b6100000-0000-0000-0000-000000000002', 'b6000000-0000-0000-0000-000000000003', 'b6200000-0000-0000-0000-000000000001', 'A-01-02', 'REPLAY', 1, 'Replay SKU', now(), now()),
 ('b6300000-0000-0000-0000-000000000003', 'b6310000-0000-0000-0000-000000000003', 'b6100000-0000-0000-0000-000000000003', 'b6000000-0000-0000-0000-000000000003', 'b6200000-0000-0000-0000-000000000001', 'A-01-03', 'REPLAY', 1, 'Replay SKU', now(), now()),
 ('b6300000-0000-0000-0000-000000000004', 'b6310000-0000-0000-0000-000000000004', 'b6100000-0000-0000-0000-000000000004', 'b6000000-0000-0000-0000-000000000003', 'b6200000-0000-0000-0000-000000000001', 'A-01-04', 'REPLAY', 1, 'Replay SKU', now(), now()),
 ('b6300000-0000-0000-0000-000000000005', 'b6310000-0000-0000-0000-000000000005', 'b6100000-0000-0000-0000-000000000005', 'b6000000-0000-0000-0000-000000000003', 'b6200000-0000-0000-0000-000000000001', 'A-01-05', 'REPLAY', 1, 'Replay SKU', now(), now());
select set_config('request.jwt.claim.sub', 'b6000000-0000-0000-0000-000000000003', true); set local role authenticated;
select lives_ok($$select public.correct_uncut_count('b6300000-0000-0000-0000-000000000002', '{"ubicacion":"A-01-02","codigo":"REPLAY","cantidad_contada":2}'::jsonb, 'closed correction')$$, 'CERRADO correction is permitted for assigned counter');
select throws_ok($$select public.correct_uncut_count('b6300000-0000-0000-0000-000000000003', '{"ubicacion":"A-01-03","codigo":"REPLAY","cantidad_contada":2}'::jsonb, 'draft correction')$$, '23514', 'Corrections are only allowed while inventory is ABIERTO or CERRADO', 'BORRADOR correction is blocked by lifecycle');
select throws_ok($$select public.correct_uncut_count('b6300000-0000-0000-0000-000000000004', '{"ubicacion":"A-01-04","codigo":"REPLAY","cantidad_contada":2}'::jsonb, 'prepared correction')$$, '23514', 'Corrections are only allowed while inventory is ABIERTO or CERRADO', 'PREPARADO correction is blocked by lifecycle');
select throws_ok($$select public.correct_uncut_count('b6300000-0000-0000-0000-000000000005', '{"ubicacion":"A-01-05","codigo":"REPLAY","cantidad_contada":2}'::jsonb, 'frozen correction')$$, '23514', 'Corrections are only allowed while inventory is ABIERTO or CERRADO', 'CONGELADO correction is blocked by lifecycle');
reset role;
select set_config('request.jwt.claim.sub', 'b6000000-0000-0000-0000-000000000002', true); set local role authenticated;
select lives_ok($$select public.create_cut('b6100000-0000-0000-0000-000000000001', 'b6400000-0000-0000-0000-000000000001')$$, 'ABIERTO cut is permitted for assigned analyst');
select lives_ok($$select public.create_cut('b6100000-0000-0000-0000-000000000002', 'b6400000-0000-0000-0000-000000000002')$$, 'CERRADO cut is permitted for assigned analyst');
select throws_ok($$select public.create_cut('b6100000-0000-0000-0000-000000000003', 'b6400000-0000-0000-0000-000000000003')$$, '23514', 'Cuts are only allowed while inventory is ABIERTO or CERRADO', 'BORRADOR cut is blocked by lifecycle after authorization');
select throws_ok($$select public.create_cut('b6100000-0000-0000-0000-000000000004', 'b6400000-0000-0000-0000-000000000004')$$, '23514', 'Cuts are only allowed while inventory is ABIERTO or CERRADO', 'PREPARADO cut is blocked by lifecycle after authorization');
select throws_ok($$select public.create_cut('b6100000-0000-0000-0000-000000000005', 'b6400000-0000-0000-0000-000000000005')$$, '23514', 'Cuts are only allowed while inventory is ABIERTO or CERRADO', 'CONGELADO cut is blocked by lifecycle after authorization');
reset role;

select * from finish();
rollback;
