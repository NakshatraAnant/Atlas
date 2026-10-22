-- ATLAS Digital Assets (crypto) — canonical, provider-independent data model.
-- Kept in its own schema: crypto concepts never go into equity tables (ref/market/fund).
-- Every observation carries its source, retrieval time and import job. Symbols are NOT identities:
-- an asset is identified by its internal id plus verified provider ids. Market pairs are venue-specific
-- (BTC/USD on Coinbase and BTC/USDT on Binance are different series). Missing values stay NULL; nothing
-- is coerced to zero.

CREATE SCHEMA IF NOT EXISTS crypto;

-- Provider registry. Capabilities, limits and terms are recorded from official documentation, with the
-- date they were checked. Health is written by the ingestion engine from real request outcomes.
CREATE TABLE crypto.sources (
  source_id text PRIMARY KEY CHECK (source_id ~ '^[a-z0-9_]{2,40}$'),
  provider text NOT NULL,
  category text NOT NULL CHECK (category IN ('market_reference', 'exchange', 'defi', 'onchain', 'events')),
  base_url text NOT NULL,
  docs_url text NOT NULL,
  terms_url text,
  docs_checked_on date NOT NULL,
  auth text NOT NULL CHECK (auth IN ('none', 'optional_key', 'required_key')),
  rate_limit_note text NOT NULL,
  budget_per_minute integer NOT NULL CHECK (budget_per_minute > 0),
  history_note text NOT NULL,
  cadence_note text NOT NULL,
  attribution text,
  storage_note text NOT NULL,
  known_gaps text NOT NULL,
  fallback_source_id text,
  enabled boolean NOT NULL DEFAULT true,
  health text NOT NULL DEFAULT 'unknown' CHECK (health IN ('unknown', 'healthy', 'degraded', 'failing', 'rate_limited', 'disabled')),
  last_request_at timestamptz,
  last_success_at timestamptz,
  last_import_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crypto.request_usage (
  source_id text NOT NULL REFERENCES crypto.sources(source_id),
  day date NOT NULL,
  requests integer NOT NULL DEFAULT 0 CHECK (requests >= 0),
  errors integer NOT NULL DEFAULT 0 CHECK (errors >= 0),
  rate_limited integer NOT NULL DEFAULT 0 CHECK (rate_limited >= 0),
  cache_hits integer NOT NULL DEFAULT 0 CHECK (cache_hits >= 0),
  refused_budget integer NOT NULL DEFAULT 0 CHECK (refused_budget >= 0),
  PRIMARY KEY (source_id, day)
);

CREATE TABLE crypto.ingestion_jobs (
  job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES crypto.sources(source_id),
  job_type text NOT NULL CHECK (length(job_type) BETWEEN 2 AND 60),
  trigger text NOT NULL DEFAULT 'schedule' CHECK (trigger IN ('schedule', 'manual', 'startup', 'test')),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed', 'skipped')),
  started_at timestamptz NOT NULL DEFAULT now(),
  fetched_at timestamptz,
  validated_at timestamptz,
  persisted_at timestamptz,
  reconciled_at timestamptz,
  finished_at timestamptz,
  requests integer NOT NULL DEFAULT 0,
  records_fetched integer NOT NULL DEFAULT 0,
  records_valid integer NOT NULL DEFAULT 0,
  records_persisted integer NOT NULL DEFAULT 0,
  records_quarantined integer NOT NULL DEFAULT 0,
  error text,
  detail jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX ingestion_jobs_source_time ON crypto.ingestion_jobs(source_id, started_at DESC);
CREATE INDEX ingestion_jobs_type_time ON crypto.ingestion_jobs(job_type, started_at DESC);

CREATE TABLE crypto.quarantine (
  quarantine_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id text NOT NULL REFERENCES crypto.sources(source_id),
  job_id uuid REFERENCES crypto.ingestion_jobs(job_id),
  dataset text NOT NULL,
  record_key text NOT NULL,
  record jsonb NOT NULL,
  reasons text[] NOT NULL CHECK (cardinality(reasons) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quarantine_time ON crypto.quarantine(created_at DESC);

CREATE TABLE crypto.networks (
  network_id text PRIMARY KEY CHECK (network_id ~ '^[a-z0-9-]{2,40}$'),
  name text NOT NULL,
  family text NOT NULL CHECK (family IN ('utxo', 'evm', 'svm', 'other')),
  -- EVM chain id where one exists; NULL for networks without one (Bitcoin, Solana).
  chain_id bigint,
  native_symbol text,
  explorer_url text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'unknown')),
  capabilities text[] NOT NULL DEFAULT '{}',
  source_id text REFERENCES crypto.sources(source_id),
  verified_at timestamptz
);

CREATE TABLE crypto.assets (
  asset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Canonical identity: ATLAS uses CoinGecko's asset id as the canonical external key (it is unique
  -- per asset, unlike symbols). Other providers map to it through crypto.asset_provider_ids.
  canonical_key text NOT NULL UNIQUE CHECK (length(canonical_key) BETWEEN 1 AND 120),
  name text NOT NULL,
  symbol text NOT NULL CHECK (length(symbol) BETWEEN 1 AND 30),
  classification text NOT NULL DEFAULT 'unknown' CHECK (classification IN ('native_coin', 'token', 'unknown')),
  category text,
  description text,
  image_url text,
  primary_network_id text REFERENCES crypto.networks(network_id),
  listing_status text NOT NULL DEFAULT 'listed' CHECK (listing_status IN ('listed', 'not_in_latest_snapshot', 'inactive')),
  market_cap_rank integer,
  metadata_source text NOT NULL REFERENCES crypto.sources(source_id),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assets_symbol ON crypto.assets(lower(symbol));
CREATE INDEX assets_rank ON crypto.assets(market_cap_rank);

CREATE TABLE crypto.asset_provider_ids (
  provider text NOT NULL,
  external_id text NOT NULL,
  asset_id uuid NOT NULL REFERENCES crypto.assets(asset_id),
  verified_by text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, external_id)
);
CREATE INDEX asset_provider_ids_asset ON crypto.asset_provider_ids(asset_id);

CREATE TABLE crypto.token_contracts (
  network_id text NOT NULL REFERENCES crypto.networks(network_id),
  -- Normalised per network rules (EVM: lower-case 0x + 40 hex). Validated in application code.
  address text NOT NULL CHECK (length(address) BETWEEN 4 AND 100),
  asset_id uuid NOT NULL REFERENCES crypto.assets(asset_id),
  standard text,
  decimals integer CHECK (decimals BETWEEN 0 AND 36),
  verification text NOT NULL DEFAULT 'provider_reported' CHECK (verification IN ('provider_reported', 'onchain_verified', 'mismatch')),
  source_id text NOT NULL REFERENCES crypto.sources(source_id),
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (network_id, address)
);
CREATE INDEX token_contracts_asset ON crypto.token_contracts(asset_id);

CREATE TABLE crypto.exchanges (
  exchange_id text PRIMARY KEY CHECK (exchange_id ~ '^[a-z0-9_]{2,40}$'),
  name text NOT NULL,
  source_id text NOT NULL REFERENCES crypto.sources(source_id),
  coingecko_id text,
  capabilities text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE crypto.market_pairs (
  pair_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange_id text NOT NULL REFERENCES crypto.exchanges(exchange_id),
  product_id text NOT NULL CHECK (length(product_id) BETWEEN 2 AND 40),
  base_symbol text NOT NULL,
  quote_symbol text NOT NULL,
  base_asset_id uuid REFERENCES crypto.assets(asset_id),
  quote_asset_id uuid REFERENCES crypto.assets(asset_id),
  status text NOT NULL CHECK (length(status) BETWEEN 1 AND 30),
  tradable boolean NOT NULL,
  price_increment text,
  size_increment text,
  mapping_source text,
  source_id text NOT NULL REFERENCES crypto.sources(source_id),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exchange_id, product_id)
);
CREATE INDEX market_pairs_base ON crypto.market_pairs(base_asset_id);

-- A price series is one provider's view of one asset in one quote currency at one interval:
--   venue_candle      exchange OHLCV for a specific market pair
--   reference_close   provider-aggregated reference price (with market cap and volume), no OHLC
CREATE TABLE crypto.price_series (
  series_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES crypto.sources(source_id),
  kind text NOT NULL CHECK (kind IN ('venue_candle', 'reference_close')),
  asset_id uuid NOT NULL REFERENCES crypto.assets(asset_id),
  pair_id uuid REFERENCES crypto.market_pairs(pair_id),
  quote_currency text NOT NULL CHECK (length(quote_currency) BETWEEN 2 AND 12),
  interval text NOT NULL CHECK (interval IN ('1d', '1h')),
  first_open_time timestamptz,
  last_open_time timestamptz,
  observations integer NOT NULL DEFAULT 0,
  backfill_complete boolean NOT NULL DEFAULT false,
  backfill_cursor timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'venue_candle') = (pair_id IS NOT NULL))
);
CREATE UNIQUE INDEX price_series_identity ON crypto.price_series(source_id, asset_id, coalesce(pair_id, '00000000-0000-0000-0000-000000000000'::uuid), quote_currency, interval);

CREATE TABLE crypto.ohlcv (
  series_id uuid NOT NULL REFERENCES crypto.price_series(series_id),
  open_time timestamptz NOT NULL,
  open numeric,
  high numeric,
  low numeric,
  close numeric NOT NULL CHECK (close > 0),
  volume numeric CHECK (volume >= 0),
  quote_volume numeric CHECK (quote_volume >= 0),
  market_cap numeric CHECK (market_cap >= 0),
  trades integer CHECK (trades >= 0),
  validation text NOT NULL DEFAULT 'valid' CHECK (validation IN ('valid', 'suspect')),
  job_id uuid REFERENCES crypto.ingestion_jobs(job_id),
  imported_at timestamptz NOT NULL DEFAULT now(),
  transform_version text NOT NULL,
  PRIMARY KEY (series_id, open_time),
  CHECK ((open IS NULL AND high IS NULL AND low IS NULL) OR (high IS NOT NULL AND low IS NOT NULL AND open > 0 AND high >= low AND high >= open AND high >= close AND low <= open AND low <= close AND low > 0))
);

-- Latest provider snapshot per asset and quote currency (overwritten each refresh).
CREATE TABLE crypto.market_snapshots (
  asset_id uuid NOT NULL REFERENCES crypto.assets(asset_id),
  source_id text NOT NULL REFERENCES crypto.sources(source_id),
  quote_currency text NOT NULL,
  price numeric,
  market_cap numeric,
  fully_diluted_valuation numeric,
  volume_24h numeric,
  high_24h numeric,
  low_24h numeric,
  change_24h_pct numeric,
  change_7d_pct numeric,
  change_30d_pct numeric,
  ath numeric,
  ath_at timestamptz,
  market_cap_rank integer,
  provider_updated_at timestamptz,
  retrieved_at timestamptz NOT NULL,
  job_id uuid REFERENCES crypto.ingestion_jobs(job_id),
  PRIMARY KEY (asset_id, source_id, quote_currency)
);

-- Supply: one observation per asset, source and UTC day. Definitions are the provider's.
CREATE TABLE crypto.supply_snapshots (
  asset_id uuid NOT NULL REFERENCES crypto.assets(asset_id),
  source_id text NOT NULL REFERENCES crypto.sources(source_id),
  observed_on date NOT NULL,
  circulating_supply numeric CHECK (circulating_supply >= 0),
  total_supply numeric CHECK (total_supply >= 0),
  max_supply numeric CHECK (max_supply > 0),
  methodology text NOT NULL,
  validation text NOT NULL DEFAULT 'valid' CHECK (validation IN ('valid', 'inconsistent')),
  validation_note text,
  provider_updated_at timestamptz,
  retrieved_at timestamptz NOT NULL,
  job_id uuid REFERENCES crypto.ingestion_jobs(job_id),
  PRIMARY KEY (asset_id, source_id, observed_on)
);

CREATE TABLE crypto.global_snapshots (
  source_id text NOT NULL REFERENCES crypto.sources(source_id),
  observed_at timestamptz NOT NULL,
  total_market_cap_usd numeric,
  total_volume_usd numeric,
  market_cap_change_24h_pct numeric,
  btc_dominance_pct numeric,
  eth_dominance_pct numeric,
  active_cryptocurrencies integer,
  markets integer,
  retrieved_at timestamptz NOT NULL,
  job_id uuid REFERENCES crypto.ingestion_jobs(job_id),
  PRIMARY KEY (source_id, observed_at)
);

-- DeFi: protocol profiles and provider-defined metrics (TVL, fees, revenue, stablecoin supply).
CREATE TABLE crypto.protocols (
  protocol_id text PRIMARY KEY CHECK (length(protocol_id) BETWEEN 1 AND 120),
  name text NOT NULL,
  category text,
  chains text[] NOT NULL DEFAULT '{}',
  url text,
  description text,
  coingecko_id text,
  asset_id uuid REFERENCES crypto.assets(asset_id),
  tvl_usd numeric,
  change_1d_pct numeric,
  change_7d_pct numeric,
  tvl_rank integer,
  source_id text NOT NULL REFERENCES crypto.sources(source_id),
  retrieved_at timestamptz NOT NULL,
  job_id uuid REFERENCES crypto.ingestion_jobs(job_id)
);
CREATE INDEX protocols_rank ON crypto.protocols(tvl_rank);

CREATE TABLE crypto.defi_metrics (
  subject_kind text NOT NULL CHECK (subject_kind IN ('protocol', 'chain', 'stablecoin', 'all')),
  subject_id text NOT NULL,
  metric text NOT NULL CHECK (metric IN ('tvl', 'fees', 'revenue', 'stablecoin_supply')),
  chain text NOT NULL DEFAULT '',
  observed_on date NOT NULL,
  value numeric NOT NULL CHECK (value >= 0),
  unit text NOT NULL,
  source_id text NOT NULL REFERENCES crypto.sources(source_id),
  retrieved_at timestamptz NOT NULL,
  job_id uuid REFERENCES crypto.ingestion_jobs(job_id),
  PRIMARY KEY (subject_kind, subject_id, metric, chain, observed_on)
);

-- On-chain: a bounded window of recent blocks per network, plus derived network metrics.
CREATE TABLE crypto.onchain_blocks (
  network_id text NOT NULL REFERENCES crypto.networks(network_id),
  height bigint NOT NULL CHECK (height >= 0),
  block_hash text NOT NULL,
  block_time timestamptz NOT NULL,
  tx_count integer CHECK (tx_count >= 0),
  size_bytes integer CHECK (size_bytes >= 0),
  gas_used numeric CHECK (gas_used >= 0),
  gas_limit numeric CHECK (gas_limit >= 0),
  base_fee_gwei numeric CHECK (base_fee_gwei >= 0),
  total_fees_native numeric CHECK (total_fees_native >= 0),
  producer text,
  source_id text NOT NULL REFERENCES crypto.sources(source_id),
  retrieved_at timestamptz NOT NULL,
  PRIMARY KEY (network_id, height),
  UNIQUE (network_id, block_hash)
);
CREATE INDEX onchain_blocks_time ON crypto.onchain_blocks(network_id, block_time DESC);

CREATE TABLE crypto.onchain_metrics (
  network_id text NOT NULL REFERENCES crypto.networks(network_id),
  metric text NOT NULL CHECK (length(metric) BETWEEN 2 AND 60),
  observed_at timestamptz NOT NULL,
  value numeric NOT NULL,
  unit text NOT NULL,
  window_desc text NOT NULL,
  methodology text NOT NULL,
  source_id text NOT NULL REFERENCES crypto.sources(source_id),
  retrieved_at timestamptz NOT NULL,
  PRIMARY KEY (network_id, metric, observed_at)
);

-- Source-linked events. Never manufactured: every row has a source URL and the source's own timestamp.
CREATE TABLE crypto.events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text NOT NULL UNIQUE,
  category text NOT NULL CHECK (category IN ('network_upgrade', 'software_release', 'protocol_announcement', 'governance', 'listing_change', 'security_incident', 'token_unlock', 'other')),
  headline text NOT NULL CHECK (length(headline) BETWEEN 3 AND 300),
  summary text,
  source_id text NOT NULL REFERENCES crypto.sources(source_id),
  source_url text NOT NULL,
  published_at timestamptz NOT NULL,
  event_at timestamptz,
  retrieved_at timestamptz NOT NULL,
  verification text NOT NULL CHECK (verification IN ('published_by_source', 'observed_by_atlas')),
  asset_ids uuid[] NOT NULL DEFAULT '{}',
  network_ids text[] NOT NULL DEFAULT '{}',
  protocol_ids text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX events_published ON crypto.events(published_at DESC);

-- Personal research: watchlist and notes on assets (private to the user).
CREATE TABLE crypto.watchlist_items (
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  asset_id uuid NOT NULL REFERENCES crypto.assets(asset_id),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, asset_id)
);

CREATE TABLE crypto.research_notes (
  note_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  asset_id uuid NOT NULL REFERENCES crypto.assets(asset_id),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX research_notes_user_asset ON crypto.research_notes(user_id, asset_id, created_at DESC);

-- Deny by default for any role other than the owner (same policy as migration 004).
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname AS table_name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p') AND n.nspname = 'crypto'
  LOOP
    EXECUTE format('ALTER TABLE crypto.%I ENABLE ROW LEVEL SECURITY', t.table_name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA crypto FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA crypto FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA crypto REVOKE ALL ON TABLES FROM anon, authenticated';
  END IF;
END $$;
