begin;
select plan(13);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('12000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'f12-admin@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('12000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'f12-counter@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('12000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'f12-outsider@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
insert into public.profiles (user_id, display_name, role, active) values
  ('12000000-0000-0000-0000-000000000001', 'F12 Admin', 'ADMIN', true),
  ('12000000-0000-0000-0000-000000000003', 'F12 Outsider', 'CONTADOR', true);
insert into public.inventories (id, name, created_by) values
  ('12000000-0000-0000-0000-000000000010', 'F12 Inventario', '12000000-0000-0000-0000-000000000001');
-- Isolate the last-admin invariant from the development seed's administrator.
update public.profiles set active = false where role = 'ADMIN' and user_id <> '12000000-0000-0000-0000-000000000001';

select ok(to_regprocedure('public.admin_upsert_user_profile(uuid,text,public.app_role,boolean,uuid[],public.user_management_event_type)') is not null, 'admin profile procedure exists');
select ok(to_regprocedure('public.admin_record_user_password_reset(uuid)') is not null, 'password reset audit procedure exists');
select ok(not has_function_privilege('anon', 'public.admin_upsert_user_profile(uuid,text,public.app_role,boolean,uuid[],public.user_management_event_type)', 'EXECUTE'), 'anon cannot execute profile procedure');
select ok(not has_table_privilege('anon', 'public.user_management_events', 'SELECT'), 'anon cannot read user audit');

select set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000003', true); set local role authenticated;
select throws_ok(
  $$select public.admin_upsert_user_profile('12000000-0000-0000-0000-000000000002', 'Counter', 'CONTADOR', true, array['12000000-0000-0000-0000-000000000010']::uuid[], 'USER_CREATED')$$,
  '42501', 'Administrator authorization is required', 'non-admin cannot provision a profile');
select is((select count(*) from public.user_management_events), 0::bigint, 'non-admin cannot read user audit events');

select set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000001', true); set local role authenticated;
select is((select role from public.admin_upsert_user_profile('12000000-0000-0000-0000-000000000002', 'F12 Counter', 'CONTADOR', true, array['12000000-0000-0000-0000-000000000010']::uuid[], 'USER_CREATED')), 'CONTADOR'::public.app_role, 'admin can provision a profile');
select is((select count(*) from public.inventory_assignments where user_id = '12000000-0000-0000-0000-000000000002' and active), 1::bigint, 'admin profile procedure maintains active assignments');
select is((select event_type from public.user_management_events where target_user_id = '12000000-0000-0000-0000-000000000002'), 'USER_CREATED'::public.user_management_event_type, 'creation receives a dedicated audit event');
select ok(not exists (select 1 from public.user_management_events where payload ? 'password' or payload ? 'email' or payload ? 'token'), 'user audit never stores credential material');
select lives_ok($$select public.admin_record_user_password_reset('12000000-0000-0000-0000-000000000002')$$, 'password reset is auditable without a password argument');
select is((select count(*) from public.user_management_events where target_user_id = '12000000-0000-0000-0000-000000000002' and event_type = 'USER_PASSWORD_RESET'), 1::bigint, 'password reset produces one audit event');
select throws_ok(
  $$select public.admin_upsert_user_profile('12000000-0000-0000-0000-000000000001', 'F12 Admin', 'CONTADOR', false, '{}'::uuid[], 'USER_UPDATED')$$,
  '23514', 'At least one active administrator is required', 'the final active administrator cannot be deactivated or downgraded');

select * from finish();
rollback;
