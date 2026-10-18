begin;
select plan(26);

-- This contract deliberately exercises the public RPC boundary as authenticated
-- users.  Direct DML appears only in the negative authorization assertions.
insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('c8810000-0000-0000-0000-000000000001','authenticated','authenticated','c08-life-admin@example.test','','{}','{}',now(),now()),
 ('c8810000-0000-0000-0000-000000000002','authenticated','authenticated','c08-life-analyst@example.test','','{}','{}',now(),now()),
 ('c8810000-0000-0000-0000-000000000003','authenticated','authenticated','c08-life-counter@example.test','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,user_type,active) values
 ('c8810000-0000-0000-0000-000000000001','C08 lifecycle admin','ADMIN','PERMANENT',true),
 ('c8810000-0000-0000-0000-000000000002','C08 lifecycle analyst','ANALISTA','PERMANENT',true),
 ('c8810000-0000-0000-0000-000000000003','C08 lifecycle counter','CONTADOR','PERMANENT',true);
insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by)
values ('c8820000-0000-0000-0000-000000000001','C08 lifecycle','ABIERTO','00000000-0000-0000-0000-00000000c202','c8810000-0000-0000-0000-000000000001',now(),'c8810000-0000-0000-0000-000000000001',now(),'c8810000-0000-0000-0000-000000000001');
insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values
 ('c8820000-0000-0000-0000-000000000001','c8810000-0000-0000-0000-000000000002','c8810000-0000-0000-0000-000000000001'),
 ('c8820000-0000-0000-0000-000000000001','c8810000-0000-0000-0000-000000000003','c8810000-0000-0000-0000-000000000001');
insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by)
values ('c8820000-0000-0000-0000-000000000001','C08-LIFE','Lifecycle identity','LEGACY','CUT2-08','c8810000-0000-0000-0000-000000000001');
insert into public.inventory_system_reference_items(inventory_id,codigo,reference_type,quantity,source_total_quantity,source_available_quantity,unit_code)
values ('c8820000-0000-0000-0000-000000000001','C08-LIFE','LEGACY',1,1,1,'UN');

select set_config('request.jwt.claim.sub','c8810000-0000-0000-0000-000000000001',true);
set local role authenticated;
select set_config('cut2_08.lifecycle_finding',public.create_preseal_reference_finding('c8820000-0000-0000-0000-000000000001','LEGACY','C08-LIFE','PHYSICAL_MISMATCH','Lifecycle critical finding',true)::text,true);
select ok(current_setting('cut2_08.lifecycle_finding',true) <> '', 'CREATE returns the canonical finding id');
select is((select source_stage::text from public.reference_findings where id=current_setting('cut2_08.lifecycle_finding')::uuid),'PRE_SEAL','CREATE derives PRE_SEAL source stage');
select is((select severity::text from public.reference_findings where id=current_setting('cut2_08.lifecycle_finding')::uuid),'CRITICAL','CREATE derives critical severity');
select ok((select blocks_seal from public.reference_findings where id=current_setting('cut2_08.lifecycle_finding')::uuid),'critical pre-seal finding blocks seal');
select is((select count(*) from public.reference_finding_events where finding_id=current_setting('cut2_08.lifecycle_finding')::uuid and event_type='REPORTED'),1::bigint,'CREATE has exactly one canonical report audit');
select is((select item->>'block_reason' from jsonb_array_elements(public.preview_rolling_cut_v2('c8820000-0000-0000-0000-000000000001')->'items') item where item->>'codigo'='C08-LIFE'),'CRITICAL_FINDING_OPEN','preview revalidates the open critical finding');
select is((select display_name from public.list_reference_finding_assignees(current_setting('cut2_08.lifecycle_finding')::uuid) where user_id='c8810000-0000-0000-0000-000000000002'::uuid),'C08 lifecycle analyst','ASSIGN candidates are server-scoped and human-readable');
select public.assign_reference_finding(current_setting('cut2_08.lifecycle_finding')::uuid,'c8810000-0000-0000-0000-000000000002');
select is((select assigned_to from public.reference_findings where id=current_setting('cut2_08.lifecycle_finding')::uuid),'c8810000-0000-0000-0000-000000000002'::uuid,'ASSIGN persists the authorized assignee');
select public.assign_reference_finding(current_setting('cut2_08.lifecycle_finding')::uuid,'c8810000-0000-0000-0000-000000000002');
select is((select count(*) from public.reference_finding_events where finding_id=current_setting('cut2_08.lifecycle_finding')::uuid and event_type='ASSIGNED'),1::bigint,'same ASSIGN is audit-idempotent');
reset role;

select set_config('request.jwt.claim.sub','c8810000-0000-0000-0000-000000000003',true);
set local role authenticated;
select throws_ok($$select public.list_reference_finding_assignees(current_setting('cut2_08.lifecycle_finding')::uuid)$$,'42501','CAPABILITY_REQUIRED','counter without FINDING_ASSIGN cannot enumerate assignees');
reset role;

select set_config('request.jwt.claim.sub','c8810000-0000-0000-0000-000000000002',true);
set local role authenticated;
select set_config('cut2_08.lifecycle_evidence',public.add_reference_finding_evidence(current_setting('cut2_08.lifecycle_finding')::uuid,jsonb_build_object('note','physical evidence','location','A-01','quantity',1,'uom','UN','source_event_id','c08-lifecycle-event'))::text,true);
select ok((select metadata->>'source_event_id'='c08-lifecycle-event' from public.finding_evidence where id=current_setting('cut2_08.lifecycle_evidence')::uuid),'EVIDENCE persists provenance metadata');
select is((select count(*) from public.reference_finding_events where finding_id=current_setting('cut2_08.lifecycle_finding')::uuid and event_type='EVIDENCE_ADDED'),1::bigint,'EVIDENCE has one append-only audit event');
select throws_ok($$update public.finding_evidence set metadata='{"tampered":true}'::jsonb where id=current_setting('cut2_08.lifecycle_evidence')::uuid$$,'42501',null,'direct evidence mutation is denied');
select set_config('cut2_08.null_finding',public.create_preseal_reference_finding('c8820000-0000-0000-0000-000000000001','LEGACY','C08-LIFE','OTHER','Typed-resolution validation finding',false)::text,true);
select throws_ok($$select public.resolve_reference_finding(current_setting('cut2_08.null_finding')::uuid,null::public.cut2_finding_resolution_code,'note')$$,'23514','RESOLUTION_DECISION_REQUIRED','typed resolve rejects a NULL decision');
select throws_ok($$select public.resolve_reference_finding(current_setting('cut2_08.null_finding')::uuid,'NO_SUCH_CODE'::public.cut2_finding_resolution_code,'note')$$,'22P02',null,'typed resolve rejects an unknown decision');
select public.resolve_reference_finding(current_setting('cut2_08.lifecycle_finding')::uuid,'ADJUSTMENT_REQUIRED'::public.cut2_finding_resolution_code,'Stock review required');
select is((select resolution_code::text from public.reference_findings where id=current_setting('cut2_08.lifecycle_finding')::uuid),'ADJUSTMENT_REQUIRED','RESOLVE persists the typed decision');
select is((select resolved_by from public.reference_findings where id=current_setting('cut2_08.lifecycle_finding')::uuid),'c8810000-0000-0000-0000-000000000002'::uuid,'RESOLVE persists the actor');
select ok((select resolved_at is not null from public.reference_findings where id=current_setting('cut2_08.lifecycle_finding')::uuid),'RESOLVE persists its timestamp');
select is((select count(*) from public.reference_finding_events where finding_id=current_setting('cut2_08.lifecycle_finding')::uuid and event_type='RESOLVED'),1::bigint,'RESOLVE has one canonical audit event');
select public.resolve_reference_finding(current_setting('cut2_08.lifecycle_finding')::uuid,'ADJUSTMENT_REQUIRED'::public.cut2_finding_resolution_code,'retry ignored');
select is((select count(*) from public.reference_finding_events where finding_id=current_setting('cut2_08.lifecycle_finding')::uuid and event_type='RESOLVED'),1::bigint,'repeated RESOLVE is audit-idempotent');
select is((select item->>'block_reason' from jsonb_array_elements(public.preview_rolling_cut_v2('c8820000-0000-0000-0000-000000000001')->'items') item where item->>'codigo'='C08-LIFE'),null,'resolved finding unblocks preview without changing the reference');
select is((public.get_reference_finding_detail(current_setting('cut2_08.lifecycle_finding')::uuid)->>'inventory_name'),'C08 lifecycle','detail renders the scoped inventory label instead of an opaque id');
select is((public.get_reference_finding_detail(current_setting('cut2_08.lifecycle_finding')::uuid)->>'warehouse_name'),'Bodega heredada QA/local','detail renders the scoped warehouse label instead of an opaque id');
select is((public.get_reference_finding_detail(current_setting('cut2_08.lifecycle_finding')::uuid)->>'resolved_by_name'),'C08 lifecycle analyst','detail preserves the resolver identity with the typed historical resolution');
select throws_ok($$update public.reference_findings set state='RESOLVED' where id=current_setting('cut2_08.null_finding')::uuid$$,'42501',null,'direct finding state mutation is denied');
reset role;

select is(has_function_privilege('anon','public.list_reference_finding_assignees(uuid)','EXECUTE'),false,'anon cannot enumerate finding assignees');

select * from finish();
rollback;
