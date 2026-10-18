-- Defence in depth for hosted Supabase (ADR-012).
-- The browser never talks to the database: every request goes through the ATLAS API, which
-- enforces authorisation server-side and connects as the table owner. This migration makes
-- the database itself deny-by-default for any other path (Supabase REST/GraphQL, anon keys):
--   1. Row-level security is enabled on every ATLAS table with no permissive policy, so any
--      non-owner role sees zero rows.
--   2. The Supabase client roles (anon, authenticated), when present, lose all privileges on
--      ATLAS schemas, including on objects created later.
-- On PGlite (local dev/tests) the client roles do not exist and the owner bypasses RLS, so
-- behaviour is unchanged.

DO $$
DECLARE
  t record;
  s text;
  schemas text[] := ARRAY['ref', 'market', 'fund', 'disc', 'calc', 'bt', 'ai', 'app', 'ops'];
BEGIN
  FOR t IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p') AND n.nspname = ANY (schemas)
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.schema_name, t.table_name);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    FOREACH s IN ARRAY schemas LOOP
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM anon, authenticated', s);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM anon, authenticated', s);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM anon, authenticated', s);
      EXECUTE format('REVOKE USAGE ON SCHEMA %I FROM anon, authenticated', s);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON TABLES FROM anon, authenticated', s);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM anon, authenticated', s);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON FUNCTIONS FROM anon, authenticated', s);
    END LOOP;
  END IF;
END $$;
