begin;
select plan(26);

insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('ca100000-0000-0000-0000-000000000001','authenticated','authenticated','c10-owner@example.test','','{}','{}',now(),now()),
 ('ca100000-0000-0000-0000-000000000002','authenticated','authenticated','c10-reader@example.test','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,user_type,active) values
 ('ca100000-0000-0000-0000-000000000001','C10 owner','ANALISTA','PERMANENT',true),
 ('ca100000-0000-0000-0000-000000000002','C10 reader','CONTADOR','PERMANENT',true);
insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by,c1_completed_at,c1_completed_by,c1_count_records,c1_counted_units,c1_master_fingerprint,c1_reference_fingerprint)
values
 ('ca200000-0000-0000-0000-000000000001','C10 ready','ABIERTO','00000000-0000-0000-0000-00000000c202','ca100000-0000-0000-0000-000000000001',now(),'ca100000-0000-0000-0000-000000000001',now(),'ca100000-0000-0000-0000-000000000001',now(),'ca100000-0000-0000-0000-000000000001',0,0,'c10-ready-master','c10-ready-reference'),
 ('ca200000-0000-0000-0000-000000000002','C10 c1 pending','ABIERTO','00000000-0000-0000-0000-00000000c202','ca100000-0000-0000-0000-000000000001',now(),'ca100000-0000-0000-0000-000000000001',now(),'ca100000-0000-0000-0000-000000000001',null,null,null,null,null,null),
 ('ca200000-0000-0000-0000-000000000003','C10 stale','ABIERTO','00000000-0000-0000-0000-00000000c202','ca100000-0000-0000-0000-000000000001',now(),'ca100000-0000-0000-0000-000000000001',now(),'ca100000-0000-0000-0000-000000000001',now(),'ca100000-0000-0000-0000-000000000001',0,0,'c10-stale-master','c10-stale-reference');
insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values
 ('ca200000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001'),
 ('ca200000-0000-0000-0000-000000000002','ca100000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001'),
 ('ca200000-0000-0000-0000-000000000003','ca100000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001');

select has_function('app_private','inventory_close_readiness',array['uuid'],'C10: one private readiness authority exists');
select has_function('public','preview_inventory_close',array['uuid'],'C10: scoped read-only preview exists');
select has_function('public','close_inventory_final',array['uuid','text','uuid'],'C10: scoped final writer exists');
select is(has_function_privilege('anon','public.preview_inventory_close(uuid)','EXECUTE'),false,'C10: anon cannot preview');
select is(has_function_privilege('anon','public.close_inventory_final(uuid,text,uuid)','EXECUTE'),false,'C10: anon cannot close');

select set_config('request.jwt.claim.sub','ca100000-0000-0000-0000-000000000001',true); set local role authenticated;
select set_config('c10.preview',public.preview_inventory_close('ca200000-0000-0000-0000-000000000001')::text,true);
select is((current_setting('c10.preview')::jsonb->>'is_ready')::boolean,true,'C10: C1-complete inventory with no operational work is ready');
select set_config('c10.preview_again',public.preview_inventory_close('ca200000-0000-0000-0000-000000000001')::text,true);
select is(current_setting('c10.preview_again')::jsonb->>'fingerprint',current_setting('c10.preview')::jsonb->>'fingerprint','C10: unchanged material state has deterministic fingerprint');
select is((select count(*) from public.inventory_close_requests where inventory_id='ca200000-0000-0000-0000-000000000001'),0::bigint,'C10: preview has no request side effect');
select is((select count(*) from public.audit_events where inventory_id='ca200000-0000-0000-0000-000000000001' and event_type='INVENTORY_CLOSED'),0::bigint,'C10: preview has no close audit');
select set_config('c10.closed',public.close_inventory_final('ca200000-0000-0000-0000-000000000001',current_setting('c10.preview')::jsonb->>'fingerprint','ca300000-0000-0000-0000-000000000001')::text,true);
select is(current_setting('c10.closed')::jsonb->>'status','CERRADO','C10: final close transitions the lifecycle');
select is((select status::text from public.inventories where id='ca200000-0000-0000-0000-000000000001'),'CERRADO','C10: inventory is closed exactly once');
select is((select count(*) from public.inventory_close_requests where inventory_id='ca200000-0000-0000-0000-000000000001' and state='COMPLETED'),1::bigint,'C10: close persists one completed idempotency request');
select is((select count(*) from public.audit_events where inventory_id='ca200000-0000-0000-0000-000000000001' and event_type='INVENTORY_CLOSED'),1::bigint,'C10: close creates one canonical audit');
select set_config('c10.retry',public.close_inventory_final('ca200000-0000-0000-0000-000000000001',current_setting('c10.preview')::jsonb->>'fingerprint','ca300000-0000-0000-0000-000000000001')::text,true);
select is((current_setting('c10.retry')::jsonb->>'idempotent')::boolean,true,'C10: retry returns the canonical idempotent response');
select is((select count(*) from public.audit_events where inventory_id='ca200000-0000-0000-0000-000000000001' and event_type='INVENTORY_CLOSED'),1::bigint,'C10: retry does not duplicate audit');
select throws_ok($$select public.close_inventory_final('ca200000-0000-0000-0000-000000000001',repeat('0',64),'ca300000-0000-0000-0000-000000000001')$$,'23505','REQUEST_REPLAY_CONFLICT','C10: a request id cannot be replayed with a different material fingerprint');
select throws_ok($$select public.close_inventory_final('ca200000-0000-0000-0000-000000000001',current_setting('c10.preview')::jsonb->>'fingerprint','ca300000-0000-0000-0000-000000000002')$$,'23514','INVENTORY_ALREADY_CLOSED','C10: a new request cannot close an already closed inventory');
select set_config('c10.pending',public.preview_inventory_close('ca200000-0000-0000-0000-000000000002')::text,true);
select ok(current_setting('c10.pending')::jsonb->'blocker_codes' ? 'C1_NOT_FINALIZED','C10: readiness exposes the lifecycle blocker');
select throws_ok($$select public.close_inventory_final('ca200000-0000-0000-0000-000000000002',current_setting('c10.pending')::jsonb->>'fingerprint','ca300000-0000-0000-0000-000000000003')$$,'23514','INVENTORY_NOT_READY','C10: blocked readiness cannot mutate lifecycle');
select set_config('c10.stale',public.preview_inventory_close('ca200000-0000-0000-0000-000000000003')::text,true);
reset role;
update public.inventories
set c1_completed_at=null,
    c1_completed_by=null,
    c1_count_records=null,
    c1_counted_units=null,
    c1_master_fingerprint=null,
    c1_reference_fingerprint=null
where id='ca200000-0000-0000-0000-000000000003';
select set_config('request.jwt.claim.sub','ca100000-0000-0000-0000-000000000001',true); set local role authenticated;
select throws_ok($$select public.close_inventory_final('ca200000-0000-0000-0000-000000000003',current_setting('c10.stale')::jsonb->>'fingerprint','ca300000-0000-0000-0000-000000000004')$$,'40001','PREVIEW_STALE','C10: material change rejects stale preview before request write');
select is((select count(*) from public.inventory_close_requests where inventory_id='ca200000-0000-0000-0000-000000000003'),0::bigint,'C10: stale close has no partial request');
reset role;
select set_config('request.jwt.claim.sub','ca100000-0000-0000-0000-000000000002',true); set local role authenticated;
select throws_ok($$select public.preview_inventory_close('ca200000-0000-0000-0000-000000000002')$$,'42501','CAPABILITY_REQUIRED','C10: missing CLOSE_INVENTORY is denied server-side');
select throws_ok($$update public.inventories set status='CERRADO' where id='ca200000-0000-0000-0000-000000000002'$$,'42501',null,'C10: authenticated callers cannot mutate the inventory lifecycle directly');
select throws_ok($$insert into public.inventory_close_requests(inventory_id,request_id,started_by) values ('ca200000-0000-0000-0000-000000000002','ca300000-0000-0000-0000-000000000005','ca100000-0000-0000-0000-000000000002')$$,'42501',null,'C10: authenticated callers cannot forge close requests directly');
select throws_ok($$insert into public.audit_events(inventory_id,actor_user_id,event_type,entity_type,entity_id,payload) values ('ca200000-0000-0000-0000-000000000002','ca100000-0000-0000-0000-000000000002','INVENTORY_CLOSED','inventory','ca200000-0000-0000-0000-000000000002','{}'::jsonb)$$,'42501',null,'C10: authenticated callers cannot forge close audit history');
reset role;

set local role anon;
select throws_ok($$select public.preview_inventory_close('ca200000-0000-0000-0000-000000000002')$$,'42501',null,'C10: anon cannot execute the close preview RPC');
reset role;

select * from finish();
rollback;
