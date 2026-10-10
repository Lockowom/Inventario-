-- F11 recount invariants hardening.
create or replace function public.assign_second_recount(p_case_id uuid,p_user_id uuid)
returns public.reconciliation_cases language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v public.reconciliation_cases; first_actor uuid;
begin
 perform app_private.require_active_actor();
 select * into v from public.reconciliation_cases where id=p_case_id for update;
 if v.id is null or not app_private.can_manage_inventory(v.inventory_id) then raise exception 'Not authorized' using errcode='42501'; end if;
 if v.status not in ('PENDIENTE_ANALISIS','REQUIERE_2DO_CONTEO') then raise exception 'Case does not admit second recount' using errcode='23514'; end if;
 select user_id into first_actor from public.count_records where id=v.first_count_record_id and inventory_id=v.inventory_id;
 if first_actor is null then raise exception 'Original count record is required' using errcode='23514'; end if;
 if p_user_id=first_actor or not exists(select 1 from public.inventory_assignments a join public.profiles p on p.user_id=a.user_id where a.inventory_id=v.inventory_id and a.user_id=p_user_id and a.active and p.active and p.role='CONTADOR')
 then raise exception 'Invalid second counter' using errcode='23514'; end if;
 update public.reconciliation_cases set status='2DO_CONTEO_ASIGNADO',assigned_second_user_id=p_user_id where id=p_case_id returning * into v; return v;
end $$;

create or replace function public.record_second_recount(p_case_id uuid,p_count_record_id uuid)
returns public.reconciliation_cases language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v public.reconciliation_cases; c public.count_records; c1 public.count_records; actor uuid:=app_private.require_active_actor();
begin
 select * into v from public.reconciliation_cases where id=p_case_id for update;
 if v.id is null or v.status<>'2DO_CONTEO_ASIGNADO' or v.assigned_second_user_id<>actor then raise exception 'Not assigned to second recount' using errcode='42501'; end if;
 select * into c1 from public.count_records where id=v.first_count_record_id and inventory_id=v.inventory_id;
 select * into c from public.count_records where id=p_count_record_id and inventory_id=v.inventory_id and user_id=actor;
 if c.id is null or c1.id is null or c.id=c1.id or c.codigo<>v.codigo then raise exception 'Invalid recount record' using errcode='23514'; end if;
 if v.reference_type='SERIAL' and coalesce(c.serie,'')<>coalesce(v.reference_value,'') then raise exception 'Serial does not match recount case' using errcode='23514'; end if;
 if v.reference_type='PARTIDA' and coalesce(c.partida,'')<>coalesce(v.reference_value,'') then raise exception 'Batch does not match recount case' using errcode='23514'; end if;
 if exists(select 1 from public.reconciliation_cases x where x.id<>v.id and p_count_record_id in (x.first_count_record_id,x.second_count_record_id,x.third_count_record_id)) then raise exception 'Count record already used by reconciliation' using errcode='23505'; end if;
 update public.reconciliation_cases set second_count_record_id=c.id,status=case when c.cantidad_contada=c1.cantidad_contada then 'FISICO_CONFIRMADO'::public.reconciliation_status else 'REQUIERE_3ER_CONTEO'::public.reconciliation_status end,confirmed_physical_quantity=case when c.cantidad_contada=c1.cantidad_contada then c.cantidad_contada else null end where id=v.id returning * into v; return v;
end $$;

create or replace function public.record_third_recount(p_case_id uuid,p_count_record_id uuid)
returns public.reconciliation_cases language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v public.reconciliation_cases; c public.count_records; actor uuid:=app_private.require_active_actor();
begin
 select * into v from public.reconciliation_cases where id=p_case_id for update;
 if v.id is null or v.status<>'3ER_CONTEO_ASIGNADO' or v.assigned_third_analyst_id<>actor or not app_private.is_analyst() then raise exception 'Only assigned analyst can record third recount' using errcode='42501'; end if;
 select * into c from public.count_records where id=p_count_record_id and inventory_id=v.inventory_id and user_id=actor;
 if c.id is null or c.codigo<>v.codigo or c.id in (v.first_count_record_id,v.second_count_record_id) then raise exception 'Invalid third recount record' using errcode='23514'; end if;
 if v.reference_type='SERIAL' and coalesce(c.serie,'')<>coalesce(v.reference_value,'') then raise exception 'Serial does not match recount case' using errcode='23514'; end if;
 if v.reference_type='PARTIDA' and coalesce(c.partida,'')<>coalesce(v.reference_value,'') then raise exception 'Batch does not match recount case' using errcode='23514'; end if;
 if exists(select 1 from public.reconciliation_cases x where x.id<>v.id and p_count_record_id in (x.first_count_record_id,x.second_count_record_id,x.third_count_record_id)) then raise exception 'Count record already used by reconciliation' using errcode='23505'; end if;
 update public.reconciliation_cases set third_count_record_id=c.id,status='FISICO_CONFIRMADO',confirmed_physical_quantity=c.cantidad_contada where id=v.id returning * into v; return v;
end $$;
