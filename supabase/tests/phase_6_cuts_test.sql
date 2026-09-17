begin;
select plan(37);

insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('a6000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'f6-admin@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('a6000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'f6-analyst@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('a6000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'f6-counter@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('a6000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'f6-other@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.profiles (user_id, display_name, role) values
  ('a6000000-0000-0000-0000-000000000001', 'F6 Admin', 'ADMIN'),
  ('a6000000-0000-0000-0000-000000000002', 'F6 Analyst', 'ANALISTA'),
  ('a6000000-0000-0000-0000-000000000003', 'F6 Counter', 'CONTADOR'),
  ('a6000000-0000-0000-0000-000000000004', 'F6 Other', 'CONTADOR');
insert into public.inventories (id, name, status, created_by, prepared_at, prepared_by, opened_at, opened_by) values
  ('a6100000-0000-0000-0000-000000000001', 'F6 OPEN', 'ABIERTO', 'a6000000-0000-0000-0000-000000000001', now(), 'a6000000-0000-0000-0000-000000000001', now(), 'a6000000-0000-0000-0000-000000000001'),
  ('a6100000-0000-0000-0000-000000000002', 'F6 DRAFT', 'BORRADOR', 'a6000000-0000-0000-0000-000000000001', null, null, null, null),
  ('a6100000-0000-0000-0000-000000000003', 'F6 LARGE', 'ABIERTO', 'a6000000-0000-0000-0000-000000000001', now(), 'a6000000-0000-0000-0000-000000000001', now(), 'a6000000-0000-0000-0000-000000000001'),
  ('a6100000-0000-0000-0000-000000000004', 'F6 SEVEN', 'ABIERTO', 'a6000000-0000-0000-0000-000000000001', now(), 'a6000000-0000-0000-0000-000000000001', now(), 'a6000000-0000-0000-0000-000000000001');
insert into public.inventory_assignments (inventory_id, user_id, assigned_by) values
  ('a6100000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000002', 'a6000000-0000-0000-0000-000000000001'),
  ('a6100000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000003', 'a6000000-0000-0000-0000-000000000001'),
  ('a6100000-0000-0000-0000-000000000003', 'a6000000-0000-0000-0000-000000000002', 'a6000000-0000-0000-0000-000000000001'),
  ('a6100000-0000-0000-0000-000000000004', 'a6000000-0000-0000-0000-000000000002', 'a6000000-0000-0000-0000-000000000001');
insert into public.inventory_master_items (inventory_id, codigo, descripcion, control_type, source, created_by)
select inventory_id, codigo, descripcion, control_type::public.master_control_type, 'TEST', 'a6000000-0000-0000-0000-000000000001'::uuid
from (values
 ('a6100000-0000-0000-0000-000000000001'::uuid, 'LEGACY', 'Legacy description', 'LEGACY'),
 ('a6100000-0000-0000-0000-000000000001'::uuid, 'SERIALS', 'Serial description', 'SERIAL'),
 ('a6100000-0000-0000-0000-000000000001'::uuid, 'BATCHP', 'Batch description', 'PARTIDA'),
 ('a6100000-0000-0000-0000-000000000003'::uuid, 'LARGE', 'Large description', 'LEGACY'),
 ('a6100000-0000-0000-0000-000000000004'::uuid, 'SEVEN', 'Seven description', 'LEGACY')
) x(inventory_id, codigo, descripcion, control_type);
insert into public.sync_devices (id, user_id, platform, app_version, device_label) values
 ('a6200000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000003', 'WEB', 'test', 'F6 counter'),
 ('a6200000-0000-0000-0000-000000000002', 'a6000000-0000-0000-0000-000000000001', 'WEB', 'test', 'F6 admin');
insert into public.count_records (id, client_count_id, inventory_id, user_id, device_id, ubicacion, codigo, cantidad_contada, descripcion, captured_at, received_at) values
 ('a6300000-0000-0000-0000-000000000001', 'a6310000-0000-0000-0000-000000000001', 'a6100000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000003', 'a6200000-0000-0000-0000-000000000001', 'A-01-01', 'LEGACY', 3, 'Legacy description', now(), '2026-09-17T10:00:00Z'),
 ('a6300000-0000-0000-0000-000000000002', 'a6310000-0000-0000-0000-000000000002', 'a6100000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000003', 'a6200000-0000-0000-0000-000000000001', 'A-01-02', 'LEGACY', 1, 'Legacy description', now(), '2026-09-17T10:01:00Z');

select set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000003', true); set local role authenticated;
select lives_ok($$select public.correct_uncut_count('a6300000-0000-0000-0000-000000000001', '{"ubicacion":"B-02-03","codigo":"LEGACY","cantidad_contada":7}'::jsonb, ' digitación inicial ')$$, 'CONTADOR corrects own uncut count');
select is((select cantidad_contada from public.count_records where id = 'a6300000-0000-0000-0000-000000000001'), 7, 'correction updates only physical content');
select is((select old_values->>'cantidad_contada' from public.count_revisions where count_record_id = 'a6300000-0000-0000-0000-000000000001'), '3', 'revision stores old values');
select is((select new_values->>'cantidad_contada' from public.count_revisions where count_record_id = 'a6300000-0000-0000-0000-000000000001'), '7', 'revision stores new values');
reset role;
select is((select count(*) from public.audit_events where entity_id = 'a6300000-0000-0000-0000-000000000001' and event_type = 'COUNT_CORRECTED'), 1::bigint, 'one COUNT_CORRECTED audit is written');
set local role authenticated;
select throws_ok($$select public.correct_uncut_count('a6300000-0000-0000-0000-000000000001', '{"ubicacion":"A-01-01","codigo":"SERIALS","cantidad_contada":1}'::jsonb, 'missing serial')$$, '23514', 'INVALID_SERIAL', 'correction revalidates SERIAL');
select throws_ok($$select public.correct_uncut_count('a6300000-0000-0000-0000-000000000001', '{"ubicacion":"A-01-01","codigo":"BATCHP","serie":"x","cantidad_contada":1}'::jsonb, 'invalid batch')$$, '23514', 'INVALID_BATCH', 'correction revalidates PARTIDA');
select throws_ok($$select public.correct_uncut_count('a6300000-0000-0000-0000-000000000001', '{"ubicacion":"A-01-01","codigo":"LEGACY","cantidad_contada":1}'::jsonb, '   ')$$, '23514', 'Correction reason is required and must be at most 500 characters', 'empty reason is rejected');
select throws_ok($$select public.create_cut('a6100000-0000-0000-0000-000000000001', 'a6400000-0000-0000-0000-000000000001')$$, '42501', 'Only an assigned ANALISTA or ADMIN can create a cut', 'CONTADOR cannot create a cut');
reset role;

select set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000004', true); set local role authenticated;
select throws_ok($$select public.correct_uncut_count('a6300000-0000-0000-0000-000000000001', '{"ubicacion":"A-01-01","codigo":"LEGACY","cantidad_contada":1}'::jsonb, 'other')$$, '42501', 'Not authorized to correct this count', 'unassigned counter cannot correct another record');
reset role;

select set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000002', true); set local role authenticated;
select lives_ok($$select public.correct_uncut_count('a6300000-0000-0000-0000-000000000002', '{"ubicacion":"C2-03-04","codigo":"LEGACY","cantidad_contada":5}'::jsonb, 'analyst correction')$$, 'assigned ANALISTA corrects uncut count');
select is((select revision_number from public.count_revisions where count_record_id = 'a6300000-0000-0000-0000-000000000001' order by revision_number desc limit 1), 1, 'revision number is monotonic under count row lock');
select lives_ok($$select public.create_cut('a6100000-0000-0000-0000-000000000001', 'a6400000-0000-0000-0000-000000000002')$$, 'assigned ANALISTA creates ABIERTO cut');
select is((select record_count from public.inventory_cuts where request_id = 'a6400000-0000-0000-0000-000000000002'), 2, 'cut stores exact record count');
select is((select first_export_seq from public.inventory_cuts where request_id = 'a6400000-0000-0000-0000-000000000002'), 1::bigint, 'first export sequence begins at one');
select is((select last_export_seq from public.inventory_cuts where request_id = 'a6400000-0000-0000-0000-000000000002'), 2::bigint, 'cut range is contiguous');
select is((select status from public.inventory_cuts where request_id = 'a6400000-0000-0000-0000-000000000002'), 'SNAPSHOT_CREATED'::public.cut_status, 'cut stops at SNAPSHOT_CREATED');
select is((select count(*) from public.inventory_cut_items where cut_id = (select id from public.inventory_cuts where request_id = 'a6400000-0000-0000-0000-000000000002')), 2::bigint, 'two immutable snapshots are created');
select ok((select snapshot ? 'received_at' and snapshot ? 'inventory_status_at_receive' and snapshot ? 'export_seq' from public.inventory_cut_items limit 1), 'snapshot contains export and receipt metadata');
select is((select (public.create_cut('a6100000-0000-0000-0000-000000000001', 'a6400000-0000-0000-0000-000000000002')->>'id')::uuid), (select id from public.inventory_cuts where request_id = 'a6400000-0000-0000-0000-000000000002'), 'same request_id returns the same cut');
select is((select count(*) from public.audit_events where event_type = 'CUT_CREATED' and entity_id = (select id from public.inventory_cuts where request_id = 'a6400000-0000-0000-0000-000000000002')), 1::bigint, 'idempotent replay writes CUT_CREATED once');
select throws_ok($$select public.correct_uncut_count('a6300000-0000-0000-0000-000000000001', '{"ubicacion":"A-01-01","codigo":"LEGACY","cantidad_contada":1}'::jsonb, 'too late')$$, '23514', 'A cut count record cannot be corrected', 'cut record cannot be normally corrected');
select throws_ok($$select public.create_cut('a6100000-0000-0000-0000-000000000001', 'a6400000-0000-0000-0000-000000000003')$$, '23514', 'No existen conteos nuevos para incluir en el corte.', 'different request cannot create an empty cut');
select is((select count(*) from public.list_inventory_cuts('a6100000-0000-0000-0000-000000000001')), 1::bigint, 'authorized analyst lists cuts');
select is((select count(*) from public.get_cut_items((select id from public.inventory_cuts where request_id = 'a6400000-0000-0000-0000-000000000002'), 100, null)), 2::bigint, 'cut detail reads snapshots, paginated');
select throws_ok($$select public.create_cut('a6100000-0000-0000-0000-000000000002', 'a6400000-0000-0000-0000-000000000004')$$, '42501', 'Only an assigned ANALISTA or ADMIN can create a cut', 'ANALISTA cannot create a cut in unassigned inventory');
reset role;

-- Late arrivals are intentionally uncut and become the next range.
insert into public.count_records (id, client_count_id, inventory_id, user_id, device_id, ubicacion, codigo, cantidad_contada, descripcion, captured_at, received_at)
values ('a6300000-0000-0000-0000-000000000003', 'a6310000-0000-0000-0000-000000000003', 'a6100000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000003', 'a6200000-0000-0000-0000-000000000001', 'A-01-03', 'LEGACY', 1, 'Legacy description', now(), '2026-09-17T11:00:00Z');
select set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000001', true); set local role authenticated;
select lives_ok($$select public.create_cut('a6100000-0000-0000-0000-000000000001', 'a6400000-0000-0000-0000-000000000005')$$, 'ADMIN creates later cut');
select is((select export_seq from public.count_records where id = 'a6300000-0000-0000-0000-000000000003'), 3::bigint, 'late arrival enters only the next cut with continuous sequence');
select is((select coalesce(count(*), 0) from (select count_record_id from public.inventory_cut_items group by count_record_id having count(*) > 1) duplicate_items), 0::bigint, 'no count record can appear in two cut snapshots');
select throws_ok($$insert into public.count_records (client_count_id, inventory_id, user_id, device_id, ubicacion, codigo, cantidad_contada, descripcion, captured_at) values (gen_random_uuid(), 'a6100000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000003', 'a6200000-0000-0000-0000-000000000001', 'A-01-01', 'LEGACY', 1, 'x', now())$$, '42501', 'permission denied for table count_records', 'authenticated direct count writes remain forbidden');
reset role;

-- Seven historical cuts and one operationally large cut remain set based.
do $$ declare n integer; begin
  for n in 1..7 loop
    insert into public.count_records (client_count_id, inventory_id, user_id, device_id, ubicacion, codigo, cantidad_contada, descripcion, captured_at, received_at)
    values (gen_random_uuid(), 'a6100000-0000-0000-0000-000000000004', 'a6000000-0000-0000-0000-000000000001', 'a6200000-0000-0000-0000-000000000002', 'F-01-01', 'SEVEN', n, 'Seven description', now(), now() + n * interval '1 second');
    perform set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000001', true);
    perform public.create_cut('a6100000-0000-0000-0000-000000000004', gen_random_uuid());
  end loop;
end $$;
select is((select array_agg(cut_number order by cut_number) from public.inventory_cuts where inventory_id = 'a6100000-0000-0000-0000-000000000004'), array[1,2,3,4,5,6,7], 'seven consecutive cuts are monotonic');
select is((select count(*) from public.inventory_cut_items i join public.inventory_cuts c on c.id=i.cut_id where c.inventory_id='a6100000-0000-0000-0000-000000000004'), 7::bigint, 'seven cuts retain seven snapshots without overlap');
insert into public.count_records (client_count_id, inventory_id, user_id, device_id, ubicacion, codigo, cantidad_contada, descripcion, captured_at, received_at)
select gen_random_uuid(), 'a6100000-0000-0000-0000-000000000003', 'a6000000-0000-0000-0000-000000000001', 'a6200000-0000-0000-0000-000000000002', 'F-02-01', 'LARGE', 1, 'Large description', now(), '2026-09-17T12:00:00Z'::timestamptz + n * interval '1 millisecond' from generate_series(1,2350) n;
select set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000001', true); set local role authenticated;
select lives_ok($$select public.create_cut('a6100000-0000-0000-0000-000000000003', 'a6400000-0000-0000-0000-000000000006')$$, '2,350 received records are cut in one set-based transaction');
select is((select record_count from public.inventory_cuts where request_id='a6400000-0000-0000-0000-000000000006'), 2350, 'large cut records exact count');
select is((select count(*) from public.inventory_cut_items i join public.inventory_cuts c on c.id=i.cut_id where c.request_id='a6400000-0000-0000-0000-000000000006'), 2350::bigint, 'large cut creates 2,350 snapshots');
select is((select count(distinct export_seq) from public.count_records where inventory_id='a6100000-0000-0000-0000-000000000003'), 2350::bigint, 'large cut export sequences are unique');
select is((select count(*) from public.count_records where inventory_id='a6100000-0000-0000-0000-000000000003' and cut_id is null), 0::bigint, 'large cut leaves no eligible row behind');
reset role;

select * from finish();
rollback;
