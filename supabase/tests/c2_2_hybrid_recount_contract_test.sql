begin;
select plan(22);

select has_table('public','recount_mission_subtasks','C2.0 persists execution by mission and location');
select has_table('public','recount_subtask_serial_scans','C2.0 keeps an immutable serial scan trail');
select has_table('public','recount_subtask_findings','C2.0 records warehouse findings separately from quantity');
select has_column('public','recount_mission_subtasks','inventory_id','subtasks carry inventory scope for realtime invalidation');
select has_column('public','recount_mission_subtasks','strategy','subtasks preserve the chosen execution strategy');
select has_column('public','recount_mission_subtasks','status','subtasks preserve their explicit closure status');

select has_function('public','start_my_recount_subtask',array['uuid'],'start subtask RPC exists');
select has_function('public','record_my_recount_subtask',array['uuid','text','integer','text','text','text'],'record subtask RPC exists');
select has_function('public','finish_my_serial_sweep',array['uuid'],'finish sweep RPC exists');
select has_function('public','resolve_my_recount_subtask',array['uuid','public.recount_subtask_status','text'],'explicit zero/inaccessible/escalated RPC exists');
select has_function('public','add_my_recount_location',array['uuid','text','text'],'operator-discovered location RPC exists');
select has_function('public','report_my_recount_finding',array['uuid','public.recount_finding_type','text'],'finding RPC exists');
select has_function('public','get_c2_execution_metrics',array['uuid'],'C2 monitor metrics RPC exists');

select ok(position('for update skip locked' in lower(pg_get_functiondef('public.claim_next_recount_mission(uuid)'::regprocedure))) > 0,'queue claims remain concurrency safe');
select ok(position('every location subtask must be resolved' in lower(pg_get_functiondef('app_private.complete_recount_mission_internal(uuid,uuid,boolean)'::regprocedure))) > 0,'a mission cannot close with PENDING or ACTIVE locations');
select ok(position('70' in pg_get_functiondef('app_private.serial_recount_strategy(integer,integer)'::regprocedure)) > 0,'serial sweep threshold is owned by the database strategy function');
select ok(position('0.20' in pg_get_functiondef('app_private.serial_recount_strategy(integer,integer)'::regprocedure)) > 0,'serial anomaly threshold is owned by the database strategy function');

select is(has_function_privilege('anon','public.record_my_recount_subtask(uuid,text,integer,text,text,text)','EXECUTE'),false,'anon cannot record C2 evidence');
select is(has_function_privilege('authenticated','public.record_my_recount_subtask(uuid,text,integer,text,text,text)','EXECUTE'),true,'authenticated users can enter the guarded C2 RPC');
select is(has_table_privilege('authenticated','public.recount_mission_subtasks','SELECT'),false,'authenticated users cannot bypass guarded subtasks by direct table read');
select is((select rowsecurity from pg_tables where schemaname='public' and tablename='recount_mission_subtasks'),true,'subtask storage has RLS enabled');
select ok(exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='recount_mission_subtasks'),'subtask changes invalidate the live monitor in realtime');

select * from finish();
rollback;
