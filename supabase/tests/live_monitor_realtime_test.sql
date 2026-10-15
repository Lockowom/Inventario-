begin;
select plan(7);

select ok(exists(
  select 1 from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'count_records'
), 'count evidence is published as an invalidation source');
select ok(exists(
  select 1 from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'recount_missions'
), 'C2/C3 mission state is published as an invalidation source');
select ok(exists(
  select 1 from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'recount_mission_observations'
), 'C2/C3 observation linkage is published as an invalidation source');
select ok(exists(
  select 1 from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reconciliation_cases'
), 'C2/C3 case changes are published as an invalidation source');
select ok(exists(
  select 1 from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inventory_system_reference_items'
), 'Softland reference changes are published as an invalidation source');
select ok(exists(
  select 1 from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inventory_freeze_guards'
), 'known pending-sync changes are published as an invalidation source');
select ok(exists(
  select 1 from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inventories'
), 'C1 lifecycle changes are published as an invalidation source');

select * from finish();
rollback;
