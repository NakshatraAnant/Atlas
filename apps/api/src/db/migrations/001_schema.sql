-- ATLAS schema v1 (Technical Build Blueprint §6). Expand-only migration.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS ref;
CREATE SCHEMA IF NOT EXISTS market;
CREATE SCHEMA IF NOT EXISTS fund;
CREATE SCHEMA IF NOT EXISTS disc;
CREATE SCHEMA IF NOT EXISTS calc;
CREATE SCHEMA IF NOT EXISTS bt;
CREATE SCHEMA IF NOT EXISTS ai;
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS ops;

-- ───────────────────────────── ref: reference data and licences ─────────────────────────────
CREATE TABLE ref.licences (
  licence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  counterparty text NOT NULL,
  contract_ref text NOT NULL,
  status text NOT NULL CHECK (status IN ('dev_only', 'draft', 'under_negotiation', 'signed', 'expired', 'terminated')),
  start_date date,
  end_date date,
  review_date date,
  attribution_text text,
  permitted_use text NOT NULL,
  geographic_restrictions text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ref.licence_rights (
  right_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  licence_id uuid NOT NULL REFERENCES ref.licences(licence_id),
  dataset text NOT NULL,
  field_pattern text NOT NULL DEFAULT '*',
  can_store boolean NOT NULL DEFAULT false,
  can_display boolean NOT NULL DEFAULT false,
  can_derive boolean NOT NULL DEFAULT false,
  can_export boolean NOT NULL DEFAULT false,
  can_ai_process boolean NOT NULL DEFAULT false,
  can_public_web boolean NOT NULL DEFAULT false,
  retention_after_termination interval,
  UNIQUE (licence_id, dataset, field_pattern)
);

CREATE TABLE ref.sources (
  source_id text PRIMARY KEY,
  provider text NOT NULL,
  dataset text NOT NULL,
  licence_id uuid REFERENCES ref.licences(licence_id),
  is_synthetic boolean NOT NULL DEFAULT false,
  description text NOT NULL,
  schedule text NOT NULL,
  delay_note text NOT NULL,
  freshness_target_minutes integer NOT NULL,
  coverage_note text,
  known_limitations text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'degraded', 'disabled')),
  last_success_at timestamptz,
  last_data_date date,
  vendor_reference text
);

CREATE TABLE ref.exchanges (
  exchange_code text PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE ref.trading_calendar (
  exchange_code text NOT NULL REFERENCES ref.exchanges(exchange_code),
  trade_date date NOT NULL,
  is_trading_day boolean NOT NULL,
  note text,
  source_id text REFERENCES ref.sources(source_id),
  PRIMARY KEY (exchange_code, trade_date)
);

CREATE TABLE ref.classifications (
  scheme text NOT NULL,
  version integer NOT NULL,
  sector text NOT NULL,
  industry text NOT NULL,
  valid_from date NOT NULL,
  valid_to date,
  PRIMARY KEY (scheme, version, sector, industry)
);

CREATE TABLE ref.companies (
  company_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  short_name text NOT NULL,
  former_names text[] NOT NULL DEFAULT '{}',
  cin text,
  sector text NOT NULL,
  industry text NOT NULL,
  classification_version integer NOT NULL DEFAULT 1,
  sector_template text NOT NULL CHECK (sector_template IN ('standard', 'bank', 'nbfc', 'insurance')),
  status text NOT NULL CHECK (status IN ('listed', 'suspended', 'delisted')),
  coverage text NOT NULL CHECK (coverage IN ('full', 'not_covered')),
  description text,
  description_source_id text REFERENCES ref.sources(source_id),
  description_as_of date,
  segments_reported boolean NOT NULL DEFAULT false,
  fy_end_month integer NOT NULL DEFAULT 3 CHECK (fy_end_month BETWEEN 1 AND 12),
  is_synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX companies_name_trgm ON ref.companies USING gin (short_name gin_trgm_ops);
CREATE INDEX companies_legal_trgm ON ref.companies USING gin (legal_name gin_trgm_ops);

CREATE TABLE ref.securities (
  security_id bigserial PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES ref.companies(company_id),
  isin text NOT NULL UNIQUE,
  listed_on date NOT NULL,
  delisted_on date,
  face_value numeric(10,2) NOT NULL DEFAULT 1,
  is_synthetic boolean NOT NULL DEFAULT false
);
CREATE INDEX securities_company ON ref.securities(company_id);

CREATE TABLE ref.security_identifiers (
  security_id bigint NOT NULL REFERENCES ref.securities(security_id),
  exchange_code text NOT NULL REFERENCES ref.exchanges(exchange_code),
  symbol text NOT NULL,
  series text NOT NULL DEFAULT 'EQ',
  valid_from date NOT NULL,
  valid_to date,
  PRIMARY KEY (security_id, exchange_code, valid_from)
);
CREATE INDEX security_identifiers_symbol ON ref.security_identifiers(upper(symbol));

CREATE TABLE ref.index_definitions (
  index_code text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('price', 'total_return')),
  universe_size_class text NOT NULL CHECK (universe_size_class IN ('large', 'mid', 'small', 'broad')),
  base_date date NOT NULL,
  base_value numeric(14,4) NOT NULL,
  source_id text NOT NULL REFERENCES ref.sources(source_id),
  is_synthetic boolean NOT NULL DEFAULT false
);

CREATE TABLE ref.index_constituents (
  index_code text NOT NULL REFERENCES ref.index_definitions(index_code),
  security_id bigint NOT NULL REFERENCES ref.securities(security_id),
  effective_from date NOT NULL,
  effective_to date,
  source_id text NOT NULL REFERENCES ref.sources(source_id),
  PRIMARY KEY (index_code, security_id, effective_from)
);

-- ───────────────────────────── ops: runs, jobs, flags, audit ─────────────────────────────
CREATE TABLE ops.ingestion_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES ref.sources(source_id),
  dataset text NOT NULL,
  data_date date,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed', 'blocked')),
  file_key text,
  checksum text,
  bytes integer,
  rows_in integer NOT NULL DEFAULT 0,
  rows_valid integer NOT NULL DEFAULT 0,
  rows_quarantined integer NOT NULL DEFAULT 0,
  checks jsonb NOT NULL DEFAULT '[]',
  error text
);
CREATE UNIQUE INDEX ingestion_runs_checksum ON ops.ingestion_runs(source_id, checksum) WHERE status IN ('succeeded', 'partial');

CREATE TABLE ops.job_queue (
  job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  idempotency_key text UNIQUE,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed', 'dead')),
  priority integer NOT NULL DEFAULT 5,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  progress numeric(5,2) NOT NULL DEFAULT 0,
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX job_queue_ready ON ops.job_queue(status, run_after, priority);

CREATE TABLE ops.job_runs (
  job_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL,
  run_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  details jsonb NOT NULL DEFAULT '{}',
  error text,
  UNIQUE (job_name, run_key)
);

CREATE TABLE ops.feature_flags (
  flag_key text PRIMARY KEY,
  description text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  legal_gated boolean NOT NULL DEFAULT false,
  plan_scope text[] NOT NULL DEFAULT '{}',
  user_allowlist uuid[] NOT NULL DEFAULT '{}',
  approval jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT legal_gate_requires_approval CHECK (
    NOT (legal_gated AND enabled) OR (
      approval IS NOT NULL AND approval ? 'approver' AND approval ? 'approved_on' AND approval ? 'document_ref'
      AND length(approval->>'approver') > 0 AND length(approval->>'document_ref') > 0
    )
  )
);

CREATE TABLE ops.audit_log (
  audit_id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  actor_role text,
  action text NOT NULL,
  target_type text,
  target_id text,
  reason text,
  details jsonb NOT NULL DEFAULT '{}',
  prev_hash text NOT NULL,
  hash text NOT NULL
);
CREATE FUNCTION ops.audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ops.audit_log is append-only';
END $$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON ops.audit_log
  FOR EACH ROW EXECUTE FUNCTION ops.audit_log_immutable();

CREATE TABLE ops.ops_alerts (
  alert_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('SEV1', 'SEV2', 'SEV3', 'info')),
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid
);
CREATE UNIQUE INDEX ops_alerts_dedupe ON ops.ops_alerts(dedupe_key) WHERE acknowledged_at IS NULL AND dedupe_key IS NOT NULL;

CREATE TABLE ops.idempotency_keys (
  scope text NOT NULL,
  key text NOT NULL,
  response jsonb NOT NULL,
  status_code integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

CREATE TABLE ops.cost_ledger (
  entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  category text NOT NULL CHECK (category IN ('ai', 'infrastructure', 'data_licence', 'email', 'payment_fees')),
  amount_inr numeric(14,4) NOT NULL,
  reference text,
  details jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX cost_ledger_at ON ops.cost_ledger(category, at);

CREATE TABLE ops.budgets (
  category text PRIMARY KEY,
  monthly_limit_inr numeric(14,2) NOT NULL,
  per_unit_budget_inr numeric(14,4),
  hard_stop boolean NOT NULL DEFAULT false,
  note text
);

CREATE TABLE ops.status_incidents (
  incident_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component text NOT NULL,
  title text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('SEV1', 'SEV2', 'SEV3')),
  status text NOT NULL CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  started_at timestamptz NOT NULL DEFAULT now(),
  detected_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  resolved_at timestamptz,
  updates jsonb NOT NULL DEFAULT '[]'
);

-- ───────────────────────────── market ─────────────────────────────
CREATE TABLE market.price_eod (
  security_id bigint NOT NULL REFERENCES ref.securities(security_id),
  exchange_code text NOT NULL,
  trade_date date NOT NULL,
  open numeric(14,4) NOT NULL,
  high numeric(14,4) NOT NULL,
  low numeric(14,4) NOT NULL,
  close numeric(14,4) NOT NULL,
  prev_close numeric(14,4),
  volume bigint NOT NULL,
  trades bigint,
  delivery_qty bigint,
  traded_value numeric(20,2) NOT NULL,
  source_id text NOT NULL REFERENCES ref.sources(source_id),
  ingestion_run_id uuid NOT NULL REFERENCES ops.ingestion_runs(run_id),
  quality_status text NOT NULL CHECK (quality_status IN ('validated', 'warned', 'quarantined')),
  PRIMARY KEY (security_id, exchange_code, trade_date)
) PARTITION BY RANGE (trade_date);
DO $$
DECLARE y integer;
BEGIN
  FOR y IN 2005..2035 LOOP
    EXECUTE format('CREATE TABLE market.price_eod_%s PARTITION OF market.price_eod FOR VALUES FROM (%L) TO (%L)', y, make_date(y, 1, 1), make_date(y + 1, 1, 1));
  END LOOP;
END $$;
CREATE INDEX price_eod_date ON market.price_eod USING brin (trade_date);

CREATE TABLE market.price_quarantine (
  quarantine_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_run_id uuid NOT NULL REFERENCES ops.ingestion_runs(run_id),
  raw jsonb NOT NULL,
  failed_checks text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution text
);

CREATE TABLE market.corporate_actions (
  action_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  security_id bigint NOT NULL REFERENCES ref.securities(security_id),
  action_type text NOT NULL CHECK (action_type IN ('split', 'bonus', 'rights', 'dividend', 'merger', 'demerger', 'symbol_change', 'delisting', 'buyback')),
  announced_at timestamptz NOT NULL,
  ex_date date NOT NULL,
  record_date date,
  ratio_num numeric(18,6),
  ratio_den numeric(18,6),
  cash_amount numeric(14,4),
  subscription_price numeric(14,4),
  adj_factor numeric(18,10),
  status text NOT NULL CHECK (status IN ('provisional', 'confirmed', 'corrected')),
  version integer NOT NULL DEFAULT 1,
  source_id text NOT NULL REFERENCES ref.sources(source_id),
  ingestion_run_id uuid REFERENCES ops.ingestion_runs(run_id),
  notes text
);
CREATE INDEX corporate_actions_sec ON market.corporate_actions(security_id, ex_date);

CREATE TABLE market.adjusted_price_cache (
  security_id bigint NOT NULL,
  trade_date date NOT NULL,
  cum_factor numeric(20,12) NOT NULL,
  adj_open numeric(16,6) NOT NULL,
  adj_high numeric(16,6) NOT NULL,
  adj_low numeric(16,6) NOT NULL,
  adj_close numeric(16,6) NOT NULL,
  adj_volume numeric(20,4) NOT NULL,
  tr_close numeric(18,6) NOT NULL,
  calc_run_id uuid NOT NULL,
  PRIMARY KEY (security_id, trade_date)
);

CREATE TABLE market.index_levels (
  index_code text NOT NULL REFERENCES ref.index_definitions(index_code),
  trade_date date NOT NULL,
  close numeric(16,4) NOT NULL,
  source_id text NOT NULL REFERENCES ref.sources(source_id),
  calc_run_id uuid,
  quality_status text NOT NULL DEFAULT 'validated',
  PRIMARY KEY (index_code, trade_date)
);

-- ───────────────────────────── fund ─────────────────────────────
CREATE TABLE fund.line_item_definitions (
  code text PRIMARY KEY,
  name text NOT NULL,
  statement text NOT NULL CHECK (statement IN ('pl', 'bs', 'cf', 'bank', 'per_share', 'other')),
  unit text NOT NULL,
  flow boolean NOT NULL,
  templates text[] NOT NULL,
  display_order integer NOT NULL
);

CREATE TABLE fund.financial_periods (
  period_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES ref.companies(company_id),
  basis text NOT NULL CHECK (basis IN ('consolidated', 'standalone')),
  period_type text NOT NULL CHECK (period_type IN ('Q', 'FY')),
  fiscal_year integer NOT NULL,
  fiscal_quarter integer CHECK (fiscal_quarter BETWEEN 1 AND 4),
  period_start date NOT NULL,
  period_end date NOT NULL,
  filed_at timestamptz NOT NULL,
  audited boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  is_current boolean NOT NULL DEFAULT true,
  restatement_of uuid REFERENCES fund.financial_periods(period_id),
  source_id text NOT NULL REFERENCES ref.sources(source_id),
  ingestion_run_id uuid REFERENCES ops.ingestion_runs(run_id),
  UNIQUE (company_id, basis, period_type, fiscal_year, fiscal_quarter, version)
);
CREATE INDEX financial_periods_lookup ON fund.financial_periods(company_id, basis, period_type, period_end) WHERE is_current;

CREATE TABLE fund.financial_values (
  period_id uuid NOT NULL REFERENCES fund.financial_periods(period_id),
  line_item_code text NOT NULL REFERENCES fund.line_item_definitions(code),
  version integer NOT NULL DEFAULT 1,
  value numeric(20,4),
  missing_reason text CHECK (missing_reason IN ('not_reported', 'not_available')),
  unit text NOT NULL,
  as_reported_at timestamptz NOT NULL,
  source_id text NOT NULL REFERENCES ref.sources(source_id),
  source_ref text,
  quality_status text NOT NULL CHECK (quality_status IN ('validated', 'conflict', 'quarantined')),
  PRIMARY KEY (period_id, line_item_code, version),
  CHECK ((value IS NULL) = (missing_reason IS NOT NULL))
);

CREATE TABLE fund.shareholding_snapshots (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES ref.companies(company_id),
  quarter_end date NOT NULL,
  filed_at timestamptz NOT NULL,
  source_id text NOT NULL REFERENCES ref.sources(source_id),
  ingestion_run_id uuid REFERENCES ops.ingestion_runs(run_id),
  UNIQUE (company_id, quarter_end)
);

CREATE TABLE fund.shareholding_values (
  snapshot_id uuid NOT NULL REFERENCES fund.shareholding_snapshots(snapshot_id),
  category text NOT NULL CHECK (category IN ('promoter', 'fii', 'dii', 'public', 'government', 'other')),
  pct numeric(7,4) NOT NULL CHECK (pct >= 0 AND pct <= 100),
  pledged_pct_of_promoter numeric(7,4),
  PRIMARY KEY (snapshot_id, category)
);

CREATE TABLE fund.audit_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES ref.companies(company_id),
  kind text NOT NULL CHECK (kind IN ('auditor_change', 'qualified_opinion')),
  fiscal_year integer NOT NULL,
  detail text NOT NULL,
  filed_at timestamptz NOT NULL,
  source_id text NOT NULL REFERENCES ref.sources(source_id)
);

-- ───────────────────────────── disc ─────────────────────────────
CREATE TABLE disc.announcements (
  announcement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_ref text NOT NULL,
  company_id uuid NOT NULL REFERENCES ref.companies(company_id),
  exchange_code text NOT NULL,
  category text NOT NULL,
  subcategory text,
  subject text NOT NULL,
  body_text text,
  published_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  document_key text,
  document_url text,
  source_id text NOT NULL REFERENCES ref.sources(source_id),
  ingestion_run_id uuid REFERENCES ops.ingestion_runs(run_id),
  licence_flags jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX announcements_company ON disc.announcements(company_id, published_at DESC);

CREATE TABLE disc.insider_trades (
  trade_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES ref.companies(company_id),
  person_category text NOT NULL,
  transaction_type text NOT NULL,
  shares bigint NOT NULL,
  value_inr numeric(20,2),
  transaction_date date NOT NULL,
  disclosed_at timestamptz NOT NULL,
  source_id text NOT NULL REFERENCES ref.sources(source_id)
);

-- ───────────────────────────── calc ─────────────────────────────
CREATE TABLE calc.calc_runs (
  calc_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  code_version text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  details jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE calc.metric_definitions (
  metric_code text NOT NULL,
  version integer NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  description text NOT NULL,
  formula_expr text NOT NULL,
  unit text NOT NULL,
  inputs jsonb NOT NULL,
  edge_rules jsonb NOT NULL,
  templates text[] NOT NULL,
  screener_field boolean NOT NULL DEFAULT false,
  lesson_slug text,
  owner text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  published_at timestamptz,
  change_note text,
  PRIMARY KEY (metric_code, version)
);

CREATE TABLE calc.metric_values (
  entity_type text NOT NULL CHECK (entity_type IN ('company', 'security', 'index', 'sector', 'market')),
  entity_id text NOT NULL,
  metric_code text NOT NULL,
  period_key text NOT NULL,
  definition_version integer NOT NULL,
  basis text NOT NULL DEFAULT 'consolidated',
  value numeric(24,8),
  missing_reason text CHECK (missing_reason IN ('not_reported', 'not_available', 'not_meaningful')),
  unit text NOT NULL,
  as_of_date date NOT NULL,
  period_end date,
  available_at timestamptz NOT NULL,
  inputs_hash text NOT NULL,
  input_refs jsonb NOT NULL,
  calc_run_id uuid NOT NULL REFERENCES calc.calc_runs(calc_run_id),
  quality_status text NOT NULL CHECK (quality_status IN ('validated', 'conflict', 'stale')),
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id, metric_code, period_key, basis, definition_version),
  CHECK ((value IS NULL) = (missing_reason IS NOT NULL))
);
CREATE INDEX metric_values_lookup ON calc.metric_values(entity_id, metric_code, period_key);

CREATE TABLE calc.security_daily (
  security_id bigint NOT NULL,
  trade_date date NOT NULL,
  adj_close numeric(16,6) NOT NULL,
  ret_1d numeric(14,10),
  sma_20 numeric(16,6),
  sma_50 numeric(16,6),
  sma_200 numeric(16,6),
  rsi_14 numeric(10,6),
  vol_20d numeric(12,8),
  adv_20d numeric(20,2),
  vol_avg_20 numeric(20,2),
  high_52w numeric(16,6),
  low_52w numeric(16,6),
  market_cap_cr numeric(20,4),
  shares_outstanding numeric(20,2),
  pe_ttm numeric(14,6),
  pb numeric(14,6),
  ev_ebitda numeric(14,6),
  dividend_yield numeric(10,6),
  fundamentals_as_of timestamptz,
  calc_run_id uuid NOT NULL,
  PRIMARY KEY (security_id, trade_date)
);
CREATE INDEX security_daily_date ON calc.security_daily(trade_date);

CREATE TABLE calc.market_daily (
  universe_code text NOT NULL,
  trade_date date NOT NULL,
  traded integer NOT NULL,
  advances integer NOT NULL,
  declines integer NOT NULL,
  unchanged integer NOT NULL,
  pct_above_50dma numeric(7,4),
  pct_above_200dma numeric(7,4),
  new_highs integer NOT NULL,
  new_lows integer NOT NULL,
  turnover_cr numeric(20,4) NOT NULL,
  turnover_avg_20_cr numeric(20,4),
  realised_vol_20d numeric(12,8),
  vol_percentile_1y numeric(7,4),
  regime jsonb,
  calc_run_id uuid NOT NULL,
  PRIMARY KEY (universe_code, trade_date),
  CHECK (advances + declines + unchanged = traded)
);

CREATE TABLE calc.sector_daily (
  trade_date date NOT NULL,
  sector text NOT NULL,
  ret_equal numeric(14,10) NOT NULL,
  ret_cap numeric(14,10) NOT NULL,
  constituents integer NOT NULL,
  advances integer NOT NULL,
  declines integer NOT NULL,
  classification_version integer NOT NULL,
  calc_run_id uuid NOT NULL,
  PRIMARY KEY (trade_date, sector)
);

CREATE TABLE calc.regime_rules (
  version integer PRIMARY KEY,
  rules jsonb NOT NULL,
  effective_from date NOT NULL,
  change_note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE calc.quality_issues (
  issue_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('anomaly', 'conflict', 'quarantine', 'user_report', 'vendor_notice', 'stale')),
  severity text NOT NULL CHECK (severity IN ('warn', 'fail')),
  dataset text NOT NULL,
  entity_ref text,
  title text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'triaged', 'resolved', 'wont_fix', 'routed_to_vendor')),
  owner_user_id uuid,
  resolution_notes text,
  correction_id uuid,
  support_ticket_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  triaged_at timestamptz,
  resolved_at timestamptz
);
CREATE INDEX quality_issues_status ON calc.quality_issues(status, created_at);

CREATE TABLE calc.corrections (
  correction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  published_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('data', 'calculation', 'ai_behaviour', 'methodology')),
  title text NOT NULL,
  description text NOT NULL,
  impact text NOT NULL,
  affected jsonb NOT NULL DEFAULT '{}',
  users_notified integer NOT NULL DEFAULT 0
);

CREATE TABLE calc.data_snapshots (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  as_of_date date NOT NULL,
  ingestion_runs jsonb NOT NULL,
  content_hash text NOT NULL,
  frozen boolean NOT NULL DEFAULT true
);

CREATE TABLE calc.briefings (
  briefing_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_date date NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('published', 'held', 'holiday')),
  generated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  content jsonb NOT NULL,
  checks jsonb NOT NULL,
  versions jsonb NOT NULL,
  emailed_at timestamptz
);

-- ───────────────────────────── app: users, billing, research ─────────────────────────────
CREATE TABLE app.users (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  email_verified_at timestamptz,
  password_hash text,
  google_sub text UNIQUE,
  display_name text,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'support', 'data_ops', 'admin')),
  experience_level text CHECK (experience_level IN ('beginner', 'intermediate', 'advanced')),
  interests text[] NOT NULL DEFAULT '{}',
  briefing_email text NOT NULL DEFAULT 'off' CHECK (briefing_email IN ('daily', 'weekly', 'off')),
  display_prefs jsonb NOT NULL DEFAULT '{}',
  totp_secret text,
  totp_enabled_at timestamptz,
  recovery_codes jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  is_beta boolean NOT NULL DEFAULT false,
  founding_member boolean NOT NULL DEFAULT false,
  state_code text,
  onboarding_completed_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX users_email ON app.users(lower(email)) WHERE status = 'active';

CREATE TABLE app.sessions (
  session_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ip text,
  user_agent text,
  mfa_verified boolean NOT NULL DEFAULT false,
  revoked_at timestamptz
);
CREATE INDEX sessions_user ON app.sessions(user_id);

CREATE TABLE app.auth_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  kind text NOT NULL CHECK (kind IN ('verify_email', 'reset_password')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX auth_tokens_user ON app.auth_tokens(user_id, kind, created_at);

CREATE TABLE app.login_attempts (
  attempt_id bigserial PRIMARY KEY,
  email text NOT NULL,
  ip text NOT NULL,
  success boolean NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_email ON app.login_attempts(lower(email), at);
CREATE INDEX login_attempts_ip ON app.login_attempts(ip, at);

CREATE TABLE app.consents (
  consent_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  kind text NOT NULL CHECK (kind IN ('terms', 'privacy', 'age_18', 'product_updates', 'marketing', 'analytics')),
  version text NOT NULL,
  granted boolean NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  ip text,
  source text NOT NULL,
  effective_by timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consents_user ON app.consents(user_id, kind, at DESC);

CREATE TABLE app.plans (
  plan_code text PRIMARY KEY,
  name text NOT NULL,
  price_inr_monthly numeric(12,2) NOT NULL,
  annual_price_inr numeric(12,2),
  active boolean NOT NULL DEFAULT true,
  support_note text NOT NULL,
  rank integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.plan_entitlements (
  plan_code text NOT NULL REFERENCES app.plans(plan_code),
  key text NOT NULL,
  value integer NOT NULL,
  PRIMARY KEY (plan_code, key)
);

CREATE TABLE app.plan_price_history (
  plan_code text NOT NULL REFERENCES app.plans(plan_code),
  price_inr_monthly numeric(12,2) NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  PRIMARY KEY (plan_code, effective_from)
);

CREATE TABLE app.coupons (
  code text PRIMARY KEY,
  description text NOT NULL,
  percent_off numeric(5,2),
  amount_off_inr numeric(12,2),
  duration_months integer NOT NULL,
  max_redemptions integer,
  redeemed integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  applies_to text[] NOT NULL DEFAULT '{plus,pro}',
  beta_only boolean NOT NULL DEFAULT false,
  CHECK ((percent_off IS NULL) <> (amount_off_inr IS NULL))
);

CREATE TABLE app.subscriptions (
  subscription_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  plan_code text NOT NULL REFERENCES app.plans(plan_code),
  status text NOT NULL CHECK (status IN ('created', 'pending', 'active', 'past_due', 'cancelled', 'expired', 'halted')),
  gateway text NOT NULL,
  gateway_subscription_id text UNIQUE,
  price_inr numeric(12,2) NOT NULL,
  coupon_code text REFERENCES app.coupons(code),
  discount_months_left integer NOT NULL DEFAULT 0,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  scheduled_plan_code text,
  grace_until timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  cancel_comment text,
  mandate_status text NOT NULL DEFAULT 'none' CHECK (mandate_status IN ('none', 'pending', 'active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX subscriptions_one_live ON app.subscriptions(user_id) WHERE status IN ('created', 'pending', 'active', 'past_due');

CREATE TABLE app.payments (
  payment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  subscription_id uuid REFERENCES app.subscriptions(subscription_id),
  gateway_payment_id text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('charge', 'proration', 'refund')),
  taxable_inr numeric(12,2) NOT NULL,
  gst_inr numeric(12,2) NOT NULL,
  amount_inr numeric(12,2) NOT NULL,
  status text NOT NULL CHECK (status IN ('captured', 'failed', 'refunded', 'pending')),
  method text,
  is_sandbox boolean NOT NULL,
  refund_of uuid REFERENCES app.payments(payment_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.invoice_sequences (
  fiscal_year integer NOT NULL,
  doc_type text NOT NULL CHECK (doc_type IN ('invoice', 'credit_note')),
  last_seq integer NOT NULL DEFAULT 0,
  PRIMARY KEY (fiscal_year, doc_type)
);

CREATE TABLE app.invoices (
  invoice_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  doc_type text NOT NULL CHECK (doc_type IN ('invoice', 'credit_note')),
  fiscal_year integer NOT NULL,
  seq integer NOT NULL,
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  payment_id uuid NOT NULL REFERENCES app.payments(payment_id),
  related_invoice_id uuid REFERENCES app.invoices(invoice_id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  supplier_state_code text NOT NULL,
  place_of_supply_state text NOT NULL,
  buyer_name text,
  buyer_gstin text,
  sac_code text NOT NULL,
  taxable_value numeric(12,2) NOT NULL,
  cgst numeric(12,2) NOT NULL,
  sgst numeric(12,2) NOT NULL,
  igst numeric(12,2) NOT NULL,
  total numeric(12,2) NOT NULL,
  lines jsonb NOT NULL,
  approval_status text NOT NULL CHECK (approval_status IN ('template_pending_ca_approval', 'ca_approved')),
  is_sandbox boolean NOT NULL,
  emailed_at timestamptz,
  UNIQUE (fiscal_year, doc_type, seq)
);

CREATE TABLE app.webhook_events (
  event_id text PRIMARY KEY,
  gateway text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  signature_valid boolean NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status text NOT NULL CHECK (status IN ('received', 'processed', 'ignored', 'failed', 'rejected')),
  error text
);

CREATE TABLE app.usage_counters (
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  metric text NOT NULL,
  period_start date NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, metric, period_start)
);

CREATE TABLE app.entitlement_overrides (
  override_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  key text NOT NULL,
  value integer NOT NULL,
  expires_at timestamptz,
  reason text NOT NULL,
  granted_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.company_views (
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  company_id uuid NOT NULL REFERENCES ref.companies(company_id),
  period_start date NOT NULL,
  first_viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, company_id, period_start)
);

CREATE TABLE app.last_visits (
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  company_id uuid NOT NULL REFERENCES ref.companies(company_id),
  last_visit_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, company_id)
);

CREATE TABLE app.watchlists (
  watchlist_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX watchlists_user ON app.watchlists(user_id) WHERE deleted_at IS NULL;

CREATE TABLE app.watchlist_items (
  watchlist_id uuid NOT NULL REFERENCES app.watchlists(watchlist_id),
  company_id uuid NOT NULL REFERENCES ref.companies(company_id),
  position integer NOT NULL DEFAULT 0,
  source_surface text,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (watchlist_id, company_id)
);

CREATE TABLE app.notes (
  note_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  attached_type text CHECK (attached_type IN ('company', 'watchlist', 'backtest', 'answer', 'briefing', 'none')),
  attached_id text,
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  snapshots jsonb NOT NULL DEFAULT '[]',
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX notes_user ON app.notes(user_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE app.workspaces (
  workspace_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  name text NOT NULL,
  company_id uuid REFERENCES ref.companies(company_id),
  state jsonb NOT NULL,
  saved_figures jsonb NOT NULL DEFAULT '[]',
  saved_as_of date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE app.saved_screens (
  screen_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  definition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_run_at timestamptz,
  last_as_of date,
  deleted_at timestamptz
);

CREATE TABLE app.peer_sets (
  peer_set_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  company_id uuid NOT NULL REFERENCES ref.companies(company_id),
  name text NOT NULL,
  peers uuid[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.research_history (
  history_id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  kind text NOT NULL CHECK (kind IN ('company_view', 'question', 'backtest', 'screen', 'briefing')),
  ref_id text NOT NULL,
  label text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX research_history_user ON app.research_history(user_id, at DESC);

CREATE TABLE app.hypotheses (
  hypothesis_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  company_id uuid REFERENCES ref.companies(company_id),
  statement text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]',
  baseline jsonb NOT NULL DEFAULT '{}',
  review_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE app.alert_rules (
  rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  watchlist_id uuid REFERENCES app.watchlists(watchlist_id),
  company_id uuid REFERENCES ref.companies(company_id),
  kind text NOT NULL CHECK (kind IN ('material_change', 'price_move', 'volume_spike')),
  config jsonb NOT NULL DEFAULT '{}',
  digest boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (watchlist_id IS NOT NULL OR company_id IS NOT NULL)
);

CREATE TABLE app.alert_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  rule_id uuid NOT NULL REFERENCES app.alert_rules(rule_id),
  company_id uuid NOT NULL REFERENCES ref.companies(company_id),
  kind text NOT NULL,
  dedupe_key text NOT NULL,
  title text NOT NULL,
  payload jsonb NOT NULL,
  source_ingested_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'digested', 'suppressed_cap', 'failed', 'paused')),
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  opened_at timestamptz,
  last_error text,
  UNIQUE (user_id, dedupe_key)
);

CREATE TABLE app.exports (
  export_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  kind text NOT NULL CHECK (kind IN ('pdf_company', 'pdf_backtest', 'csv_screen', 'account_data')),
  params jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('queued', 'ready', 'failed', 'expired')),
  object_key text,
  token_hash text,
  fields_omitted jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz,
  error text
);

CREATE TABLE app.learning_progress (
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  lesson_slug text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  quiz_score integer,
  return_to text,
  PRIMARY KEY (user_id, lesson_slug)
);

CREATE TABLE app.support_tickets (
  ticket_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_ref text NOT NULL UNIQUE,
  user_id uuid REFERENCES app.users(user_id),
  email text,
  kind text NOT NULL CHECK (kind IN ('feedback', 'data_issue', 'ai_issue', 'support', 'grievance', 'coverage_request', 'billing')),
  surface text,
  page text,
  context jsonb NOT NULL DEFAULT '{}',
  subject text NOT NULL,
  comment text,
  screenshot_key text,
  plan_code text,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'priority')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'triaged', 'waiting', 'resolved', 'closed')),
  due_first_response_at timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,
  resolution text,
  assignee uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_tickets_status ON app.support_tickets(status, created_at);

CREATE TABLE app.email_outbox (
  email_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email text NOT NULL,
  user_id uuid REFERENCES app.users(user_id),
  template text NOT NULL,
  category text NOT NULL CHECK (category IN ('service', 'billing', 'security', 'briefing', 'alert', 'marketing', 'product_updates')),
  subject text NOT NULL,
  body_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'suppressed')),
  attempts integer NOT NULL DEFAULT 0,
  error text
);
CREATE INDEX email_outbox_status ON app.email_outbox(status, created_at);

CREATE TABLE app.email_suppressions (
  email text PRIMARY KEY,
  reason text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.analytics_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  user_id uuid,
  anon_id text,
  session_id text,
  plan text,
  props jsonb NOT NULL DEFAULT '{}',
  origin text NOT NULL CHECK (origin IN ('server', 'client')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_events_name ON app.analytics_events(name, occurred_at);
CREATE INDEX analytics_events_user ON app.analytics_events(user_id, occurred_at);

CREATE TABLE app.analytics_rejections (
  rejection_id bigserial PRIMARY KEY,
  name text,
  reason text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.experiment_assignments (
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  experiment text NOT NULL,
  variant text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  exposed_at timestamptz,
  PRIMARY KEY (user_id, experiment)
);

CREATE TABLE app.account_deletions (
  user_id uuid PRIMARY KEY REFERENCES app.users(user_id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  erase_after timestamptz NOT NULL,
  erased_at timestamptz
);

CREATE TABLE app.content_pages (
  slug text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('help', 'methodology', 'lesson', 'briefing_template', 'release_note', 'legal')),
  version integer NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'in_review', 'published', 'retired')),
  author_user_id uuid,
  reviewer_user_ids uuid[] NOT NULL DEFAULT '{}',
  editorial_checklist jsonb,
  price_data_cutoff date,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (slug, version)
);

CREATE TABLE app.grievances (
  grievance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES app.support_tickets(ticket_id),
  received_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  ack_due_at timestamptz NOT NULL,
  resolved_at timestamptz,
  escalation_level integer NOT NULL DEFAULT 0
);

-- ───────────────────────────── bt: back-testing ─────────────────────────────
CREATE TABLE bt.strategy_templates (
  template_code text NOT NULL,
  version integer NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  rules text NOT NULL,
  params_schema jsonb NOT NULL,
  limitations text NOT NULL,
  universe_kinds text[] NOT NULL,
  min_plan text NOT NULL,
  PRIMARY KEY (template_code, version)
);

CREATE TABLE bt.cost_tables (
  version text PRIMARY KEY,
  effective_from date NOT NULL,
  components jsonb NOT NULL,
  verified_against_current_schedules boolean NOT NULL DEFAULT false,
  verified_by text,
  verified_on date,
  notes text NOT NULL
);

CREATE TABLE bt.backtest_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  idempotency_key text,
  name text,
  config jsonb NOT NULL,
  template_code text NOT NULL,
  template_version integer NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES calc.data_snapshots(snapshot_id),
  engine_version text NOT NULL,
  cost_table_version text NOT NULL REFERENCES bt.cost_tables(version),
  benchmark_code text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  progress numeric(5,2) NOT NULL DEFAULT 0,
  metrics jsonb,
  warnings jsonb,
  results_hash text,
  series_key text,
  rerun_of uuid REFERENCES bt.backtest_runs(run_id),
  saved boolean NOT NULL DEFAULT false,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  runtime_ms integer,
  deleted_at timestamptz,
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE bt.backtest_trades (
  run_id uuid NOT NULL REFERENCES bt.backtest_runs(run_id),
  seq integer NOT NULL,
  security_id bigint NOT NULL,
  symbol text NOT NULL,
  side text NOT NULL CHECK (side IN ('entry', 'exit', 'skipped')),
  trade_date date NOT NULL,
  price numeric(16,6),
  quantity numeric(20,6),
  gross_value numeric(20,4),
  costs jsonb NOT NULL DEFAULT '{}',
  pnl numeric(20,4),
  reason text,
  PRIMARY KEY (run_id, seq)
);

-- ───────────────────────────── ai ─────────────────────────────
CREATE TABLE ai.conversations (
  conversation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  title text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  purge_after timestamptz
);
CREATE INDEX conversations_user ON ai.conversations(user_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE ai.messages (
  message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai.conversations(conversation_id),
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content_json jsonb NOT NULL,
  intent text,
  model_id text,
  prompt_version text,
  tool_versions jsonb,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_inr numeric(12,4) NOT NULL DEFAULT 0,
  latency_ms integer,
  check_status text CHECK (check_status IN ('pass', 'regenerated', 'fallback', 'policy', 'refused', 'error')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation ON ai.messages(conversation_id, created_at);

CREATE TABLE ai.claims (
  claim_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES ai.messages(message_id),
  claim_type text NOT NULL CHECK (claim_type IN ('observed', 'calculated', 'interpretation')),
  text text NOT NULL,
  value numeric,
  unit text,
  evidence jsonb NOT NULL DEFAULT '[]',
  check_result text NOT NULL CHECK (check_result IN ('pass', 'fail', 'not_numeric'))
);

CREATE TABLE ai.tool_calls (
  tool_call_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES ai.messages(message_id),
  tool text NOT NULL,
  tool_version text NOT NULL,
  input jsonb NOT NULL,
  output jsonb NOT NULL,
  fields_sent_to_model text[] NOT NULL DEFAULT '{}',
  fields_withheld text[] NOT NULL DEFAULT '{}',
  latency_ms integer NOT NULL
);

CREATE TABLE ai.feedback (
  feedback_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES ai.messages(message_id),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  rating text CHECK (rating IN ('up', 'down')),
  reason text,
  comment text,
  is_error_report boolean NOT NULL DEFAULT false,
  review_status text NOT NULL DEFAULT 'new' CHECK (review_status IN ('new', 'in_review', 'confirmed_error', 'not_an_error', 'added_to_eval')),
  review_label text,
  reviewer_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  triaged_at timestamptz
);

CREATE TABLE ai.eval_cases (
  case_id text PRIMARY KEY,
  suite text NOT NULL CHECK (suite IN ('golden', 'red_team', 'causal')),
  category text NOT NULL,
  question text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}',
  expected jsonb NOT NULL,
  snapshot_label text NOT NULL,
  origin text NOT NULL CHECK (origin IN ('generated', 'curated', 'user_report')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai.eval_runs (
  eval_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  provider text NOT NULL,
  model_id text NOT NULL,
  prompt_version text NOT NULL,
  tool_version text NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}',
  thresholds jsonb NOT NULL DEFAULT '{}',
  passed boolean
);

CREATE TABLE ai.eval_results (
  eval_run_id uuid NOT NULL REFERENCES ai.eval_runs(eval_run_id),
  case_id text NOT NULL REFERENCES ai.eval_cases(case_id),
  passed boolean NOT NULL,
  details jsonb NOT NULL,
  PRIMARY KEY (eval_run_id, case_id)
);
