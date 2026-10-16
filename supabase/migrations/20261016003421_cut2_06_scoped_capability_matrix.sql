-- CUT2-06B: one auditable, deny-by-default authorization matrix.  It extends
-- the CUT2-01 grant table instead of introducing a parallel RBAC system.
create table public.cut2_default_capability_policies (
  role public.app_role not null,
  user_type public.cut2_user_type not null,
  capability public.cut2_capability not null,
  scope public.cut2_capability_scope not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (role, user_type, capability)
);

create table public.cut2_user_type_capability_allowlist (
  user_type public.cut2_user_type not null,
  capability public.cut2_capability not null,
  primary key (user_type, capability)
);

insert into public.cut2_user_type_capability_allowlist(user_type, capability)
select 'PERMANENT'::public.cut2_user_type, unnest(enum_range(null::public.cut2_capability))
union all select 'CONTRACTOR_3PL'::public.cut2_user_type, unnest(array['COUNT_C1','RECOUNT_C2','FINDING_REPORT']::public.cut2_capability[])
union all select 'TEMPORARY'::public.cut2_user_type, 'COUNT_C1'::public.cut2_capability
union all select 'EXTERNAL_AUDITOR'::public.cut2_user_type, unnest(array['READ_ONLY_AUDIT','VIEW_MONITOR']::public.cut2_capability[]);

insert into public.cut2_default_capability_policies(role,user_type,capability,scope) values
  ('CONTADOR','PERMANENT','COUNT_C1','INVENTORY'), ('CONTADOR','PERMANENT','RECOUNT_C2','INVENTORY'),
  ('ANALISTA','PERMANENT','COUNT_C1','INVENTORY'), ('ANALISTA','PERMANENT','RECOUNT_C2','INVENTORY'), ('ANALISTA','PERMANENT','RECOUNT_C3','INVENTORY'),
  ('ANALISTA','PERMANENT','MANAGE_RECONCILIATION','INVENTORY'), ('ANALISTA','PERMANENT','ROLLING_CUT_PREVIEW','INVENTORY'), ('ANALISTA','PERMANENT','ROLLING_CUT_CREATE','INVENTORY'),
  ('ANALISTA','PERMANENT','FINDING_REPORT','INVENTORY'), ('ANALISTA','PERMANENT','FINDING_RESOLVE','INVENTORY'), ('ANALISTA','PERMANENT','REASSIGN_C2','INVENTORY'),
  ('ANALISTA','PERMANENT','VIEW_MONITOR','INVENTORY'), ('ANALISTA','PERMANENT','MANAGE_INVENTORY','INVENTORY'), ('ANALISTA','PERMANENT','CLOSE_INVENTORY','INVENTORY'),
  ('ANALISTA','PERMANENT','VIEW_INDIVIDUAL_METRICS','INVENTORY'), ('ANALISTA','PERMANENT','READ_ONLY_AUDIT','INVENTORY'), ('ANALISTA','PERMANENT','RP_RELEASE','INVENTORY'), ('ANALISTA','PERMANENT','RECTIFY_SEALED_REFERENCE','INVENTORY'),
  ('CONTADOR','CONTRACTOR_3PL','COUNT_C1','INVENTORY'), ('CONTADOR','CONTRACTOR_3PL','RECOUNT_C2','INVENTORY'), ('CONTADOR','CONTRACTOR_3PL','FINDING_REPORT','INVENTORY'),
  ('CONTADOR','TEMPORARY','COUNT_C1','INVENTORY'),
  ('CONTADOR','EXTERNAL_AUDITOR','READ_ONLY_AUDIT','INVENTORY'), ('CONTADOR','EXTERNAL_AUDITOR','VIEW_MONITOR','INVENTORY')
on conflict do nothing;
insert into public.cut2_default_capability_policies(role,user_type,capability,scope)
select 'ADMIN','PERMANENT',capability,'GLOBAL' from public.cut2_user_type_capability_allowlist where user_type='PERMANENT'
on conflict do nothing;

create or replace function app_private.actor_has_capability(p_actor uuid,p_capability public.cut2_capability,p_inventory_id uuid default null,p_warehouse_id uuid default null,p_at timestamptz default now())
returns boolean language sql stable security definer set search_path=public,app_private,pg_temp as $$
  with actor as (
    select p.user_id,p.role,p.user_type from public.profiles p
    where p.user_id=p_actor and p.active
  ), resource as (
    select i.id inventory_id,i.warehouse_id from public.inventories i where i.id=p_inventory_id
  ), eligible_assignment as (
    select 1 from public.inventory_assignments a join actor x on x.user_id=a.user_id
    where a.inventory_id=p_inventory_id and a.active and a.valid_from<=p_at and (a.valid_until is null or a.valid_until>p_at)
  ), allowed_type as (
    select 1 from actor x join public.cut2_user_type_capability_allowlist l on l.user_type=x.user_type where l.capability=p_capability
  ), default_policy as (
    select 1 from actor x join public.cut2_default_capability_policies d on d.role=x.role and d.user_type=x.user_type and d.capability=p_capability and d.active
    where (d.scope='GLOBAL') or (d.scope='INVENTORY' and exists(select 1 from eligible_assignment)) or (d.scope='WAREHOUSE' and exists(select 1 from eligible_assignment) and exists(select 1 from resource r where r.warehouse_id=coalesce(p_warehouse_id,r.warehouse_id)))
  ), explicit_grant as (
    select 1 from actor x join public.inventory_capability_grants g on g.user_id=x.user_id and g.capability=p_capability
    where g.valid_from<=p_at and (g.valid_until is null or g.valid_until>p_at) and (
      g.scope='GLOBAL' or (g.scope='INVENTORY' and g.inventory_id=p_inventory_id and exists(select 1 from eligible_assignment))
      or (g.scope='WAREHOUSE' and g.warehouse_id=coalesce(p_warehouse_id,(select warehouse_id from resource)) and exists(select 1 from eligible_assignment))
    )
  )
  select exists(select 1 from actor) and exists(select 1 from allowed_type) and (exists(select 1 from default_policy) or exists(select 1 from explicit_grant));
$$;

create or replace function public.cut2_has_capability(p_inventory_id uuid,p_capability public.cut2_capability,p_at timestamptz default now())
returns boolean language sql stable security definer set search_path=public,app_private,pg_temp as $$
  select app_private.actor_has_capability(auth.uid(),p_capability,p_inventory_id,null,p_at)
$$;

create or replace function app_private.cut2_capability_grant_guard()
returns trigger language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_type public.cut2_user_type;
begin
  select user_type into v_type from public.profiles where user_id=new.user_id and active;
  if v_type is null or not exists(select 1 from public.cut2_user_type_capability_allowlist where user_type=v_type and capability=new.capability) then raise exception 'CAPABILITY_NOT_ALLOWED_FOR_USER_TYPE' using errcode='42501'; end if;
  if new.scope='INVENTORY' and new.warehouse_id is not null then raise exception 'INVENTORY_SCOPE_CANNOT_INCLUDE_WAREHOUSE' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger cut2_capability_grant_guard before insert or update on public.inventory_capability_grants for each row execute function app_private.cut2_capability_grant_guard();

alter table public.cut2_default_capability_policies enable row level security;
alter table public.cut2_user_type_capability_allowlist enable row level security;
revoke all on public.cut2_default_capability_policies,public.cut2_user_type_capability_allowlist from public,anon,authenticated;
revoke all on function app_private.actor_has_capability(uuid,public.cut2_capability,uuid,uuid,timestamptz),app_private.cut2_capability_grant_guard() from public,anon,authenticated;
revoke all on function public.cut2_has_capability(uuid,public.cut2_capability,timestamptz) from public,anon;
grant execute on function public.cut2_has_capability(uuid,public.cut2_capability,timestamptz) to authenticated;

-- C2 is selected by a scoped capability, never by the display role.  The
-- existing C2 function is retained below through its original business logic;
-- this guard is also used by release/reassignment/read models in CUT2-06.
create or replace function app_private.require_c2_capability(p_inventory_id uuid)
returns uuid language plpgsql stable security definer set search_path=public,app_private,pg_temp as $$
declare v_actor uuid:=app_private.require_active_actor();
begin
  if not app_private.actor_has_capability(v_actor,'RECOUNT_C2',p_inventory_id) then
    raise exception 'CAPABILITY_REQUIRED' using errcode='42501', detail='RECOUNT_C2';
  end if;
  return v_actor;
end;
$$;
revoke all on function app_private.require_c2_capability(uuid) from public,anon,authenticated;
