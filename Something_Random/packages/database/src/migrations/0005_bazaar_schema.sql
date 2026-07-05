-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 0005: Bazaar (Marketplace) Schema
-- NEXUS Campus Super-App — Phase 2A
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enums
DO $$ BEGIN
  CREATE TYPE listing_condition_v2 AS ENUM ('new', 'like_new', 'good', 'fair', 'rough');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE listing_type AS ENUM ('fixed', 'negotiable', 'auction', 'rental');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE bazaar_listing_status AS ENUM ('active', 'sold', 'reserved', 'expired', 'removed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE offer_status AS ENUM ('pending', 'accepted', 'rejected', 'withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ━━━ Listings Table ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS bazaar_listings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id         UUID NOT NULL REFERENCES users(id),
  campus_id         UUID NOT NULL REFERENCES campuses(id),
  title             VARCHAR(200) NOT NULL,
  description       TEXT,
  category          VARCHAR(50) NOT NULL,
  condition         listing_condition_v2 NOT NULL,
  price             DECIMAL(10, 2) NOT NULL CHECK (price > 0),
  listing_type      listing_type NOT NULL DEFAULT 'fixed',
  status            bazaar_listing_status NOT NULL DEFAULT 'active',
  images            JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_suggested_price DECIMAL(10, 2),
  is_promoted       BOOLEAN NOT NULL DEFAULT false,
  promoted_until    TIMESTAMPTZ,
  view_count        INTEGER NOT NULL DEFAULT 0,
  search_vector     TSVECTOR,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ DEFAULT (now() + INTERVAL '30 days'),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Search vector auto-update trigger
CREATE OR REPLACE FUNCTION bazaar_listings_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bazaar_listings_search_vector ON bazaar_listings;
CREATE TRIGGER trg_bazaar_listings_search_vector
  BEFORE INSERT OR UPDATE OF title, description ON bazaar_listings
  FOR EACH ROW
  EXECUTE FUNCTION bazaar_listings_search_vector_update();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bazaar_listings_campus_category
  ON bazaar_listings(campus_id, category) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_bazaar_listings_seller
  ON bazaar_listings(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bazaar_listings_search
  ON bazaar_listings USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_bazaar_listings_status
  ON bazaar_listings(status);
CREATE INDEX IF NOT EXISTS idx_bazaar_listings_expires
  ON bazaar_listings(expires_at) WHERE status = 'active';

-- ━━━ Listing Views (Append-Only) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS listing_views (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  UUID NOT NULL REFERENCES bazaar_listings(id) ON DELETE CASCADE,
  viewer_id   UUID REFERENCES users(id),
  ip_hash     VARCHAR(64) NOT NULL,
  viewed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_views_listing
  ON listing_views(listing_id, viewed_at DESC);

-- Append-only: revoke destructive operations
DO $$ BEGIN
  REVOKE UPDATE, DELETE ON listing_views FROM nexus_app;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ━━━ Listing Saves ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS listing_saves (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  UUID NOT NULL REFERENCES bazaar_listings(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(listing_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_listing_saves_user
  ON listing_saves(user_id, created_at DESC);

-- ━━━ Listing Offers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS listing_offers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  UUID NOT NULL REFERENCES bazaar_listings(id) ON DELETE CASCADE,
  buyer_id    UUID NOT NULL REFERENCES users(id),
  amount      DECIMAL(10, 2) NOT NULL CHECK (amount > 0),
  message     TEXT,
  status      offer_status NOT NULL DEFAULT 'pending',
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_offers_listing
  ON listing_offers(listing_id, status);
CREATE INDEX IF NOT EXISTS idx_listing_offers_buyer
  ON listing_offers(buyer_id, status);

-- ━━━ Bazaar Transactions ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS bazaar_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID NOT NULL REFERENCES transactions(id),
  listing_id      UUID NOT NULL REFERENCES bazaar_listings(id),
  buyer_id        UUID NOT NULL REFERENCES users(id),
  seller_id       UUID NOT NULL REFERENCES users(id),
  final_price     DECIMAL(10, 2) NOT NULL,
  platform_fee    DECIMAL(10, 2) NOT NULL,
  seller_amount   DECIMAL(10, 2) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bazaar_transactions_buyer
  ON bazaar_transactions(buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bazaar_transactions_seller
  ON bazaar_transactions(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bazaar_transactions_listing
  ON bazaar_transactions(listing_id);
