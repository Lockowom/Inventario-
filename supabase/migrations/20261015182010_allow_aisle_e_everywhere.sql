-- Apply the aisle E contract everywhere a physical location is accepted:
-- C1 count sync, count rectification, and C2's discovered recount locations.
-- Stored definitions retain their owner, grants, security and all non-location
-- business rules; only the exact audited location contract can be replaced.
do $migration$
declare
  signature text;
  function_oid regprocedure;
  definition_sql text;
  prior_pattern constant text := '^(TECHO|(A|B|C|C2|D|F|G|H|I)-[0-9]{2}-[0-9]{2})$';
  next_pattern constant text := '^(TECHO|(A|B|C|C2|D|E|F|G|H|I)-[0-9]{2}-[0-9]{2})$';
  contract_found boolean := false;
begin
  foreach signature in array array[
    'public.sync_counts(uuid,uuid,public.device_platform,text,text,jsonb)',
    'app_private.sync_counts_pre_cut2_03(uuid,uuid,public.device_platform,text,text,jsonb)',
    'public.correct_uncut_count(uuid,jsonb,text)',
    'app_private.canonical_rectification_payload(jsonb)',
    'public.add_my_recount_location(uuid,text,text)'
  ] loop
    function_oid := to_regprocedure(signature);
    continue when function_oid is null;
    select pg_get_functiondef(function_oid) into definition_sql;

    if position(next_pattern in definition_sql) > 0 then
      contract_found := true;
    elsif position(prior_pattern in definition_sql) > 0 then
      execute replace(definition_sql, prior_pattern, next_pattern);
      contract_found := true;
    elsif position('INVALID_LOCATION' in definition_sql) > 0 or position('Invalid location' in definition_sql) > 0 then
      raise exception 'Location contract changed; refusing blind E update in %', signature using errcode = 'P0001';
    end if;
  end loop;

  if not contract_found then
    raise exception 'No physical-location contract was found for the E update' using errcode = 'P0001';
  end if;
end
$migration$;

alter table public.recount_mission_subtasks
  drop constraint if exists recount_mission_subtasks_location_check;

alter table public.recount_mission_subtasks
  add constraint recount_mission_subtasks_location_check
  check (location ~ '^(TECHO|(A|B|C|C2|D|E|F|G|H|I)-[0-9]{2}-[0-9]{2})$');
