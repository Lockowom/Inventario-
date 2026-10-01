-- F11 capture bridge hardening: one canonical path for count-record validation.
create or replace function public.get_my_recount_assignments(p_inventory_id uuid)
returns table(id uuid,inventory_id uuid,codigo text,reference_type public.master_control_type,reference_value text,round integer)
language plpgsql stable security definer set search_path=public,app_private,pg_temp as $$
declare actor uuid:=app_private.require_active_actor();
begin
 if not app_private.can_access_inventory(p_inventory_id) then raise exception 'Not authorized for inventory' using errcode='42501'; end if;
 return query select r.id,r.inventory_id,r.codigo,r.reference_type,r.reference_value,case when r.status='2DO_CONTEO_ASIGNADO' then 2 else 3 end
 from public.reconciliation_cases r where r.inventory_id=p_inventory_id and
 ((r.status='2DO_CONTEO_ASIGNADO' and r.assigned_second_user_id=actor) or
  (r.status='3ER_CONTEO_ASIGNADO' and r.assigned_third_analyst_id=actor and app_private.is_analyst()))
 order by r.created_at;
end $$;

create or replace function public.record_my_recount(p_case_id uuid,p_client_count_id uuid)
returns public.reconciliation_cases language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v public.reconciliation_cases; c public.count_records; actor uuid:=app_private.require_active_actor();
begin
 select * into v from public.reconciliation_cases where id=p_case_id for update;
 if v.id is null then raise exception 'Recount case not found' using errcode='P0002'; end if;
 select * into c from public.count_records where inventory_id=v.inventory_id and user_id=actor and client_count_id=p_client_count_id;
 if c.id is null then raise exception 'Confirmed recount record not found' using errcode='23514'; end if;
 if v.status='2DO_CONTEO_ASIGNADO' and v.assigned_second_user_id=actor then return public.record_second_recount(v.id,c.id); end if;
 if v.status='3ER_CONTEO_ASIGNADO' and v.assigned_third_analyst_id=actor and app_private.is_analyst() then return public.record_third_recount(v.id,c.id); end if;
 raise exception 'Actor is not assigned to this recount' using errcode='42501';
end $$;
