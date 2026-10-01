-- F11 invariant hardening. Supersedes permissive first versions without remote mutation.
create or replace function public.assign_second_recount(p_case_id uuid,p_user_id uuid)
returns public.reconciliation_cases language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v public.reconciliation_cases; first_actor uuid;
begin
 perform app_private.require_active_actor();
 select * into v from public.reconciliation_cases where id=p_case_id for update;
 if v.id is null or not app_private.can_manage_inventory(v.inventory_id) then raise exception 'Not authorized' using errcode='42501'; end if;
 if v.status not in ('PENDIENTE_ANALISIS','REQUIERE_2DO_CONTEO') then raise exception 'Case does not admit second recount' using errcode='23514'; end if;
 select user_id into first_actor from public.count_records where id=v.first_count_record_id;
 if first_actor is null or p_user_id=first_actor then raise exception 'Second counter must differ from first counter' using errcode='23514'; end if;
 if not exists(select 1 from public.inventory_assignments a join public.profiles p on p.user_id=a.user_id where a.inventory_id=v.inventory_id and a.user_id=p_user_id and a.active and p.active and p.role='CONTADOR') then raise exception 'Invalid second counter' using errcode='23514'; end if;
 update public.reconciliation_cases set status='2DO_CONTEO_ASIGNADO',assigned_second_user_id=p_user_id where id=p_case_id returning * into v; return v;
end $$;

create or replace function public.record_second_recount(p_case_id uuid,p_count_record_id uuid)
returns public.reconciliation_cases language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v public.reconciliation_cases; c public.count_records; first_count public.count_records; actor uuid:=app_private.require_active_actor();
begin
 select * into v from public.reconciliation_cases where id=p_case_id for update;
 if v.status<>'2DO_CONTEO_ASIGNADO' or v.assigned_second_user_id<>actor then raise exception 'Not assigned to second recount' using errcode='42501'; end if;
 if p_count_record_id=v.first_count_record_id then raise exception 'Count record cannot be reused' using errcode='23514'; end if;
 select * into c from public.count_records where id=p_count_record_id and inventory_id=v.inventory_id and user_id=actor;
 select * into first_count from public.count_records where id=v.first_count_record_id and inventory_id=v.inventory_id;
 if c.id is null or first_count.id is null or c.codigo<>v.codigo then raise exception 'Invalid recount record' using errcode='23514'; end if;
 if v.reference_type='SERIAL' and coalesce(c.serie,'')<>coalesce(v.reference_value,'') then raise exception 'Serial does not match recount case' using errcode='23514'; end if;
 if v.reference_type='PARTIDA' and coalesce(c.partida,'')<>coalesce(v.reference_value,'') then raise exception 'Batch does not match recount case' using errcode='23514'; end if;
 update public.reconciliation_cases set second_count_record_id=c.id,
 status=case when c.cantidad_contada=first_count.cantidad_contada then 'FISICO_CONFIRMADO'::public.reconciliation_status else 'REQUIERE_3ER_CONTEO'::public.reconciliation_status end,
 confirmed_physical_quantity=case when c.cantidad_contada=first_count.cantidad_contada then c.cantidad_contada else null end
 where id=p_case_id returning * into v; return v;
end $$;

create or replace function public.record_third_recount(p_case_id uuid,p_count_record_id uuid)
returns public.reconciliation_cases language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v public.reconciliation_cases; c public.count_records; actor uuid:=app_private.require_active_actor();
begin
 select * into v from public.reconciliation_cases where id=p_case_id for update;
 if v.status<>'3ER_CONTEO_ASIGNADO' or v.assigned_third_analyst_id<>actor or not app_private.is_analyst() then raise exception 'Only assigned analyst can record third recount' using errcode='42501'; end if;
 if p_count_record_id=v.first_count_record_id or p_count_record_id=v.second_count_record_id then raise exception 'Count record cannot be reused' using errcode='23514'; end if;
 select * into c from public.count_records where id=p_count_record_id and inventory_id=v.inventory_id and user_id=actor;
 if c.id is null or c.codigo<>v.codigo then raise exception 'Invalid recount record' using errcode='23514'; end if;
 if v.reference_type='SERIAL' and coalesce(c.serie,'')<>coalesce(v.reference_value,'') then raise exception 'Serial does not match recount case' using errcode='23514'; end if;
 if v.reference_type='PARTIDA' and coalesce(c.partida,'')<>coalesce(v.reference_value,'') then raise exception 'Batch does not match recount case' using errcode='23514'; end if;
 update public.reconciliation_cases set third_count_record_id=c.id,status='FISICO_CONFIRMADO',confirmed_physical_quantity=c.cantidad_contada where id=p_case_id returning * into v; return v;
end $$;
