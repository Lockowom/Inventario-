-- OTA versioning is intentionally dual: an immutable Android shell and an
-- independently advancing Web bundle. QA remains the only channel.
alter table public.ota_bundles
  drop constraint if exists ota_bundles_version_check,
  add constraint ota_bundles_version_check check (version ~ '^[0-9]+\.[0-9]+\.[0-9]{2}\.[0-9]{2}(-qa\.[0-9]+)?$'),
  add column if not exists min_native_version_code integer not null default 1 check (min_native_version_code > 0),
  add column if not exists entrypoint text not null default 'index.html' check (entrypoint = 'index.html');

alter table public.ota_devices
  add column if not exists platform text not null default 'ANDROID' check (platform = 'ANDROID'),
  add column if not exists app_version text,
  add column if not exists native_version_code integer check (native_version_code is null or native_version_code > 0),
  add column if not exists ota_status text not null default 'CHECKED' check (ota_status in ('CHECKED','DOWNLOADED','APPLIED','ROLLED_BACK','FAILED','INCOMPATIBLE'));

drop function if exists public.get_live_monitor_ota_devices(integer);
create function public.get_live_monitor_ota_devices(p_limit integer default 100)
returns table(
  device_id text, display_name text, platform text, app_version text,
  native_version text, native_version_code integer, current_bundle_version text,
  channel_name text, ota_status text, last_seen_at timestamptz, last_check_at timestamptz,
  last_error_code text
)
language plpgsql stable security definer
set search_path = public, app_private, pg_temp
as $$
begin
  perform app_private.require_active_actor();
  if not (app_private.is_admin() or app_private.is_analyst()) then
    raise exception 'OTA monitor requires ADMIN or ANALISTA' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 200 then
    raise exception 'OTA monitor limit must be between 1 and 200' using errcode = '22023';
  end if;
  return query
    select d.device_id, p.display_name, d.platform, d.app_version,
      d.native_version, d.native_version_code, d.current_bundle_version,
      d.channel_name, d.ota_status, d.last_seen_at, d.last_check_at, d.last_error_code
    from public.ota_devices d
    join public.profiles p on p.user_id = d.user_id
    order by d.last_seen_at desc
    limit p_limit;
end;
$$;

revoke all on function public.get_live_monitor_ota_devices(integer) from public, anon;
grant execute on function public.get_live_monitor_ota_devices(integer) to authenticated;
