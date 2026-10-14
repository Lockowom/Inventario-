-- CUT2-03K: a canonical reference exists before the first rolling seal.
-- This migration records C1 UOM evidence and lets the existing finding model
-- anchor to that identity without inventing a sealed reference.

alter table public.count_records
  add column if not exists physical_uom text,
  add column if not exists uom_source text not null default 'LEGACY_UNKNOWN'
    check (uom_source in ('EXPLICIT', 'LEGACY_UNKNOWN'));

alter table public.count_records
  add constraint count_records_physical_uom_format_check check (
    physical_uom is null
    or (physical_uom = upper(btrim(physical_uom)) and length(physical_uom) between 1 and 32)
  ),
  add constraint count_records_physical_uom_source_check check (
    (physical_uom is null and uom_source = 'LEGACY_UNKNOWN')
    or (physical_uom is not null and uom_source = 'EXPLICIT')
  );

-- Existing clients and historical rows remain readable.  An inventory opts in
-- to requiring physical-UOM evidence only when its operational policy says so;
-- NULL never means "equal to the system UOM".
alter table public.inventories
  add column if not exists require_physical_uom_evidence boolean not null default false;

alter table public.reference_findings
  add column if not exists reference_type public.master_control_type,
  add column if not exists normalized_reference_key text;

update public.reference_findings f
set reference_type = r.reference_type,
    normalized_reference_key = r.normalized_reference_key
from public.inventory_sealed_references r
where r.id = f.reference_id
  and (f.reference_type is null or f.normalized_reference_key is null);

-- NOT VALID deliberately preserves any legacy evidence that predates the
-- canonical model, while enforcing the new invariant for all future writes.
alter table public.reference_findings
  add constraint reference_findings_canonical_anchor_check check (
    reference_type is not null
    and normalized_reference_key is not null
    and length(btrim(normalized_reference_key)) between 1 and 512
  ) not valid;

-- Existing administrative integrations inserted findings through reference_id.
-- Keep that legitimate post-seal contract, deriving (rather than guessing) the
-- canonical anchor from the referenced sealed row before validation.
create or replace function app_private.populate_reference_finding_canonical_anchor()
returns trigger
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $function$
declare
  v_reference public.inventory_sealed_references;
begin
  if new.reference_id is not null and (new.reference_type is null or new.normalized_reference_key is null) then
    select * into v_reference from public.inventory_sealed_references where id = new.reference_id;
    if v_reference.id is null then raise exception 'Sealed reference not found' using errcode = '23503'; end if;
    if v_reference.inventory_id <> new.inventory_id or v_reference.warehouse_id <> new.warehouse_id then
      raise exception 'Finding reference does not belong to inventory warehouse' using errcode = '23514';
    end if;
    new.reference_type := v_reference.reference_type;
    new.normalized_reference_key := v_reference.normalized_reference_key;
  end if;
  return new;
end
$function$;
create trigger reference_findings_populate_canonical_anchor
before insert or update of reference_id, inventory_id, warehouse_id on public.reference_findings
for each row execute function app_private.populate_reference_finding_canonical_anchor();

create index if not exists reference_findings_canonical_open_idx
  on public.reference_findings (inventory_id, warehouse_id, reference_type, normalized_reference_key)
  where state in ('OPEN', 'HELD');

create index if not exists count_records_preseal_uom_identity_idx
  on public.count_records (inventory_id, codigo, serie, partida)
  where physical_uom is not null;

-- An append-only event stream avoids overloading the legacy audit enum and
-- gives the pre-seal identity its own durable, manager-only trace.
create table public.preseal_guard_events (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories(id) on delete restrict,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  reference_type public.master_control_type not null,
  normalized_reference_key text not null check (length(btrim(normalized_reference_key)) between 1 and 512),
  count_record_id uuid references public.count_records(id) on delete restrict,
  finding_id uuid references public.reference_findings(id) on delete restrict,
  event_type text not null check (event_type in ('UOM_EVIDENCE_RECORDED', 'PRESEAL_FINDING_CREATED', 'PRESEAL_FINDING_RESOLVED', 'PRESEAL_FINDING_LINKED')),
  actor_user_id uuid references public.profiles(user_id) on delete restrict,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (inventory_id, warehouse_id) references public.inventories(id, warehouse_id) on delete restrict
);
create index preseal_guard_events_identity_idx
  on public.preseal_guard_events (inventory_id, warehouse_id, reference_type, normalized_reference_key, created_at desc);
alter table public.preseal_guard_events enable row level security;
revoke all on public.preseal_guard_events from public, anon, authenticated;
grant select on public.preseal_guard_events to authenticated;
create policy preseal_guard_events_manager_read on public.preseal_guard_events
  for select to authenticated using ((select app_private.can_manage_inventory(inventory_id)));

create or replace function app_private.preseal_uom_status_v2(
  p_inventory_id uuid,
  p_reference_type public.master_control_type,
  p_normalized_reference_key text,
  p_system_uom text
)
returns text
language plpgsql
stable
security definer
set search_path = public, app_private, pg_temp
as $function$
declare
  v_total integer;
  v_explicit integer;
  v_distinct integer;
  v_first_uom text;
  v_system_uom text := nullif(upper(btrim(p_system_uom)), '');
begin
  if v_system_uom is null then return 'NOT_APPLICABLE'; end if;
  select count(*)::integer,
         count(c.physical_uom)::integer,
         count(distinct c.physical_uom)::integer,
         min(c.physical_uom)
    into v_total, v_explicit, v_distinct, v_first_uom
  from public.count_records c
  join public.inventory_master_items m
    on m.inventory_id = c.inventory_id and m.codigo = c.codigo
  where c.inventory_id = p_inventory_id
    and not exists (select 1 from public.recount_mission_observations o where o.count_record_id = c.id)
    and public.normalize_reference_key(
      m.control_type,
      c.codigo,
      case when m.control_type = 'SERIAL' then c.serie when m.control_type = 'PARTIDA' then c.partida else null end
    ) = p_normalized_reference_key
    and m.control_type = p_reference_type;

  if coalesce(v_total, 0) = 0 then return 'NOT_APPLICABLE'; end if;
  if coalesce(v_explicit, 0) = 0 or v_explicit <> v_total then return 'MISSING_EVIDENCE'; end if;
  if v_distinct > 1 then return 'UOM_CONFLICT'; end if;
  if v_first_uom <> v_system_uom then return 'MISMATCH'; end if;
  return 'MATCH';
end
$function$;

-- Preserve the CUT2-02 read model as a private base function.  The public
-- wrapper below only enriches the read-only projection with pre-seal guards.
alter function public.preview_rolling_cut_v2(uuid, uuid, jsonb)
  rename to preview_rolling_cut_v2_base;
alter function public.preview_rolling_cut_v2_base(uuid, uuid, jsonb)
  set schema app_private;

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
as $function$
declare
  v_base jsonb;
  v_items jsonb;
  v_summary jsonb;
  v_fingerprint text;
  v_require_evidence boolean;
begin
  -- The base function retains its active-actor, authority and warehouse
  -- checks, so this wrapper does not widen the public surface.
  v_base := app_private.preview_rolling_cut_v2_base(p_inventory_id, p_warehouse_id, p_selection);
  select require_physical_uom_evidence into v_require_evidence
  from public.inventories where id = p_inventory_id;

  with base_items as (
    select item
    from jsonb_array_elements(v_base -> 'items') item
  ), classified as (
    select b.item,
      app_private.preseal_uom_status_v2(
        p_inventory_id,
        (b.item ->> 'reference_type')::public.master_control_type,
        b.item ->> 'normalized_reference_key',
        b.item ->> 'uom'
      ) as uom_status,
      exists (
        select 1 from public.reference_findings f
        where f.inventory_id = p_inventory_id
          and f.warehouse_id = (v_base #>> '{summary,warehouse_id}')::uuid
          and f.reference_type = (b.item ->> 'reference_type')::public.master_control_type
          and f.normalized_reference_key = b.item ->> 'normalized_reference_key'
          and f.state in ('OPEN', 'HELD') and f.critical
      ) as preseal_critical
    from base_items b
  ), guarded as (
    select c.*,
      case
        when nullif(c.item ->> 'block_reason', '') is not null then c.item ->> 'block_reason'
        when c.uom_status = 'UOM_CONFLICT' then 'UOM_CONFLICT'
        when c.uom_status = 'MISMATCH' then 'UOM_MISMATCH'
        when c.uom_status = 'MISSING_EVIDENCE' and coalesce(v_require_evidence, false) then 'UOM_EVIDENCE_MISSING'
        when c.preseal_critical then 'CRITICAL_FINDING_OPEN'
        else null
      end as next_block
    from classified c
  ), rendered as (
    select jsonb_set(
             jsonb_set(
               jsonb_set(
                 jsonb_set(g.item, '{uom_status}', to_jsonb(g.uom_status), true),
                '{block_reason}', coalesce(to_jsonb(g.next_block), 'null'::jsonb), true
               ),
               '{eligibility}', to_jsonb(g.next_block is null and coalesce((g.item ->> 'c1_quantity')::integer, 0) > 0), true
             ),
             '{estimated_result}', to_jsonb(case when g.next_block is not null then 'BLOCKED' else g.item ->> 'estimated_result' end), true
           ) as item
    from guarded g
  )
  select coalesce(jsonb_agg(item order by item ->> 'normalized_reference_key'), '[]'::jsonb)
    into v_items
  from rendered;

  v_summary := (v_base -> 'summary') || jsonb_build_object(
    'eligible_reference_count', (select count(*) from jsonb_array_elements(v_items) i where nullif(i ->> 'block_reason', '') is null and coalesce((i ->> 'c1_quantity')::integer, 0) > 0),
    'blocked_reference_count', (select count(*) from jsonb_array_elements(v_items) i where nullif(i ->> 'block_reason', '') is not null),
    -- The base preview still exposes post-seal UOM cases.  Add the genuinely
    -- pre-seal statuses instead of erasing that historical visibility.
    'uom_mismatch_count', coalesce((v_base #>> '{summary,uom_mismatch_count}')::integer, 0) + (select count(*) from jsonb_array_elements(v_items) i where i ->> 'uom_status' in ('MISMATCH', 'UOM_CONFLICT')),
    'uom_missing_evidence_count', (select count(*) from jsonb_array_elements(v_items) i where i ->> 'uom_status' = 'MISSING_EVIDENCE'),
    'uom_conflict_count', (select count(*) from jsonb_array_elements(v_items) i where i ->> 'uom_status' = 'UOM_CONFLICT'),
    'critical_findings_count', coalesce((v_base #>> '{summary,critical_findings_count}')::integer, 0) + (select count(*) from jsonb_array_elements(v_items) i where i ->> 'block_reason' = 'CRITICAL_FINDING_OPEN'),
    'rp_ready_estimate', (select count(*) from jsonb_array_elements(v_items) i where i ->> 'estimated_result' = 'RP_READY_ESTIMATE'),
    'c2_required_estimate', (select count(*) from jsonb_array_elements(v_items) i where i ->> 'estimated_result' = 'C2_REQUIRED_ESTIMATE')
  );

  select encode(extensions.digest(convert_to(
    concat_ws(E'\\x1f',
      v_base ->> 'preview_fingerprint',
      coalesce(string_agg(concat_ws(E'\\x1e', i ->> 'normalized_reference_key', i ->> 'uom_status', coalesce(i ->> 'block_reason', ''), i ->> 'estimated_result'), E'\\x1d' order by i ->> 'normalized_reference_key'), '')
    ), 'utf8'), 'sha256'), 'hex')
  into v_fingerprint
  from jsonb_array_elements(v_items) i;

  return v_base || jsonb_build_object('summary', v_summary, 'items', v_items, 'preview_fingerprint', v_fingerprint);
end
$function$;

create or replace function public.create_preseal_reference_finding(
  p_inventory_id uuid,
  p_reference_type public.master_control_type,
  p_normalized_reference_key text,
  p_finding_type public.cut2_finding_type,
  p_description text,
  p_critical boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $function$
declare
  v_actor uuid := app_private.require_active_actor();
  v_inventory public.inventories;
  v_reference_id uuid;
  v_finding_id uuid;
begin
  if not app_private.can_manage_inventory(p_inventory_id) then
    raise exception 'Not authorized to classify a pre-seal finding' using errcode = '42501';
  end if;
  if p_normalized_reference_key is null or length(btrim(p_normalized_reference_key)) not between 1 and 512 then
    raise exception 'Canonical reference identity is required' using errcode = '23514';
  end if;
  v_inventory := app_private.lock_inventory(p_inventory_id);
  if not exists (
    select 1
    from public.inventory_master_items m
    where m.inventory_id = p_inventory_id
      and m.control_type = p_reference_type
      and exists (
        select 1 from public.count_records c
        where c.inventory_id = p_inventory_id and c.codigo = m.codigo
          and public.normalize_reference_key(m.control_type, c.codigo, case when m.control_type='SERIAL' then c.serie when m.control_type='PARTIDA' then c.partida else null end) = p_normalized_reference_key
      )
    union all
    select 1 from public.inventory_system_reference_items s
    where s.inventory_id = p_inventory_id and s.reference_type = p_reference_type
      and public.normalize_reference_key(s.reference_type, s.codigo, s.reference_value) = p_normalized_reference_key
  ) then
    raise exception 'Canonical reference identity is unknown for inventory' using errcode = '23514';
  end if;
  select id into v_reference_id
  from public.inventory_sealed_references
  where inventory_id = p_inventory_id and warehouse_id = v_inventory.warehouse_id
    and reference_type = p_reference_type and normalized_reference_key = p_normalized_reference_key;
  insert into public.reference_findings(
    inventory_id, warehouse_id, reference_id, reference_type, normalized_reference_key,
    finding_type, critical, description, created_by
  ) values (
    p_inventory_id, v_inventory.warehouse_id, v_reference_id, p_reference_type, p_normalized_reference_key,
    p_finding_type, p_critical, p_description, v_actor
  ) returning id into v_finding_id;
  insert into public.preseal_guard_events(inventory_id, warehouse_id, reference_type, normalized_reference_key, finding_id, event_type, actor_user_id, payload)
  values (p_inventory_id, v_inventory.warehouse_id, p_reference_type, p_normalized_reference_key, v_finding_id, 'PRESEAL_FINDING_CREATED', v_actor,
    jsonb_build_object('finding_type', p_finding_type, 'critical', p_critical, 'sealed_reference_id', v_reference_id));
  return v_finding_id;
end
$function$;

create or replace function public.resolve_preseal_reference_finding(
  p_finding_id uuid,
  p_resolution text
)
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $function$
declare
  v_actor uuid := app_private.require_active_actor();
  v_finding public.reference_findings;
begin
  select * into v_finding from public.reference_findings where id = p_finding_id for update;
  if v_finding.id is null then raise exception 'Finding not found' using errcode = 'P0002'; end if;
  if not app_private.can_manage_inventory(v_finding.inventory_id) then raise exception 'Not authorized to resolve a pre-seal finding' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_resolution, ''))) = 0 then raise exception 'Resolution is required' using errcode = '23514'; end if;
  perform app_private.lock_inventory(v_finding.inventory_id);
  update public.reference_findings
  set state = 'RESOLVED', resolved_by = v_actor, resolved_at = now(), resolution = p_resolution, updated_at = now()
  where id = p_finding_id and state in ('OPEN', 'HELD');
  if not found then raise exception 'Finding is not open' using errcode = '23514'; end if;
  insert into public.preseal_guard_events(inventory_id, warehouse_id, reference_type, normalized_reference_key, finding_id, event_type, actor_user_id, payload)
  values (v_finding.inventory_id, v_finding.warehouse_id, v_finding.reference_type, v_finding.normalized_reference_key, v_finding.id, 'PRESEAL_FINDING_RESOLVED', v_actor,
    jsonb_build_object('resolution', p_resolution));
end
$function$;

create or replace function app_private.link_preseal_findings_on_seal()
returns trigger
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $function$
declare
  v_finding_id uuid;
begin
  if old.state = 'SEALED' or new.state <> 'SEALED' then return new; end if;
  for v_finding_id in
    update public.reference_findings
    set reference_id = new.id, updated_at = now()
    where inventory_id = new.inventory_id and warehouse_id = new.warehouse_id
      and reference_type = new.reference_type and normalized_reference_key = new.normalized_reference_key
      and reference_id is null
    returning id
  loop
    insert into public.preseal_guard_events(inventory_id, warehouse_id, reference_type, normalized_reference_key, finding_id, event_type, actor_user_id, payload)
    values (new.inventory_id, new.warehouse_id, new.reference_type, new.normalized_reference_key, v_finding_id, 'PRESEAL_FINDING_LINKED', new.sealed_by,
      jsonb_build_object('sealed_reference_id', new.id, 'cut_id', new.cut_id));
  end loop;
  return new;
end
$function$;

create trigger inventory_sealed_references_link_preseal_findings
after update of state on public.inventory_sealed_references
for each row execute function app_private.link_preseal_findings_on_seal();

-- The C1 protocol remains backward-compatible: physical_uom is optional on
-- the wire, but an explicit value is immutable and is recorded server-side.
create or replace function public.sync_counts(
  p_inventory_id uuid,p_device_id uuid,p_platform public.device_platform,p_app_version text,p_device_label text,p_records jsonb
)
returns table(client_count_id uuid,result_status text,server_count_id uuid,received_at timestamptz,reason text)
language plpgsql security definer
set search_path=public,app_private,pg_temp
as $function$
declare
  v_actor uuid:=app_private.require_active_actor();
  v_inventory public.inventories;
  v_record jsonb;
  v_forwarded jsonb:='[]'::jsonb;
  v_client_count_id uuid;
  v_codigo text;
  v_serie text;
  v_partida text;
  v_master public.inventory_master_items;
  v_key text;
  v_sealed_id uuid;
  v_recount_id uuid;
  v_existing public.count_records;
  v_physical_uom text;
  v_result record;
  v_result_uom text;
begin
  -- The preserved F16 implementation remains the single attachment path for
  -- recount_mission_observations and continues to reject ordinary C1 as
  -- C1_COMPLETED once coverage has closed.
  if p_records is null or jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)=0 or jsonb_array_length(p_records)>20 then
    return query select * from app_private.sync_counts_pre_cut2_03(p_inventory_id,p_device_id,p_platform,p_app_version,p_device_label,p_records);
    return;
  end if;
  if not app_private.can_access_inventory(p_inventory_id) then raise exception 'Not authorized for inventory' using errcode='42501'; end if;
  v_inventory:=app_private.lock_inventory(p_inventory_id);
  for v_record in select value from jsonb_array_elements(p_records) loop
    begin
      v_client_count_id:=(v_record->>'client_count_id')::uuid;
      v_codigo:=upper(btrim(v_record->>'codigo'));
      v_serie:=nullif(btrim(v_record->>'serie'),'');
      v_partida:=nullif(btrim(v_record->>'partida'),'');
      v_physical_uom:=nullif(upper(btrim(v_record->>'physical_uom')),'');
      if v_physical_uom is not null and (length(v_physical_uom)>32 or v_physical_uom !~ '^[A-Z0-9._/-]+$') then
        client_count_id:=v_client_count_id; result_status:='REJECTED'; server_count_id:=null; received_at:=null; reason:='INVALID_PHYSICAL_UOM'; return next; continue;
      end if;
      select mi.* into v_master from public.inventory_master_items mi where mi.inventory_id=p_inventory_id and mi.codigo=v_codigo;
      if v_master.codigo is null then raise exception 'defer'; end if;
      v_key:=public.normalize_reference_key(v_master.control_type,v_codigo,case when v_master.control_type='SERIAL' then v_serie when v_master.control_type='PARTIDA' then v_partida else null end);
    exception when others then
      v_forwarded:=v_forwarded || jsonb_build_array(v_record);
      continue;
    end;
    select c.* into v_existing from public.count_records c where c.client_count_id=v_client_count_id;
    if v_existing.id is not null then
      if coalesce(v_existing.physical_uom,'') <> coalesce(v_physical_uom,'') then
        client_count_id:=v_client_count_id; result_status:='CONFLICT'; server_count_id:=v_existing.id; received_at:=v_existing.received_at; reason:='CLIENT_COUNT_ID_PAYLOAD_CONFLICT'; return next;
      end if;
      v_forwarded:=v_forwarded || jsonb_build_array(v_record);
      continue;
    end if;
    v_recount_id:=app_private.active_recount_mission_for_count(p_inventory_id,v_actor,v_codigo,v_serie,v_partida);
    select sr.id into v_sealed_id from public.inventory_sealed_references sr
      where sr.inventory_id=p_inventory_id and sr.warehouse_id=v_inventory.warehouse_id
        and sr.normalized_reference_key=v_key and sr.state in ('SEALING','SEALED');
    if v_sealed_id is not null and v_recount_id is null then
      client_count_id:=v_client_count_id; result_status:='REJECTED'; server_count_id:=null; received_at:=null; reason:='REFERENCE_SEALED'; return next; continue;
    end if;
    v_forwarded:=v_forwarded || jsonb_build_array(v_record);
  end loop;
  if jsonb_array_length(v_forwarded) = 0 then return; end if;
  for v_result in select * from app_private.sync_counts_pre_cut2_03(p_inventory_id,p_device_id,p_platform,p_app_version,p_device_label,v_forwarded) loop
    if v_result.result_status='ACCEPTED' and v_result.server_count_id is not null then
      select nullif(upper(btrim(value->>'physical_uom')),'') into v_result_uom
      from jsonb_array_elements(v_forwarded) value
      where (value->>'client_count_id')::uuid=v_result.client_count_id;
      update public.count_records
      set physical_uom=v_result_uom,
          uom_source=case when v_result_uom is null then 'LEGACY_UNKNOWN' else 'EXPLICIT' end
      where id=v_result.server_count_id;
      insert into public.preseal_guard_events(inventory_id,warehouse_id,reference_type,normalized_reference_key,count_record_id,event_type,actor_user_id,payload)
      select p_inventory_id,v_inventory.warehouse_id,m.control_type,
        public.normalize_reference_key(m.control_type,c.codigo,case when m.control_type='SERIAL' then c.serie when m.control_type='PARTIDA' then c.partida else null end),
        c.id,'UOM_EVIDENCE_RECORDED',v_actor,jsonb_build_object('physical_uom',v_result_uom,'uom_source',case when v_result_uom is null then 'LEGACY_UNKNOWN' else 'EXPLICIT' end)
      from public.count_records c join public.inventory_master_items m on m.inventory_id=c.inventory_id and m.codigo=c.codigo
      where c.id=v_result.server_count_id;
    end if;
    client_count_id:=v_result.client_count_id; result_status:=v_result.result_status; server_count_id:=v_result.server_count_id; received_at:=v_result.received_at; reason:=v_result.reason; return next;
  end loop;
end
$function$;

revoke all on function app_private.preseal_uom_status_v2(uuid,public.master_control_type,text,text), app_private.preview_rolling_cut_v2_base(uuid,uuid,jsonb), app_private.link_preseal_findings_on_seal(), app_private.populate_reference_finding_canonical_anchor() from public, anon, authenticated;
revoke all on function public.preview_rolling_cut_v2(uuid,uuid,jsonb), public.create_preseal_reference_finding(uuid,public.master_control_type,text,public.cut2_finding_type,text,boolean), public.resolve_preseal_reference_finding(uuid,text) from public, anon;
grant execute on function public.preview_rolling_cut_v2(uuid,uuid,jsonb), public.create_preseal_reference_finding(uuid,public.master_control_type,text,public.cut2_finding_type,text,boolean), public.resolve_preseal_reference_finding(uuid,text) to authenticated;
