-- Fase 7 hardening: canonical recovery, immutable official artifact and actor attribution.
alter type public.audit_event_type add value if not exists 'CUT_READY';
alter table public.inventory_cuts add column generation_requested_by uuid references public.profiles(user_id) on delete restrict;

create or replace function public.request_cut_file_generation(p_cut_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, app_private, pg_temp as $$
declare v_actor uuid:=app_private.require_active_actor(); v_cut public.inventory_cuts%rowtype;
begin
  if p_request_id is null then raise exception 'Generation request_id is required' using errcode='23514'; end if;
  select * into v_cut from public.inventory_cuts where id=p_cut_id; if not found then raise exception 'Cut not found' using errcode='P0002'; end if;
  perform app_private.lock_inventory(v_cut.inventory_id); select * into v_cut from public.inventory_cuts where id=p_cut_id for update;
  if not app_private.can_manage_inventory(v_cut.inventory_id) then raise exception 'Not authorized to generate cut file' using errcode='42501'; end if;
  if v_cut.status='READY' then return jsonb_build_object('action','READY','cut_id',v_cut.id,'request_id',v_cut.generation_request_id); end if;
  if v_cut.status in ('FILE_GENERATED','VALIDATED') then return jsonb_build_object('action','RECOVER','cut_id',v_cut.id,'request_id',v_cut.generation_request_id); end if;
  if v_cut.status='SNAPSHOT_CREATED' and v_cut.generation_request_id is not null then
    if v_cut.generation_request_id=p_request_id then return jsonb_build_object('action','GENERATE','cut_id',v_cut.id,'request_id',v_cut.generation_request_id); end if;
    raise exception 'Generation already in progress' using errcode='55P03';
  end if;
  if v_cut.status not in ('SNAPSHOT_CREATED','ERROR') then raise exception 'Cut is not ready for file generation' using errcode='23514'; end if;
  update public.inventory_cuts set status='SNAPSHOT_CREATED',generation_request_id=p_request_id,generation_claimed_at=now(),generation_requested_by=v_actor,generation_error=null where id=v_cut.id;
  return jsonb_build_object('action','GENERATE','cut_id',v_cut.id,'request_id',p_request_id);
end $$;

create or replace function public.mark_cut_file_error(p_cut_id uuid,p_request_id uuid,p_message text)
returns jsonb language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_cut public.inventory_cuts%rowtype; v_message text:=left(coalesce(nullif(btrim(p_message),''),'Generation failed safely.'),500);
begin perform app_private.require_generator(); select * into v_cut from public.inventory_cuts where id=p_cut_id for update; if not found or v_cut.status='READY' or v_cut.generation_request_id<>p_request_id then raise exception 'Invalid error transition' using errcode='23514'; end if; update public.inventory_cuts set status='ERROR',generation_error=v_message where id=p_cut_id; return jsonb_build_object('status','ERROR'); end $$;

create or replace function public.record_cut_file_generated(p_cut_id uuid,p_request_id uuid,p_file_name text,p_storage_path text,p_sha256 text,p_size_bytes bigint,p_generator_version text)
returns jsonb language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_cut public.inventory_cuts%rowtype;
begin perform app_private.require_generator(); select * into v_cut from public.inventory_cuts where id=p_cut_id for update;
if not found or v_cut.status<>'SNAPSHOT_CREATED' or v_cut.generation_request_id<>p_request_id then raise exception 'Invalid generation transition' using errcode='23514'; end if;
if exists(select 1 from public.generated_files where cut_id=p_cut_id and file_type='CUT_XLSX') then raise exception 'Official artifact already exists; recover it' using errcode='23514'; end if;
insert into public.generated_files(inventory_id,cut_id,file_type,file_name,storage_path,sha256,size_bytes,created_by) values(v_cut.inventory_id,p_cut_id,'CUT_XLSX',p_file_name,p_storage_path,lower(p_sha256),p_size_bytes,v_cut.generation_requested_by);
update public.inventory_cuts set status='FILE_GENERATED',file_name=p_file_name,file_hash=lower(p_sha256),generator_version=p_generator_version where id=p_cut_id;
insert into public.audit_events(inventory_id,actor_user_id,event_type,entity_type,entity_id,payload) values(v_cut.inventory_id,v_cut.generation_requested_by,'CUT_FILE_GENERATED','inventory_cut',p_cut_id,jsonb_build_object('cut_id',p_cut_id,'cut_number',v_cut.cut_number,'file_name',p_file_name,'sha256',lower(p_sha256),'size_bytes',p_size_bytes,'generator_version',p_generator_version,'generation_requested_by',v_cut.generation_requested_by)); return jsonb_build_object('status','FILE_GENERATED'); end $$;

create or replace function public.finalize_cut_file(p_cut_id uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_cut public.inventory_cuts%rowtype; v_file public.generated_files%rowtype;
begin perform app_private.require_generator();select * into v_cut from public.inventory_cuts where id=p_cut_id for update;if not found or v_cut.status<>'VALIDATED' or v_cut.generation_request_id<>p_request_id then raise exception 'Invalid finalize transition' using errcode='23514';end if;select * into v_file from public.generated_files where cut_id=p_cut_id and file_type='CUT_XLSX';if not found or v_file.sha256<>v_cut.file_hash then raise exception 'Generated artifact is missing' using errcode='23514';end if;update public.inventory_cuts set status='READY',generation_error=null where id=p_cut_id;insert into public.audit_events(inventory_id,actor_user_id,event_type,entity_type,entity_id,payload) values(v_cut.inventory_id,v_cut.generation_requested_by,'CUT_READY','inventory_cut',p_cut_id,jsonb_build_object('cut_id',p_cut_id,'cut_number',v_cut.cut_number,'file_name',v_file.file_name,'sha256',v_file.sha256,'size_bytes',v_file.size_bytes,'generator_version',v_cut.generator_version,'generation_requested_by',v_cut.generation_requested_by));return jsonb_build_object('status','READY','file_name',v_file.file_name);end $$;

create or replace function public.list_inventory_cuts(p_inventory_id uuid,p_limit integer default 50,p_before_cut_number integer default null) returns table(id uuid,cut_number integer,status public.cut_status,created_at timestamptz,created_by uuid,record_count integer,first_export_seq bigint,last_export_seq bigint,request_id uuid,file_name text,file_hash text,generator_version text,generation_error text,size_bytes bigint) language plpgsql stable security definer set search_path=public,app_private,pg_temp as $$ begin perform app_private.require_active_actor();if not app_private.can_manage_inventory(p_inventory_id) then raise exception 'Not authorized to list cuts' using errcode='42501';end if;return query select c.id,c.cut_number,c.status,c.created_at,c.created_by,c.record_count,c.first_export_seq,c.last_export_seq,c.request_id,c.file_name,c.file_hash,c.generator_version,c.generation_error,f.size_bytes from public.inventory_cuts c left join public.generated_files f on f.cut_id=c.id and f.file_type='CUT_XLSX' where c.inventory_id=p_inventory_id and(p_before_cut_number is null or c.cut_number<p_before_cut_number) order by c.cut_number desc limit p_limit;end $$;
revoke all on function public.mark_cut_file_error(uuid,uuid,text) from public,anon,authenticated;

create or replace function public.get_cut_export_source(p_cut_id uuid) returns jsonb language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_cut public.inventory_cuts%rowtype;v_count integer;v_min bigint;v_max bigint;v_file public.generated_files%rowtype;
begin perform app_private.require_generator();select * into v_cut from public.inventory_cuts where id=p_cut_id for update;if not found then raise exception 'Cut not found' using errcode='P0002';end if;select count(*),min((snapshot->>'export_seq')::bigint),max((snapshot->>'export_seq')::bigint) into v_count,v_min,v_max from public.inventory_cut_items where cut_id=p_cut_id;if v_count<>v_cut.record_count or v_count=0 or v_min<>v_cut.first_export_seq or v_max<>v_cut.last_export_seq or v_count<>v_max-v_min+1 then raise exception 'Snapshot sequence integrity check failed' using errcode='23514';end if;select * into v_file from public.generated_files where cut_id=p_cut_id and file_type='CUT_XLSX';return jsonb_build_object('cut_id',v_cut.id,'inventory_id',v_cut.inventory_id,'cut_number',v_cut.cut_number,'status',v_cut.status,'record_count',v_count,'file_name',v_file.file_name,'storage_path',v_file.storage_path,'sha256',v_file.sha256,'size_bytes',v_file.size_bytes,'rows',(select jsonb_agg(snapshot order by(snapshot->>'export_seq')::bigint) from public.inventory_cut_items where cut_id=p_cut_id));end $$;
