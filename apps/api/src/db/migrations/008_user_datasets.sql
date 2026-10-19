-- User-provided datasets (data without a provider licence): a signed-in user uploads a CSV of
-- daily prices they are entitled to use. Rows are private to that user, labelled as user-provided
-- and unverified, never mixed with ATLAS reference data and never sent to an external AI model.

CREATE TABLE app.user_datasets (
  dataset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('daily_prices')),
  instrument_label text NOT NULL CHECK (length(instrument_label) BETWEEN 1 AND 120),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
  source_description text NOT NULL CHECK (length(source_description) BETWEEN 3 AND 500),
  -- The uploader attests they may use the data for their own analysis; ATLAS stores it for them only.
  rights_attested_at timestamptz NOT NULL,
  mapping jsonb NOT NULL,
  report jsonb NOT NULL,
  file_sha256 text NOT NULL,
  rows_valid integer NOT NULL,
  first_date date,
  last_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX user_datasets_user ON app.user_datasets(user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX user_datasets_dedupe ON app.user_datasets(user_id, file_sha256) WHERE deleted_at IS NULL;

CREATE TABLE app.user_dataset_prices (
  dataset_id uuid NOT NULL REFERENCES app.user_datasets(dataset_id) ON DELETE CASCADE,
  trade_date date NOT NULL,
  open numeric(20,6) NOT NULL CHECK (open > 0),
  high numeric(20,6) NOT NULL CHECK (high > 0),
  low numeric(20,6) NOT NULL CHECK (low > 0),
  close numeric(20,6) NOT NULL CHECK (close > 0),
  volume bigint CHECK (volume >= 0),
  PRIMARY KEY (dataset_id, trade_date),
  CHECK (low <= high AND low <= open AND open <= high AND low <= close AND close <= high)
);

ALTER TABLE app.user_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.user_dataset_prices ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON app.user_datasets, app.user_dataset_prices FROM anon, authenticated;
  END IF;
END $$;
