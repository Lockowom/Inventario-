begin;
select plan(5);

insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('99000000-0000-0000-0000-000000000001','authenticated','authenticated','cand-admin@example.invalid','','{}','{}',now(),now()),
('99000000-0000-0000-0000-000000000002','authenticated','authenticated','cand-analyst@example.invalid','','{}','{}',now(),now()),
('99000000-0000-0000-0000-000000000003','authenticated','authenticated','cand-c1@example.invalid','','{}','{}',now(),now()),
('99000000-0000-0000-0000-000000000004','authenticated','authenticated','cand-c2@example.invalid','','{}','{}',now(),now());

insert into public.profiles(user_id,display_name,role,active) values
('99000000-0000-0000-0000-000000000001','Cand Admin','ADMIN',true),
('99000000-0000-0000-0000-000000000002','Cand Analyst','ANALISTA',true),
('99000000-0000-0000-0000-000000000003','Cand C1','CONTADOR',true),
('99000000-0000-0000-0000-000000000004','Cand C2','CONTADOR',true);

insert into public.inventories(id,name,created_by) values
('99100000-0000-0000-0000-000000000001','F11 CANDIDATES','99000000-0000-0000-0000-000000000001');

insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values
('99100000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000002','99000000-0000-0000-0000-000000000001'),
('99100000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000003','99000000-0000-0000-0000-000000000001'),
('99100000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000004','99000000-0000-0000-0000-000000000001');

insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by) values
('99100000-0000-0000-0000-000000000001','CAND001S','Synthetic candidate serial','SERIAL','TEST','99000000-0000-0000-0000-000000000001');

select set_config('request.jwt.claim.sub','99000000-0000-0000-0000-000000000001',true); set local role authenticated;
select public.prepare_inventory('99100000-0000-0000-0000-000000000001');
select public.open_inventory('99100000-0000-0000-0000-000000000001');
reset role;

select set_config('request.jwt.claim.sub','99000000-0000-0000-0000-000000000003',true); set local role authenticated;
select * from public.sync_counts(
 '99100000-0000-0000-0000-000000000001',
 '99200000-0000-0000-0000-000000000003',
 'WEB','1.0.0','CAND C1',
 '[{"client_count_id":"99300000-0000-0000-0000-000000000001","ubicacion":"A-01-01","codigo":"CAND001S","serie":"CAND-S","cantidad_contada":1,"captured_at":"2026-10-01T10:00:00Z"}]'
);
reset role;

insert into public.reconciliation_cases(inventory_id,codigo,reference_type,reference_value,anomaly_type,system_quantity,physical_quantity,first_count_record_id,created_by)
select '99100000-0000-0000-0000-000000000001','CAND001S','SERIAL','CAND-S','SERIE_FISICA_NO_EN_SISTEMA',0,1,id,'99000000-0000-0000-0000-000000000002'
from public.count_records where client_count_id='99300000-0000-0000-0000-000000000001';

select set_config('request.jwt.claim.sub','99000000-0000-0000-0000-000000000002',true); set local role authenticated;

select is(
 (select count(*) from public.list_recount_candidates((select id from public.reconciliation_cases where inventory_id='99100000-0000-0000-0000-000000000001'),2)),
 1::bigint,
 'round 2 exposes exactly one eligible counter'
);

select is(
 (select user_id from public.list_recount_candidates((select id from public.reconciliation_cases where inventory_id='99100000-0000-0000-0000-000000000001'),2)),
 '99000000-0000-0000-0000-000000000004'::uuid,
 'round 2 excludes C1 and returns C2'
);

select is(
 (select user_id from public.list_recount_candidates((select id from public.reconciliation_cases where inventory_id='99100000-0000-0000-0000-000000000001'),3)),
 '99000000-0000-0000-0000-000000000002'::uuid,
 'round 3 returns assigned analyst only'
);

select throws_ok(
 format('select * from public.list_recount_candidates(%L,4)',(select id from public.reconciliation_cases where inventory_id='99100000-0000-0000-0000-000000000001')),
 '23514',
 'Recount round must be 2 or 3',
 'invalid recount round is rejected'
);

reset role;

select is(
 has_function_privilege('anon','public.list_recount_candidates(uuid,integer)','EXECUTE'),
 false,
 'anon cannot list recount candidates'
);

select * from finish();
rollback;
