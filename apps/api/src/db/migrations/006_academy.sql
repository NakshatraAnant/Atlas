-- ATLAS Academy foundation (product expansion beyond PRD LRN-01..04; see docs/ACADEMY_CURRICULUM.md).
-- Curriculum is data, not code: course copy, lessons and question banks live here and are
-- versioned. Learner records pin the exact course and question versions they saw, so later
-- edits never rewrite history.
CREATE SCHEMA IF NOT EXISTS acad;

CREATE TABLE acad.courses (
  course_id text PRIMARY KEY CHECK (course_id ~ '^[a-z0-9-]{2,40}$'),
  position integer NOT NULL,
  current_version integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE acad.course_versions (
  course_id text NOT NULL REFERENCES acad.courses(course_id),
  version integer NOT NULL CHECK (version > 0),
  title text NOT NULL,
  tagline text NOT NULL,
  description text NOT NULL,
  audience text NOT NULL,
  prerequisites text NOT NULL,
  -- Placement rules: {"high_min": 0.8, "low_max": 0.4, "critical_miss_low": 2, "questions": 5}
  readiness_rules jsonb NOT NULL,
  preceding_course_id text REFERENCES acad.courses(course_id),
  completion_statement text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'in_review', 'published', 'retired')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, version)
);
ALTER TABLE acad.courses ADD CONSTRAINT courses_current_version_fk FOREIGN KEY (course_id, current_version) REFERENCES acad.course_versions(course_id, version) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE acad.objectives (
  objective_id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES acad.courses(course_id),
  statement text NOT NULL,
  skill text NOT NULL,
  position integer NOT NULL
);
CREATE INDEX objectives_course ON acad.objectives(course_id, position);

CREATE TABLE acad.modules (
  module_id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES acad.courses(course_id),
  position integer NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  UNIQUE (course_id, position)
);

CREATE TABLE acad.lessons (
  lesson_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  module_id text NOT NULL REFERENCES acad.modules(module_id),
  position integer NOT NULL,
  title text NOT NULL,
  minutes integer NOT NULL CHECK (minutes BETWEEN 1 AND 120),
  objective_ids text[] NOT NULL,
  prerequisite_lesson_ids text[] NOT NULL DEFAULT '{}',
  -- Ordered blocks following DISCOVER → OBSERVE → PREDICT → INVESTIGATE → DECIDE → EXPLAIN → REVIEW.
  blocks jsonb NOT NULL,
  references_list jsonb NOT NULL DEFAULT '[]',
  mastery_rule text NOT NULL,
  -- Publication review: factual, calculation, pedagogy, accessibility, rights, alignment, technical.
  review jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('draft', 'in_review', 'published', 'retired')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lesson_id, version),
  CONSTRAINT published_lesson_reviewed CHECK (
    status <> 'published' OR (
      review ?& ARRAY['factual', 'calculation', 'pedagogy', 'accessibility', 'rights', 'alignment', 'technical']
      AND review ? 'reviewed_by' AND review ? 'reviewed_on'
    )
  )
);
CREATE INDEX lessons_module ON acad.lessons(module_id, position);

CREATE TABLE acad.questions (
  question_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  course_id text NOT NULL REFERENCES acad.courses(course_id),
  purpose text NOT NULL CHECK (purpose IN ('diagnostic', 'quiz')),
  lesson_id text,
  objective_id text REFERENCES acad.objectives(objective_id),
  skill text NOT NULL,
  prerequisite text,
  difficulty integer NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  qtype text NOT NULL CHECK (qtype IN ('single_choice', 'numeric', 'multi_select')),
  stem text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]',
  -- single_choice: {"index": n}; multi_select: {"indexes": [..]}; numeric: {"value": x, "abs_tol": t, "unit": "%"}
  correct jsonb NOT NULL,
  explanation text NOT NULL,
  misconception text NOT NULL,
  weight numeric(6,3) NOT NULL DEFAULT 1 CHECK (weight > 0),
  critical boolean NOT NULL DEFAULT false,
  references_list jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL CHECK (status IN ('draft', 'in_review', 'published', 'retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, version)
);
CREATE INDEX questions_bank ON acad.questions(course_id, purpose, status);

-- Question content is immutable once any learner has answered it: change it by adding a version.
CREATE FUNCTION acad.questions_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.status <> 'draft' AND (NEW.stem, NEW.options, NEW.correct, NEW.qtype, NEW.weight, NEW.critical) IS DISTINCT FROM (OLD.stem, OLD.options, OLD.correct, OLD.qtype, OLD.weight, OLD.critical) THEN
    RAISE EXCEPTION 'acad.questions % v% is not a draft: add a new version instead of editing', OLD.question_id, OLD.version;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER questions_no_edit BEFORE UPDATE ON acad.questions FOR EACH ROW EXECUTE FUNCTION acad.questions_immutable();

CREATE TABLE acad.diagnostic_attempts (
  attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  course_id text NOT NULL,
  course_version integer NOT NULL,
  question_refs jsonb NOT NULL,
  rules jsonb NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  submitted_at timestamptz,
  responses jsonb,
  result jsonb,
  readiness text CHECK (readiness IN ('high', 'borderline', 'low')),
  engine_version text NOT NULL,
  FOREIGN KEY (course_id, course_version) REFERENCES acad.course_versions(course_id, version)
);
CREATE INDEX diagnostic_attempts_user ON acad.diagnostic_attempts(user_id, course_id, started_at DESC);

CREATE TABLE acad.enrolments (
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  course_id text NOT NULL REFERENCES acad.courses(course_id),
  course_version integer NOT NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  entry_route text NOT NULL CHECK (entry_route IN ('direct', 'after_review', 'learner_override', 'no_diagnostic')),
  diagnostic_attempt_id uuid REFERENCES acad.diagnostic_attempts(attempt_id),
  completed_at timestamptz,
  PRIMARY KEY (user_id, course_id),
  FOREIGN KEY (course_id, course_version) REFERENCES acad.course_versions(course_id, version)
);

CREATE TABLE acad.lesson_progress (
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  lesson_id text NOT NULL,
  lesson_version integer NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_block integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  PRIMARY KEY (user_id, lesson_id),
  FOREIGN KEY (lesson_id, lesson_version) REFERENCES acad.lessons(lesson_id, version)
);

CREATE TABLE acad.quiz_attempts (
  attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  lesson_id text NOT NULL,
  lesson_version integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('lesson_quiz', 'review')),
  question_refs jsonb NOT NULL,
  responses jsonb NOT NULL,
  result jsonb NOT NULL,
  score numeric(5,4) NOT NULL CHECK (score BETWEEN 0 AND 1),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  engine_version text NOT NULL
);
CREATE INDEX quiz_attempts_user ON acad.quiz_attempts(user_id, submitted_at DESC);

-- Demonstrated mastery per objective (separate from lesson completion).
CREATE TABLE acad.objective_mastery (
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  objective_id text NOT NULL REFERENCES acad.objectives(objective_id),
  evidence_count integer NOT NULL DEFAULT 0,
  correct_count integer NOT NULL DEFAULT 0,
  estimate numeric(6,5) NOT NULL DEFAULT 0 CHECK (estimate BETWEEN 0 AND 1),
  state text NOT NULL DEFAULT 'learning' CHECK (state IN ('learning', 'mastered')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, objective_id)
);

-- Spaced review (Leitner boxes). One row per user and objective.
CREATE TABLE acad.review_schedule (
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  objective_id text NOT NULL REFERENCES acad.objectives(objective_id),
  box integer NOT NULL DEFAULT 1 CHECK (box BETWEEN 1 AND 5),
  due_at timestamptz NOT NULL,
  last_reviewed_at timestamptz,
  last_correct boolean,
  PRIMARY KEY (user_id, objective_id)
);
CREATE INDEX review_schedule_due ON acad.review_schedule(user_id, due_at);

-- Deny-by-default, as for every other ATLAS schema (ADR-012).
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'acad' AND c.relkind IN ('r', 'p') LOOP
    EXECUTE format('ALTER TABLE acad.%I ENABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA acad FROM anon, authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA acad FROM anon, authenticated;
    REVOKE USAGE ON SCHEMA acad FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA acad REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA acad REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
  END IF;
END $$;
