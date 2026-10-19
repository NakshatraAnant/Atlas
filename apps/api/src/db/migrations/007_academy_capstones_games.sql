-- ATLAS Academy: capstones, completion records and learning games (product expansion; see
-- docs/ACADEMY_CURRICULUM.md). Same rules as 006: content is versioned data, learner records pin
-- versions, RLS is deny-by-default and the API is the only client.

CREATE TABLE acad.capstones (
  course_id text NOT NULL REFERENCES acad.courses(course_id),
  version integer NOT NULL CHECK (version > 0),
  title text NOT NULL,
  brief text NOT NULL,
  deliverables jsonb NOT NULL,
  -- [{ "criterion": "...", "levels": ["0 ...", "1 ...", "2 ...", "3 ..."] }]
  rubric jsonb NOT NULL,
  artefact_kinds text[] NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('draft', 'in_review', 'published', 'retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, version)
);

CREATE TABLE acad.capstone_submissions (
  submission_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  course_id text NOT NULL,
  capstone_version integer NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 50 AND 20000),
  artefacts jsonb NOT NULL DEFAULT '[]',
  self_assessment jsonb NOT NULL,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'reviewed')),
  review jsonb,
  reviewer_user_id uuid,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  FOREIGN KEY (course_id, capstone_version) REFERENCES acad.capstones(course_id, version)
);
CREATE INDEX capstone_submissions_user ON acad.capstone_submissions(user_id, course_id, submitted_at DESC);
CREATE INDEX capstone_submissions_status ON acad.capstone_submissions(status, submitted_at);

-- What was actually assessed, frozen at issue time. Not a qualification (statement stored with it).
CREATE TABLE acad.completion_records (
  record_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  course_id text NOT NULL,
  course_version integer NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  assessed jsonb NOT NULL,
  statement text NOT NULL,
  UNIQUE (user_id, course_id),
  FOREIGN KEY (course_id, course_version) REFERENCES acad.course_versions(course_id, version)
);

CREATE TABLE acad.game_scores (
  score_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  game_id text NOT NULL,
  game_version integer NOT NULL,
  correct integer NOT NULL CHECK (correct >= 0),
  total integer NOT NULL CHECK (total > 0 AND correct <= total),
  details jsonb NOT NULL,
  played_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX game_scores_user ON acad.game_scores(user_id, game_id, played_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['capstones', 'capstone_submissions', 'completion_records', 'game_scores'] LOOP
    EXECUTE format('ALTER TABLE acad.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA acad FROM anon, authenticated;
  END IF;
END $$;
