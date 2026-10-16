-- CUT2-07C: emit C3 creation exactly once regardless of whether it originates
-- from the legacy C2 completion insert, the binding fallback, or a retry.
create or replace function app_private.append_reconciliation_event(
  p_case_id uuid,p_inventory_id uuid,p_event_type text,p_actor uuid,p_payload jsonb default '{}'::jsonb
)
returns void language plpgsql security definer
set search_path=public,app_private,pg_temp as $function$
begin
  if p_event_type not in (
    'SECOND_ASSIGNED','SECOND_RECORDED','THIRD_ASSIGNED','THIRD_RECORDED',
    'C2_SUBTASK_RECORDED','C3_CREATED','RESOLVED'
  ) then
    raise exception 'Invalid reconciliation event' using errcode='23514';
  end if;
  insert into public.reconciliation_events(case_id,inventory_id,event_type,actor_user_id,payload)
  values(p_case_id,p_inventory_id,p_event_type,p_actor,coalesce(p_payload,'{}'::jsonb));
end $function$;
revoke all on function app_private.append_reconciliation_event(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;

alter table public.reconciliation_events
  drop constraint if exists reconciliation_events_event_type_check;
alter table public.reconciliation_events
  add constraint reconciliation_events_event_type_check check (event_type in (
    'SECOND_ASSIGNED','SECOND_RECORDED','THIRD_ASSIGNED','THIRD_RECORDED',
    'C2_SUBTASK_RECORDED','C3_CREATED','RESOLVED'
  ));

create or replace function app_private.bind_c3_to_completed_c2()
returns trigger language plpgsql security definer
set search_path=public,app_private,pg_temp as $function$
begin
  if new.round<>2 or new.status<>'COMPLETED' or old.status='COMPLETED' then return new; end if;
  if not exists(select 1 from public.reconciliation_cases c where c.id=new.case_id and c.status='REQUIERE_3ER_CONTEO') then return new; end if;
  insert into public.recount_missions(case_id,inventory_id,round,created_by,source_cut_id,source_sealed_reference_id,source_c2_mission_id)
  values(new.case_id,new.inventory_id,3,new.assigned_user_id,new.source_cut_id,new.source_sealed_reference_id,new.id)
  on conflict(case_id,round) do update
    set source_c2_mission_id=excluded.source_c2_mission_id,
        source_cut_id=coalesce(public.recount_missions.source_cut_id,excluded.source_cut_id),
        source_sealed_reference_id=coalesce(public.recount_missions.source_sealed_reference_id,excluded.source_sealed_reference_id);
  return new;
end $function$;
revoke all on function app_private.bind_c3_to_completed_c2() from public,anon,authenticated;

create or replace function app_private.audit_c3_created_once()
returns trigger language plpgsql security definer
set search_path=public,app_private,pg_temp as $function$
begin
  if new.round<>3 then return new; end if;
  if new.source_c2_mission_id is null then
    raise exception 'C3_SOURCE_C2_REQUIRED' using errcode='23514';
  end if;
  if not exists(
    select 1 from public.reconciliation_events e
    where e.case_id=new.case_id and e.event_type='C3_CREATED'
      and e.payload->>'c3_mission_id'=new.id::text
  ) then
    perform app_private.append_reconciliation_event(new.case_id,new.inventory_id,'C3_CREATED',new.created_by,
      jsonb_build_object('c3_mission_id',new.id,'source_c2_mission_id',new.source_c2_mission_id,
        'source_cut_id',new.source_cut_id,'sealed_reference_id',new.source_sealed_reference_id));
  end if;
  return new;
end $function$;
revoke all on function app_private.audit_c3_created_once() from public,anon,authenticated;
drop trigger if exists recount_missions_audit_c3_created_once on public.recount_missions;
create trigger recount_missions_audit_c3_created_once
after insert on public.recount_missions
for each row execute function app_private.audit_c3_created_once();

-- The existing Monitor remains the only dashboard.  Its protected projection
-- now exposes provenance identifiers and C3 evidence state to VIEW_MONITOR
-- actors; it never becomes part of the counter capture payload.
drop function if exists public.get_live_monitor_missions(uuid,integer);
create function public.get_live_monitor_missions(
  p_inventory_id uuid,
  p_limit integer default 100
)
returns table(
  id uuid, round smallint, status text, created_at timestamptz, claimed_at timestamptz, completed_at timestamptz,
  codigo text, descripcion text, reference_type public.master_control_type, reference_value text,
  assigned_display_name text, observation_count integer, total_quantity integer, case_status text,
  source_c2_mission_id uuid, source_cut_id uuid, sealed_reference_id uuid, c3_result text
)
language plpgsql stable security definer
set search_path=public,app_private,pg_temp as $function$
begin
  perform app_private.require_inventory_capability(p_inventory_id,'VIEW_MONITOR');
  if p_limit<1 or p_limit>200 then raise exception 'Live monitor limit must be between 1 and 200' using errcode='22023'; end if;
  return query
  select m.id,m.round,m.status::text,m.created_at,m.claimed_at,m.completed_at,
    r.codigo,coalesce(mi.descripcion,'Sin descripción'),r.reference_type,r.reference_value,
    p.display_name,count(o.id)::integer,m.total_quantity,r.status::text,
    m.source_c2_mission_id,m.source_cut_id,m.source_sealed_reference_id,m.c3_result
  from public.recount_missions m
  join public.reconciliation_cases r on r.id=m.case_id
  left join public.inventory_master_items mi on mi.inventory_id=m.inventory_id and mi.codigo=r.codigo
  left join public.profiles p on p.user_id=m.assigned_user_id
  left join public.recount_mission_observations o on o.mission_id=m.id
  where m.inventory_id=p_inventory_id
  group by m.id,r.codigo,mi.descripcion,r.reference_type,r.reference_value,p.display_name,r.status
  order by case m.status when 'ACTIVE' then 0 when 'QUEUED' then 1 when 'COMPLETED' then 2 else 3 end,m.created_at desc,m.id desc
  limit p_limit;
end $function$;
revoke all on function public.get_live_monitor_missions(uuid,integer) from public,anon;
grant execute on function public.get_live_monitor_missions(uuid,integer) to authenticated;
