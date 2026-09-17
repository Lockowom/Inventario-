-- Fase 6: correction before a cut and immutable, server-side cut snapshots.
-- This migration deliberately stops at SNAPSHOT_CREATED: file generation belongs
-- to Fase 7 and rectification of an already cut record is out of scope.

alter table public.inventory_cuts add column request_id uuid;
alter table public.inventory_cuts add constraint inventory_cuts_inventory_request_id_key unique (inventory_id, request_id);
alter table public.inventory_cuts add constraint inventory_cuts_snapshot_range_matches_count check (
  status not in ('SNAPSHOT_CREATED', 'FILE_GENERATED', 'VALIDATED', 'READY')
  or (record_count > 0 and first_export_seq is not null and last_export_seq is not null
      and record_count = last_export_seq - first_export_seq + 1)
);

create index inventory_cuts_inventory_created_idx on public.inventory_cuts (inventory_id, created_at desc, id desc);
create index inventory_cut_items_cut_export_idx on public.inventory_cut_items (cut_id, ((snapshot ->> 'export_seq')::bigint));
create index count_records_uncut_received_idx on public.count_records (inventory_id, received_at, id)
  where cut_id is null and export_seq is null;

create or replace function public.correct_uncut_count(
  p_count_record_id uuid,
  p_physical_payload jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  v_actor uuid := app_private.require_active_actor();
  v_count public.count_records%rowtype;
  v_inventory public.inventories%rowtype;
  v_master public.inventory_master_items%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
  v_ubicacion text;
  v_codigo text;
  v_serie text;
  v_partida text;
  v_pieza_producto text;
  v_fecha_vencimiento date;
  v_talla text;
  v_color text;
  v_cantidad integer;
  v_old_values jsonb;
  v_new_values jsonb;
  v_revision public.count_revisions%rowtype;
begin
  if p_physical_payload is null or jsonb_typeof(p_physical_payload) <> 'object' then
    raise exception 'Physical correction payload must be an object' using errcode = '23514';
  end if;
  if v_reason is null or length(v_reason) > 500 then
    raise exception 'Correction reason is required and must be at most 500 characters' using errcode = '23514';
  end if;
  -- The inventory row serializes correction, sync_counts and create_cut.
  select * into v_count from public.count_records where id = p_count_record_id;
  if not found then raise exception 'Count record not found' using errcode = 'P0002'; end if;
  v_inventory := app_private.lock_inventory(v_count.inventory_id);
  select * into v_count from public.count_records where id = p_count_record_id for update;

  if not (app_private.can_manage_inventory(v_count.inventory_id) or
    (v_count.user_id = v_actor and exists (
      select 1 from public.inventory_assignments a
      where a.inventory_id = v_count.inventory_id and a.user_id = v_actor and a.active
    ))) then
    raise exception 'Not authorized to correct this count' using errcode = '42501';
  end if;
  if v_inventory.status not in ('ABIERTO', 'CERRADO') then
    raise exception 'Corrections are only allowed while inventory is ABIERTO or CERRADO' using errcode = '23514';
  end if;
  if v_count.cut_id is not null or v_count.export_seq is not null then
    raise exception 'A cut count record cannot be corrected' using errcode = '23514';
  end if;

  begin
    v_ubicacion := upper(btrim(p_physical_payload ->> 'ubicacion'));
    v_codigo := upper(btrim(p_physical_payload ->> 'codigo'));
    v_serie := nullif(btrim(p_physical_payload ->> 'serie'), '');
    v_partida := nullif(btrim(p_physical_payload ->> 'partida'), '');
    v_pieza_producto := nullif(btrim(p_physical_payload ->> 'pieza_producto'), '');
    v_fecha_vencimiento := nullif(p_physical_payload ->> 'fecha_vencimiento', '')::date;
    v_talla := nullif(btrim(p_physical_payload ->> 'talla'), '');
    v_color := nullif(btrim(p_physical_payload ->> 'color'), '');
    v_cantidad := (p_physical_payload ->> 'cantidad_contada')::integer;
  exception when others then
    raise exception 'Invalid physical correction payload' using errcode = '23514';
  end;
  if v_ubicacion !~ '^(A|B|C|C2|D|F|G|H|I)-[0-9]{2}-[0-9]{2}$' then
    raise exception 'INVALID_LOCATION' using errcode = '23514';
  end if;
  if v_codigo is null or v_codigo = '' or v_cantidad is null or v_cantidad <= 0 then
    raise exception 'INVALID_RECORD' using errcode = '23514';
  end if;
  select * into v_master from public.inventory_master_items
  where inventory_id = v_count.inventory_id and codigo = v_codigo;
  if not found then raise exception 'UNKNOWN_SKU' using errcode = '23514'; end if;
  if v_master.control_type = 'SERIAL' and (v_serie is null or length(v_serie) > 19 or v_cantidad <> 1 or v_partida is not null) then
    raise exception 'INVALID_SERIAL' using errcode = '23514';
  end if;
  if v_master.control_type = 'PARTIDA' and (v_partida is null or v_serie is not null) then
    raise exception 'INVALID_BATCH' using errcode = '23514';
  end if;

  v_old_values := jsonb_build_object('ubicacion', v_count.ubicacion, 'codigo', v_count.codigo,
    'serie', v_count.serie, 'partida', v_count.partida, 'pieza_producto', v_count.pieza_producto,
    'fecha_vencimiento', v_count.fecha_vencimiento, 'talla', v_count.talla, 'color', v_count.color,
    'cantidad_contada', v_count.cantidad_contada, 'descripcion', v_count.descripcion);
  v_new_values := jsonb_build_object('ubicacion', v_ubicacion, 'codigo', v_codigo,
    'serie', v_serie, 'partida', v_partida, 'pieza_producto', v_pieza_producto,
    'fecha_vencimiento', v_fecha_vencimiento, 'talla', v_talla, 'color', v_color,
    'cantidad_contada', v_cantidad, 'descripcion', v_master.descripcion);
  insert into public.count_revisions (count_record_id, revision_number, old_values, new_values, reason, created_by)
  values (v_count.id, (select coalesce(max(revision_number), 0) + 1 from public.count_revisions where count_record_id = v_count.id),
    v_old_values, v_new_values, v_reason, v_actor)
  returning * into v_revision;
  update public.count_records set ubicacion = v_ubicacion, codigo = v_codigo, serie = v_serie,
    partida = v_partida, pieza_producto = v_pieza_producto, fecha_vencimiento = v_fecha_vencimiento,
    talla = v_talla, color = v_color, cantidad_contada = v_cantidad, descripcion = v_master.descripcion
  where id = v_count.id;
  insert into public.audit_events (inventory_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (v_count.inventory_id, v_actor, 'COUNT_CORRECTED', 'count_record', v_count.id,
    jsonb_build_object('count_record_id', v_count.id, 'revision_id', v_revision.id,
      'revision_number', v_revision.revision_number, 'reason', v_reason));
  return jsonb_build_object('count_record_id', v_count.id, 'revision_id', v_revision.id,
    'revision_number', v_revision.revision_number, 'new_values', v_new_values);
end;
$$;

create or replace function public.create_cut(p_inventory_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  v_actor uuid := app_private.require_active_actor();
  v_inventory public.inventories%rowtype;
  v_existing public.inventory_cuts%rowtype;
  v_cut public.inventory_cuts%rowtype;
  v_cut_id uuid := gen_random_uuid();
  v_cut_number integer;
  v_first_export_seq bigint;
  v_last_export_seq bigint;
  v_record_count integer;
begin
  if p_request_id is null then raise exception 'request_id is required' using errcode = '23514'; end if;
  if not app_private.can_manage_inventory(p_inventory_id) then
    raise exception 'Only an assigned ANALISTA or ADMIN can create a cut' using errcode = '42501';
  end if;
  v_inventory := app_private.lock_inventory(p_inventory_id);
  select * into v_existing from public.inventory_cuts
  where inventory_id = p_inventory_id and request_id = p_request_id;
  if found then return to_jsonb(v_existing); end if;
  if v_inventory.status not in ('ABIERTO', 'CERRADO') then
    raise exception 'Cuts are only allowed while inventory is ABIERTO or CERRADO' using errcode = '23514';
  end if;
  if not exists (select 1 from public.count_records where inventory_id = p_inventory_id and cut_id is null and export_seq is null) then
    raise exception 'No existen conteos nuevos para incluir en el corte.' using errcode = '23514';
  end if;
  select coalesce(max(cut_number), 0) + 1 into v_cut_number from public.inventory_cuts where inventory_id = p_inventory_id;
  select coalesce(max(export_seq), 0) + 1 into v_first_export_seq from public.count_records where inventory_id = p_inventory_id;
  insert into public.inventory_cuts (id, inventory_id, request_id, cut_number, status, created_by)
  values (v_cut_id, p_inventory_id, p_request_id, v_cut_number, 'CREATING', v_actor);

  with eligible as (
    select id, row_number() over (order by received_at asc, id asc) as ordinal
    from public.count_records
    where inventory_id = p_inventory_id and cut_id is null and export_seq is null
  ), assigned as (
    update public.count_records c
    set cut_id = v_cut_id, export_seq = v_first_export_seq + e.ordinal - 1
    from eligible e where c.id = e.id
    returning c.*
  ), snapshots as (
    insert into public.inventory_cut_items (inventory_id, cut_id, count_record_id, snapshot)
    select p_inventory_id, v_cut_id, a.id, jsonb_build_object(
      'count_record_id', a.id, 'client_count_id', a.client_count_id, 'inventory_id', a.inventory_id,
      'export_seq', a.export_seq, 'ubicacion', a.ubicacion, 'codigo', a.codigo, 'serie', a.serie,
      'partida', a.partida, 'pieza_producto', a.pieza_producto, 'fecha_vencimiento', a.fecha_vencimiento,
      'talla', a.talla, 'color', a.color, 'cantidad_contada', a.cantidad_contada, 'descripcion', a.descripcion,
      'user_id', a.user_id, 'device_id', a.device_id, 'captured_at', a.captured_at,
      'received_at', a.received_at, 'inventory_status_at_receive', a.inventory_status_at_receive)
    from assigned a
    returning id
  )
  select count(*)::integer, min(export_seq), max(export_seq)
  into v_record_count, v_first_export_seq, v_last_export_seq from assigned;
  if v_record_count is null or v_record_count = 0 then
    raise exception 'No existen conteos nuevos para incluir en el corte.' using errcode = '23514';
  end if;
  update public.inventory_cuts set status = 'SNAPSHOT_CREATED', record_count = v_record_count,
    first_export_seq = v_first_export_seq, last_export_seq = v_last_export_seq
  where id = v_cut_id returning * into v_cut;
  insert into public.audit_events (inventory_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (p_inventory_id, v_actor, 'CUT_CREATED', 'inventory_cut', v_cut_id,
    jsonb_build_object('cut_id', v_cut_id, 'cut_number', v_cut_number, 'record_count', v_record_count,
      'first_export_seq', v_first_export_seq, 'last_export_seq', v_last_export_seq, 'request_id', p_request_id));
  return to_jsonb(v_cut);
end;
$$;

create or replace function public.list_inventory_cuts(p_inventory_id uuid, p_limit integer default 50, p_before_cut_number integer default null)
returns table(id uuid, cut_number integer, status public.cut_status, created_at timestamptz, created_by uuid,
  record_count integer, first_export_seq bigint, last_export_seq bigint, request_id uuid)
language plpgsql stable security definer set search_path = public, app_private, pg_temp as $$
begin
  perform app_private.require_active_actor();
  if not app_private.can_manage_inventory(p_inventory_id) then raise exception 'Not authorized to list cuts' using errcode = '42501'; end if;
  if p_limit < 1 or p_limit > 100 then raise exception 'Limit must be between 1 and 100' using errcode = '23514'; end if;
  return query select c.id, c.cut_number, c.status, c.created_at, c.created_by, c.record_count, c.first_export_seq, c.last_export_seq, c.request_id
    from public.inventory_cuts c where c.inventory_id = p_inventory_id and (p_before_cut_number is null or c.cut_number < p_before_cut_number)
    order by c.cut_number desc limit p_limit;
end;
$$;

create or replace function public.get_cut_items(p_cut_id uuid, p_limit integer default 100, p_after_export_seq bigint default null)
returns table(count_record_id uuid, export_seq bigint, snapshot jsonb)
language plpgsql stable security definer set search_path = public, app_private, pg_temp as $$
declare v_inventory_id uuid;
begin
  perform app_private.require_active_actor();
  select inventory_id into v_inventory_id from public.inventory_cuts where id = p_cut_id;
  if not found then raise exception 'Cut not found' using errcode = 'P0002'; end if;
  if not app_private.can_manage_inventory(v_inventory_id) then raise exception 'Not authorized to read cut items' using errcode = '42501'; end if;
  if p_limit < 1 or p_limit > 200 then raise exception 'Limit must be between 1 and 200' using errcode = '23514'; end if;
  return query select i.count_record_id, (i.snapshot ->> 'export_seq')::bigint, i.snapshot from public.inventory_cut_items i
    where i.cut_id = p_cut_id and (p_after_export_seq is null or (i.snapshot ->> 'export_seq')::bigint > p_after_export_seq)
    order by (i.snapshot ->> 'export_seq')::bigint asc limit p_limit;
end;
$$;

create or replace function public.get_count_correction_context(p_count_record_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app_private, pg_temp as $$
declare v_actor uuid := app_private.require_active_actor(); v_count public.count_records%rowtype;
begin
  select * into v_count from public.count_records where id = p_count_record_id;
  if not found then raise exception 'Count record not found' using errcode = 'P0002'; end if;
  if not (v_count.user_id = v_actor or app_private.can_manage_inventory(v_count.inventory_id)) then raise exception 'Not authorized to read count revisions' using errcode = '42501'; end if;
  return jsonb_build_object('count', to_jsonb(v_count), 'revisions', coalesce((select jsonb_agg(to_jsonb(r) order by r.revision_number desc) from public.count_revisions r where r.count_record_id = v_count.id), '[]'::jsonb));
end;
$$;

revoke insert, update, delete on public.count_records, public.inventory_cuts, public.inventory_cut_items, public.count_revisions from authenticated;
revoke all on function public.correct_uncut_count(uuid, jsonb, text), public.create_cut(uuid, uuid),
  public.list_inventory_cuts(uuid, integer, integer), public.get_cut_items(uuid, integer, bigint), public.get_count_correction_context(uuid) from public, anon;
grant execute on function public.correct_uncut_count(uuid, jsonb, text), public.create_cut(uuid, uuid),
  public.list_inventory_cuts(uuid, integer, integer), public.get_cut_items(uuid, integer, bigint), public.get_count_correction_context(uuid) to authenticated;
