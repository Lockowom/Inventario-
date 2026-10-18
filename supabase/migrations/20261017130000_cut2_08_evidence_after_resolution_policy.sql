-- CUT2-08J: late critical evidence is never discarded.  The canonical policy
-- is a controlled reopening of the same finding, not a second finding family.
alter table public.finding_evidence
  add column if not exists source_event_id text;

create unique index if not exists finding_evidence_source_event_uidx
  on public.finding_evidence(finding_id, source_event_id)
  where source_event_id is not null;

alter table public.reference_finding_events
  drop constraint if exists reference_finding_events_event_type_check;
alter table public.reference_finding_events
  add constraint reference_finding_events_event_type_check
  check(event_type in ('REPORTED','EVIDENCE_ADDED','ASSIGNED','RESOLVED','REOPENED','LINKED_SEAL'));

create or replace function public.add_reference_finding_evidence(
  p_finding_id uuid,
  p_metadata jsonb,
  p_storage_path text default null,
  p_sha256 text default null
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=app_private.require_active_actor();
  v_finding public.reference_findings;
  v_id uuid;
  v_source_event_id text:=nullif(btrim(coalesce(p_metadata->>'source_event_id','')),'');
  v_critical boolean:=coalesce(p_metadata->>'critical','false')='true';
begin
  select * into v_finding
  from public.reference_findings
  where id=p_finding_id
  for update;

  if v_finding.id is null then
    raise exception 'FINDING_NOT_FOUND' using errcode='P0002';
  end if;

  perform app_private.require_finding_capability(
    v_actor,'FINDING_REPORT',v_finding.inventory_id,v_finding.warehouse_id
  );

  if v_finding.state not in('OPEN','HELD','RESOLVED')
     or p_metadata is null
     or jsonb_typeof(p_metadata)<>'object' then
    raise exception 'EVIDENCE_METADATA_REQUIRED' using errcode='23514';
  end if;

  -- A source event is an upstream idempotency boundary.  The finding row lock
  -- serializes this check with reopening, so a retry cannot append evidence or
  -- generate a second REOPENED audit event.
  if v_source_event_id is not null then
    select id into v_id
    from public.finding_evidence
    where finding_id=v_finding.id
      and source_event_id=v_source_event_id;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  insert into public.finding_evidence(
    finding_id,storage_path,sha256,metadata,captured_by,source_event_id
  ) values(
    v_finding.id,nullif(btrim(p_storage_path),''),p_sha256,p_metadata,
    v_actor,v_source_event_id
  ) returning id into v_id;

  -- A critical observation after a decision is material new evidence.  Reopen
  -- the canonical finding while retaining the historical resolver, timestamp,
  -- and typed decision.  A later explicit resolution is therefore a new,
  -- auditable decision rather than a silent overwrite.
  if v_finding.state='RESOLVED' and v_critical then
    update public.reference_findings
    set state='OPEN',
        critical=true,
        severity='CRITICAL'::public.cut2_finding_severity,
        updated_at=now()
    where id=v_finding.id;

    insert into public.reference_finding_events(
      finding_id,event_type,actor_user_id,payload
    ) values(
      v_finding.id,'REOPENED',v_actor,
      jsonb_build_object(
        'reason','CRITICAL_EVIDENCE_AFTER_RESOLUTION',
        'evidence_id',v_id,
        'prior_resolution_code',v_finding.resolution_code,
        'prior_resolved_by',v_finding.resolved_by,
        'prior_resolved_at',v_finding.resolved_at
      )
    );
  end if;

  return v_id;
end $$;

revoke all on function public.add_reference_finding_evidence(uuid,jsonb,text,text) from public,anon;
grant execute on function public.add_reference_finding_evidence(uuid,jsonb,text,text) to authenticated;
