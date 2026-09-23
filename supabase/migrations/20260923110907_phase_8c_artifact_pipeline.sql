-- Fase 8C: pipeline server-side para evidencia privada.  Esta migración es
-- forward-only y no modifica evidencia ni contratos de Fases 0–8B.

alter table public.artifact_generations
  add column file_name text,
  add column attempt_count integer not null default 0 check (attempt_count >= 0);

update storage.buckets
set public = false,
    allowed_mime_types = array[
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/json',
      'application/zip'
    ]
where id = 'inventory-rp';

create or replace function app_private.assert_artifact_actor(p_generation public.artifact_generations)
returns uuid
language plpgsql security definer
set search_path = public, app_private, pg_temp
as $$
declare v_actor uuid := app_private.require_active_actor();
begin
  if p_generation.artifact_type = 'TECHNICAL_BACKUP' then
    if not app_private.is_admin() then raise exception 'Not authorized for technical backups' using errcode = '42501'; end if;
  elsif not app_private.can_manage_inventory(p_generation.inventory_id) then
    raise exception 'Not authorized for inventory artifact' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

-- This is deliberately the only authenticated entrypoint used by Edge before
-- service-role lifecycle RPCs.  It returns no source content.
create or replace function public.authorize_inventory_artifact_generation(p_artifact_generation_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app_private, pg_temp
as $$
declare v_generation public.artifact_generations%rowtype;
begin
  select * into v_generation from public.artifact_generations where id = p_artifact_generation_id;
  if not found then raise exception 'Artifact generation not found' using errcode = 'P0002'; end if;
  perform app_private.assert_artifact_actor(v_generation);
  return jsonb_build_object('artifact_generation_id', v_generation.id, 'status', v_generation.status);
end;
$$;

create or replace function public.claim_inventory_artifact_generation(p_artifact_generation_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app_private, pg_temp
as $$
declare v_generation public.artifact_generations%rowtype;
begin
  perform app_private.require_generator();
  select * into v_generation from public.artifact_generations where id = p_artifact_generation_id for update;
  if not found then raise exception 'Artifact generation not found' using errcode = 'P0002'; end if;
  if v_generation.status = 'READY' then return jsonb_build_object('action', 'READY', 'status', v_generation.status); end if;
  if v_generation.status = 'VALIDATED' then return jsonb_build_object('action', 'FINALIZE', 'status', v_generation.status); end if;
  if v_generation.status = 'FILE_GENERATED' then return jsonb_build_object('action', 'VALIDATE', 'status', v_generation.status); end if;
  if v_generation.status = 'ERROR' and v_generation.sha256 is not null and v_generation.size_bytes is not null then
    return jsonb_build_object('action', 'RECOVER', 'status', v_generation.status);
  end if;
  update public.artifact_generations set attempt_count = attempt_count + 1, error_safe = null where id = v_generation.id;
  return jsonb_build_object('action', 'GENERATE', 'status', v_generation.status);
end;
$$;

create or replace function public.get_inventory_artifact_source(p_artifact_generation_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app_private, pg_temp
as $$
declare v_generation public.artifact_generations%rowtype;
declare v_cut public.inventory_cuts%rowtype;
declare v_rect public.cut_rectifications%rowtype;
declare v_file public.generated_files%rowtype;
begin
  perform app_private.require_generator();
  select * into v_generation from public.artifact_generations where id = p_artifact_generation_id for update;
  if not found then raise exception 'Artifact generation not found' using errcode = 'P0002'; end if;
  if v_generation.cut_id is not null then select * into v_cut from public.inventory_cuts where id = v_generation.cut_id; end if;
  if v_generation.rectification_id is not null then select * into v_rect from public.cut_rectifications where id = v_generation.rectification_id; end if;
  if v_generation.scope = 'RECTIFICATION_XLSX' then
    return jsonb_build_object('generation', to_jsonb(v_generation), 'inventory', (select to_jsonb(i) from public.inventories i where i.id=v_generation.inventory_id), 'cut', to_jsonb(v_cut), 'rectification', to_jsonb(v_rect) || jsonb_build_object('old_values_sha256', encode(extensions.digest(convert_to(v_rect.old_values::text, 'utf8'), 'sha256'), 'hex'), 'new_values_sha256', encode(extensions.digest(convert_to(v_rect.new_values::text, 'utf8'), 'sha256'), 'hex')));
  end if;
  if v_generation.scope = 'CUT_SNAPSHOT' then
    select * into v_file from public.generated_files where cut_id=v_generation.cut_id and file_type='CUT_XLSX';
    if not found then raise exception 'CUT_XLSX source is missing' using errcode='23514'; end if;
    return jsonb_build_object('generation', to_jsonb(v_generation), 'inventory', (select to_jsonb(i) from public.inventories i where i.id=v_generation.inventory_id), 'cut', to_jsonb(v_cut), 'cut_items', (select coalesce(jsonb_agg(snapshot order by (snapshot->>'export_seq')::integer), '[]'::jsonb) from public.inventory_cut_items where cut_id=v_generation.cut_id), 'cut_xlsx', jsonb_build_object('id',v_file.id,'file_name',v_file.file_name,'storage_path',v_file.storage_path,'sha256',v_file.sha256,'size_bytes',v_file.size_bytes));
  end if;
  return jsonb_build_object(
    'generation', to_jsonb(v_generation),
    'inventory', (select to_jsonb(i) from public.inventories i where i.id=v_generation.inventory_id),
    'cuts', (select coalesce(jsonb_agg(to_jsonb(c) order by c.cut_number), '[]'::jsonb) from public.inventory_cuts c where c.inventory_id=v_generation.inventory_id and (v_generation.cut_id is null or c.id=v_generation.cut_id)),
    'cut_items', (select coalesce(jsonb_agg(jsonb_build_object('cut_id',ci.cut_id,'count_record_id',ci.count_record_id,'snapshot',ci.snapshot) order by ci.cut_id,(ci.snapshot->>'export_seq')::integer), '[]'::jsonb) from public.inventory_cut_items ci where ci.inventory_id=v_generation.inventory_id and (v_generation.cut_id is null or ci.cut_id=v_generation.cut_id)),
    'rectifications', (select coalesce(jsonb_agg(to_jsonb(r) order by r.cut_id,r.rectification_number), '[]'::jsonb) from public.cut_rectifications r where r.inventory_id=v_generation.inventory_id and (v_generation.cut_id is null or r.cut_id=v_generation.cut_id) and r.created_at <= v_generation.as_of_at),
    'artifacts', (select coalesce(jsonb_agg(jsonb_build_object('generation_id',g.id,'artifact_type',g.artifact_type,'scope',g.scope,'status',g.status,'storage_path',g.storage_path,'sha256',g.sha256,'size_bytes',g.size_bytes) order by g.created_at,g.id), '[]'::jsonb) from public.artifact_generations g where g.inventory_id=v_generation.inventory_id and g.id <> v_generation.id and g.created_at <= v_generation.as_of_at)
  );
end;
$$;

create or replace function public.record_inventory_artifact_generated(p_artifact_generation_id uuid, p_file_name text, p_sha256 text, p_size_bytes bigint, p_generator_version text)
returns jsonb
language plpgsql security definer
set search_path = public, app_private, pg_temp
as $$
declare v_generation public.artifact_generations%rowtype;
begin
  perform app_private.require_generator();
  if p_file_name is null or length(btrim(p_file_name))=0 or p_sha256 !~ '^[a-f0-9]{64}$' or p_size_bytes < 0 then raise exception 'Invalid generated artifact metadata' using errcode='23514'; end if;
  select * into v_generation from public.artifact_generations where id=p_artifact_generation_id for update;
  if not found then raise exception 'Artifact generation not found' using errcode='P0002'; end if;
  if v_generation.status in ('FILE_GENERATED','VALIDATED','READY') then
    if v_generation.sha256=p_sha256 and v_generation.size_bytes=p_size_bytes and v_generation.file_name=p_file_name then return jsonb_build_object('status',v_generation.status); end if;
    raise exception 'Generated artifact metadata conflicts with canonical artifact' using errcode='23514';
  end if;
  if v_generation.status not in ('REQUESTED','ERROR') then raise exception 'Invalid artifact generated transition' using errcode='23514'; end if;
  update public.artifact_generations set status='FILE_GENERATED',file_name=p_file_name,sha256=p_sha256,size_bytes=p_size_bytes,generator_version=p_generator_version,error_safe=null where id=v_generation.id;
  insert into public.audit_events(inventory_id,actor_user_id,event_type,entity_type,entity_id,payload) values(v_generation.inventory_id,v_generation.requested_by,'ARTIFACT_FILE_GENERATED','artifact_generation',v_generation.id,jsonb_build_object('artifact_generation_id',v_generation.id,'artifact_type',v_generation.artifact_type,'scope',v_generation.scope,'sha256',p_sha256,'size_bytes',p_size_bytes,'requested_by',v_generation.requested_by));
  return jsonb_build_object('status','FILE_GENERATED');
end;
$$;

create or replace function public.mark_inventory_artifact_validated(p_artifact_generation_id uuid)
returns jsonb language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_generation public.artifact_generations%rowtype;
begin
 perform app_private.require_generator(); select * into v_generation from public.artifact_generations where id=p_artifact_generation_id for update;
 if not found then raise exception 'Artifact generation not found' using errcode='P0002'; end if;
 if v_generation.status in ('VALIDATED','READY') then return jsonb_build_object('status',v_generation.status); end if;
 if v_generation.status<>'FILE_GENERATED' then raise exception 'Invalid artifact validated transition' using errcode='23514'; end if;
 update public.artifact_generations set status='VALIDATED',error_safe=null where id=v_generation.id;
 insert into public.audit_events(inventory_id,actor_user_id,event_type,entity_type,entity_id,payload) values(v_generation.inventory_id,v_generation.requested_by,'ARTIFACT_VALIDATED','artifact_generation',v_generation.id,jsonb_build_object('artifact_generation_id',v_generation.id,'artifact_type',v_generation.artifact_type,'scope',v_generation.scope,'sha256',v_generation.sha256,'size_bytes',v_generation.size_bytes,'requested_by',v_generation.requested_by));
 return jsonb_build_object('status','VALIDATED');
end $$;

create or replace function public.finalize_inventory_artifact(p_artifact_generation_id uuid)
returns jsonb language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_generation public.artifact_generations%rowtype; v_file public.generated_files%rowtype;
begin
 perform app_private.require_generator(); select * into v_generation from public.artifact_generations where id=p_artifact_generation_id for update;
 if not found then raise exception 'Artifact generation not found' using errcode='P0002'; end if;
 if v_generation.status='READY' then select * into v_file from public.generated_files where artifact_generation_id=v_generation.id; return jsonb_build_object('status','READY','file_id',v_file.id,'file_name',v_file.file_name); end if;
 if v_generation.status<>'VALIDATED' or v_generation.file_name is null or v_generation.sha256 is null or v_generation.size_bytes is null then raise exception 'Invalid artifact READY transition' using errcode='23514'; end if;
 insert into public.generated_files(inventory_id,cut_id,rectification_id,artifact_generation_id,file_type,file_name,storage_path,sha256,size_bytes,content_type,created_by)
 values(v_generation.inventory_id,v_generation.cut_id,v_generation.rectification_id,v_generation.id,v_generation.artifact_type,v_generation.file_name,v_generation.storage_path,v_generation.sha256,v_generation.size_bytes,case when v_generation.artifact_type='RECTIFICATION_XLSX' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' when v_generation.artifact_type='SNAPSHOT' then 'application/json' else 'application/zip' end,v_generation.requested_by)
 returning * into v_file;
 update public.artifact_generations set status='READY',error_safe=null where id=v_generation.id;
 insert into public.audit_events(inventory_id,actor_user_id,event_type,entity_type,entity_id,payload) values(v_generation.inventory_id,v_generation.requested_by,'ARTIFACT_READY','artifact_generation',v_generation.id,jsonb_build_object('artifact_generation_id',v_generation.id,'generated_file_id',v_file.id,'artifact_type',v_generation.artifact_type,'scope',v_generation.scope,'sha256',v_generation.sha256,'size_bytes',v_generation.size_bytes,'requested_by',v_generation.requested_by));
 return jsonb_build_object('status','READY','file_id',v_file.id,'file_name',v_file.file_name);
end $$;

create or replace function public.mark_inventory_artifact_error(p_artifact_generation_id uuid,p_message text)
returns jsonb language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_generation public.artifact_generations%rowtype; v_message text:=left(coalesce(nullif(btrim(p_message),''),'Artifact generation failed safely.'),500);
begin
 perform app_private.require_generator(); select * into v_generation from public.artifact_generations where id=p_artifact_generation_id for update;
 if not found or v_generation.status='READY' then raise exception 'Invalid artifact error transition' using errcode='23514'; end if;
 update public.artifact_generations set status='ERROR',error_safe=v_message where id=v_generation.id;
 insert into public.audit_events(inventory_id,actor_user_id,event_type,entity_type,entity_id,payload) values(v_generation.inventory_id,v_generation.requested_by,'ARTIFACT_ERROR','artifact_generation',v_generation.id,jsonb_build_object('artifact_generation_id',v_generation.id,'artifact_type',v_generation.artifact_type,'scope',v_generation.scope,'message',v_message,'attempt_number',v_generation.attempt_count,'requested_by',v_generation.requested_by));
 return jsonb_build_object('status','ERROR');
end $$;

create or replace function public.recover_inventory_artifact_generated(p_artifact_generation_id uuid)
returns jsonb language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_generation public.artifact_generations%rowtype;
begin
 perform app_private.require_generator(); select * into v_generation from public.artifact_generations where id=p_artifact_generation_id for update;
 if not found or v_generation.status<>'ERROR' or v_generation.sha256 is null or v_generation.size_bytes is null or v_generation.file_name is null then raise exception 'Verified artifact recovery is not allowed' using errcode='23514'; end if;
 update public.artifact_generations set status='FILE_GENERATED',error_safe=null where id=v_generation.id;
 return jsonb_build_object('status','FILE_GENERATED');
end $$;

create or replace function public.get_inventory_artifact_download(p_artifact_generation_id uuid)
returns jsonb language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_generation public.artifact_generations%rowtype; v_file public.generated_files%rowtype; v_actor uuid;
begin
 select * into v_generation from public.artifact_generations where id=p_artifact_generation_id; if not found or v_generation.status<>'READY' then raise exception 'Artifact is not READY' using errcode='23514'; end if;
 v_actor:=app_private.assert_artifact_actor(v_generation); select * into v_file from public.generated_files where artifact_generation_id=v_generation.id;
 if not found then raise exception 'Official artifact file is missing' using errcode='23514'; end if;
 insert into public.audit_events(inventory_id,actor_user_id,event_type,entity_type,entity_id,payload) values(v_generation.inventory_id,v_actor,'ARTIFACT_DOWNLOADED','artifact_generation',v_generation.id,jsonb_build_object('actor_user_id',v_actor,'artifact_generation_id',v_generation.id,'generated_file_id',v_file.id,'artifact_type',v_generation.artifact_type,'scope',v_generation.scope,'sha256',v_file.sha256,'size_bytes',v_file.size_bytes));
 return jsonb_build_object('storage_path',v_file.storage_path,'file_name',v_file.file_name,'sha256',v_file.sha256,'size_bytes',v_file.size_bytes);
end $$;

revoke all on function app_private.assert_artifact_actor(public.artifact_generations) from public, anon, authenticated;
revoke all on function public.claim_inventory_artifact_generation(uuid), public.get_inventory_artifact_source(uuid), public.record_inventory_artifact_generated(uuid,text,text,bigint,text), public.mark_inventory_artifact_validated(uuid), public.finalize_inventory_artifact(uuid), public.mark_inventory_artifact_error(uuid,text), public.recover_inventory_artifact_generated(uuid) from public, anon, authenticated;
grant execute on function public.claim_inventory_artifact_generation(uuid), public.get_inventory_artifact_source(uuid), public.record_inventory_artifact_generated(uuid,text,text,bigint,text), public.mark_inventory_artifact_validated(uuid), public.finalize_inventory_artifact(uuid), public.mark_inventory_artifact_error(uuid,text), public.recover_inventory_artifact_generated(uuid) to service_role;
revoke all on function public.authorize_inventory_artifact_generation(uuid), public.get_inventory_artifact_download(uuid) from public, anon;
grant execute on function public.authorize_inventory_artifact_generation(uuid), public.get_inventory_artifact_download(uuid) to authenticated;
