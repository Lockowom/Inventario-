-- Keep every Phase 7 generation lifecycle audit event attributed to the
-- assigned analyst who canonically requested the artifact, not its creator.
create or replace function public.mark_cut_file_validated(p_cut_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, app_private, pg_temp as $$
declare v_cut public.inventory_cuts%rowtype;
begin
  perform app_private.require_generator();
  select * into v_cut from public.inventory_cuts where id = p_cut_id for update;
  if not found or v_cut.status <> 'FILE_GENERATED' or v_cut.generation_request_id <> p_request_id then
    raise exception 'Invalid validation transition' using errcode = '23514';
  end if;
  if v_cut.generation_requested_by is null then
    raise exception 'Generation requester is required' using errcode = '23514';
  end if;
  update public.inventory_cuts set status = 'VALIDATED' where id = p_cut_id;
  insert into public.audit_events(inventory_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (v_cut.inventory_id, v_cut.generation_requested_by, 'CUT_FILE_VALIDATED', 'inventory_cut', p_cut_id,
    jsonb_build_object('sha256', v_cut.file_hash, 'generation_requested_by', v_cut.generation_requested_by));
  return jsonb_build_object('status', 'VALIDATED');
end;
$$;
