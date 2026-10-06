-- LIVE-03: publish only monitor source tables. Realtime still evaluates their
-- existing RLS policies; clients receive a change hint and immediately reload
-- the protected RPC read models rather than trusting event payloads.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'count_records',
    'reconciliation_cases',
    'inventory_system_reference_items',
    'inventory_freeze_guards',
    'inventories'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;
