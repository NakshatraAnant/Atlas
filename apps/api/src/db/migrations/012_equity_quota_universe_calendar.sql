-- 012: Indian equity data operations on a free provider plan (docs/equity/INDIAN_EQUITY_DATA_RUNBOOK.md).
-- A persistent daily quota ledger (budgets by purpose, a reserve, provider-reported usage), a request log,
-- a prioritised instrument universe, symbol-mapping verification with effective dates, an exchange
-- calendar whose every entry names its source, provider corporate actions, refresh-run records and
-- private user-imported financial statements. Nothing here is generated: every row comes from a provider
-- response, an observation in stored data, or the user.

ALTER TABLE equity.providers DROP CONSTRAINT IF EXISTS providers_health_check;
ALTER TABLE equity.providers ADD CONSTRAINT providers_health_check CHECK (health IN ('unknown', 'healthy', 'degraded', 'failing', 'rate_limited', 'quota_exhausted', 'not_configured', 'not_entitled'));
ALTER TABLE equity.providers DROP CONSTRAINT IF EXISTS providers_last_error_category_check;
ALTER TABLE equity.providers ADD CONSTRAINT providers_last_error_category_check CHECK (last_error_category IN ('network', 'timeout', 'auth', 'entitlement', 'rate_limited', 'quota_exhausted', 'malformed', 'provider_error', 'not_found'));

-- One row per provider per quota day (the provider's own reset day: UTC for EODHD). Spending is a single
-- conditional UPDATE, so two concurrent jobs can never overspend a budget.
CREATE TABLE equity.quota_days (
  provider_id text NOT NULL REFERENCES equity.providers(provider_id),
  usage_date date NOT NULL,
  refresh integer NOT NULL DEFAULT 0 CHECK (refresh >= 0),
  backfill integer NOT NULL DEFAULT 0 CHECK (backfill >= 0),
  validation integer NOT NULL DEFAULT 0 CHECK (validation >= 0),
  manual integer NOT NULL DEFAULT 0 CHECK (manual >= 0),
  reserve integer NOT NULL DEFAULT 0 CHECK (reserve >= 0),
  -- Usage the provider itself reports for this day (EODHD /api/user, which costs no calls).
  provider_reported integer CHECK (provider_reported >= 0),
  provider_reported_at timestamptz,
  -- ATLAS's own count when that report arrived: calls made after it are added to the provider's figure.
  local_at_report integer CHECK (local_at_report >= 0),
  provider_daily_limit integer,
  -- Set when the provider says the daily allowance is spent (EODHD HTTP 402): no further calls that day.
  exhausted_at timestamptz,
  exhausted_reason text,
  PRIMARY KEY (provider_id, usage_date)
);

-- Every provider request ATLAS makes (or decides not to make). The URL and key are never stored.
CREATE TABLE equity.provider_requests (
  request_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id text NOT NULL REFERENCES equity.providers(provider_id),
  usage_date date NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  category text NOT NULL CHECK (category IN ('refresh', 'backfill', 'validation', 'manual', 'reserve', 'usage_check')),
  endpoint text NOT NULL CHECK (endpoint ~ '^[a-z_]{2,40}$'),
  target text,
  cost integer NOT NULL CHECK (cost >= 0),
  outcome text NOT NULL CHECK (outcome IN ('ok', 'error', 'not_sent_budget', 'not_sent_circuit_open')),
  http_status integer,
  error_category text,
  job_id uuid REFERENCES equity.import_jobs(job_id)
);
CREATE INDEX provider_requests_day ON equity.provider_requests(provider_id, usage_date, requested_at DESC);

-- Symbol mapping: verification state and the dates a mapping applies to (symbols change after renames).
ALTER TABLE equity.provider_symbols ADD COLUMN verification text NOT NULL DEFAULT 'unverified' CHECK (verification IN ('unverified', 'verified', 'failed'));
ALTER TABLE equity.provider_symbols ADD COLUMN effective_from date;
ALTER TABLE equity.provider_symbols ADD COLUMN effective_to date;
ALTER TABLE equity.provider_symbols ADD COLUMN last_checked_at timestamptz;
ALTER TABLE equity.provider_symbols ADD COLUMN last_check_error text;
ALTER TABLE equity.provider_symbols ADD CONSTRAINT provider_symbols_effective CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from);
UPDATE equity.provider_symbols SET verification = 'verified', last_checked_at = validated_at WHERE validated_at IS NOT NULL;

-- The tracked universe: which instruments ATLAS spends its daily calls on, in priority order (1 = first).
-- Removing an instrument disables it; its stored prices are kept.
CREATE TABLE equity.universe (
  instrument_id uuid PRIMARY KEY REFERENCES equity.instruments(instrument_id),
  provider_id text NOT NULL REFERENCES equity.providers(provider_id),
  provider_symbol text NOT NULL,
  priority smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  enabled boolean NOT NULL DEFAULT true,
  note text CHECK (char_length(note) <= 300),
  added_by uuid REFERENCES app.users(user_id),
  added_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_error_category text,
  -- Earliest time the scheduler may try again after a failure (entitlement refusals wait days, not minutes).
  retry_after timestamptz
);
CREATE INDEX universe_queue ON equity.universe(enabled, priority, last_success_at NULLS FIRST);

-- Exchange calendar. Each row says where it came from; ATLAS never invents a holiday.
CREATE TABLE equity.calendar_days (
  exchange text NOT NULL CHECK (exchange IN ('NSE', 'BSE')),
  day date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('holiday', 'special_session', 'no_session_observed')),
  description text,
  source text NOT NULL CHECK (source IN ('eodhd_exchange_details', 'inferred_from_data', 'user')),
  evidence jsonb NOT NULL DEFAULT '{}',
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (exchange, day, source)
);

-- Splits and dividends as the provider reports them (used to check adjusted series, never to make prices).
CREATE TABLE equity.corporate_actions (
  instrument_id uuid NOT NULL REFERENCES equity.instruments(instrument_id),
  provider_id text NOT NULL REFERENCES equity.providers(provider_id),
  kind text NOT NULL CHECK (kind IN ('split', 'dividend')),
  ex_date date NOT NULL,
  ratio text,
  value numeric(20,6),
  currency text,
  raw jsonb NOT NULL,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instrument_id, provider_id, kind, ex_date)
);

CREATE TABLE equity.refresh_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger text NOT NULL CHECK (trigger IN ('schedule', 'manual')),
  requested_by uuid REFERENCES app.users(user_id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  expected_session date,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'skipped', 'failed')),
  attempted integer NOT NULL DEFAULT 0,
  succeeded integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  up_to_date integer NOT NULL DEFAULT 0,
  deferred_budget integer NOT NULL DEFAULT 0,
  calls_spent integer NOT NULL DEFAULT 0,
  stop_reason text,
  detail jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX refresh_runs_time ON equity.refresh_runs(started_at DESC);

-- Financial statements the user imports from documents they obtained themselves (annual reports,
-- exchange filings). Private to the user, never shared, never mixed with provider data.
CREATE TABLE research.user_fundamentals (
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  instrument text NOT NULL CHECK (instrument ~ '^(NSE|BSE):[A-Z0-9&_.-]{1,30}$'),
  period_end date NOT NULL,
  period_type text NOT NULL CHECK (period_type IN ('annual', 'quarter')),
  statement text NOT NULL CHECK (statement IN ('income', 'balance', 'cashflow')),
  line_item text NOT NULL CHECK (line_item ~ '^[a-z0-9_]{2,60}$'),
  value_inr numeric(24,2) NOT NULL,
  source_note text NOT NULL CHECK (char_length(source_note) BETWEEN 3 AND 300),
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, instrument, period_end, period_type, statement, line_item)
);

-- Deny by default, as in 011.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT n.nspname AS s, c.relname AS r FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p') AND n.nspname IN ('equity', 'research')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.s, t.r);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA equity FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA research FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA equity FROM anon, authenticated';
  END IF;
END $$;
