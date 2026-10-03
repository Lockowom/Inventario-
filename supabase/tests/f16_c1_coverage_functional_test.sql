begin;
select plan(17);

insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('f1600000-0000-0000-0000-000000000001','authenticated','authenticated','f16-admin@example.invalid','','{}','{}',now(),now()),
('f1600000-0000-0000-0000-000000000002','authenticated','authenticated','f16-analyst@example.invalid','','{}','{}',now(),now()),
('f1600000-0000-0000-0000-000000000003','authenticated','authenticated','f16-c1@example.invalid','','{}','{}',now(),now()),
('f1600000-0000-0000-0000-000000000004','authenticated','authenticated','f16-c2@example.invalid','','{}','{}',now(),now());

insert into public.profiles(user_id,display_name,role,active) values
('f1600000-0000-0000-0000-000000000001','F16 Admin','ADMIN',true),
('f1600000-0000-0000-0000-000000000002','F16 Analyst','ANALISTA',true),
('f1600000-0000-0000-0000-000000000003','F16 C1','CONTADOR',true),
('f1600000-0000-0000-0000-000000000004','F16 C2','CONTADOR',true);

insert into public.inventories(id,name,created_by) values
('f1610000-0000-0000-0000-000000000001','F16 COVERAGE','f1600000-0000-0000-0000-000000000001');

insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values
('f1610000-0000-0000-0000-000000000001','f1600000-0000-0000-0000-000000000002','f1600000-0000-0000-0000-000000000001'),
('f1610000-0000-0000-0000-000000000001','f1600000-0000-0000-0000-000000000003','f1600000-0000-0000-0000-000000000001'),
('f1610000-0000-0000-0000-000000000001','f1600000-0000-0000-0000-000000000004','f1600000-0000-0000-0000-000000000001');

select set_config('request.jwt.claim.sub','f1600000-0000-0000-0000-000000000001',true);
set local role authenticated;

select * from public.import_inventory_master(
 'f1610000-0000-0000-0000-000000000001',
 '[
  {"codigo":"F16B001P","descripcion":"F16 batch"},
  {"codigo":"F16S001S","descripcion":"F16 serial"},
  {"codigo":"F16LEGACY","descripcion":"F16 legacy"}
 ]'::jsonb,
 'F16 TEST',
 'f16-master'
);

select * from public.import_inventory_system_reference(
 'f1610000-0000-0000-0000-000000000001',
 '[
  {"codigo":"F16B001P","reference_value":"LOT-A","quantity":10,"available_quantity":10,"unit_code":"UNI"},
  {"codigo":"F16S001S","reference_value":"SYS-001","quantity":1,"available_quantity":1,"unit_code":"UNI"},
  {"codigo":"F16LEGACY","quantity":3,"available_quantity":3,"unit_code":"UNI"}
 ]'::jsonb,
 'F16 TEST',
 'f16-rp'
);

select public.prepare_inventory('f1610000-0000-0000-0000-000000000001');
select public.open_inventory('f1610000-0000-0000-0000-000000000001');
reset role;

select set_config('request.jwt.claim.sub','f1600000-0000-0000-0000-000000000003',true);
set local role authenticated;
select * from public.sync_counts(
 'f1610000-0000-0000-0000-000000000001',
 'f1620000-0000-0000-0000-000000000003',
 'WEB','1.0.0','F16 C1',
 '[
  {"client_count_id":"f1630000-0000-0000-0000-000000000001","ubicacion":"A-01-01","codigo":"F16B001P","partida":"LOT-A","cantidad_contada":4,"captured_at":"2026-10-03T09:00:00Z"},
  {"client_count_id":"f1630000-0000-0000-0000-000000000002","ubicacion":"B-01-01","codigo":"F16B001P","partida":"LOT-A","cantidad_contada":5,"captured_at":"2026-10-03T09:01:00Z"},
  {"client_count_id":"f1630000-0000-0000-0000-000000000003","ubicacion":"C-01-01","codigo":"F16B001P","partida":"LOT-NEW","cantidad_contada":2,"captured_at":"2026-10-03T09:02:00Z"},
  {"client_count_id":"f1630000-0000-0000-0000-000000000004","ubicacion":"D-01-01","codigo":"F16LEGACY","cantidad_contada":3,"captured_at":"2026-10-03T09:03:00Z"}
 ]'::jsonb
);
reset role;

select set_config('request.jwt.claim.sub','f1600000-0000-0000-0000-000000000002',true);
set local role authenticated;

select lives_ok(
 $$select public.finalize_c1_coverage('f1610000-0000-0000-0000-000000000001'::uuid,true)$$,
 'manager finalizes C1 after confirming device synchronization'
);

select is(
 public.get_inventory_lifecycle('f1610000-0000-0000-0000-000000000001')->>'c1_status',
 'COMPLETADO',
 'lifecycle reports completed C1'
);

select is(
 (public.get_inventory_lifecycle('f1610000-0000-0000-0000-000000000001')->>'c1_count_records')::integer,
 4,
 'C1 snapshot stores four physical observations'
);

select is(
 (public.get_inventory_lifecycle('f1610000-0000-0000-0000-000000000001')->>'open_cases')::integer,
 3,
 'final reconciliation creates exactly three real discrepancies'
);

select is(
 (public.get_inventory_lifecycle('f1610000-0000-0000-0000-000000000001')->>'queued_missions')::integer,
 3,
 'every final discrepancy creates one C2 mission'
);
reset role;

select set_config('request.jwt.claim.sub','f1600000-0000-0000-0000-000000000003',true);
set local role authenticated;
select is(
 (select result_status from public.sync_counts(
  'f1610000-0000-0000-0000-000000000001',
  'f1620000-0000-0000-0000-000000000003',
  'WEB','1.0.0','F16 C1',
  '[{"client_count_id":"f1630000-0000-0000-0000-000000000005","ubicacion":"F-01-01","codigo":"F16LEGACY","cantidad_contada":1,"captured_at":"2026-10-03T10:00:00Z"}]'::jsonb
 )),
 'REJECTED',
 'new normal C1 capture is rejected after coverage close'
);
reset role;

-- Make the test queue deterministic: system-only serial first, then LOT-A, then LOT-NEW.
update public.recount_missions m
set created_at=case
 when r.anomaly_type='SERIE_SISTEMA_NO_CONTADA' then '2026-10-03T10:10:00Z'::timestamptz
 when r.reference_value='LOT-A' then '2026-10-03T10:11:00Z'::timestamptz
 else '2026-10-03T10:12:00Z'::timestamptz
end
from public.reconciliation_cases r
where r.id=m.case_id
  and m.inventory_id='f1610000-0000-0000-0000-000000000001';

select set_config('request.jwt.claim.sub','f1600000-0000-0000-0000-000000000004',true);
set local role authenticated;

select lives_ok(
 $$select public.claim_next_recount_mission('f1610000-0000-0000-0000-000000000001'::uuid)$$,
 'C2 counter claims the missing serial mission'
);

select is(
 public.get_my_recount_queue('f1610000-0000-0000-0000-000000000001')->'active'->>'reference_value',
 'SYS-001',
 'system-only serial is the first C2 mission'
);

select is(
 jsonb_array_length(public.get_my_recount_queue('f1610000-0000-0000-0000-000000000001')->'active'->'known_locations'),
 0,
 'system-only reference starts without a fake location'
);

select lives_ok(
 $$select public.complete_my_recount_mission_zero(
  ((public.get_my_recount_queue('f1610000-0000-0000-0000-000000000001')->'active'->>'id')::uuid)
 )$$,
 'counter can explicitly confirm a missing reference as zero'
);
reset role;

select is(
 (select status::text from public.reconciliation_cases where inventory_id='f1610000-0000-0000-0000-000000000001' and anomaly_type='SERIE_SISTEMA_NO_CONTADA'),
 'FISICO_CONFIRMADO',
 'zero-confirmed serial becomes physically confirmed'
);

select set_config('request.jwt.claim.sub','f1600000-0000-0000-0000-000000000004',true);
set local role authenticated;

select lives_ok(
 $$select public.claim_next_recount_mission('f1610000-0000-0000-0000-000000000001'::uuid)$$,
 'C2 counter claims the batch difference mission'
);

select is(
 (select result_status from public.sync_counts(
  'f1610000-0000-0000-0000-000000000001',
  'f1620000-0000-0000-0000-000000000004',
  'WEB','1.0.0','F16 C2',
  '[{"client_count_id":"f1640000-0000-0000-0000-000000000001","ubicacion":"A-01-01","codigo":"F16B001P","partida":"LOT-A","cantidad_contada":9,"captured_at":"2026-10-03T11:00:00Z"}]'::jsonb
 )),
 'ACCEPTED',
 'active C2 count remains accepted after C1 is closed'
);

select is(
 jsonb_array_length(public.get_my_recount_queue('f1610000-0000-0000-0000-000000000001')->'active'->'observations'),
 1,
 'C2 sync is attached to its mission atomically'
);

select lives_ok(
 $$select public.complete_my_recount_mission(
  ((public.get_my_recount_queue('f1610000-0000-0000-0000-000000000001')->'active'->>'id')::uuid)
 )$$,
 'matching C2 completes'
);
reset role;

select is(
 (select status::text from public.reconciliation_cases where inventory_id='f1610000-0000-0000-0000-000000000001' and reference_value='LOT-A'),
 'FISICO_CONFIRMADO',
 'matching C2 confirms the final C1 physical total'
);

select set_config('request.jwt.claim.sub','f1600000-0000-0000-0000-000000000002',true);
set local role authenticated;
select throws_ok(
 $$select public.close_inventory('f1610000-0000-0000-0000-000000000001'::uuid)$$,
 '23514',
 'All reconciliation cases must be resolved before inventory closure',
 'inventory close is blocked while reconciliation work remains'
);
reset role;

select * from finish();
rollback;
