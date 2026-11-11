begin;
select plan(29);
insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('c6010000-0000-0000-0000-000000000001','authenticated','authenticated','c06-admin@example.test','','{}','{}',now(),now()),
 ('c6010000-0000-0000-0000-000000000002','authenticated','authenticated','c06-counter@example.test','','{}','{}',now(),now()),
 ('c6010000-0000-0000-0000-000000000003','authenticated','authenticated','c06-auditor@example.test','','{}','{}',now(),now()),
 ('c6010000-0000-0000-0000-000000000004','authenticated','authenticated','c06-temp@example.test','','{}','{}',now(),now()),
 ('c6010000-0000-0000-0000-000000000005','authenticated','authenticated','c06-scoped-analyst@example.test','','{}','{}',now(),now()),
 ('c6010000-0000-0000-0000-000000000006','authenticated','authenticated','c06-target@example.test','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,user_type,active) values
 ('c6010000-0000-0000-0000-000000000001','C06 admin','ADMIN','PERMANENT',true),
 ('c6010000-0000-0000-0000-000000000002','C06 counter','CONTADOR','PERMANENT',true),
 ('c6010000-0000-0000-0000-000000000003','C06 auditor','CONTADOR','EXTERNAL_AUDITOR',true),
 ('c6010000-0000-0000-0000-000000000004','C06 temporary','CONTADOR','TEMPORARY',true),
 ('c6010000-0000-0000-0000-000000000005','C06 scoped analyst','ANALISTA','PERMANENT',true);
insert into public.inventories(id,name,status,created_by,prepared_at,prepared_by,opened_at,opened_by,c1_completed_at,c1_completed_by,c1_count_records,c1_counted_units,c1_master_fingerprint,c1_reference_fingerprint) values
 ('c6020000-0000-0000-0000-000000000001','C06 A','ABIERTO','c6010000-0000-0000-0000-000000000001',now(),'c6010000-0000-0000-0000-000000000001',now(),'c6010000-0000-0000-0000-000000000001',now(),'c6010000-0000-0000-0000-000000000001',0,0,repeat('a',64),repeat('b',64)),
 ('c6020000-0000-0000-0000-000000000002','C06 B','ABIERTO','c6010000-0000-0000-0000-000000000001',now(),'c6010000-0000-0000-0000-000000000001',now(),'c6010000-0000-0000-0000-000000000001',now(),'c6010000-0000-0000-0000-000000000001',0,0,repeat('c',64),repeat('d',64));
insert into public.inventory_assignments(inventory_id,user_id,assigned_by,valid_until) values
 ('c6020000-0000-0000-0000-000000000001','c6010000-0000-0000-0000-000000000002','c6010000-0000-0000-0000-000000000001',now()+interval '1 day'),
 ('c6020000-0000-0000-0000-000000000001','c6010000-0000-0000-0000-000000000003','c6010000-0000-0000-0000-000000000001',now()+interval '1 day'),
 ('c6020000-0000-0000-0000-000000000001','c6010000-0000-0000-0000-000000000004','c6010000-0000-0000-0000-000000000001',now()+interval '1 day'),
 ('c6020000-0000-0000-0000-000000000001','c6010000-0000-0000-0000-000000000005','c6010000-0000-0000-0000-000000000001',now()+interval '1 day');
insert into public.inventory_capability_grants(user_id,capability,scope,inventory_id,granted_by) values
 ('c6010000-0000-0000-0000-000000000005','MANAGE_USERS','INVENTORY','c6020000-0000-0000-0000-000000000001','c6010000-0000-0000-0000-000000000001'),
 ('c6010000-0000-0000-0000-000000000005','MANAGE_ASSIGNMENTS','INVENTORY','c6020000-0000-0000-0000-000000000001','c6010000-0000-0000-0000-000000000001');
select ok(exists(select 1 from pg_proc where proname='actor_has_capability'),'canonical scoped helper exists');
select ok(exists(select 1 from public.cut2_default_capability_policies),'auditable default matrix exists');
select ok(exists(select 1 from public.cut2_user_type_capability_allowlist),'user type allowlist exists');
set local request.jwt.claim.sub='c6010000-0000-0000-0000-000000000002';
select ok(public.cut2_has_capability('c6020000-0000-0000-0000-000000000001','COUNT_C1'),'counter can count in assigned inventory');
select ok(not public.cut2_has_capability('c6020000-0000-0000-0000-000000000002','COUNT_C1'),'counter cannot count another inventory');
select ok(public.cut2_has_capability('c6020000-0000-0000-0000-000000000001','RECOUNT_C2'),'counter C2 is capability based');
select ok(not public.cut2_has_capability('c6020000-0000-0000-0000-000000000001','REASSIGN_C2'),'counter cannot reassign C2');
select is((public.get_my_counting_authorization_snapshot()->>'status'),'AUTHORIZED','server emits a verified offline authorization snapshot');
select is((public.get_my_counting_authorization_snapshot()->>'actor_id'),'c6010000-0000-0000-0000-000000000002','snapshot is bound to the authenticated actor');
select ok(public.get_my_counting_authorization_snapshot()->'capabilities' ? 'COUNT_C1','snapshot carries capability, not an isAdmin flag');
select is((public.get_my_counting_authorization_snapshot(null::uuid)->>'status'),'AUTHORIZED','single assignment resolves without an explicit C1 selection');
select is((public.get_my_counting_authorization_snapshot('c6020000-0000-0000-0000-000000000001'::uuid)->>'status'),'AUTHORIZED','explicit active C1 inventory is revalidated server-side');
select is((public.get_my_counting_authorization_snapshot('c6020000-0000-0000-0000-000000000002'::uuid)->>'status'),'NOT_AUTHORIZED','a forged foreign active inventory is denied server-side');
set local request.jwt.claim.sub='c6010000-0000-0000-0000-000000000003';
select ok(public.cut2_has_capability('c6020000-0000-0000-0000-000000000001','VIEW_MONITOR'),'external auditor has scoped monitor read');
select ok(not public.cut2_has_capability('c6020000-0000-0000-0000-000000000001','COUNT_C1'),'external auditor cannot count');
select lives_ok($$select public.get_c2_execution_metrics('c6020000-0000-0000-0000-000000000001')$$,'external auditor receives only its scoped Monitor aggregate');
select throws_ok($$select public.get_c2_execution_metrics('c6020000-0000-0000-0000-000000000002')$$,'42501','CAPABILITY_REQUIRED','Monitor foreign inventory is denied server-side');
select throws_ok($$select public.claim_next_recount_mission('c6020000-0000-0000-0000-000000000001')$$,'42501','CAPABILITY_REQUIRED','external auditor cannot claim C2 despite Monitor access');
set local request.jwt.claim.sub='c6010000-0000-0000-0000-000000000004';
select ok(public.cut2_has_capability('c6020000-0000-0000-0000-000000000001','COUNT_C1'),'temporary user retains explicit C1 policy');
select ok(not public.cut2_has_capability('c6020000-0000-0000-0000-000000000001','RECOUNT_C2'),'temporary user cannot receive implicit C2');
set local request.jwt.claim.sub='c6010000-0000-0000-0000-000000000001';
select ok(public.cut2_has_capability('c6020000-0000-0000-0000-000000000002','MANAGE_USERS'),'global admin policy is explicit');
select is((public.get_my_counting_authorization_snapshot()->>'status'),'INVENTORY_SELECTION_REQUIRED','legacy zero-argument snapshot also normalizes multiple inventories to selection required');
select is((public.get_my_counting_authorization_snapshot(null::uuid)->>'status'),'INVENTORY_SELECTION_REQUIRED','multiple authorized open inventories require a selection instead of an ambiguity failure');
select is((public.get_my_counting_authorization_snapshot('c6020000-0000-0000-0000-000000000002'::uuid)->>'status'),'AUTHORIZED','global admin may activate an authorized selected inventory');
set local role service_role;
select throws_ok($$select public.admin_upsert_user_profile_from_edge('c6010000-0000-0000-0000-000000000005','c6010000-0000-0000-0000-000000000006','C06 target','CONTADOR',true,array['c6020000-0000-0000-0000-000000000002']::uuid[],'USER_CREATED')$$,'42501','INVENTORY_SCOPE_DENIED','scoped analyst cannot create an assignment outside its inventory scope');
select throws_ok($$select public.admin_upsert_user_profile_from_edge('c6010000-0000-0000-0000-000000000005','c6010000-0000-0000-0000-000000000005','C06 self','ADMIN',true,array['c6020000-0000-0000-0000-000000000001']::uuid[],'USER_UPDATED')$$,'42501','SELF_MODIFICATION_DENIED','actor cannot self-promote through Edge-only mutation');
reset role;
select throws_ok($$insert into public.inventory_capability_grants(user_id,capability,scope,inventory_id,granted_by) values('c6010000-0000-0000-0000-000000000003','COUNT_C1','INVENTORY','c6020000-0000-0000-0000-000000000001','c6010000-0000-0000-0000-000000000001')$$,'42501','CAPABILITY_NOT_ALLOWED_FOR_USER_TYPE','auditor cannot be escalated to count');
select throws_ok($$insert into public.inventory_capability_grants(user_id,capability,scope,inventory_id,warehouse_id,granted_by) values('c6010000-0000-0000-0000-000000000002','COUNT_C1','INVENTORY','c6020000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','c6010000-0000-0000-0000-000000000001')$$,'23514','INVENTORY_SCOPE_CANNOT_INCLUDE_WAREHOUSE','inventory scope cannot be ambiguous');
update public.inventory_assignments set valid_until=valid_from+interval '1 second' where inventory_id='c6020000-0000-0000-0000-000000000001' and user_id='c6010000-0000-0000-0000-000000000002';
set local request.jwt.claim.sub='c6010000-0000-0000-0000-000000000002';
select ok(not public.cut2_has_capability('c6020000-0000-0000-0000-000000000001','COUNT_C1',now()+interval '2 seconds'),'expired assignment denies without logout');
select * from finish();
rollback;
