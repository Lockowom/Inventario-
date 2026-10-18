-- CUT2-08J3: scoped operational detail.  The client receives one authored
-- projection, rather than joining finding tables or filtering foreign data.
create or replace function public.get_reference_finding_detail(p_finding_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := app_private.require_active_actor();
  v_finding public.reference_findings;
begin
  select * into v_finding from public.reference_findings where id = p_finding_id;
  if v_finding.id is null then raise exception 'FINDING_NOT_FOUND' using errcode = 'P0002'; end if;
  perform app_private.require_finding_capability(v_actor,'VIEW_MONITOR'::public.cut2_capability,v_finding.inventory_id,v_finding.warehouse_id);
  return jsonb_build_object(
    'id', v_finding.id,
    'inventory_id', v_finding.inventory_id,
    'warehouse_id', v_finding.warehouse_id,
    'finding_type', v_finding.finding_type,
    'severity', v_finding.severity,
    'status', v_finding.state,
    'source_stage', v_finding.source_stage,
    'identity', jsonb_build_object('reference_type',v_finding.reference_type,'normalized_reference_key',v_finding.normalized_reference_key),
    'description', v_finding.description,
    'reported_by', v_finding.created_by,
    'reported_at', v_finding.created_at,
    'assigned_to', v_finding.assigned_to,
    'assigned_at', v_finding.assigned_at,
    'resolution_code', v_finding.resolution_code,
    'resolution_note', v_finding.resolution,
    'resolved_by', v_finding.resolved_by,
    'resolved_at', v_finding.resolved_at,
    'blockers', jsonb_build_object('seal',v_finding.blocks_seal,'recount_completion',v_finding.blocks_recount_completion,'rp',v_finding.blocks_rp,'close',v_finding.blocks_close),
    'evidence', coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'metadata',e.metadata,'captured_by',e.captured_by,'captured_at',e.captured_at) order by e.captured_at,e.id) from public.finding_evidence e where e.finding_id=v_finding.id),'[]'::jsonb),
    'timeline', coalesce((select jsonb_agg(jsonb_build_object('event_type',ev.event_type,'actor_user_id',ev.actor_user_id,'payload',ev.payload,'created_at',ev.created_at) order by ev.created_at,ev.id) from public.reference_finding_events ev where ev.finding_id=v_finding.id),'[]'::jsonb)
  );
end
$function$;

create or replace function public.get_my_reference_finding_actions(p_finding_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := app_private.require_active_actor();
  v_finding public.reference_findings;
begin
  select * into v_finding from public.reference_findings where id=p_finding_id;
  if v_finding.id is null then raise exception 'FINDING_NOT_FOUND' using errcode='P0002'; end if;
  perform app_private.require_finding_capability(v_actor,'VIEW_MONITOR'::public.cut2_capability,v_finding.inventory_id,v_finding.warehouse_id);
  return jsonb_build_object(
    'assign', v_finding.state in ('OPEN','HELD') and public.cut2_has_capability(v_finding.inventory_id,'FINDING_ASSIGN'::public.cut2_capability),
    'add_evidence', v_finding.state in ('OPEN','HELD','RESOLVED') and public.cut2_has_capability(v_finding.inventory_id,'FINDING_REPORT'::public.cut2_capability),
    'resolve', v_finding.state in ('OPEN','HELD') and public.cut2_has_capability(v_finding.inventory_id,'FINDING_RESOLVE'::public.cut2_capability)
  );
end
$function$;

revoke all on function public.get_reference_finding_detail(uuid), public.get_my_reference_finding_actions(uuid) from public, anon;
grant execute on function public.get_reference_finding_detail(uuid), public.get_my_reference_finding_actions(uuid) to authenticated;

-- The report RPC stays useful for connected C1.  This sync wrapper gives the
-- offline outbox an explicit terminal state after it has safely preserved an
-- event that became post-seal while disconnected.
create or replace function public.sync_offline_c1_reference_finding(
  p_inventory_id uuid,p_reference_type public.master_control_type,p_codigo text,p_reference_value text,
  p_finding_type public.cut2_finding_type,p_description text,p_critical boolean,p_source_event_key text,
  p_captured_at timestamptz,p_evidence jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_id uuid; v_stage public.cut2_finding_source_stage;
begin
  v_id := public.report_c1_reference_finding(p_inventory_id,p_reference_type,p_codigo,p_reference_value,p_finding_type,p_description,p_critical,p_source_event_key,p_captured_at,true,p_evidence);
  select source_stage into v_stage from public.reference_findings where id=v_id;
  return jsonb_build_object('finding_id',v_id,'sync_state',case when v_stage='OFFLINE_LATE_COUNT' then 'REVIEW_REQUIRED' else 'SYNCED' end,'review_reason',case when v_stage='OFFLINE_LATE_COUNT' then 'REFERENCE_SEALED' else null end);
end
$function$;
revoke all on function public.sync_offline_c1_reference_finding(uuid,public.master_control_type,text,text,public.cut2_finding_type,text,boolean,text,timestamptz,jsonb) from public,anon;
grant execute on function public.sync_offline_c1_reference_finding(uuid,public.master_control_type,text,text,public.cut2_finding_type,text,boolean,text,timestamptz,jsonb) to authenticated;
