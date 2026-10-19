-- CUT2-09B: one read-only, scoped eligibility authority.  The release writer
-- will consume this same function; UI must never derive RP readiness itself.
create or replace function app_private.rp_release_eligibility(
  p_inventory_id uuid,
  p_warehouse_id uuid default null,
  p_reference_ids uuid[] default null
)
returns table(
  reference_id uuid, inventory_id uuid, warehouse_id uuid,
  identity_type public.master_control_type, sku text, reference_value text,
  sealed_quantity integer, source_cut_id uuid, eligible boolean,
  blocker_codes text[]
)
language sql stable security definer set search_path = '' as $$
  with refs as (
    select r.*
    from public.inventory_sealed_references r
    where r.inventory_id=p_inventory_id
      and r.state='SEALED'
      and (p_warehouse_id is null or r.warehouse_id=p_warehouse_id)
      and (p_reference_ids is null or r.id = any(p_reference_ids))
  ), assessed as (
    select r.id reference_id, r.inventory_id, r.warehouse_id,
      r.reference_type identity_type, r.codigo sku, r.reference_value,
      r.physical_quantity sealed_quantity,
      (select m.source_cut_id from public.recount_missions m
       where m.source_sealed_reference_id=r.id order by m.created_at desc limit 1) source_cut_id,
      array_remove(array[
        case when r.physical_quantity is null or r.physical_quantity < 0 then 'NEGATIVE_QUANTITY' end,
        case when exists (select 1 from public.reference_findings f where f.reference_id=r.id and f.state in ('OPEN','HELD') and (f.blocks_rp or f.severity='CRITICAL')) then 'BLOCKS_RP_FINDING' end,
        -- The canonical enum has no CLAIMED/HELD states: a claimed mission is
        -- ACTIVE, so RP must wait for QUEUED or ACTIVE only.
        case when exists (select 1 from public.recount_missions m where m.source_sealed_reference_id=r.id and m.round=2 and m.status in ('QUEUED','ACTIVE')) then 'OPEN_C2' end,
        case when exists (select 1 from public.recount_missions m where m.source_sealed_reference_id=r.id and m.round=3 and m.status in ('QUEUED','ACTIVE')) then 'OPEN_C3' end,
        case when exists (select 1 from public.reference_findings f where f.reference_id=r.id and f.state in ('OPEN','HELD') and f.finding_type='AUTHORIZATION_REVOKED_OFFLINE') then 'UNRESOLVED_REVIEW' end,
        case when exists (select 1 from public.orphan_references o where o.inventory_id=r.inventory_id and o.warehouse_id=r.warehouse_id and o.reference_type=r.reference_type and o.normalized_reference_key=r.normalized_reference_key and o.state<>'RESOLVED' and o.block_rp) then 'ORPHAN_REFERENCE' end,
        case when exists (select 1 from public.uom_resolution_cases u where u.reference_id=r.id and u.state in ('OPEN','HELD')) then 'UOM_CONFLICT' end
      ], null) blocker_codes
    from refs r
  )
  select a.reference_id,a.inventory_id,a.warehouse_id,a.identity_type,a.sku,a.reference_value,a.sealed_quantity,a.source_cut_id,
    cardinality(a.blocker_codes)=0,a.blocker_codes
  from assessed a
$$;

create or replace function public.preview_rp_release(
  p_inventory_id uuid,
  p_warehouse_id uuid default null,
  p_reference_ids uuid[] default null
)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_actor uuid := app_private.require_inventory_capability(p_inventory_id,'RP_RELEASE'::public.cut2_capability,p_warehouse_id);
begin
  if p_warehouse_id is not null and not exists (select 1 from public.inventories i where i.id=p_inventory_id and i.warehouse_id=p_warehouse_id) then
    raise exception 'WAREHOUSE_SCOPE_DENIED' using errcode='42501';
  end if;
  return (
    with items as (
      select * from app_private.rp_release_eligibility(p_inventory_id,p_warehouse_id,p_reference_ids)
      order by warehouse_id,identity_type,sku,coalesce(reference_value,''),reference_id
    ), material as (
      select coalesce(string_agg(concat_ws('|',reference_id,eligible,coalesce(array_to_string(blocker_codes,','),''),sealed_quantity,coalesce(source_cut_id::text,'')),E'\n' order by warehouse_id,identity_type,sku,coalesce(reference_value,''),reference_id),'') value from items
    )
    select jsonb_build_object(
      'inventory_id',p_inventory_id,'warehouse_id',p_warehouse_id,'actor_id',v_actor,
      'items',coalesce((select jsonb_agg(to_jsonb(items) order by warehouse_id,identity_type,sku,coalesce(reference_value,''),reference_id) from items),'[]'::jsonb),
      'total_references',(select count(*) from items),
      'eligible_references',(select count(*) from items where eligible),
      'blocked_references',(select count(*) from items where not eligible),
      'fingerprint',encode(extensions.digest(convert_to((select value from material),'utf8'),'sha256') ,'hex')
    )
  );
end $fn$;

revoke all on function app_private.rp_release_eligibility(uuid,uuid,uuid[]) from public,anon,authenticated;
revoke all on function public.preview_rp_release(uuid,uuid,uuid[]) from public,anon;
grant execute on function public.preview_rp_release(uuid,uuid,uuid[]) to authenticated;

-- A DRAFT release is a server-side, immutable snapshot.  Export fields stay
-- required for READY releases, but do not exist yet at CUT2-09B.
alter table public.rp_release_audits
  alter column xlsx_file_name drop not null,
  alter column xlsx_sha256 drop not null,
  alter column xlsx_size_bytes drop not null,
  alter column sidecar_sha256 drop not null;

alter table public.rp_release_batches
  add column request_id uuid,
  add constraint rp_release_batches_idempotency_unique unique (inventory_id, created_by, request_id);

-- A single writer lock on the inventory makes preview validation and the
-- snapshot insert atomic with respect to another release request.  All RP
-- eligibility itself remains in app_private.rp_release_eligibility.
create or replace function public.create_rp_release(
  p_inventory_id uuid,
  p_warehouse_id uuid,
  p_reference_ids uuid[],
  p_expected_fingerprint text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid;
  v_preview jsonb;
  v_existing public.rp_release_batches;
  v_release_id uuid;
  v_returned_count integer;
  v_locked_reference_count integer;
  v_cut_ids uuid[];
begin
  if p_warehouse_id is null then
    raise exception 'WAREHOUSE_SCOPE_REQUIRED' using errcode='22023';
  end if;
  if p_request_id is null or p_expected_fingerprint is null
     or p_expected_fingerprint !~ '^[A-Fa-f0-9]{64}$' then
    raise exception 'INVALID_RELEASE_REQUEST' using errcode='22023';
  end if;
  if p_reference_ids is null or cardinality(p_reference_ids) = 0
     or cardinality(p_reference_ids) <> (select count(distinct value) from unnest(p_reference_ids) as value) then
    raise exception 'INVALID_REFERENCE_SELECTION' using errcode='22023';
  end if;

  v_actor := app_private.require_inventory_capability(
    p_inventory_id, 'RP_RELEASE'::public.cut2_capability, p_warehouse_id
  );

  -- Lock order for CUT2-09B: inventory, prior idempotent release, then the
  -- sealed-reference rows read by the shared eligibility authority.
  perform 1 from public.inventories i where i.id=p_inventory_id and i.warehouse_id=p_warehouse_id for update;
  if not found then
    raise exception 'WAREHOUSE_SCOPE_DENIED' using errcode='42501';
  end if;

  -- Lock every selected sealed identity before computing eligibility.  A
  -- finding, C2/C3 mission or UOM case that references one of these rows must
  -- acquire a conflicting FK key-share lock; therefore it commits either
  -- before this revalidation (and is seen) or after the immutable snapshot.
  perform r.id
  from public.inventory_sealed_references r
  where r.inventory_id=p_inventory_id
    and r.warehouse_id=p_warehouse_id
    and r.state='SEALED'
    and r.id=any(p_reference_ids)
  for update;
  get diagnostics v_locked_reference_count = row_count;
  if v_locked_reference_count <> cardinality(p_reference_ids) then
    raise exception 'REFERENCE_SCOPE_INVALID' using errcode='42501';
  end if;

  select b.* into v_existing
  from public.rp_release_batches b
  where b.inventory_id=p_inventory_id and b.created_by=v_actor and b.request_id=p_request_id
  for update;
  if found then
    if coalesce(v_existing.policy_snapshot->>'preview_fingerprint','') <> lower(p_expected_fingerprint) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
    end if;
    return jsonb_build_object('release_id',v_existing.id,'state',v_existing.state,'idempotent',true,
      'fingerprint',v_existing.policy_snapshot->>'preview_fingerprint');
  end if;

  v_preview := public.preview_rp_release(p_inventory_id,p_warehouse_id,p_reference_ids);
  if lower(v_preview->>'fingerprint') <> lower(p_expected_fingerprint) then
    raise exception 'PREVIEW_STALE' using errcode='40001';
  end if;
  select count(*) into v_returned_count from jsonb_array_elements(v_preview->'items');
  if v_returned_count <> cardinality(p_reference_ids)
     or coalesce((v_preview->>'total_references')::integer,0) <> cardinality(p_reference_ids) then
    raise exception 'REFERENCE_SCOPE_INVALID' using errcode='42501';
  end if;
  if coalesce((v_preview->>'blocked_references')::integer,0) > 0 then
    raise exception 'RP_RELEASE_BLOCKED' using errcode='23514', detail=v_preview->'items'::text;
  end if;

  select array_agg((item->>'source_cut_id')::uuid order by item->>'source_cut_id')
  into v_cut_ids
  from jsonb_array_elements(v_preview->'items') item
  where nullif(item->>'source_cut_id','') is not null;

  insert into public.rp_release_batches(
    inventory_id,warehouse_id,state,policy_snapshot,created_by,request_id
  ) values (
    p_inventory_id,p_warehouse_id,'DRAFT',
    jsonb_build_object('schema_version','CUT2_09B','preview_fingerprint',lower(p_expected_fingerprint),
      'selected_reference_ids',to_jsonb(p_reference_ids),'preview',v_preview),
    v_actor,p_request_id
  ) returning id into v_release_id;

  insert into public.rp_release_audits(
    release_id,inventory_id,warehouse_id,cut_ids,reference_count,references_snapshot,
    policy_snapshot,release_fingerprint,algorithm_version,created_by
  ) values (
    v_release_id,p_inventory_id,p_warehouse_id,coalesce(v_cut_ids,'{}'::uuid[]),
    cardinality(p_reference_ids),v_preview->'items',
    jsonb_build_object('schema_version','CUT2_09B','event','RELEASE_CREATED','request_id',p_request_id),
    lower(p_expected_fingerprint),'CUT2_09B',v_actor
  );

  return jsonb_build_object('release_id',v_release_id,'state','DRAFT','idempotent',false,
    'fingerprint',lower(p_expected_fingerprint));
end
$fn$;

revoke all on function public.create_rp_release(uuid,uuid,uuid[],text,uuid) from public,anon;
grant execute on function public.create_rp_release(uuid,uuid,uuid[],text,uuid) to authenticated;
