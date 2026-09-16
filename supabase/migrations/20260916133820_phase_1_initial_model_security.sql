create schema if not exists app_private;

create type public.inventory_status as enum ('BORRADOR', 'PREPARADO', 'ABIERTO', 'CERRADO', 'CONGELADO');
create type public.app_role as enum ('CONTADOR', 'ANALISTA', 'ADMIN');
create type public.master_control_type as enum ('SERIAL', 'PARTIDA', 'LEGACY');
create type public.device_platform as enum ('ANDROID', 'IOS', 'WEB');
create type public.cut_status as enum ('CREATING', 'SNAPSHOT_CREATED', 'FILE_GENERATED', 'VALIDATED', 'READY', 'ERROR');
create type public.generated_file_type as enum ('CUT_XLSX', 'RECTIFICATION_XLSX', 'SNAPSHOT', 'TECHNICAL_BACKUP');
create type public.audit_event_type as enum (
  'COUNT_CREATED', 'COUNT_SYNCED', 'COUNT_CORRECTED', 'COUNT_REJECTED',
  'CUT_CREATED', 'CUT_FILE_GENERATED', 'CUT_DOWNLOADED', 'RECTIFICATION_CREATED',
  'INVENTORY_OPENED', 'INVENTORY_CLOSED', 'INVENTORY_FROZEN',
  'MASTER_IMPORTED', 'MASTER_EXCEPTION_ADDED', 'INVENTORY_PREPARED'
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (length(btrim(display_name)) > 0),
  role public.app_role not null default 'CONTADOR',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inventories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  status public.inventory_status not null default 'BORRADOR',
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  prepared_at timestamptz,
  prepared_by uuid references public.profiles(user_id) on delete restrict,
  opened_at timestamptz,
  opened_by uuid references public.profiles(user_id) on delete restrict,
  closed_at timestamptz,
  closed_by uuid references public.profiles(user_id) on delete restrict,
  frozen_at timestamptz,
  frozen_by uuid references public.profiles(user_id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint inventories_lifecycle_timestamps check (
    (status = 'BORRADOR' and prepared_at is null and prepared_by is null and opened_at is null and opened_by is null and closed_at is null and closed_by is null and frozen_at is null and frozen_by is null)
    or (status = 'PREPARADO' and prepared_at is not null and prepared_by is not null and opened_at is null and opened_by is null and closed_at is null and closed_by is null and frozen_at is null and frozen_by is null)
    or (status = 'ABIERTO' and prepared_at is not null and prepared_by is not null and opened_at is not null and opened_by is not null and closed_at is null and closed_by is null and frozen_at is null and frozen_by is null)
    or (status = 'CERRADO' and prepared_at is not null and prepared_by is not null and opened_at is not null and opened_by is not null and closed_at is not null and closed_by is not null and frozen_at is null and frozen_by is null)
    or (status = 'CONGELADO' and prepared_at is not null and prepared_by is not null and opened_at is not null and opened_by is not null and closed_at is not null and closed_by is not null and frozen_at is not null and frozen_by is not null)
  )
);

create table public.inventory_assignments (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories(id) on delete restrict,
  user_id uuid not null references public.profiles(user_id) on delete restrict,
  active boolean not null default true,
  assigned_at timestamptz not null default now(),
  assigned_by uuid not null references public.profiles(user_id) on delete restrict,
  unique (inventory_id, user_id)
);

create table public.inventory_master_items (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories(id) on delete restrict,
  codigo text not null check (codigo = upper(codigo) and length(btrim(codigo)) > 0),
  descripcion text not null check (length(btrim(descripcion)) > 0),
  control_type public.master_control_type not null,
  source text not null check (length(btrim(source)) > 0),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  unique (inventory_id, codigo)
);

create table public.sync_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete restrict,
  platform public.device_platform not null,
  app_version text not null check (length(btrim(app_version)) > 0),
  device_label text not null check (length(btrim(device_label)) > 0),
  last_seen_at timestamptz,
  last_sync_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.inventory_cuts (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories(id) on delete restrict,
  cut_number integer not null check (cut_number > 0),
  status public.cut_status not null default 'CREATING',
  first_export_seq bigint,
  last_export_seq bigint,
  record_count integer not null default 0 check (record_count >= 0),
  file_name text,
  file_hash text check (file_hash is null or file_hash ~ '^[A-Fa-f0-9]{64}$'),
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inventory_id, cut_number),
  unique (id, inventory_id),
  check ((first_export_seq is null and last_export_seq is null) or (first_export_seq is not null and last_export_seq is not null and first_export_seq <= last_export_seq))
);

create table public.count_records (
  id uuid primary key default gen_random_uuid(),
  client_count_id uuid not null unique,
  inventory_id uuid not null references public.inventories(id) on delete restrict,
  user_id uuid not null references public.profiles(user_id) on delete restrict,
  device_id uuid not null references public.sync_devices(id) on delete restrict,
  ubicacion text not null,
  codigo text not null check (codigo = upper(codigo) and length(btrim(codigo)) > 0),
  serie text,
  partida text,
  pieza_producto text,
  fecha_vencimiento date,
  talla text,
  color text,
  cantidad_contada integer not null check (cantidad_contada > 0),
  descripcion text not null check (length(btrim(descripcion)) > 0),
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  cut_id uuid,
  export_seq bigint check (export_seq is null or export_seq > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (inventory_id, codigo) references public.inventory_master_items(inventory_id, codigo) on delete restrict,
  foreign key (device_id, user_id) references public.sync_devices(id, user_id) on delete restrict,
  foreign key (cut_id, inventory_id) references public.inventory_cuts(id, inventory_id) on delete restrict,
  unique (id, inventory_id),
  unique (id, cut_id, inventory_id),
  check ((cut_id is null and export_seq is null) or (cut_id is not null and export_seq is not null))
);
create unique index count_records_inventory_export_seq_unique on public.count_records (inventory_id, export_seq) where export_seq is not null;

create table public.count_revisions (
  id uuid primary key default gen_random_uuid(),
  count_record_id uuid not null references public.count_records(id) on delete restrict,
  revision_number integer not null check (revision_number > 0),
  old_values jsonb not null,
  new_values jsonb not null,
  reason text not null check (length(btrim(reason)) > 0),
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (count_record_id, revision_number)
);

create table public.inventory_cut_items (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null,
  cut_id uuid not null,
  count_record_id uuid not null references public.count_records(id) on delete restrict,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (count_record_id),
  unique (cut_id, count_record_id),
  foreign key (cut_id, inventory_id) references public.inventory_cuts(id, inventory_id) on delete restrict,
  foreign key (count_record_id, cut_id, inventory_id) references public.count_records(id, cut_id, inventory_id) on delete restrict
);

create table public.cut_rectifications (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories(id) on delete restrict,
  cut_id uuid not null,
  count_record_id uuid not null,
  rectification_number integer not null check (rectification_number > 0),
  old_values jsonb not null,
  new_values jsonb not null,
  reason text not null check (length(btrim(reason)) > 0),
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (cut_id, rectification_number),
  unique (id, inventory_id),
  foreign key (cut_id, inventory_id) references public.inventory_cuts(id, inventory_id) on delete restrict,
  foreign key (count_record_id, cut_id, inventory_id) references public.count_records(id, cut_id, inventory_id) on delete restrict
);

create table public.generated_files (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories(id) on delete restrict,
  cut_id uuid,
  rectification_id uuid,
  file_type public.generated_file_type not null,
  file_name text not null check (length(btrim(file_name)) > 0),
  storage_path text not null unique check (length(btrim(storage_path)) > 0),
  sha256 text not null check (sha256 ~ '^[A-Fa-f0-9]{64}$'),
  size_bytes bigint not null check (size_bytes >= 0),
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (cut_id, inventory_id) references public.inventory_cuts(id, inventory_id) on delete restrict,
  foreign key (rectification_id, inventory_id) references public.cut_rectifications(id, inventory_id) on delete restrict,
  check (
    (file_type = 'CUT_XLSX' and cut_id is not null and rectification_id is null)
    or (file_type = 'RECTIFICATION_XLSX' and cut_id is not null and rectification_id is not null)
    or (file_type in ('SNAPSHOT', 'TECHNICAL_BACKUP') and rectification_id is null)
  )
);

create table public.inventory_freeze_guards (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories(id) on delete restrict,
  device_id uuid not null references public.sync_devices(id) on delete restrict,
  pending_count integer not null check (pending_count > 0),
  reported_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index inventory_freeze_guards_one_open_per_device on public.inventory_freeze_guards (inventory_id, device_id) where resolved_at is null;

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid references public.inventories(id) on delete restrict,
  actor_user_id uuid references public.profiles(user_id) on delete restrict,
  device_id uuid references public.sync_devices(id) on delete restrict,
  event_type public.audit_event_type not null,
  entity_type text not null check (length(btrim(entity_type)) > 0),
  entity_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index inventory_assignments_active_user_idx on public.inventory_assignments (user_id, inventory_id) where active;
create index inventory_master_items_inventory_idx on public.inventory_master_items (inventory_id);
create index count_records_inventory_user_idx on public.count_records (inventory_id, user_id);
create index count_records_cut_idx on public.count_records (cut_id) where cut_id is not null;
create index audit_events_inventory_created_idx on public.audit_events (inventory_id, created_at desc);

create function public.set_updated_at() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger inventories_set_updated_at before update on public.inventories for each row execute function public.set_updated_at();
create trigger sync_devices_set_updated_at before update on public.sync_devices for each row execute function public.set_updated_at();
create trigger count_records_set_updated_at before update on public.count_records for each row execute function public.set_updated_at();
create trigger inventory_cuts_set_updated_at before update on public.inventory_cuts for each row execute function public.set_updated_at();

create function app_private.current_app_role() returns public.app_role language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.profiles where user_id = auth.uid() and active
$$;
create function app_private.is_admin() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select role = 'ADMIN' and active from public.profiles where user_id = auth.uid()), false)
$$;
create function app_private.is_analyst() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select role = 'ANALISTA' and active from public.profiles where user_id = auth.uid()), false)
$$;
create function app_private.can_access_inventory(target_inventory_id uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select app_private.is_admin() or exists (
    select 1 from public.inventory_assignments
    where inventory_id = target_inventory_id and user_id = auth.uid() and active
  )
$$;
create function app_private.can_manage_inventory(target_inventory_id uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select app_private.is_admin() or (app_private.is_analyst() and exists (
    select 1 from public.inventory_assignments
    where inventory_id = target_inventory_id and user_id = auth.uid() and active
  ))
$$;

alter table public.profiles enable row level security;
alter table public.inventories enable row level security;
alter table public.inventory_assignments enable row level security;
alter table public.inventory_master_items enable row level security;
alter table public.sync_devices enable row level security;
alter table public.count_records enable row level security;
alter table public.count_revisions enable row level security;
alter table public.inventory_cuts enable row level security;
alter table public.inventory_cut_items enable row level security;
alter table public.cut_rectifications enable row level security;
alter table public.generated_files enable row level security;
alter table public.inventory_freeze_guards enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_select_own_or_admin on public.profiles for select to authenticated using (user_id = (select auth.uid()) or (select app_private.is_admin()));
create policy profiles_manage_admin on public.profiles for all to authenticated using ((select app_private.is_admin())) with check ((select app_private.is_admin()));
create policy inventories_select_accessible on public.inventories for select to authenticated using ((select app_private.can_access_inventory(id)));
create policy inventories_create_admin_draft on public.inventories for insert to authenticated with check ((select app_private.is_admin()) and status = 'BORRADOR' and created_by = (select auth.uid()));
create policy assignments_select_accessible on public.inventory_assignments for select to authenticated using (user_id = (select auth.uid()) or (select app_private.can_manage_inventory(inventory_id)));
create policy assignments_manage_admin on public.inventory_assignments for all to authenticated using ((select app_private.is_admin())) with check ((select app_private.is_admin()));
create policy master_select_accessible on public.inventory_master_items for select to authenticated using ((select app_private.can_access_inventory(inventory_id)));
create policy master_manage_admin on public.inventory_master_items for all to authenticated using ((select app_private.is_admin())) with check ((select app_private.is_admin()));
create policy devices_select_own_or_manager on public.sync_devices for select to authenticated using (user_id = (select auth.uid()) or (select app_private.is_admin()) or exists (select 1 from public.inventory_assignments a where a.user_id = sync_devices.user_id and a.active and app_private.can_manage_inventory(a.inventory_id)));
create policy devices_insert_own on public.sync_devices for insert to authenticated with check (user_id = (select auth.uid()));
create policy devices_update_own on public.sync_devices for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy counts_select_own_or_manager on public.count_records for select to authenticated using (user_id = (select auth.uid()) or (select app_private.can_manage_inventory(inventory_id)));
create policy revisions_select_own_or_manager on public.count_revisions for select to authenticated using (exists (select 1 from public.count_records c where c.id = count_record_id and (c.user_id = (select auth.uid()) or app_private.can_manage_inventory(c.inventory_id))));
create policy cuts_select_manager on public.inventory_cuts for select to authenticated using ((select app_private.can_manage_inventory(inventory_id)));
create policy cut_items_select_manager on public.inventory_cut_items for select to authenticated using (exists (select 1 from public.inventory_cuts c where c.id = cut_id and app_private.can_manage_inventory(c.inventory_id)));
create policy rectifications_select_manager on public.cut_rectifications for select to authenticated using ((select app_private.can_manage_inventory(inventory_id)));
create policy files_select_manager on public.generated_files for select to authenticated using ((select app_private.can_manage_inventory(inventory_id)));
create policy freeze_guards_select_manager on public.inventory_freeze_guards for select to authenticated using ((select app_private.can_manage_inventory(inventory_id)));
create policy audit_select_manager on public.audit_events for select to authenticated using (inventory_id is not null and (select app_private.can_manage_inventory(inventory_id)));

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from public, anon;
grant usage on schema public to authenticated;
grant select, insert on public.inventories to authenticated;
grant select, insert, update on public.profiles, public.inventory_assignments, public.inventory_master_items to authenticated;
grant select on public.count_revisions, public.inventory_cuts, public.inventory_cut_items, public.cut_rectifications, public.generated_files, public.inventory_freeze_guards, public.audit_events to authenticated;
grant select, insert, update on public.sync_devices to authenticated;
grant select on public.count_records to authenticated;

create function app_private.transition_inventory(target_inventory_id uuid, expected_status public.inventory_status, next_status public.inventory_status, audit_type public.audit_event_type)
returns public.inventories language plpgsql security definer set search_path = public, app_private, pg_temp as $$
declare actor_id uuid := auth.uid(); updated_inventory public.inventories;
begin
  if actor_id is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if not app_private.can_manage_inventory(target_inventory_id) then raise exception 'Not authorized to manage inventory' using errcode = '42501'; end if;
  select * into updated_inventory from public.inventories where id = target_inventory_id for update;
  if not found then raise exception 'Inventory not found' using errcode = 'P0002'; end if;
  if updated_inventory.status <> expected_status then raise exception 'Invalid inventory transition from % to %', updated_inventory.status, next_status using errcode = '23514'; end if;
  update public.inventories set
    status = next_status,
    prepared_at = case when next_status = 'PREPARADO' then now() else prepared_at end,
    prepared_by = case when next_status = 'PREPARADO' then actor_id else prepared_by end,
    opened_at = case when next_status = 'ABIERTO' then now() else opened_at end,
    opened_by = case when next_status = 'ABIERTO' then actor_id else opened_by end,
    closed_at = case when next_status = 'CERRADO' then now() else closed_at end,
    closed_by = case when next_status = 'CERRADO' then actor_id else closed_by end,
    frozen_at = case when next_status = 'CONGELADO' then now() else frozen_at end,
    frozen_by = case when next_status = 'CONGELADO' then actor_id else frozen_by end
  where id = target_inventory_id returning * into updated_inventory;
  insert into public.audit_events (inventory_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (target_inventory_id, actor_id, audit_type, 'inventory', target_inventory_id, jsonb_build_object('from_status', expected_status, 'to_status', next_status));
  return updated_inventory;
end;
$$;

create function public.prepare_inventory(target_inventory_id uuid) returns public.inventories language sql security definer set search_path = public, app_private, pg_temp as $$
  select app_private.transition_inventory(target_inventory_id, 'BORRADOR', 'PREPARADO', 'INVENTORY_PREPARED')
$$;
create function public.open_inventory(target_inventory_id uuid) returns public.inventories language sql security definer set search_path = public, app_private, pg_temp as $$
  select app_private.transition_inventory(target_inventory_id, 'PREPARADO', 'ABIERTO', 'INVENTORY_OPENED')
$$;
create function public.close_inventory(target_inventory_id uuid) returns public.inventories language sql security definer set search_path = public, app_private, pg_temp as $$
  select app_private.transition_inventory(target_inventory_id, 'ABIERTO', 'CERRADO', 'INVENTORY_CLOSED')
$$;
create function public.freeze_inventory(target_inventory_id uuid) returns public.inventories language plpgsql security definer set search_path = public, app_private, pg_temp as $$
begin
  if exists (select 1 from public.inventory_freeze_guards where inventory_id = target_inventory_id and resolved_at is null) then
    raise exception 'Inventory has known pending synchronization records' using errcode = '23514';
  end if;
  return app_private.transition_inventory(target_inventory_id, 'CERRADO', 'CONGELADO', 'INVENTORY_FROZEN');
end;
$$;

revoke all on schema app_private from public, anon, authenticated;
revoke all on function app_private.transition_inventory(uuid, public.inventory_status, public.inventory_status, public.audit_event_type) from public;
revoke all on function public.prepare_inventory(uuid), public.open_inventory(uuid), public.close_inventory(uuid), public.freeze_inventory(uuid) from public;
grant execute on function public.prepare_inventory(uuid), public.open_inventory(uuid), public.close_inventory(uuid), public.freeze_inventory(uuid) to authenticated;
