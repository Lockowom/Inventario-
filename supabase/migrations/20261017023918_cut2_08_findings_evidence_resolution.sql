-- CUT2-08 catalog migration. PostgreSQL requires these enum values to commit
-- before a subsequent migration can use them in policies or functions.
alter type public.cut2_capability add value if not exists 'FINDING_ASSIGN';
alter type public.cut2_finding_type add value if not exists 'PHYSICAL_DAMAGE';
alter type public.cut2_finding_type add value if not exists 'LABEL_MISMATCH';
alter type public.cut2_finding_type add value if not exists 'LOCATION_MISMATCH';
alter type public.cut2_finding_type add value if not exists 'SERIAL_ILLEGIBLE';
alter type public.cut2_finding_type add value if not exists 'BATCH_ILLEGIBLE';
alter type public.cut2_finding_type add value if not exists 'AUTHORIZATION_REVOKED_OFFLINE';

do $$ begin
  create type public.cut2_finding_severity as enum ('INFO','LOW','MEDIUM','HIGH','CRITICAL');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.cut2_finding_source_stage as enum ('C1','PRE_SEAL','ROLLING_CUT','POST_SEAL','OFFLINE_LATE_COUNT','C2','C3','SYSTEM','MANUAL_REVIEW');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.cut2_finding_resolution_code as enum (
    'CONFIRMED_PHYSICAL','SYSTEM_ERROR','DATA_ENTRY_ERROR','FOUND_IN_OTHER_LOCATION',
    'FOUND_IN_OTHER_BATCH','FOUND_SERIAL','ADJUSTMENT_REQUIRED','NO_ADJUSTMENT_REQUIRED',
    'DUPLICATE_RECORD','FALSE_POSITIVE','ESCALATED','RECTIFICATION_REQUIRED'
  );
exception when duplicate_object then null; end $$;
