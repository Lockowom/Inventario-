-- Live C2/C3 reconciliation: C1 remains open while identities are reconciled.
-- This deliberately reuses reconciliation_cases and recount_missions; it does
-- not introduce a second task family, mutate stock, or depend on a cut.

-- These are domain events, not client-facing quantities. They make the
-- provisional C2 lifecycle auditable without overloading a C2 observation.
alter table public.reconciliation_events
  drop constraint if exists reconciliation_events_event_type_check;
alter table public.reconciliation_events
  add constraint reconciliation_events_event_type_check check (event_type in (
    'SECOND_ASSIGNED','SECOND_RECORDED','THIRD_ASSIGNED','THIRD_RECORDED',
    'C2_SUBTASK_RECORDED','C3_CREATED','RESOLVED',
    'LIVE_C2_CREATED','LIVE_C1_BASIS_CHANGED','LIVE_C2_RESOLVED_BY_C1'
  ));

create or replace function app_private.append_reconciliation_event(
  p_case_id uuid,p_inventory_id uuid,p_event_type text,p_actor uuid,p_payload jsonb default '{}'::jsonb
)
returns void language plpgsql security definer
set search_path=public,app_private,pg_temp as $function$
begin
  if p_event_type not in (
    'SECOND_ASSIGNED','SECOND_RECORDED','THIRD_ASSIGNED','THIRD_RECORDED',
    'C2_SUBTASK_RECORDED','C3_CREATED','RESOLVED',
    'LIVE_C2_CREATED','LIVE_C1_BASIS_CHANGED','LIVE_C2_RESOLVED_BY_C1'
  ) then
    raise exception 'Invalid reconciliation event' using errcode='23514';
  end if;
  insert into public.reconciliation_events(case_id,inventory_id,event_type,actor_user_id,payload)
  values(p_case_id,p_inventory_id,p_event_type,p_actor,coalesce(p_payload,'{}'::jsonb));
end
$function$;
revoke all on function app_private.append_reconciliation_event(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;

create or replace function app_private.reconcile_live_c1_identity()
returns trigger
language plpgsql
security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  v_master public.inventory_master_items;
  v_reference_value text;
  v_fingerprint text;
  v_candidate record;
  v_case public.reconciliation_cases;
  v_mission public.recount_missions;
  v_active_mission uuid;
begin
  select m.* into v_master
  from public.inventory_master_items m
  where m.inventory_id=new.inventory_id and m.codigo=new.codigo;
  if v_master.codigo is null then return new; end if;

  -- Recount evidence is reconciled by its completion contract, never as C1.
  select app_private.active_recount_mission_for_count(
    new.inventory_id,new.user_id,new.codigo,new.serie,new.partida
  ) into v_active_mission;
  if v_active_mission is not null then return new; end if;

  v_reference_value:=case v_master.control_type
    when 'SERIAL' then new.serie
    when 'PARTIDA' then new.partida
    else null
  end;

  -- One serializable reconciliation lane per inventory identity prevents two
  -- simultaneous C1 syncs from materialising duplicate C2 work.
  perform pg_advisory_xact_lock(hashtextextended(
    new.inventory_id::text || ':' || new.codigo || ':' || v_master.control_type::text || ':' || coalesce(v_reference_value,''),
    0
  ));

  select fingerprint into v_fingerprint
  from public.inventory_system_reference_metadata
  where inventory_id=new.inventory_id;
  if v_fingerprint is null then return new; end if;

  select * into v_candidate
  from app_private.final_reconciliation_candidates(new.inventory_id) c
  where c.codigo=new.codigo
    and c.reference_type=v_master.control_type
    and coalesce(c.reference_value,'')=coalesce(v_reference_value,'')
    -- Missing system identities are not emitted until coverage is known. A
    -- captured identity, however, is reconciled immediately and dynamically.
    and c.physical_quantity>0
  limit 1;

  if v_candidate.codigo is not null then
    select r.* into v_case
    from public.reconciliation_cases r
    where r.inventory_id=new.inventory_id
      and r.codigo=v_candidate.codigo
      and r.reference_type=v_candidate.reference_type
      and coalesce(r.reference_value,'')=coalesce(v_candidate.reference_value,'')
      and r.anomaly_type=v_candidate.anomaly_type
      and r.source_fingerprint=v_fingerprint
      and r.status<>'RESUELTO'
    order by r.created_at desc
    limit 1
    for update;

    if v_case.id is null then
      insert into public.reconciliation_cases(
        inventory_id,codigo,reference_type,reference_value,anomaly_type,
        system_quantity,physical_quantity,status,first_count_record_id,created_by,source_fingerprint
      ) values (
        new.inventory_id,v_candidate.codigo,v_candidate.reference_type,v_candidate.reference_value,v_candidate.anomaly_type,
        v_candidate.system_quantity,v_candidate.physical_quantity,'REQUIERE_2DO_CONTEO',v_candidate.first_count_record_id,new.user_id,v_fingerprint
      ) returning * into v_case;
      perform app_private.append_reconciliation_event(
        v_case.id,new.inventory_id,'LIVE_C2_CREATED',new.user_id,
        jsonb_build_object('count_record_id',new.id,'reason',v_candidate.anomaly_type,'basis','C1_LIVE_REFERENCE')
      );
    else
      update public.reconciliation_cases
      set system_quantity=v_candidate.system_quantity,
          physical_quantity=v_candidate.physical_quantity,
          first_count_record_id=coalesce(v_candidate.first_count_record_id,first_count_record_id),
          status=case when status='PENDIENTE_ANALISIS' then 'REQUIERE_2DO_CONTEO'::public.reconciliation_status else status end,
          updated_at=now()
      where id=v_case.id
      returning * into v_case;
      perform app_private.append_reconciliation_event(
        v_case.id,new.inventory_id,'LIVE_C1_BASIS_CHANGED',new.user_id,
        jsonb_build_object('count_record_id',new.id,'reason',v_candidate.anomaly_type)
      );
    end if;

    insert into public.recount_missions(case_id,inventory_id,round,created_by)
    values(v_case.id,new.inventory_id,2,new.user_id)
    on conflict(case_id,round) do nothing;

    -- A changed C1 basis can replace one anomaly with another (for example,
    -- a batch mismatch becoming an unexpected identity). Do not leave the
    -- previous, unclaimed logical task claimable beside the current one.
    for v_mission in
      select m.*
      from public.recount_missions m
      join public.reconciliation_cases r on r.id=m.case_id
      where m.inventory_id=new.inventory_id and m.round=2 and m.status='QUEUED'
        and r.id<>v_case.id
        and r.codigo=new.codigo
        and r.reference_type=v_master.control_type
        and coalesce(r.reference_value,'')=coalesce(v_reference_value,'')
        and r.source_fingerprint=v_fingerprint
        and r.status in ('PENDIENTE_ANALISIS','REQUIERE_2DO_CONTEO')
      for update
    loop
      update public.recount_missions set status='CANCELLED',updated_at=now() where id=v_mission.id;
      update public.reconciliation_cases
      set status='RESUELTO', disposition='SIN_AJUSTE',
          resolution_reason='RESOLVED_BY_C1: la identidad fue reemplazada por una conciliación C1 más reciente.',
          resolved_by=new.user_id,resolved_at=now(),updated_at=now()
      where id=v_mission.case_id;
      perform app_private.append_reconciliation_event(
        v_mission.case_id,new.inventory_id,'LIVE_C2_RESOLVED_BY_C1',new.user_id,
        jsonb_build_object('count_record_id',new.id,'reason','C1_BASIS_REPLACED')
      );
    end loop;
    return new;
  end if;

  -- A later C1 observation can eliminate a provisional difference. Preserve
  -- the case and its mission audit, but remove it from the claimable queue.
  for v_case in
    select r.*
    from public.reconciliation_cases r
    where r.inventory_id=new.inventory_id
      and r.codigo=new.codigo
      and r.reference_type=v_master.control_type
      and coalesce(r.reference_value,'')=coalesce(v_reference_value,'')
      and r.source_fingerprint=v_fingerprint
      and r.status in ('PENDIENTE_ANALISIS','REQUIERE_2DO_CONTEO')
    for update
  loop
    update public.recount_missions
    set status='CANCELLED',updated_at=now()
    where case_id=v_case.id and round=2 and status='QUEUED';
    update public.reconciliation_cases
    set status='RESUELTO',
        disposition='SIN_AJUSTE',
        resolution_reason='RESOLVED_BY_C1: la evidencia C1 acumulada volvió a coincidir con la referencia de sistema.',
        resolved_by=new.user_id,
        resolved_at=now(),
        updated_at=now()
    where id=v_case.id;
    perform app_private.append_reconciliation_event(
      v_case.id,new.inventory_id,'LIVE_C2_RESOLVED_BY_C1',new.user_id,
      jsonb_build_object('count_record_id',new.id,'reason','C1_MATCHES_REFERENCE')
    );
  end loop;
  return new;
end
$function$;

revoke all on function app_private.reconcile_live_c1_identity() from public,anon,authenticated;

drop trigger if exists count_records_live_c1_reconciliation on public.count_records;
create trigger count_records_live_c1_reconciliation
after insert on public.count_records
for each row execute function app_private.reconcile_live_c1_identity();

-- C2/C3 availability is an inventory-open condition, not a C1 completion or
-- rolling-cut condition. The originator separation remains intact for C2.
create or replace function public.get_my_recount_queue(p_inventory_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=public,app_private,pg_temp
as $function$
declare v_actor uuid:=app_private.require_active_actor(); v_active uuid; v_round integer; v_queued integer:=0; v_c1_done boolean:=false;
begin
  if app_private.actor_has_capability(v_actor,'RECOUNT_C3',p_inventory_id) then v_round:=3;
  elsif app_private.actor_has_capability(v_actor,'RECOUNT_C2',p_inventory_id) then v_round:=2;
  else raise exception 'CAPABILITY_REQUIRED' using errcode='42501', detail='RECOUNT_C2_OR_RECOUNT_C3'; end if;
  if not exists(select 1 from public.inventories where id=p_inventory_id and status='ABIERTO') then
    return jsonb_build_object('inventory_id',p_inventory_id,'round',v_round,'c1_completed',false,'queued_count',0,'active',null);
  end if;
  select c1_completed_at is not null into v_c1_done from public.inventories where id=p_inventory_id;
  select id into v_active from public.recount_missions where inventory_id=p_inventory_id and assigned_user_id=v_actor and status='ACTIVE' order by claimed_at,id limit 1;
  select count(*)::integer into v_queued from public.recount_missions m
  where m.inventory_id=p_inventory_id and m.round=v_round and m.status='QUEUED'
    and (v_round<>3 or not exists(
      select 1 from public.recount_missions c2
      where c2.case_id=m.case_id and c2.round=2 and c2.assigned_user_id=v_actor
    )) -- CUT2_07_C3_ORIGINATOR
    and (v_round<>2 or not exists(
      select 1 from public.reconciliation_cases rc join public.count_records cr
        on cr.inventory_id=rc.inventory_id and cr.codigo=rc.codigo
       and ((rc.reference_type='SERIAL' and coalesce(cr.serie,'')=coalesce(rc.reference_value,''))
         or (rc.reference_type='PARTIDA' and coalesce(cr.partida,'')=coalesce(rc.reference_value,''))
         or rc.reference_type='LEGACY')
      where rc.id=m.case_id and cr.user_id=v_actor
        and not exists(select 1 from public.recount_mission_observations rmo where rmo.count_record_id=cr.id)
    ));
  return jsonb_build_object('inventory_id',p_inventory_id,'round',v_round,'c1_completed',coalesce(v_c1_done,false),'queued_count',v_queued,'active',case when v_active is null then null else app_private.recount_mission_json(v_active) end);
end
$function$;

create or replace function public.claim_next_recount_mission(p_inventory_id uuid)
returns jsonb language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare v_actor uuid:=app_private.require_active_actor(); v_round integer; v_mission public.recount_missions; v_existing uuid; v_transitioned integer:=0; v_max_reassignments integer;
begin
  perform app_private.lock_actor_authorization_context(v_actor,p_inventory_id); -- CUT2_07D_CLAIM_REVOCATION_LOCK
  if app_private.actor_has_capability(v_actor,'RECOUNT_C3',p_inventory_id) then v_round:=3;
  elsif app_private.actor_has_capability(v_actor,'RECOUNT_C2',p_inventory_id) then v_round:=2;
  else raise exception 'CAPABILITY_REQUIRED' using errcode='42501', detail='RECOUNT_C2_OR_RECOUNT_C3'; end if;
  if not exists(select 1 from public.inventories where id=p_inventory_id and status='ABIERTO') then return null; end if;
  select id into v_existing from public.recount_missions where inventory_id=p_inventory_id and assigned_user_id=v_actor and status='ACTIVE' order by claimed_at,id limit 1;
  if v_existing is not null then perform app_private.ensure_recount_mission_subtasks(v_existing); return app_private.recount_mission_json(v_existing); end if;
  select p.max_reassignments into v_max_reassignments from public.inventories i join public.recount_sla_policies p on p.warehouse_id=i.warehouse_id and p.active where i.id=p_inventory_id;
  select m.* into v_mission from public.recount_missions m
  where m.inventory_id=p_inventory_id and m.round=v_round and m.status='QUEUED'
    and (v_round<>3 or not exists(
      select 1 from public.recount_missions c2
      where c2.case_id=m.case_id and c2.round=2 and c2.assigned_user_id=v_actor
    )) -- CUT2_07_C3_ORIGINATOR
    and (v_round<>2 or (m.last_assigned_user_id is distinct from v_actor and m.reassignment_count<=coalesce(v_max_reassignments,0)))
    and (v_round<>2 or not exists(select 1 from public.reconciliation_cases rc join public.count_records cr
      on cr.inventory_id=rc.inventory_id and cr.codigo=rc.codigo
       and ((rc.reference_type='SERIAL' and coalesce(cr.serie,'')=coalesce(rc.reference_value,''))
         or (rc.reference_type='PARTIDA' and coalesce(cr.partida,'')=coalesce(rc.reference_value,''))
         or rc.reference_type='LEGACY')
      where rc.id=m.case_id and cr.user_id=v_actor
        and not exists(select 1 from public.recount_mission_observations rmo where rmo.count_record_id=cr.id)))
  order by case when v_round=2 and m.claim_due_at<=now() then 0 else 1 end,m.created_at,m.id for update skip locked limit 1;
  if v_mission.id is null then return null; end if;
  update public.recount_missions set assigned_user_id=v_actor,status='ACTIVE',claimed_at=now(),abandoned_at=null,abandoned_reason=null where id=v_mission.id;
  update public.reconciliation_cases set status=case when v_round=2 then '2DO_CONTEO_ASIGNADO'::public.reconciliation_status else '3ER_CONTEO_ASIGNADO'::public.reconciliation_status end where id=v_mission.case_id and status=case when v_round=2 then 'REQUIERE_2DO_CONTEO'::public.reconciliation_status else 'REQUIERE_3ER_CONTEO'::public.reconciliation_status end;
  get diagnostics v_transitioned=row_count;
  if v_transitioned<>1 then raise exception 'Recount case state changed before mission claim' using errcode='40001'; end if;
  perform app_private.ensure_recount_mission_subtasks(v_mission.id);
  perform app_private.append_reconciliation_event(v_mission.case_id,p_inventory_id,case when v_round=2 then 'SECOND_ASSIGNED' else 'THIRD_ASSIGNED' end,v_actor,jsonb_build_object('mission_id',v_mission.id,'round',v_round,'assignment_mode','QUEUE_CLAIM','live_reconciliation',true));
  return app_private.recount_mission_json(v_mission.id);
end
$function$;

revoke all on function public.get_my_recount_queue(uuid),public.claim_next_recount_mission(uuid) from public,anon;
grant execute on function public.get_my_recount_queue(uuid),public.claim_next_recount_mission(uuid) to authenticated;

-- Supervisors see the current reference revision while C1 is still running.
-- C1 finalization remains relevant to closure/audit, never to C2/C3 visibility.
create or replace function public.list_reconciliation_cases(p_inventory_id uuid)
returns setof public.reconciliation_cases
language plpgsql stable security definer
set search_path=public,app_private,pg_temp
as $function$
declare v_fingerprint text;
begin
  perform app_private.require_active_actor();
  if not app_private.can_manage_inventory(p_inventory_id) then
    raise exception 'Not authorized for reconciliation' using errcode='42501';
  end if;
  select fingerprint into v_fingerprint
  from public.inventory_system_reference_metadata where inventory_id=p_inventory_id;
  return query
  select r.* from public.reconciliation_cases r
  where r.inventory_id=p_inventory_id
    and v_fingerprint is not null
    and r.source_fingerprint=v_fingerprint
  order by r.created_at desc,r.id;
end
$function$;

create or replace function public.get_reconciliation_summary(p_inventory_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=public,app_private,pg_temp
as $function$
declare v_fingerprint text; v_metadata jsonb;
begin
  perform app_private.require_active_actor();
  if not app_private.can_manage_inventory(p_inventory_id) then
    raise exception 'Not authorized for reconciliation summary' using errcode='42501';
  end if;
  if not exists(select 1 from public.inventories where id=p_inventory_id) then
    raise exception 'Inventory not found' using errcode='P0002';
  end if;
  select m.fingerprint,jsonb_build_object(
    'reference_version',m.reference_version,'row_count',m.row_count,
    'fingerprint',m.fingerprint,'source',m.source,
    'import_identifier',m.import_identifier,'imported_at',m.imported_at
  ) into v_fingerprint,v_metadata
  from public.inventory_system_reference_metadata m where m.inventory_id=p_inventory_id;
  return (
    with visible as (
      select r.* from public.reconciliation_cases r
      where r.inventory_id=p_inventory_id and v_fingerprint is not null and r.source_fingerprint=v_fingerprint
    ), totals as (
      select count(*)::integer total,
        count(*) filter(where status<>'RESUELTO')::integer open,
        count(*) filter(where status='PENDIENTE_ANALISIS')::integer pending_analysis,
        count(*) filter(where status in('REQUIERE_2DO_CONTEO','2DO_CONTEO_ASIGNADO'))::integer second_recount,
        count(*) filter(where status in('REQUIERE_3ER_CONTEO','3ER_CONTEO_ASIGNADO'))::integer third_recount,
        count(*) filter(where status='FISICO_CONFIRMADO')::integer physical_confirmed,
        count(*) filter(where status='RESUELTO')::integer resolved
      from visible
    ) select jsonb_build_object(
      'inventory_id',p_inventory_id,'source_reference',v_metadata,
      'summary',jsonb_build_object(
        'total',t.total,'open',t.open,'pending_analysis',t.pending_analysis,
        'second_recount',t.second_recount,'third_recount',t.third_recount,
        'physical_confirmed',t.physical_confirmed,'resolved',t.resolved
      ),
      'anomalies',coalesce((select jsonb_object_agg(x.anomaly_type,x.total order by x.anomaly_type)
        from (select v.anomaly_type,count(*)::integer total from visible v group by v.anomaly_type) x),'{}'::jsonb),
      'live_reconciliation',true
    ) from totals t
  );
end
$function$;

create or replace function public.get_c2_execution_metrics(p_inventory_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=public,app_private,pg_temp
as $function$
begin
  perform app_private.require_inventory_capability(p_inventory_id,'VIEW_MONITOR');
  return (
    select jsonb_build_object(
      'queued_missions',count(distinct m.id) filter(where m.round=2 and m.status='QUEUED'),
      'claimed_missions',count(distinct m.id) filter(where m.round=2 and m.status='ACTIVE' and m.started_at is null),
      'active_missions',count(distinct m.id) filter(where m.round=2 and m.status='ACTIVE' and m.started_at is not null),
      'auto_resolved_by_c1',count(distinct r.id) filter(where r.status='RESUELTO' and r.resolution_reason like 'RESOLVED_BY_C1:%'),
      'c3_queued',count(distinct m.id) filter(where m.round=3 and m.status='QUEUED'),
      'confirmed_physical_differences',count(distinct r.id) filter(where r.status='FISICO_CONFIRMADO'),
      'overdue_operational',count(distinct m.id) filter(where m.round=2 and m.status in ('QUEUED','ACTIVE') and (m.overdue_at is not null or (m.status='QUEUED' and m.claim_due_at<=now()) or (m.status='ACTIVE' and m.c2_due_at<=now()))),
      'pending_subtasks',count(s.id) filter(where s.status='PENDING'),
      'completed_subtasks',count(s.id) filter(where s.status in('COUNTED','ZERO_CONFIRMED')),
      'serial_sweeps_active',count(s.id) filter(where s.strategy='SERIAL_SWEEP' and s.status='ACTIVE'),
      'targeted_searches',count(s.id) filter(where s.strategy='TARGETED_SERIAL_SEARCH'),
      'blocked',count(s.id) filter(where s.status='INACCESSIBLE'),
      'escalated',count(s.id) filter(where s.status='ESCALATED')
    )
    from public.recount_missions m
    left join public.reconciliation_cases r on r.id=m.case_id
    left join public.recount_mission_subtasks s on s.mission_id=m.id
    where m.inventory_id=p_inventory_id
  );
end
$function$;

revoke all on function public.list_reconciliation_cases(uuid),public.get_reconciliation_summary(uuid),public.get_c2_execution_metrics(uuid) from public,anon;
grant execute on function public.list_reconciliation_cases(uuid),public.get_reconciliation_summary(uuid),public.get_c2_execution_metrics(uuid) to authenticated;
