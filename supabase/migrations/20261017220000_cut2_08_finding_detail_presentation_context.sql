-- CUT2-08J4: enrich the already-authorized detail projection with labels and
-- source-chain context.  This is presentation data only; the capability and
-- scope boundary remains get_reference_finding_detail itself.
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
        'sealed_reference_id', m.source_sealed_reference_id
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
