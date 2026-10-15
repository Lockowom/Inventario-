-- Permit aisle E in the authoritative F16 capture implementation. Before
-- CUT2 it lives in public.sync_counts; after CUT2 the public RPC is only a
-- sealing wrapper and delegates to app_private.sync_counts_pre_cut2_03.
-- Preserve every other part of the stored definition (grants, owner,
-- idempotency and C1/C2 behavior) while changing only the location contract.
do $migration$
declare
  signature text;
  function_oid regprocedure;
  definition_sql text;
  legacy_pattern constant text := '^(A|B|C|C2|D|F|G|H|I)-[0-9]{2}-[0-9]{2}$';
  prior_pattern constant text := '^(TECHO|(A|B|C|C2|D|F|G|H|I)-[0-9]{2}-[0-9]{2})$';
  next_pattern constant text := '^(TECHO|(A|B|C|C2|D|E|F|G|H|I)-[0-9]{2}-[0-9]{2})$';
  contract_found boolean := false;
begin
  foreach signature in array array[
    'public.sync_counts(uuid,uuid,public.device_platform,text,text,jsonb)',
    'app_private.sync_counts_pre_cut2_03(uuid,uuid,public.device_platform,text,text,jsonb)'
  ] loop
    function_oid := to_regprocedure(signature);
    continue when function_oid is null;
    select pg_get_functiondef(function_oid) into definition_sql;

    if position(next_pattern in definition_sql) > 0 then
      contract_found := true;
    elsif position(prior_pattern in definition_sql) > 0 then
      execute replace(definition_sql, prior_pattern, next_pattern);
      contract_found := true;
    elsif position(legacy_pattern in definition_sql) > 0 then
      execute replace(definition_sql, legacy_pattern, next_pattern);
      contract_found := true;
    elsif position('INVALID_LOCATION' in definition_sql) > 0 then
      raise exception 'sync_counts location contract changed; refusing blind E hotfix in %', signature using errcode = 'P0001';
    end if;
  end loop;

  if not contract_found then
    raise exception 'No authoritative sync_counts location contract was found' using errcode = 'P0001';
  end if;
end
$migration$;

alter type public.audit_event_type add value if not exists 'C1_REOPENED';

create or replace function public.reopen_c1_coverage(
  p_inventory_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $function$
declare
  actor uuid := app_private.require_active_actor();
  inventory_row public.inventories%rowtype;
  prior_completed_at timestamptz;
  cancelled_missions integer := 0;
begin
  if not app_private.can_manage_inventory(p_inventory_id) then
    raise exception 'Not authorized to reopen C1' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'A reopen reason of at least 10 characters is required' using errcode = '23514';
  end if;

  select * into inventory_row
  from public.inventories
  where id = p_inventory_id
  for update;

  if inventory_row.id is null then
    raise exception 'Inventory not found' using errcode = 'P0002';
  end if;
  if inventory_row.status <> 'ABIERTO' then
    raise exception 'Only an ABIERTO inventory can reopen C1' using errcode = '23514';
  end if;
  if inventory_row.c1_completed_at is null then
    return public.get_inventory_lifecycle(p_inventory_id);
  end if;
  if exists (
    select 1
    from public.recount_missions
    where inventory_id = p_inventory_id
      and status in ('ACTIVE', 'COMPLETED')
  ) then
    raise exception 'C1 cannot reopen after recount execution has started' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.recount_mission_observations observation
    join public.recount_missions mission on mission.id = observation.mission_id
    where mission.inventory_id = p_inventory_id
  ) then
    raise exception 'C1 cannot reopen when recount observations exist' using errcode = '23514';
  end if;

  prior_completed_at := inventory_row.c1_completed_at;

  update public.recount_missions
  set status = 'CANCELLED',
      updated_at = now()
  where inventory_id = p_inventory_id
    and status = 'QUEUED';
  get diagnostics cancelled_missions = row_count;

  update public.inventories
  set c1_completed_at = null,
      c1_completed_by = null,
      c1_count_records = null,
      c1_counted_units = null,
      c1_master_fingerprint = null,
      c1_reference_fingerprint = null
  where id = p_inventory_id;

  insert into public.audit_events(
    inventory_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    p_inventory_id,
    actor,
    'C1_REOPENED',
    'inventory',
    p_inventory_id,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'previous_c1_completed_at', prior_completed_at,
      'cancelled_queued_missions', cancelled_missions
    )
  );

  return public.get_inventory_lifecycle(p_inventory_id)
    || jsonb_build_object('cancelled_queued_missions', cancelled_missions);
end
$function$;

revoke all on function public.reopen_c1_coverage(uuid, text) from public, anon;
grant execute on function public.reopen_c1_coverage(uuid, text) to authenticated;
