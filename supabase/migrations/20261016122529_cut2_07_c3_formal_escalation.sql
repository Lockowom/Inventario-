-- CUT2-07: C3 remains a recount_mission.  This is an additive provenance and
-- decision-evidence layer; it never adjusts ERP nor mutates C1/C2 evidence.
alter table public.recount_missions
  add column if not exists source_c2_mission_id uuid references public.recount_missions(id) on delete restrict,
  add column if not exists c3_result text,
  add column if not exists c3_decision_ready_at timestamptz;

alter table public.recount_missions
  drop constraint if exists recount_missions_c3_result_check;
alter table public.recount_missions
  add constraint recount_missions_c3_result_check check (
    c3_result is null or c3_result in ('C3_CONFIRMS_MATCH','C3_CONFIRMS_DIFFERENCE','C3_INACCESSIBLE','C3_HELD','C3_IDENTITY_CONFLICT')
  );
create unique index if not exists recount_missions_one_c3_per_source_c2_idx
  on public.recount_missions(source_c2_mission_id) where round=3 and source_c2_mission_id is not null;
create index if not exists recount_missions_c3_queue_idx
  on public.recount_missions(inventory_id,status,created_at,id) where round=3 and status in ('QUEUED','ACTIVE');

-- The historical C2 completion path already creates C3 idempotently by
-- (case_id, round). This trigger binds that C3 to its exact completed C2,
-- carries the immutable cut/sealed-reference chain, and is safe on retries.
create or replace function app_private.bind_c3_to_completed_c2()
returns trigger language plpgsql security definer
set search_path=public,app_private,pg_temp as $function$
declare v_c3 uuid;
begin
  if new.round<>2 or new.status<>'COMPLETED' or old.status='COMPLETED' then return new; end if;
  if not exists(select 1 from public.reconciliation_cases c where c.id=new.case_id and c.status='REQUIERE_3ER_CONTEO') then return new; end if;
  insert into public.recount_missions(case_id,inventory_id,round,created_by,source_cut_id,source_sealed_reference_id,source_c2_mission_id)
  values(new.case_id,new.inventory_id,3,new.assigned_user_id,new.source_cut_id,new.source_sealed_reference_id,new.id)
  on conflict(case_id,round) do update
    set source_c2_mission_id=excluded.source_c2_mission_id,
        source_cut_id=coalesce(public.recount_missions.source_cut_id,excluded.source_cut_id),
        source_sealed_reference_id=coalesce(public.recount_missions.source_sealed_reference_id,excluded.source_sealed_reference_id)
  returning id into v_c3;
  perform app_private.append_reconciliation_event(new.case_id,new.inventory_id,'C3_CREATED',new.assigned_user_id,
    jsonb_build_object('source_c2_mission_id',new.id,'c3_mission_id',v_c3,'source_cut_id',new.source_cut_id,'sealed_reference_id',new.source_sealed_reference_id));
  return new;
end $function$;
revoke all on function app_private.bind_c3_to_completed_c2() from public,anon,authenticated;
drop trigger if exists recount_missions_bind_c3_to_completed_c2 on public.recount_missions;
create trigger recount_missions_bind_c3_to_completed_c2
after update of status on public.recount_missions for each row execute function app_private.bind_c3_to_completed_c2();

create or replace function app_private.fill_c3_source_chain()
returns trigger language plpgsql security definer
set search_path=public,app_private,pg_temp as $function$
declare v_c2 public.recount_missions;
begin
  if new.round<>3 or new.source_c2_mission_id is not null then return new; end if;
  select * into v_c2 from public.recount_missions
  where case_id=new.case_id and round=2 and status='COMPLETED'
  order by completed_at desc,id desc limit 1;
  if v_c2.id is null then raise exception 'C3_NOT_ELIGIBLE' using errcode='23514'; end if;
  new.source_c2_mission_id:=v_c2.id;
  new.source_cut_id:=coalesce(new.source_cut_id,v_c2.source_cut_id);
  new.source_sealed_reference_id:=coalesce(new.source_sealed_reference_id,v_c2.source_sealed_reference_id);
  return new;
end $function$;
revoke all on function app_private.fill_c3_source_chain() from public,anon,authenticated;
drop trigger if exists recount_missions_fill_c3_source_chain on public.recount_missions;
create trigger recount_missions_fill_c3_source_chain
before insert on public.recount_missions for each row execute function app_private.fill_c3_source_chain();

-- C3 physical execution is blind: the server keeps identity internally to
-- validate scans, but does not disclose prior count, system value, or the
-- expected batch/serial in the mission payload.
create or replace function app_private.recount_mission_json(p_mission_id uuid)
returns jsonb language sql stable security definer
set search_path=public,app_private,pg_temp as $function$
  select jsonb_build_object(
    'id',m.id,'case_id',m.case_id,'inventory_id',m.inventory_id,'round',m.round,'status',m.status,
    'execution_state',case when m.status='ACTIVE' and m.started_at is null then 'CLAIMED' when m.status='ACTIVE' then 'ACTIVE' else m.status::text end,
    'sla_due_at',case when m.round=2 then m.c2_due_at else null end,
    'sla_state',case when m.round=2 and m.overdue_at is not null then 'C2_OVERDUE_OPERATIONAL' when m.round=2 and m.c2_due_at<=now() then 'C2_OVERDUE_OPERATIONAL' when m.round=2 then 'ON_TIME' else null end,
    'codigo',r.codigo,'descripcion',mi.descripcion,'reference_type',r.reference_type,
    'reference_value',case when m.round=3 then null else r.reference_value end,
    'known_locations',app_private.recount_case_locations(r.id),
    'source_chain',case when m.round=3 then jsonb_build_object('source_cut_id',m.source_cut_id,'sealed_reference_id',m.source_sealed_reference_id,'source_c2_mission_id',m.source_c2_mission_id) else null end,
    'subtasks',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'location',s.location,'strategy',s.strategy,'status',s.status,'logistic_unit',s.logistic_unit,'counted_quantity',s.counted_quantity,'exception_reason',s.exception_reason,'created_at',s.created_at,'started_at',s.started_at,'completed_at',s.completed_at,'scanned_series_count',(select count(*)::integer from public.recount_subtask_serial_scans scan where scan.subtask_id=s.id),'recent_series',coalesce((select jsonb_agg(scan.serie order by scan.scanned_at desc) from (select serie,scanned_at from public.recount_subtask_serial_scans where subtask_id=s.id order by scanned_at desc limit 5) scan),'[]'::jsonb)) order by case when s.location='TECHO' then 1 else 0 end,s.location) from public.recount_mission_subtasks s where s.mission_id=m.id),'[]'::jsonb),
    'observations',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'client_count_id',c.client_count_id,'ubicacion',c.ubicacion,'cantidad',c.cantidad_contada,'captured_at',c.captured_at) order by c.captured_at,c.id) from public.recount_mission_observations o join public.count_records c on c.id=o.count_record_id where o.mission_id=m.id),'[]'::jsonb)
  ) from public.recount_missions m join public.reconciliation_cases r on r.id=m.case_id join public.inventory_master_items mi on mi.inventory_id=r.inventory_id and mi.codigo=r.codigo where m.id=p_mission_id
$function$;

-- Complete C3 as evidence only. A later decision flow can consume its result;
-- it does not mark the case physically confirmed merely through a quantity vote.
create or replace function app_private.finalize_c3_decision_evidence()
returns trigger language plpgsql security definer
set search_path=public,app_private,pg_temp as $function$
declare v_case public.reconciliation_cases; v_result text;
begin
  if new.round<>3 or new.status<>'COMPLETED' or old.status='COMPLETED' then return new; end if;
  select * into v_case from public.reconciliation_cases where id=new.case_id for update;
  if exists(select 1 from public.recount_mission_subtasks where mission_id=new.id and status='INACCESSIBLE') then v_result:='C3_INACCESSIBLE';
  elsif exists(select 1 from public.recount_mission_subtasks where mission_id=new.id and status='ESCALATED') then v_result:='C3_HELD';
  elsif new.total_quantity=v_case.system_quantity then v_result:='C3_CONFIRMS_MATCH';
  else v_result:='C3_CONFIRMS_DIFFERENCE'; end if;
  update public.recount_missions set c3_result=v_result,c3_decision_ready_at=now() where id=new.id;
  update public.reconciliation_cases set status='PENDIENTE_ANALISIS',confirmed_physical_quantity=null where id=v_case.id;
  perform app_private.append_reconciliation_event(v_case.id,new.inventory_id,'THIRD_RECORDED',new.assigned_user_id,
    jsonb_build_object('mission_id',new.id,'source_c2_mission_id',new.source_c2_mission_id,'c3_result',v_result,'erp_adjusted',false));
  return new;
end $function$;
revoke all on function app_private.finalize_c3_decision_evidence() from public,anon,authenticated;
drop trigger if exists recount_missions_finalize_c3_decision_evidence on public.recount_missions;
create trigger recount_missions_finalize_c3_decision_evidence
after update of status on public.recount_missions for each row execute function app_private.finalize_c3_decision_evidence();

-- C3 may never be claimed by the C2 executor. C1 originator separation is
-- already enforced for C2; this adds independent C3 evidence.
do $block$
declare v_def text;
begin
  select pg_get_functiondef('public.claim_next_recount_mission(uuid)'::regprocedure) into v_def;
  if position('CUT2_07_C3_ORIGINATOR' in v_def)=0 then
    v_def:=replace(v_def,
      'and (v_round<>2 or not exists(select 1 from public.reconciliation_cases rc',
      'and (v_round<>3 or not exists(select 1 from public.recount_missions c2 where c2.case_id=m.case_id and c2.round=2 and c2.assigned_user_id=v_actor)) -- CUT2_07_C3_ORIGINATOR\n    and (v_round<>2 or not exists(select 1 from public.reconciliation_cases rc');
    execute v_def;
  end if;
end $block$;

revoke all on function public.claim_next_recount_mission(uuid),app_private.recount_mission_json(uuid) from public,anon;
grant execute on function public.claim_next_recount_mission(uuid) to authenticated;
