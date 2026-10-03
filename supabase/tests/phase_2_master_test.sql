begin;
select plan(28);

insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('31000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'phase2-admin@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('31000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'phase2-analyst@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('31000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'phase2-counter@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.profiles (user_id, display_name, role) values
  ('31000000-0000-0000-0000-000000000001', 'Admin fase 2', 'ADMIN'),
  ('31000000-0000-0000-0000-000000000002', 'Analista fase 2', 'ANALISTA'),
  ('31000000-0000-0000-0000-000000000003', 'Contador fase 2', 'CONTADOR');
insert into public.inventories (id, name, created_by) values
  ('41000000-0000-0000-0000-000000000001', 'MASTER_VACIO', '31000000-0000-0000-0000-000000000001'),
  ('41000000-0000-0000-0000-000000000002', 'MASTER_VALIDO', '31000000-0000-0000-0000-000000000001');
insert into public.inventory_assignments (inventory_id, user_id, assigned_by) values
  ('41000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000001'),
  ('41000000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000001'),
  ('41000000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000003', '31000000-0000-0000-0000-000000000001');

select set_config('request.jwt.claim.sub', '31000000-0000-0000-0000-000000000003', true); set local role authenticated;
select throws_ok($$$select public.import_inventory_master('41000000-0000-0000-0000-000000000002', '[{"codigo":"00001","descripcion":"Producto"}]'::jsonb, 'TEST', null)$$, '42501', 'Only ADMIN can import a master snapshot', 'CONTADOR cannot import a master');
select throws_ok($$select public.add_master_exception('41000000-0000-0000-0000-000000000002', 'X1', 'Producto', 'motivo')$$, '42501', 'Only an assigned ANALISTA or ADMIN can add a master exception', 'CONTADOR cannot add an exception');
reset role;

select set_config('request.jwt.claim.sub', '31000000-0000-0000-0000-000000000001', true); set local role authenticated;
select throws_ok($$$select public.import_inventory_master('41000000-0000-0000-0000-000000000002', '[{"codigo":" ","descripcion":"Producto"}]'::jsonb, 'TEST', null)$$, '23514', 'Master items require non-empty codigo and descripcion', 'empty codigo is blocked');
select throws_ok($$$select public.import_inventory_master('41000000-0000-0000-0000-000000000002', '[{"codigo":"A1","descripcion":" "}]'::jsonb, 'TEST', null)$$, '23514', 'Master items require non-empty codigo and descripcion', 'empty descripcion is blocked');
select throws_ok($$$select public.import_inventory_master('41000000-0000-0000-0000-000000000002', '[{"codigo":"A1","descripcion":"Uno"},{"codigo":" a1 ","descripcion":"Dos"}]'::jsonb, 'TEST', null)$$, '23505', 'Master import contains duplicate codigo', 'duplicate codigo is blocked before replacement');
reset role;

select set_config('request.jwt.claim.sub', '31000000-0000-0000-0000-000000000002', true); set local role authenticated;
select throws_ok($$select public.add_master_exception('41000000-0000-0000-0000-000000000001', 'BORRADORP', 'No permitido', 'motivo')$$, '23514', 'Master exceptions are only allowed while inventory is ABIERTO', 'exception in BORRADOR fails');
select throws_ok($$$select public.prepare_inventory('41000000-0000-0000-0000-000000000001')$$, '23514', 'Inventory requires a non-empty master before preparation', 'prepare with an empty master fails');
reset role;

select set_config('request.jwt.claim.sub', '31000000-0000-0000-0000-000000000001', true); set local role authenticated;
select lives_ok($$$select public.import_inventory_master('41000000-0000-0000-0000-000000000002', '[{"codigo":" 00001234 ","descripcion":" Producto legacy "},{"codigo":"NVI75200055P","descripcion":"Producto partida"},{"codigo":"0WA46651050S","descripcion":"Producto serial"}]'::jsonb, 'TEST_CSV', 'phase2-import')$$, 'ADMIN imports a normalized master atomically');
select is((select row_count from public.inventory_master_metadata where inventory_id = '41000000-0000-0000-0000-000000000002'), 3, 'metadata records imported row count');
select is((select control_type from public.inventory_master_items where inventory_id = '41000000-0000-0000-0000-000000000002' and codigo = 'NVI75200055P'), 'PARTIDA'::public.master_control_type, 'P derives PARTIDA');
select throws_ok($$insert into public.inventory_master_items (inventory_id, codigo, descripcion, control_type, source, created_by) values ('41000000-0000-0000-0000-000000000002', 'UNSAFE', 'No permitido', 'LEGACY', 'TEST', '31000000-0000-0000-0000-000000000001')$$, '42501', 'permission denied for table inventory_master_items', 'ADMIN has no direct master writes');
reset role;

select set_config('request.jwt.claim.sub', '31000000-0000-0000-0000-000000000002', true); set local role authenticated;
select lives_ok($$$select public.prepare_inventory('41000000-0000-0000-0000-000000000002')$$, 'prepare with a valid master succeeds');
select throws_ok($$select public.add_master_exception('41000000-0000-0000-0000-000000000002', 'PREPARADOP', 'No permitido', 'motivo')$$, '23514', 'Master exceptions are only allowed while inventory is ABIERTO', 'exception in PREPARADO fails');
select lives_ok($$$select public.open_inventory('41000000-0000-0000-0000-000000000002')$$, 'open with a valid master succeeds');
reset role;
select set_config('request.jwt.claim.sub', '31000000-0000-0000-0000-000000000001', true); set local role authenticated;
select throws_ok($$$select public.import_inventory_master('41000000-0000-0000-0000-000000000002', '[{"codigo":"NEW","descripcion":"No permitido"}]'::jsonb, 'TEST', null)$$, '23514', 'Master import is only allowed in BORRADOR or PREPARADO', 'import after ABIERTO fails');
reset role;

select set_config('request.jwt.claim.sub', '31000000-0000-0000-0000-000000000002', true); set local role authenticated;
select lives_ok($$select public.add_master_exception('41000000-0000-0000-0000-000000000002', ' EXCEPTIONP ', ' Producto excepcional ', 'Faltó en el maestro')$$, 'ANALISTA can add an exception in ABIERTO');
select ok(exists (select 1 from public.audit_events where inventory_id = '41000000-0000-0000-0000-000000000002' and event_type = 'MASTER_EXCEPTION_ADDED'), 'exception emits audit event');
select is((select control_type from public.inventory_master_exceptions where inventory_id = '41000000-0000-0000-0000-000000000002' and codigo = 'EXCEPTIONP'), 'PARTIDA'::public.master_control_type, 'exception derives control type');
select is((select master_version from public.inventory_master_metadata where inventory_id = '41000000-0000-0000-0000-000000000002'), 2, 'exception increments master version');
select throws_ok($q$select public.add_master_exception('41000000-0000-0000-0000-000000000002', 'EXCEPTIONP', 'Duplicado', 'motivo')$q$, '23505', 'Master codigo already exists', 'duplicate exception fails');
reset role;
update public.inventories i
set c1_completed_at=now(),
    c1_completed_by='31000000-0000-0000-0000-000000000002',
    c1_count_records=(select count(*)::integer from public.count_records c where c.inventory_id=i.id),
    c1_counted_units=(select coalesce(sum(c.cantidad_contada),0)::bigint from public.count_records c where c.inventory_id=i.id),
    c1_master_fingerprint=(select fingerprint from public.inventory_master_metadata m where m.inventory_id=i.id),
    c1_reference_fingerprint=repeat('0',64)
where i.id='41000000-0000-0000-0000-000000000002';
select set_config('request.jwt.claim.sub', '31000000-0000-0000-0000-000000000002', true); set local role authenticated;
select lives_ok($q$select public.close_inventory('41000000-0000-0000-0000-000000000002')$q$, 'assigned ANALISTA can close an F16-complete inventory');
select throws_ok($$select public.add_master_exception('41000000-0000-0000-0000-000000000002', 'CLOSED', 'No permitido', 'motivo')$$, '23514', 'Master exceptions are only allowed while inventory is ABIERTO', 'exception in CERRADO fails');
select ok((select fingerprint ~ '^[a-f0-9]{64}$' from public.inventory_master_metadata where inventory_id = '41000000-0000-0000-0000-000000000002'), 'metadata has deterministic SHA-256 fingerprint');
select ok(position('app_private.lock_inventory' in pg_get_functiondef('public.import_inventory_master(uuid,jsonb,text,text)'::regprocedure)) > 0, 'import serializes on the inventory row');
select ok(position('app_private.lock_inventory' in pg_get_functiondef('public.add_master_exception(uuid,text,text,text)'::regprocedure)) > 0, 'exception serializes on the inventory row');
select ok(position('app_private.lock_inventory' in pg_get_functiondef('public.prepare_inventory(uuid)'::regprocedure)) > 0, 'prepare serializes on the inventory row');
select ok(position('app_private.lock_inventory' in pg_get_functiondef('public.open_inventory(uuid)'::regprocedure)) > 0, 'open serializes on the inventory row');
select ok(position('app_private.lock_inventory' in pg_get_functiondef('public.close_inventory(uuid)'::regprocedure)) > 0, 'close serializes on the inventory row');

select * from finish();
rollback;
