-- CUT2-01 validation hardening.  This stays model-only: no rolling-cut RPC,
-- UI or release workflow is enabled here.

-- Orphan evidence is deliberately retained, but it must remain ineligible for
-- sealing and RP until a later audited workflow resolves it.
alter table public.orphan_references
  add column block_seal boolean not null default true,
  add column block_rp boolean not null default true;

alter table public.orphan_references
  add constraint orphan_references_normalized_key_check check (
    (reference_type = 'LEGACY'
      and reference_value is null
      and normalized_reference_key = public.normalize_reference_key(reference_type, codigo, null))
    or
    (reference_type in ('PARTIDA', 'SERIAL')
      and reference_value is not null
      and normalized_reference_key = public.normalize_reference_key(reference_type, codigo, reference_value))
  );

-- Listed critical finding types must not be downgraded by a future mutation
-- path.  Only location-only and generic findings may be non-critical.
alter table public.reference_findings
  add constraint reference_findings_critical_taxonomy_check check (
    critical or finding_type in ('NEW_LOCATION_FOUND', 'OTHER')
  );

-- A missing criticality decision is fail-safe.  Future CUT2 RPCs can use this
-- helper without treating the absence of a row as a non-critical reference.
create or replace function public.cut2_reference_is_critical(p_reference_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app_private, pg_temp
as $$
  select coalesce(
    (select c.is_critical from public.reference_criticality c where c.reference_id = p_reference_id),
    true
  )
$$;

-- Once an RP batch is official, neither its delivery metadata nor its identity
-- may be overwritten.  A replacement must be represented by a later release
-- and rectification record.
create or replace function app_private.reject_ready_rp_release_mutation()
returns trigger
language plpgsql
set search_path = public, app_private, pg_temp
as $$
begin
  if tg_op = 'DELETE' or old.state = 'READY' then
    raise exception 'CUT2 ready RP release cannot be updated or deleted' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger rp_release_batches_ready_immutable
before update or delete on public.rp_release_batches
for each row execute function app_private.reject_ready_rp_release_mutation();

revoke all on function public.cut2_reference_is_critical(uuid) from public, anon;
grant execute on function public.cut2_reference_is_critical(uuid) to authenticated;
