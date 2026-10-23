-- 014: Durable provider state for every external data provider (docs/ATLAS_PROVIDER_QUOTA_AND_RECOVERY.md),
-- a shared request log, US/India macro series from the official FRED API, observation vintages for
-- commodity series, and Indian agricultural market (mandi) prices from data.gov.in.

CREATE TABLE ops.provider_state (
  provider_id text PRIMARY KEY CHECK (provider_id ~ '^[a-z0-9_]{2,40}$'),
  configured boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'operational', 'degraded', 'rate_limited', 'quota_exhausted', 'unavailable', 'unconfigured', 'recovering')),
  -- Documented account limits (as verified, with the date) and what the provider itself reports.
  plan_note text,
  provider_reported jsonb,
  usage_confidence text NOT NULL DEFAULT 'estimated' CHECK (usage_confidence IN ('provider_reported', 'estimated', 'unknown')),
  -- Only set when it can be established; never guessed.
  remaining integer,
  reset_at timestamptz,
  reset_rule text,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_failure_category text,
  last_failure_message text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  -- While set and in the future, ordinary requests to this provider are not sent.
  next_eligible_at timestamptz,
  paused_reason text,
  skipped_while_paused integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ops.provider_requests (
  request_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  endpoint text NOT NULL CHECK (char_length(endpoint) <= 60),
  job text,
  http_status integer,
  outcome text NOT NULL CHECK (outcome IN ('ok', 'error', 'cached', 'skipped_paused', 'skipped_budget')),
  failure_category text,
  retry integer NOT NULL DEFAULT 0,
  cost integer NOT NULL DEFAULT 1 CHECK (cost >= 0),
  quota_event boolean NOT NULL DEFAULT false
);
CREATE INDEX provider_requests_time ON ops.provider_requests(provider_id, requested_at DESC);

-- ─────────── Macro series (FRED API) ───────────
CREATE SCHEMA IF NOT EXISTS macro;

CREATE TABLE macro.series (
  series_id text PRIMARY KEY CHECK (series_id ~ '^[A-Z0-9_]{2,40}$'),
  category text NOT NULL CHECK (category IN ('inflation', 'rates', 'labour', 'activity', 'credit', 'fx', 'india')),
  title text NOT NULL,
  units text,
  frequency text,
  seasonal_adjustment text,
  -- FRED metadata: when the series was last updated by its source, and the observation range.
  source_last_updated timestamptz,
  observation_start date,
  observation_end date,
  notes text,
  first_date date,
  last_date date,
  observations integer NOT NULL DEFAULT 0,
  last_import_at timestamptz,
  last_error text,
  enabled boolean NOT NULL DEFAULT true
);

CREATE TABLE macro.observations (
  series_id text NOT NULL REFERENCES macro.series(series_id) ON DELETE CASCADE,
  obs_date date NOT NULL,
  value numeric(24,8) NOT NULL,
  -- FRED vintage: the first date this value was valid in FRED's real-time database (a publication date proxy).
  published_at date,
  retrieved_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (series_id, obs_date)
);

CREATE TABLE macro.revisions (
  series_id text NOT NULL,
  obs_date date NOT NULL,
  previous numeric(24,8) NOT NULL,
  previous_published_at date,
  revised_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX macro_revisions_series ON macro.revisions(series_id, obs_date);

-- Commodity observation vintages (FRED API realtime_start) and retrieval times.
ALTER TABLE commodity.observations ADD COLUMN published_at date;

-- ─────────── Indian agricultural market prices (data.gov.in, Agmarknet) ───────────
CREATE TABLE commodity.mandi_prices (
  arrival_date date NOT NULL,
  state text NOT NULL,
  district text NOT NULL,
  market text NOT NULL,
  commodity text NOT NULL,
  variety text NOT NULL DEFAULT '',
  grade text NOT NULL DEFAULT '',
  -- Rupees per quintal (100 kg), as published by Agmarknet.
  min_price numeric(14,2),
  max_price numeric(14,2),
  modal_price numeric(14,2) NOT NULL,
  retrieved_at timestamptz NOT NULL,
  PRIMARY KEY (arrival_date, state, district, market, commodity, variety, grade)
);
CREATE INDEX mandi_commodity_date ON commodity.mandi_prices(commodity, arrival_date DESC);

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT n.nspname AS s, c.relname AS r FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p') AND n.nspname IN ('macro', 'commodity', 'ops')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.s, t.r);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA macro FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA commodity FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA ops FROM anon, authenticated';
  END IF;
END $$;
