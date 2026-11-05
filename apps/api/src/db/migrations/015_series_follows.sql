-- 015: Follows for macro and commodity series. When a followed series gains a newer observation, the
-- follower gets an in-app notice (unless they turned release notices off in Settings).

CREATE TABLE app.series_follows (
  user_id uuid NOT NULL REFERENCES app.users(user_id) ON DELETE CASCADE,
  series_key text NOT NULL CHECK (series_key ~ '^(macro:[A-Z0-9_]{2,40}|commodity:(fred|eia):[A-Za-z0-9_.-]{2,40})$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The latest observation period the follower has already been told about (set when they follow).
  notified_through date,
  PRIMARY KEY (user_id, series_key)
);
CREATE INDEX series_follows_key ON app.series_follows(series_key);

-- Same rule as every ATLAS table: row-level security on, no permissive policy (only the server role reads it).
ALTER TABLE app.series_follows ENABLE ROW LEVEL SECURITY;
