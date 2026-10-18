-- Payment-gateway sandbox state (development only) and in-app notices (PRD BIL-06, HOM-05).
CREATE TABLE ops.sandbox_gateway (
  object_id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('subscription', 'payment', 'refund')),
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.notifications (
  notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  href text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX notifications_user ON app.notifications(user_id, created_at DESC);

ALTER TABLE app.subscriptions ADD COLUMN buyer_gstin text;
ALTER TABLE app.subscriptions ADD COLUMN buyer_name text;
ALTER TABLE app.subscriptions ADD COLUMN place_of_supply_state text;
ALTER TABLE app.subscriptions ADD COLUMN first_charge_at timestamptz;
