begin;
select plan(39);

select has_table('public','recount_sla_policies','C2 SLA policy is persisted per warehouse');
select has_table('public','recount_mission_lifecycle_events','C2 lifecycle has an append-only audit trail');
select has_column('public','recount_missions','source_sealed_reference_id','C2 keeps its immutable sealed-reference provenance');
select has_column('public','recount_missions','c2_due_at','C2 stores an operational SLA deadline');
select has_column('public','recount_missions','claim_due_at','C2 stores a claim SLA deadline');
select has_column('public','recount_missions','started_at','C2 distinguishes CLAIMED from active physical work');
select has_column('public','recount_missions','overdue_at','C2 records the first operational overdue transition');
select has_column('public','recount_missions','last_assigned_user_id','C2 prevents automatic self-reclaim after release');
select has_column('public','recount_missions','reassignment_count','C2 keeps bounded reassignment history');

select has_function('public','operational_deadline_after',array['uuid','timestamptz','integer'],'operational deadline calculation exists');
select has_function('public','abandon_my_recount_mission',array['uuid','text'],'safe release RPC exists');
select has_function('public','process_recount_sla',array['uuid'],'manager SLA processing RPC exists');
select has_function('public','reassign_recount_mission',array['uuid','text'],'manager requeue RPC exists');
select has_function('public','get_c2_operational_missions',array['uuid'],'monitor SLA projection exists');
select ok(position('for update skip locked' in lower(pg_get_functiondef('public.claim_next_recount_mission(uuid)'::regprocedure)))>0,'claim stays PostgreSQL concurrency-safe');
select ok(position('last_assigned_user_id is distinct from v_actor' in lower(pg_get_functiondef('public.claim_next_recount_mission(uuid)'::regprocedure)))>0,'timeout cannot silently auto-reclaim the same counter');
select ok(position('started c2 cannot be reassigned' in lower(pg_get_functiondef('public.abandon_my_recount_mission(uuid,text)'::regprocedure)))>0,'started evidence cannot be reassigned and leaked');
select ok(position('c2_overdue_operational' in lower(pg_get_functiondef('public.process_recount_sla(uuid)'::regprocedure)))>0,'overdue event has explicit operational code');
select is(has_function_privilege('anon','public.abandon_my_recount_mission(uuid,text)','EXECUTE'),false,'anon cannot release C2 work');
select is(has_function_privilege('anon','public.process_recount_sla(uuid)','EXECUTE'),false,'anon cannot process C2 SLA');
select is(has_table_privilege('authenticated','public.recount_mission_lifecycle_events','INSERT'),false,'clients cannot forge C2 lifecycle evidence');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='recount_missions_one_c2_per_sealed_reference'),'one C2 per sealed reference is indexed');

select is(
  public.operational_deadline_after('00000000-0000-0000-0000-00000000c201','2026-10-15 10:00:00+00',30),
  '2026-10-15 10:30:00+00'::timestamptz,
  '24x7 deadline advances by operational rather than display time'
);
select throws_ok(
  $$select public.operational_deadline_after('00000000-0000-0000-0000-00000000c201',now(),0)$$,
  '22023','Operational SLA minutes must be between 1 and 10080','zero-minute SLA is rejected'
);

insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('f2500000-0000-0000-0000-000000000001','authenticated','authenticated','cut205-admin@example.invalid','','{}','{}',now(),now()),
 ('f2500000-0000-0000-0000-000000000002','authenticated','authenticated','cut205-c1@example.invalid','','{}','{}',now(),now()),
 ('f2500000-0000-0000-0000-000000000003','authenticated','authenticated','cut205-c2a@example.invalid','','{}','{}',now(),now()),
 ('f2500000-0000-0000-0000-000000000004','authenticated','authenticated','cut205-c2b@example.invalid','','{}','{}',now(),now()),
 ('f2500000-0000-0000-0000-000000000005','authenticated','authenticated','cut205-c2c@example.invalid','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,active) values
 ('f2500000-0000-0000-0000-000000000001','CUT205 Admin','ADMIN',true),
 ('f2500000-0000-0000-0000-000000000002','CUT205 C1','CONTADOR',true),
 ('f2500000-0000-0000-0000-000000000003','CUT205 C2 A','CONTADOR',true),
 ('f2500000-0000-0000-0000-000000000004','CUT205 C2 B','CONTADOR',true),
 ('f2500000-0000-0000-0000-000000000005','CUT205 C2 C','CONTADOR',true);
insert into public.inventories(id,name,status,created_by,prepared_at,prepared_by,opened_at,opened_by,c1_completed_at,c1_completed_by,c1_count_records,c1_counted_units,c1_master_fingerprint,c1_reference_fingerprint)
values('f2510000-0000-0000-0000-000000000001','CUT205 SLA','ABIERTO','f2500000-0000-0000-0000-000000000001',now(),'f2500000-0000-0000-0000-000000000001',now(),'f2500000-0000-0000-0000-000000000001',now(),'f2500000-0000-0000-0000-000000000001',0,0,repeat('a',64),repeat('b',64));
insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values
 ('f2510000-0000-0000-0000-000000000001','f2500000-0000-0000-0000-000000000001','f2500000-0000-0000-0000-000000000001'),
 ('f2510000-0000-0000-0000-000000000001','f2500000-0000-0000-0000-000000000002','f2500000-0000-0000-0000-000000000001'),
 ('f2510000-0000-0000-0000-000000000001','f2500000-0000-0000-0000-000000000003','f2500000-0000-0000-0000-000000000001'),
 ('f2510000-0000-0000-0000-000000000001','f2500000-0000-0000-0000-000000000004','f2500000-0000-0000-0000-000000000001'),
 ('f2510000-0000-0000-0000-000000000001','f2500000-0000-0000-0000-000000000005','f2500000-0000-0000-0000-000000000001');
insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by)
values('f2510000-0000-0000-0000-000000000001','CUT205SKU','CUT205 SKU','LEGACY','TEST','f2500000-0000-0000-0000-000000000001');
insert into public.reconciliation_cases(id,inventory_id,codigo,reference_type,anomaly_type,system_quantity,physical_quantity,status,created_by)
values('f2520000-0000-0000-0000-000000000001','f2510000-0000-0000-0000-000000000001','CUT205SKU','LEGACY','CUT205',1,0,'REQUIERE_2DO_CONTEO','f2500000-0000-0000-0000-000000000001');
insert into public.recount_missions(id,case_id,inventory_id,round,created_by)
values('f2530000-0000-0000-0000-000000000001','f2520000-0000-0000-0000-000000000001','f2510000-0000-0000-0000-000000000001',2,'f2500000-0000-0000-0000-000000000001');

select ok((select c2_due_at is not null and claim_due_at is not null and operational_hours_id is not null from public.recount_missions where id='f2530000-0000-0000-0000-000000000001'),'new C2 receives immutable calendar and both operational deadlines');
select is((select count(*) from public.recount_mission_lifecycle_events where mission_id='f2530000-0000-0000-0000-000000000001' and event_type='C2_CREATED'),1::bigint,'creation event is recorded exactly once');

select set_config('request.jwt.claim.sub','f2500000-0000-0000-0000-000000000003',true); set local role authenticated;
select is(public.claim_next_recount_mission('f2510000-0000-0000-0000-000000000001')->>'execution_state','CLAIMED','first C2 claim enters explicit claimed state without physical evidence');
reset role;
select is((select count(*) from public.recount_mission_lifecycle_events where mission_id='f2530000-0000-0000-0000-000000000001' and event_type='C2_CLAIMED'),1::bigint,'claim lifecycle event is immutable and singular');

select set_config('request.jwt.claim.sub','f2500000-0000-0000-0000-000000000003',true); set local role authenticated;
select lives_ok($$select public.abandon_my_recount_mission('f2530000-0000-0000-0000-000000000001','turno terminado')$$,'unstarted C2 can be safely released');
reset role;
select is((select status::text from public.recount_missions where id='f2530000-0000-0000-0000-000000000001'),'QUEUED','release returns C2 to the guarded queue');
select is((select last_assigned_user_id from public.recount_missions where id='f2530000-0000-0000-0000-000000000001'),'f2500000-0000-0000-0000-000000000003'::uuid,'release records prior operator for no-self-reclaim');

select set_config('request.jwt.claim.sub','f2500000-0000-0000-0000-000000000003',true); set local role authenticated;
select is(public.claim_next_recount_mission('f2510000-0000-0000-0000-000000000001'),null::jsonb,'released C2 is hidden from its prior counter');
reset role;
select set_config('request.jwt.claim.sub','f2500000-0000-0000-0000-000000000004',true); set local role authenticated;
select is(public.claim_next_recount_mission('f2510000-0000-0000-0000-000000000001')->>'execution_state','CLAIMED','a distinct C2 counter can claim released work');
reset role;

select set_config('request.jwt.claim.sub','f2500000-0000-0000-0000-000000000001',true); set local role authenticated;
select lives_ok($$select public.reassign_recount_mission('f2530000-0000-0000-0000-000000000001','cambio de turno')$$,'manager can requeue unstarted C2 through the guarded monitor path');
reset role;
select is((select status::text from public.recount_missions where id='f2530000-0000-0000-0000-000000000001'),'QUEUED','manager requeue preserves one mission rather than duplicating C2');
select set_config('request.jwt.claim.sub','f2500000-0000-0000-0000-000000000005',true); set local role authenticated;
select is(public.claim_next_recount_mission('f2510000-0000-0000-0000-000000000001')->>'execution_state','CLAIMED','a fresh counter can claim manager-requeued work');
reset role;

update public.recount_missions set c2_due_at=now()-interval '1 minute' where id='f2530000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','f2500000-0000-0000-0000-000000000001',true); set local role authenticated;
select is((public.process_recount_sla('f2510000-0000-0000-0000-000000000001')->>'requeued_without_evidence')::integer,1,'expired unstarted C2 is requeued by the operational SLA processor');
reset role;
select is((select overdue_at is not null and status='QUEUED' and reassignment_count=3 from public.recount_missions where id='f2530000-0000-0000-0000-000000000001'),true,'SLA timeout records overdue state and bounded reassignment evidence');
select is((select count(*) from public.recount_mission_lifecycle_events where mission_id='f2530000-0000-0000-0000-000000000001' and event_type='C2_OVERDUE_OPERATIONAL'),1::bigint,'overdue operational event is idempotently recorded once');

select * from finish();
rollback;
