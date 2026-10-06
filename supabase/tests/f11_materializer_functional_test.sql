begin;
select plan(18);
insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('95000000-0000-0000-0000-000000000001','authenticated','authenticated','mat-admin@example.invalid','','{}','{}',now(),now()),
('95000000-0000-0000-0000-000000000002','authenticated','authenticated','mat-analyst@example.invalid','','{}','{}',now(),now()),
('95000000-0000-0000-0000-000000000003','authenticated','authenticated','mat-counter@example.invalid','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,active) values
('95000000-0000-0000-0000-000000000001','MAT Admin','ADMIN',true),
('95000000-0000-0000-0000-000000000002','MAT Analyst','ANALISTA',true),
('95000000-0000-0000-0000-000000000003','MAT Counter','CONTADOR',true);
insert into public.inventories(id,name,created_by) values('96000000-0000-0000-0000-000000000001','F11 MATERIALIZER','95000000-0000-0000-0000-000000000001');
insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values
('96000000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000002','95000000-0000-0000-0000-000000000001'),
('96000000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000003','95000000-0000-0000-0000-000000000001');
insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by) values
('96000000-0000-0000-0000-000000000001','MAT001S','Synthetic serial','SERIAL','TEST','95000000-0000-0000-0000-000000000001'),
('96000000-0000-0000-0000-000000000001','MAT002P','Synthetic batch','PARTIDA','TEST','95000000-0000-0000-0000-000000000001'),
('96000000-0000-0000-0000-000000000001','MAT003','Synthetic legacy','LEGACY','TEST','95000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000001',true); set local role authenticated;
select * from public.import_inventory_system_reference('96000000-0000-0000-0000-000000000001',
'[{"codigo":"MAT001S","reference_value":"SYS-S","quantity":1},{"codigo":"MAT002P","reference_value":"LOT-A","quantity":5},{"codigo":"MAT002P","reference_value":"LOT-SYS","quantity":2},{"codigo":"MAT003","quantity":4}]','SYNTHETIC','F11-MAT');
select public.prepare_inventory('96000000-0000-0000-0000-000000000001'); select public.open_inventory('96000000-0000-0000-0000-000000000001'); reset role;
select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000003',true); set local role authenticated;
select * from public.sync_counts('96000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000003','WEB','1.0.0','MAT',
'[
{"client_count_id":"98000000-0000-0000-0000-000000000001","ubicacion":"A-01-01","codigo":"MAT001S","serie":"PHY-S","cantidad_contada":1,"captured_at":"2026-10-01T09:00:00Z"},
{"client_count_id":"98000000-0000-0000-0000-000000000005","ubicacion":"A-01-02","codigo":"MAT001S","serie":"PHY-S","cantidad_contada":1,"captured_at":"2026-10-01T09:00:30Z"},
{"client_count_id":"98000000-0000-0000-0000-000000000002","ubicacion":"A-01-01","codigo":"MAT002P","partida":"LOT-A","cantidad_contada":3,"captured_at":"2026-10-01T09:01:00Z"},
{"client_count_id":"98000000-0000-0000-0000-000000000003","ubicacion":"A-01-01","codigo":"MAT002P","partida":"LOT-PHY","cantidad_contada":2,"captured_at":"2026-10-01T09:02:00Z"},
{"client_count_id":"98000000-0000-0000-0000-000000000004","ubicacion":"A-01-01","codigo":"MAT003","cantidad_contada":2,"captured_at":"2026-10-01T09:03:00Z"}
]');
reset role;
select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000002',true); set local role authenticated;
select is((select created_count from public.materialize_reconciliation_cases('96000000-0000-0000-0000-000000000001')),5,'C1 materialization creates only observed anomalies');
select is((select count(*) from public.reconciliation_cases where inventory_id='96000000-0000-0000-0000-000000000001' and anomaly_type='SERIE_FISICA_NO_EN_SISTEMA'),1::bigint,'physical-only serial detected');
select is((select count(*) from public.reconciliation_cases where inventory_id='96000000-0000-0000-0000-000000000001' and anomaly_type='DUPLICADO_SERIE'),1::bigint,'duplicate serial detected');
select is((select count(*) from public.reconciliation_cases where inventory_id='96000000-0000-0000-0000-000000000001' and anomaly_type='SERIE_SISTEMA_NO_CONTADA'),0::bigint,'C1 does not treat an unvisited system serial as missing');
select is((select count(*) from public.reconciliation_cases where inventory_id='96000000-0000-0000-0000-000000000001' and anomaly_type='DIFERENCIA_CANTIDAD_PARTIDA'),1::bigint,'batch quantity difference detected');
select is((select count(*) from public.reconciliation_cases where inventory_id='96000000-0000-0000-0000-000000000001' and anomaly_type='PARTIDA_FISICA_NO_EN_SISTEMA'),1::bigint,'physical-only batch detected');
select is((select count(*) from public.reconciliation_cases where inventory_id='96000000-0000-0000-0000-000000000001' and anomaly_type='PARTIDA_SISTEMA_NO_CONTADA'),0::bigint,'C1 does not treat an unvisited system batch as missing');
select is((select count(*) from public.reconciliation_cases where inventory_id='96000000-0000-0000-0000-000000000001' and anomaly_type='DIFERENCIA_CANTIDAD_SKU'),1::bigint,'legacy quantity difference detected');
select is(((public.get_reconciliation_summary('96000000-0000-0000-0000-000000000001')->'summary'->>'open')::integer),5,'current snapshot summary reports five C1-visible cases');
select is(((public.get_reconciliation_summary('96000000-0000-0000-0000-000000000001')->'anomalies'->>'DUPLICADO_SERIE')::integer),1,'current snapshot summary preserves duplicate serial breakdown');
select is((select created_count from public.materialize_reconciliation_cases('96000000-0000-0000-0000-000000000001')),0,'second materialization creates no duplicates');
select is((select count(*) from public.reconciliation_cases where inventory_id='96000000-0000-0000-0000-000000000001'),5::bigint,'C1-visible case count remains stable after replay');
select is((select first_count_record_id from public.reconciliation_cases where inventory_id='96000000-0000-0000-0000-000000000001' and anomaly_type='DUPLICADO_SERIE'),(select id from public.count_records where client_count_id='98000000-0000-0000-0000-000000000001'),'duplicate serial anchors earliest accepted physical count');
select ok(not exists(select 1 from public.reconciliation_cases where inventory_id='96000000-0000-0000-0000-000000000001' and status='RESUELTO'),'materialization never auto-resolves cases');
reset role;
select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000001',true); set local role authenticated;
select is((select status::text from public.complete_first_count('96000000-0000-0000-0000-000000000001')),'C1_COMPLETADO','manager completes C1 explicitly');
select is((select status::text from public.start_final_reconciliation('96000000-0000-0000-0000-000000000001')),'CONCILIACION_FINAL','manager starts final reconciliation explicitly');
reset role;
select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000002',true); set local role authenticated;
select is((select created_count from public.materialize_reconciliation_cases('96000000-0000-0000-0000-000000000001')),2,'final reconciliation materializes the previously unvisited system references');
select is((select count(*) from public.reconciliation_cases where inventory_id='96000000-0000-0000-0000-000000000001' and anomaly_type in ('SERIE_SISTEMA_NO_CONTADA','PARTIDA_SISTEMA_NO_CONTADA')),2::bigint,'final reconciliation exposes actual system-only findings');
reset role;
select * from finish();
rollback;
