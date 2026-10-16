begin;
select plan(14);

select has_column('public','recount_missions','source_c2_mission_id','C3 keeps direct C2 provenance');
select has_column('public','recount_missions','c3_result','C3 stores decision evidence result');
select has_column('public','recount_missions','c3_decision_ready_at','C3 stores decision-ready timestamp');
select has_index('public','recount_missions','recount_missions_one_c3_per_source_c2_idx','one C3 is allowed per source C2');
select has_index('public','recount_missions','recount_missions_c3_queue_idx','C3 queue has a focused index');
select has_function('app_private','fill_c3_source_chain',array[]::text[],'C3 source-chain trigger exists');
select has_function('app_private','finalize_c3_decision_evidence',array[]::text[],'C3 evidence finalizer exists');
select has_trigger('public','recount_missions','recount_missions_fill_c3_source_chain','C3 source chain is filled on insert');
select has_trigger('public','recount_missions','recount_missions_finalize_c3_decision_evidence','C3 cannot auto-confirm a case on completion');
select ok(position('case when m.round=3 then null else r.reference_value end' in lower(pg_get_functiondef('app_private.recount_mission_json(uuid)'::regprocedure)))>0,'C3 payload redacts expected identity during blind capture');
select ok(position('cut2_07_c3_originator' in lower(pg_get_functiondef('public.claim_next_recount_mission(uuid)'::regprocedure)))>0,'C3 claim excludes the C2 executor');
select ok(position('recount_c3' in lower(pg_get_functiondef('public.claim_next_recount_mission(uuid)'::regprocedure)))>0,'C3 capability is distinct in claim authority');
select ok(position('erp_adjusted' in lower(pg_get_functiondef('app_private.finalize_c3_decision_evidence()'::regprocedure)))>0,'C3 audit explicitly records no ERP adjustment');
select ok(position('pendiente_analisis' in lower(pg_get_functiondef('app_private.finalize_c3_decision_evidence()'::regprocedure)))>0,'C3 completion leaves decision to a later flow');

select * from finish();
rollback;
