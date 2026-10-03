begin;
select plan(17);

insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('f1500000-0000-0000-0000-000000000001','authenticated','authenticated','f15-admin@example.invalid','','{}','{}',now(),now()),
('f1500000-0000-0000-0000-000000000002','authenticated','authenticated','f15-analyst@example.invalid','','{}','{}',now(),now()),
('f1500000-0000-0000-0000-000000000003','authenticated','authenticated','f15-c1@example.invalid','','{}','{}',now(),now()),
('f1500000-0000-0000-0000-000000000004','authenticated','authenticated','f15-c2@example.invalid','','{}','{}',now(),now());

insert into public.profiles(user_id,display_name,role,active) values
('f1500000-0000-0000-0000-000000000001','F15 Admin','ADMIN',true),
('f1500000-0000-0000-0000-000000000002','F15 Analyst','ANALISTA',true),
('f1500000-0000-0000-0000-000000000003','F15 C1','CONTADOR',true),
('f1500000-0000-0000-0000-000000000004','F15 C2','CONTADOR',true);

insert into public.inventories(id,name,created_by) values
('f1510000-0000-0000-0000-000000000001','F15 MISSION FLOW','f1500000-0000-0000-0000-000000000001');

insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values
('f1510000-0000-0000-0000-000000000001','f1500000-0000-0000-0000-000000000002','f1500000-0000-0000-0000-000000000001'),
('f1510000-0000-0000-0000-000000000001','f1500000-0000-0000-0000-000000000003','f1500000-0000-0000-0000-000000000001'),
('f1510000-0000-0000-0000-000000000001','f1500000-0000-0000-0000-000000000004','f1500000-0000-0000-0000-000000000001');

insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by) values
('f1510000-0000-0000-0000-000000000001','F15A001P','F15 batch match','PARTIDA','TEST','f1500000-0000-0000-0000-000000000001'),
('f1510000-0000-0000-0000-000000000001','F15A002P','F15 batch C3','PARTIDA','TEST','f1500000-0000-0000-0000-000000000001');

select set_config('request.jwt.claim.sub','f1500000-0000-0000-0000-000000000001',true);
set local role authenticated;
select public.prepare_inventory('f1510000-0000-0000-0000-000000000001');
select public.open_inventory('f1510000-0000-0000-0000-000000000001');
reset role;

select set_config('request.jwt.claim.sub','f1500000-0000-0000-0000-000000000003',true);
set local role authenticated;
select * from public.sync_counts(
 'f1510000-0000-0000-0000-000000000001','f1520000-0000-0000-0000-000000000003',
 'WEB','1.0.0','F15 C1',
 '[
   {"client_count_id":"f1530000-0000-0000-0000-000000000001","ubicacion":"A-01-01","codigo":"F15A001P","partida":"LOT-A","cantidad_contada":4,"captured_at":"2026-10-03T10:00:00Z"},
   {"client_count_id":"f1530000-0000-0000-0000-000000000002","ubicacion":"B-01-01","codigo":"F15A001P","partida":"LOT-A","cantidad_contada":5,"captured_at":"2026-10-03T10:01:00Z"},
   {"client_count_id":"f1530000-0000-0000-0000-000000000003","ubicacion":"A-02-01","codigo":"F15A002P","partida":"LOT-B","cantidad_contada":10,"captured_at":"2026-10-03T10:02:00Z"}
 ]'
);
reset role;

insert into public.reconciliation_cases(
 inventory_id,codigo,reference_type,reference_value,anomaly_type,system_quantity,physical_quantity,status,first_count_record_id,created_by,source_fingerprint
)
select 'f1510000-0000-0000-0000-000000000001','F15A001P','PARTIDA','LOT-A','DIFERENCIA_CANTIDAD_PARTIDA',10,9,'REQUIERE_2DO_CONTEO',id,'f1500000-0000-0000-0000-000000000002','F15-TEST-FP'
from public.count_records where client_count_id='f1530000-0000-0000-0000-000000000001';

insert into public.reconciliation_cases(
 inventory_id,codigo,reference_type,reference_value,anomaly_type,system_quantity,physical_quantity,status,first_count_record_id,created_by,source_fingerprint
)
select 'f1510000-0000-0000-0000-000000000001','F15A002P','PARTIDA','LOT-B','DIFERENCIA_CANTIDAD_PARTIDA',12,10,'REQUIERE_2DO_CONTEO',id,'f1500000-0000-0000-0000-000000000002','F15-TEST-FP'
from public.count_records where client_count_id='f1530000-0000-0000-0000-000000000003';

insert into public.recount_missions(case_id,inventory_id,round,created_by)
select id,inventory_id,2,'f1500000-0000-0000-0000-000000000002'
from public.reconciliation_cases
where inventory_id='f1510000-0000-0000-0000-000000000001';

select is((select count(*) from public.recount_missions where inventory_id='f1510000-0000-0000-0000-000000000001' and round=2 and status='QUEUED'),2::bigint,'two C2 missions are queued');

select set_config('request.jwt.claim.sub','f1500000-0000-0000-0000-000000000003',true);
set local role authenticated;
select is((public.get_my_recount_queue('f1510000-0000-0000-0000-000000000001')->>'queued_count')::integer,0,'C1 counter cannot claim own C2 work');
reset role;

select set_config('request.jwt.claim.sub','f1500000-0000-0000-0000-000000000004',true);
set local role authenticated;
select lives_ok($$select public.claim_next_recount_mission('f1510000-0000-0000-0000-000000000001'::uuid)$$,'C2 counter claims first mission');
select is(((public.get_my_recount_queue('f1510000-0000-0000-0000-000000000001')->'active'->>'round')::integer),2,'claimed mission is C2');

select * from public.sync_counts(
 'f1510000-0000-0000-0000-000000000001','f1520000-0000-0000-0000-000000000004',
 'WEB','1.0.0','F15 C2',
 '[
   {"client_count_id":"f1540000-0000-0000-0000-000000000001","ubicacion":"A-01-01","codigo":"F15A001P","partida":"LOT-A","cantidad_contada":4,"captured_at":"2026-10-03T11:00:00Z"},
   {"client_count_id":"f1540000-0000-0000-0000-000000000002","ubicacion":"C-01-01","codigo":"F15A001P","partida":"LOT-A","cantidad_contada":5,"captured_at":"2026-10-03T11:01:00Z"}
 ]'
);

select lives_ok($$select public.add_my_recount_observation(
 ((public.get_my_recount_queue('f1510000-0000-0000-0000-000000000001')->'active'->>'id')::uuid),
 'f1540000-0000-0000-0000-000000000001'::uuid)$$,'first C2 location is attached');

select lives_ok($$select public.add_my_recount_observation(
 ((public.get_my_recount_queue('f1510000-0000-0000-0000-000000000001')->'active'->>'id')::uuid),
 'f1540000-0000-0000-0000-000000000002'::uuid)$$,'second C2 location is attached');

select lives_ok($$select public.complete_my_recount_mission(
 ((public.get_my_recount_queue('f1510000-0000-0000-0000-000000000001')->'active'->>'id')::uuid))$$,'matching multi-location C2 completes');
reset role;

select is((select confirmed_physical_quantity from public.reconciliation_cases where inventory_id='f1510000-0000-0000-0000-000000000001' and codigo='F15A001P'),9,'C2 sums locations and confirms C1 total');
select is((select status::text from public.reconciliation_cases where inventory_id='f1510000-0000-0000-0000-000000000001' and codigo='F15A001P'),'FISICO_CONFIRMADO','matching C2 confirms the physical result');

select set_config('request.jwt.claim.sub','f1500000-0000-0000-0000-000000000004',true);
set local role authenticated;
select lives_ok($$select public.claim_next_recount_mission('f1510000-0000-0000-0000-000000000001'::uuid)$$,'C2 counter claims second mission');

select * from public.sync_counts(
 'f1510000-0000-0000-0000-000000000001','f1520000-0000-0000-0000-000000000004',
 'WEB','1.0.0','F15 C2',
 '[
   {"client_count_id":"f1540000-0000-0000-0000-000000000003","ubicacion":"A-02-01","codigo":"F15A002P","partida":"LOT-B","cantidad_contada":4,"captured_at":"2026-10-03T11:02:00Z"},
   {"client_count_id":"f1540000-0000-0000-0000-000000000004","ubicacion":"B-02-01","codigo":"F15A002P","partida":"LOT-B","cantidad_contada":5,"captured_at":"2026-10-03T11:03:00Z"}
 ]'
);
select public.add_my_recount_observation(((public.get_my_recount_queue('f1510000-0000-0000-0000-000000000001')->'active'->>'id')::uuid),'f1540000-0000-0000-0000-000000000003');
select public.add_my_recount_observation(((public.get_my_recount_queue('f1510000-0000-0000-0000-000000000001')->'active'->>'id')::uuid),'f1540000-0000-0000-0000-000000000004');
select lives_ok($$select public.complete_my_recount_mission(
 ((public.get_my_recount_queue('f1510000-0000-0000-0000-000000000001')->'active'->>'id')::uuid))$$,'mismatching C2 completes and escalates');
reset role;

select is((select status::text from public.reconciliation_cases where inventory_id='f1510000-0000-0000-0000-000000000001' and codigo='F15A002P'),'REQUIERE_3ER_CONTEO','C1/C2 mismatch requires C3');
select is((select count(*) from public.recount_missions m join public.reconciliation_cases r on r.id=m.case_id where r.codigo='F15A002P' and m.round=3 and m.status='QUEUED'),1::bigint,'C3 mission is created automatically');

select set_config('request.jwt.claim.sub','f1500000-0000-0000-0000-000000000002',true);
set local role authenticated;
select lives_ok($$select public.claim_next_recount_mission('f1510000-0000-0000-0000-000000000001'::uuid)$$,'analyst claims C3 from queue');

select * from public.sync_counts(
 'f1510000-0000-0000-0000-000000000001','f1520000-0000-0000-0000-000000000002',
 'WEB','1.0.0','F15 C3',
 '[
   {"client_count_id":"f1550000-0000-0000-0000-000000000001","ubicacion":"A-02-01","codigo":"F15A002P","partida":"LOT-B","cantidad_contada":6,"captured_at":"2026-10-03T12:00:00Z"},
   {"client_count_id":"f1550000-0000-0000-0000-000000000002","ubicacion":"C-02-01","codigo":"F15A002P","partida":"LOT-B","cantidad_contada":4,"captured_at":"2026-10-03T12:01:00Z"}
 ]'
);
select public.add_my_recount_observation(((public.get_my_recount_queue('f1510000-0000-0000-0000-000000000001')->'active'->>'id')::uuid),'f1550000-0000-0000-0000-000000000001');
select public.add_my_recount_observation(((public.get_my_recount_queue('f1510000-0000-0000-0000-000000000001')->'active'->>'id')::uuid),'f1550000-0000-0000-0000-000000000002');
select lives_ok($$select public.complete_my_recount_mission(
 ((public.get_my_recount_queue('f1510000-0000-0000-0000-000000000001')->'active'->>'id')::uuid))$$,'multi-location C3 completes');
reset role;

select is((select confirmed_physical_quantity from public.reconciliation_cases where inventory_id='f1510000-0000-0000-0000-000000000001' and codigo='F15A002P'),10,'C3 total becomes confirmed physical quantity');
select is((select status::text from public.reconciliation_cases where inventory_id='f1510000-0000-0000-0000-000000000001' and codigo='F15A002P'),'FISICO_CONFIRMADO','C3 confirms the case');
select is((select count(*) from public.reconciliation_events e join public.reconciliation_cases r on r.id=e.case_id where r.inventory_id='f1510000-0000-0000-0000-000000000001'),6::bigint,'single event ledger records C2/C3 claims and completions');

select * from finish();
rollback;
