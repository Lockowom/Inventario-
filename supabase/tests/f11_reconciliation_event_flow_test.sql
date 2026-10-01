begin;
select plan(18);

insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('9a000000-0000-0000-0000-000000000001','authenticated','authenticated','event-admin@example.invalid','','{}','{}',now(),now()),
('9a000000-0000-0000-0000-000000000002','authenticated','authenticated','event-analyst@example.invalid','','{}','{}',now(),now()),
('9a000000-0000-0000-0000-000000000003','authenticated','authenticated','event-c1@example.invalid','','{}','{}',now(),now()),
('9a000000-0000-0000-0000-000000000004','authenticated','authenticated','event-c2@example.invalid','','{}','{}',now(),now());

insert into public.profiles(user_id,display_name,role,active) values
('9a000000-0000-0000-0000-000000000001','Event Admin','ADMIN',true),
('9a000000-0000-0000-0000-000000000002','Event Analyst','ANALISTA',true),
('9a000000-0000-0000-0000-000000000003','Event C1','CONTADOR',true),
('9a000000-0000-0000-0000-000000000004','Event C2','CONTADOR',true);

insert into public.inventories(id,name,created_by) values
('9b000000-0000-0000-0000-000000000001','F11 EVENT FLOW','9a000000-0000-0000-0000-000000000001');

insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values
('9b000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000002','9a000000-0000-0000-0000-000000000001'),
('9b000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000003','9a000000-0000-0000-0000-000000000001'),
('9b000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000004','9a000000-0000-0000-0000-000000000001');

insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by) values
('9b000000-0000-0000-0000-000000000001','EVT001P','Synthetic event batch','PARTIDA','TEST','9a000000-0000-0000-0000-000000000001');

select set_config('request.jwt.claim.sub','9a000000-0000-0000-0000-000000000001',true); set local role authenticated;
select public.prepare_inventory('9b000000-0000-0000-0000-000000000001');
select public.open_inventory('9b000000-0000-0000-0000-000000000001');
reset role;

select set_config('request.jwt.claim.sub','9a000000-0000-0000-0000-000000000003',true); set local role authenticated;
select * from public.sync_counts(
 '9b000000-0000-0000-0000-000000000001',
 '9c000000-0000-0000-0000-000000000003',
 'WEB','1.0.0','EVENT C1',
 '[{"client_count_id":"9d000000-0000-0000-0000-000000000003","ubicacion":"A-01-01","codigo":"EVT001P","partida":"LOT-EV","cantidad_contada":5,"captured_at":"2026-10-01T10:00:00Z"}]'
);
reset role;

select set_config('request.jwt.claim.sub','9a000000-0000-0000-0000-000000000004',true); set local role authenticated;
select * from public.sync_counts(
 '9b000000-0000-0000-0000-000000000001',
 '9c000000-0000-0000-0000-000000000004',
 'WEB','1.0.0','EVENT C2',
 '[{"client_count_id":"9d000000-0000-0000-0000-000000000004","ubicacion":"A-01-02","codigo":"EVT001P","partida":"LOT-EV","cantidad_contada":4,"captured_at":"2026-10-01T10:01:00Z"}]'
);
reset role;

select set_config('request.jwt.claim.sub','9a000000-0000-0000-0000-000000000002',true); set local role authenticated;
select * from public.sync_counts(
 '9b000000-0000-0000-0000-000000000001',
 '9c000000-0000-0000-0000-000000000002',
 'WEB','1.0.0','EVENT C3',
 '[{"client_count_id":"9d000000-0000-0000-0000-000000000002","ubicacion":"A-01-03","codigo":"EVT001P","partida":"LOT-EV","cantidad_contada":5,"captured_at":"2026-10-01T10:02:00Z"}]'
);
reset role;

insert into public.reconciliation_cases(
 inventory_id,codigo,reference_type,reference_value,anomaly_type,system_quantity,physical_quantity,first_count_record_id,created_by
)
select
 '9b000000-0000-0000-0000-000000000001','EVT001P','PARTIDA','LOT-EV','DIFERENCIA_CANTIDAD_PARTIDA',6,5,id,'9a000000-0000-0000-0000-000000000002'
from public.count_records where client_count_id='9d000000-0000-0000-0000-000000000003';

select set_config('request.jwt.claim.sub','9a000000-0000-0000-0000-000000000002',true); set local role authenticated;

select throws_ok(
 format('select public.assign_second_recount(%L,%L)',(select id from public.reconciliation_cases where inventory_id='9b000000-0000-0000-0000-000000000001'),'9a000000-0000-0000-0000-000000000003'),
 '23514','Invalid second counter','invalid C2 assignment is rejected'
);
select is((select count(*) from public.reconciliation_events where inventory_id='9b000000-0000-0000-0000-000000000001'),0::bigint,'rejected assignment creates no event');

select lives_ok(
 format('select public.assign_second_recount(%L,%L)',(select id from public.reconciliation_cases where inventory_id='9b000000-0000-0000-0000-000000000001'),'9a000000-0000-0000-0000-000000000004'),
 'valid C2 assignment succeeds'
);
select is((select count(*) from public.reconciliation_events where inventory_id='9b000000-0000-0000-0000-000000000001' and event_type='SECOND_ASSIGNED'),1::bigint,'C2 assignment emits one event');
reset role;

select set_config('request.jwt.claim.sub','9a000000-0000-0000-0000-000000000004',true); set local role authenticated;
select lives_ok(
 format('select public.record_second_recount(%L,%L)',(select id from public.reconciliation_cases where inventory_id='9b000000-0000-0000-0000-000000000001'),(select id from public.count_records where client_count_id='9d000000-0000-0000-0000-000000000004')),
 'assigned C2 can record recount'
);
select is((select status::text from public.reconciliation_cases where inventory_id='9b000000-0000-0000-0000-000000000001'),'REQUIERE_3ER_CONTEO','C1/C2 mismatch requires C3');
reset role;

select set_config('request.jwt.claim.sub','9a000000-0000-0000-0000-000000000002',true); set local role authenticated;
select is((select count(*) from public.reconciliation_events where inventory_id='9b000000-0000-0000-0000-000000000001' and event_type='SECOND_RECORDED'),1::bigint,'C2 record emits one event');

select lives_ok(
 format('select public.assign_third_recount(%L,%L)',(select id from public.reconciliation_cases where inventory_id='9b000000-0000-0000-0000-000000000001'),'9a000000-0000-0000-0000-000000000002'),
 'assigned analyst may take C3'
);
select is((select count(*) from public.reconciliation_events where inventory_id='9b000000-0000-0000-0000-000000000001' and event_type='THIRD_ASSIGNED'),1::bigint,'C3 assignment emits one event');

select lives_ok(
 format('select public.record_third_recount(%L,%L)',(select id from public.reconciliation_cases where inventory_id='9b000000-0000-0000-0000-000000000001'),(select id from public.count_records where client_count_id='9d000000-0000-0000-0000-000000000002')),
 'assigned analyst records C3'
);
select is((select status::text from public.reconciliation_cases where inventory_id='9b000000-0000-0000-0000-000000000001'),'FISICO_CONFIRMADO','C3 confirms physical quantity');
select is((select count(*) from public.reconciliation_events where inventory_id='9b000000-0000-0000-0000-000000000001' and event_type='THIRD_RECORDED'),1::bigint,'C3 record emits one event');

select throws_ok(
 format('select public.resolve_reconciliation(%L,%L,%L)',(select id from public.reconciliation_cases where inventory_id='9b000000-0000-0000-0000-000000000001'),'SIN_AJUSTE',''),
 '23514','Physical confirmation and reason required','blank resolution reason is rejected'
);
select is((select count(*) from public.reconciliation_events where inventory_id='9b000000-0000-0000-0000-000000000001'),4::bigint,'rejected resolution creates no event');

select lives_ok(
 format('select public.resolve_reconciliation(%L,%L,%L)',(select id from public.reconciliation_cases where inventory_id='9b000000-0000-0000-0000-000000000001'),'SIN_AJUSTE','Synthetic evidence confirmed'),
 'valid analyst resolution succeeds'
);
select is((select count(*) from public.reconciliation_events where inventory_id='9b000000-0000-0000-0000-000000000001' and event_type='RESOLVED'),1::bigint,'resolution emits one event');
select is((select count(*) from public.reconciliation_events where inventory_id='9b000000-0000-0000-0000-000000000001'),5::bigint,'successful lifecycle emits exactly five events');
select is((select status::text from public.reconciliation_cases where inventory_id='9b000000-0000-0000-0000-000000000001'),'RESUELTO','case closes only after explicit analyst resolution');

reset role;
select * from finish();
rollback;
