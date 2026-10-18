-- Authorization is evaluated at call time.  These projections call active
-- actor/capability helpers, therefore PostgreSQL must not cache them STABLE.
alter function public.get_reference_finding_detail(uuid) volatile;
alter function public.get_my_reference_finding_actions(uuid) volatile;
alter function public.list_reference_finding_assignees(uuid) volatile;
