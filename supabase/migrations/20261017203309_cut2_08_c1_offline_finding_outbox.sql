-- CUT2-08J2: the C1 client can retain a manual physical finding while offline.
-- This is deliberately an idempotent adapter over the canonical finding and
-- evidence tables, rather than a second review or offline-finding model.
create or replace function public.report_c1_reference_finding(
  p_inventory_id uuid,
  p_reference_type public.master_control_type,
  p_codigo text,
  p_reference_value text,
  p_finding_type public.cut2_finding_type,
  p_description text,
  p_critical boolean,
  p_source_event_key text,
  p_captured_at timestamptz,
  p_offline boolean default false,
  p_evidence jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := app_private.require_active_actor();
  v_inventory public.inventories;
  v_key text;
  v_reference public.inventory_sealed_references;
  v_finding_id uuid;
  v_source_stage public.cut2_finding_source_stage;
  v_evidence_source_event_id text;
begin
  if p_source_event_key is null or length(btrim(p_source_event_key)) not between 1 and 200 then
    raise exception 'SOURCE_EVENT_KEY_REQUIRED' using errcode = '23514';
  end if;
  if p_captured_at is null or p_description is null or length(btrim(p_description)) not between 1 and 4000 then
    raise exception 'FINDING_PAYLOAD_INVALID' using errcode = '23514';
  end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'EVIDENCE_METADATA_REQUIRED' using errcode = '23514';
  end if;

  select * into v_inventory
  from public.inventories
  where id = p_inventory_id
  for share;
  if v_inventory.id is null then
    raise exception 'INVENTORY_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform app_private.require_finding_capability(
    v_actor, 'FINDING_REPORT'::public.cut2_capability, v_inventory.id, v_inventory.warehouse_id
  );

  v_key := public.normalize_reference_key(p_reference_type, p_codigo, p_reference_value);
  if v_key is null or length(btrim(v_key)) = 0 then
    raise exception 'CANONICAL_REFERENCE_REQUIRED' using errcode = '23514';
  end if;
  if not exists (
    select 1
    from public.inventory_master_items m
    where m.inventory_id = v_inventory.id
      and m.control_type = p_reference_type
      and m.codigo = upper(btrim(p_codigo))
    union all
    select 1
    from public.inventory_system_reference_items s
    where s.inventory_id = v_inventory.id
      and s.reference_type = p_reference_type
      and public.normalize_reference_key(s.reference_type, s.codigo, s.reference_value) = v_key
  ) then
    raise exception 'CANONICAL_REFERENCE_UNKNOWN' using errcode = '23514';
  end if;

  select * into v_reference
  from public.inventory_sealed_references
  where inventory_id = v_inventory.id
    and warehouse_id = v_inventory.warehouse_id
    and reference_type = p_reference_type
    and normalized_reference_key = v_key
    and state = 'SEALED'
  order by sealed_at desc nulls last
  limit 1;

  v_source_stage := case
    when v_reference.id is null then 'C1'::public.cut2_finding_source_stage
    when p_offline then 'OFFLINE_LATE_COUNT'::public.cut2_finding_source_stage
    else 'POST_SEAL'::public.cut2_finding_source_stage
  end;

  insert into public.reference_findings(
    inventory_id, warehouse_id, reference_id, reference_type,
    normalized_reference_key, finding_type, severity, source_stage,
    source_event_key, critical, description, created_by
  ) values (
    v_inventory.id, v_inventory.warehouse_id, v_reference.id, p_reference_type,
    v_key, p_finding_type,
    case when p_critical then 'CRITICAL'::public.cut2_finding_severity else 'MEDIUM'::public.cut2_finding_severity end,
    v_source_stage, btrim(p_source_event_key), p_critical, btrim(p_description), v_actor
  )
  on conflict (source_event_key) where source_event_key is not null do update
    set updated_at = public.reference_findings.updated_at
    where public.reference_findings.inventory_id = excluded.inventory_id
      and public.reference_findings.warehouse_id = excluded.warehouse_id
      and public.reference_findings.reference_type = excluded.reference_type
      and public.reference_findings.normalized_reference_key = excluded.normalized_reference_key
      and public.reference_findings.finding_type = excluded.finding_type
      and public.reference_findings.description = excluded.description
  returning id into v_finding_id;
  if v_finding_id is null then
    raise exception 'SOURCE_EVENT_PAYLOAD_CONFLICT' using errcode = '23505';
  end if;

  v_evidence_source_event_id := 'c1-finding-evidence:' || btrim(p_source_event_key);
  insert into public.finding_evidence(
    finding_id, metadata, captured_by, captured_at, source_event_id
  ) values (
    v_finding_id,
    p_evidence || jsonb_build_object(
      'source_event_key', btrim(p_source_event_key),
      'captured_at', p_captured_at,
      'source_stage', v_source_stage,
      'codigo', upper(btrim(p_codigo)),
      'reference_type', p_reference_type,
      'reference_value', p_reference_value
    ),
    v_actor, p_captured_at, v_evidence_source_event_id
  ) on conflict (finding_id, source_event_id) where source_event_id is not null do nothing;

  return v_finding_id;
end
$function$;

revoke all on function public.report_c1_reference_finding(
  uuid, public.master_control_type, text, text, public.cut2_finding_type,
  text, boolean, text, timestamptz, boolean, jsonb
) from public, anon;
grant execute on function public.report_c1_reference_finding(
  uuid, public.master_control_type, text, text, public.cut2_finding_type,
  text, boolean, text, timestamptz, boolean, jsonb
) to authenticated;
