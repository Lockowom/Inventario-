begin;
select plan(22);

insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('c9910000-0000-0000-0000-000000000001','authenticated','authenticated','c09c-rp@example.test','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,user_type,active)
values ('c9910000-0000-0000-0000-000000000001','C09C RP analyst','ANALISTA','PERMANENT',true);
insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by)
values ('c9920000-0000-0000-0000-000000000001','C09C RP','ABIERTO','00000000-0000-0000-0000-00000000c202','c9910000-0000-0000-0000-000000000001',now(),'c9910000-0000-0000-0000-000000000001',now(),'c9910000-0000-0000-0000-000000000001');
insert into public.inventory_assignments(inventory_id,user_id,assigned_by)
values ('c9920000-0000-0000-0000-000000000001','c9910000-0000-0000-0000-000000000001','c9910000-0000-0000-0000-000000000001');
insert into public.inventory_sealed_references(id,inventory_id,warehouse_id,reference_type,codigo,reference_value,normalized_reference_key,state,request_id,physical_quantity,sealed_at,sealed_by)
values
 ('c9930000-0000-0000-0000-000000000001','c9920000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','PARTIDA','=FORMULA','LOT-1',public.normalize_reference_key('PARTIDA','=FORMULA','LOT-1'),'SEALED','c9940000-0000-0000-0000-000000000001',7,now(),'c9910000-0000-0000-0000-000000000001'),
 ('c9930000-0000-0000-0000-000000000002','c9920000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','SERIAL','C09C','SER-1',public.normalize_reference_key('SERIAL','C09C','SER-1'),'SEALED','c9940000-0000-0000-0000-000000000002',3,now(),'c9910000-0000-0000-0000-000000000001');

select has_table('public','rp_release_events','C09C: export event history exists');
select has_function('public','mark_rp_release_ready',array['uuid','uuid'],'C09C: canonical READY RPC exists');
select has_function('public','prepare_rp_release_export',array['uuid','uuid'],'C09C: canonical export RPC exists');
select is(has_function_privilege('anon','public.prepare_rp_release_export(uuid,uuid)','EXECUTE'),false,'C09C: anon cannot prepare export');

select set_config('request.jwt.claim.sub','c9910000-0000-0000-0000-000000000001',true); set local role authenticated;
select set_config('c09c.preview',public.preview_rp_release('c9920000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9930000-0000-0000-0000-000000000001'::uuid,'c9930000-0000-0000-0000-000000000002'::uuid])::text,true);
select set_config('c09c.release',public.create_rp_release('c9920000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202',array['c9930000-0000-0000-0000-000000000001'::uuid,'c9930000-0000-0000-0000-000000000002'::uuid],current_setting('c09c.preview')::jsonb->>'fingerprint','c9950000-0000-0000-0000-000000000001')::text,true);
select ok((current_setting('c09c.release')::jsonb->>'release_id') is not null,'C09C: authenticated create provides DRAFT snapshot');
select is((current_setting('c09c.release')::jsonb->>'state'),'DRAFT','C09C: release starts DRAFT');
select throws_ok($$select public.prepare_rp_release_export((current_setting('c09c.release')::jsonb->>'release_id')::uuid,'c9950000-0000-0000-0000-000000000002')$$,'23514','RELEASE_NOT_READY_OR_INTEGRITY_FAILURE','C09C: DRAFT cannot export');
select set_config('c09c.ready',public.mark_rp_release_ready((current_setting('c09c.release')::jsonb->>'release_id')::uuid,'c9950000-0000-0000-0000-000000000003')::text,true);
select is((current_setting('c09c.ready')::jsonb->>'state'),'READY','C09C: READY only follows server manifest validation');
select ok((current_setting('c09c.ready')::jsonb->'manifest'->>'ordered_items_digest') ~ '^[a-f0-9]{64}$','C09C: manifest has deterministic ordered digest');
select is((current_setting('c09c.ready')::jsonb->'manifest'->>'item_count')::integer,2,'C09C: manifest keeps exact snapshot cardinality');
reset role;
select is((select count(*) from public.rp_release_events where release_id=(current_setting('c09c.release')::jsonb->>'release_id')::uuid and event_type='RELEASE_READY'),1::bigint,'C09C: READY audit event once');
set local role authenticated;
select set_config('c09c.ready_retry',public.mark_rp_release_ready((current_setting('c09c.release')::jsonb->>'release_id')::uuid,'c9950000-0000-0000-0000-000000000003')::text,true);
select ok((current_setting('c09c.ready_retry')::jsonb->>'idempotent')::boolean,'C09C: READY retry is idempotent');
select set_config('c09c.export',public.prepare_rp_release_export((current_setting('c09c.release')::jsonb->>'release_id')::uuid,'c9950000-0000-0000-0000-000000000004')::text,true);
select is((current_setting('c09c.export')::jsonb->'release'->>'state'),'READY','C09C: export source is READY immutable snapshot');
select is((current_setting('c09c.export')::jsonb->'release'->'items'->0->>'sku'),'=FORMULA','C09C: exported rows use canonical deterministic ordering');
select is((current_setting('c09c.export')::jsonb->'release'->'items'->1->>'sku'),'C09C','C09C: raw snapshot preserves data; XLSX sanitizes presentation');
reset role;
select is((select count(*) from public.rp_release_events where release_id=(current_setting('c09c.release')::jsonb->>'release_id')::uuid and event_type='RELEASE_EXPORTED'),1::bigint,'C09C: export audit once per request');
set local role authenticated;
select set_config('c09c.export_retry',public.prepare_rp_release_export((current_setting('c09c.release')::jsonb->>'release_id')::uuid,'c9950000-0000-0000-0000-000000000004')::text,true);
reset role;
select is((select count(*) from public.rp_release_events where release_id=(current_setting('c09c.release')::jsonb->>'release_id')::uuid and event_type='RELEASE_EXPORTED'),1::bigint,'C09C: export retry cannot duplicate audit');
set local role authenticated;
select is((public.get_rp_release_detail((current_setting('c09c.release')::jsonb->>'release_id')::uuid)->'manifest'->>'release_id'),current_setting('c09c.release')::jsonb->>'release_id','C09C: detail returns matching manifest');
select is(jsonb_array_length(public.list_rp_releases('c9920000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202')),1,'C09C: scoped history returns snapshot');
reset role;
set local role anon;
select throws_ok($$select public.get_rp_release_detail((current_setting('c09c.release')::jsonb->>'release_id')::uuid)$$,'42501',null,'C09C: anonymous detail is denied');
reset role;
select is((select count(*) from public.inventory_movement_events where inventory_id='c9920000-0000-0000-0000-000000000001'),0::bigint,'C09C: ready/export never writes ERP movement events');
select is((select count(*) from public.rp_release_audits where inventory_id='c9920000-0000-0000-0000-000000000001'),1::bigint,'C09C: manifest workflow does not duplicate immutable release audit');
select * from finish();
rollback;
