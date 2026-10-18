-- CUT2-08 operational model. Extends reference_findings; no parallel finding table.
alter table public.reference_findings
  add column if not exists severity public.cut2_finding_severity,
  add column if not exists source_stage public.cut2_finding_source_stage,
  add column if not exists assigned_to uuid references public.profiles(user_id) on delete restrict,
  add column if not exists assigned_at timestamptz,
  add column if not exists resolution_code public.cut2_finding_resolution_code,
  add column if not exists source_mission_id uuid references public.recount_missions(id) on delete restrict,
  add column if not exists source_subtask_id uuid references public.recount_mission_subtasks(id) on delete restrict,
  add column if not exists source_event_key text,
  add column if not exists blocks_seal boolean not null default false,
  add column if not exists blocks_recount_completion boolean not null default false,
  add column if not exists blocks_rp boolean not null default false,
  add column if not exists blocks_close boolean not null default false,
  add column if not exists last_evidence_at timestamptz;
update public.reference_findings
set severity=case when critical then 'CRITICAL'::public.cut2_finding_severity else 'LOW'::public.cut2_finding_severity end,
    source_stage=case when source_client_count_id is not null then 'OFFLINE_LATE_COUNT'::public.cut2_finding_source_stage when reference_id is not null then 'POST_SEAL'::public.cut2_finding_source_stage else 'PRE_SEAL'::public.cut2_finding_source_stage end
where severity is null or source_stage is null;
update public.reference_findings set resolution_code='NO_ADJUSTMENT_REQUIRED'::public.cut2_finding_resolution_code where state='RESOLVED' and resolution_code is null;
alter table public.reference_findings alter column severity set not null, alter column source_stage set not null;
alter table public.reference_findings
  alter column severity set default 'MEDIUM'::public.cut2_finding_severity,
  alter column source_stage set default 'MANUAL_REVIEW'::public.cut2_finding_source_stage;
alter table public.reference_findings add constraint reference_findings_resolution_code_check check (state <> 'RESOLVED' or resolution_code is not null);
create unique index if not exists reference_findings_source_event_key_uidx on public.reference_findings(source_event_key) where source_event_key is not null;
create index if not exists reference_findings_operational_queue_idx on public.reference_findings(inventory_id,warehouse_id,state,severity,created_at desc) where state in ('OPEN','HELD');
create index if not exists reference_findings_mission_blocker_idx on public.reference_findings(source_mission_id,state) where blocks_recount_completion and state in ('OPEN','HELD');

create table if not exists public.reference_finding_events (
 id uuid primary key default gen_random_uuid(),
 finding_id uuid not null references public.reference_findings(id) on delete restrict,
 event_type text not null check(event_type in ('REPORTED','EVIDENCE_ADDED','ASSIGNED','RESOLVED','LINKED_SEAL')),
 actor_user_id uuid references public.profiles(user_id) on delete restrict,
 payload jsonb not null default '{}'::jsonb check(jsonb_typeof(payload)='object'),
 created_at timestamptz not null default now()
);
create index if not exists reference_finding_events_finding_idx on public.reference_finding_events(finding_id,created_at);
alter table public.reference_finding_events enable row level security;
revoke all on public.reference_finding_events from public,anon,authenticated;
grant select on public.reference_finding_events to authenticated;
create policy reference_finding_events_scoped_read on public.reference_finding_events for select to authenticated using (
 exists(select 1 from public.reference_findings f where f.id=finding_id and app_private.actor_has_capability(auth.uid(),'VIEW_MONITOR',f.inventory_id,f.warehouse_id))
);

create or replace function app_private.apply_reference_finding_policy() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Legacy RPCs deliberately keep their wire contracts.  Infer their source
 -- and severity here, before deriving gates, so a critical pre-seal finding
 -- cannot silently become a non-blocking MANUAL_REVIEW row.
 if new.source_stage='MANUAL_REVIEW'::public.cut2_finding_source_stage then
   new.source_stage:=case when new.source_client_count_id is not null then 'OFFLINE_LATE_COUNT'::public.cut2_finding_source_stage when new.reference_id is not null then 'POST_SEAL'::public.cut2_finding_source_stage else 'PRE_SEAL'::public.cut2_finding_source_stage end;
 end if;
 if new.critical and new.severity='MEDIUM'::public.cut2_finding_severity then
   new.severity:='CRITICAL'::public.cut2_finding_severity;
 end if;
 if new.severity='CRITICAL'::public.cut2_finding_severity then new.critical:=true; end if;
 new.blocks_seal:=new.severity in ('HIGH'::public.cut2_finding_severity,'CRITICAL'::public.cut2_finding_severity) and new.source_stage in ('C1'::public.cut2_finding_source_stage,'PRE_SEAL'::public.cut2_finding_source_stage,'ROLLING_CUT'::public.cut2_finding_source_stage);
 new.blocks_recount_completion:=new.severity='CRITICAL'::public.cut2_finding_severity and new.source_mission_id is not null;
 new.blocks_rp:=new.severity in ('HIGH'::public.cut2_finding_severity,'CRITICAL'::public.cut2_finding_severity) or new.finding_type='AUTHORIZATION_REVOKED_OFFLINE'::public.cut2_finding_type;
 new.blocks_close:=new.severity='CRITICAL'::public.cut2_finding_severity or new.finding_type='AUTHORIZATION_REVOKED_OFFLINE'::public.cut2_finding_type;
 return new;
end $$;
create trigger reference_findings_apply_operational_policy before insert or update of severity,source_stage,source_mission_id,finding_type on public.reference_findings for each row execute function app_private.apply_reference_finding_policy();

create or replace function app_private.audit_reference_finding() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then insert into public.reference_finding_events(finding_id,event_type,actor_user_id,payload) values(new.id,'REPORTED',new.created_by,jsonb_build_object('source_stage',new.source_stage,'severity',new.severity,'source_event_key',new.source_event_key));
 elsif new.state='RESOLVED' and old.state<>'RESOLVED' then insert into public.reference_finding_events(finding_id,event_type,actor_user_id,payload) values(new.id,'RESOLVED',new.resolved_by,jsonb_build_object('resolution_code',new.resolution_code,'resolution',new.resolution));
 elsif new.assigned_to is distinct from old.assigned_to then insert into public.reference_finding_events(finding_id,event_type,actor_user_id,payload) values(new.id,'ASSIGNED',new.created_by,jsonb_build_object('assigned_to',new.assigned_to));
 elsif new.reference_id is distinct from old.reference_id and new.reference_id is not null then insert into public.reference_finding_events(finding_id,event_type,actor_user_id,payload) values(new.id,'LINKED_SEAL',new.created_by,jsonb_build_object('sealed_reference_id',new.reference_id));
 end if; return new;
end $$;
create trigger reference_findings_audit_operational_history after insert or update on public.reference_findings for each row execute function app_private.audit_reference_finding();

create or replace function app_private.audit_finding_evidence() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.reference_findings set last_evidence_at=greatest(coalesce(last_evidence_at,'-infinity'::timestamptz),new.captured_at),updated_at=now() where id=new.finding_id;
 insert into public.reference_finding_events(finding_id,event_type,actor_user_id,payload) values(new.finding_id,'EVIDENCE_ADDED',new.captured_by,jsonb_build_object('evidence_id',new.id,'storage_path',new.storage_path,'metadata',new.metadata));
 return new;
end $$;
create trigger finding_evidence_audit_operational_history after insert on public.finding_evidence for each row execute function app_private.audit_finding_evidence();

insert into public.cut2_user_type_capability_allowlist(user_type,capability) values('PERMANENT','FINDING_ASSIGN') on conflict do nothing;
insert into public.cut2_default_capability_policies(role,user_type,capability,scope) values ('CONTADOR','PERMANENT','FINDING_REPORT','INVENTORY'),('ANALISTA','PERMANENT','FINDING_ASSIGN','INVENTORY'),('ADMIN','PERMANENT','FINDING_ASSIGN','GLOBAL') on conflict do nothing;

create or replace function app_private.require_finding_capability(p_actor uuid,p_capability public.cut2_capability,p_inventory_id uuid,p_warehouse_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform app_private.require_active_actor();
 if p_actor is null or p_actor<>auth.uid() or not app_private.actor_has_capability(p_actor,p_capability,p_inventory_id,p_warehouse_id) then raise exception 'CAPABILITY_REQUIRED' using errcode='42501',detail=p_capability::text; end if;
end $$;

create or replace function public.resolve_reference_finding(p_finding_id uuid,p_resolution_code public.cut2_finding_resolution_code,p_resolution_note text) returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=app_private.require_active_actor(); v_finding public.reference_findings;
begin
 select * into v_finding from public.reference_findings where id=p_finding_id for update;
 if v_finding.id is null then raise exception 'FINDING_NOT_FOUND' using errcode='P0002'; end if;
 perform app_private.require_finding_capability(v_actor,'FINDING_RESOLVE',v_finding.inventory_id,v_finding.warehouse_id);
 if v_finding.state='RESOLVED' then return v_finding.id; end if;
 if v_finding.state not in('OPEN','HELD') or p_resolution_code is null or length(btrim(coalesce(p_resolution_note,'')))=0 then raise exception 'RESOLUTION_DECISION_REQUIRED' using errcode='23514'; end if;
 update public.reference_findings set state='RESOLVED',resolved_by=v_actor,resolved_at=now(),resolution_code=p_resolution_code,resolution=btrim(p_resolution_note),updated_at=now() where id=v_finding.id;
 return v_finding.id;
end $$;

create or replace function public.assign_reference_finding(p_finding_id uuid,p_assigned_to uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid:=app_private.require_active_actor(); f public.reference_findings;
begin
 select * into f from public.reference_findings where id=p_finding_id for update;
 if f.id is null then raise exception 'FINDING_NOT_FOUND' using errcode='P0002'; end if;
 perform app_private.require_finding_capability(a,'FINDING_ASSIGN',f.inventory_id,f.warehouse_id);
 if f.state not in('OPEN','HELD') then raise exception 'FINDING_NOT_OPEN' using errcode='23514'; end if;
 if p_assigned_to is not null and not app_private.actor_has_capability(p_assigned_to,'FINDING_RESOLVE',f.inventory_id,f.warehouse_id) then raise exception 'ASSIGNEE_CANNOT_RESOLVE_FINDING' using errcode='42501'; end if;
 update public.reference_findings set assigned_to=p_assigned_to,assigned_at=case when p_assigned_to is null then null else now() end,updated_at=now() where id=f.id;
 return f.id;
end $$;
revoke all on function public.assign_reference_finding(uuid,uuid) from public,anon;
grant execute on function public.assign_reference_finding(uuid,uuid) to authenticated;

create or replace function public.add_reference_finding_evidence(p_finding_id uuid,p_metadata jsonb,p_storage_path text default null,p_sha256 text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=app_private.require_active_actor(); v_finding public.reference_findings; v_id uuid;
begin
 select * into v_finding from public.reference_findings where id=p_finding_id for update;
 if v_finding.id is null then raise exception 'FINDING_NOT_FOUND' using errcode='P0002'; end if;
 perform app_private.require_finding_capability(v_actor,'FINDING_REPORT',v_finding.inventory_id,v_finding.warehouse_id);
 if v_finding.state not in('OPEN','HELD') or p_metadata is null or jsonb_typeof(p_metadata)<>'object' then raise exception 'EVIDENCE_METADATA_REQUIRED' using errcode='23514'; end if;
 insert into public.finding_evidence(finding_id,storage_path,sha256,metadata,captured_by) values(v_finding.id,nullif(btrim(p_storage_path),''),p_sha256,p_metadata,v_actor) returning id into v_id; return v_id;
end $$;

create or replace function public.report_my_recount_finding(p_subtask_id uuid,p_finding public.recount_finding_type,p_note text default null) returns void language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=app_private.require_active_actor(); v_mission public.recount_missions; v_warehouse uuid; v_note text:=nullif(btrim(p_note),'');
begin
 select m.* into v_mission from public.recount_mission_subtasks s join public.recount_missions m on m.id=s.mission_id where s.id=p_subtask_id;
 if v_mission.id is null or v_mission.status<>'ACTIVE' or v_mission.assigned_user_id<>v_actor then raise exception 'MISSION_ASSIGNMENT_CHANGED' using errcode='42501'; end if;
 select warehouse_id into v_warehouse from public.inventories where id=v_mission.inventory_id;
 perform app_private.require_finding_capability(v_actor,'FINDING_REPORT',v_mission.inventory_id,v_warehouse);
 if exists(select 1 from public.recount_subtask_findings f where f.subtask_id=p_subtask_id and f.finding_type=p_finding and f.created_by=v_actor and f.note is not distinct from v_note) then return; end if;
 insert into public.recount_subtask_findings(subtask_id,finding_type,note,created_by) values(p_subtask_id,p_finding,v_note,v_actor);
end $$;

create or replace function app_private.bridge_recount_subtask_finding() returns trigger language plpgsql security definer set search_path='' as $$
declare m public.recount_missions; c public.reconciliation_cases; w uuid; ref uuid; ftype public.cut2_finding_type; fid uuid;
begin
 select m0.* into m from public.recount_mission_subtasks s join public.recount_missions m0 on m0.id=s.mission_id where s.id=new.subtask_id;
 select * into c from public.reconciliation_cases where id=m.case_id;
 select warehouse_id into w from public.inventories where id=m.inventory_id;
 select coalesce(m.source_sealed_reference_id,c2.source_sealed_reference_id) into ref from public.recount_missions c2 where c2.id=m.source_c2_mission_id;
 if ref is null then ref:=m.source_sealed_reference_id; end if;
 ftype:=case new.finding_type when 'DAMAGED' then 'PHYSICAL_DAMAGE'::public.cut2_finding_type when 'ILLEGIBLE_SERIAL' then 'SERIAL_ILLEGIBLE'::public.cut2_finding_type when 'ILLEGIBLE_BATCH' then 'BATCH_ILLEGIBLE'::public.cut2_finding_type when 'WRONG_LOCATION' then 'LOCATION_MISMATCH'::public.cut2_finding_type when 'WRONG_LABEL' then 'LABEL_MISMATCH'::public.cut2_finding_type when 'DUPLICATE_PHYSICAL_LABEL' then 'DUPLICATE_SERIAL'::public.cut2_finding_type else 'OTHER'::public.cut2_finding_type end;
 insert into public.reference_findings(inventory_id,warehouse_id,reference_id,reference_type,normalized_reference_key,finding_type,severity,source_stage,source_mission_id,source_subtask_id,source_event_key,critical,description,created_by)
 values(m.inventory_id,w,ref,c.reference_type,public.normalize_reference_key(c.reference_type,c.codigo,c.reference_value),ftype,case when new.finding_type in('DAMAGED','DUPLICATE_PHYSICAL_LABEL') then 'CRITICAL'::public.cut2_finding_severity else 'MEDIUM'::public.cut2_finding_severity end,case when m.round=3 then 'C3'::public.cut2_finding_source_stage else 'C2'::public.cut2_finding_source_stage end,m.id,new.subtask_id,'recount-subtask-finding:'||new.id::text,new.finding_type in('DAMAGED','DUPLICATE_PHYSICAL_LABEL'),coalesce(new.note,'Hallazgo registrado durante reconteo.'),new.created_by)
 on conflict(source_event_key) where source_event_key is not null do update set updated_at=public.reference_findings.updated_at returning id into fid;
 insert into public.finding_evidence(finding_id,metadata,captured_by,captured_at) values(fid,jsonb_build_object('recount_subtask_finding_id',new.id,'subtask_id',new.subtask_id,'recount_finding_type',new.finding_type),new.created_by,new.created_at);
 return new;
end $$;
create trigger recount_subtask_findings_bridge_canonical after insert on public.recount_subtask_findings for each row execute function app_private.bridge_recount_subtask_finding();

create or replace function app_private.guard_recount_completion_findings() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='COMPLETED' and old.status<>'COMPLETED' and exists(select 1 from public.reference_findings f where f.source_mission_id=new.id and f.blocks_recount_completion and f.state in('OPEN','HELD')) then raise exception 'FINDING_BLOCKS_RECOUNT_COMPLETION' using errcode='23514'; end if;
 return new;
end $$;
create trigger recount_missions_guard_finding_completion before update of status on public.recount_missions for each row execute function app_private.guard_recount_completion_findings();

create or replace function public.get_finding_eligibility(p_inventory_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a uuid:=app_private.require_active_actor(); w uuid;
begin
 select warehouse_id into w from public.inventories where id=p_inventory_id;
 perform app_private.require_finding_capability(a,'VIEW_MONITOR',p_inventory_id,w);
 return (select jsonb_build_object('rp_eligible',not exists(select 1 from public.reference_findings f where f.inventory_id=p_inventory_id and f.state in('OPEN','HELD') and f.blocks_rp),'close_eligible',not exists(select 1 from public.reference_findings f where f.inventory_id=p_inventory_id and f.state in('OPEN','HELD') and f.blocks_close),'rp_blocking_findings',count(*) filter(where f.blocks_rp),'close_blocking_findings',count(*) filter(where f.blocks_close)) from public.reference_findings f where f.inventory_id=p_inventory_id and f.state in('OPEN','HELD'));
end $$;

create or replace function public.get_live_monitor_findings(p_inventory_id uuid,p_limit integer default 100)
returns table(id uuid,finding_type text,severity text,state text,source_stage text,codigo text,reference_type text,normalized_reference_key text,description text,assigned_to uuid,reported_at timestamptz,source_mission_id uuid,source_cut_id uuid,blocks_seal boolean,blocks_recount_completion boolean,blocks_rp boolean,blocks_close boolean,evidence_count bigint,last_evidence_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare a uuid:=app_private.require_active_actor(); w uuid;
begin
 select warehouse_id into w from public.inventories where id=p_inventory_id;
 perform app_private.require_finding_capability(a,'VIEW_MONITOR',p_inventory_id,w);
 if p_limit is null or p_limit<1 or p_limit>500 then raise exception 'INVALID_LIMIT' using errcode='22023'; end if;
 return query select f.id,f.finding_type::text,f.severity::text,f.state::text,f.source_stage::text,coalesce(sr.codigo,rc.codigo,''),f.reference_type::text,f.normalized_reference_key,f.description,f.assigned_to,f.created_at,f.source_mission_id,coalesce(m.source_cut_id,rc.source_cut_id),f.blocks_seal,f.blocks_recount_completion,f.blocks_rp,f.blocks_close,count(e.id),f.last_evidence_at from public.reference_findings f left join public.inventory_sealed_references sr on sr.id=f.reference_id left join public.recount_missions m on m.id=f.source_mission_id left join public.reconciliation_cases rc on rc.id=m.case_id left join public.finding_evidence e on e.finding_id=f.id where f.inventory_id=p_inventory_id and f.warehouse_id=w group by f.id,sr.codigo,rc.codigo,m.source_cut_id,rc.source_cut_id order by case f.severity when 'CRITICAL' then 1 when 'HIGH' then 2 when 'MEDIUM' then 3 when 'LOW' then 4 else 5 end,f.created_at desc limit p_limit;
end $$;

revoke all on function app_private.apply_reference_finding_policy(),app_private.audit_reference_finding(),app_private.audit_finding_evidence(),app_private.require_finding_capability(uuid,public.cut2_capability,uuid,uuid),app_private.bridge_recount_subtask_finding(),app_private.guard_recount_completion_findings() from public,anon,authenticated;
revoke all on function public.resolve_reference_finding(uuid,public.cut2_finding_resolution_code,text),public.add_reference_finding_evidence(uuid,jsonb,text,text),public.report_my_recount_finding(uuid,public.recount_finding_type,text),public.get_finding_eligibility(uuid),public.get_live_monitor_findings(uuid,integer) from public,anon;
grant execute on function public.resolve_reference_finding(uuid,public.cut2_finding_resolution_code,text),public.add_reference_finding_evidence(uuid,jsonb,text,text),public.report_my_recount_finding(uuid,public.recount_finding_type,text),public.get_finding_eligibility(uuid),public.get_live_monitor_findings(uuid,integer) to authenticated;

-- Preserve the pre-seal public contract while translating its historical text
-- resolution into the typed CUT2-08 decision record.
create or replace function public.resolve_preseal_reference_finding(
  p_finding_id uuid,
  p_resolution text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := app_private.require_active_actor();
  v_finding public.reference_findings;
begin
  select * into v_finding from public.reference_findings where id=p_finding_id for update;
  if v_finding.id is null then raise exception 'Finding not found' using errcode='P0002'; end if;
  if not app_private.can_manage_inventory(v_finding.inventory_id) then raise exception 'Not authorized to resolve a pre-seal finding' using errcode='42501'; end if;
  if length(btrim(coalesce(p_resolution,'')))=0 then raise exception 'Resolution is required' using errcode='23514'; end if;
  perform app_private.lock_inventory(v_finding.inventory_id);
  update public.reference_findings
  set state='RESOLVED',resolved_by=v_actor,resolved_at=now(),
      resolution_code='NO_ADJUSTMENT_REQUIRED'::public.cut2_finding_resolution_code,
      resolution=p_resolution,updated_at=now()
  where id=p_finding_id and state in ('OPEN','HELD');
  if not found then raise exception 'Finding is not open' using errcode='23514'; end if;
  insert into public.preseal_guard_events(inventory_id,warehouse_id,reference_type,normalized_reference_key,finding_id,event_type,actor_user_id,payload)
  values(v_finding.inventory_id,v_finding.warehouse_id,v_finding.reference_type,v_finding.normalized_reference_key,v_finding.id,'PRESEAL_FINDING_RESOLVED',v_actor,jsonb_build_object('resolution',p_resolution,'resolution_code','NO_ADJUSTMENT_REQUIRED'));
end
$function$;
revoke all on function public.resolve_preseal_reference_finding(uuid,text) from public,anon;
grant execute on function public.resolve_preseal_reference_finding(uuid,text) to authenticated;
