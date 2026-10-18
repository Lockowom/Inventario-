-- PostgreSQL checks EXECUTE before entering a SECURITY DEFINER function used
-- inside an RLS expression.  The predicate remains in app_private (whose
-- schema is not usable by API roles) and accepts no mutable operation.
grant execute on function app_private.finding_actor_has_capability(uuid,public.cut2_capability,uuid,uuid)
  to authenticated;
