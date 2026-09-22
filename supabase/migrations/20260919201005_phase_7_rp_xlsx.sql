-- Fase 7: generación controlada de RP XLSX desde snapshots inmutables.
alter type public.audit_event_type add value if not exists 'CUT_FILE_VALIDATED';

alter table public.inventory_cuts
  add column generation_request_id uuid,
  add column generation_claimed_at timestamptz,
  add column generation_error text,
  add column generator_version text;

alter table public.generated_files
  add column content_type text not null default 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    check (content_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

create unique index generated_files_one_official_cut_xlsx
  on public.generated_files (cut_id, file_type) where file_type = 'CUT_XLSX';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inventory-rp', 'inventory-rp', false, 52428800,
  array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function app_private.require_generator()
returns void language plpgsql security definer set search_path = public, app_private, pg_temp as $$
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'Generator service role is required' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.request_cut_file_generation(p_cut_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, app_private, pg_temp as $$
declare v_actor uuid := app_private.require_active_actor(); v_cut public.inventory_cuts%rowtype;
begin
  if p_request_id is null then raise exception 'Generation request_id is required' using errcode = '23514'; end if;
  select * into v_cut from public.inventory_cuts where id = p_cut_id;
  if not found then raise exception 'Cut not found' using errcode = 'P0002'; end if;
  perform app_private.lock_inventory(v_cut.inventory_id);
  select * into v_cut from public.inventory_cuts where id = p_cut_id for update;
  if not app_private.can_manage_inventory(v_cut.inventory_id) then raise exception 'Not authorized to generate cut file' using errcode = '42501'; end if;
  if v_cut.status = 'READY' then return jsonb_build_object('action','READY','cut_id',v_cut.id); end if;
  if v_cut.status in ('FILE_GENERATED','VALIDATED') then return jsonb_build_object('action','RECOVER','cut_id',v_cut.id,'request_id',v_cut.generation_request_id); end if;
  if v_cut.status not in ('SNAPSHOT_CREATED','ERROR') then raise exception 'Cut is not ready for file generation' using errcode = '23514'; end if;
  if v_cut.generation_request_id is not null and v_cut.generation_request_id <> p_request_id and v_cut.generation_claimed_at > now() - interval '10 minutes' then
    raise exception 'Generation already in progress' using errcode = '55P03';
  end if;
  update public.inventory_cuts set status='SNAPSHOT_CREATED', generation_request_id=p_request_id,
    generation_claimed_at=now(), generation_error=null where id=v_cut.id;
  return jsonb_build_object('action','GENERATE','cut_id',v_cut.id,'request_id',p_request_id,'actor_id',v_actor);
end;
$$;

create or replace function public.get_cut_export_source(p_cut_id uuid)
returns jsonb language plpgsql security definer set search_path = public, app_private, pg_temp as $$
declare v_cut public.inventory_cuts%rowtype; v_count integer; v_min bigint; v_max bigint;
begin
  perform app_private.require_generator();
  select * into v_cut from public.inventory_cuts where id=p_cut_id for update;
  if not found then raise exception 'Cut not found' using errcode='P0002'; end if;
  select count(*), min((snapshot->>'export_seq')::bigint), max((snapshot->>'export_seq')::bigint)
    into v_count,v_min,v_max from public.inventory_cut_items where cut_id=p_cut_id;
  if v_count <> v_cut.record_count or v_count = 0 or v_min <> v_cut.first_export_seq or v_max <> v_cut.last_export_seq or v_count <> v_max-v_min+1 then
    raise exception 'Snapshot sequence integrity check failed' using errcode='23514';
  end if;
  return jsonb_build_object('cut_id',v_cut.id,'inventory_id',v_cut.inventory_id,'cut_number',v_cut.cut_number,
    'record_count',v_count,'rows',coalesce((select jsonb_agg(snapshot order by (snapshot->>'export_seq')::bigint)
      from public.inventory_cut_items where cut_id=p_cut_id),'[]'::jsonb));
end;
$$;

create or replace function public.record_cut_file_generated(p_cut_id uuid, p_request_id uuid, p_file_name text, p_storage_path text, p_sha256 text, p_size_bytes bigint, p_generator_version text)
returns jsonb language plpgsql security definer set search_path = public, app_private, pg_temp as $$
declare v_cut public.inventory_cuts%rowtype;
begin
  perform app_private.require_generator(); select * into v_cut from public.inventory_cuts where id=p_cut_id for update;
  if not found or v_cut.status <> 'SNAPSHOT_CREATED' or v_cut.generation_request_id <> p_request_id then raise exception 'Invalid generation transition' using errcode='23514'; end if;
  if p_file_name !~ '^INVEN3_[A-Z0-9_]+_CORTE_[0-9]{3}\.xlsx$' or p_storage_path !~ '^inventory/[0-9a-f-]+/cuts/[0-9a-f-]+/INVEN3_[A-Z0-9_]+_CORTE_[0-9]{3}\.xlsx$' or p_sha256 !~ '^[A-Fa-f0-9]{64}$' or p_size_bytes <= 0 then raise exception 'Invalid generated file metadata' using errcode='23514'; end if;
  insert into public.generated_files(inventory_id,cut_id,file_type,file_name,storage_path,sha256,size_bytes,created_by)
    values(v_cut.inventory_id,v_cut.id,'CUT_XLSX',p_file_name,p_storage_path,lower(p_sha256),p_size_bytes,v_cut.created_by)
    on conflict (cut_id,file_type) where file_type='CUT_XLSX' do update set file_name=excluded.file_name,storage_path=excluded.storage_path,sha256=excluded.sha256,size_bytes=excluded.size_bytes,created_at=now();
  update public.inventory_cuts set status='FILE_GENERATED',file_name=p_file_name,file_hash=lower(p_sha256),generator_version=p_generator_version where id=p_cut_id;
  insert into public.audit_events(inventory_id,actor_user_id,event_type,entity_type,entity_id,payload) values(v_cut.inventory_id,v_cut.created_by,'CUT_FILE_GENERATED','inventory_cut',p_cut_id,jsonb_build_object('sha256',lower(p_sha256),'size_bytes',p_size_bytes));
  return jsonb_build_object('status','FILE_GENERATED');
end;
$$;

create or replace function public.mark_cut_file_validated(p_cut_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, app_private, pg_temp as $$
declare v_cut public.inventory_cuts%rowtype;
begin
  perform app_private.require_generator(); select * into v_cut from public.inventory_cuts where id=p_cut_id for update;
  if not found or v_cut.status <> 'FILE_GENERATED' or v_cut.generation_request_id <> p_request_id then raise exception 'Invalid validation transition' using errcode='23514'; end if;
  update public.inventory_cuts set status='VALIDATED' where id=p_cut_id;
  insert into public.audit_events(inventory_id,actor_user_id,event_type,entity_type,entity_id,payload) values(v_cut.inventory_id,v_cut.created_by,'CUT_FILE_VALIDATED','inventory_cut',p_cut_id,jsonb_build_object('sha256',v_cut.file_hash));
  return jsonb_build_object('status','VALIDATED');
end;
$$;

create or replace function public.finalize_cut_file(p_cut_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, app_private, pg_temp as $$
declare v_cut public.inventory_cuts%rowtype;
begin
  perform app_private.require_generator(); select * into v_cut from public.inventory_cuts where id=p_cut_id for update;
  if not found or v_cut.status <> 'VALIDATED' or v_cut.generation_request_id <> p_request_id then raise exception 'Invalid finalize transition' using errcode='23514'; end if;
  if not exists(select 1 from public.generated_files where cut_id=p_cut_id and file_type='CUT_XLSX' and sha256=v_cut.file_hash) then raise exception 'Generated artifact is missing' using errcode='23514'; end if;
  update public.inventory_cuts set status='READY',generation_error=null where id=p_cut_id;
  return jsonb_build_object('status','READY','file_name',v_cut.file_name);
end;
$$;

create or replace function public.get_cut_file_download(p_cut_id uuid)
returns jsonb language plpgsql security definer set search_path = public, app_private, pg_temp as $$
declare v_cut public.inventory_cuts%rowtype; v_file public.generated_files%rowtype;
begin
  perform app_private.require_active_actor(); select * into v_cut from public.inventory_cuts where id=p_cut_id;
  if not found or not app_private.can_manage_inventory(v_cut.inventory_id) then raise exception 'Not authorized to download cut file' using errcode='42501'; end if;
  if v_cut.status <> 'READY' then raise exception 'Cut file is not ready' using errcode='23514'; end if;
  select * into v_file from public.generated_files where cut_id=p_cut_id and file_type='CUT_XLSX';
  return jsonb_build_object('storage_path',v_file.storage_path,'file_name',v_file.file_name);
end;
$$;

revoke all on function app_private.require_generator() from public, anon, authenticated;
revoke all on function public.request_cut_file_generation(uuid,uuid), public.get_cut_export_source(uuid), public.record_cut_file_generated(uuid,uuid,text,text,text,bigint,text), public.mark_cut_file_validated(uuid,uuid), public.finalize_cut_file(uuid,uuid), public.get_cut_file_download(uuid) from public, anon;
grant execute on function public.request_cut_file_generation(uuid,uuid), public.get_cut_file_download(uuid) to authenticated;
