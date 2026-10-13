-- CUT2-02: deterministic read-only preview.  This migration deliberately does
-- not create rolling cuts, seals, recount missions, releases, or lifecycle
-- transitions.

create index if not exists count_records_cut2_preview_identity_idx
  on public.count_records (inventory_id, codigo, serie, partida, received_at desc);
create index if not exists reconciliation_cases_cut2_preview_identity_idx
  on public.reconciliation_cases (inventory_id, codigo, reference_type, reference_value, status);
create index if not exists recount_missions_cut2_preview_case_status_idx
  on public.recount_missions (inventory_id, case_id, round, status);
create index if not exists inventory_freeze_guards_cut2_preview_open_idx
  on public.inventory_freeze_guards (inventory_id) where resolved_at is null;

create or replace function public.preview_rolling_cut_v2(
  p_inventory_id uuid,
  p_warehouse_id uuid default null,
  p_selection jsonb default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  v_warehouse_id uuid;
  v_selection_keys text[];
begin
  perform app_private.require_active_actor();
  if not app_private.can_manage_inventory(p_inventory_id) then
    raise exception 'Not authorized for rolling cut preview' using errcode = '42501';
  end if;

  select warehouse_id into v_warehouse_id
  from public.inventories
  where id = p_inventory_id;

  if v_warehouse_id is null then
    raise exception 'Inventory not found' using errcode = 'P0002';
  end if;
  if p_warehouse_id is not null and p_warehouse_id <> v_warehouse_id then
    raise exception 'Warehouse does not belong to inventory' using errcode = '23514';
  end if;

  if p_selection is not null then
    if jsonb_typeof(p_selection) <> 'object'
      or (p_selection ? 'normalized_reference_keys'
          and jsonb_typeof(p_selection -> 'normalized_reference_keys') <> 'array') then
      raise exception 'Preview selection must be an object with normalized_reference_keys array' using errcode = '22023';
    end if;

    select coalesce(array_agg(value order by value), '{}'::text[])
    into v_selection_keys
    from jsonb_array_elements_text(coalesce(p_selection -> 'normalized_reference_keys', '[]'::jsonb)) value;

    if cardinality(v_selection_keys) > 10000
      or exists (select 1 from unnest(v_selection_keys) key where length(btrim(key)) = 0 or length(key) > 512) then
      raise exception 'Preview selection is invalid or too large' using errcode = '22023';
    end if;
  end if;

  return (
    with physical_raw as (
      select
        c.codigo,
        m.descripcion,
        m.control_type as reference_type,
        case when m.control_type = 'SERIAL' then c.serie when m.control_type = 'PARTIDA' then c.partida else null end as reference_value,
        c.ubicacion,
        c.cantidad_contada,
        c.id as count_record_id,
        c.received_at
      from public.count_records c
      join public.inventory_master_items m on m.inventory_id = c.inventory_id and m.codigo = c.codigo
      where c.inventory_id = p_inventory_id
        and not exists (select 1 from public.recount_mission_observations o where o.count_record_id = c.id)
    ), physical as (
      select
        codigo, max(descripcion) as descripcion, reference_type, reference_value,
        case
          when reference_type = 'LEGACY' then public.normalize_reference_key(reference_type, codigo, null)
          when nullif(btrim(reference_value), '') is not null then public.normalize_reference_key(reference_type, codigo, reference_value)
          else null
        end as normalized_reference_key,
        sum(cantidad_contada)::integer as c1_quantity,
        count(*)::integer as count_records,
        array_agg(distinct ubicacion order by ubicacion) as locations,
        max(received_at) as last_received_at
      from physical_raw
      group by codigo, reference_type, reference_value
    ), system_rows as (
      select
        s.codigo,
        coalesce(m.descripcion, 'Sin descripción') as descripcion,
        s.reference_type,
        s.reference_value,
        public.normalize_reference_key(s.reference_type, s.codigo, s.reference_value) as normalized_reference_key,
        coalesce(s.source_available_quantity, s.quantity, 0)::integer as system_quantity_disponible,
        s.unit_code,
        s.expiration_date
      from public.inventory_system_reference_items s
      left join public.inventory_master_items m on m.inventory_id = s.inventory_id and m.codigo = s.codigo
      where s.inventory_id = p_inventory_id
    ), candidates as (
      select
        coalesce(s.codigo, p.codigo) as codigo,
        coalesce(s.descripcion, p.descripcion, 'Sin descripción') as descripcion,
        coalesce(s.reference_type, p.reference_type) as reference_type,
        coalesce(s.reference_value, p.reference_value) as reference_value,
        coalesce(s.normalized_reference_key, p.normalized_reference_key) as normalized_reference_key,
        coalesce(s.system_quantity_disponible, 0)::integer as system_quantity_disponible,
        coalesce(p.c1_quantity, 0)::integer as c1_quantity,
        coalesce(p.count_records, 0)::integer as count_records,
        coalesce(p.locations, '{}'::text[]) as locations,
        s.unit_code,
        p.last_received_at,
        p.normalized_reference_key is null and p.codigo is not null as invalid_identity
      from system_rows s
      full join physical p on p.normalized_reference_key = s.normalized_reference_key
      -- Preserve malformed physical identities in the preview so they are visibly
      -- blocked instead of silently disappearing from a manager's review.
      where p.codigo is not null or s.normalized_reference_key is not null
    ), selected as (
      select * from candidates
      where v_selection_keys is null or normalized_reference_key = any(v_selection_keys)
    ), classified as (
      select
        c.*,
        exists (
          select 1 from public.inventory_sealed_references r
          where r.inventory_id = p_inventory_id and r.warehouse_id = v_warehouse_id
            and r.normalized_reference_key = c.normalized_reference_key and r.state in ('SEALING', 'SEALED')
        ) as is_sealed,
        exists (
          select 1 from public.orphan_references o
          where o.inventory_id = p_inventory_id and o.warehouse_id = v_warehouse_id
            and o.normalized_reference_key = c.normalized_reference_key
            and o.state <> 'RESOLVED' and (o.block_seal or o.block_rp)
        ) as is_orphan,
        exists (
          select 1 from public.inventory_sealed_references r
          join public.uom_resolution_cases u on u.reference_id = r.id
          where r.inventory_id = p_inventory_id and r.warehouse_id = v_warehouse_id
            and r.normalized_reference_key = c.normalized_reference_key and u.state <> 'RESOLVED'
        ) as has_uom_mismatch,
        exists (
          select 1 from public.inventory_sealed_references r
          join public.reference_findings f on f.reference_id = r.id
          where r.inventory_id = p_inventory_id and r.warehouse_id = v_warehouse_id
            and r.normalized_reference_key = c.normalized_reference_key
            and f.state in ('OPEN', 'HELD') and f.critical
        ) as has_critical_finding,
        exists (
          select 1 from public.inventory_sealed_references r
          join public.reference_findings f on f.reference_id = r.id
          where r.inventory_id = p_inventory_id and r.warehouse_id = v_warehouse_id
            and r.normalized_reference_key = c.normalized_reference_key
            and f.state in ('OPEN', 'HELD') and f.finding_type = 'PENDING_EVIDENCE'
        ) as has_pending_evidence,
        exists (
          select 1 from public.reconciliation_cases rc
          join public.recount_missions rm on rm.case_id = rc.id
          where rc.inventory_id = p_inventory_id and rc.codigo = c.codigo
            and rc.reference_type = c.reference_type and coalesce(rc.reference_value, '') = coalesce(c.reference_value, '')
            and rm.status in ('QUEUED', 'ACTIVE') and rm.round = 2
        ) as has_c2_active,
        exists (
          select 1 from public.reconciliation_cases rc
          join public.recount_missions rm on rm.case_id = rc.id
          where rc.inventory_id = p_inventory_id and rc.codigo = c.codigo
            and rc.reference_type = c.reference_type and coalesce(rc.reference_value, '') = coalesce(c.reference_value, '')
            and rm.status in ('QUEUED', 'ACTIVE') and rm.round = 3
        ) as has_c3_active,
        exists (select 1 from public.inventory_freeze_guards g where g.inventory_id = p_inventory_id and g.resolved_at is null) as has_sync_risk,
        exists (
          select 1 from public.inventory_location_state l
          where l.inventory_id = p_inventory_id and l.warehouse_id = v_warehouse_id
            and l.location_code = any(c.locations) and l.frozen_at is not null
        ) as location_not_ready,
        exists (
          select 1 from unnest(c.locations) location
          where exists (
            select 1 from public.count_zone_assignments z
            where z.inventory_id = p_inventory_id and z.warehouse_id = v_warehouse_id and z.active
          )
          and not exists (
            select 1 from public.count_zone_assignments z
            where z.inventory_id = p_inventory_id and z.warehouse_id = v_warehouse_id and z.active
              and (location = z.zone_code or location like z.zone_code || '-%')
          )
        ) as out_of_zone
      from selected c
    ), outcomes as (
      select c.*,
        case
          when invalid_identity then 'INVALID_IDENTITY'
          when is_sealed then 'REFERENCE_ALREADY_SEALED'
          when is_orphan then 'ORPHAN_REFERENCE'
          when has_uom_mismatch then 'UOM_MISMATCH'
          when system_quantity_disponible < 0 then 'RISK_NEGATIVE_BALANCE'
          when reference_type = 'SERIAL' and count_records > 1 then 'DUPLICATE_SERIAL'
          when has_pending_evidence then 'PENDING_EVIDENCE'
          when has_critical_finding then 'CRITICAL_FINDING_OPEN'
          when out_of_zone then 'OUT_OF_ASSIGNED_ZONE_REVIEW'
          when has_sync_risk then 'SYNC_PENDING'
          when location_not_ready then 'LOCATION_NOT_READY'
          when has_c2_active then 'C2_ALREADY_ACTIVE'
          when has_c3_active then 'C3_ALREADY_ACTIVE'
          else null
        end as block_reason
      from classified c
    ), items as (
      select o.*,
        case
          when block_reason is not null then 'BLOCKED'
          when c1_quantity = 0 then 'OPEN_C1'
          when c1_quantity <> system_quantity_disponible then 'C2_REQUIRED_ESTIMATE'
          else 'RP_READY_ESTIMATE'
        end as estimated_result
      from outcomes o
    ), fingerprint_material as (
      select
        coalesce(string_agg(
          concat_ws(E'\x1f', coalesce(normalized_reference_key, concat_ws('::', 'INVALID', codigo, reference_type::text, coalesce(reference_value, ''))), system_quantity_disponible, c1_quantity, coalesce(block_reason, ''), estimated_result),
          E'\x1e' order by coalesce(normalized_reference_key, concat_ws('::', 'INVALID', codigo, reference_type::text, coalesce(reference_value, '')))
        ), '') as candidate_reference_root,
        coalesce((select jsonb_agg(policy_snapshot order by id)::text from public.tolerance_policies where inventory_id = p_inventory_id and warehouse_id = v_warehouse_id), '[]')
          || coalesce((select jsonb_agg(jsonb_build_object('max_critical_ratio', max_critical_ratio, 'scope', denominator_scope) order by id)::text from public.inventory_priority_policies where inventory_id = p_inventory_id and warehouse_id = v_warehouse_id), '[]') as policy_snapshot
      from items
    ), rendered_items as (
      select jsonb_build_object(
        'identity_descriptor', case when reference_type = 'LEGACY' then codigo else codigo || '::' || coalesce(reference_value, '') end,
        'codigo', codigo, 'descripcion', descripcion, 'reference_type', reference_type,
        'reference_value', reference_value, 'normalized_reference_key', normalized_reference_key,
        'warehouse_id', v_warehouse_id, 'locations', locations, 'count_records', count_records,
        'c1_quantity', c1_quantity, 'system_quantity_disponible', system_quantity_disponible,
        'difference', c1_quantity - system_quantity_disponible, 'uom', unit_code,
        'criticality', case when has_critical_finding then 'CRITICAL' else 'NOT_CRITICAL' end,
        'zone_status', case when out_of_zone then 'OUT_OF_ZONE_REVIEW' when location_not_ready then 'LOCATION_NOT_READY' else 'READY' end,
        'finding_status', case when has_pending_evidence then 'PENDING_EVIDENCE' when has_critical_finding then 'CRITICAL_OPEN' else 'NONE' end,
        'orphan_status', case when is_orphan then 'ORPHAN_REFERENCE' else 'NONE' end,
        'eligibility', block_reason is null and c1_quantity > 0,
        'block_reason', block_reason, 'estimated_result', estimated_result
      ) as item
      from items
    )
    select jsonb_build_object(
      'summary', jsonb_build_object(
        'inventory_id', p_inventory_id, 'warehouse_id', v_warehouse_id,
        'inventory_status', (select status from public.inventories where id = p_inventory_id),
        'open_reference_count', (select count(*) from items where estimated_result = 'OPEN_C1'),
        'eligible_reference_count', (select count(*) from items where block_reason is null and c1_quantity > 0),
        'blocked_reference_count', (select count(*) from items where block_reason is not null),
        'orphan_reference_count', (select count(*) from items where is_orphan),
        'uom_mismatch_count', (select count(*) from items where has_uom_mismatch),
        'negative_balance_count', (select count(*) from items where system_quantity_disponible < 0),
        'duplicate_serial_count', (select count(*) from items where reference_type = 'SERIAL' and count_records > 1),
        'critical_findings_count', (select count(*) from items where has_critical_finding),
        'out_of_zone_count', (select count(*) from items where out_of_zone),
        'rp_ready_estimate', (select count(*) from items where estimated_result = 'RP_READY_ESTIMATE'),
        'c2_required_estimate', (select count(*) from items where estimated_result = 'C2_REQUIRED_ESTIMATE'),
        'c3_required_estimate', (select count(*) from items where has_c3_active),
        'open_sync_risk_count', (select count(*) from items where has_sync_risk),
        'generated_at', now()
      ),
      'items', coalesce((select jsonb_agg(item order by item ->> 'normalized_reference_key') from rendered_items), '[]'::jsonb),
      'preview_fingerprint', encode(extensions.digest(
        convert_to(concat_ws(E'\x1f', 'CUT2_PREVIEW_V1', p_inventory_id::text, v_warehouse_id::text, (select candidate_reference_root from fingerprint_material), (select policy_snapshot from fingerprint_material)), 'utf8'),
        'sha256'
      ), 'hex')
    )
  );
end;
$$;

revoke all on function public.preview_rolling_cut_v2(uuid, uuid, jsonb) from public, anon;
grant execute on function public.preview_rolling_cut_v2(uuid, uuid, jsonb) to authenticated;
