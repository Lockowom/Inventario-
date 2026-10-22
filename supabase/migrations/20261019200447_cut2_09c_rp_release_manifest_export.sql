-- CUT2-09C keeps RP export local and snapshot-only.  No ERP table, stock
-- field or live eligibility query is mutated by this migration.
alter table public.rp_release_batches
  add column manifest jsonb,
  add column manifest_digest text check (manifest_digest is null or manifest_digest ~ '^[A-Fa-f0-9]{64}$'),
  add column export_version text,
  add column ready_at timestamptz,
  add column ready_by uuid references public.profiles(user_id) on delete restrict;

alter table public.rp_release_batches
  drop constraint rp_release_batches_check,
  add constraint rp_release_batches_ready_contract check (
    (state = 'READY' and (
      (manifest is not null and manifest_digest is not null and export_version = 'CUT2_09C' and ready_at is not null and ready_by is not null)
      or
      (xlsx_file_name is not null and xlsx_storage_path is not null and xlsx_sha256 is not null and xlsx_size_bytes is not null and sidecar_storage_path is not null and sidecar_sha256 is not null)
    ))
    or state <> 'READY'
  );

create table public.rp_release_events (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.rp_release_batches(id) on delete restrict,
  inventory_id uuid not null,
  warehouse_id uuid not null,
  event_type text not null check (event_type in ('RELEASE_READY','RELEASE_EXPORTED')),
  actor_id uuid not null references public.profiles(user_id) on delete restrict,
  request_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (release_id, inventory_id, warehouse_id)
    references public.rp_release_batches(id, inventory_id, warehouse_id) on delete restrict,
  unique (release_id, event_type, request_id)
);
alter table public.rp_release_events enable row level security;
revoke all on public.rp_release_events from public, anon, authenticated;

create or replace function app_private.rp_release_manifest(p_release_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with release_data as (
    select b.id,b.inventory_id,b.warehouse_id,b.created_by,b.created_at,a.reference_count,
      a.release_fingerprint,a.references_snapshot,a.schema_version
    from public.rp_release_batches b
    join public.rp_release_audits a on a.release_id=b.id
    where b.id=p_release_id
  ), ordered as (
    select item,
      row_number() over (order by item->>'warehouse_id', item->>'identity_type',
        item->>'sku', coalesce(item->>'reference_value',''), item->>'reference_id') as export_seq
    from release_data d cross join lateral jsonb_array_elements(d.references_snapshot) item
  ), digest as (
    select encode(extensions.digest(convert_to(coalesce(string_agg(
      concat_ws('|',export_seq,item->>'reference_id',item->>'warehouse_id',item->>'identity_type',
        item->>'sku',coalesce(item->>'reference_value',''),item->>'sealed_quantity',
        coalesce(item->>'source_cut_id','')), E'\n' order by export_seq),''),'utf8'),'sha256'),'hex') value
    from ordered
  )
  select jsonb_build_object(
    'release_id',d.id,'inventory_id',d.inventory_id,'warehouse_id',d.warehouse_id,
    'created_by',d.created_by,'created_at',d.created_at,'item_count',d.reference_count,
    'schema_version','CUT2_09C','release_fingerprint',d.release_fingerprint,
    'ordered_items_digest',(select value from digest),'export_version','CUT2_09C'
  ) from release_data d
$$;

create or replace function app_private.rp_release_detail_payload(p_release_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with batch as (
    select b.*,a.references_snapshot,a.reference_count,a.release_fingerprint,a.cut_ids
    from public.rp_release_batches b join public.rp_release_audits a on a.release_id=b.id
    where b.id=p_release_id
  ), items as (
    select jsonb_build_object(
      'export_seq',row_number() over (order by item->>'warehouse_id',item->>'identity_type',item->>'sku',coalesce(item->>'reference_value',''),item->>'reference_id'),
      'reference_id',item->>'reference_id','warehouse_id',item->>'warehouse_id',
      'identity_type',item->>'identity_type','sku',item->>'sku','lot',case when item->>'identity_type'='PARTIDA' then item->>'reference_value' end,
      'serial',case when item->>'identity_type'='SERIAL' then item->>'reference_value' end,
      'sealed_quantity',(item->>'sealed_quantity')::integer,'source_cut_id',item->>'source_cut_id'
    ) value
    from batch b cross join lateral jsonb_array_elements(b.references_snapshot) item
  )
  select jsonb_build_object('release_id',b.id,'inventory_id',b.inventory_id,'warehouse_id',b.warehouse_id,
    'state',b.state,'created_by',b.created_by,'created_at',b.created_at,'ready_at',b.ready_at,
    'ready_by',b.ready_by,'fingerprint',b.release_fingerprint,'item_count',b.reference_count,
    'manifest',coalesce(b.manifest,app_private.rp_release_manifest(b.id)),
    'items',coalesce((select jsonb_agg(value order by (value->>'export_seq')::integer) from items),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object('type',e.event_type,'actor_id',e.actor_id,'created_at',e.created_at,'payload',e.payload) order by e.created_at,e.id) from public.rp_release_events e where e.release_id=b.id),'[]'::jsonb))
  from batch b
$$;

create or replace function public.get_rp_release_detail(p_release_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_inventory uuid; v_warehouse uuid;
begin
  select inventory_id,warehouse_id into v_inventory,v_warehouse from public.rp_release_batches where id=p_release_id;
  if not found then raise exception 'RELEASE_NOT_FOUND' using errcode='P0002'; end if;
  perform app_private.require_inventory_capability(v_inventory,'RP_RELEASE'::public.cut2_capability,v_warehouse);
  return app_private.rp_release_detail_payload(p_release_id);
end $fn$;

create or replace function public.list_rp_releases(p_inventory_id uuid, p_warehouse_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform app_private.require_inventory_capability(p_inventory_id,'RP_RELEASE'::public.cut2_capability,p_warehouse_id);
  return coalesce((select jsonb_agg(jsonb_build_object('release_id',b.id,'warehouse_id',b.warehouse_id,
    'state',b.state,'created_at',b.created_at,'ready_at',b.ready_at,'item_count',a.reference_count,
    'fingerprint',a.release_fingerprint,'manifest',b.manifest) order by b.created_at desc,b.id desc)
    from public.rp_release_batches b join public.rp_release_audits a on a.release_id=b.id
    where b.inventory_id=p_inventory_id and (p_warehouse_id is null or b.warehouse_id=p_warehouse_id)),'[]'::jsonb);
end $fn$;

create or replace function public.mark_rp_release_ready(p_release_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v_batch public.rp_release_batches; v_actor uuid; v_manifest jsonb; v_digest text; v_count integer;
begin
  if p_request_id is null then raise exception 'INVALID_RELEASE_REQUEST' using errcode='22023'; end if;
  select * into v_batch from public.rp_release_batches where id=p_release_id for update;
  if not found then raise exception 'RELEASE_NOT_FOUND' using errcode='P0002'; end if;
  v_actor:=app_private.require_inventory_capability(v_batch.inventory_id,'RP_RELEASE'::public.cut2_capability,v_batch.warehouse_id);
  v_manifest:=app_private.rp_release_manifest(p_release_id);
  v_digest:=v_manifest->>'ordered_items_digest';
  select jsonb_array_length(references_snapshot) into v_count from public.rp_release_audits where release_id=p_release_id;
  if v_count <> (v_manifest->>'item_count')::integer then raise exception 'RELEASE_SNAPSHOT_INTEGRITY_FAILURE' using errcode='23514'; end if;
  if v_batch.state='READY' then
    if v_batch.manifest_digest<>v_digest then raise exception 'RELEASE_MANIFEST_TAMPERED' using errcode='23514'; end if;
    return jsonb_build_object('release_id',p_release_id,'state','READY','idempotent',true,'manifest',v_batch.manifest);
  end if;
  if v_batch.state<>'DRAFT' then raise exception 'RELEASE_STATE_INVALID' using errcode='23514'; end if;
  update public.rp_release_batches set state='READY',manifest=v_manifest,manifest_digest=v_digest,
    export_version='CUT2_09C',ready_at=now(),ready_by=v_actor,finalized_at=now() where id=p_release_id;
  insert into public.rp_release_events(release_id,inventory_id,warehouse_id,event_type,actor_id,request_id,payload)
  values (p_release_id,v_batch.inventory_id,v_batch.warehouse_id,'RELEASE_READY',v_actor,p_request_id,
    jsonb_build_object('manifest_digest',v_digest,'item_count',v_count)) on conflict (release_id,event_type,request_id) do nothing;
  return jsonb_build_object('release_id',p_release_id,'state','READY','idempotent',false,'manifest',v_manifest);
end $fn$;

create or replace function public.prepare_rp_release_export(p_release_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v_batch public.rp_release_batches; v_actor uuid; v_manifest jsonb;
begin
  if p_request_id is null then raise exception 'INVALID_EXPORT_REQUEST' using errcode='22023'; end if;
  select * into v_batch from public.rp_release_batches where id=p_release_id for update;
  if not found then raise exception 'RELEASE_NOT_FOUND' using errcode='P0002'; end if;
  v_actor:=app_private.require_inventory_capability(v_batch.inventory_id,'RP_RELEASE'::public.cut2_capability,v_batch.warehouse_id);
  if v_batch.state<>'READY' or v_batch.manifest is null or v_batch.manifest_digest<>app_private.rp_release_manifest(p_release_id)->>'ordered_items_digest' then
    raise exception 'RELEASE_NOT_READY_OR_INTEGRITY_FAILURE' using errcode='23514';
  end if;
  insert into public.rp_release_events(release_id,inventory_id,warehouse_id,event_type,actor_id,request_id,payload)
  values(p_release_id,v_batch.inventory_id,v_batch.warehouse_id,'RELEASE_EXPORTED',v_actor,p_request_id,jsonb_build_object('manifest_digest',v_batch.manifest_digest))
  on conflict (release_id,event_type,request_id) do nothing;
  v_manifest:=v_batch.manifest;
  return jsonb_build_object('manifest',v_manifest,'release',app_private.rp_release_detail_payload(p_release_id));
end $fn$;

revoke all on function app_private.rp_release_manifest(uuid) from public,anon,authenticated;
revoke all on function app_private.rp_release_detail_payload(uuid) from public,anon,authenticated;
revoke all on function public.get_rp_release_detail(uuid), public.list_rp_releases(uuid,uuid), public.mark_rp_release_ready(uuid,uuid), public.prepare_rp_release_export(uuid,uuid) from public,anon;
grant execute on function public.get_rp_release_detail(uuid), public.list_rp_releases(uuid,uuid), public.mark_rp_release_ready(uuid,uuid), public.prepare_rp_release_export(uuid,uuid) to authenticated;
