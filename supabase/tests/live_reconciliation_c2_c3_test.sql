begin;
select plan(25);

insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('c2120000-0000-0000-0000-000000000001','authenticated','authenticated','live-admin@example.invalid','','{}','{}',now(),now()),
('c2120000-0000-0000-0000-000000000002','authenticated','authenticated','live-c1@example.invalid','','{}','{}',now(),now()),
('c2120000-0000-0000-0000-000000000003','authenticated','authenticated','live-c2@example.invalid','','{}','{}',now(),now()),
('c2120000-0000-0000-0000-000000000004','authenticated','authenticated','live-c3@example.invalid','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,active) values
('c2120000-0000-0000-0000-000000000001','Live admin','ADMIN',true),
('c2120000-0000-0000-0000-000000000002','Live C1','CONTADOR',true),
('c2120000-0000-0000-0000-000000000003','Live C2','CONTADOR',true),
('c2120000-0000-0000-0000-000000000004','Live C3','ANALISTA',true);
insert into public.inventories(id,name,created_by) values
('c2130000-0000-0000-0000-000000000001','LIVE C2 C3','c2120000-0000-0000-0000-000000000001');
insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values
('c2130000-0000-0000-0000-000000000001','c2120000-0000-0000-0000-000000000001','c2120000-0000-0000-0000-000000000001'),
('c2130000-0000-0000-0000-000000000001','c2120000-0000-0000-0000-000000000002','c2120000-0000-0000-0000-000000000001'),
('c2130000-0000-0000-0000-000000000001','c2120000-0000-0000-0000-000000000003','c2120000-0000-0000-0000-000000000001'),
('c2130000-0000-0000-0000-000000000001','c2120000-0000-0000-0000-000000000004','c2120000-0000-0000-0000-000000000001');

select set_config('request.jwt.claim.sub','c2120000-0000-0000-0000-000000000001',true);
set local role authenticated;
select * from public.import_inventory_master('c2130000-0000-0000-0000-000000000001','[{"codigo":"LIVEBATCHP","descripcion":"Live batch"},{"codigo":"LIVELEGACY","descripcion":"Live legacy"},{"codigo":"LIVEAGREE","descripcion":"Live consensus"},{"codigo":"LIVESERIALS","descripcion":"Live serial"}]'::jsonb,'TEST','live-master');
select * from public.import_inventory_system_reference('c2130000-0000-0000-0000-000000000001','[{"codigo":"LIVEBATCHP","reference_value":"LOT-1","quantity":10,"available_quantity":10,"unit_code":"UNI"},{"codigo":"LIVELEGACY","quantity":10,"available_quantity":10,"unit_code":"UNI"},{"codigo":"LIVEAGREE","quantity":10,"available_quantity":10,"unit_code":"UNI"},{"codigo":"LIVESERIALS","reference_value":"SER-EXPECTED","quantity":1,"available_quantity":1,"unit_code":"UNI"}]'::jsonb,'TEST','live-reference');
select public.prepare_inventory('c2130000-0000-0000-0000-000000000001');
select public.open_inventory('c2130000-0000-0000-0000-000000000001');
reset role;

select set_config('request.jwt.claim.sub','c2120000-0000-0000-0000-000000000002',true);
set local role authenticated;
select is((select result_status from public.sync_counts('c2130000-0000-0000-0000-000000000001','c2140000-0000-0000-0000-000000000002','WEB','0.0.00.02','LIVE C1','[{"client_count_id":"c2150000-0000-0000-0000-000000000001","ubicacion":"A-01-01","codigo":"LIVEBATCHP","partida":"LOT-1","cantidad_contada":8,"captured_at":"2026-11-11T10:00:00Z"}]'::jsonb)),'ACCEPTED','C1 partial count is accepted while inventory remains open');
reset role;
select is((select c1_completed_at is null from public.inventories where id='c2130000-0000-0000-0000-000000000001'),true,'C2 does not require C1 completion');
select is((select count(*) from public.reconciliation_cases where inventory_id='c2130000-0000-0000-0000-000000000001' and codigo='LIVEBATCHP' and status='REQUIERE_2DO_CONTEO'),1::bigint,'partial batch difference creates one live C2 case');
select is((select count(*) from public.recount_missions where inventory_id='c2130000-0000-0000-0000-000000000001' and round=2 and status='QUEUED' and source_cut_id is null),1::bigint,'live C2 is queued without a cut');
set local role authenticated;
select is((select result_status from public.sync_counts('c2130000-0000-0000-0000-000000000001','c2140000-0000-0000-0000-000000000002','WEB','0.0.00.02','LIVE C1','[{"client_count_id":"c2150000-0000-0000-0000-000000000002","ubicacion":"A-01-02","codigo":"LIVEBATCHP","partida":"LOT-1","cantidad_contada":2,"captured_at":"2026-11-11T10:01:00Z"}]'::jsonb)),'ACCEPTED','subsequent C1 count is accepted while C2 is queued');
reset role;
select is((select status::text from public.reconciliation_cases where inventory_id='c2130000-0000-0000-0000-000000000001' and codigo='LIVEBATCHP' order by created_at limit 1),'RESUELTO','unclaimed C2 is resolved by later matching C1 evidence');
select is((select status::text from public.recount_missions where inventory_id='c2130000-0000-0000-0000-000000000001' and round=2 order by created_at limit 1),'CANCELLED','resolved live C2 remains audited but is not claimable');

set local role authenticated;
select is((select result_status from public.sync_counts('c2130000-0000-0000-0000-000000000001','c2140000-0000-0000-0000-000000000002','WEB','0.0.00.02','LIVE C1','[{"client_count_id":"c2150000-0000-0000-0000-000000000003","ubicacion":"B-01-01","codigo":"LIVELEGACY","cantidad_contada":8,"captured_at":"2026-11-11T10:02:00Z"}]'::jsonb)),'ACCEPTED','live legacy difference is accepted');
reset role;
select set_config('request.jwt.claim.sub','c2120000-0000-0000-0000-000000000003',true);
set local role authenticated;
select lives_ok($$select public.claim_next_recount_mission('c2130000-0000-0000-0000-000000000001'::uuid)$$,'C2 can claim a live discrepancy before C1 completion');
select is((public.get_my_recount_queue('c2130000-0000-0000-0000-000000000001')->'active'->>'codigo'),'LIVELEGACY','C2 receives the live task without expected quantities');
reset role;

select set_config('request.jwt.claim.sub','c2120000-0000-0000-0000-000000000003',true);
set local role authenticated;
select is((select result_status from public.sync_counts('c2130000-0000-0000-0000-000000000001','c2140000-0000-0000-0000-000000000003','WEB','0.0.00.02','LIVE C2','[{"client_count_id":"c2150000-0000-0000-0000-000000000004","ubicacion":"B-01-01","codigo":"LIVELEGACY","cantidad_contada":9,"captured_at":"2026-11-11T10:03:00Z"}]'::jsonb)),'ACCEPTED','C2 evidence is accepted while C1 remains open');
select lives_ok($$select public.complete_my_recount_mission((public.get_my_recount_queue('c2130000-0000-0000-0000-000000000001')->'active'->>'id')::uuid)$$,'a live C2 completion reconciles immediately');
reset role;
select is((select count(*) from public.recount_missions where inventory_id='c2130000-0000-0000-0000-000000000001' and round=3 and status='QUEUED' and source_cut_id is null),1::bigint,'C1/C2 disagreement creates C3 immediately without a cut');
select is((select c1_completed_at is null from public.inventories where id='c2130000-0000-0000-0000-000000000001'),true,'C3 also does not require C1 completion');

select set_config('request.jwt.claim.sub','c2120000-0000-0000-0000-000000000004',true);
set local role authenticated;
select is(public.claim_next_recount_mission('c2130000-0000-0000-0000-000000000001')->>'round','3','C3 can claim the live disagreement directly');
select ok(not (public.get_my_recount_queue('c2130000-0000-0000-0000-000000000001')->'active' ? 'system_quantity'),'C3 queue payload remains blind to system quantity');
reset role;

select set_config('request.jwt.claim.sub','c2120000-0000-0000-0000-000000000002',true);
set local role authenticated;
select is((select result_status from public.sync_counts('c2130000-0000-0000-0000-000000000001','c2140000-0000-0000-0000-000000000002','WEB','0.0.00.02','LIVE C1','[{"client_count_id":"c2150000-0000-0000-0000-000000000005","ubicacion":"C-01-01","codigo":"LIVEAGREE","cantidad_contada":8,"captured_at":"2026-11-11T10:04:00Z"}]'::jsonb)),'ACCEPTED','a second live C1 discrepancy is accepted');
reset role;
select set_config('request.jwt.claim.sub','c2120000-0000-0000-0000-000000000003',true);
set local role authenticated;
select is(public.claim_next_recount_mission('c2130000-0000-0000-0000-000000000001')->>'round','2','C2 remains claimable while C3 work exists');
select is((select result_status from public.sync_counts('c2130000-0000-0000-0000-000000000001','c2140000-0000-0000-0000-000000000003','WEB','0.0.00.02','LIVE C2','[{"client_count_id":"c2150000-0000-0000-0000-000000000006","ubicacion":"C-01-01","codigo":"LIVEAGREE","cantidad_contada":8,"captured_at":"2026-11-11T10:05:00Z"}]'::jsonb)),'ACCEPTED','matching C2 evidence is accepted');
select lives_ok($$select public.complete_my_recount_mission((public.get_my_recount_queue('c2130000-0000-0000-0000-000000000001')->'active'->>'id')::uuid)$$,'matching live C2 completes');
reset role;
select is((select status::text from public.reconciliation_cases where inventory_id='c2130000-0000-0000-0000-000000000001' and codigo='LIVEAGREE'),'FISICO_CONFIRMADO','C1=C2 different from system becomes a confirmed physical difference');
select is((select count(*) from public.recount_missions m join public.reconciliation_cases r on r.id=m.case_id where r.codigo='LIVEAGREE' and m.round=3),0::bigint,'C1=C2 does not create C3 merely because it differs from system');

select set_config('request.jwt.claim.sub','c2120000-0000-0000-0000-000000000002',true);
set local role authenticated;
select is((select result_status from public.sync_counts('c2130000-0000-0000-0000-000000000001','c2140000-0000-0000-0000-000000000002','WEB','0.0.00.02','LIVE C1','[{"client_count_id":"c2150000-0000-0000-0000-000000000007","ubicacion":"D-01-01","codigo":"LIVESERIALS","serie":"SER-OTHER","cantidad_contada":1,"captured_at":"2026-11-11T10:06:00Z"}]'::jsonb)),'ACCEPTED','a conclusive unexpected serial is accepted as physical evidence');
reset role;
select is((select anomaly_type from public.reconciliation_cases where inventory_id='c2130000-0000-0000-0000-000000000001' and codigo='LIVESERIALS'),'SERIE_FISICA_NO_EN_SISTEMA','unexpected serial creates its conclusive live anomaly');
select is((select count(*) from public.recount_missions m join public.reconciliation_cases r on r.id=m.case_id where r.codigo='LIVESERIALS' and m.round=2 and m.status='QUEUED'),1::bigint,'unexpected serial creates exactly one live C2 task');

select * from finish();
rollback;
