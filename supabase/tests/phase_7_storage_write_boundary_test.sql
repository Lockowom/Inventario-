begin;
select plan(6);

select ok(not has_table_privilege('anon', 'storage.objects', 'INSERT'), 'anon cannot insert Storage objects');
select ok(not has_table_privilege('anon', 'storage.objects', 'UPDATE'), 'anon cannot update Storage objects');
select ok(not has_table_privilege('anon', 'storage.objects', 'DELETE'), 'anon cannot delete Storage objects');
select ok(not has_table_privilege('authenticated', 'storage.objects', 'INSERT'), 'authenticated cannot insert Storage objects');
select ok(not has_table_privilege('authenticated', 'storage.objects', 'UPDATE'), 'authenticated cannot update Storage objects');
select ok(not has_table_privilege('authenticated', 'storage.objects', 'DELETE'), 'authenticated cannot delete Storage objects');

select * from finish();
rollback;
