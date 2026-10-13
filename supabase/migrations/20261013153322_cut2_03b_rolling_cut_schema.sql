-- CUT2-03B: additive persistence for reference-scoped rolling cuts.
-- Legacy cut snapshots keep their existing status/export workflow.
alter type public.cut_status add value if not exists 'ROLLING_SEALED';

alter table public.inventory_sealed_references
  drop constraint if exists inventory_sealed_references_inventory_id_request_id_key,
  add column if not exists cut_id uuid references public.inventory_cuts(id) on delete restrict;
create index if not exists inventory_sealed_references_cut_idx
  on public.inventory_sealed_references (cut_id, state, normalized_reference_key);

alter table public.reconciliation_cases
  add column if not exists source_cut_id uuid references public.inventory_cuts(id) on delete restrict;
alter table public.recount_missions
  add column if not exists source_cut_id uuid references public.inventory_cuts(id) on delete restrict;
create unique index if not exists reconciliation_cases_rolling_cut_reference_unique
  on public.reconciliation_cases (source_cut_id, codigo, reference_type, coalesce(reference_value, ''))
  where source_cut_id is not null;
create index if not exists recount_missions_source_cut_idx
  on public.recount_missions (source_cut_id, round, status) where source_cut_id is not null;

create table public.rolling_cut_requests (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories(id) on delete restrict,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  request_id uuid not null,
  preview_fingerprint text not null check (preview_fingerprint ~ '^[A-Fa-f0-9]{64}$'),
  selection_fingerprint text not null check (selection_fingerprint ~ '^[A-Fa-f0-9]{64}$'),
  cut_id uuid not null unique references public.inventory_cuts(id) on delete restrict,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (inventory_id, request_id)
);
create index rolling_cut_requests_inventory_created_idx on public.rolling_cut_requests (inventory_id, created_at desc);

create table public.rolling_cut_reference_snapshots (
  id uuid primary key default gen_random_uuid(),
  cut_id uuid not null references public.inventory_cuts(id) on delete restrict,
  inventory_id uuid not null references public.inventories(id) on delete restrict,
  sealed_reference_id uuid not null references public.inventory_sealed_references(id) on delete restrict,
  count_record_id uuid not null references public.count_records(id) on delete restrict,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (cut_id, count_record_id),
  unique (sealed_reference_id, count_record_id)
);
create index rolling_cut_reference_snapshots_cut_idx on public.rolling_cut_reference_snapshots (cut_id, sealed_reference_id);

create table public.rolling_cut_events (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories(id) on delete restrict,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  cut_id uuid not null references public.inventory_cuts(id) on delete restrict,
  sealed_reference_id uuid references public.inventory_sealed_references(id) on delete restrict,
  reconciliation_case_id uuid references public.reconciliation_cases(id) on delete restrict,
  request_id uuid not null,
  event_type text not null check (event_type in ('ROLLING_CUT_CREATED','REFERENCE_SEALED','C2_CREATED_FROM_CUT')),
  actor_user_id uuid not null references public.profiles(user_id) on delete restrict,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index rolling_cut_events_once_idx on public.rolling_cut_events (cut_id, event_type, coalesce(sealed_reference_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(reconciliation_case_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.rolling_cut_requests enable row level security;
alter table public.rolling_cut_reference_snapshots enable row level security;
alter table public.rolling_cut_events enable row level security;
revoke all on public.rolling_cut_requests, public.rolling_cut_reference_snapshots, public.rolling_cut_events from anon, authenticated;
grant select on public.rolling_cut_requests, public.rolling_cut_reference_snapshots, public.rolling_cut_events to authenticated;
create policy rolling_cut_requests_manager_read on public.rolling_cut_requests for select to authenticated using ((select app_private.can_manage_inventory(inventory_id)));
create policy rolling_cut_reference_snapshots_manager_read on public.rolling_cut_reference_snapshots for select to authenticated using ((select app_private.can_manage_inventory(inventory_id)));
create policy rolling_cut_events_manager_read on public.rolling_cut_events for select to authenticated using ((select app_private.can_manage_inventory(inventory_id)));
