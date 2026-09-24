-- Fase 8B contract hardening. This is forward-only and deliberately creates
-- no F8 artifact bytes, Storage objects, Edge functions, or download paths.

alter table public.cut_rectifications
  add constraint cut_rectifications_id_cut_inventory_key unique (id, cut_id, inventory_id);

alter table public.artifact_generations
  drop constraint artifact_generations_rectification_id_inventory_id_fkey,
  alter column as_of_at set not null;

do $$
declare v_constraint text;
begin
  select conname into v_constraint
  from pg_constraint
  where conrelid = 'public.artifact_generations'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%RECTIFICATION_XLSX%';
  if v_constraint is not null then
    execute format('alter table public.artifact_generations drop constraint %I', v_constraint);
  end if;
end $$;

alter table public.artifact_generations
  add constraint artifact_generations_scope_source_check check (
    (artifact_type = 'SNAPSHOT' and scope = 'CUT_SNAPSHOT' and cut_id is not null and rectification_id is null)
    or (artifact_type = 'TECHNICAL_BACKUP' and scope = 'CUT_READY_BACKUP' and cut_id is not null and rectification_id is null)
    or (artifact_type = 'TECHNICAL_BACKUP' and scope = 'FINAL_FROZEN_BACKUP' and cut_id is null and rectification_id is null)
    or (artifact_type = 'RECTIFICATION_XLSX' and scope = 'RECTIFICATION_XLSX' and cut_id is not null and rectification_id is not null)
  ),
  add constraint artifact_generations_rectification_cut_inventory_fkey
    foreign key (rectification_id, cut_id, inventory_id)
    references public.cut_rectifications(id, cut_id, inventory_id) on delete restrict;

alter table public.generated_files
  drop constraint generated_files_rectification_id_inventory_id_fkey,
  drop constraint if exists generated_files_content_type_check,
  drop constraint generated_files_mime_type_matches_file_type,
  drop column mime_type,
  add column artifact_generation_id uuid,
  add constraint generated_files_content_type_matches_file_type check (
    (file_type in ('CUT_XLSX', 'RECTIFICATION_XLSX') and content_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    or (file_type = 'SNAPSHOT' and content_type = 'application/json')
    or (file_type = 'TECHNICAL_BACKUP' and content_type = 'application/zip')
  ),
  add constraint generated_files_artifact_generation_requirement check (
    (file_type = 'CUT_XLSX' and artifact_generation_id is null)
    or (file_type in ('RECTIFICATION_XLSX', 'SNAPSHOT', 'TECHNICAL_BACKUP') and artifact_generation_id is not null)
  ),
  add constraint generated_files_rectification_cut_inventory_fkey
    foreign key (rectification_id, cut_id, inventory_id)
    references public.cut_rectifications(id, cut_id, inventory_id) on delete restrict,
  add constraint generated_files_artifact_generation_inventory_fkey
    foreign key (artifact_generation_id, inventory_id)
    references public.artifact_generations(id, inventory_id) on delete restrict;

create unique index generated_files_one_rectification_xlsx
  on public.generated_files (rectification_id) where file_type = 'RECTIFICATION_XLSX';
create unique index generated_files_one_snapshot_per_cut
  on public.generated_files (cut_id) where file_type = 'SNAPSHOT';
create unique index generated_files_one_cut_ready_backup_per_cut
  on public.generated_files (cut_id) where file_type = 'TECHNICAL_BACKUP' and cut_id is not null;
create unique index generated_files_one_final_backup_per_inventory
  on public.generated_files (inventory_id) where file_type = 'TECHNICAL_BACKUP' and cut_id is null;
create unique index generated_files_one_per_artifact_generation
  on public.generated_files (artifact_generation_id) where artifact_generation_id is not null;

create or replace function public.rectify_cut(
  p_cut_id uuid,
  p_count_record_id uuid,
  p_physical_payload jsonb,
  p_reason text,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  v_actor uuid := app_private.require_active_actor();
  v_cut public.inventory_cuts%rowtype;
  v_inventory public.inventories%rowtype;
  v_item public.inventory_cut_items%rowtype;
  v_master public.inventory_master_items%rowtype;
  v_existing public.cut_rectifications%rowtype;
  v_rectification public.cut_rectifications%rowtype;
  v_physical jsonb;
  v_new_values jsonb;
  v_old_values jsonb;
  v_reason text := nullif(btrim(p_reason), '');
  v_fingerprint text;
  v_number integer;
begin
  if p_request_id is null then raise exception 'Rectification request_id is required' using errcode = '23514'; end if;
  if v_reason is null or length(v_reason) > 500 then
    raise exception 'Rectification reason is required and must be at most 500 characters' using errcode = '23514';
  end if;

  select * into v_cut from public.inventory_cuts where id = p_cut_id;
  if not found then raise exception 'Cut not found' using errcode = 'P0002'; end if;
  perform app_private.lock_inventory(v_cut.inventory_id);
  select * into v_inventory from public.inventories where id = v_cut.inventory_id for update;
  select * into v_cut from public.inventory_cuts where id = p_cut_id for update;
  if not app_private.can_manage_inventory(v_cut.inventory_id) then
    raise exception 'Not authorized to rectify cut' using errcode = '42501';
  end if;
  if v_cut.status <> 'READY' then raise exception 'Cut must be READY for rectification' using errcode = '23514'; end if;
  if v_inventory.status not in ('ABIERTO', 'CERRADO', 'CONGELADO') then
    raise exception 'Inventory state does not permit rectification' using errcode = '23514';
  end if;

  v_physical := app_private.canonical_rectification_payload(p_physical_payload);
  select * into v_master from public.inventory_master_items where inventory_id = v_cut.inventory_id and codigo = v_physical ->> 'codigo';
  if not found then raise exception 'UNKNOWN_SKU' using errcode = '23514'; end if;
  if v_master.control_type = 'SERIAL' and ((v_physical ->> 'serie') is null or length(v_physical ->> 'serie') > 19 or (v_physical ->> 'partida') is not null or (v_physical ->> 'cantidad_contada')::integer <> 1) then
    raise exception 'INVALID_SERIAL' using errcode = '23514';
  end if;
  if v_master.control_type = 'PARTIDA' and ((v_physical ->> 'partida') is null or (v_physical ->> 'serie') is not null) then
    raise exception 'INVALID_BATCH' using errcode = '23514';
  end if;
  v_new_values := v_physical || jsonb_build_object('descripcion', v_master.descripcion);
  v_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'actor_user_id', v_actor, 'canonical_physical_payload', v_physical,
    'count_record_id', p_count_record_id, 'cut_id', p_cut_id, 'normalized_reason', v_reason
  )::text, 'utf8'), 'sha256'), 'hex');

  select * into v_existing from public.cut_rectifications where cut_id = p_cut_id and request_id = p_request_id for update;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23514';
    end if;
    return jsonb_build_object('id', v_existing.id, 'rectification_number', v_existing.rectification_number, 'idempotent', true);
  end if;

  select * into v_item from public.inventory_cut_items where cut_id = p_cut_id and count_record_id = p_count_record_id;
  if not found then raise exception 'Count record does not belong to cut snapshot' using errcode = '23514'; end if;
  select new_values into v_old_values from public.cut_rectifications
  where cut_id = p_cut_id and count_record_id = p_count_record_id
  order by rectification_number desc limit 1;
  if v_old_values is null then v_old_values := app_private.snapshot_rectification_values(v_item.snapshot); end if;
  select coalesce(max(rectification_number), 0) + 1 into v_number from public.cut_rectifications where cut_id = p_cut_id;

  insert into public.cut_rectifications (
    inventory_id, cut_id, count_record_id, rectification_number, old_values, new_values,
    reason, request_id, request_fingerprint, created_by
  ) values (
    v_cut.inventory_id, p_cut_id, p_count_record_id, v_number, v_old_values, v_new_values,
    v_reason, p_request_id, v_fingerprint, v_actor
  ) returning * into v_rectification;

  insert into public.audit_events (inventory_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (v_cut.inventory_id, v_actor, 'RECTIFICATION_CREATED', 'cut_rectification', v_rectification.id,
    jsonb_build_object(
      'cut_id', p_cut_id, 'count_record_id', p_count_record_id,
      'rectification_id', v_rectification.id, 'rectification_number', v_number,
      'request_id', p_request_id,
      'old_values_sha256', encode(extensions.digest(convert_to(v_old_values::text, 'utf8'), 'sha256'), 'hex'),
      'new_values_sha256', encode(extensions.digest(convert_to(v_new_values::text, 'utf8'), 'sha256'), 'hex')
    ));
  perform app_private.reserve_artifact_generation(
    v_cut.inventory_id, p_cut_id, v_rectification.id, 'RECTIFICATION_XLSX', 'RECTIFICATION_XLSX',
    p_request_id, 'SYSTEM', v_actor, v_rectification.created_at
  );
  return jsonb_build_object('id', v_rectification.id, 'rectification_number', v_number, 'idempotent', false);
end;
$$;
