-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 0009: Skills (Gig Economy) Schema
-- NEXUS Campus Super-App — Phase 2E
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$ BEGIN
  CREATE TYPE skill_category AS ENUM (
    'tutoring', 'design', 'coding', 'music', 'fitness',
    'language', 'photography', 'writing', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE skill_listing_status AS ENUM ('active', 'paused', 'removed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE skill_order_status AS ENUM (
    'pending_payment', 'payment_held', 'in_progress',
    'pending_review', 'revision_requested', 'completed',
    'cancelled', 'disputed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE milestone_status AS ENUM ('pending', 'submitted', 'approved', 'revision_requested');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ━━━ Skill Listings ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS skill_listings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   UUID NOT NULL REFERENCES users(id),
  campus_id     UUID NOT NULL REFERENCES campuses(id),
  title         VARCHAR(200) NOT NULL,
  description   TEXT NOT NULL,
  category      skill_category NOT NULL,
  packages      JSONB NOT NULL DEFAULT '[]'::jsonb,
  portfolio_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags          VARCHAR(50)[] NOT NULL DEFAULT '{}',
  status        skill_listing_status NOT NULL DEFAULT 'active',
  total_orders  INTEGER NOT NULL DEFAULT 0,
  avg_rating    DECIMAL(3, 2) NOT NULL DEFAULT 0.00,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skill_listings_campus ON skill_listings(campus_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_skill_listings_provider ON skill_listings(provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_listings_category ON skill_listings(category) WHERE status = 'active';

-- ━━━ Skill Orders ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS skill_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        UUID NOT NULL REFERENCES skill_listings(id),
  buyer_id          UUID NOT NULL REFERENCES users(id),
  provider_id       UUID NOT NULL REFERENCES users(id),
  transaction_id    UUID REFERENCES transactions(id),
  package_snapshot  JSONB NOT NULL,
  requirements      TEXT NOT NULL,
  status            skill_order_status NOT NULL DEFAULT 'pending_payment',
  milestone_count   SMALLINT NOT NULL DEFAULT 1,
  deadline_at       TIMESTAMPTZ,
  delivery_proof_url TEXT,
  revision_count    SMALLINT NOT NULL DEFAULT 0,
  max_revisions     SMALLINT NOT NULL DEFAULT 2,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skill_orders_buyer ON skill_orders(buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_orders_provider ON skill_orders(provider_id, status);
CREATE INDEX IF NOT EXISTS idx_skill_orders_autorelease
  ON skill_orders(updated_at) WHERE status = 'pending_review';

-- ━━━ Skill Milestones ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS skill_milestones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES skill_orders(id) ON DELETE CASCADE,
  title           VARCHAR(200) NOT NULL,
  description     TEXT,
  due_at          TIMESTAMPTZ,
  status          milestone_status NOT NULL DEFAULT 'pending',
  submission_url  TEXT,
  feedback        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skill_milestones_order ON skill_milestones(order_id);

-- ━━━ Skill Ratings ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS skill_ratings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL UNIQUE REFERENCES skill_orders(id),
  rater_id    UUID NOT NULL REFERENCES users(id),
  provider_id UUID NOT NULL REFERENCES users(id),
  score       SMALLINT NOT NULL CHECK (score >= 1 AND score <= 5),
  review_text TEXT,
  is_flagged  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skill_ratings_provider ON skill_ratings(provider_id, created_at DESC);
