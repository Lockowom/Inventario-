begin;
select plan(18);

insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('c8a10000-0000-0000-0000-000000000001','authenticated','authenticated','c08-evidence-admin@example.test','','{}','{}',now(),now()),
 ('c8a10000-0000-0000-0000-000000000002','authenticated','authenticated','c08-evidence-analyst@example.test','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,user_type,active) values
 ('c8a10000-0000-0000-0000-000000000001','C08 evidence admin','ADMIN','PERMANENT',true),
 ('c8a10000-0000-0000-0000-000000000002','C08 evidence analyst','ANALISTA','PERMANENT',true);
insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by)
values ('c8a20000-0000-0000-0000-000000000001','C08 evidence','ABIERTO','00000000-0000-0000-0000-00000000c202','c8a10000-0000-0000-0000-000000000001',now(),'c8a10000-0000-0000-0000-000000000001',now(),'c8a10000-0000-0000-0000-000000000001');
insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values
 ('c8a20000-0000-0000-0000-000000000001','c8a10000-0000-0000-0000-000000000002','c8a10000-0000-0000-0000-000000000001');
insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by)
values ('c8a20000-0000-0000-0000-000000000001','C08-EVID','Evidence identity','LEGACY','CUT2-08','c8a10000-0000-0000-0000-000000000001');
insert into public.inventory_system_reference_items(inventory_id,codigo,reference_type,quantity,source_total_quantity,source_available_quantity,unit_code)
values ('c8a20000-0000-0000-0000-000000000001','C08-EVID','LEGACY',1,1,1,'UN');

select set_config('request.jwt.claim.sub','c8a10000-0000-0000-0000-000000000001',true);
set local role authenticated;
select set_config('cut2_08.evidence_finding',public.create_preseal_reference_finding('c8a20000-0000-0000-0000-000000000001','LEGACY','C08-EVID','OTHER','Evidence-after-resolution contract',false)::text,true);
reset role;

select set_config('request.jwt.claim.sub','c8a10000-0000-0000-0000-000000000002',true);
set local role authenticated;
select public.resolve_reference_finding(current_setting('cut2_08.evidence_finding')::uuid,'NO_ADJUSTMENT_REQUIRED','Initial reviewed decision');
select set_config('cut2_08.prior_resolved_at',(select resolved_at::text from public.reference_findings where id=current_setting('cut2_08.evidence_finding')::uuid),true);
select ok((select state='RESOLVED' from public.reference_findings where id=current_setting('cut2_08.evidence_finding')::uuid),'fixture is resolved through the typed RPC');
select set_config('cut2_08.noncritical_evidence',public.add_reference_finding_evidence(current_setting('cut2_08.evidence_finding')::uuid,jsonb_build_object('note','late noncritical provenance','source_event_id','c08-noncritical'))::text,true);
select ok((select state='RESOLVED' from public.reference_findings where id=current_setting('cut2_08.evidence_finding')::uuid),'noncritical evidence preserves terminal state');
select is((select count(*) from public.reference_finding_events where finding_id=current_setting('cut2_08.evidence_finding')::uuid and event_type='REOPENED'),0::bigint,'noncritical evidence has no reopen audit');
select set_config('cut2_08.critical_evidence',public.add_reference_finding_evidence(current_setting('cut2_08.evidence_finding')::uuid,jsonb_build_object('note','late critical evidence','critical',true,'source_event_id','c08-critical'))::text,true);
select is((select state from public.reference_findings where id=current_setting('cut2_08.evidence_finding')::uuid),'OPEN','critical evidence reopens the canonical finding');
select is((select severity::text from public.reference_findings where id=current_setting('cut2_08.evidence_finding')::uuid),'CRITICAL','critical evidence upgrades severity');
select ok((select critical from public.reference_findings where id=current_setting('cut2_08.evidence_finding')::uuid),'critical evidence sets the canonical critical flag');
select is((select resolution_code::text from public.reference_findings where id=current_setting('cut2_08.evidence_finding')::uuid),'NO_ADJUSTMENT_REQUIRED','reopen preserves the prior typed decision');
select is((select resolved_by from public.reference_findings where id=current_setting('cut2_08.evidence_finding')::uuid),'c8a10000-0000-0000-0000-000000000002'::uuid,'reopen preserves the historical resolver');
select is((select resolved_at::text from public.reference_findings where id=current_setting('cut2_08.evidence_finding')::uuid),current_setting('cut2_08.prior_resolved_at',true),'reopen preserves the historical resolution timestamp');
select is((select count(*) from public.reference_finding_events where finding_id=current_setting('cut2_08.evidence_finding')::uuid and event_type='REOPENED'),1::bigint,'critical evidence writes one REOPENED audit');
select is((select payload->>'reason' from public.reference_finding_events where finding_id=current_setting('cut2_08.evidence_finding')::uuid and event_type='REOPENED'),'CRITICAL_EVIDENCE_AFTER_RESOLUTION','reopen audit declares the canonical policy reason');
select is(public.add_reference_finding_evidence(current_setting('cut2_08.evidence_finding')::uuid,jsonb_build_object('note','late critical evidence retry','critical',true,'source_event_id','c08-critical')),current_setting('cut2_08.critical_evidence')::uuid,'same source event returns the original evidence id');
select is((select count(*) from public.finding_evidence where finding_id=current_setting('cut2_08.evidence_finding')::uuid and source_event_id='c08-critical'),1::bigint,'critical evidence retry is append-idempotent');
select is((select count(*) from public.reference_finding_events where finding_id=current_setting('cut2_08.evidence_finding')::uuid and event_type='EVIDENCE_ADDED'),2::bigint,'retries do not duplicate evidence audit');
select is((select count(*) from public.reference_finding_events where finding_id=current_setting('cut2_08.evidence_finding')::uuid and event_type='REOPENED'),1::bigint,'retries do not duplicate reopen audit');
select ok((select blocks_seal from public.reference_findings where id=current_setting('cut2_08.evidence_finding')::uuid),'reopen recalculates the pre-seal blocker');
reset role;
select set_config('request.jwt.claim.sub','c8a10000-0000-0000-0000-000000000001',true);
set local role authenticated;
select ok(exists(select 1 from public.get_live_monitor_findings('c8a20000-0000-0000-0000-000000000001',50) m where m.id=current_setting('cut2_08.evidence_finding')::uuid and m.state='OPEN' and m.severity='CRITICAL'),'Monitor exposes the reopened critical finding through its scoped read model');
reset role;
select set_config('request.jwt.claim.sub','c8a10000-0000-0000-0000-000000000002',true);
set local role authenticated;
select public.resolve_reference_finding(current_setting('cut2_08.evidence_finding')::uuid,'ADJUSTMENT_REQUIRED','Reviewed the new critical evidence');
select is((select count(*) from public.reference_finding_events where finding_id=current_setting('cut2_08.evidence_finding')::uuid and event_type='RESOLVED'),2::bigint,'a post-reopen resolution is a new audited decision');
reset role;

select * from finish();
rollback;
