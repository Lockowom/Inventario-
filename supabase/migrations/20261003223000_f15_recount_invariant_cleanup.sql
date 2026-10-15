-- F15 mission invariants after legacy cleanup.

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
  transitioned integer:=0;
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
  get diagnostics transitioned=row_count;

  if transitioned<>1 then
    raise exception 'Recount case state changed before mission claim' using errcode='40001';
  end if;

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

  if r.reference_type<>'SERIAL' and exists(
    select 1
    from public.recount_mission_observations o
    join public.count_records previous on previous.id=o.count_record_id
    where o.mission_id=mission.id
      and previous.ubicacion=c.ubicacion
  ) then
    raise exception 'Location already recorded for recount mission' using errcode='23505';
  end if;

  insert into public.recount_mission_observations(mission_id,count_record_id)
  values(mission.id,c.id);

  return app_private.recount_mission_json(mission.id);
end
$function$;

revoke all on function public.claim_next_recount_mission(uuid),
  public.add_my_recount_observation(uuid,uuid)
from public,anon;

grant execute on function public.claim_next_recount_mission(uuid),
  public.add_my_recount_observation(uuid,uuid)
to authenticated;
