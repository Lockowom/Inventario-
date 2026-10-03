-- F16 · C1 coverage close and final reconciliation.
-- C1 remains free multi-location counting. Persistent C2/C3 work is created only
-- after the manager explicitly closes C1 and confirms all devices were synchronized.

alter table public.inventories
  add column if not exists c1_completed_at timestamptz,
  add column if not exists c1_completed_by uuid references public.profiles(user_id) on delete restrict,
  add column if not exists c1_count_records integer,
  add column if not exists c1_counted_units bigint,
  add column if not exists c1_master_fingerprint text,
  add column if not exists c1_reference_fingerprint text;

alter table public.inventories
  drop constraint if exists inventories_c1_completion_check;
alter table public.inventories
  add constraint inventories_c1_completion_check check (
    (
      c1_completed_at is null
      and c1_completed_by is null
      and c1_count_records is null
      and c1_counted_units is null
      and c1_master_fingerprint is null
      and c1_reference_fingerprint is null
    )
    or
    (
      c1_completed_at is not null
      and c1_completed_by is not null
      and c1_count_records is not null
      and c1_count_records >= 0
      and c1_counted_units is not null
      and c1_counted_units >= 0
      and c1_master_fingerprint is not null
      and c1_reference_fingerprint is not null
    )
  );

-- F15 may have queued provisional C2 work created before this coverage gate existed.
-- Preserve the case history but cancel queued execution until C1 is explicitly finalized.
update public.recount_missions m
set status='CANCELLED',
    updated_at=now()
from public.inventories i
where i.id=m.inventory_id
  and i.c1_completed_at is null
  and m.status='QUEUED';

create or replace function public.get_my_recount_queue(p_inventory_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  actor uuid:=app_private.require_active_actor();
  actor_role public.app_role;
  active_id uuid;
  queue_round integer;
  queued integer:=0;
  c1_done boolean:=false;
begin
  if not app_private.can_access_inventory(p_inventory_id) then
    raise exception 'Not authorized for inventory' using errcode='42501';
  end if;

  select role into actor_role
  from public.profiles
  where user_id=actor and active;

  queue_round:=case
    when actor_role='CONTADOR' then 2
    when actor_role in('ANALISTA','ADMIN') then 3
    else null
  end;

  select c1_completed_at is not null
  into c1_done
  from public.inventories
  where id=p_inventory_id;

  select m.id into active_id
  from public.recount_missions m
  where m.inventory_id=p_inventory_id
    and m.assigned_user_id=actor
    and m.status='ACTIVE'
  order by m.claimed_at,m.id
  limit 1;

  if coalesce(c1_done,false) and queue_round is not null then
    select count(*)::integer into queued
    from public.recount_missions m
    where m.inventory_id=p_inventory_id
      and m.round=queue_round
      and m.status='QUEUED'
      and (
        queue_round<>2
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
      );
  end if;

  return jsonb_build_object(
    'inventory_id',p_inventory_id,
    'round',queue_round,
    'queued_count',queued,
    'active',case when active_id is null then null else app_private.recount_mission_json(active_id) end
  );
end
$function$;

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
    when actor_role in('ANALISTA','ADMIN') then 3
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

  if not exists(
    select 1
    from public.inventories
    where id=p_inventory_id
      and status='ABIERTO'
      and c1_completed_at is not null
  ) then
    return null;
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

create or replace function public.list_reconciliation_cases(p_inventory_id uuid)
returns setof public.reconciliation_cases
language plpgsql
stable
security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  fp text;
  c1_done boolean:=false;
begin
  perform app_private.require_active_actor();

  if not app_private.can_manage_inventory(p_inventory_id) then
    raise exception 'Not authorized for reconciliation' using errcode='42501';
  end if;

  select i.c1_completed_at is not null,m.fingerprint
  into c1_done,fp
  from public.inventories i
  left join public.inventory_system_reference_metadata m on m.inventory_id=i.id
  where i.id=p_inventory_id;

  if not coalesce(c1_done,false) then
    return;
  end if;

  return query
  select r.*
  from public.reconciliation_cases r
  where r.inventory_id=p_inventory_id
    and fp is not null
    and r.source_fingerprint=fp
  order by r.created_at desc,r.id;
end
$function$;

create or replace function public.get_reconciliation_summary(p_inventory_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  fp text;
  metadata jsonb;
  result jsonb;
  c1_done boolean:=false;
begin
  perform app_private.require_active_actor();

  if not app_private.can_manage_inventory(p_inventory_id) then
    raise exception 'Not authorized for reconciliation summary' using errcode='42501';
  end if;

  if not exists(select 1 from public.inventories where id=p_inventory_id) then
    raise exception 'Inventory not found' using errcode='P0002';
  end if;

  select c1_completed_at is not null
  into c1_done
  from public.inventories
  where id=p_inventory_id;

  select m.fingerprint,
         jsonb_build_object(
           'reference_version',m.reference_version,
           'row_count',m.row_count,
           'fingerprint',m.fingerprint,
           'source',m.source,
           'import_identifier',m.import_identifier,
           'imported_at',m.imported_at
         )
  into fp,metadata
  from public.inventory_system_reference_metadata m
  where m.inventory_id=p_inventory_id;

  with visible as (
    select r.*
    from public.reconciliation_cases r
    where r.inventory_id=p_inventory_id
      and coalesce(c1_done,false)
      and fp is not null
      and r.source_fingerprint=fp
  ), totals as (
    select
      count(*)::integer total,
      count(*) filter(where status<>'RESUELTO')::integer open,
      count(*) filter(where status='PENDIENTE_ANALISIS')::integer pending_analysis,
      count(*) filter(where status in('REQUIERE_2DO_CONTEO','2DO_CONTEO_ASIGNADO'))::integer second_recount,
      count(*) filter(where status in('REQUIERE_3ER_CONTEO','3ER_CONTEO_ASIGNADO'))::integer third_recount,
      count(*) filter(where status='FISICO_CONFIRMADO')::integer physical_confirmed,
      count(*) filter(where status='RESUELTO')::integer resolved
    from visible
  )
  select jsonb_build_object(
    'inventory_id',p_inventory_id,
    'source_reference',metadata,
    'summary',jsonb_build_object(
      'total',t.total,
      'open',t.open,
      'pending_analysis',t.pending_analysis,
      'second_recount',t.second_recount,
      'third_recount',t.third_recount,
      'physical_confirmed',t.physical_confirmed,
      'resolved',t.resolved
    ),
    'anomalies',coalesce((
      select jsonb_object_agg(x.anomaly_type,x.total order by x.anomaly_type)
      from (
        select v.anomaly_type,count(*)::integer total
        from visible v
        group by v.anomaly_type
      ) x
    ),'{}'::jsonb),
    'last_materialized_at',(
      select max(a.created_at)
      from public.audit_events a
      where a.inventory_id=p_inventory_id
        and a.entity_type='reconciliation_materialization'
    )
  )
  into result
  from totals t;

  return result;
end
$function$;

create or replace function app_private.final_reconciliation_candidates(p_inventory_id uuid)
returns table(
  codigo text,
  reference_type public.master_control_type,
  reference_value text,
  system_quantity integer,
  physical_quantity integer,
  anomaly_type text,
  first_count_record_id uuid
)
language sql
stable
security definer
set search_path=public,app_private,pg_temp
as $function$
  with physical_base as (
    select
      c.*,
      m.control_type,
      case
        when m.control_type='SERIAL' then c.serie
        when m.control_type='PARTIDA' then c.partida
        else null
      end as physical_reference_value
    from public.count_records c
    join public.inventory_master_items m
      on m.inventory_id=c.inventory_id
     and m.codigo=c.codigo
    where c.inventory_id=p_inventory_id
      and not exists(
        select 1
        from public.recount_mission_observations o
        where o.count_record_id=c.id
      )
  ),
  physical as (
    select
      codigo,
      control_type,
      physical_reference_value as reference_value,
      sum(cantidad_contada)::integer as quantity,
      count(*)::integer as observation_count,
      (array_agg(id order by received_at,captured_at,created_at,id))[1] as first_count_record_id
    from physical_base
    group by codigo,control_type,physical_reference_value
  ),
  system_rows as (
    select *
    from public.inventory_system_reference_items
    where inventory_id=p_inventory_id
      and not (
        reference_type='PARTIDA'
        and reference_value like 'EXC-SIN-PARTIDA:%'
      )
  ),
  joined as (
    select
      s.id as system_item_id,
      coalesce(s.codigo,p.codigo) as codigo,
      coalesce(s.reference_type,p.control_type) as reference_type,
      coalesce(s.reference_value,p.reference_value) as reference_value,
      coalesce(s.quantity,0)::integer as system_quantity,
      coalesce(s.source_total_quantity,s.quantity,0)::integer as source_total_quantity,
      coalesce(p.quantity,0)::integer as physical_quantity,
      coalesce(p.observation_count,0)::integer as physical_observation_count,
      p.first_count_record_id
    from system_rows s
    full join physical p
      on p.codigo=s.codigo
     and p.control_type=s.reference_type
     and coalesce(p.reference_value,'')=coalesce(s.reference_value,'')
  ),
  classified as (
    select
      j.*,
      case
        when reference_type='SERIAL' and physical_observation_count>1 then 'DUPLICADO_SERIE'
        when reference_type='SERIAL' and system_item_id is null and physical_quantity>0 then 'SERIE_FISICA_NO_EN_SISTEMA'
        when reference_type='SERIAL' and system_item_id is not null and system_quantity=0 and physical_quantity>0 then 'SERIE_FUERA_DE_DISPONIBLE'
        when reference_type='SERIAL' and system_item_id is not null and system_quantity>0 and physical_quantity=0 then 'SERIE_SISTEMA_NO_CONTADA'

        when reference_type='PARTIDA' and system_item_id is null and physical_quantity>0 then 'PARTIDA_FISICA_NO_EN_SISTEMA'
        when reference_type='PARTIDA' and system_item_id is not null and system_quantity=0 and physical_quantity>0 then 'PARTIDA_FUERA_DE_DISPONIBLE'
        when reference_type='PARTIDA' and system_item_id is not null and system_quantity>0 and physical_quantity=0 then 'PARTIDA_SISTEMA_NO_CONTADA'
        when reference_type='PARTIDA' and system_item_id is not null and system_quantity<>physical_quantity then 'DIFERENCIA_CANTIDAD_PARTIDA'

        when reference_type='LEGACY' and system_quantity<>physical_quantity then 'DIFERENCIA_CANTIDAD_SKU'
        else null
      end as anomaly_type
    from joined j
  )
  select
    codigo,
    reference_type,
    reference_value,
    system_quantity,
    physical_quantity,
    anomaly_type,
    first_count_record_id
  from classified
  where anomaly_type is not null
$function$;

revoke all on function app_private.final_reconciliation_candidates(uuid) from public,anon,authenticated;

create or replace function public.get_inventory_lifecycle(p_inventory_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  actor uuid:=app_private.require_active_actor();
  inv public.inventories;
  fp text;
  open_cases integer:=0;
  queued_missions integer:=0;
  active_missions integer:=0;
  resolved_cases integer:=0;
begin
  if not app_private.can_access_inventory(p_inventory_id) then
    raise exception 'Not authorized for inventory' using errcode='42501';
  end if;

  select * into inv
  from public.inventories
  where id=p_inventory_id;

  if inv.id is null then
    raise exception 'Inventory not found' using errcode='P0002';
  end if;

  select fingerprint into fp
  from public.inventory_system_reference_metadata
  where inventory_id=p_inventory_id;

  select
    count(*) filter(where status<>'RESUELTO')::integer,
    count(*) filter(where status='RESUELTO')::integer
  into open_cases,resolved_cases
  from public.reconciliation_cases
  where inventory_id=p_inventory_id
    and (fp is null or source_fingerprint=fp);

  select
    count(*) filter(where status='QUEUED')::integer,
    count(*) filter(where status='ACTIVE')::integer
  into queued_missions,active_missions
  from public.recount_missions
  where inventory_id=p_inventory_id;

  return jsonb_build_object(
    'inventory_id',inv.id,
    'name',inv.name,
    'inventory_status',inv.status,
    'c1_status',case when inv.c1_completed_at is null then 'EN_CURSO' else 'COMPLETADO' end,
    'c1_completed_at',inv.c1_completed_at,
    'c1_completed_by',inv.c1_completed_by,
    'c1_count_records',inv.c1_count_records,
    'c1_counted_units',inv.c1_counted_units,
    'c1_master_fingerprint',inv.c1_master_fingerprint,
    'c1_reference_fingerprint',inv.c1_reference_fingerprint,
    'open_cases',coalesce(open_cases,0),
    'resolved_cases',coalesce(resolved_cases,0),
    'queued_missions',coalesce(queued_missions,0),
    'active_missions',coalesce(active_missions,0),
    'can_finalize_c1',inv.status='ABIERTO' and inv.c1_completed_at is null and app_private.can_manage_inventory(p_inventory_id),
    'can_close_inventory',inv.status='ABIERTO'
      and inv.c1_completed_at is not null
      and coalesce(open_cases,0)=0
      and coalesce(queued_missions,0)=0
      and coalesce(active_missions,0)=0
      and app_private.can_manage_inventory(p_inventory_id)
  );
end
$function$;

create or replace function public.finalize_c1_coverage(
  p_inventory_id uuid,
  p_confirm_devices_synced boolean
)
returns jsonb
language plpgsql
security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  actor uuid:=app_private.require_active_actor();
  inv public.inventories;
  master_fp text;
  reference_fp text;
  total_records integer:=0;
  total_units bigint:=0;
  candidate_count integer:=0;
begin
  if not app_private.can_manage_inventory(p_inventory_id) then
    raise exception 'Not authorized to finalize C1' using errcode='42501';
  end if;
  if not coalesce(p_confirm_devices_synced,false) then
    raise exception 'Confirm that every counting device has synchronized before finalizing C1' using errcode='23514';
  end if;

  if exists(
    select 1
    from public.inventory_freeze_guards g
    where g.inventory_id=p_inventory_id
      and g.resolved_at is null
      and g.pending_count>0
  ) then
    raise exception 'Inventory has known pending synchronization records' using errcode='23514';
  end if;

  select * into inv
  from public.inventories
  where id=p_inventory_id
  for update;

  if inv.id is null then
    raise exception 'Inventory not found' using errcode='P0002';
  end if;
  if inv.status<>'ABIERTO' then
    raise exception 'C1 can only be finalized while inventory is ABIERTO' using errcode='23514';
  end if;
  if inv.c1_completed_at is not null then
    return public.get_inventory_lifecycle(p_inventory_id);
  end if;

  if exists(
    select 1
    from public.recount_missions
    where inventory_id=p_inventory_id
      and status in('ACTIVE','COMPLETED')
  ) then
    raise exception 'C1 cannot be finalized after recount execution has started' using errcode='23514';
  end if;

  select fingerprint into master_fp
  from public.inventory_master_metadata
  where inventory_id=p_inventory_id;

  select fingerprint into reference_fp
  from public.inventory_system_reference_metadata
  where inventory_id=p_inventory_id;

  if master_fp is null or reference_fp is null then
    raise exception 'Confirmed Master and RP snapshots are required before finalizing C1' using errcode='23514';
  end if;

  select count(*)::integer,coalesce(sum(cantidad_contada),0)::bigint
  into total_records,total_units
  from public.count_records
  where inventory_id=p_inventory_id
    and not exists(
      select 1
      from public.recount_mission_observations o
      where o.count_record_id=count_records.id
    );

  update public.inventories
  set c1_completed_at=now(),
      c1_completed_by=actor,
      c1_count_records=total_records,
      c1_counted_units=total_units,
      c1_master_fingerprint=master_fp,
      c1_reference_fingerprint=reference_fp
  where id=p_inventory_id;

  -- Any pre-F16 queued preview work is provisional. Cancel stale queue entries.
  update public.recount_missions m
  set status='CANCELLED'
  where m.inventory_id=p_inventory_id
    and m.status='QUEUED'
    and not exists(
      select 1
      from app_private.final_reconciliation_candidates(p_inventory_id) c
      join public.reconciliation_cases r
        on r.id=m.case_id
       and r.codigo=c.codigo
       and r.reference_type=c.reference_type
       and coalesce(r.reference_value,'')=coalesce(c.reference_value,'')
       and r.anomaly_type=c.anomaly_type
    );

  -- Auto-resolve provisional cases that disappeared once all C1 locations were aggregated.
  update public.reconciliation_cases r
  set status='RESUELTO',
      disposition='SIN_AJUSTE',
      resolution_reason='Descartado automáticamente al cerrar C1: la referencia ya no presenta discrepancia en el snapshot físico final.',
      resolved_by=actor,
      resolved_at=now()
  where r.inventory_id=p_inventory_id
    and r.source_fingerprint=reference_fp
    and r.status in('PENDIENTE_ANALISIS','REQUIERE_2DO_CONTEO')
    and not exists(
      select 1
      from app_private.final_reconciliation_candidates(p_inventory_id) c
      where c.codigo=r.codigo
        and c.reference_type=r.reference_type
        and coalesce(c.reference_value,'')=coalesce(r.reference_value,'')
        and c.anomaly_type=r.anomaly_type
    );

  -- Promote any still-valid provisional case to the immutable final C1 quantities.
  update public.reconciliation_cases r
  set system_quantity=c.system_quantity,
      physical_quantity=c.physical_quantity,
      first_count_record_id=coalesce(c.first_count_record_id,r.first_count_record_id),
      status='REQUIERE_2DO_CONTEO'
  from app_private.final_reconciliation_candidates(p_inventory_id) c
  where r.inventory_id=p_inventory_id
    and r.source_fingerprint=reference_fp
    and r.status in('PENDIENTE_ANALISIS','REQUIERE_2DO_CONTEO')
    and r.codigo=c.codigo
    and r.reference_type=c.reference_type
    and coalesce(r.reference_value,'')=coalesce(c.reference_value,'')
    and r.anomaly_type=c.anomaly_type;

  insert into public.reconciliation_cases(
    inventory_id,codigo,reference_type,reference_value,anomaly_type,
    system_quantity,physical_quantity,status,first_count_record_id,created_by,source_fingerprint
  )
  select
    p_inventory_id,c.codigo,c.reference_type,c.reference_value,c.anomaly_type,
    c.system_quantity,c.physical_quantity,'REQUIERE_2DO_CONTEO',c.first_count_record_id,actor,reference_fp
  from app_private.final_reconciliation_candidates(p_inventory_id) c
  where not exists(
    select 1
    from public.reconciliation_cases r
    where r.inventory_id=p_inventory_id
      and r.source_fingerprint=reference_fp
      and r.status<>'RESUELTO'
      and r.codigo=c.codigo
      and r.reference_type=c.reference_type
      and coalesce(r.reference_value,'')=coalesce(c.reference_value,'')
      and r.anomaly_type=c.anomaly_type
  )
  on conflict do nothing;

  insert into public.recount_missions(case_id,inventory_id,round,created_by)
  select r.id,r.inventory_id,2,actor
  from public.reconciliation_cases r
  where r.inventory_id=p_inventory_id
    and r.source_fingerprint=reference_fp
    and r.status='REQUIERE_2DO_CONTEO'
  on conflict(case_id,round) do update
  set status='QUEUED',
      assigned_user_id=null,
      claimed_at=null,
      completed_at=null,
      total_quantity=null,
      updated_at=now()
  where public.recount_missions.status='CANCELLED';

  select count(*)::integer into candidate_count
  from app_private.final_reconciliation_candidates(p_inventory_id);

  return public.get_inventory_lifecycle(p_inventory_id)
    || jsonb_build_object('final_anomalies',candidate_count);
end
$function$;

create or replace function app_private.active_recount_mission_for_count(
  p_inventory_id uuid,
  p_actor uuid,
  p_codigo text,
  p_serie text,
  p_partida text
)
returns uuid
language sql
stable
security definer
set search_path=public,app_private,pg_temp
as $function$
  select m.id
  from public.recount_missions m
  join public.reconciliation_cases r on r.id=m.case_id
  where m.inventory_id=p_inventory_id
    and m.assigned_user_id=p_actor
    and m.status='ACTIVE'
    and r.codigo=p_codigo
    and (
      (r.reference_type='SERIAL' and coalesce(r.reference_value,'')=coalesce(p_serie,''))
      or (r.reference_type='PARTIDA' and coalesce(r.reference_value,'')=coalesce(p_partida,''))
      or r.reference_type='LEGACY'
    )
  order by m.claimed_at,m.id
  limit 1
$function$;

revoke all on function app_private.active_recount_mission_for_count(uuid,uuid,text,text,text) from public,anon,authenticated;

create or replace function public.sync_counts(
  p_inventory_id uuid,
  p_device_id uuid,
  p_platform public.device_platform,
  p_app_version text,
  p_device_label text,
  p_records jsonb
)
returns table(
  client_count_id uuid,
  result_status text,
  server_count_id uuid,
  received_at timestamptz,
  reason text
)
language plpgsql
security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  v_actor_id uuid:=auth.uid();
  v_inventory public.inventories%rowtype;
  v_master public.inventory_master_items%rowtype;
  v_existing public.count_records%rowtype;
  v_record jsonb;
  v_client_count_id uuid;
  v_ubicacion text;
  v_codigo text;
  v_serie text;
  v_partida text;
  v_pieza_producto text;
  v_fecha_vencimiento date;
  v_talla text;
  v_color text;
  v_cantidad integer;
  v_captured_at timestamptz;
  v_new_id uuid;
  v_recount_mission_id uuid;
  v_now timestamptz:=now();
begin
  if v_actor_id is null or not exists(select 1 from public.profiles where user_id=v_actor_id and active) then
    raise exception 'Active authentication is required' using errcode='42501';
  end if;
  if p_records is null or jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)=0 or jsonb_array_length(p_records)>20 then
    raise exception 'sync_counts requires 1 to 20 records' using errcode='23514';
  end if;
  if not app_private.can_access_inventory(p_inventory_id) then
    raise exception 'Not authorized for inventory' using errcode='42501';
  end if;

  select * into v_inventory
  from public.inventories
  where id=p_inventory_id
  for update;

  if not found then raise exception 'Inventory not found' using errcode='P0002'; end if;

  perform public.register_sync_device(p_device_id,p_platform,p_app_version,p_device_label);

  for v_record in select value from jsonb_array_elements(p_records) loop
    client_count_id:=null;server_count_id:=null;received_at:=null;reason:=null;
    v_recount_mission_id:=null;

    begin
      if jsonb_typeof(v_record)<>'object' then raise exception 'Invalid record'; end if;
      v_client_count_id:=(v_record->>'client_count_id')::uuid;
      client_count_id:=v_client_count_id;
      v_ubicacion:=upper(btrim(v_record->>'ubicacion'));
      v_codigo:=upper(btrim(v_record->>'codigo'));
      v_serie:=nullif(btrim(v_record->>'serie'),'');
      v_partida:=nullif(btrim(v_record->>'partida'),'');
      v_pieza_producto:=nullif(btrim(v_record->>'pieza_producto'),'');
      v_fecha_vencimiento:=nullif(v_record->>'fecha_vencimiento','')::date;
      v_talla:=nullif(btrim(v_record->>'talla'),'');
      v_color:=nullif(btrim(v_record->>'color'),'');
      v_cantidad:=(v_record->>'cantidad_contada')::integer;
      v_captured_at:=(v_record->>'captured_at')::timestamptz;
    exception when others then
      result_status:='REJECTED';reason:='INVALID_RECORD';return next;continue;
    end;

    select * into v_existing
    from public.count_records
    where count_records.client_count_id=v_client_count_id;

    if found then
      if app_private.matches_original_count_replay(
        v_existing.id,p_inventory_id,v_actor_id,p_device_id,v_ubicacion,v_codigo,v_serie,v_partida,
        v_pieza_producto,v_fecha_vencimiento,v_talla,v_color,v_cantidad,v_captured_at
      ) then
        result_status:='ALREADY_ACCEPTED';server_count_id:=v_existing.id;received_at:=v_existing.received_at;return next;continue;
      end if;
      result_status:='CONFLICT';reason:='CLIENT_COUNT_ID_PAYLOAD_CONFLICT';return next;continue;
    end if;

    if v_inventory.status='CONGELADO' then result_status:='REJECTED';reason:='INVENTORY_FROZEN';return next;continue;end if;
    if v_inventory.status not in('ABIERTO','CERRADO') then result_status:='REJECTED';reason:='INVENTORY_NOT_ACCEPTING_COUNTS';return next;continue;end if;
    if v_ubicacion !~ '^(A|B|C|C2|D|F|G|H|I)-[0-9]{2}-[0-9]{2}$' then result_status:='REJECTED';reason:='INVALID_LOCATION';return next;continue;end if;
    if v_codigo is null or v_codigo='' or v_cantidad is null or v_cantidad<=0 or v_captured_at is null then result_status:='REJECTED';reason:='INVALID_RECORD';return next;continue;end if;

    select * into v_master
    from public.inventory_master_items
    where inventory_id=p_inventory_id and codigo=v_codigo;

    if not found then result_status:='REJECTED';reason:='UNKNOWN_SKU';return next;continue;end if;
    if v_master.control_type='SERIAL' and (v_serie is null or length(v_serie)>19 or v_cantidad<>1 or v_partida is not null) then result_status:='REJECTED';reason:='INVALID_SERIAL';return next;continue;end if;
    if v_master.control_type='PARTIDA' and (v_partida is null or v_serie is not null) then result_status:='REJECTED';reason:='INVALID_BATCH';return next;continue;end if;

    v_recount_mission_id:=app_private.active_recount_mission_for_count(
      p_inventory_id,v_actor_id,v_codigo,v_serie,v_partida
    );

    if v_inventory.c1_completed_at is not null and v_recount_mission_id is null then
      result_status:='REJECTED';reason:='C1_COMPLETED';return next;continue;
    end if;

    if v_recount_mission_id is not null
       and v_master.control_type<>'SERIAL'
       and exists(
         select 1
         from public.recount_mission_observations o
         join public.count_records previous on previous.id=o.count_record_id
         where o.mission_id=v_recount_mission_id
           and previous.ubicacion=v_ubicacion
       )
    then
      result_status:='REJECTED';reason:='RECOUNT_LOCATION_ALREADY_RECORDED';return next;continue;
    end if;

    v_new_id:=null;
    insert into public.count_records(
      client_count_id,inventory_id,user_id,device_id,ubicacion,codigo,serie,partida,pieza_producto,
      fecha_vencimiento,talla,color,cantidad_contada,descripcion,captured_at,received_at,
      inventory_status_at_receive,captured_after_closed_at
    ) values(
      v_client_count_id,p_inventory_id,v_actor_id,p_device_id,v_ubicacion,v_codigo,v_serie,v_partida,v_pieza_producto,
      v_fecha_vencimiento,v_talla,v_color,v_cantidad,v_master.descripcion,v_captured_at,v_now,
      v_inventory.status,case when v_inventory.status='CERRADO' then v_captured_at>v_inventory.closed_at else null end
    )
    on conflict on constraint count_records_client_count_id_key do nothing
    returning count_records.id,count_records.received_at into v_new_id,received_at;

    if v_new_id is null then
      select * into v_existing from public.count_records where count_records.client_count_id=v_client_count_id;
      if app_private.matches_original_count_replay(
        v_existing.id,p_inventory_id,v_actor_id,p_device_id,v_ubicacion,v_codigo,v_serie,v_partida,
        v_pieza_producto,v_fecha_vencimiento,v_talla,v_color,v_cantidad,v_captured_at
      ) then
        result_status:='ALREADY_ACCEPTED';server_count_id:=v_existing.id;received_at:=v_existing.received_at;return next;continue;
      end if;
      result_status:='CONFLICT';reason:='CLIENT_COUNT_ID_PAYLOAD_CONFLICT';return next;continue;
    end if;

    insert into public.audit_events(inventory_id,actor_user_id,device_id,event_type,entity_type,entity_id,payload)
    values
      (p_inventory_id,v_actor_id,p_device_id,'COUNT_CREATED','count_record',v_new_id,jsonb_build_object(
        'client_count_id',v_client_count_id,
        'inventory_status_at_receive',v_inventory.status,
        'captured_after_closed_at',case when v_inventory.status='CERRADO' then v_captured_at>v_inventory.closed_at else null end,
        'recount_mission_id',v_recount_mission_id
      )),
      (p_inventory_id,v_actor_id,p_device_id,'COUNT_SYNCED','count_record',v_new_id,jsonb_build_object(
        'client_count_id',v_client_count_id,
        'recount_mission_id',v_recount_mission_id
      ));

    if v_recount_mission_id is not null then
      insert into public.recount_mission_observations(mission_id,count_record_id)
      values(v_recount_mission_id,v_new_id)
      on conflict do nothing;
    end if;

    result_status:='ACCEPTED';server_count_id:=v_new_id;return next;
  end loop;

  update public.sync_devices
  set last_seen_at=v_now,last_sync_at=v_now
  where id=p_device_id and user_id=v_actor_id;
end
$function$;

create or replace function app_private.complete_recount_mission_internal(
  p_mission_id uuid,
  p_actor uuid,
  p_zero_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  mission public.recount_missions;
  r public.reconciliation_cases;
  total integer:=0;
  observations integer:=0;
  result_status public.reconciliation_status;
begin
  select * into mission
  from public.recount_missions
  where id=p_mission_id
  for update;

  if mission.id is null or mission.status<>'ACTIVE' or mission.assigned_user_id<>p_actor then
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

  if p_zero_confirmed and observations>0 then
    raise exception 'Zero confirmation is only valid before recording physical observations' using errcode='23514';
  end if;
  if not p_zero_confirmed and observations=0 then
    raise exception 'Recount mission requires at least one physical observation' using errcode='23514';
  end if;
  if p_zero_confirmed then total:=0; end if;

  update public.recount_missions
  set status='COMPLETED',total_quantity=total,completed_at=now()
  where id=mission.id;

  if mission.round=2 then
    if total=r.physical_quantity then
      result_status:='FISICO_CONFIRMADO';
    else
      result_status:='REQUIERE_3ER_CONTEO';
    end if;
  else
    result_status:='FISICO_CONFIRMADO';
  end if;

  if mission.round=2 and result_status='REQUIERE_3ER_CONTEO' then
    update public.reconciliation_cases
    set status=result_status,confirmed_physical_quantity=null
    where id=r.id;

    insert into public.recount_missions(case_id,inventory_id,round,created_by)
    values(r.id,r.inventory_id,3,p_actor)
    on conflict(case_id,round) do nothing;
  else
    update public.reconciliation_cases
    set status='FISICO_CONFIRMADO',confirmed_physical_quantity=total
    where id=r.id;
    result_status:='FISICO_CONFIRMADO';
  end if;

  perform app_private.append_reconciliation_event(
    r.id,
    r.inventory_id,
    case when mission.round=2 then 'SECOND_RECORDED' else 'THIRD_RECORDED' end,
    p_actor,
    jsonb_build_object(
      'mission_id',mission.id,
      'round',mission.round,
      'observation_count',observations,
      'total_quantity',total,
      'zero_confirmed',p_zero_confirmed,
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

revoke all on function app_private.complete_recount_mission_internal(uuid,uuid,boolean) from public,anon,authenticated;

create or replace function public.complete_my_recount_mission(p_mission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  actor uuid:=app_private.require_active_actor();
begin
  return app_private.complete_recount_mission_internal(p_mission_id,actor,false);
end
$function$;

create or replace function public.complete_my_recount_mission_zero(p_mission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  actor uuid:=app_private.require_active_actor();
begin
  return app_private.complete_recount_mission_internal(p_mission_id,actor,true);
end
$function$;

drop function if exists public.add_my_recount_observation(uuid,uuid);
drop function if exists public.materialize_reconciliation_cases(uuid);

create or replace function public.close_inventory(target_inventory_id uuid)
returns public.inventories
language plpgsql
security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  inv public.inventories;
  fp text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode='42501';
  end if;
  if not app_private.can_manage_inventory(target_inventory_id) then
    raise exception 'Not authorized to manage inventory' using errcode='42501';
  end if;

  inv:=app_private.lock_inventory(target_inventory_id);

  if inv.id is null then
    raise exception 'Inventory not found' using errcode='P0002';
  end if;
  if inv.status<>'ABIERTO' then
    raise exception 'Inventory must be ABIERTO to close' using errcode='23514';
  end if;
  if inv.c1_completed_at is null then
    raise exception 'C1 must be finalized before inventory closure' using errcode='23514';
  end if;

  select fingerprint into fp
  from public.inventory_system_reference_metadata
  where inventory_id=target_inventory_id;

  if exists(
    select 1
    from public.reconciliation_cases
    where inventory_id=target_inventory_id
      and (fp is null or source_fingerprint=fp)
      and status<>'RESUELTO'
  ) then
    raise exception 'All reconciliation cases must be resolved before inventory closure' using errcode='23514';
  end if;

  if exists(
    select 1
    from public.recount_missions
    where inventory_id=target_inventory_id
      and status in('QUEUED','ACTIVE')
  ) then
    raise exception 'No recount missions may remain queued or active before inventory closure' using errcode='23514';
  end if;

  return app_private.transition_inventory(target_inventory_id,'ABIERTO','CERRADO','INVENTORY_CLOSED');
end
$function$;

create or replace function app_private.enforce_c1_physical_freeze()
returns trigger
language plpgsql
security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  completed_at timestamptz;
begin
  if row(
    new.ubicacion,new.codigo,new.serie,new.partida,new.pieza_producto,new.fecha_vencimiento,
    new.talla,new.color,new.cantidad_contada,new.descripcion
  ) is not distinct from row(
    old.ubicacion,old.codigo,old.serie,old.partida,old.pieza_producto,old.fecha_vencimiento,
    old.talla,old.color,old.cantidad_contada,old.descripcion
  ) then
    return new;
  end if;

  select c1_completed_at into completed_at
  from public.inventories
  where id=old.inventory_id;

  if completed_at is null then
    return new;
  end if;

  if exists(
    select 1
    from public.recount_mission_observations o
    join public.recount_missions m on m.id=o.mission_id
    where o.count_record_id=old.id
      and m.status='ACTIVE'
      and m.assigned_user_id=auth.uid()
  ) then
    return new;
  end if;

  raise exception 'C1 physical snapshot is finalized; normal count corrections are no longer allowed'
    using errcode='23514';
end
$function$;

revoke all on function app_private.enforce_c1_physical_freeze() from public,anon,authenticated;

drop trigger if exists count_records_c1_physical_freeze on public.count_records;
create trigger count_records_c1_physical_freeze
before update on public.count_records
for each row execute function app_private.enforce_c1_physical_freeze();

revoke all on function public.get_inventory_lifecycle(uuid),
  public.finalize_c1_coverage(uuid,boolean),
  public.complete_my_recount_mission_zero(uuid)
from public,anon;

grant execute on function public.get_inventory_lifecycle(uuid),
  public.finalize_c1_coverage(uuid,boolean),
  public.complete_my_recount_mission_zero(uuid)
to authenticated;
