begin;
select plan(28);

select ok(coalesce((select not has_function_privilege('anon',p.oid,'EXECUTE') from pg_proc p where p.oid=to_regprocedure('public.rls_auto_enable()')),true),'A9: anon cannot execute rls_auto_enable when the QA event-trigger helper is present');
select ok(coalesce((select not has_function_privilege('authenticated',p.oid,'EXECUTE') from pg_proc p where p.oid=to_regprocedure('public.rls_auto_enable()')),true),'A9: authenticated cannot execute rls_auto_enable when the QA event-trigger helper is present');
select ok(coalesce((select not has_function_privilege('public',p.oid,'EXECUTE') from pg_proc p where p.oid=to_regprocedure('public.rls_auto_enable()')),true),'A9: PUBLIC cannot execute rls_auto_enable when the QA event-trigger helper is present');
select ok(coalesce((select has_function_privilege('service_role',p.oid,'EXECUTE') from pg_proc p where p.oid=to_regprocedure('public.rls_auto_enable()')),true),'A9: service role retains rls_auto_enable when the QA event-trigger helper is present');

select ok(not has_function_privilege('anon','public.cut2_reference_is_critical(uuid)','EXECUTE'),'A9: anon cannot execute criticality helper');
select ok(not has_function_privilege('authenticated','public.cut2_reference_is_critical(uuid)','EXECUTE'),'A9: authenticated cannot execute criticality helper');
select ok(not has_function_privilege('public','public.cut2_reference_is_critical(uuid)','EXECUTE'),'A9: PUBLIC cannot execute criticality helper');
select ok(has_function_privilege('postgres','public.cut2_reference_is_critical(uuid)','EXECUTE'),'A9: postgres retains criticality helper for internal definer calls');

select ok(not has_function_privilege('anon','public.operational_deadline_after(uuid,timestamptz,integer)','EXECUTE'),'A9: anon cannot execute deadline helper');
select ok(not has_function_privilege('authenticated','public.operational_deadline_after(uuid,timestamptz,integer)','EXECUTE'),'A9: authenticated cannot execute deadline helper');
select ok(not has_function_privilege('public','public.operational_deadline_after(uuid,timestamptz,integer)','EXECUTE'),'A9: PUBLIC cannot execute deadline helper');
select ok(has_function_privilege('postgres','public.operational_deadline_after(uuid,timestamptz,integer)','EXECUTE'),'A9: postgres retains deadline helper for internal definer calls');

select ok(not has_function_privilege('anon','public.operational_minutes_between(uuid,timestamptz,timestamptz)','EXECUTE'),'A9: anon cannot execute SLA-minute helper');
select ok(not has_function_privilege('authenticated','public.operational_minutes_between(uuid,timestamptz,timestamptz)','EXECUTE'),'A9: authenticated cannot execute SLA-minute helper');
select ok(not has_function_privilege('public','public.operational_minutes_between(uuid,timestamptz,timestamptz)','EXECUTE'),'A9: PUBLIC cannot execute SLA-minute helper');
select ok(has_function_privilege('postgres','public.operational_minutes_between(uuid,timestamptz,timestamptz)','EXECUTE'),'A9: postgres retains SLA-minute helper for internal definer calls');

select ok(not has_function_privilege('anon','public.validate_inventory_close_backup(uuid)','EXECUTE'),'A9: anon cannot execute close-backup helper');
select ok(not has_function_privilege('authenticated','public.validate_inventory_close_backup(uuid)','EXECUTE'),'A9: authenticated cannot execute close-backup helper');
select ok(not has_function_privilege('public','public.validate_inventory_close_backup(uuid)','EXECUTE'),'A9: PUBLIC cannot execute close-backup helper');
select ok(has_function_privilege('postgres','public.validate_inventory_close_backup(uuid)','EXECUTE'),'A9: postgres retains close-backup helper for internal definer calls');

select ok(not has_function_privilege('anon','public.verify_rp_release_integrity_metadata(uuid)','EXECUTE'),'A9: anon cannot execute RP integrity helper');
select ok(not has_function_privilege('authenticated','public.verify_rp_release_integrity_metadata(uuid)','EXECUTE'),'A9: authenticated cannot execute RP integrity helper');
select ok(not has_function_privilege('public','public.verify_rp_release_integrity_metadata(uuid)','EXECUTE'),'A9: PUBLIC cannot execute RP integrity helper');
select ok(has_function_privilege('postgres','public.verify_rp_release_integrity_metadata(uuid)','EXECUTE'),'A9: postgres retains RP integrity helper for internal definer calls');

select ok(has_function_privilege('authenticated','public.get_live_monitor_summary(uuid)','EXECUTE'),'A9: Monitor RPC remains available to its guarded authenticated boundary');
select ok(has_function_privilege('authenticated','public.claim_next_recount_mission(uuid)','EXECUTE'),'A9: C2/C3 claim boundary remains available');
select ok(has_function_privilege('authenticated','public.resolve_reference_finding(uuid,public.cut2_finding_resolution_code,text)','EXECUTE'),'A9: findings boundary remains available');
select ok(has_function_privilege('authenticated','public.close_inventory_final(uuid,text,uuid)','EXECUTE'),'A9: final-close boundary remains available');

select * from finish();
rollback;
