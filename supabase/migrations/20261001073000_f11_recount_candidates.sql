-- F11 eligible recount candidates. Keeps assignment invariants server-side.
create function public.list_recount_candidates(p_case_id uuid,p_round integer)
returns table(user_id uuid,display_name text,role public.app_role)
language plpgsql stable security definer set search_path=public,app_private,pg_temp as $$
declare v public.reconciliation_cases; actor uuid:=app_private.require_active_actor(); c1_user uuid;
begin
 select * into v from public.reconciliation_cases where id=p_case_id;
 if v.id is null then raise exception 'Reconciliation case not found' using errcode='P0002'; end if;
 if not app_private.can_manage_inventory(v.inventory_id) then raise exception 'Not authorized for reconciliation candidates' using errcode='42501'; end if;
 if p_round=2 then
   select user_id into c1_user from public.count_records where id=v.first_count_record_id;
   return query
   select p.user_id,p.display_name,p.role
   from public.inventory_assignments a join public.profiles p on p.user_id=a.user_id
   where a.inventory_id=v.inventory_id and a.active and p.active and p.role='CONTADOR'
     and p.user_id is distinct from c1_user
   order by p.display_name,p.user_id;
 elsif p_round=3 then
   return query
   select p.user_id,p.display_name,p.role
   from public.inventory_assignments a join public.profiles p on p.user_id=a.user_id
   where a.inventory_id=v.inventory_id and a.active and p.active and p.role='ANALISTA'
   order by p.display_name,p.user_id;
 else
   raise exception 'Recount round must be 2 or 3' using errcode='23514';
 end if;
end $$;
revoke all on function public.list_recount_candidates(uuid,integer) from public,anon;
grant execute on function public.list_recount_candidates(uuid,integer) to authenticated;
