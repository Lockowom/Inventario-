-- F9B.3: Supabase projects created with legacy default privileges can grant
-- anon access to new public objects. INVEN3 has no anonymous Data API/RPC.
-- These statements affect existing objects and future objects created by the
-- current migration executor; no internal Supabase owner is hardcoded.

revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;

-- Functions grant EXECUTE to PUBLIC by PostgreSQL default. Revoke both
-- PUBLIC and anon so inherited PUBLIC access cannot reach SECURITY DEFINER
-- entrypoints. Existing explicit authenticated/service_role grants remain.
revoke execute on all functions in schema public from public, anon;

-- app_private remains inaccessible to Data API roles.
revoke usage on schema app_private from anon, authenticated;

-- PostgreSQL default privileges are scoped to the role executing this
-- migration. The global clauses remove inherited PUBLIC function execution;
-- schema clauses also remove any public-schema default ACL entries for anon.
alter default privileges revoke all on tables from anon;
alter default privileges revoke all on sequences from anon;
alter default privileges revoke execute on functions from public, anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;
