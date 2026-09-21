begin;
select plan(27);

select ok(not has_function_privilege('anon', 'public.get_cut_export_source(uuid)', 'EXECUTE'), 'anon cannot read a cut export source');
select ok(not has_function_privilege('anon', 'public.record_cut_file_generated(uuid,uuid,text,text,text,bigint,text)', 'EXECUTE'), 'anon cannot record an artifact');
select ok(not has_function_privilege('anon', 'public.recover_cut_file_generated(uuid,uuid)', 'EXECUTE'), 'anon cannot recover an artifact');
select ok(not has_function_privilege('anon', 'public.mark_cut_file_error(uuid,uuid,text)', 'EXECUTE'), 'anon cannot mark a generation error');
select ok(not has_function_privilege('anon', 'public.mark_cut_file_validated(uuid,uuid)', 'EXECUTE'), 'anon cannot validate an artifact');
select ok(not has_function_privilege('anon', 'public.finalize_cut_file(uuid,uuid)', 'EXECUTE'), 'anon cannot finalize an artifact');

select ok(not has_function_privilege('authenticated', 'public.get_cut_export_source(uuid)', 'EXECUTE'), 'authenticated cannot read a cut export source');
select ok(not has_function_privilege('authenticated', 'public.record_cut_file_generated(uuid,uuid,text,text,text,bigint,text)', 'EXECUTE'), 'authenticated cannot record an artifact');
select ok(not has_function_privilege('authenticated', 'public.recover_cut_file_generated(uuid,uuid)', 'EXECUTE'), 'authenticated cannot recover an artifact');
select ok(not has_function_privilege('authenticated', 'public.mark_cut_file_error(uuid,uuid,text)', 'EXECUTE'), 'authenticated cannot mark a generation error');
select ok(not has_function_privilege('authenticated', 'public.mark_cut_file_validated(uuid,uuid)', 'EXECUTE'), 'authenticated cannot validate an artifact');
select ok(not has_function_privilege('authenticated', 'public.finalize_cut_file(uuid,uuid)', 'EXECUTE'), 'authenticated cannot finalize an artifact');

select ok(has_function_privilege('service_role', 'public.get_cut_export_source(uuid)', 'EXECUTE'), 'service_role can read a cut export source');
select ok(has_function_privilege('service_role', 'public.record_cut_file_generated(uuid,uuid,text,text,text,bigint,text)', 'EXECUTE'), 'service_role can record an artifact');
select ok(has_function_privilege('service_role', 'public.recover_cut_file_generated(uuid,uuid)', 'EXECUTE'), 'service_role can recover an artifact');
select ok(has_function_privilege('service_role', 'public.mark_cut_file_error(uuid,uuid,text)', 'EXECUTE'), 'service_role can mark a generation error');
select ok(has_function_privilege('service_role', 'public.mark_cut_file_validated(uuid,uuid)', 'EXECUTE'), 'service_role can validate an artifact');
select ok(has_function_privilege('service_role', 'public.finalize_cut_file(uuid,uuid)', 'EXECUTE'), 'service_role can finalize an artifact');

select ok(not has_table_privilege('anon', 'public.generated_files', 'SELECT'), 'anon cannot directly read generated files');
select ok(not has_table_privilege('authenticated', 'public.generated_files', 'SELECT'), 'authenticated cannot directly read generated files');
select ok(not has_table_privilege('anon', 'public.inventory_cuts', 'SELECT'), 'anon cannot directly read cuts');
select ok(not has_table_privilege('authenticated', 'public.inventory_cuts', 'SELECT'), 'authenticated cannot directly read cuts');
select ok(has_table_privilege('service_role', 'public.generated_files', 'SELECT'), 'service role can read artifact metadata server-side');
select ok(has_table_privilege('service_role', 'public.inventory_cuts', 'SELECT'), 'service role can read cut metadata server-side');
select ok(not has_table_privilege('anon', 'storage.objects', 'INSERT, UPDATE, DELETE'), 'anon has no direct storage object write privilege');
select ok(not has_table_privilege('authenticated', 'storage.objects', 'INSERT, UPDATE, DELETE'), 'authenticated has no direct storage object write privilege');
select is((select public from storage.buckets where id = 'inventory-rp'), false, 'inventory-rp bucket is private');

select * from finish();
rollback;
