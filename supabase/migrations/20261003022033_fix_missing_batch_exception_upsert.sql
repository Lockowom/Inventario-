-- Forward-only repair for the upsert ambiguity caused by the RETURNS TABLE field name.
create or replace function public.authorize_missing_batch_exceptions(p_inventory_id uuid, p_codes text[], p_reason text)
returns table(codigo text, reason text, placeholder text)
language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare actor uuid:=app_private.require_active_actor(); normalized_reason text:=btrim(p_reason); target public.inventories%rowtype; code_value text; exception_id uuid;
begin
 if not app_private.is_admin() then raise exception 'Only ADMIN can authorize missing batch exceptions' using errcode='42501'; end if;
 target:=app_private.lock_inventory(p_inventory_id);
 if target.status not in ('BORRADOR','PREPARADO') then raise exception 'Missing batch exceptions are only allowed in BORRADOR or PREPARADO' using errcode='23514'; end if;
 if normalized_reason is null or length(normalized_reason)<10 then raise exception 'A reason of at least 10 characters is required' using errcode='23514'; end if;
 if p_codes is null or cardinality(p_codes)<1 or cardinality(p_codes)>1000 then raise exception 'Between 1 and 1000 codes are required' using errcode='23514'; end if;
 for code_value in select distinct upper(btrim(value)) from unnest(p_codes) value loop
  if code_value is null or code_value='' or not exists(select 1 from public.inventory_master_items master where master.inventory_id=p_inventory_id and master.codigo=code_value and master.control_type='PARTIDA') then raise exception 'Missing batch exception requires an existing PARTIDA SKU' using errcode='23514'; end if;
  insert into public.inventory_missing_batch_exceptions(inventory_id,codigo,reason,created_by) values(p_inventory_id,code_value,normalized_reason,actor)
  on conflict on constraint inventory_missing_batch_exceptions_inventory_id_codigo_key do update set active=true, reason=excluded.reason
  returning id into exception_id;
  insert into public.audit_events(inventory_id,actor_user_id,event_type,entity_type,entity_id,payload) values(p_inventory_id,actor,'MISSING_BATCH_EXCEPTION_AUTHORIZED','inventory_missing_batch_exception',exception_id,jsonb_build_object('codigo',code_value,'reason',normalized_reason,'placeholder','EXC-SIN-PARTIDA:'||code_value));
  codigo:=code_value; reason:=normalized_reason; placeholder:='EXC-SIN-PARTIDA:'||code_value; return next;
 end loop;
end $$;
revoke all on function public.authorize_missing_batch_exceptions(uuid,text[],text) from public,anon;
grant execute on function public.authorize_missing_batch_exceptions(uuid,text[],text) to authenticated;
