-- Risk-free rate, events calendar and price revisions (Blueprint §3.1, §5.3; PRD HOM-06, MKT-10).
CREATE TABLE ref.risk_free_rates (
  auction_date date PRIMARY KEY,
  tenor text NOT NULL DEFAULT '91D',
  yield_pct numeric(8,4) NOT NULL,
  source_id text NOT NULL REFERENCES ref.sources(source_id),
  ingestion_run_id uuid REFERENCES ops.ingestion_runs(run_id)
);

CREATE TABLE ref.calendar_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('rbi_policy', 'cpi_release', 'gdp_release', 'results')),
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('scheduled', 'confirmed')),
  company_id uuid REFERENCES ref.companies(company_id),
  source_id text NOT NULL REFERENCES ref.sources(source_id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_date, kind, title)
);

CREATE TABLE market.price_revisions (
  revision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  security_id bigint NOT NULL,
  trade_date date NOT NULL,
  previous jsonb NOT NULL,
  revised jsonb NOT NULL,
  ingestion_run_id uuid NOT NULL REFERENCES ops.ingestion_runs(run_id),
  revised_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX announcements_published ON disc.announcements(published_at DESC);
CREATE UNIQUE INDEX announcements_vendor ON disc.announcements(source_id, vendor_ref);
CREATE UNIQUE INDEX corporate_actions_natural ON market.corporate_actions(security_id, action_type, ex_date, version);
