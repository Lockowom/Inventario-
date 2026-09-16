-- Desarrollo local solamente. No contiene credenciales utilizables ni datos productivos.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (
  '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
  'admin.inven3.dev@example.invalid', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
) on conflict (id) do nothing;

insert into public.profiles (user_id, display_name, role)
values ('10000000-0000-0000-0000-000000000001', 'Administrador de desarrollo', 'ADMIN')
on conflict (user_id) do nothing;

insert into public.inventories (id, name, created_by)
values ('20000000-0000-0000-0000-000000000001', 'INVENTARIO_DESARROLLO_FICTICIO', '10000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.inventory_master_items (inventory_id, codigo, descripcion, control_type, source, created_by)
values
  ('20000000-0000-0000-0000-000000000001', '00001', 'SKU FICTICIO LEGACY', 'LEGACY', 'SEED_DESARROLLO', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001', '00725P', 'SKU FICTICIO PARTIDA', 'PARTIDA', 'SEED_DESARROLLO', '10000000-0000-0000-0000-000000000001')
on conflict (inventory_id, codigo) do nothing;
