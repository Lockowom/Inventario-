begin;
select plan(16);

select ok(not exists (
  select 1
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and has_function_privilege('anon', procedure.oid, 'EXECUTE')
), 'anon cannot execute any public INVEN3 function');

select ok(not exists (
  select 1
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  cross join lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) privilege
  where namespace.nspname = 'public'
    and privilege.grantee = 0
    and privilege.privilege_type = 'EXECUTE'
), 'PUBLIC cannot grant execute on public INVEN3 functions');

select ok(not exists (
  select 1
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  cross join lateral (
    values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
  ) operation(privilege_type)
  where namespace.nspname = 'public'
    and relation.relkind in ('r', 'p')
    and has_table_privilege('anon', relation.oid, operation.privilege_type)
), 'anon has no public INVEN3 table DML privileges');

select ok(not exists (
  select 1
  from pg_class sequence
  join pg_namespace namespace on namespace.oid = sequence.relnamespace
  cross join lateral (
    values ('USAGE'), ('SELECT'), ('UPDATE')
  ) operation(privilege_type)
  where namespace.nspname = 'public'
    and sequence.relkind = 'S'
    and has_sequence_privilege('anon', sequence.oid, operation.privilege_type)
), 'anon has no public sequence privileges');

select ok(not has_function_privilege('anon', 'public.get_server_time()', 'EXECUTE'), 'anon cannot execute get_server_time');
select ok(has_function_privilege('authenticated', 'public.get_server_time()', 'EXECUTE'), 'authenticated can execute get_server_time');
select ok(not has_schema_privilege('anon', 'app_private', 'USAGE'), 'anon has no app_private usage');
select ok(not has_schema_privilege('authenticated', 'app_private', 'USAGE'), 'authenticated has no app_private usage');

select ok(not exists (
  select 1
  from (values
    ('public.prepare_inventory(uuid)'::regprocedure),
    ('public.open_inventory(uuid)'::regprocedure),
    ('public.close_inventory(uuid)'::regprocedure),
    ('public.freeze_inventory(uuid)'::regprocedure),
    ('public.import_inventory_master(uuid,jsonb,text,text)'::regprocedure),
    ('public.add_master_exception(uuid,text,text,text)'::regprocedure),
    ('public.register_sync_device(uuid,public.device_platform,text,text)'::regprocedure),
    ('public.report_device_sync_state(uuid,uuid,integer)'::regprocedure),
    ('public.sync_counts(uuid,uuid,public.device_platform,text,text,jsonb)'::regprocedure),
    ('public.create_cut(uuid,uuid)'::regprocedure),
    ('public.get_cut_items(uuid,integer,bigint)'::regprocedure),
    ('public.request_cut_file_generation(uuid,uuid)'::regprocedure),
    ('public.get_cut_file_download(uuid)'::regprocedure),
    ('public.rectify_cut(uuid,uuid,jsonb,text,uuid)'::regprocedure),
    ('public.authorize_inventory_artifact_generation(uuid)'::regprocedure),
    ('public.get_inventory_artifact_download(uuid)'::regprocedure),
    ('public.get_server_time()'::regprocedure)
  ) critical(function_oid)
  where not has_function_privilege('authenticated', critical.function_oid, 'EXECUTE')
), 'authenticated preserves all critical client RPC grants');

select ok(not exists (
  select 1
  from (values
    ('public.get_cut_export_source(uuid)'::regprocedure),
    ('public.record_cut_file_generated(uuid,uuid,text,text,text,bigint,text)'::regprocedure),
    ('public.finalize_cut_file(uuid,uuid)'::regprocedure),
    ('public.get_inventory_artifact_source(uuid)'::regprocedure),
    ('public.record_inventory_artifact_generated(uuid,text,text,bigint,text)'::regprocedure),
    ('public.finalize_inventory_artifact(uuid)'::regprocedure)
  ) critical(function_oid)
  where not has_function_privilege('service_role', critical.function_oid, 'EXECUTE')
), 'service_role preserves critical server-only RPC grants');

select is((select public from storage.buckets where id = 'inventory-rp'), false, 'inventory-rp remains private');
select is((select file_size_limit from storage.buckets where id = 'inventory-rp'), 52428800, 'inventory-rp remains limited to 50 MiB');
select is((select allowed_mime_types from storage.buckets where id = 'inventory-rp'), array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/json', 'application/zip']::text[], 'inventory-rp MIME contract remains unchanged');

create table public.phase_9_anon_default_table_probe (id bigint primary key);
create sequence public.phase_9_anon_default_sequence_probe;
create function public.phase_9_anon_default_function_probe() returns integer language sql as $$ select 1 $$;

select ok(not has_table_privilege('anon', 'public.phase_9_anon_default_table_probe', 'SELECT'), 'future public tables created by migration executor deny anon');
select ok(not has_sequence_privilege('anon', 'public.phase_9_anon_default_sequence_probe', 'USAGE'), 'future public sequences created by migration executor deny anon');
select ok(not has_function_privilege('anon', 'public.phase_9_anon_default_function_probe()', 'EXECUTE'), 'future public functions created by migration executor deny anon');

select * from finish();
rollback;
