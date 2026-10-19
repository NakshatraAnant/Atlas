-- Learning engine: XP ledger, achievement unlocks and learner settings (Academy retention features).
-- XP is derived on the server from authoritative learner records (lesson progress, quiz and review
-- attempts, mastery, games, capstones, completion records); one row per (user, kind, ref) makes every
-- award idempotent. Nothing here is written directly from browser input.

CREATE TABLE acad.learning_events (
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  kind text NOT NULL CHECK (kind IN (
    'lesson_completed', 'quiz_perfect', 'error_recovered', 'objective_mastered', 'review_recalled',
    'diagnostic_completed', 'game_solved', 'capstone_submitted', 'course_completed',
    'daily_mission', 'weekly_mission')),
  ref text NOT NULL CHECK (length(ref) BETWEEN 1 AND 120),
  xp integer NOT NULL CHECK (xp BETWEEN 0 AND 1000),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, ref)
);
CREATE INDEX learning_events_user_time ON acad.learning_events(user_id, occurred_at DESC);

CREATE TABLE acad.achievement_unlocks (
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  achievement_id text NOT NULL CHECK (length(achievement_id) BETWEEN 1 AND 60),
  unlocked_at timestamptz NOT NULL,
  evidence jsonb NOT NULL,
  PRIMARY KEY (user_id, achievement_id)
);

CREATE TABLE acad.learner_settings (
  user_id uuid PRIMARY KEY REFERENCES app.users(user_id),
  timezone text NOT NULL DEFAULT 'Asia/Kolkata' CHECK (length(timezone) BETWEEN 1 AND 64),
  weekly_goal_days integer NOT NULL DEFAULT 3 CHECK (weekly_goal_days BETWEEN 1 AND 7),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE acad.learning_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE acad.achievement_unlocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE acad.learner_settings ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON acad.learning_events, acad.achievement_unlocks, acad.learner_settings FROM anon, authenticated;
  END IF;
END $$;
