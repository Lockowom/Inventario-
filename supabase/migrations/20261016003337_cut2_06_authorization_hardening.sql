-- CUT2-06A: extend the existing capability enum only.  Values are committed in
-- their own migration because PostgreSQL does not permit using a newly added
-- enum value until the transaction that added it has committed.
alter type public.cut2_capability add value if not exists 'ROLLING_CUT_PREVIEW';
alter type public.cut2_capability add value if not exists 'ROLLING_CUT_CREATE';
alter type public.cut2_capability add value if not exists 'FINDING_REPORT';
alter type public.cut2_capability add value if not exists 'FINDING_RESOLVE';
alter type public.cut2_capability add value if not exists 'REASSIGN_C2';
alter type public.cut2_capability add value if not exists 'VIEW_MONITOR';
alter type public.cut2_capability add value if not exists 'MANAGE_INVENTORY';
alter type public.cut2_capability add value if not exists 'MANAGE_USERS';
alter type public.cut2_capability add value if not exists 'MANAGE_ASSIGNMENTS';
alter type public.cut2_capability add value if not exists 'RP_RELEASE';
alter type public.cut2_capability add value if not exists 'RECTIFY_SEALED_REFERENCE';
alter type public.cut2_capability add value if not exists 'ADMINISTER_SYSTEM';
