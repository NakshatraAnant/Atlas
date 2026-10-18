-- Schema fingerprint: one hash over every ATLAS column, constraint, index and RLS flag.
-- Run against local PGlite and hosted Supabase; equal hashes mean identical schemas.
WITH s(name) AS (VALUES ('ref'),('market'),('fund'),('disc'),('calc'),('bt'),('ai'),('app'),('ops'),('acad')),
cols AS (
  SELECT format('col %s.%s.%s %s %s %s', c.table_schema, c.table_name, c.column_name, c.data_type, c.is_nullable, coalesce(c.column_default, '')) AS line
  FROM information_schema.columns c JOIN s ON s.name = c.table_schema
),
cons AS (
  SELECT format('con %s.%s %s', n.nspname, cl.relname, pg_get_constraintdef(k.oid)) AS line
  FROM pg_constraint k JOIN pg_class cl ON cl.oid = k.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace JOIN s ON s.name = n.nspname
),
idx AS (
  SELECT format('idx %s', regexp_replace(pg_get_indexdef(i.indexrelid), ' USING btree', '')) AS line
  FROM pg_index i JOIN pg_class cl ON cl.oid = i.indexrelid JOIN pg_namespace n ON n.oid = cl.relnamespace JOIN s ON s.name = n.nspname
),
rls AS (
  SELECT format('rls %s.%s %s', n.nspname, cl.relname, cl.relrowsecurity) AS line
  FROM pg_class cl JOIN pg_namespace n ON n.oid = cl.relnamespace JOIN s ON s.name = n.nspname WHERE cl.relkind IN ('r', 'p')
),
allx AS (SELECT line FROM cols UNION ALL SELECT line FROM cons UNION ALL SELECT line FROM idx UNION ALL SELECT line FROM rls)
SELECT count(*)::int AS lines, md5(string_agg(line, E'\n' ORDER BY line)) AS fingerprint FROM allx;
