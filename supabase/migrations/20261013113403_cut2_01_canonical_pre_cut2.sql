-- CUT2-01 V2.3 · Canonical local model.  This migration is deliberately
-- additive: legacy cuts continue to use their existing snapshot flow until
-- CUT2-03 explicitly introduces rolling sealing.

create type public.cut2_reference_state as enum (
  'SEALING', 'SEALED', 'ORPHANED', 'FAILED_SAFE', 'EXCLUDED', 'HELD'
);
create type public.cut2_tolerance_state as enum (
  'NOT_REQUIRED', 'PENDING_DECISION', 'RP_READY_WITH_TOLERANCE',
  'HELD_PENDING_DECISION', 'DECIDED'
);
create type public.cut2_tolerance_decision as enum (
  'EXPORT_COUNTED', 'EXPORT_SYSTEM', 'EXCLUDE_FROM_RP', 'RECOUNT_REQUIRED'
);
create type public.cut2_finding_type as enum (
  'PHYSICAL_MISMATCH', 'SERIAL_FOUND_AFTER_SEAL', 'BATCH_FOUND_AFTER_SEAL',
  'ADDITIONAL_QUANTITY_FOUND', 'RISK_NEGATIVE_BALANCE', 'UOM_MISMATCH',
  'DUPLICATE_SERIAL', 'MASTER_DATA_FINDING', 'PENDING_EVIDENCE',
  'ZONE_OVERLAP_CONFLICT', 'ORPHAN_REFERENCE_UNRESOLVED', 'INTEGRITY_FAILURE',
  'NEW_LOCATION_FOUND', 'OTHER'
);
create type public.cut2_finding_state as enum ('OPEN', 'HELD', 'RESOLVED', 'DISCARDED');
create type public.cut2_orphan_state as enum ('OPEN', 'ADD_TO_MASTER', 'EXCLUDE_FROM_INVENTORY', 'HOLD_UNTIL_RESOLVED', 'RESOLVED');
create type public.cut2_user_type as enum ('PERMANENT', 'CONTRACTOR_3PL', 'TEMPORARY', 'EXTERNAL_AUDITOR');
create type public.cut2_capability_scope as enum ('WAREHOUSE', 'INVENTORY', 'GLOBAL');
create type public.cut2_capability as enum (
  'COUNT_C1', 'RECOUNT_C2', 'RECOUNT_C3', 'MANAGE_RECONCILIATION',
  'EXCLUDE_RP', 'CLOSE_INVENTORY', 'VIEW_INDIVIDUAL_METRICS', 'READ_ONLY_AUDIT'
);
create type public.cut2_cut_mode as enum ('LEGACY_SNAPSHOT', 'ROLLING_REFERENCE');
create type public.cut2_release_state as enum ('DRAFT', 'READY', 'SUPERSEDED', 'BLOCKED', 'INTEGRITY_FAILURE');
create type public.cut2_close_request_state as enum ('REQUESTED', 'RUNNING', 'COMPLETED', 'FAILED_SAFE');
create type public.cut2_backup_state as enum ('PENDING', 'VALIDATED', 'FAILED');

-- Operational calendars are independent from a warehouse so a policy can be
-- versioned and reused.  The UTC instants are converted into this timezone
-- when calculating SLA minutes, which naturally accounts for DST.
create table public.operational_hours (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(btrim(code)) and length(btrim(code)) between 2 and 64),
  timezone text not null check (length(btrim(timezone)) between 1 and 64),
  is_24x7 boolean not null default false,
  version integer not null default 1 check (version > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.operational_hour_shifts (
  id uuid primary key default gen_random_uuid(),
  operational_hours_id uuid not null references public.operational_hours(id) on delete restrict,
  code text not null check (code = upper(btrim(code)) and length(btrim(code)) between 2 and 64),
  day_of_week smallint not null check (day_of_week between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  created_at timestamptz not null default now(),
  unique (operational_hours_id, code, day_of_week)
);

create table public.operational_hour_breaks (
  id uuid primary key default gen_random_uuid(),
  operational_hours_id uuid not null references public.operational_hours(id) on delete restrict,
  day_of_week smallint check (day_of_week between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  counts_as_operational boolean not null default false,
  created_at timestamptz not null default now(),
  check (starts_at <> ends_at)
);

create table public.operational_holidays (
  id uuid primary key default gen_random_uuid(),
  operational_hours_id uuid not null references public.operational_hours(id) on delete restrict,
  holiday_date date not null,
  label text not null check (length(btrim(label)) between 1 and 160),
  created_at timestamptz not null default now(),
  unique (operational_hours_id, holiday_date)
);

insert into public.operational_hours (id, code, timezone, is_24x7, version)
values ('00000000-0000-0000-0000-00000000c201', 'LEGACY_CL_STANDARD', 'America/Santiago', true, 1);

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(btrim(code)) and length(btrim(code)) between 2 and 64),
  name text not null check (length(btrim(name)) between 1 and 160),
  timezone text not null check (length(btrim(timezone)) between 1 and 64),
  operational_hours_id uuid not null references public.operational_hours(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.warehouses (id, code, name, timezone, operational_hours_id)
values ('00000000-0000-0000-0000-00000000c202', 'LEGACY-QA', 'Bodega heredada QA/local', 'America/Santiago', '00000000-0000-0000-0000-00000000c201');

alter table public.inventories
  add column warehouse_id uuid references public.warehouses(id) on delete restrict,
  add column close_request_id uuid,
  add column cut2_algorithm_version text not null default 'LEGACY_V1' check (length(btrim(cut2_algorithm_version)) between 1 and 64),
  add column cut2_merkle_root text check (cut2_merkle_root is null or cut2_merkle_root ~ '^[A-Fa-f0-9]{64}$');
update public.inventories set warehouse_id = '00000000-0000-0000-0000-00000000c202' where warehouse_id is null;
alter table public.inventories alter column warehouse_id set default '00000000-0000-0000-0000-00000000c202'::uuid;
alter table public.inventories alter column warehouse_id set not null;
alter table public.inventories add constraint inventories_id_warehouse_unique unique (id, warehouse_id);
create index inventories_warehouse_status_idx on public.inventories (warehouse_id, status, created_at desc);

-- All legacy cut records are explicitly marked as such.  Their semantics and
-- sources remain unchanged; future rolling references use separate tables.
alter table public.inventory_cuts
  add column cut_mode public.cut2_cut_mode not null default 'LEGACY_SNAPSHOT',
  add column algorithm_version text not null default 'LEGACY_V1' check (length(btrim(algorithm_version)) between 1 and 64),
  add column merkle_root text check (merkle_root is null or merkle_root ~ '^[A-Fa-f0-9]{64}$');

create or replace function public.normalize_reference_key(
  p_reference_type public.master_control_type,
  p_codigo text,
  p_reference_value text default null
)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_code text := upper(btrim(normalize(coalesce(p_codigo, ''), NFC)));
  v_value text := upper(btrim(normalize(coalesce(p_reference_value, ''), NFC)));
  v_key text;
begin
  if v_code = '' then raise exception 'Reference SKU is required' using errcode = '23514'; end if;
  if position('::' in v_code) > 0 or position('::' in v_value) > 0 then
    raise exception 'Reference fields cannot contain ::' using errcode = '23514';
  end if;
  if p_reference_type = 'LEGACY' then
    v_key := v_code;
  elsif p_reference_type in ('PARTIDA', 'SERIAL') then
    if v_value = '' then raise exception 'PARTIDA/SERIAL reference value is required' using errcode = '23514'; end if;
    v_key := v_code || '::' || v_value;
  else
    raise exception 'Unsupported reference type' using errcode = '23514';
  end if;
  if length(v_key) > 512 then raise exception 'normalized_reference_key exceeds 512 characters' using errcode = '23514'; end if;
  return v_key;
end;
$$;

create table public.inventory_sealed_references (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null,
  warehouse_id uuid not null,
  reference_type public.master_control_type not null,
  codigo text not null check (codigo = upper(btrim(codigo)) and length(btrim(codigo)) > 0),
  reference_value text,
  normalized_reference_key text not null check (length(normalized_reference_key) between 1 and 512),
  state public.cut2_reference_state not null default 'SEALING',
  request_id uuid not null,
  physical_quantity integer check (physical_quantity is null or physical_quantity >= 0),
  source_count integer not null default 0 check (source_count >= 0),
  source_merkle_root text check (source_merkle_root is null or source_merkle_root ~ '^[A-Fa-f0-9]{64}$'),
  algorithm_version text not null default 'CUT2_V2_3' check (length(btrim(algorithm_version)) between 1 and 64),
  sealed_at timestamptz,
  sealed_by uuid references public.profiles(user_id) on delete restrict,
  superseded_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inventory_id, warehouse_id, reference_type, normalized_reference_key),
  unique (inventory_id, request_id),
  foreign key (inventory_id, warehouse_id) references public.inventories(id, warehouse_id) on delete restrict,
  check (
    (reference_type = 'LEGACY' and reference_value is null and normalized_reference_key = public.normalize_reference_key(reference_type, codigo, null))
    or (reference_type in ('PARTIDA', 'SERIAL') and reference_value is not null and normalized_reference_key = public.normalize_reference_key(reference_type, codigo, reference_value))
  ),
  check ((state = 'SEALED' and sealed_at is not null and sealed_by is not null) or state <> 'SEALED')
);
alter table public.inventory_sealed_references
  add constraint inventory_sealed_references_superseded_fk
  foreign key (superseded_by) references public.inventory_sealed_references(id) on delete restrict;
create index inventory_sealed_references_inventory_state_idx on public.inventory_sealed_references (inventory_id, warehouse_id, state, created_at desc);

create table public.count_zone_assignments (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null,
  warehouse_id uuid not null,
  zone_code text not null check (zone_code = upper(btrim(zone_code)) and length(btrim(zone_code)) between 1 and 80),
  assigned_user_id uuid references public.profiles(user_id) on delete restrict,
  active boolean not null default true,
  assigned_by uuid not null references public.profiles(user_id) on delete restrict,
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  foreign key (inventory_id, warehouse_id) references public.inventories(id, warehouse_id) on delete restrict,
  check ((active and released_at is null) or (not active and released_at is not null))
);
create unique index count_zone_assignments_active_exact_unique on public.count_zone_assignments (inventory_id, warehouse_id, zone_code) where active;

create or replace function app_private.assert_no_active_zone_overlap()
returns trigger
language plpgsql
set search_path = public, app_private, pg_temp
as $$
begin
  if new.active and exists (
    select 1 from public.count_zone_assignments z
    where z.inventory_id = new.inventory_id
      and z.warehouse_id = new.warehouse_id
      and z.active
      and z.id <> new.id
      and (new.zone_code like z.zone_code || '-%' or z.zone_code like new.zone_code || '-%' or z.zone_code = new.zone_code)
  ) then
    raise exception 'ZONE_OVERLAP_CONFLICT' using errcode = '23P01';
  end if;
  return new;
end;
$$;
create trigger count_zone_assignments_no_overlap
before insert or update of inventory_id, warehouse_id, zone_code, active on public.count_zone_assignments
for each row execute function app_private.assert_no_active_zone_overlap();

create table public.inventory_location_state (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null,
  warehouse_id uuid not null,
  location_code text not null check (location_code = upper(btrim(location_code)) and length(btrim(location_code)) between 1 and 80),
  frozen_at timestamptz,
  frozen_by uuid references public.profiles(user_id) on delete restrict,
  freeze_reason text,
  state_version integer not null default 1 check (state_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inventory_id, warehouse_id, location_code),
  foreign key (inventory_id, warehouse_id) references public.inventories(id, warehouse_id) on delete restrict,
  check ((frozen_at is null and frozen_by is null and freeze_reason is null) or (frozen_at is not null and frozen_by is not null and length(btrim(freeze_reason)) > 0))
);

create table public.inventory_movement_taxonomy (
  code text primary key check (code = upper(btrim(code)) and length(btrim(code)) between 2 and 64),
  label text not null check (length(btrim(label)) between 1 and 160),
  affects_identity boolean not null default false,
  affects_quantity boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.inventory_movement_taxonomy (code, label, affects_identity, affects_quantity) values
  ('RELOCATION', 'Cambio de ubicación', false, false),
  ('RECEIPT', 'Recepción', true, true),
  ('DISPATCH', 'Despacho', true, true),
  ('ADJUSTMENT', 'Ajuste controlado', true, true),
  ('QUARANTINE', 'Cuarentena', true, false);

create table public.inventory_movement_events (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null,
  warehouse_id uuid not null,
  reference_id uuid references public.inventory_sealed_references(id) on delete restrict,
  movement_code text not null references public.inventory_movement_taxonomy(code) on delete restrict,
  quantity_delta integer,
  from_location text,
  to_location text,
  evidence jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (inventory_id, warehouse_id) references public.inventories(id, warehouse_id) on delete restrict,
  check (quantity_delta is null or quantity_delta <> 0)
);

create table public.tolerance_policies (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null,
  warehouse_id uuid not null,
  allowed_absolute_difference integer not null default 0 check (allowed_absolute_difference >= 0),
  decision_sla_operational_minutes integer not null default 1440 check (decision_sla_operational_minutes > 0),
  block_export_by_default boolean not null default true,
  policy_snapshot jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (inventory_id, warehouse_id) references public.inventories(id, warehouse_id) on delete restrict
);
create unique index tolerance_policies_one_active_per_inventory on public.tolerance_policies (inventory_id, warehouse_id) where active;

create table public.reference_tolerance_decisions (
  id uuid primary key default gen_random_uuid(),
  reference_id uuid not null references public.inventory_sealed_references(id) on delete restrict,
  policy_id uuid not null references public.tolerance_policies(id) on delete restrict,
  state public.cut2_tolerance_state not null default 'PENDING_DECISION',
  decision public.cut2_tolerance_decision,
  counted_quantity integer not null check (counted_quantity >= 0),
  system_quantity integer not null check (system_quantity >= 0),
  exported_quantity integer check (exported_quantity is null or exported_quantity >= 0),
  reason text,
  policy_snapshot jsonb not null default '{}'::jsonb,
  due_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reference_id),
  check ((decision is null and decided_at is null and decided_by is null) or (decision is not null and decided_at is not null and decided_by is not null)),
  check ((decision = 'EXPORT_COUNTED' and exported_quantity = counted_quantity) or (decision = 'EXPORT_SYSTEM' and exported_quantity = system_quantity) or (decision in ('EXCLUDE_FROM_RP', 'RECOUNT_REQUIRED') and exported_quantity is null) or decision is null)
);

create table public.inventory_priority_policies (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null,
  warehouse_id uuid not null,
  max_critical_ratio numeric(6,5) not null default 0.05000 check (max_critical_ratio >= 0 and max_critical_ratio <= 1),
  denominator_scope text not null default 'SEALED_REFERENCES_IN_INVENTORY' check (denominator_scope = 'SEALED_REFERENCES_IN_INVENTORY'),
  temporary_exceedance_reason text,
  temporary_exceedance_expires_at timestamptz,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (inventory_id, warehouse_id),
  foreign key (inventory_id, warehouse_id) references public.inventories(id, warehouse_id) on delete restrict,
  check ((temporary_exceedance_reason is null and temporary_exceedance_expires_at is null) or (length(btrim(temporary_exceedance_reason)) > 0 and temporary_exceedance_expires_at > created_at))
);

create table public.reference_criticality (
  id uuid primary key default gen_random_uuid(),
  reference_id uuid not null unique references public.inventory_sealed_references(id) on delete restrict,
  is_critical boolean not null default false,
  reason text,
  decided_by uuid not null references public.profiles(user_id) on delete restrict,
  decided_at timestamptz not null default now(),
  expires_at timestamptz,
  check ((is_critical and length(btrim(coalesce(reason, ''))) > 0) or not is_critical)
);

create table public.reference_findings (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null,
  warehouse_id uuid not null,
  reference_id uuid references public.inventory_sealed_references(id) on delete restrict,
  finding_type public.cut2_finding_type not null,
  state public.cut2_finding_state not null default 'OPEN',
  critical boolean not null default true,
  description text not null check (length(btrim(description)) between 1 and 4000),
  due_at timestamptz,
  resolved_by uuid references public.profiles(user_id) on delete restrict,
  resolved_at timestamptz,
  resolution text,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (inventory_id, warehouse_id) references public.inventories(id, warehouse_id) on delete restrict,
  check ((state = 'RESOLVED' and resolved_at is not null and resolved_by is not null and length(btrim(coalesce(resolution, ''))) > 0) or state <> 'RESOLVED')
);
create index reference_findings_blocking_idx on public.reference_findings (inventory_id, warehouse_id, state, critical) where state in ('OPEN', 'HELD');

create table public.finding_evidence (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.reference_findings(id) on delete restrict,
  storage_path text,
  sha256 text check (sha256 is null or sha256 ~ '^[A-Fa-f0-9]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  captured_by uuid not null references public.profiles(user_id) on delete restrict,
  captured_at timestamptz not null default now(),
  check (storage_path is not null or metadata <> '{}'::jsonb)
);

create table public.orphan_references (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null,
  warehouse_id uuid not null,
  codigo text not null check (codigo = upper(btrim(codigo)) and length(btrim(codigo)) > 0),
  reference_type public.master_control_type not null,
  reference_value text,
  normalized_reference_key text not null check (length(normalized_reference_key) between 1 and 512),
  state public.cut2_orphan_state not null default 'OPEN',
  first_observed_at timestamptz not null default now(),
  due_at timestamptz,
  resolved_by uuid references public.profiles(user_id) on delete restrict,
  resolved_at timestamptz,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  unique (inventory_id, warehouse_id, reference_type, normalized_reference_key),
  foreign key (inventory_id, warehouse_id) references public.inventories(id, warehouse_id) on delete restrict,
  check ((reference_type = 'LEGACY' and reference_value is null) or (reference_type in ('PARTIDA', 'SERIAL') and nullif(btrim(reference_value), '') is not null))
);

create table public.uom_conversion_factors (
  id uuid primary key default gen_random_uuid(),
  from_uom text not null check (from_uom = upper(btrim(from_uom)) and length(btrim(from_uom)) between 1 and 32),
  to_uom text not null check (to_uom = upper(btrim(to_uom)) and length(btrim(to_uom)) between 1 and 32),
  factor numeric(20,8) not null check (factor > 0),
  active boolean not null default true,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (from_uom, to_uom, valid_from),
  check (from_uom <> to_uom),
  check (valid_until is null or valid_until > valid_from)
);

create table public.uom_resolution_cases (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null,
  warehouse_id uuid not null,
  reference_id uuid references public.inventory_sealed_references(id) on delete restrict,
  source_uom text not null check (source_uom = upper(btrim(source_uom)) and length(btrim(source_uom)) between 1 and 32),
  target_uom text not null check (target_uom = upper(btrim(target_uom)) and length(btrim(target_uom)) between 1 and 32),
  state text not null default 'OPEN' check (state in ('OPEN', 'RESOLVED', 'HELD')),
  resolved_factor_id uuid references public.uom_conversion_factors(id) on delete restrict,
  resolved_by uuid references public.profiles(user_id) on delete restrict,
  resolved_at timestamptz,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (inventory_id, warehouse_id) references public.inventories(id, warehouse_id) on delete restrict,
  check ((state = 'RESOLVED' and resolved_factor_id is not null and resolved_by is not null and resolved_at is not null) or state <> 'RESOLVED')
);

alter table public.profiles add column user_type public.cut2_user_type not null default 'PERMANENT';
alter table public.inventory_assignments
  add column valid_from timestamptz not null default now(),
  add column valid_until timestamptz,
  add column capability_scope public.cut2_capability_scope not null default 'INVENTORY';
alter table public.inventory_assignments add constraint inventory_assignments_validity_check check (valid_until is null or valid_until > valid_from);

create table public.inventory_capability_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete restrict,
  capability public.cut2_capability not null,
  scope public.cut2_capability_scope not null,
  warehouse_id uuid references public.warehouses(id) on delete restrict,
  inventory_id uuid references public.inventories(id) on delete restrict,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  granted_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  check (valid_until is null or valid_until > valid_from),
  check ((scope = 'GLOBAL' and warehouse_id is null and inventory_id is null) or (scope = 'WAREHOUSE' and warehouse_id is not null and inventory_id is null) or (scope = 'INVENTORY' and inventory_id is not null))
);
create unique index inventory_capability_grants_active_unique on public.inventory_capability_grants (user_id, capability, scope, coalesce(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(inventory_id, '00000000-0000-0000-0000-000000000000'::uuid), valid_from);

create or replace function public.cut2_has_capability(
  p_inventory_id uuid,
  p_capability public.cut2_capability,
  p_at timestamptz default now()
)
returns boolean
language sql
stable
security definer
set search_path = public, app_private, pg_temp
as $$
  with actor as (
    select p.user_id, p.role, p.user_type, i.warehouse_id
    from public.profiles p
    join public.inventories i on i.id = p_inventory_id
    where p.user_id = auth.uid() and p.active
      and (
        p.role = 'ADMIN'
        or exists (
          select 1 from public.inventory_assignments a
          where a.inventory_id = i.id
            and a.user_id = p.user_id
            and a.active
            and a.valid_from <= p_at
            and (a.valid_until is null or a.valid_until > p_at)
        )
      )
  ), baseline as (
    select case
      when user_type = 'EXTERNAL_AUDITOR' then p_capability = 'READ_ONLY_AUDIT'
      when user_type = 'TEMPORARY' then p_capability = 'COUNT_C1'
      when user_type = 'CONTRACTOR_3PL' then p_capability in ('COUNT_C1', 'RECOUNT_C2')
      when role = 'ADMIN' then true
      when role = 'ANALISTA' then p_capability in ('COUNT_C1', 'RECOUNT_C2', 'RECOUNT_C3', 'MANAGE_RECONCILIATION', 'VIEW_INDIVIDUAL_METRICS', 'READ_ONLY_AUDIT')
      else p_capability in ('COUNT_C1', 'RECOUNT_C2')
    end allowed, user_id, warehouse_id from actor
  )
  select coalesce((select allowed from baseline), false)
    and (
      exists (select 1 from actor a where a.user_type <> 'PERMANENT')
      or exists (select 1 from baseline b where true)
    )
$$;

create table public.rp_release_batches (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null,
  warehouse_id uuid not null,
  previous_release_id uuid,
  state public.cut2_release_state not null default 'DRAFT',
  algorithm_version text not null default 'CUT2_V2_3' check (length(btrim(algorithm_version)) between 1 and 64),
  policy_snapshot jsonb not null default '{}'::jsonb,
  xlsx_file_name text,
  xlsx_storage_path text unique,
  xlsx_sha256 text check (xlsx_sha256 is null or xlsx_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  xlsx_size_bytes bigint check (xlsx_size_bytes is null or xlsx_size_bytes >= 0),
  sidecar_storage_path text unique,
  sidecar_sha256 text check (sidecar_sha256 is null or sidecar_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (inventory_id, warehouse_id, id),
  unique (id, inventory_id, warehouse_id),
  foreign key (inventory_id, warehouse_id) references public.inventories(id, warehouse_id) on delete restrict,
  check ((state = 'READY' and xlsx_file_name is not null and xlsx_storage_path is not null and xlsx_sha256 is not null and xlsx_size_bytes is not null and sidecar_storage_path is not null and sidecar_sha256 is not null) or state <> 'READY')
);
alter table public.rp_release_batches add constraint rp_release_batches_previous_fk foreign key (previous_release_id) references public.rp_release_batches(id) on delete restrict;

create table public.rp_release_audits (
  release_id uuid primary key references public.rp_release_batches(id) on delete restrict,
  schema_version text not null default '1.0' check (schema_version = '1.0'),
  inventory_id uuid not null,
  warehouse_id uuid not null,
  cut_ids uuid[] not null default '{}'::uuid[],
  previous_release_id uuid,
  reference_count integer not null check (reference_count >= 0),
  references_snapshot jsonb not null default '[]'::jsonb,
  tolerance_decisions jsonb not null default '[]'::jsonb,
  discarded_references jsonb not null default '[]'::jsonb,
  critical_findings_snapshot jsonb not null default '[]'::jsonb,
  policy_snapshot jsonb not null default '{}'::jsonb,
  release_fingerprint text not null check (release_fingerprint ~ '^[A-Fa-f0-9]{64}$'),
  xlsx_file_name text not null check (length(btrim(xlsx_file_name)) > 0),
  xlsx_sha256 text not null check (xlsx_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  xlsx_size_bytes bigint not null check (xlsx_size_bytes >= 0),
  sidecar_sha256 text not null check (sidecar_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  algorithm_version text not null check (length(btrim(algorithm_version)) between 1 and 64),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  foreign key (inventory_id, warehouse_id) references public.inventories(id, warehouse_id) on delete restrict,
  foreign key (release_id, inventory_id, warehouse_id) references public.rp_release_batches(id, inventory_id, warehouse_id) on delete restrict
);

create table public.rp_release_discards (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.rp_release_batches(id) on delete restrict,
  reference_id uuid not null references public.inventory_sealed_references(id) on delete restrict,
  reason text not null check (length(btrim(reason)) >= 100),
  backup_manifest jsonb not null default '{}'::jsonb,
  notified_accounting_at timestamptz,
  notified_audit_at timestamptz,
  discarded_by uuid not null references public.profiles(user_id) on delete restrict,
  discarded_at timestamptz not null default now(),
  unique (release_id, reference_id)
);

create table public.rp_release_rectifications (
  id uuid primary key default gen_random_uuid(),
  original_release_id uuid not null references public.rp_release_batches(id) on delete restrict,
  superseding_release_id uuid references public.rp_release_batches(id) on delete restrict,
  reason text not null check (length(btrim(reason)) > 0),
  notified_accounting_at timestamptz,
  notified_audit_at timestamptz,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (original_release_id)
);

create table public.inventory_close_requests (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories(id) on delete restrict,
  request_id uuid not null,
  state public.cut2_close_request_state not null default 'REQUESTED',
  started_by uuid not null references public.profiles(user_id) on delete restrict,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  unique (inventory_id, request_id),
  check ((state in ('COMPLETED', 'FAILED_SAFE') and completed_at is not null) or state in ('REQUESTED', 'RUNNING'))
);
create unique index inventory_close_requests_one_active on public.inventory_close_requests (inventory_id) where state in ('REQUESTED', 'RUNNING');
alter table public.inventories add constraint inventories_close_request_fk foreign key (close_request_id) references public.inventory_close_requests(id) on delete restrict;

create table public.inventory_close_backups (
  id uuid primary key default gen_random_uuid(),
  close_request_id uuid not null unique references public.inventory_close_requests(id) on delete restrict,
  storage_path text not null unique check (length(btrim(storage_path)) > 0),
  format text not null default 'PG_DUMP_CUSTOM' check (format = 'PG_DUMP_CUSTOM'),
  sha256 text not null check (sha256 ~ '^[A-Fa-f0-9]{64}$'),
  size_bytes bigint not null check (size_bytes > 0),
  row_counts jsonb not null default '{}'::jsonb,
  manifest jsonb not null default '{}'::jsonb,
  state public.cut2_backup_state not null default 'PENDING',
  validated_at timestamptz,
  validation_error text,
  created_at timestamptz not null default now(),
  check ((state = 'VALIDATED' and validated_at is not null) or state <> 'VALIDATED')
);

create table public.notification_policies (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  silent_starts_at time not null default '22:00',
  silent_ends_at time not null default '07:00',
  queue_for_morning boolean not null default true,
  urgent_critical_override boolean not null default true,
  active boolean not null default true,
  created_by uuid references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (warehouse_id, active),
  check (silent_starts_at <> silent_ends_at)
);

create or replace function public.operational_minutes_between(
  p_operational_hours_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns integer
language plpgsql
stable
security definer
set search_path = public, app_private, pg_temp
as $$
declare v_calendar public.operational_hours;
begin
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then return 0; end if;
  select * into v_calendar from public.operational_hours where id = p_operational_hours_id;
  if not found then raise exception 'Operational calendar not found' using errcode = 'P0002'; end if;
  return (
    with minutes as (
      select moment, timezone(v_calendar.timezone, moment) as local_moment
      from generate_series(p_starts_at, p_ends_at - interval '1 minute', interval '1 minute') moment
    )
    select count(*)::integer
    from minutes m
    where not exists (select 1 from public.operational_holidays h where h.operational_hours_id = v_calendar.id and h.holiday_date = m.local_moment::date)
      and (
        v_calendar.is_24x7 or exists (
          select 1 from public.operational_hour_shifts s
          where s.operational_hours_id = v_calendar.id
            and s.day_of_week = extract(dow from m.local_moment)::smallint
            and ((s.starts_at < s.ends_at and m.local_moment::time >= s.starts_at and m.local_moment::time < s.ends_at)
              or (s.starts_at > s.ends_at and (m.local_moment::time >= s.starts_at or m.local_moment::time < s.ends_at)))
        )
      )
      and not exists (
        select 1 from public.operational_hour_breaks b
        where b.operational_hours_id = v_calendar.id
          and b.counts_as_operational = false
          and (b.day_of_week is null or b.day_of_week = extract(dow from m.local_moment)::smallint)
          and ((b.starts_at < b.ends_at and m.local_moment::time >= b.starts_at and m.local_moment::time < b.ends_at)
            or (b.starts_at > b.ends_at and (m.local_moment::time >= b.starts_at or m.local_moment::time < b.ends_at)))
      )
  );
end;
$$;

create or replace function public.validate_inventory_close_backup(p_close_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app_private, pg_temp
as $$
  select exists (
    select 1 from public.inventory_close_backups b
    where b.close_request_id = p_close_request_id
      and b.state = 'VALIDATED'
      and b.sha256 ~ '^[A-Fa-f0-9]{64}$'
      and b.size_bytes > 0
      and b.manifest <> '{}'::jsonb
  )
$$;

create or replace function public.verify_rp_release_integrity_metadata(p_release_id uuid)
returns text
language sql
stable
security definer
set search_path = public, app_private, pg_temp
as $$
  select case when exists (
    select 1 from public.rp_release_batches b
    join public.rp_release_audits a on a.release_id = b.id
    where b.id = p_release_id
      and b.state = 'READY'
      and b.inventory_id = a.inventory_id
      and b.warehouse_id = a.warehouse_id
      and b.xlsx_file_name = a.xlsx_file_name
      and b.xlsx_sha256 = a.xlsx_sha256
      and b.xlsx_size_bytes = a.xlsx_size_bytes
      and b.sidecar_sha256 = a.sidecar_sha256
  ) then 'VERIFIED' else 'INTEGRITY_FAILURE' end
$$;

create or replace function app_private.reject_cut2_history_mutation()
returns trigger
language plpgsql
set search_path = public, app_private, pg_temp
as $$
begin
  raise exception 'CUT2 immutable history cannot be updated or deleted' using errcode = '55000';
end;
$$;
create trigger rp_release_audits_immutable before update or delete on public.rp_release_audits for each row execute function app_private.reject_cut2_history_mutation();
create trigger rp_release_discards_immutable before update or delete on public.rp_release_discards for each row execute function app_private.reject_cut2_history_mutation();
create trigger finding_evidence_immutable before update or delete on public.finding_evidence for each row execute function app_private.reject_cut2_history_mutation();
create trigger inventory_movement_events_immutable before update or delete on public.inventory_movement_events for each row execute function app_private.reject_cut2_history_mutation();

-- New model tables are not directly mutable from the Data API.  Their future
-- CUT2 RPCs will make scoped, audited mutations.  Read policies are limited to
-- the same inventory authority as the legacy model.
alter table public.operational_hours enable row level security;
alter table public.operational_hour_shifts enable row level security;
alter table public.operational_hour_breaks enable row level security;
alter table public.operational_holidays enable row level security;
alter table public.warehouses enable row level security;
alter table public.inventory_sealed_references enable row level security;
alter table public.count_zone_assignments enable row level security;
alter table public.inventory_location_state enable row level security;
alter table public.inventory_movement_taxonomy enable row level security;
alter table public.inventory_movement_events enable row level security;
alter table public.tolerance_policies enable row level security;
alter table public.reference_tolerance_decisions enable row level security;
alter table public.inventory_priority_policies enable row level security;
alter table public.reference_criticality enable row level security;
alter table public.reference_findings enable row level security;
alter table public.finding_evidence enable row level security;
alter table public.orphan_references enable row level security;
alter table public.uom_conversion_factors enable row level security;
alter table public.uom_resolution_cases enable row level security;
alter table public.inventory_capability_grants enable row level security;
alter table public.rp_release_batches enable row level security;
alter table public.rp_release_audits enable row level security;
alter table public.rp_release_discards enable row level security;
alter table public.rp_release_rectifications enable row level security;
alter table public.inventory_close_requests enable row level security;
alter table public.inventory_close_backups enable row level security;
alter table public.notification_policies enable row level security;

revoke all on all tables in schema public from anon;
revoke all on public.operational_hours, public.operational_hour_shifts, public.operational_hour_breaks,
  public.operational_holidays, public.warehouses, public.inventory_sealed_references,
  public.count_zone_assignments, public.inventory_location_state, public.inventory_movement_taxonomy,
  public.inventory_movement_events, public.tolerance_policies, public.reference_tolerance_decisions,
  public.inventory_priority_policies, public.reference_criticality, public.reference_findings,
  public.finding_evidence, public.orphan_references, public.uom_conversion_factors,
  public.uom_resolution_cases, public.inventory_capability_grants, public.rp_release_batches,
  public.rp_release_audits, public.rp_release_discards, public.rp_release_rectifications,
  public.inventory_close_requests, public.inventory_close_backups, public.notification_policies
from authenticated;
grant select on public.operational_hours, public.operational_hour_shifts, public.operational_hour_breaks,
  public.operational_holidays, public.warehouses, public.inventory_sealed_references,
  public.count_zone_assignments, public.inventory_location_state, public.inventory_movement_taxonomy,
  public.inventory_movement_events, public.tolerance_policies, public.reference_tolerance_decisions,
  public.inventory_priority_policies, public.reference_criticality, public.reference_findings,
  public.finding_evidence, public.orphan_references, public.uom_conversion_factors,
  public.uom_resolution_cases, public.inventory_capability_grants, public.rp_release_batches,
  public.rp_release_audits, public.rp_release_discards, public.rp_release_rectifications,
  public.inventory_close_requests, public.inventory_close_backups, public.notification_policies
to authenticated;

create policy cut2_warehouses_read on public.warehouses for select to authenticated using (
  (select app_private.is_admin()) or exists (select 1 from public.inventories i where i.warehouse_id = warehouses.id and app_private.can_access_inventory(i.id))
);
create policy cut2_sealed_references_read on public.inventory_sealed_references for select to authenticated using ((select app_private.can_access_inventory(inventory_id)));
create policy cut2_zone_assignments_read on public.count_zone_assignments for select to authenticated using ((select app_private.can_access_inventory(inventory_id)));
create policy cut2_location_state_read on public.inventory_location_state for select to authenticated using ((select app_private.can_access_inventory(inventory_id)));
create policy cut2_movement_events_read on public.inventory_movement_events for select to authenticated using ((select app_private.can_manage_inventory(inventory_id)));
create policy cut2_tolerance_policy_read on public.tolerance_policies for select to authenticated using ((select app_private.can_manage_inventory(inventory_id)));
create policy cut2_tolerance_decision_read on public.reference_tolerance_decisions for select to authenticated using (exists (select 1 from public.inventory_sealed_references r where r.id = reference_id and app_private.can_manage_inventory(r.inventory_id)));
create policy cut2_priority_policy_read on public.inventory_priority_policies for select to authenticated using ((select app_private.can_manage_inventory(inventory_id)));
create policy cut2_criticality_read on public.reference_criticality for select to authenticated using (exists (select 1 from public.inventory_sealed_references r where r.id = reference_id and app_private.can_manage_inventory(r.inventory_id)));
create policy cut2_findings_read on public.reference_findings for select to authenticated using ((select app_private.can_manage_inventory(inventory_id)));
create policy cut2_evidence_read on public.finding_evidence for select to authenticated using (exists (select 1 from public.reference_findings f where f.id = finding_id and app_private.can_manage_inventory(f.inventory_id)));
create policy cut2_orphan_read on public.orphan_references for select to authenticated using ((select app_private.can_manage_inventory(inventory_id)));
create policy cut2_uom_resolution_read on public.uom_resolution_cases for select to authenticated using ((select app_private.can_manage_inventory(inventory_id)));
create policy cut2_capability_read on public.inventory_capability_grants for select to authenticated using (user_id = (select auth.uid()) or (select app_private.is_admin()));
create policy cut2_rp_release_read on public.rp_release_batches for select to authenticated using ((select app_private.can_manage_inventory(inventory_id)));
create policy cut2_rp_audit_read on public.rp_release_audits for select to authenticated using ((select app_private.can_manage_inventory(inventory_id)));
create policy cut2_rp_discard_read on public.rp_release_discards for select to authenticated using (exists (select 1 from public.rp_release_batches r where r.id = release_id and app_private.can_manage_inventory(r.inventory_id)));
create policy cut2_rp_rectification_read on public.rp_release_rectifications for select to authenticated using (exists (select 1 from public.rp_release_batches r where r.id = original_release_id and app_private.can_manage_inventory(r.inventory_id)));
create policy cut2_close_request_read on public.inventory_close_requests for select to authenticated using ((select app_private.can_manage_inventory(inventory_id)));
create policy cut2_close_backup_read on public.inventory_close_backups for select to authenticated using (exists (select 1 from public.inventory_close_requests r where r.id = close_request_id and app_private.can_manage_inventory(r.inventory_id)));
create policy cut2_notification_policy_read on public.notification_policies for select to authenticated using ((select app_private.is_admin()));
create policy cut2_calendar_read on public.operational_hours for select to authenticated using ((select app_private.is_admin()));
create policy cut2_calendar_shift_read on public.operational_hour_shifts for select to authenticated using ((select app_private.is_admin()));
create policy cut2_calendar_break_read on public.operational_hour_breaks for select to authenticated using ((select app_private.is_admin()));
create policy cut2_calendar_holiday_read on public.operational_holidays for select to authenticated using ((select app_private.is_admin()));
create policy cut2_taxonomy_read on public.inventory_movement_taxonomy for select to authenticated using (true);
create policy cut2_uom_factor_read on public.uom_conversion_factors for select to authenticated using ((select app_private.is_admin()));

revoke all on function public.normalize_reference_key(public.master_control_type, text, text),
  public.operational_minutes_between(uuid, timestamptz, timestamptz),
  public.validate_inventory_close_backup(uuid), public.verify_rp_release_integrity_metadata(uuid),
  public.cut2_has_capability(uuid, public.cut2_capability, timestamptz)
from public, anon;
grant execute on function public.normalize_reference_key(public.master_control_type, text, text),
  public.operational_minutes_between(uuid, timestamptz, timestamptz),
  public.validate_inventory_close_backup(uuid), public.verify_rp_release_integrity_metadata(uuid),
  public.cut2_has_capability(uuid, public.cut2_capability, timestamptz)
to authenticated;
