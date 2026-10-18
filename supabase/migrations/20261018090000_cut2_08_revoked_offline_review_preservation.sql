-- CUT2-08J5: a revoked offline C1 report is never an authorized mutation.
-- It is preserved exactly once as canonical, server-side review evidence so
-- a scoped reviewer can inspect it after the client outbox becomes terminal.
-- This reuses reference_findings and finding_evidence; it introduces no
-- second queue or finding family.

create or replace function public.preserve_revoked_offline_c1_finding(
  p_inventory_id uuid,
  p_reference_type public.master_control_type,
  p_codigo text,
  p_reference_value text,
  p_finding_type public.cut2_finding_type,
  p_description text,
  p_critical boolean,
  p_source_event_key text,
  p_captured_at timestamptz,
  p_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := app_private.require_active_actor();
  v_inventory public.inventories;
  v_reference public.inventory_sealed_references;
  v_key text;
  v_finding_id uuid;
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

  -- A caller must have been bound to this inventory, but must no longer have
  -- current FINDING_REPORT authority.  This makes this a review-preservation
  -- boundary, not a way to bypass an active capability check or write a
  -- foreign-inventory artifact.
  if not exists (
    select 1 from public.inventory_assignments a
    where a.inventory_id = v_inventory.id and a.user_id = v_actor
  ) then
    raise exception 'OFFLINE_REVIEW_OWNERSHIP_DENIED' using errcode = '42501';
  end if;
  if app_private.finding_actor_has_capability(
    v_actor, 'FINDING_REPORT'::public.cut2_capability,
    v_inventory.id, v_inventory.warehouse_id
  ) then
    raise exception 'OFFLINE_REVIEW_NOT_REQUIRED' using errcode = '23514';
  end if;

  v_key := public.normalize_reference_key(p_reference_type, p_codigo, p_reference_value);
  if v_key is null or length(btrim(v_key)) = 0 then
    raise exception 'CANONICAL_REFERENCE_REQUIRED' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.inventory_master_items m
    where m.inventory_id = v_inventory.id
      and m.control_type = p_reference_type
      and m.codigo = upper(btrim(p_codigo))
    union all
    select 1 from public.inventory_system_reference_items s
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

  insert into public.reference_findings(
    inventory_id, warehouse_id, reference_id, reference_type,
    normalized_reference_key, finding_type, severity, source_stage,
    source_event_key, critical, description, created_by
  ) values (
    v_inventory.id, v_inventory.warehouse_id, v_reference.id, p_reference_type,
    v_key, 'AUTHORIZATION_REVOKED_OFFLINE'::public.cut2_finding_type,
    'HIGH'::public.cut2_finding_severity, 'SYSTEM'::public.cut2_finding_source_stage,
    btrim(p_source_event_key), true, btrim(p_description), v_actor
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
      'source_stage', 'SYSTEM',
      'original_finding_type', p_finding_type,
      'original_critical', p_critical,
      'review_reason', 'AUTHORIZATION_REVOKED',
      'codigo', upper(btrim(p_codigo)),
      'reference_type', p_reference_type,
      'reference_value', p_reference_value
    ),
    v_actor, p_captured_at, v_evidence_source_event_id
  ) on conflict (finding_id, source_event_id) where source_event_id is not null do nothing;

  return jsonb_build_object(
    'finding_id', v_finding_id,
    'sync_state', 'REVIEW_REQUIRED',
    'review_reason', 'AUTHORIZATION_REVOKED'
  );
end
$function$;

revoke all on function public.preserve_revoked_offline_c1_finding(
  uuid, public.master_control_type, text, text, public.cut2_finding_type,
  text, boolean, text, timestamptz, jsonb
) from public, anon;
grant execute on function public.preserve_revoked_offline_c1_finding(
  uuid, public.master_control_type, text, text, public.cut2_finding_type,
  text, boolean, text, timestamptz, jsonb
) to authenticated;

-- Keep the terminal review reason in the canonical audit projection.  One
-- insert still produces one REPORTED event; retries are source-event no-ops.
create or replace function app_private.audit_reference_finding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_review_reason text;
begin
  if tg_op = 'INSERT' then
    v_review_reason := case
      when new.finding_type = 'AUTHORIZATION_REVOKED_OFFLINE'::public.cut2_finding_type then 'AUTHORIZATION_REVOKED'
      when new.source_stage = 'OFFLINE_LATE_COUNT'::public.cut2_finding_source_stage then 'REFERENCE_SEALED'
      else null
    end;
    insert into public.reference_finding_events(finding_id,event_type,actor_user_id,payload)
    values(
      new.id, 'REPORTED', new.created_by,
      jsonb_strip_nulls(jsonb_build_object(
        'source_stage',new.source_stage,
        'severity',new.severity,
        'source_event_key',new.source_event_key,
        'review_reason',v_review_reason
      ))
    );
  elsif new.state = 'RESOLVED' and old.state <> 'RESOLVED' then
    insert into public.reference_finding_events(finding_id,event_type,actor_user_id,payload)
    values(new.id,'RESOLVED',new.resolved_by,jsonb_build_object('resolution_code',new.resolution_code,'resolution',new.resolution));
  elsif new.assigned_to is distinct from old.assigned_to then
    insert into public.reference_finding_events(finding_id,event_type,actor_user_id,payload)
    values(new.id,'ASSIGNED',new.created_by,jsonb_build_object('assigned_to',new.assigned_to));
  elsif new.reference_id is distinct from old.reference_id and new.reference_id is not null then
    insert into public.reference_finding_events(finding_id,event_type,actor_user_id,payload)
    values(new.id,'LINKED_SEAL',new.created_by,jsonb_build_object('sealed_reference_id',new.reference_id));
  end if;
  return new;
end
$function$;

create or replace function public.get_reference_finding_detail(p_finding_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := app_private.require_active_actor();
  v_finding public.reference_findings;
begin
  select * into v_finding from public.reference_findings where id = p_finding_id;
  if v_finding.id is null then
    raise exception 'FINDING_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform app_private.require_finding_capability(
    v_actor, 'VIEW_MONITOR'::public.cut2_capability,
    v_finding.inventory_id, v_finding.warehouse_id
  );

  return (
    select jsonb_build_object(
      'id', v_finding.id,
      'inventory_id', v_finding.inventory_id,
      'inventory_name', i.name,
      'warehouse_id', v_finding.warehouse_id,
      'warehouse_name', w.name,
      'finding_type', v_finding.finding_type,
      'severity', v_finding.severity,
      'status', v_finding.state,
      'source_stage', v_finding.source_stage,
      'source_chain', jsonb_strip_nulls(jsonb_build_object(
        'mission_id', m.id,
        'mission_round', m.round,
        'source_cut_id', coalesce(m.source_cut_id, rc.source_cut_id),
        'source_cut_number', c.cut_number,
        'source_c2_mission_id', m.source_c2_mission_id,
        'sealed_reference_id', coalesce(v_finding.reference_id, m.source_sealed_reference_id)
      )),
      'identity', jsonb_build_object(
        'reference_type', v_finding.reference_type,
        'normalized_reference_key', v_finding.normalized_reference_key
      ),
      'description', v_finding.description,
      'reported_by', v_finding.created_by,
      'reported_by_name', reporter.display_name,
      'reported_at', v_finding.created_at,
      'assigned_to', v_finding.assigned_to,
      'assigned_to_name', assignee.display_name,
      'assigned_at', v_finding.assigned_at,
      'resolution_code', v_finding.resolution_code,
      'resolution_note', v_finding.resolution,
      'resolved_by', v_finding.resolved_by,
      'resolved_by_name', resolver.display_name,
      'resolved_at', v_finding.resolved_at,
      'review_context', case
        when v_finding.finding_type = 'AUTHORIZATION_REVOKED_OFFLINE'::public.cut2_finding_type
          then jsonb_build_object('state','REVIEW_REQUIRED','reason','AUTHORIZATION_REVOKED')
        when v_finding.source_stage = 'OFFLINE_LATE_COUNT'::public.cut2_finding_source_stage
          then jsonb_build_object('state','REVIEW_REQUIRED','reason','REFERENCE_SEALED')
        else null
      end,
      'blockers', jsonb_build_object(
        'seal', v_finding.blocks_seal,
        'recount_completion', v_finding.blocks_recount_completion,
        'rp', v_finding.blocks_rp,
        'close', v_finding.blocks_close
      ),
      'evidence', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', e.id, 'metadata', e.metadata, 'captured_by', e.captured_by,
          'captured_by_name', evidence_actor.display_name, 'captured_at', e.captured_at
        ) order by e.captured_at, e.id)
        from public.finding_evidence e
        left join public.profiles evidence_actor on evidence_actor.user_id = e.captured_by
        where e.finding_id = v_finding.id
      ), '[]'::jsonb),
      'timeline', coalesce((
        select jsonb_agg(jsonb_build_object(
          'event_type', ev.event_type, 'actor_user_id', ev.actor_user_id,
          'actor_name', event_actor.display_name, 'payload', ev.payload,
          'created_at', ev.created_at
        ) order by ev.created_at, ev.id)
        from public.reference_finding_events ev
        left join public.profiles event_actor on event_actor.user_id = ev.actor_user_id
        where ev.finding_id = v_finding.id
      ), '[]'::jsonb)
    )
    from public.inventories i
    join public.warehouses w on w.id = v_finding.warehouse_id
    left join public.recount_missions m on m.id = v_finding.source_mission_id
    left join public.reconciliation_cases rc on rc.id = m.case_id
    left join public.inventory_cuts c on c.id = coalesce(m.source_cut_id, rc.source_cut_id)
    left join public.profiles reporter on reporter.user_id = v_finding.created_by
    left join public.profiles assignee on assignee.user_id = v_finding.assigned_to
    left join public.profiles resolver on resolver.user_id = v_finding.resolved_by
    where i.id = v_finding.inventory_id
  );
end
$function$;

revoke all on function public.get_reference_finding_detail(uuid) from public, anon;
grant execute on function public.get_reference_finding_detail(uuid) to authenticated;
