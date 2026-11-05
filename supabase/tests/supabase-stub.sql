-- =============================================================================
-- supabase-stub.sql — TEST ONLY. Never run this on a real Supabase project.
--
-- Recreates the parts of a Supabase database that 0001_init.sql relies on, so
-- the migration and its row-level security can be tested on a plain local
-- Postgres (PGlite): the anon / authenticated / service_role roles, the
-- auth.users table, and auth.uid() / auth.jwt() which read the caller's JWT
-- claims exactly the way Supabase does (from request.jwt.claims).
-- =============================================================================
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id    uuid primary key,
  email text,
  phone text
);

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;

-- Supabase's default privileges: anything created in public is fully granted
-- to the API roles, and row-level security is what actually restricts access.
-- Reproducing this makes the tests check the migration's own revokes.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
