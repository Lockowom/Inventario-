begin;
select plan(20);

insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('c8870000-0000-0000-0000-000000000001','authenticated','authenticated','c08-c1-admin@example.test','','{}','{}',now(),now()),
 ('c8870000-0000-0000-0000-000000000002','authenticated','authenticated','c08-c1-counter@example.test','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,user_type,active) values
 ('c8870000-0000-0000-0000-000000000001','C08 C1 admin','ADMIN','PERMANENT',true),
 ('c8870000-0000-0000-0000-000000000002','C08 C1 counter','CONTADOR','PERMANENT',true);
insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by)
values ('c8880000-0000-0000-0000-000000000001','C08 C1 offline','ABIERTO','00000000-0000-0000-0000-00000000c202','c8870000-0000-0000-0000-000000000001',now(),'c8870000-0000-0000-0000-000000000001',now(),'c8870000-0000-0000-0000-000000000001');
insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values
 ('c8880000-0000-0000-0000-000000000001','c8870000-0000-0000-0000-000000000002','c8870000-0000-0000-0000-000000000001');
insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by)
values
 ('c8880000-0000-0000-0000-000000000001','C08-C1','C1 offline identity','LEGACY','CUT2-08','c8870000-0000-0000-0000-000000000001'),
 ('c8880000-0000-0000-0000-000000000001','C08-SEAL','Sealed C1 identity','LEGACY','CUT2-08','c8870000-0000-0000-0000-000000000001');
insert into public.inventory_system_reference_items(inventory_id,codigo,reference_type,quantity,source_total_quantity,source_available_quantity,unit_code)
values
 ('c8880000-0000-0000-0000-000000000001','C08-C1','LEGACY',1,1,1,'UN'),
 ('c8880000-0000-0000-0000-000000000001','C08-SEAL','LEGACY',1,1,1,'UN');
insert into public.inventory_sealed_references(id,inventory_id,warehouse_id,reference_type,codigo,normalized_reference_key,request_id,state,sealed_at,sealed_by)
values ('c8890000-0000-0000-0000-000000000001','c8880000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','LEGACY','C08-SEAL',public.normalize_reference_key('LEGACY','C08-SEAL',null),'c8890000-0000-0000-0000-000000000002','SEALED',now(),'c8870000-0000-0000-0000-000000000001');

select set_config('request.jwt.claim.sub','c8870000-0000-0000-0000-000000000002',true);
set local role authenticated;
select set_config('cut2_08.c1_finding',public.report_c1_reference_finding(
 'c8880000-0000-0000-0000-000000000001','LEGACY','C08-C1',null,'OTHER',
 'Etiqueta dañada observada sin conexión.',false,'c08-c1-offline-event-1','2026-10-17T12:00:00Z',true,
 jsonb_build_object('note','Etiqueta dañada','location','A-01-01','source_event_id','c08-c1-offline-event-1')
)::text,true);
reset role;
select ok(current_setting('cut2_08.c1_finding',true) <> '', 'C1 offline report returns one canonical finding');
select is((select source_stage::text from public.reference_findings where id=current_setting('cut2_08.c1_finding')::uuid),'C1','unsealed C1 finding derives the C1 source stage');
select is((select created_by from public.reference_findings where id=current_setting('cut2_08.c1_finding')::uuid),'c8870000-0000-0000-0000-000000000002'::uuid,'C1 finding retains the reporting actor');
select is((select count(*) from public.finding_evidence where finding_id=current_setting('cut2_08.c1_finding')::uuid),1::bigint,'C1 finding appends one immutable evidence record');
select is((select captured_at from public.finding_evidence where finding_id=current_setting('cut2_08.c1_finding')::uuid),'2026-10-17T12:00:00Z'::timestamptz,'C1 finding preserves client capture time');
select is((select count(*) from public.reference_finding_events where finding_id=current_setting('cut2_08.c1_finding')::uuid and event_type='REPORTED'),1::bigint,'C1 report produces one canonical report event');
set local role authenticated;
select is(public.report_c1_reference_finding(
 'c8880000-0000-0000-0000-000000000001','LEGACY','C08-C1',null,'OTHER',
 'Etiqueta dañada observada sin conexión.',false,'c08-c1-offline-event-1','2026-10-17T12:00:00Z',true,
 jsonb_build_object('note','Etiqueta dañada','location','A-01-01','source_event_id','c08-c1-offline-event-1')
),current_setting('cut2_08.c1_finding')::uuid,'a source-event retry returns the original canonical finding');
reset role;
select is((select count(*) from public.reference_findings where source_event_key='c08-c1-offline-event-1'),1::bigint,'a source-event retry cannot create a second finding');
select is((select count(*) from public.finding_evidence where finding_id=current_setting('cut2_08.c1_finding')::uuid),1::bigint,'a source-event retry cannot duplicate evidence');
reset role;

select set_config('request.jwt.claim.sub','c8870000-0000-0000-0000-000000000002',true);
set local role authenticated;
select set_config('cut2_08.postseal_finding',public.report_c1_reference_finding(
 'c8880000-0000-0000-0000-000000000001','LEGACY','C08-SEAL',null,'OTHER',
 'Evidencia C1 capturada offline antes del sello.',true,'c08-c1-postseal-event-1','2026-10-17T12:10:00Z',true,
 jsonb_build_object('note','Evidencia post-sello','location','A-01-02')
)::text,true);
reset role;
select is((select source_stage::text from public.reference_findings where id=current_setting('cut2_08.postseal_finding')::uuid),'OFFLINE_LATE_COUNT','sealed offline C1 finding derives OFFLINE_LATE_COUNT');
select is((select reference_id from public.reference_findings where id=current_setting('cut2_08.postseal_finding')::uuid),'c8890000-0000-0000-0000-000000000001'::uuid,'sealed offline C1 finding links the immutable sealed reference');
select is((select count(*) from public.finding_evidence where finding_id=current_setting('cut2_08.postseal_finding')::uuid),1::bigint,'sealed offline C1 finding preserves one evidence record');
select is((select count(*) from public.reference_finding_events where finding_id=current_setting('cut2_08.postseal_finding')::uuid and event_type='REPORTED'),1::bigint,'sealed offline C1 finding has one functional report audit');
select set_config('request.jwt.claim.sub','c8870000-0000-0000-0000-000000000002',true);
set local role authenticated;
select set_config('cut2_08.postseal_sync',public.sync_offline_c1_reference_finding(
 'c8880000-0000-0000-0000-000000000001','LEGACY','C08-SEAL',null,'OTHER',
 'Evidencia C1 capturada offline antes del sello.',true,'c08-c1-postseal-event-1','2026-10-17T12:10:00Z',jsonb_build_object('note','Evidencia post-sello','location','A-01-02')
)::text,true);
reset role;
select is((current_setting('cut2_08.postseal_sync',true)::jsonb)->>'sync_state','REVIEW_REQUIRED','offline sync marks a post-seal finding terminal for review');
select is((current_setting('cut2_08.postseal_sync',true)::jsonb)->>'review_reason','REFERENCE_SEALED','post-seal review reason is distinct from authorization revocation');

-- The client keeps this rejected physical payload actor-bound as REVIEW_REQUIRED;
-- current server authority must still deny any canonical operational mutation.
delete from public.inventory_assignments
where inventory_id='c8880000-0000-0000-0000-000000000001'
  and user_id='c8870000-0000-0000-0000-000000000002';
select set_config('request.jwt.claim.sub','c8870000-0000-0000-0000-000000000002',true);
set local role authenticated;
select throws_ok($$select public.sync_offline_c1_reference_finding('c8880000-0000-0000-0000-000000000001','LEGACY','C08-C1',null,'AUTHORIZATION_REVOKED_OFFLINE','captura física tras revocación',false,'c08-c1-revoked-event-1','2026-10-17T12:20:00Z',jsonb_build_object('note','evidencia preservada localmente'))$$,'42501','CAPABILITY_REQUIRED','revoked offline actor cannot write an authorized canonical finding');
reset role;
select is((select count(*) from public.reference_findings where source_event_key='c08-c1-revoked-event-1'),0::bigint,'authorization revocation cannot insert a stale authorized finding');

select set_config('request.jwt.claim.sub','c8870000-0000-0000-0000-000000000001',true);
set local role authenticated;
select throws_ok($$select public.report_c1_reference_finding('c8880000-0000-0000-0000-000000000001','LEGACY','C08-C1',null,'OTHER','bad',false,'c08-null-capture',null,true,'{}'::jsonb)$$,'23514','FINDING_PAYLOAD_INVALID','missing captured timestamp is denied');
reset role;
select is(has_function_privilege('anon','public.report_c1_reference_finding(uuid,public.master_control_type,text,text,public.cut2_finding_type,text,boolean,text,timestamp with time zone,boolean,jsonb)','EXECUTE'),false,'anon cannot report a C1 finding');
select is((select count(*) from public.reference_findings where source_event_key='c08-c1-offline-event-1'),1::bigint,'one canonical finding remains after authorization checks');

select * from finish();
rollback;
