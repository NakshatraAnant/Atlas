-- 013: Commodity research (docs/commodity/COMMODITY_DATA.md). Three categories are kept apart and never
-- blended: global benchmark prices, Indian exchange-traded futures, and physical/fundamental statistics.
-- Every observation comes from a named source series; missing provider values stay missing (no row).

CREATE SCHEMA IF NOT EXISTS commodity;

CREATE TABLE commodity.series (
  series_id text PRIMARY KEY CHECK (series_id ~ '^[a-z]+:[A-Za-z0-9_.-]{2,40}$'),
  category text NOT NULL CHECK (category IN ('global_benchmark', 'indian_futures', 'physical_fundamental')),
  commodity text NOT NULL CHECK (commodity ~ '^[a-z_]{2,40}$'),
  name text NOT NULL,
  -- What the number is: a spot assessment, a futures settlement for a contract position, a price index, a stock level.
  price_type text NOT NULL CHECK (price_type IN ('spot', 'futures_settlement', 'average_price', 'index', 'inventory')),
  unit text NOT NULL,
  currency text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  frequency text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  source_id text NOT NULL CHECK (source_id IN ('fred', 'eia')),
  source_series text NOT NULL,
  upstream text NOT NULL,
  -- For futures by contract position (EIA "contract 1..4"): the position, 1 = nearest.
  contract_position smallint CHECK (contract_position BETWEEN 1 AND 12),
  licence_note text NOT NULL,
  classification text NOT NULL DEFAULT 'REAL_UNVERIFIED' CHECK (classification IN ('REAL_VERIFIED', 'REAL_UNVERIFIED')),
  first_date date,
  last_date date,
  observations integer NOT NULL DEFAULT 0,
  last_import_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  enabled boolean NOT NULL DEFAULT true,
  UNIQUE (source_id, source_series)
);

CREATE TABLE commodity.import_jobs (
  job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id text NOT NULL REFERENCES commodity.series(series_id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  received integer NOT NULL DEFAULT 0,
  stored integer NOT NULL DEFAULT 0,
  unchanged integer NOT NULL DEFAULT 0,
  corrected integer NOT NULL DEFAULT 0,
  missing_values integer NOT NULL DEFAULT 0,
  rejected integer NOT NULL DEFAULT 0,
  error text,
  error_category text
);
CREATE INDEX commodity_jobs_time ON commodity.import_jobs(started_at DESC);

CREATE TABLE commodity.observations (
  series_id text NOT NULL REFERENCES commodity.series(series_id) ON DELETE CASCADE,
  obs_date date NOT NULL,
  value numeric(24,8) NOT NULL,
  job_id uuid REFERENCES commodity.import_jobs(job_id),
  imported_at timestamptz NOT NULL DEFAULT now(),
  revised_at timestamptz,
  PRIMARY KEY (series_id, obs_date)
);

CREATE TABLE commodity.revisions (
  series_id text NOT NULL,
  obs_date date NOT NULL,
  previous numeric(24,8) NOT NULL,
  job_id uuid REFERENCES commodity.import_jobs(job_id),
  revised_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commodity_revisions_series ON commodity.revisions(series_id, obs_date);

CREATE TABLE commodity.quarantine (
  quarantine_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid REFERENCES commodity.import_jobs(job_id),
  record jsonb NOT NULL,
  reasons text[] NOT NULL CHECK (cardinality(reasons) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT n.nspname AS s, c.relname AS r FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p') AND n.nspname = 'commodity'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.s, t.r);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA commodity FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA commodity FROM anon, authenticated';
  END IF;
END $$;
