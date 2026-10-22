-- Session 9: real/imported Indian equity reference data, cross-asset research objects, and research
-- activity for the learning engine.
--
-- Data classification (shown with every value):
--   REAL_VERIFIED    provider data cross-checked against a second independent source
--   REAL_UNVERIFIED  provider data from one licensed/permitted source, not cross-checked
--   USER_IMPORTED    a file the user uploaded and attested they may use
--   SYNTHETIC_DEMO   generated development data (the existing ref/market schemas); never mixed in
-- Freshness (STALE / MISSING) and QUARANTINED are states computed or stored separately: authenticity,
-- freshness and quality are different questions and are never folded into one label.

CREATE SCHEMA IF NOT EXISTS equity;

CREATE TABLE equity.providers (
  provider_id text PRIMARY KEY CHECK (provider_id ~ '^[a-z0-9_]{2,40}$'),
  name text NOT NULL,
  docs_url text NOT NULL,
  terms_url text,
  docs_checked_on date NOT NULL,
  auth text NOT NULL CHECK (auth IN ('none', 'required_key')),
  coverage_note text NOT NULL,
  limits_note text NOT NULL,
  licence_note text NOT NULL,
  priority integer NOT NULL,
  health text NOT NULL DEFAULT 'unknown' CHECK (health IN ('unknown', 'healthy', 'degraded', 'failing', 'rate_limited', 'not_configured', 'not_entitled')),
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  last_error_category text CHECK (last_error_category IN ('network', 'timeout', 'auth', 'entitlement', 'rate_limited', 'malformed', 'provider_error', 'not_found')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE equity.instruments (
  instrument_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('equity', 'index')),
  exchange text NOT NULL CHECK (exchange IN ('NSE', 'BSE', 'INDEX')),
  symbol text NOT NULL CHECK (symbol ~ '^[A-Z0-9&_.-]{1,30}$'),
  name text,
  isin text CHECK (isin IS NULL OR isin ~ '^IN[A-Z0-9]{9}[0-9]$'),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exchange, symbol)
);

-- Provider-specific identifiers, validated by a successful provider response for that identifier.
CREATE TABLE equity.provider_symbols (
  provider_id text NOT NULL REFERENCES equity.providers(provider_id),
  provider_symbol text NOT NULL,
  instrument_id uuid NOT NULL REFERENCES equity.instruments(instrument_id),
  validated_at timestamptz,
  PRIMARY KEY (provider_id, provider_symbol)
);

CREATE TABLE equity.price_series (
  series_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL REFERENCES equity.instruments(instrument_id),
  provider_id text NOT NULL REFERENCES equity.providers(provider_id),
  -- USER_IMPORTED files stay private in app.user_datasets and are never copied into this shared schema.
  classification text NOT NULL CHECK (classification IN ('REAL_VERIFIED', 'REAL_UNVERIFIED')),
  -- raw: prices as traded. adjusted: provider-adjusted for splits and dividends (never adjusted twice).
  basis text NOT NULL CHECK (basis IN ('raw', 'adjusted_split_dividend')),
  first_date date,
  last_date date,
  observations integer NOT NULL DEFAULT 0,
  last_import_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instrument_id, provider_id, basis)
);

CREATE TABLE equity.import_jobs (
  job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id text REFERENCES equity.providers(provider_id),
  instrument_id uuid REFERENCES equity.instruments(instrument_id),
  requested_by uuid REFERENCES app.users(user_id),
  kind text NOT NULL CHECK (kind IN ('api', 'csv')),
  dry_run boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  received integer NOT NULL DEFAULT 0,
  stored integer NOT NULL DEFAULT 0,
  unchanged integer NOT NULL DEFAULT 0,
  corrected integer NOT NULL DEFAULT 0,
  rejected integer NOT NULL DEFAULT 0,
  error text,
  error_category text,
  detail jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX import_jobs_time ON equity.import_jobs(started_at DESC);

CREATE TABLE equity.prices (
  series_id uuid NOT NULL REFERENCES equity.price_series(series_id) ON DELETE CASCADE,
  trade_date date NOT NULL,
  open numeric(20,6) NOT NULL CHECK (open > 0),
  high numeric(20,6) NOT NULL CHECK (high > 0),
  low numeric(20,6) NOT NULL CHECK (low > 0),
  close numeric(20,6) NOT NULL CHECK (close > 0),
  volume numeric(24,0) CHECK (volume >= 0),
  validation text NOT NULL DEFAULT 'valid' CHECK (validation IN ('valid', 'suspect')),
  job_id uuid REFERENCES equity.import_jobs(job_id),
  imported_at timestamptz NOT NULL DEFAULT now(),
  revised_at timestamptz,
  PRIMARY KEY (series_id, trade_date),
  CHECK (low <= high AND low <= open AND open <= high AND low <= close AND close <= high)
);

-- Corrections: when a re-import changes a stored value, the previous value is kept here.
CREATE TABLE equity.price_revisions (
  series_id uuid NOT NULL,
  trade_date date NOT NULL,
  previous jsonb NOT NULL,
  job_id uuid REFERENCES equity.import_jobs(job_id),
  revised_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX price_revisions_series ON equity.price_revisions(series_id, trade_date);

CREATE TABLE equity.quarantine (
  quarantine_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid REFERENCES equity.import_jobs(job_id),
  record jsonb NOT NULL,
  reasons text[] NOT NULL CHECK (cardinality(reasons) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────── Cross-asset research objects (private to their owner) ───────────
-- Instruments are referenced by an instrument key resolved in code (modules/research/instruments.ts):
--   crypto:<canonical_key>[@<series uuid>] · equity:<EXCHANGE>:<SYMBOL>[@<series uuid>] · upload:<dataset uuid>

CREATE SCHEMA IF NOT EXISTS research;

CREATE TABLE research.portfolios (
  portfolio_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description text CHECK (length(description) <= 2000),
  benchmark_key text CHECK (length(benchmark_key) <= 200),
  rebalance text NOT NULL DEFAULT 'monthly' CHECK (rebalance IN ('none', 'monthly')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX portfolios_user ON research.portfolios(user_id) WHERE deleted_at IS NULL;

CREATE TABLE research.portfolio_holdings (
  portfolio_id uuid NOT NULL REFERENCES research.portfolios(portfolio_id) ON DELETE CASCADE,
  instrument_key text NOT NULL CHECK (length(instrument_key) BETWEEN 3 AND 200),
  weight numeric(9,6) NOT NULL CHECK (weight > 0 AND weight <= 1),
  label text CHECK (length(label) <= 80),
  note text CHECK (length(note) <= 2000),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (portfolio_id, instrument_key)
);

CREATE TABLE research.saved_views (
  view_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  kind text NOT NULL CHECK (kind IN ('workbench', 'screen', 'correlation', 'backtest', 'scenario')),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX saved_views_user ON research.saved_views(user_id, kind) WHERE deleted_at IS NULL;

-- Notebook: notes, hypotheses (thesis before outcome) and journal reflections in one structured record.
CREATE TABLE research.notebook_entries (
  entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  kind text NOT NULL CHECK (kind IN ('note', 'hypothesis', 'journal')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 20000),
  instruments text[] NOT NULL DEFAULT '{}',
  sources jsonb NOT NULL DEFAULT '[]',
  chart_configs jsonb NOT NULL DEFAULT '[]',
  assumptions text CHECK (length(assumptions) <= 5000),
  counterarguments text CHECK (length(counterarguments) <= 5000),
  -- Hypothesis fields (kind = 'hypothesis'): recorded before the outcome, reviewed later.
  thesis text CHECK (length(thesis) <= 5000),
  evidence_for text CHECK (length(evidence_for) <= 5000),
  evidence_against text CHECK (length(evidence_against) <= 5000),
  horizon_days integer CHECK (horizon_days BETWEEN 1 AND 3650),
  benchmark_key text,
  review_date date,
  outcome text CHECK (length(outcome) <= 5000),
  lessons text CHECK (length(lessons) <= 5000),
  reviewed_at timestamptz,
  -- Journal fields (kind = 'journal')
  expected text CHECK (length(expected) <= 5000),
  observed text CHECK (length(observed) <= 5000),
  missed text CHECK (length(missed) <= 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (kind <> 'hypothesis' OR (thesis IS NOT NULL AND review_date IS NOT NULL))
);
CREATE INDEX notebook_user ON research.notebook_entries(user_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE research.reports (
  report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  question text NOT NULL CHECK (length(question) BETWEEN 1 AND 2000),
  params jsonb NOT NULL,
  content jsonb NOT NULL,
  generator_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX reports_user ON research.reports(user_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE research.alert_rules (
  rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  instrument_key text,
  source_id text,
  kind text NOT NULL CHECK (kind IN ('price_above', 'price_below', 'change_24h_abs_pct', 'volatility_30d_above', 'drawdown_below', 'data_stale', 'source_unhealthy')),
  threshold numeric,
  cooldown_minutes integer NOT NULL DEFAULT 360 CHECK (cooldown_minutes BETWEEN 5 AND 10080),
  enabled boolean NOT NULL DEFAULT true,
  last_evaluated_at timestamptz,
  last_triggered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK ((kind = 'source_unhealthy') = (source_id IS NOT NULL)),
  CHECK (kind = 'source_unhealthy' OR instrument_key IS NOT NULL),
  CHECK (kind IN ('data_stale', 'source_unhealthy') OR threshold IS NOT NULL)
);
CREATE INDEX alert_rules_enabled ON research.alert_rules(enabled) WHERE deleted_at IS NULL;

CREATE TABLE research.alert_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES research.alert_rules(rule_id),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  dedupe_key text NOT NULL,
  observed_value numeric,
  observed_at timestamptz,
  triggered_at timestamptz NOT NULL,
  message text NOT NULL,
  notification_id uuid REFERENCES app.notifications(notification_id),
  status text NOT NULL CHECK (status IN ('notified', 'failed')),
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX alert_events_user ON research.alert_events(user_id, triggered_at DESC);

-- Authoritative research activity, written only by server code that performed (and validated) the work.
-- One row per (user, kind, ref): the source for research XP, achievements and retention measures.
CREATE TABLE research.activity (
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  kind text NOT NULL CHECK (kind IN ('note_written', 'hypothesis_recorded', 'hypothesis_reviewed', 'journal_reflection', 'benchmark_comparison', 'correlation_study', 'walkforward_backtest', 'report_created', 'portfolio_risk_review', 'data_issue_investigated', 'scenario_tested', 'alert_configured')),
  ref text NOT NULL CHECK (length(ref) BETWEEN 1 AND 200),
  occurred_at timestamptz NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, kind, ref)
);
CREATE INDEX research_activity_time ON research.activity(user_id, occurred_at DESC);

-- Learning ledger: research kinds join the learning kinds (XP is still derived server-side, once per ref).
ALTER TABLE acad.learning_events DROP CONSTRAINT IF EXISTS learning_events_kind_check;
ALTER TABLE acad.learning_events ADD CONSTRAINT learning_events_kind_check CHECK (kind IN (
  'lesson_completed', 'quiz_perfect', 'error_recovered', 'objective_mastered', 'review_recalled',
  'diagnostic_completed', 'game_solved', 'capstone_submitted', 'course_completed',
  'daily_mission', 'weekly_mission',
  'research_note', 'hypothesis_recorded', 'hypothesis_reviewed', 'journal_reflection', 'benchmark_comparison',
  'correlation_study', 'walkforward_backtest', 'report_created', 'portfolio_risk_review', 'data_issue_investigated', 'scenario_tested'));

-- Deny by default for any role other than the owner (same policy as migrations 004 and 010).
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
