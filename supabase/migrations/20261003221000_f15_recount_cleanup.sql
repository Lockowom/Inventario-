-- F15 cleanup: mission queue is the only C2/C3 execution model.
-- Remove F11 single-record assignment APIs/columns and keep one reconciliation
-- event ledger. Historical migrations remain immutable; this migration removes
-- their runtime surface.

create or replace function public.claim_next_recount_mission(p_inventory_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  actor uuid:=app_private.require_active_actor();
  actor_role public.app_role;
  wanted_round integer;
  mission public.recount_missions;
  existing_id uuid;
begin
  if not app_private.can_access_inventory(p_inventory_id) then
    raise exception 'Not authorized for inventory' using errcode='42501';
  end if;

  select role into actor_role
  from public.profiles
  where user_id=actor and active;

  wanted_round:=case
    when actor_role='CONTADOR' then 2
    when actor_role in ('ANALISTA','ADMIN') then 3
    else null
  end;

  if wanted_round is null then
    raise exception 'Role does not admit recount missions' using errcode='42501';
  end if;

  select id into existing_id
  from public.recount_missions
  where inventory_id=p_inventory_id
    and assigned_user_id=actor
    and status='ACTIVE'
  order by claimed_at,id
  limit 1;

  if existing_id is not null then
    return app_private.recount_mission_json(existing_id);
  end if;

  select m.* into mission
  from public.recount_missions m
  where m.inventory_id=p_inventory_id
    and m.round=wanted_round
    and m.status='QUEUED'
    and (
      wanted_round<>2
      or not exists(
        select 1
        from public.reconciliation_cases r
        join public.count_records c
          on c.inventory_id=r.inventory_id
         and c.codigo=r.codigo
         and (
           (r.reference_type='SERIAL' and coalesce(c.serie,'')=coalesce(r.reference_value,''))
           or (r.reference_type='PARTIDA' and coalesce(c.partida,'')=coalesce(r.reference_value,''))
           or r.reference_type='LEGACY'
         )
        where r.id=m.case_id
          and c.user_id=actor
          and not exists(
            select 1
            from public.recount_mission_observations o
            where o.count_record_id=c.id
          )
      )
    )
  order by m.created_at,m.id
  for update skip locked
  limit 1;

  if mission.id is null then
    return null;
  end if;

  update public.recount_missions
  set assigned_user_id=actor,status='ACTIVE',claimed_at=now()
  where id=mission.id;

  update public.reconciliation_cases
  set status=case
    when wanted_round=2 then '2DO_CONTEO_ASIGNADO'::public.reconciliation_status
    else '3ER_CONTEO_ASIGNADO'::public.reconciliation_status
  end
  where id=mission.case_id
    and status=case
      when wanted_round=2 then 'REQUIERE_2DO_CONTEO'::public.reconciliation_status
      else 'REQUIERE_3ER_CONTEO'::public.reconciliation_status
    end;

  perform app_private.append_reconciliation_event(
    mission.case_id,
    p_inventory_id,
    case when wanted_round=2 then 'SECOND_ASSIGNED' else 'THIRD_ASSIGNED' end,
    actor,
    jsonb_build_object(
      'mission_id',mission.id,
      'assigned_user_id',actor,
      'round',wanted_round,
      'assignment_mode','QUEUE_CLAIM'
    )
  );

  return app_private.recount_mission_json(mission.id);
end
$function$;

create or replace function public.add_my_recount_observation(p_mission_id uuid,p_client_count_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  actor uuid:=app_private.require_active_actor();
  mission public.recount_missions;
  r public.reconciliation_cases;
  c public.count_records;
begin
  select * into mission
  from public.recount_missions
  where id=p_mission_id
  for update;

  if mission.id is null or mission.status<>'ACTIVE' or mission.assigned_user_id<>actor then
    raise exception 'Active recount mission is not assigned to actor' using errcode='42501';
  end if;

  select * into r
  from public.reconciliation_cases
  where id=mission.case_id;

  select * into c
  from public.count_records
  where inventory_id=mission.inventory_id
    and user_id=actor
    and client_count_id=p_client_count_id;

  if c.id is null or c.codigo<>r.codigo then
    raise exception 'Confirmed recount observation not found' using errcode='23514';
  end if;

  if r.reference_type='SERIAL' and coalesce(c.serie,'')<>coalesce(r.reference_value,'') then
    raise exception 'Serial does not match recount mission' using errcode='23514';
  end if;

  if r.reference_type='PARTIDA' and coalesce(c.partida,'')<>coalesce(r.reference_value,'') then
    raise exception 'Batch does not match recount mission' using errcode='23514';
  end if;

  if exists(
    select 1
    from public.recount_mission_observations
    where count_record_id=c.id
  ) then
    raise exception 'Count record already belongs to a recount mission' using errcode='23505';
  end if;

  insert into public.recount_mission_observations(mission_id,count_record_id)
  values(mission.id,c.id);

  return app_private.recount_mission_json(mission.id);
end
$function$;

create or replace function public.complete_my_recount_mission(p_mission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  actor uuid:=app_private.require_active_actor();
  mission public.recount_missions;
  r public.reconciliation_cases;
  total integer;
  observations integer;
  result_status public.reconciliation_status;
begin
  select * into mission
  from public.recount_missions
  where id=p_mission_id
  for update;

  if mission.id is null or mission.status<>'ACTIVE' or mission.assigned_user_id<>actor then
    raise exception 'Active recount mission is not assigned to actor' using errcode='42501';
  end if;

  select * into r
  from public.reconciliation_cases
  where id=mission.case_id
  for update;

  select count(*)::integer,coalesce(sum(c.cantidad_contada),0)::integer
  into observations,total
  from public.recount_mission_observations o
  join public.count_records c on c.id=o.count_record_id
  where o.mission_id=mission.id;

  if observations=0 then
    raise exception 'Recount mission requires at least one physical observation' using errcode='23514';
  end if;

  update public.recount_missions
  set status='COMPLETED',total_quantity=total,completed_at=now()
  where id=mission.id;

  if mission.round=2 then
    if total=r.physical_quantity then
      result_status:='FISICO_CONFIRMADO';
      update public.reconciliation_cases
      set status=result_status,confirmed_physical_quantity=total
      where id=r.id;
    else
      result_status:='REQUIERE_3ER_CONTEO';
      update public.reconciliation_cases
      set status=result_status,confirmed_physical_quantity=null
      where id=r.id;

      insert into public.recount_missions(case_id,inventory_id,round,created_by)
      values(r.id,r.inventory_id,3,actor)
      on conflict(case_id,round) do nothing;
    end if;
  else
    result_status:='FISICO_CONFIRMADO';
    update public.reconciliation_cases
    set status=result_status,confirmed_physical_quantity=total
    where id=r.id;
  end if;

  perform app_private.append_reconciliation_event(
    r.id,
    r.inventory_id,
    case when mission.round=2 then 'SECOND_RECORDED' else 'THIRD_RECORDED' end,
    actor,
    jsonb_build_object(
      'mission_id',mission.id,
      'round',mission.round,
      'observation_count',observations,
      'total_quantity',total,
      'result_status',result_status,
      'confirmed_physical_quantity',case when result_status='FISICO_CONFIRMADO' then total else null end
    )
  );

  return jsonb_build_object(
    'mission_id',mission.id,
    'round',mission.round,
    'total_quantity',total,
    'observation_count',observations,
    'case_id',r.id,
    'case_status',result_status,
    'confirmed_physical_quantity',case when result_status='FISICO_CONFIRMADO' then total else null end,
    'next_round',case when mission.round=2 and result_status='REQUIERE_3ER_CONTEO' then 3 else null end
  );
end
$function$;

create or replace function public.list_reconciliation_events(p_case_id uuid)
returns table(
 id uuid,
 case_id uuid,
 event_type text,
 actor_user_id uuid,
 actor_display_name text,
 target_display_name text,
 payload jsonb,
 created_at timestamptz
)
language plpgsql
stable security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  v_inventory_id uuid;
begin
  perform app_private.require_active_actor();

  select inventory_id into v_inventory_id
  from public.reconciliation_cases
  where reconciliation_cases.id=p_case_id;

  if v_inventory_id is null then
    raise exception 'Reconciliation case not found' using errcode='P0002';
  end if;

  if not app_private.can_manage_inventory(v_inventory_id) then
    raise exception 'Not authorized for reconciliation timeline' using errcode='42501';
  end if;

  return query
  select
    e.id,
    e.case_id,
    e.event_type,
    e.actor_user_id,
    actor_profile.display_name,
    case
      when e.event_type in ('SECOND_ASSIGNED','THIRD_ASSIGNED')
        then (
          select p.display_name
          from public.profiles p
          where p.user_id=coalesce(
            nullif(e.payload->>'assigned_user_id','')::uuid,
            nullif(e.payload->>'assigned_analyst_id','')::uuid
          )
        )
      else null
    end,
    e.payload,
    e.created_at
  from public.reconciliation_events e
  join public.profiles actor_profile on actor_profile.user_id=e.actor_user_id
  where e.case_id=p_case_id
  order by e.created_at,e.id;
end
$function$;

drop function if exists public.get_my_recount_assignments(uuid);
drop function if exists public.record_my_recount(uuid,uuid);
drop function if exists public.assign_second_recount(uuid,uuid);
drop function if exists public.record_second_recount(uuid,uuid);
drop function if exists public.assign_third_recount(uuid,uuid);
drop function if exists public.record_third_recount(uuid,uuid);
drop function if exists public.list_recount_candidates(uuid,integer);

alter table public.reconciliation_cases
  drop column if exists second_count_record_id,
  drop column if exists third_count_record_id,
  drop column if exists assigned_second_user_id,
  drop column if exists assigned_third_analyst_id;

revoke all on function public.claim_next_recount_mission(uuid),
  public.add_my_recount_observation(uuid,uuid),
  public.complete_my_recount_mission(uuid),
  public.list_reconciliation_events(uuid)
from public,anon;

grant execute on function public.claim_next_recount_mission(uuid),
  public.add_my_recount_observation(uuid,uuid),
  public.complete_my_recount_mission(uuid),
  public.list_reconciliation_events(uuid)
to authenticated;
