-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 0008: Pulse (Events/Tickets/Clubs) Schema — PostgreSQL financial tables
-- NEXUS Campus Super-App — Phase 2D
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$ BEGIN
  CREATE TYPE ticket_status AS ENUM ('reserved', 'confirmed', 'used', 'refunded');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE club_member_role AS ENUM ('member', 'officer', 'lead');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ━━━ Event Tickets (Financial — ACID guaranteed) ━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS event_tickets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        VARCHAR(24) NOT NULL,
  buyer_id        UUID NOT NULL REFERENCES users(id),
  transaction_id  UUID REFERENCES transactions(id),
  ticket_type_id  VARCHAR(100) NOT NULL,
  quantity        SMALLINT NOT NULL CHECK (quantity > 0),
  total_paid      DECIMAL(10, 2) NOT NULL,
  status          ticket_status NOT NULL DEFAULT 'reserved',
  qr_code_hash    VARCHAR(64) NOT NULL UNIQUE,
  checked_in_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_tickets_event ON event_tickets(event_id);
CREATE INDEX IF NOT EXISTS idx_event_tickets_buyer ON event_tickets(buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_tickets_qr ON event_tickets(qr_code_hash);

-- ━━━ Club Memberships ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS club_memberships (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id   VARCHAR(24) NOT NULL,
  user_id   UUID NOT NULL REFERENCES users(id),
  role      club_member_role NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at   TIMESTAMPTZ,
  UNIQUE(club_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_club_memberships_club ON club_memberships(club_id);
CREATE INDEX IF NOT EXISTS idx_club_memberships_user ON club_memberships(user_id);
