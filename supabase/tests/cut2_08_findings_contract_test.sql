begin;
select plan(20);

select has_table('public','reference_findings','CUT2-08 extends the canonical finding family');
select has_table('public','finding_evidence','evidence remains in the canonical family');
select has_table('public','reference_finding_events','operational timeline is append-only');
select has_column('public','reference_findings','severity','canonical severity is persisted');
select has_column('public','reference_findings','source_stage','source stage is persisted');
select has_column('public','reference_findings','resolution_code','typed resolution is persisted');
select has_column('public','reference_findings','source_mission_id','C2/C3 provenance is persisted');
select has_column('public','reference_findings','blocks_recount_completion','mission blocker is explicit');
select has_column('public','reference_findings','blocks_rp','RP eligibility blocker is explicit');
select has_column('public','reference_findings','blocks_close','close blocker is explicit');
select has_index('public','reference_findings','reference_findings_source_event_key_uidx','source event idempotency is indexed');
select has_function('public','assign_reference_finding',array['uuid','uuid'],'assignment is a server RPC');
select has_function('public','resolve_reference_finding',array['uuid','public.cut2_finding_resolution_code','text'],'resolution accepts a typed code');
select has_function('public','add_reference_finding_evidence',array['uuid','jsonb','text','text'],'evidence append is a server RPC');
select has_function('public','get_live_monitor_findings',array['uuid','integer'],'Monitor findings are server projected');
select has_trigger('public','recount_subtask_findings','recount_subtask_findings_bridge_canonical','C2/C3 capture bridges into the sole finding family');
select has_trigger('public','recount_missions','recount_missions_guard_finding_completion','open critical mission finding blocks completion');
select is(has_function_privilege('anon','public.resolve_reference_finding(uuid,public.cut2_finding_resolution_code,text)','EXECUTE'),false,'anon cannot resolve a finding');
select is(has_function_privilege('anon','public.assign_reference_finding(uuid,uuid)','EXECUTE'),false,'anon cannot assign a finding');
select ok(position('resolution_code' in lower(pg_get_constraintdef(oid)))>0,'resolved findings cannot bypass the typed-resolution constraint')
from pg_constraint where conrelid='public.reference_findings'::regclass and conname='reference_findings_resolution_code_check';

select * from finish();
rollback;
