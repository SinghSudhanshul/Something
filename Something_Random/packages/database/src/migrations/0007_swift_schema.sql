-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 0007: Swift (Campus Errands) Schema
-- NEXUS Campus Super-App — Phase 2C
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$ BEGIN
  CREATE TYPE task_status AS ENUM (
    'open', 'assigned', 'in_progress', 'pending_verification',
    'completed', 'cancelled', 'disputed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE task_category AS ENUM (
    'delivery', 'purchase', 'queue', 'misc', 'tech_help', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE task_application_status AS ENUM ('pending', 'accepted', 'rejected', 'withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE completion_proof_type AS ENUM ('photo', 'gps_pin', 'text');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ━━━ Swift Tasks ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS swift_tasks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poster_id             UUID NOT NULL REFERENCES users(id),
  campus_id             UUID NOT NULL REFERENCES campuses(id),
  title                 VARCHAR(200) NOT NULL,
  description           TEXT,
  category              task_category NOT NULL,
  reward                DECIMAL(8, 2) NOT NULL CHECK (reward > 0 AND reward <= 500),
  status                task_status NOT NULL DEFAULT 'open',
  runner_id             UUID REFERENCES users(id),
  location_from         VARCHAR(200),
  location_to           VARCHAR(200),
  deadline_at           TIMESTAMPTZ NOT NULL,
  completion_proof_url  TEXT,
  completion_proof_type completion_proof_type,
  runner_notes          TEXT,
  rejection_count       SMALLINT NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_swift_tasks_campus ON swift_tasks(campus_id, status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_swift_tasks_poster ON swift_tasks(poster_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_swift_tasks_runner ON swift_tasks(runner_id, status);
CREATE INDEX IF NOT EXISTS idx_swift_tasks_deadline ON swift_tasks(deadline_at) WHERE status IN ('open', 'assigned', 'in_progress');

-- ━━━ Task Applications ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS task_applications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES swift_tasks(id) ON DELETE CASCADE,
  runner_id   UUID NOT NULL REFERENCES users(id),
  message     TEXT,
  status      task_application_status NOT NULL DEFAULT 'pending',
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  UNIQUE(task_id, runner_id)
);

CREATE INDEX IF NOT EXISTS idx_task_applications_task ON task_applications(task_id, status);
CREATE INDEX IF NOT EXISTS idx_task_applications_runner ON task_applications(runner_id, status);

-- ━━━ Task Ratings ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS task_ratings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL UNIQUE REFERENCES swift_tasks(id),
  rater_id    UUID NOT NULL REFERENCES users(id),
  ratee_id    UUID NOT NULL REFERENCES users(id),
  score       SMALLINT NOT NULL CHECK (score >= 1 AND score <= 5),
  review_text TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
