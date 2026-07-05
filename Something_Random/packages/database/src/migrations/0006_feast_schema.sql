-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 0006: Feast (Food Ordering) Schema
-- NEXUS Campus Super-App — Phase 2B
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$ BEGIN
  CREATE TYPE feast_order_status AS ENUM (
    'pending_payment', 'payment_held', 'preparing',
    'ready', 'picked_up', 'delivered', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE delivery_type AS ENUM ('pickup', 'delivery');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE customization_type AS ENUM ('single', 'multi');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ━━━ Canteens ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS canteens (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id             UUID NOT NULL REFERENCES campuses(id),
  name                  VARCHAR(100) NOT NULL,
  description           TEXT,
  location_label        VARCHAR(100),
  operating_hours       JSONB NOT NULL DEFAULT '{}'::jsonb,
  avg_prep_time_minutes INTEGER NOT NULL DEFAULT 15,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  image_url             TEXT,
  owner_user_id         UUID NOT NULL REFERENCES users(id),
  fssai_license_no      VARCHAR(50),
  fssai_verified        BOOLEAN NOT NULL DEFAULT false,
  fssai_expires_at      DATE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canteens_campus ON canteens(campus_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_canteens_owner ON canteens(owner_user_id);

-- ━━━ Menu Items ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS menu_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canteen_id        UUID NOT NULL REFERENCES canteens(id) ON DELETE CASCADE,
  name              VARCHAR(150) NOT NULL,
  description       TEXT,
  category          VARCHAR(50),
  price             DECIMAL(8, 2) NOT NULL CHECK (price > 0),
  is_available      BOOLEAN NOT NULL DEFAULT true,
  is_veg            BOOLEAN NOT NULL,
  image_url         TEXT,
  prep_time_minutes INTEGER,
  calories          INTEGER,
  allergens         JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menu_items_canteen ON menu_items(canteen_id) WHERE is_available = true;

-- ━━━ Menu Customizations ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS menu_customizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id  UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name          VARCHAR(100) NOT NULL,
  type          customization_type NOT NULL,
  is_required   BOOLEAN NOT NULL DEFAULT false,
  options       JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_menu_customizations_item ON menu_customizations(menu_item_id);

-- ━━━ Feast Orders ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS feast_orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id              UUID NOT NULL REFERENCES users(id),
  canteen_id            UUID NOT NULL REFERENCES canteens(id),
  transaction_id        UUID REFERENCES transactions(id),
  items                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal              DECIMAL(10, 2) NOT NULL,
  platform_fee          DECIMAL(10, 2) NOT NULL,
  total                 DECIMAL(10, 2) NOT NULL,
  delivery_type         delivery_type NOT NULL DEFAULT 'pickup',
  delivery_location     VARCHAR(200),
  special_instructions  TEXT,
  status                feast_order_status NOT NULL DEFAULT 'pending_payment',
  estimated_ready_at    TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feast_orders_buyer ON feast_orders(buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feast_orders_canteen ON feast_orders(canteen_id, status, created_at DESC);

-- ━━━ Order Items ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS order_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES feast_orders(id) ON DELETE CASCADE,
  menu_item_id    UUID NOT NULL REFERENCES menu_items(id),
  quantity        SMALLINT NOT NULL CHECK (quantity > 0),
  unit_price      DECIMAL(8, 2) NOT NULL,
  customizations  JSONB NOT NULL DEFAULT '[]'::jsonb,
  item_total      DECIMAL(8, 2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- ━━━ Canteen Ratings ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS canteen_ratings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL UNIQUE REFERENCES feast_orders(id),
  rater_id    UUID NOT NULL REFERENCES users(id),
  canteen_id  UUID NOT NULL REFERENCES canteens(id),
  score       SMALLINT NOT NULL CHECK (score >= 1 AND score <= 5),
  review_text TEXT,
  is_flagged  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canteen_ratings_canteen ON canteen_ratings(canteen_id, created_at DESC);
