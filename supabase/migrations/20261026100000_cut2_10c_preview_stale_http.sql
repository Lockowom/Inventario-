-- CUT2-10C: 40001 is a transaction-retry signal to the local PostgREST
-- gateway.  A stale preview is a deterministic domain rejection, not a
-- serialization failure, so exposing it as 40001 held browser requests until
-- the upstream timeout.  Preserve the same guarded writer with P0001 instead.
create or replace function public.close_inventory_final(p_inventory_id uuid,p_expected_fingerprint text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v_inventory public.inventories; v_actor uuid; v_existing public.inventory_close_requests; v_readiness jsonb; v_result jsonb;
begin
  if p_request_id is null or p_expected_fingerprint is null or p_expected_fingerprint !~ '^[A-Fa-f0-9]{64}$' then raise exception 'INVALID_CLOSE_REQUEST' using errcode='22023'; end if;
  select * into v_inventory from public.inventories where id=p_inventory_id;
  if v_inventory.id is null then raise exception 'INVENTORY_NOT_FOUND' using errcode='P0002'; end if;
  v_actor:=app_private.require_inventory_capability(p_inventory_id,'CLOSE_INVENTORY'::public.cut2_capability,v_inventory.warehouse_id);
  select * into v_inventory from public.inventories where id=p_inventory_id for update;
  select * into v_existing from public.inventory_close_requests where inventory_id=p_inventory_id and request_id=p_request_id for update;
  if v_existing.id is not null then
    if v_existing.request_fingerprint is distinct from lower(p_expected_fingerprint) then raise exception 'REQUEST_REPLAY_CONFLICT' using errcode='23505'; end if;
    if v_existing.state='COMPLETED' then return coalesce(v_existing.result,jsonb_build_object('inventory_id',p_inventory_id)) || jsonb_build_object('idempotent',true); end if;
  end if;
  if v_inventory.status='CERRADO' then raise exception 'INVENTORY_ALREADY_CLOSED' using errcode='23514'; end if;
  v_readiness:=app_private.inventory_close_readiness(p_inventory_id);
  if lower(v_readiness->>'fingerprint')<>lower(p_expected_fingerprint) then raise exception 'PREVIEW_STALE' using errcode='P0001'; end if;
  if not coalesce((v_readiness->>'is_ready')::boolean,false) then raise exception 'INVENTORY_NOT_READY' using errcode='23514',detail=coalesce(v_readiness->'blocker_codes','[]'::jsonb)::text; end if;
  if v_existing.id is null then
    insert into public.inventory_close_requests(inventory_id,request_id,started_by,request_fingerprint,state)
    values(p_inventory_id,p_request_id,v_actor,lower(p_expected_fingerprint),'REQUESTED') returning * into v_existing;
  end if;
  update public.inventories set status='CERRADO',closed_at=now(),closed_by=v_actor,close_request_id=v_existing.id,updated_at=now() where id=p_inventory_id;
  v_result:=jsonb_build_object('inventory_id',p_inventory_id,'close_request_id',v_existing.id,'status','CERRADO','fingerprint',lower(p_expected_fingerprint),'idempotent',false);
  update public.inventory_close_requests set state='COMPLETED',completed_at=now(),result=v_result where id=v_existing.id;
  insert into public.audit_events(inventory_id,actor_user_id,event_type,entity_type,entity_id,payload)
  values(p_inventory_id,v_actor,'INVENTORY_CLOSED','inventory',p_inventory_id,jsonb_build_object('request_id',p_request_id,'fingerprint',lower(p_expected_fingerprint),'readiness',v_readiness->'blocker_counts','version','CUT2_10C'));
  return v_result;
end $fn$;

revoke all on function public.close_inventory_final(uuid,text,uuid) from public,anon;
grant execute on function public.close_inventory_final(uuid,text,uuid) to authenticated;
