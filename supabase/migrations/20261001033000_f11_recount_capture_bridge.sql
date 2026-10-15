-- F11 capture bridge: consume only server-confirmed count_records by client UUID.
create or replace function public.get_my_recount_assignments(p_inventory_id uuid)
returns table(id uuid,inventory_id uuid,codigo text,reference_type public.master_control_type,reference_value text,round integer)
language sql stable security definer set search_path=public,app_private,pg_temp as $$
 select r.id,r.inventory_id,r.codigo,r.reference_type,r.reference_value,
   case when r.status='2DO_CONTEO_ASIGNADO' then 2 else 3 end
 from public.reconciliation_cases r
 where r.inventory_id=p_inventory_id and app_private.can_access_inventory(p_inventory_id)
 and ((r.status='2DO_CONTEO_ASIGNADO' and r.assigned_second_user_id=auth.uid())
   or (r.status='3ER_CONTEO_ASIGNADO' and r.assigned_third_analyst_id=auth.uid() and app_private.is_analyst()))
 order by r.created_at
$$;

create function public.record_my_recount(p_case_id uuid,p_client_count_id uuid)
returns public.reconciliation_cases language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v public.reconciliation_cases; c public.count_records; actor uuid:=app_private.require_active_actor();
begin
 select * into v from public.reconciliation_cases where id=p_case_id for update;
 if v.id is null then raise exception 'Recount case not found' using errcode='P0002'; end if;
 select * into c from public.count_records where inventory_id=v.inventory_id and user_id=actor and client_count_id=p_client_count_id;
 if c.id is null or c.codigo<>v.codigo then raise exception 'Confirmed recount record not found' using errcode='23514'; end if;
 if v.reference_type='SERIAL' and coalesce(c.serie,'')<>coalesce(v.reference_value,'') then raise exception 'Serial does not match recount case' using errcode='23514'; end if;
 if v.reference_type='PARTIDA' and coalesce(c.partida,'')<>coalesce(v.reference_value,'') then raise exception 'Batch does not match recount case' using errcode='23514'; end if;
 if v.status='2DO_CONTEO_ASIGNADO' and v.assigned_second_user_id=actor then
   update public.reconciliation_cases set second_count_record_id=c.id,
    status=case when c.cantidad_contada=v.physical_quantity then 'FISICO_CONFIRMADO'::public.reconciliation_status else 'REQUIERE_3ER_CONTEO'::public.reconciliation_status end,
    confirmed_physical_quantity=case when c.cantidad_contada=v.physical_quantity then c.cantidad_contada else null end
   where id=v.id returning * into v; return v;
 end if;
 if v.status='3ER_CONTEO_ASIGNADO' and v.assigned_third_analyst_id=actor and app_private.is_analyst() then
   update public.reconciliation_cases set third_count_record_id=c.id,status='FISICO_CONFIRMADO',confirmed_physical_quantity=c.cantidad_contada
   where id=v.id returning * into v; return v;
 end if;
 raise exception 'Actor is not assigned to this recount' using errcode='42501';
end $$;
revoke all on function public.record_my_recount(uuid,uuid) from public,anon;
grant execute on function public.record_my_recount(uuid,uuid) to authenticated;
