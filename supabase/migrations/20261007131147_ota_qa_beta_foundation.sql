-- OTA-01/02: Android QA only. There is intentionally no production channel.
create table public.ota_channels (
  name text primary key check (name = 'qa-beta'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.ota_channels(name) values ('qa-beta');

create table public.ota_bundles (
  id uuid primary key default gen_random_uuid(),
  channel_name text not null references public.ota_channels(name) on delete restrict,
  version text not null check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+-qa\.[0-9]+$'),
  min_native_version text not null check (length(btrim(min_native_version)) > 0),
  release_url text not null check (release_url ~ '^https://github\.com/Lockowom/Inventario-/releases/download/'),
  sha256 text not null check (sha256 ~ '^[A-Fa-f0-9]{64}$'),
  size_bytes bigint not null check (size_bytes > 0),
  published_commit_sha text not null check (published_commit_sha ~ '^[A-Fa-f0-9]{40}$'),
  published_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text,
  unique(channel_name, version),
  unique(channel_name, sha256),
  check ((revoked_at is null and revoked_reason is null) or (revoked_at is not null and length(btrim(revoked_reason)) >= 10))
);

create table public.ota_devices (
  device_id text primary key check (length(btrim(device_id)) between 8 and 200),
  user_id uuid not null references public.profiles(user_id) on delete restrict,
  channel_name text references public.ota_channels(name) on delete restrict,
  native_version text not null check (length(btrim(native_version)) > 0),
  current_bundle_version text,
  last_seen_at timestamptz not null default now(),
  last_check_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ota_device_events (
  id uuid primary key default gen_random_uuid(),
  device_id text not null references public.ota_devices(device_id) on delete restrict,
  bundle_id uuid references public.ota_bundles(id) on delete restrict,
  event_type text not null check (event_type in ('CHECKED', 'DOWNLOADED', 'APPLIED', 'ROLLED_BACK', 'FAILED', 'INCOMPATIBLE')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index ota_devices_channel_seen_idx on public.ota_devices(channel_name, last_seen_at desc);
create index ota_device_events_device_created_idx on public.ota_device_events(device_id, created_at desc);

create trigger ota_channels_set_updated_at before update on public.ota_channels for each row execute function public.set_updated_at();
create trigger ota_devices_set_updated_at before update on public.ota_devices for each row execute function public.set_updated_at();

alter table public.ota_channels enable row level security;
alter table public.ota_bundles enable row level security;
alter table public.ota_devices enable row level security;
alter table public.ota_device_events enable row level security;

-- Device enrollment is deliberately not a client capability. An ADMIN assigns
-- qa-beta after the device first appears, and no other channel exists here.
create function public.assign_ota_device_channel(p_device_id text, p_channel_name text)
returns public.ota_devices
language plpgsql security definer
set search_path = public, app_private, pg_temp
as $$
declare v_device public.ota_devices;
begin
  perform app_private.require_active_actor();
  if not app_private.is_admin() then raise exception 'Only ADMIN can assign OTA channels' using errcode = '42501'; end if;
  if p_channel_name <> 'qa-beta' then raise exception 'Only qa-beta is available in this environment' using errcode = '23514'; end if;
  update public.ota_devices set channel_name = p_channel_name, last_error_code = null
  where device_id = btrim(p_device_id) returning * into v_device;
  if not found then raise exception 'OTA device not found' using errcode = 'P0002'; end if;
  return v_device;
end;
$$;

create function public.get_live_monitor_ota_devices(p_limit integer default 100)
returns table(device_id text, channel_name text, native_version text, current_bundle_version text, last_seen_at timestamptz, last_check_at timestamptz, last_error_code text, display_name text)
language plpgsql stable security definer
set search_path = public, app_private, pg_temp
as $$
begin
  perform app_private.require_active_actor();
  if not (app_private.is_admin() or app_private.is_analyst()) then raise exception 'OTA monitor requires ADMIN or ANALISTA' using errcode = '42501'; end if;
  if p_limit < 1 or p_limit > 200 then raise exception 'OTA monitor limit must be between 1 and 200' using errcode = '22023'; end if;
  return query
    select d.device_id, d.channel_name, d.native_version, d.current_bundle_version, d.last_seen_at, d.last_check_at, d.last_error_code, p.display_name
    from public.ota_devices d join public.profiles p on p.user_id = d.user_id
    order by d.last_seen_at desc limit p_limit;
end;
$$;

revoke all on public.ota_channels, public.ota_bundles, public.ota_devices, public.ota_device_events from anon, authenticated;
revoke all on function public.assign_ota_device_channel(text, text), public.get_live_monitor_ota_devices(integer) from public, anon;
grant execute on function public.assign_ota_device_channel(text, text), public.get_live_monitor_ota_devices(integer) to authenticated;
