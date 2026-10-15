-- TECHO is the only non-aisle location permitted for physical count capture.
-- Rebuild the existing authoritative functions from their stored definition so
-- this forward-fix remains valid on QA installations that have a different
-- safe patch level, without changing their grants, owner, or security mode.
do $$
declare
  signature text;
  definition text;
  old_pattern constant text := '^(A|B|C|C2|D|F|G|H|I)-[0-9]{2}-[0-9]{2}$';
  new_pattern constant text := '^(TECHO|(A|B|C|C2|D|F|G|H|I)-[0-9]{2}-[0-9]{2})$';
begin
  foreach signature in array array[
    'public.sync_counts(uuid,uuid,public.device_platform,text,text,jsonb)',
    'public.correct_uncut_count(uuid,jsonb,text)',
    'app_private.canonical_rectification_payload(jsonb)'
  ] loop
    select pg_get_functiondef(signature::regprocedure) into definition;
    if position(new_pattern in definition) > 0 then
      continue;
    end if;
    if position(old_pattern in definition) = 0 then
      raise exception 'Expected location contract was not found in %', signature using errcode = 'P0001';
    end if;
    execute replace(definition, old_pattern, new_pattern);
  end loop;
end;
$$;
