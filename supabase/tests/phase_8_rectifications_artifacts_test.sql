begin;
select plan(57);

select has_table('public', 'artifact_generations', 'artifact generation lifecycle table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.artifact_generations'::regclass), 'artifact generations has RLS enabled');
select ok(exists (select 1 from pg_type where typname = 'artifact_generation_status'), 'artifact lifecycle enum exists');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'inventory_cuts' and column_name = 'ready_at'), 'cuts retain ready_at');
select ok(not has_table_privilege('authenticated', 'public.artifact_generations', 'INSERT'), 'authenticated cannot directly create lifecycle rows');
select ok(not has_function_privilege('anon', 'public.rectify_cut(uuid,uuid,jsonb,text,uuid)', 'EXECUTE'), 'anon cannot rectify');
select ok(has_function_privilege('authenticated', 'public.rectify_cut(uuid,uuid,jsonb,text,uuid)', 'EXECUTE'), 'authenticated can invoke guarded rectification RPC');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.cut_rectifications'::regclass and conname = 'cut_rectifications_id_cut_inventory_key'), 'rectifications expose compound cut/inventory candidate key');
select ok((select attnotnull from pg_attribute where attrelid = 'public.artifact_generations'::regclass and attname = 'as_of_at'), 'all artifact generations require as_of_at');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'generated_files' and column_name = 'mime_type'), 'generated files have no duplicate mime_type source of truth');
select ok(pg_get_constraintdef((select oid from pg_constraint where conrelid = 'public.generated_files'::regclass and conname = 'generated_files_content_type_matches_file_type')) like '%application/vnd.openxmlformats-officedocument.spreadsheetml.sheet%', 'content_type maps XLSX artifacts to XLSX MIME');
select ok(pg_get_constraintdef((select oid from pg_constraint where conrelid = 'public.generated_files'::regclass and conname = 'generated_files_content_type_matches_file_type')) like '%application/json%', 'content_type maps snapshots to JSON MIME');
select ok(pg_get_constraintdef((select oid from pg_constraint where conrelid = 'public.generated_files'::regclass and conname = 'generated_files_content_type_matches_file_type')) like '%application/zip%', 'content_type maps technical backups to ZIP MIME');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.artifact_generations'::regclass and conname = 'artifact_generations_rectification_cut_inventory_fkey'), 'artifact generations bind rectification to its exact cut and inventory');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.generated_files'::regclass and conname = 'generated_files_rectification_cut_inventory_fkey'), 'generated files bind rectification to its exact cut and inventory');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.generated_files'::regclass and conname = 'generated_files_artifact_generation_inventory_fkey'), 'generated files reference artifact generations in the same inventory');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'generated_files_one_per_artifact_generation'), 'one generated file is allowed per artifact generation');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'generated_files_one_rectification_xlsx'), 'one rectification XLSX is allowed per rectification');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'generated_files_one_snapshot_per_cut'), 'one snapshot is allowed per cut');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'generated_files_one_cut_ready_backup_per_cut'), 'one READY backup is allowed per cut');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'generated_files_one_final_backup_per_inventory'), 'one final backup is allowed per inventory');

insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('f8000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'f8-admin@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('f8000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'f8-analyst@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('f8000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'f8-counter@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('f8000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'f8-outsider@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.profiles (user_id, display_name, role) values
  ('f8000000-0000-0000-0000-000000000001', 'F8 Admin', 'ADMIN'),
  ('f8000000-0000-0000-0000-000000000002', 'F8 Analyst', 'ANALISTA'),
  ('f8000000-0000-0000-0000-000000000003', 'F8 Counter', 'CONTADOR'),
  ('f8000000-0000-0000-0000-000000000004', 'F8 Outsider', 'ANALISTA');
insert into public.inventories (id, name, status, created_by, prepared_at, prepared_by, opened_at, opened_by, closed_at, closed_by) values
  ('f8100000-0000-0000-0000-000000000001', 'F8 OPEN', 'ABIERTO', 'f8000000-0000-0000-0000-000000000001', now(), 'f8000000-0000-0000-0000-000000000001', now(), 'f8000000-0000-0000-0000-000000000001', null, null),
  ('f8100000-0000-0000-0000-000000000002', 'F8 CLOSED', 'CERRADO', 'f8000000-0000-0000-0000-000000000001', now(), 'f8000000-0000-0000-0000-000000000001', now(), 'f8000000-0000-0000-0000-000000000001', now(), 'f8000000-0000-0000-0000-000000000001');
insert into public.inventory_assignments (inventory_id, user_id, assigned_by) values
  ('f8100000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000002', 'f8000000-0000-0000-0000-000000000001'),
  ('f8100000-0000-0000-0000-000000000002', 'f8000000-0000-0000-0000-000000000002', 'f8000000-0000-0000-0000-000000000001');
insert into public.inventory_master_items (inventory_id, codigo, descripcion, control_type, source, created_by) values
  ('f8100000-0000-0000-0000-000000000001', '001234', 'Legacy F8', 'LEGACY', 'TEST', 'f8000000-0000-0000-0000-000000000001'),
  ('f8100000-0000-0000-0000-000000000001', 'SERIALS', 'Serial F8', 'SERIAL', 'TEST', 'f8000000-0000-0000-0000-000000000001'),
  ('f8100000-0000-0000-0000-000000000001', 'BATCHP', 'Batch F8', 'PARTIDA', 'TEST', 'f8000000-0000-0000-0000-000000000001');
insert into public.sync_devices (id, user_id, platform, app_version, device_label) values
  ('f8200000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000001', 'WEB', 'test', 'F8 fixture');
insert into public.inventory_cuts (id, inventory_id, cut_number, status, first_export_seq, last_export_seq, record_count, file_name, file_hash, generation_request_id, generation_requested_by, ready_at, created_by) values
  ('f8300000-0000-0000-0000-000000000001', 'f8100000-0000-0000-0000-000000000001', 1, 'READY', 1, 2, 2, 'INVEN3_F8.xlsx', repeat('a', 64), 'f8400000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000002', now(), 'f8000000-0000-0000-0000-000000000001');
insert into public.count_records (id, client_count_id, inventory_id, user_id, device_id, ubicacion, codigo, cantidad_contada, descripcion, captured_at, cut_id, export_seq) values
  ('f8500000-0000-0000-0000-000000000001', 'f8510000-0000-0000-0000-000000000001', 'f8100000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000001', 'f8200000-0000-0000-0000-000000000001', 'A-01-01', '001234', 1, 'Legacy F8', now(), 'f8300000-0000-0000-0000-000000000001', 1),
  ('f8500000-0000-0000-0000-000000000002', 'f8510000-0000-0000-0000-000000000002', 'f8100000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000001', 'f8200000-0000-0000-0000-000000000001', 'A-01-02', '001234', 2, 'Legacy F8', now(), 'f8300000-0000-0000-0000-000000000001', 2);
insert into public.inventory_cut_items (inventory_id, cut_id, count_record_id, snapshot) values
  ('f8100000-0000-0000-0000-000000000001', 'f8300000-0000-0000-0000-000000000001', 'f8500000-0000-0000-0000-000000000001', '{"ubicacion":"A-01-01","codigo":"001234","serie":"00001","partida":"00725","pieza_producto":"0001","fecha_vencimiento":"2027-05-15","talla":"M","color":"NEGRO","cantidad_contada":1,"descripcion":"Legacy F8","export_seq":1}'),
  ('f8100000-0000-0000-0000-000000000001', 'f8300000-0000-0000-0000-000000000001', 'f8500000-0000-0000-0000-000000000002', '{"ubicacion":"A-01-02","codigo":"001234","cantidad_contada":2,"descripcion":"Legacy F8","export_seq":2}');
insert into public.generated_files (inventory_id, cut_id, file_type, file_name, storage_path, sha256, size_bytes, created_by) values
  ('f8100000-0000-0000-0000-000000000001', 'f8300000-0000-0000-0000-000000000001', 'CUT_XLSX', 'INVEN3_F8.xlsx', 'inventory/f8/original.xlsx', repeat('a', 64), 42, 'f8000000-0000-0000-0000-000000000002');
insert into public.inventory_cuts (id, inventory_id, cut_number, created_by) values
  ('f8300000-0000-0000-0000-000000000002', 'f8100000-0000-0000-0000-000000000001', 2, 'f8000000-0000-0000-0000-000000000001');

select ok((select artifact_generation_id is null from public.generated_files where file_type = 'CUT_XLSX'), 'F7 CUT_XLSX keeps a null artifact_generation_id');
select throws_ok($$insert into public.generated_files (inventory_id, cut_id, file_type, file_name, storage_path, sha256, size_bytes, content_type, created_by) values ('f8100000-0000-0000-0000-000000000001', 'f8300000-0000-0000-0000-000000000002', 'SNAPSHOT', 'snapshot.json', 'inventory/f8/snapshot.json', repeat('b', 64), 1, 'application/json', 'f8000000-0000-0000-0000-000000000002')$$, '23514', 'generated_files_artifact_generation_requirement', 'F8 generated files require an artifact generation');

select set_config('request.jwt.claim.sub', 'f8000000-0000-0000-0000-000000000003', true); set local role authenticated;
select throws_ok($$select public.rectify_cut('f8300000-0000-0000-0000-000000000001','f8500000-0000-0000-0000-000000000001','{"ubicacion":"A-01-01","codigo":"001234","cantidad_contada":3}','counter','f8600000-0000-0000-0000-000000000001')$$, '42501', 'Not authorized to rectify cut', 'CONTADOR cannot rectify');
reset role;
select set_config('request.jwt.claim.sub', 'f8000000-0000-0000-0000-000000000004', true); set local role authenticated;
select throws_ok($$select public.rectify_cut('f8300000-0000-0000-0000-000000000001','f8500000-0000-0000-0000-000000000001','{"ubicacion":"A-01-01","codigo":"001234","cantidad_contada":3}','outsider','f8600000-0000-0000-0000-000000000002')$$, '42501', 'Not authorized to rectify cut', 'unassigned ANALISTA cannot rectify');
reset role;

select set_config('request.jwt.claim.sub', 'f8000000-0000-0000-0000-000000000002', true); set local role authenticated;
select throws_ok($$select public.rectify_cut('f8300000-0000-0000-0000-000000000001','f8500000-0000-0000-0000-000000000001','{"ubicacion":"A-01-01","codigo":"001234","cantidad_contada":3,"descripcion":"bad"}','extra key','f8600000-0000-0000-0000-000000000003')$$, '23514', 'UNEXPECTED_PHYSICAL_PAYLOAD_KEY', 'unexpected physical key is rejected');
select throws_ok($$select public.rectify_cut('f8300000-0000-0000-0000-000000000001','f8500000-0000-0000-0000-000000000001','{"ubicacion":"Z-99-99","codigo":"001234","cantidad_contada":3}','bad location','f8600000-0000-0000-0000-000000000004')$$, '23514', 'INVALID_LOCATION', 'location is validated');
select throws_ok($$select public.rectify_cut('f8300000-0000-0000-0000-000000000001','f8500000-0000-0000-0000-000000000001','{"ubicacion":"A-01-01","codigo":"SERIALS","cantidad_contada":2}','bad serial','f8600000-0000-0000-0000-000000000005')$$, '23514', 'INVALID_SERIAL', 'SERIAL is validated');
select throws_ok($$select public.rectify_cut('f8300000-0000-0000-0000-000000000001','f8500000-0000-0000-0000-000000000001','{"ubicacion":"A-01-01","codigo":"BATCHP","serie":"x","cantidad_contada":1}','bad batch','f8600000-0000-0000-0000-000000000006')$$, '23514', 'INVALID_BATCH', 'PARTIDA is validated');
select throws_ok($$select public.rectify_cut('f8300000-0000-0000-0000-000000000001','f8500000-0000-0000-0000-000000000001','{"ubicacion":"A-01-01","codigo":"MISSING","cantidad_contada":1}','bad sku','f8600000-0000-0000-0000-000000000007')$$, '23514', 'UNKNOWN_SKU', 'unknown SKU is rejected');

select lives_ok($$select public.rectify_cut('f8300000-0000-0000-0000-000000000001','f8500000-0000-0000-0000-000000000001','{"ubicacion":"B-02-03","codigo":"001234","serie":"00001","partida":"00725","pieza_producto":"0001","fecha_vencimiento":"2027-05-15","talla":"M","color":"NEGRO","cantidad_contada":3}',' first reason ','f8600000-0000-0000-0000-000000000010')$$, 'assigned ANALISTA rectifies READY cut');
select is((select rectification_number from public.cut_rectifications where request_id = 'f8600000-0000-0000-0000-000000000010'), 1, 'first rectification number is global R001');
select is((select new_values ->> 'codigo' from public.cut_rectifications where request_id = 'f8600000-0000-0000-0000-000000000010'), '001234', 'leading-zero codigo is retained');
select is((select new_values ->> 'descripcion' from public.cut_rectifications where request_id = 'f8600000-0000-0000-0000-000000000010'), 'Legacy F8', 'description is server-derived');
select is((select (public.rectify_cut('f8300000-0000-0000-0000-000000000001','f8500000-0000-0000-0000-000000000001','{"cantidad_contada":3,"codigo":"001234","ubicacion":"B-02-03","serie":"00001","partida":"00725","pieza_producto":"0001","fecha_vencimiento":"2027-05-15","talla":"M","color":"NEGRO"}','first reason','f8600000-0000-0000-0000-000000000010')->>'rectification_number')::integer), 1, 'canonical replay returns R001');
select is((select count(*) from public.cut_rectifications where request_id = 'f8600000-0000-0000-0000-000000000010'), 1::bigint, 'idempotent retry adds no rectification');
select throws_ok($$select public.rectify_cut('f8300000-0000-0000-0000-000000000001','f8500000-0000-0000-0000-000000000001','{"ubicacion":"B-02-03","codigo":"001234","cantidad_contada":4}','first reason','f8600000-0000-0000-0000-000000000010')$$, '23514', 'IDEMPOTENCY_CONFLICT', 'payload change conflicts with same request id');
select lives_ok($$select public.rectify_cut('f8300000-0000-0000-0000-000000000001','f8500000-0000-0000-0000-000000000002','{"ubicacion":"C-03-04","codigo":"001234","cantidad_contada":4}','B reason','f8600000-0000-0000-0000-000000000011')$$, 'second record gets a rectification');
select lives_ok($$select public.rectify_cut('f8300000-0000-0000-0000-000000000001','f8500000-0000-0000-0000-000000000001','{"ubicacion":"D-04-05","codigo":"001234","cantidad_contada":5}','A again','f8600000-0000-0000-0000-000000000012')$$, 'first record gets a later rectification');
select is((select array_agg(rectification_number order by rectification_number) from public.cut_rectifications where cut_id = 'f8300000-0000-0000-0000-000000000001'), array[1,2,3], 'R001/R002/R003 numbers are global per cut');
select is((select old_values ->> 'cantidad_contada' from public.cut_rectifications where request_id = 'f8600000-0000-0000-0000-000000000012'), '3', 'R003 uses R001 effective values, not R002');
select is((select count(*) from public.audit_events where event_type = 'RECTIFICATION_CREATED' and entity_id = (select id from public.cut_rectifications where request_id = 'f8600000-0000-0000-0000-000000000010')), 1::bigint, 'idempotent retry writes one business audit');
select is((select count(*) from public.artifact_generations where scope = 'RECTIFICATION_XLSX' and rectification_id = (select id from public.cut_rectifications where request_id = 'f8600000-0000-0000-0000-000000000010')), 1::bigint, 'rectification reserves one XLSX lifecycle row');
select is((select count(*) from public.audit_events where event_type = 'ARTIFACT_REQUESTED' and entity_id = (select id from public.artifact_generations where scope = 'RECTIFICATION_XLSX' and rectification_id = (select id from public.cut_rectifications where request_id = 'f8600000-0000-0000-0000-000000000010'))), 1::bigint, 'rectification retry writes one artifact request audit');
select ok((select as_of_at is not null and as_of_at = (select created_at from public.cut_rectifications where request_id = 'f8600000-0000-0000-0000-000000000010') from public.artifact_generations where scope = 'RECTIFICATION_XLSX' and rectification_id = (select id from public.cut_rectifications where request_id = 'f8600000-0000-0000-0000-000000000010')), 'rectification XLSX as_of_at is exactly the rectification creation instant');
select throws_ok($$select public.rectify_cut('f8300000-0000-0000-0000-000000000001','f8500000-0000-0000-0000-000000000002','{"ubicacion":"B-02-03","codigo":"001234","cantidad_contada":3}','first reason','f8600000-0000-0000-0000-000000000010')$$, '23514', 'IDEMPOTENCY_CONFLICT', 'different count record conflicts with same request id');
select throws_ok($$select public.rectify_cut('f8300000-0000-0000-0000-000000000001','f8500000-0000-0000-0000-000000000001','{"ubicacion":"B-02-03","codigo":"001234","serie":"00001","partida":"00725","pieza_producto":"0001","fecha_vencimiento":"2027-05-15","talla":"M","color":"NEGRO","cantidad_contada":3}','different reason','f8600000-0000-0000-0000-000000000010')$$, '23514', 'IDEMPOTENCY_CONFLICT', 'different reason conflicts with same request id');
reset role;
select set_config('request.jwt.claim.sub', 'f8000000-0000-0000-0000-000000000001', true); set local role authenticated;
select throws_ok($$select public.rectify_cut('f8300000-0000-0000-0000-000000000001','f8500000-0000-0000-0000-000000000001','{"ubicacion":"B-02-03","codigo":"001234","serie":"00001","partida":"00725","pieza_producto":"0001","fecha_vencimiento":"2027-05-15","talla":"M","color":"NEGRO","cantidad_contada":3}','first reason','f8600000-0000-0000-0000-000000000010')$$, '23514', 'IDEMPOTENCY_CONFLICT', 'different actor conflicts with same request id');
reset role;
select set_config('request.jwt.claim.sub', 'f8000000-0000-0000-0000-000000000002', true); set local role authenticated;
reset role;
select throws_ok($$insert into public.artifact_generations (inventory_id, cut_id, rectification_id, artifact_type, scope, request_id, request_fingerprint, request_origin, requested_by, storage_path, as_of_at) values ('f8100000-0000-0000-0000-000000000001', 'f8300000-0000-0000-0000-000000000002', (select id from public.cut_rectifications where request_id = 'f8600000-0000-0000-0000-000000000010'), 'RECTIFICATION_XLSX', 'RECTIFICATION_XLSX', 'f8700000-0000-0000-0000-000000000001', repeat('c', 64), 'SYSTEM', 'f8000000-0000-0000-0000-000000000002', 'inventory/f8/cross-cut.xlsx', now())$$, '23503', 'artifact_generations_rectification_cut_inventory_fkey', 'artifact generation rejects a rectification from another cut');
select throws_ok($$insert into public.generated_files (inventory_id, cut_id, rectification_id, artifact_generation_id, file_type, file_name, storage_path, sha256, size_bytes, content_type, created_by) values ('f8100000-0000-0000-0000-000000000001', 'f8300000-0000-0000-0000-000000000002', (select id from public.cut_rectifications where request_id = 'f8600000-0000-0000-0000-000000000010'), (select id from public.artifact_generations where scope = 'RECTIFICATION_XLSX' and rectification_id = (select id from public.cut_rectifications where request_id = 'f8600000-0000-0000-0000-000000000010')), 'RECTIFICATION_XLSX', 'cross-cut.xlsx', 'inventory/f8/cross-cut.xlsx', repeat('c', 64), 1, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'f8000000-0000-0000-0000-000000000002')$$, '23503', 'generated_files_rectification_cut_inventory_fkey', 'generated file rejects a rectification from another cut');
select set_config('request.jwt.claim.sub', 'f8000000-0000-0000-0000-000000000002', true); set local role authenticated;
select is((select cantidad_contada from public.count_records where id = 'f8500000-0000-0000-0000-000000000001'), 1, 'rectification does not mutate count record');
select is((select snapshot ->> 'cantidad_contada' from public.inventory_cut_items where count_record_id = 'f8500000-0000-0000-0000-000000000001'), '1', 'rectification does not mutate snapshot');
select is((select sha256 from public.generated_files where cut_id = 'f8300000-0000-0000-0000-000000000001' and file_type = 'CUT_XLSX'), repeat('a', 64), 'rectification does not mutate original CUT_XLSX metadata');
reset role;

select set_config('request.jwt.claim.sub', 'f8000000-0000-0000-0000-000000000002', true); set local role authenticated;
select lives_ok($$select public.freeze_inventory('f8100000-0000-0000-0000-000000000002')$$, 'assigned analyst freezes closed inventory');
select is((select status from public.inventories where id = 'f8100000-0000-0000-0000-000000000002'), 'CONGELADO'::public.inventory_status, 'freeze transition remains valid');
reset role;
select is((select count(*) from public.artifact_generations where inventory_id = 'f8100000-0000-0000-0000-000000000002' and scope = 'FINAL_FROZEN_BACKUP' and status = 'REQUESTED'), 1::bigint, 'freeze reserves one final backup');

select set_config('request.jwt.claim.sub', 'f8000000-0000-0000-0000-000000000004', true); set local role authenticated;
select is((select count(*) from public.artifact_generations where inventory_id = 'f8100000-0000-0000-0000-000000000001'), 0::bigint, 'unassigned ANALISTA sees no artifact lifecycle metadata');
reset role;

select * from finish();
rollback;
