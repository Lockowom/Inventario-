-- CUT2-08H: eligibility invokes require_active_actor(), which is not stable.
alter function public.get_finding_eligibility(uuid) volatile;

-- Qualify the inventory primary key in the scoped Monitor read model.  The
-- return table exposes an `id` output variable, so unqualified `id` is
-- ambiguous to PL/pgSQL even though the query is otherwise correct.
create or replace function public.get_live_monitor_findings(
  p_inventory_id uuid,
  p_limit integer default 100
)
returns table(
  id uuid,
  finding_type text,
  severity text,
  state text,
  source_stage text,
  codigo text,
  reference_type text,
  normalized_reference_key text,
  description text,
  assigned_to uuid,
  reported_at timestamptz,
  source_mission_id uuid,
  source_cut_id uuid,
  blocks_seal boolean,
  blocks_recount_completion boolean,
  blocks_rp boolean,
  blocks_close boolean,
  evidence_count bigint,
  last_evidence_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_active_actor();
  v_warehouse_id uuid;
begin
  select i.warehouse_id into v_warehouse_id
  from public.inventories i
  where i.id = p_inventory_id;

  perform app_private.require_finding_capability(
    v_actor, 'VIEW_MONITOR', p_inventory_id, v_warehouse_id
  );

  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'INVALID_LIMIT' using errcode = '22023';
  end if;

  return query
  select
    f.id,
    f.finding_type::text,
    f.severity::text,
    f.state::text,
    f.source_stage::text,
    coalesce(sr.codigo, rc.codigo, ''),
    f.reference_type::text,
    f.normalized_reference_key,
    f.description,
    f.assigned_to,
    f.created_at,
    f.source_mission_id,
    coalesce(m.source_cut_id, rc.source_cut_id),
    f.blocks_seal,
    f.blocks_recount_completion,
    f.blocks_rp,
    f.blocks_close,
    count(e.id),
    f.last_evidence_at
  from public.reference_findings f
  left join public.inventory_sealed_references sr on sr.id = f.reference_id
  left join public.recount_missions m on m.id = f.source_mission_id
  left join public.reconciliation_cases rc on rc.id = m.case_id
  left join public.finding_evidence e on e.finding_id = f.id
  where f.inventory_id = p_inventory_id
    and f.warehouse_id = v_warehouse_id
  group by f.id, sr.codigo, rc.codigo, m.source_cut_id, rc.source_cut_id
  order by
    case f.severity
      when 'CRITICAL' then 1
      when 'HIGH' then 2
      when 'MEDIUM' then 3
      when 'LOW' then 4
      else 5
    end,
    f.created_at desc
  limit p_limit;
end
$$;

revoke all on function public.get_live_monitor_findings(uuid,integer) from public, anon;
grant execute on function public.get_live_monitor_findings(uuid,integer) to authenticated;
