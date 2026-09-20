-- Phase 7 server-side transitions are callable only by the Edge Function's
-- database role. service_role bypasses RLS, not SQL object privileges.
revoke all on function public.get_cut_export_source(uuid) from public, anon, authenticated;
revoke all on function public.record_cut_file_generated(uuid, uuid, text, text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.recover_cut_file_generated(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mark_cut_file_error(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.mark_cut_file_validated(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finalize_cut_file(uuid, uuid) from public, anon, authenticated;

grant execute on function public.get_cut_export_source(uuid) to service_role;
grant execute on function public.record_cut_file_generated(uuid, uuid, text, text, text, bigint, text) to service_role;
grant execute on function public.recover_cut_file_generated(uuid, uuid) to service_role;
grant execute on function public.mark_cut_file_error(uuid, uuid, text) to service_role;
grant execute on function public.mark_cut_file_validated(uuid, uuid) to service_role;
grant execute on function public.finalize_cut_file(uuid, uuid) to service_role;
