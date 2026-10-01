-- F11 immutable reconciliation audit trail.
create table public.reconciliation_events(
 id uuid primary key default gen_random_uuid(),
 case_id uuid not null references public.reconciliation_cases(id) on delete restrict,
 inventory_id uuid not null references public.inventories(id) on delete restrict,
 event_type text not null check(event_type in ('SECOND_ASSIGNED','SECOND_RECORDED','THIRD_ASSIGNED','THIRD_RECORDED','RESOLVED')),
 actor_user_id uuid not null references public.profiles(user_id) on delete restrict,
 payload jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index reconciliation_events_case_created_idx on public.reconciliation_events(case_id,created_at,id);
alter table public.reconciliation_events enable row level security;
create policy reconciliation_events_manager_read on public.reconciliation_events for select to authenticated using(app_private.can_manage_inventory(inventory_id));
revoke all on public.reconciliation_events from public,anon,authenticated;
grant select on public.reconciliation_events to authenticated;

create function app_private.append_reconciliation_event(p_case_id uuid,p_inventory_id uuid,p_event_type text,p_actor uuid,p_payload jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path=public,app_private,pg_temp as $$
begin
 if p_event_type not in ('SECOND_ASSIGNED','SECOND_RECORDED','THIRD_ASSIGNED','THIRD_RECORDED','RESOLVED') then raise exception 'Invalid reconciliation event' using errcode='23514'; end if;
 insert into public.reconciliation_events(case_id,inventory_id,event_type,actor_user_id,payload) values(p_case_id,p_inventory_id,p_event_type,p_actor,coalesce(p_payload,'{}'::jsonb));
end $$;
revoke all on function app_private.append_reconciliation_event(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
