-- Supabase security-advisor fixes (ADR-012).
-- 1. Pin the search_path of SECURITY-relevant trigger functions (lint 0011).
ALTER FUNCTION ops.audit_log_immutable() SET search_path = '';

-- 2. Keep extensions out of the public schema where the platform provides an `extensions`
--    schema on the default search_path (Supabase; lint 0014). Indexes reference operator
--    classes by OID, so moving the extension does not touch existing indexes. Local PGlite has
--    no such schema and keeps pg_trgm where it is.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions')
     AND EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm' AND n.nspname = 'public') THEN
    ALTER EXTENSION pg_trgm SET SCHEMA extensions;
  END IF;
END $$;
