-- OTA-09: INVEN3-QA has one trusted server-selected channel. Existing
-- pre-base registrations are brought into that channel without granting a
-- client any direct table or RPC capability to choose it.
update public.ota_devices
set channel_name = 'qa-beta', last_error_code = null
where channel_name is null;
