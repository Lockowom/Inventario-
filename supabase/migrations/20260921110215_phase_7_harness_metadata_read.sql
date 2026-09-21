-- The local certification harness uses the server-only key to compare the
-- generated artifact with its authoritative metadata. Client roles remain
-- unable to read either protected table directly.
grant select on public.generated_files, public.inventory_cuts to service_role;
