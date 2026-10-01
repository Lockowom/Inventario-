-- F11 manager-only reconciliation event timeline.
create function public.list_reconciliation_events(p_case_id uuid)
returns table(
 id uuid,
 case_id uuid,
 event_type text,
 actor_user_id uuid,
 actor_display_name text,
 payload jsonb,
 created_at timestamptz
)
language plpgsql stable security definer set search_path=public,app_private,pg_temp as $$
declare v_inventory_id uuid;
begin
 perform app_private.require_active_actor();
 select inventory_id into v_inventory_id from public.reconciliation_cases where reconciliation_cases.id=p_case_id;
 if v_inventory_id is null then raise exception 'Reconciliation case not found' using errcode='P0002'; end if;
 if not app_private.can_manage_inventory(v_inventory_id) then raise exception 'Not authorized for reconciliation timeline' using errcode='42501'; end if;
 return query
 select e.id,e.case_id,e.event_type,e.actor_user_id,p.display_name,e.payload,e.created_at
 from public.reconciliation_events e
 join public.profiles p on p.user_id=e.actor_user_id
 where e.case_id=p_case_id
 order by e.created_at,e.id;
end $$;

revoke all on function public.list_reconciliation_events(uuid) from public,anon;
grant execute on function public.list_reconciliation_events(uuid) to authenticated;
