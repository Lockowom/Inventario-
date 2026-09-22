begin;
select plan(2);

select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'storage' and c.relname = 'objects'), 'Storage objects enforce RLS');
select is((select count(*)::integer from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd in ('INSERT', 'UPDATE', 'DELETE')), 0, 'Storage exposes no direct DML policy');

select * from finish();
rollback;
