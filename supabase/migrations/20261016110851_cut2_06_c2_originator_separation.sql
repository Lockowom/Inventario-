-- CUT2-06G: source-cut provenance never relaxes originator separation.
-- A C2 operator may not claim or receive queue availability for evidence it
-- created in C1, irrespective of the rolling-cut linkage.
do $migration$
declare
  v_proc regprocedure;
  v_definition text;
  v_old text := E'and (v_round<>2 or m.source_cut_id is not null or not exists(';
  v_new text := E'and (v_round<>2 or not exists(';
begin
  foreach v_proc in array array[
    'public.claim_next_recount_mission(uuid)'::regprocedure,
    'public.get_my_recount_queue(uuid)'::regprocedure
  ] loop
    select pg_get_functiondef(v_proc) into v_definition;
    if position(v_old in v_definition)=0 then
      raise exception 'CUT2-06 originator-separation anchor changed for %',v_proc using errcode='P0001';
    end if;
    execute replace(v_definition,v_old,v_new);
  end loop;
end
$migration$;
