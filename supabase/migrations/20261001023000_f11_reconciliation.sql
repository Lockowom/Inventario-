-- F11: analyst reconciliation, directed recounts and immutable resolution trail.
create type public.reconciliation_status as enum ('PENDIENTE_ANALISIS','REQUIERE_2DO_CONTEO','2DO_CONTEO_ASIGNADO','REQUIERE_3ER_CONTEO','3ER_CONTEO_ASIGNADO','FISICO_CONFIRMADO','RESUELTO');
create type public.reconciliation_disposition as enum ('SIN_AJUSTE','AJUSTE_PROPUESTO','ERROR_DIGITACION_CONFIRMADO','ALTA_EN_SISTEMA_PROPUESTA','BAJA_EN_SISTEMA_PROPUESTA','OTRO');

create table public.reconciliation_cases (
 id uuid primary key default gen_random_uuid(),
 inventory_id uuid not null references public.inventories(id) on delete restrict,
 codigo text not null,
 reference_type public.master_control_type not null,
 reference_value text,
 anomaly_type text not null,
 system_quantity integer not null check(system_quantity>=0),
 physical_quantity integer not null check(physical_quantity>=0),
 status public.reconciliation_status not null default 'PENDIENTE_ANALISIS',
 first_count_record_id uuid references public.count_records(id) on delete restrict,
 second_count_record_id uuid references public.count_records(id) on delete restrict,
 third_count_record_id uuid references public.count_records(id) on delete restrict,
 assigned_second_user_id uuid references public.profiles(user_id) on delete restrict,
 assigned_third_analyst_id uuid references public.profiles(user_id) on delete restrict,
 confirmed_physical_quantity integer check(confirmed_physical_quantity>=0),
 disposition public.reconciliation_disposition,
 resolution_reason text,
 resolved_by uuid references public.profiles(user_id) on delete restrict,
 resolved_at timestamptz,
 created_by uuid not null references public.profiles(user_id) on delete restrict,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((status='RESUELTO' and disposition is not null and length(btrim(resolution_reason))>0 and resolved_by is not null and resolved_at is not null) or status<>'RESUELTO')
);
create index reconciliation_cases_inventory_status_idx on public.reconciliation_cases(inventory_id,status,created_at desc);
create trigger reconciliation_cases_set_updated_at before update on public.reconciliation_cases for each row execute function public.set_updated_at();

alter table public.reconciliation_cases enable row level security;
revoke all on public.reconciliation_cases from anon, authenticated;
grant select on public.reconciliation_cases to authenticated;
create policy reconciliation_manager_read on public.reconciliation_cases for select to authenticated using (app_private.can_manage_inventory(inventory_id));
create policy reconciliation_second_assignee_read on public.reconciliation_cases for select to authenticated using (status='2DO_CONTEO_ASIGNADO' and assigned_second_user_id=(select auth.uid()));

create function public.list_reconciliation_cases(p_inventory_id uuid)
returns setof public.reconciliation_cases language plpgsql stable security definer set search_path=public,app_private,pg_temp as $$
begin
 perform app_private.require_active_actor();
 if not app_private.can_manage_inventory(p_inventory_id) then raise exception 'Not authorized for reconciliation' using errcode='42501'; end if;
 return query select * from public.reconciliation_cases where inventory_id=p_inventory_id order by created_at desc;
end $$;

create function public.assign_second_recount(p_case_id uuid,p_user_id uuid)
returns public.reconciliation_cases language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v public.reconciliation_cases; actor uuid:=app_private.require_active_actor();
begin
 select * into v from public.reconciliation_cases where id=p_case_id for update;
 if v.id is null or not app_private.can_manage_inventory(v.inventory_id) then raise exception 'Not authorized' using errcode='42501'; end if;
 if v.status not in ('PENDIENTE_ANALISIS','REQUIERE_2DO_CONTEO') then raise exception 'Case does not admit second recount' using errcode='23514'; end if;
 if p_user_id=actor or not exists(select 1 from public.inventory_assignments a join public.profiles p on p.user_id=a.user_id where a.inventory_id=v.inventory_id and a.user_id=p_user_id and a.active and p.active and p.role='CONTADOR') then raise exception 'Invalid second counter' using errcode='23514'; end if;
 update public.reconciliation_cases set status='2DO_CONTEO_ASIGNADO',assigned_second_user_id=p_user_id where id=p_case_id returning * into v;
 return v;
end $$;

create function public.get_my_recount_assignments(p_inventory_id uuid)
returns table(id uuid,inventory_id uuid,codigo text,reference_type public.master_control_type,reference_value text,round integer)
language sql stable security definer set search_path=public,app_private,pg_temp as $$
 select r.id,r.inventory_id,r.codigo,r.reference_type,r.reference_value,2
 from public.reconciliation_cases r
 where r.inventory_id=p_inventory_id and r.status='2DO_CONTEO_ASIGNADO' and r.assigned_second_user_id=auth.uid()
 and app_private.can_access_inventory(p_inventory_id)
$$;

create function public.record_second_recount(p_case_id uuid,p_count_record_id uuid)
returns public.reconciliation_cases language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v public.reconciliation_cases; c public.count_records; actor uuid:=app_private.require_active_actor();
begin
 select * into v from public.reconciliation_cases where id=p_case_id for update;
 if v.status<>'2DO_CONTEO_ASIGNADO' or v.assigned_second_user_id<>actor then raise exception 'Not assigned to second recount' using errcode='42501'; end if;
 select * into c from public.count_records where id=p_count_record_id and inventory_id=v.inventory_id and user_id=actor;
 if c.id is null or c.codigo<>v.codigo then raise exception 'Invalid recount record' using errcode='23514'; end if;
 update public.reconciliation_cases set second_count_record_id=c.id,
   status=case when c.cantidad_contada=physical_quantity then 'FISICO_CONFIRMADO'::public.reconciliation_status else 'REQUIERE_3ER_CONTEO'::public.reconciliation_status end,
   confirmed_physical_quantity=case when c.cantidad_contada=physical_quantity then c.cantidad_contada else null end
 where id=p_case_id returning * into v;
 return v;
end $$;

create function public.assign_third_recount(p_case_id uuid,p_analyst_id uuid)
returns public.reconciliation_cases language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v public.reconciliation_cases;
begin
 perform app_private.require_active_actor();
 select * into v from public.reconciliation_cases where id=p_case_id for update;
 if v.id is null or not app_private.can_manage_inventory(v.inventory_id) then raise exception 'Not authorized' using errcode='42501'; end if;
 if v.status<>'REQUIERE_3ER_CONTEO' then raise exception 'Case does not admit third recount' using errcode='23514'; end if;
 if not exists(select 1 from public.inventory_assignments a join public.profiles p on p.user_id=a.user_id where a.inventory_id=v.inventory_id and a.user_id=p_analyst_id and a.active and p.active and p.role='ANALISTA') then raise exception 'Third recount requires assigned analyst' using errcode='23514'; end if;
 update public.reconciliation_cases set status='3ER_CONTEO_ASIGNADO',assigned_third_analyst_id=p_analyst_id where id=p_case_id returning * into v; return v;
end $$;

create function public.record_third_recount(p_case_id uuid,p_count_record_id uuid)
returns public.reconciliation_cases language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v public.reconciliation_cases; c public.count_records; actor uuid:=app_private.require_active_actor();
begin
 select * into v from public.reconciliation_cases where id=p_case_id for update;
 if v.status<>'3ER_CONTEO_ASIGNADO' or v.assigned_third_analyst_id<>actor or not app_private.is_analyst() then raise exception 'Only assigned analyst can record third recount' using errcode='42501'; end if;
 select * into c from public.count_records where id=p_count_record_id and inventory_id=v.inventory_id and user_id=actor;
 if c.id is null or c.codigo<>v.codigo then raise exception 'Invalid recount record' using errcode='23514'; end if;
 update public.reconciliation_cases set third_count_record_id=c.id,status='FISICO_CONFIRMADO',confirmed_physical_quantity=c.cantidad_contada where id=p_case_id returning * into v; return v;
end $$;

create function public.resolve_reconciliation(p_case_id uuid,p_disposition public.reconciliation_disposition,p_reason text)
returns public.reconciliation_cases language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v public.reconciliation_cases; actor uuid:=app_private.require_active_actor();
begin
 select * into v from public.reconciliation_cases where id=p_case_id for update;
 if not app_private.is_analyst() or v.id is null or not app_private.can_manage_inventory(v.inventory_id) then raise exception 'Only assigned analyst may resolve reconciliation' using errcode='42501'; end if;
 if v.status<>'FISICO_CONFIRMADO' or length(btrim(coalesce(p_reason,'')))=0 then raise exception 'Physical confirmation and reason required' using errcode='23514'; end if;
 update public.reconciliation_cases set status='RESUELTO',disposition=p_disposition,resolution_reason=btrim(p_reason),resolved_by=actor,resolved_at=now() where id=p_case_id returning * into v; return v;
end $$;

revoke all on function public.list_reconciliation_cases(uuid),public.assign_second_recount(uuid,uuid),public.get_my_recount_assignments(uuid),public.record_second_recount(uuid,uuid),public.assign_third_recount(uuid,uuid),public.record_third_recount(uuid,uuid),public.resolve_reconciliation(uuid,public.reconciliation_disposition,text) from public,anon;
grant execute on function public.list_reconciliation_cases(uuid),public.assign_second_recount(uuid,uuid),public.get_my_recount_assignments(uuid),public.record_second_recount(uuid,uuid),public.assign_third_recount(uuid,uuid),public.record_third_recount(uuid,uuid),public.resolve_reconciliation(uuid,public.reconciliation_disposition,text) to authenticated;
