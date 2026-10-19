begin;
select plan(30);

-- CUT2-09B2 exercises the authenticated writer boundary.  Fixture setup is
-- privileged; every preview/create operation below runs as the scoped analyst.
insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('c9010000-0000-0000-0000-000000000001','authenticated','authenticated','c09-rp@example.test','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,user_type,active)
values ('c9010000-0000-0000-0000-000000000001','C09 RP analyst','ANALISTA','PERMANENT',true);
insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by)
values ('c9020000-0000-0000-0000-000000000001','C09 RP core','ABIERTO','00000000-0000-0000-0000-00000000c202','c9010000-0000-0000-0000-000000000001',now(),'c9010000-0000-0000-0000-000000000001',now(),'c9010000-0000-0000-0000-000000000001');
insert into public.inventory_assignments(inventory_id,user_id,assigned_by)
values ('c9020000-0000-0000-0000-000000000001','c9010000-0000-0000-0000-000000000001','c9010000-0000-0000-0000-000000000001');
insert into public.inventory_sealed_references(
  id,inventory_id,warehouse_id,reference_type,codigo,reference_value,normalized_reference_key,
  state,request_id,physical_quantity,sealed_at,sealed_by
) values (
  'c9030000-0000-0000-0000-000000000001','c9020000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',
  'LEGACY','C09-RP',null,public.normalize_reference_key('LEGACY','C09-RP',null),
  'SEALED','c9040000-0000-0000-0000-000000000001',7,now(),'c9010000-0000-0000-0000-000000000001'
);
insert into public.inventory_sealed_references(
  id,inventory_id,warehouse_id,reference_type,codigo,reference_value,normalized_reference_key,
  state,request_id,physical_quantity,sealed_at,sealed_by
) values (
  'c9030000-0000-0000-0000-000000000002','c9020000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',
  'LEGACY','C09-RP-C3',null,public.normalize_reference_key('LEGACY','C09-RP-C3',null),
  'SEALED','c9040000-0000-0000-0000-000000000002',4,now(),'c9010000-0000-0000-0000-000000000001'
);

select has_function('app_private','rp_release_eligibility',array['uuid','uuid','uuid[]'],'C09: one private eligibility authority exists');
select has_function('public','preview_rp_release',array['uuid','uuid','uuid[]'],'C09: preview is a public scoped RPC');
select has_function('public','create_rp_release',array['uuid','uuid','uuid[]','text','uuid'],'C09: create is the canonical writer RPC');
select is(has_function_privilege('anon','public.create_rp_release(uuid,uuid,uuid[],text,uuid)','EXECUTE'),false,'C09: anon cannot create a release');

select set_config('request.jwt.claim.sub','c9010000-0000-0000-0000-000000000001',true);
set local role authenticated;
select set_config('c09.preview_a',public.preview_rp_release(
  'c9020000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9030000-0000-0000-0000-000000000001'::uuid]
)::text,true);
select set_config('c09.preview_b',public.preview_rp_release(
  'c9020000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9030000-0000-0000-0000-000000000001'::uuid]
)::text,true);
select is((current_setting('c09.preview_a')::jsonb->>'fingerprint'),(current_setting('c09.preview_b')::jsonb->>'fingerprint'),'C09: unchanged preview fingerprint is deterministic');
select is((current_setting('c09.preview_a')::jsonb->>'eligible_references')::integer,1,'C09: sealed, clean reference is eligible');
select set_config('c09.release_a',public.create_rp_release(
  'c9020000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9030000-0000-0000-0000-000000000001'::uuid],
  current_setting('c09.preview_a')::jsonb->>'fingerprint','c9050000-0000-0000-0000-000000000001'
)::text,true);
select ok((current_setting('c09.release_a')::jsonb->>'release_id') is not null,'C09: create returns a release id');
select is((current_setting('c09.release_a')::jsonb->>'state'),'DRAFT','C09: core creates an immutable DRAFT, not an ERP release');
select is((select count(*) from public.rp_release_batches where inventory_id='c9020000-0000-0000-0000-000000000001'),1::bigint,'C09: create inserts one batch');
select is((select count(*) from public.rp_release_audits where release_id=(current_setting('c09.release_a')::jsonb->>'release_id')::uuid),1::bigint,'C09: create inserts one immutable audit snapshot');
select is((select reference_count from public.rp_release_audits where release_id=(current_setting('c09.release_a')::jsonb->>'release_id')::uuid),1,'C09: audit snapshot retains selected item cardinality');
select is((select references_snapshot->0->>'reference_id' from public.rp_release_audits where release_id=(current_setting('c09.release_a')::jsonb->>'release_id')::uuid),'c9030000-0000-0000-0000-000000000001','C09: audit snapshot retains sealed-reference lineage');
select set_config('c09.release_b',public.create_rp_release(
  'c9020000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9030000-0000-0000-0000-000000000001'::uuid],
  current_setting('c09.preview_a')::jsonb->>'fingerprint','c9050000-0000-0000-0000-000000000001'
)::text,true);
select is((current_setting('c09.release_b')::jsonb->>'release_id'),(current_setting('c09.release_a')::jsonb->>'release_id'),'C09: same request returns the original release');
select ok((current_setting('c09.release_b')::jsonb->>'idempotent')::boolean,'C09: retry reports idempotency');
select is((select count(*) from public.rp_release_batches where inventory_id='c9020000-0000-0000-0000-000000000001'),1::bigint,'C09: retry cannot duplicate a batch');
select is((select count(*) from public.rp_release_audits where inventory_id='c9020000-0000-0000-0000-000000000001'),1::bigint,'C09: retry cannot duplicate an audit');
reset role;

update public.inventory_sealed_references set physical_quantity=8 where id='c9030000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','c9010000-0000-0000-0000-000000000001',true);
set local role authenticated;
select throws_ok($$select public.create_rp_release('c9020000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9030000-0000-0000-0000-000000000001'::uuid],current_setting('c09.preview_a')::jsonb->>'fingerprint','c9050000-0000-0000-0000-000000000002')$$,'40001','PREVIEW_STALE','C09: material sealed state change rejects stale preview');
select is((select count(*) from public.rp_release_batches where inventory_id='c9020000-0000-0000-0000-000000000001'),1::bigint,'C09: stale create has no partial batch');
select is((select count(*) from public.rp_release_audits where inventory_id='c9020000-0000-0000-0000-000000000001'),1::bigint,'C09: stale create has no partial audit');
reset role;

insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by)
values ('c9020000-0000-0000-0000-000000000001','C09-RP','Release blocker fixture','LEGACY','CUT2-09','c9010000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','c9010000-0000-0000-0000-000000000001',true);
set local role authenticated;
select set_config('c09.blocking_finding',public.report_c1_reference_finding(
  'c9020000-0000-0000-0000-000000000001','LEGACY','C09-RP',null,'OTHER','RP must wait for this critical finding',true,
  'c09-rp-blocker-event','2026-10-18T12:00:00Z',false,jsonb_build_object('note','blocking physical evidence')
)::text,true);
select is((select source_stage::text from public.reference_findings where id=current_setting('c09.blocking_finding')::uuid),'POST_SEAL','C09: real C1 report on sealed reference is post-seal');
select ok((select blocks_rp from public.reference_findings where id=current_setting('c09.blocking_finding')::uuid),'C09: critical canonical finding blocks RP');
select set_config('c09.blocked_preview',public.preview_rp_release(
  'c9020000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9030000-0000-0000-0000-000000000001'::uuid]
)::text,true);
select is((current_setting('c09.blocked_preview')::jsonb->>'blocked_references')::integer,1,'C09: preview reuses eligibility and exposes the finding blocker');
select throws_ok($$select public.create_rp_release('c9020000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9030000-0000-0000-0000-000000000001'::uuid],current_setting('c09.blocked_preview')::jsonb->>'fingerprint','c9050000-0000-0000-0000-000000000003')$$,'23514','RP_RELEASE_BLOCKED','C09: server writer rejects a blocked finding');
select is((select count(*) from public.rp_release_batches where inventory_id='c9020000-0000-0000-0000-000000000001'),1::bigint,'C09: blocked create has no partial batch');
select public.resolve_reference_finding(current_setting('c09.blocking_finding')::uuid,'NO_ADJUSTMENT_REQUIRED','C09 blocker reviewed');
reset role;

-- These are genuine persisted C2/C3 mission states; the fixture bypasses only
-- the earlier count-capture setup, not the release preview or writer boundary.
insert into public.reconciliation_cases(id,inventory_id,codigo,reference_type,anomaly_type,system_quantity,physical_quantity,status,created_by)
values
 ('c9060000-0000-0000-0000-000000000001','c9020000-0000-0000-0000-000000000001','C09-RP','LEGACY','C09-C2',7,8,'REQUIERE_2DO_CONTEO','c9010000-0000-0000-0000-000000000001'),
 ('c9060000-0000-0000-0000-000000000002','c9020000-0000-0000-0000-000000000001','C09-RP','LEGACY','C09-C3',7,8,'REQUIERE_3ER_CONTEO','c9010000-0000-0000-0000-000000000001');
insert into public.recount_missions(id,case_id,inventory_id,round,status,created_by,source_sealed_reference_id)
values
 ('c9070000-0000-0000-0000-000000000001','c9060000-0000-0000-0000-000000000001','c9020000-0000-0000-0000-000000000001',2,'QUEUED','c9010000-0000-0000-0000-000000000001','c9030000-0000-0000-0000-000000000001');
insert into public.recount_missions(id,case_id,inventory_id,round,status,assigned_user_id,claimed_at,completed_at,total_quantity,created_by,source_sealed_reference_id)
values ('c9070000-0000-0000-0000-000000000003','c9060000-0000-0000-0000-000000000002','c9020000-0000-0000-0000-000000000001',2,'COMPLETED','c9010000-0000-0000-0000-000000000001',now(),now(),8,'c9010000-0000-0000-0000-000000000001','c9030000-0000-0000-0000-000000000002');
insert into public.recount_missions(id,case_id,inventory_id,round,status,created_by,source_sealed_reference_id)
values ('c9070000-0000-0000-0000-000000000002','c9060000-0000-0000-0000-000000000002','c9020000-0000-0000-0000-000000000001',3,'QUEUED','c9010000-0000-0000-0000-000000000001','c9030000-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.sub','c9010000-0000-0000-0000-000000000001',true);
set local role authenticated;
select set_config('c09.recount_preview',public.preview_rp_release(
  'c9020000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9030000-0000-0000-0000-000000000001'::uuid,'c9030000-0000-0000-0000-000000000002'::uuid]
)::text,true);
select is((current_setting('c09.recount_preview')::jsonb->>'blocked_references')::integer,2,'C09: open recount work blocks RP eligibility');
select ok((select item->'blocker_codes' ? 'OPEN_C2' from jsonb_array_elements(current_setting('c09.recount_preview')::jsonb->'items') item where item->>'reference_id'='c9030000-0000-0000-0000-000000000001'),'C09: queued C2 is represented in the canonical blocker matrix');
select ok((select item->'blocker_codes' ? 'OPEN_C3' from jsonb_array_elements(current_setting('c09.recount_preview')::jsonb->'items') item where item->>'reference_id'='c9030000-0000-0000-0000-000000000002'),'C09: queued C3 is represented in the canonical blocker matrix');
select throws_ok($$select public.create_rp_release('c9020000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9030000-0000-0000-0000-000000000001'::uuid,'c9030000-0000-0000-0000-000000000002'::uuid],current_setting('c09.recount_preview')::jsonb->>'fingerprint','c9050000-0000-0000-0000-000000000004')$$,'23514','RP_RELEASE_BLOCKED','C09: writer revalidates queued C2/C3 blockers');
select is((select count(*) from public.rp_release_batches where inventory_id='c9020000-0000-0000-0000-000000000001'),1::bigint,'C09: recount blocker leaves no partial batch');
select is((select count(*) from public.rp_release_audits where inventory_id='c9020000-0000-0000-0000-000000000001'),1::bigint,'C09: recount blocker leaves no partial audit');
reset role;

select * from finish();
rollback;
