begin;
select plan(9);

insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('f1400000-0000-0000-0000-000000000001','authenticated','authenticated','f14-admin@example.invalid','','{}','{}',now(),now());

insert into public.profiles(user_id,display_name,role,active)
values('f1400000-0000-0000-0000-000000000001','F14 Admin','ADMIN',true);

insert into public.inventories(id,name,created_by)
values('f1400000-0000-0000-0000-000000000010','F14 DATA LOAD CENTER','f1400000-0000-0000-0000-000000000001');

insert into public.inventory_master_items(id,inventory_id,codigo,descripcion,control_type,source,created_by)
values
('f1400000-0000-0000-0000-000000000101','f1400000-0000-0000-0000-000000000010','KEEP001P','Keep old','PARTIDA','TEST','f1400000-0000-0000-0000-000000000001'),
('f1400000-0000-0000-0000-000000000102','f1400000-0000-0000-0000-000000000010','DROP001P','Drop old','PARTIDA','TEST','f1400000-0000-0000-0000-000000000001');

select set_config('request.jwt.claim.sub','f1400000-0000-0000-0000-000000000001',true);
set local role authenticated;

select lives_ok(
 $$select * from public.authorize_missing_batch_exceptions(
   'f1400000-0000-0000-0000-000000000010',
   array['KEEP001P','DROP001P'],
   'Softland missing batch fixture'
 )$$,
 'fixture authorizes both controlled missing-batch codes'
);

select lives_ok(
 $$select * from public.import_inventory_system_reference(
   'f1400000-0000-0000-0000-000000000010',
   '[
     {"codigo":"KEEP001P","reference_value":"EXC-SIN-PARTIDA:KEEP001P","quantity":5,"available_quantity":5,"unit_code":"UNI"},
     {"codigo":"DROP001P","reference_value":"EXC-SIN-PARTIDA:DROP001P","quantity":2,"available_quantity":2,"unit_code":"UNI"}
   ]'::jsonb,
   'F14_FIXTURE',
   'before-master-replacement'
 )$$,
 'fixture creates RP evidence tied to current master'
);

select lives_ok(
 $$select * from public.import_inventory_master(
   'f1400000-0000-0000-0000-000000000010',
   '[
     {"codigo":"KEEP001P","descripcion":"Keep updated"},
     {"codigo":"NEW001","descripcion":"New official"}
   ]'::jsonb,
   'LOAD_CENTER',
   'f14-smart-master'
 )$$,
 'smart master replacement succeeds without FK failure'
);

reset role;

select is(
 (select id from public.inventory_master_items where inventory_id='f1400000-0000-0000-0000-000000000010' and codigo='KEEP001P'),
 'f1400000-0000-0000-0000-000000000101'::uuid,
 'existing SKU keeps stable master id'
);

select is(
 (select descripcion from public.inventory_master_items where inventory_id='f1400000-0000-0000-0000-000000000010' and codigo='KEEP001P'),
 'Keep updated',
 'existing SKU is updated in place'
);

select is(
 (select count(*) from public.inventory_master_items where inventory_id='f1400000-0000-0000-0000-000000000010'),
 2::bigint,
 'effective master equals new payload'
);

select is(
 (select count(*) from public.inventory_system_reference_items where inventory_id='f1400000-0000-0000-0000-000000000010'),
 0::bigint,
 'old RP evidence is cleared when master universe changes'
);

select ok(
 not exists(select 1 from public.inventory_system_reference_metadata where inventory_id='f1400000-0000-0000-0000-000000000010'),
 'old RP metadata is cleared when master universe changes'
);

select ok(
 (select active from public.inventory_missing_batch_exceptions where inventory_id='f1400000-0000-0000-0000-000000000010' and codigo='KEEP001P')
 and not (select active from public.inventory_missing_batch_exceptions where inventory_id='f1400000-0000-0000-0000-000000000010' and codigo='DROP001P'),
 'authorization is preserved only for codes that remain in the new master'
);

select is(
 (select payload->>'mode' from public.audit_events where inventory_id='f1400000-0000-0000-0000-000000000010' and entity_type='inventory_master' order by created_at desc limit 1),
 'SMART_MERGE_V2',
 'audit trail records the smart merge mode'
);

select * from finish();
rollback;
