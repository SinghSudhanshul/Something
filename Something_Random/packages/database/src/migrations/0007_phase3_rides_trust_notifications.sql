-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- NEXUS Phase 3 — Rides, Trust, Notifications, Analytics Schema Migration
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- ═══════════════════════════════════════════════════════════════════
-- RIDES DOMAIN
-- ═══════════════════════════════════════════════════════════════════

-- Vehicle type enum
DO $$ BEGIN
  CREATE TYPE vehicle_type AS ENUM ('bicycle', 'motorcycle', 'car');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Ride type enum
DO $$ BEGIN
  CREATE TYPE ride_type AS ENUM ('solo', 'pool');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Ride status enum
DO $$ BEGIN
  CREATE TYPE ride_status AS ENUM ('open', 'matching', 'matched', 'in_progress', 'completed', 'cancelled', 'expired');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Pool participant status
DO $$ BEGIN
  CREATE TYPE pool_participant_status AS ENUM ('pending', 'confirmed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Document type
DO $$ BEGIN
  CREATE TYPE doc_type AS ENUM ('license', 'rc_book', 'insurance');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Verification status
DO $$ BEGIN
  CREATE TYPE verification_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ── Drivers ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campus_id UUID NOT NULL,
  license_number VARCHAR(30) NOT NULL,
  vehicle_type vehicle_type NOT NULL,
  vehicle_number VARCHAR(15),
  vehicle_color VARCHAR(30),
  is_verified BOOLEAN DEFAULT false,
  is_available BOOLEAN DEFAULT false,
  is_women_only BOOLEAN DEFAULT false,
  location geography(POINT, 4326),
  last_location_at TIMESTAMPTZ,
  total_rides INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ── Ride Requests ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ride_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES users(id),
  campus_id UUID NOT NULL,
  pickup_location geography(POINT, 4326) NOT NULL,
  pickup_label VARCHAR(200) NOT NULL,
  dropoff_location geography(POINT, 4326) NOT NULL,
  dropoff_label VARCHAR(200) NOT NULL,
  ride_type ride_type NOT NULL DEFAULT 'solo',
  is_women_only BOOLEAN DEFAULT false,
  passenger_count SMALLINT DEFAULT 1 CHECK (passenger_count BETWEEN 1 AND 4),
  estimated_fare DECIMAL(8,2),
  status ride_status DEFAULT 'open',
  driver_id UUID REFERENCES drivers(id),
  matched_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  transaction_id UUID,
  scheduled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '15 minutes')
);

-- ── Pool Participants ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pool_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_request_id UUID NOT NULL REFERENCES ride_requests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  pickup_location geography(POINT, 4326),
  pickup_label VARCHAR(200),
  fare_share DECIMAL(8,2),
  status pool_participant_status DEFAULT 'pending',
  joined_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Ride Route Log (append-only) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS ride_route_log (
  id BIGSERIAL PRIMARY KEY,
  ride_request_id UUID NOT NULL REFERENCES ride_requests(id),
  driver_id UUID NOT NULL REFERENCES drivers(id),
  location geography(POINT, 4326) NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Driver Verifications ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  document_type doc_type NOT NULL,
  document_s3_key TEXT,
  textract_result JSONB,
  verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  status verification_status DEFAULT 'pending',
  reviewed_by UUID
);

-- ── SOS Alerts ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sos_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_request_id UUID NOT NULL REFERENCES ride_requests(id),
  triggered_by UUID NOT NULL REFERENCES users(id),
  location geography(POINT, 4326),
  campus_security_notified BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Spatial Indexes ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_drivers_location ON drivers USING GIST(location) WHERE is_available = true;
CREATE INDEX IF NOT EXISTS idx_ride_requests_campus ON ride_requests(campus_id, status) WHERE status IN ('open', 'matching');
CREATE INDEX IF NOT EXISTS idx_ride_requests_pickup ON ride_requests USING GIST(pickup_location) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_ride_route_log_ride ON ride_route_log(ride_request_id, recorded_at DESC);

-- ═══════════════════════════════════════════════════════════════════
-- TRUST DOMAIN
-- ═══════════════════════════════════════════════════════════════════

-- ── Trust Score Events (append-only log) ─────────────────────────
CREATE TABLE IF NOT EXISTS trust_score_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  event_type VARCHAR(100) NOT NULL,
  delta DECIMAL(5,3) NOT NULL,
  reason TEXT NOT NULL,
  reference_id UUID,
  reference_type VARCHAR(50),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trust_events_user ON trust_score_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trust_events_type ON trust_score_events(event_type, created_at DESC);

-- ── Fraud Flags ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fraud_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  transaction_id UUID,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  action VARCHAR(50) NOT NULL,
  features JSONB DEFAULT '{}',
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_flags_user ON fraud_flags(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_flags_active ON fraud_flags(user_id) WHERE resolved_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════
-- NOTIFICATIONS DOMAIN
-- ═══════════════════════════════════════════════════════════════════

-- Platform enum
DO $$ BEGIN
  CREATE TYPE push_platform AS ENUM ('ios', 'android', 'web');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Notification channel
DO $$ BEGIN
  CREATE TYPE notification_channel AS ENUM ('push', 'sms', 'email', 'in_app');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Notification status
DO $$ BEGIN
  CREATE TYPE notification_status AS ENUM ('queued', 'sent', 'delivered', 'failed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ── Notification Preferences ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  push_enabled BOOLEAN DEFAULT true,
  sms_enabled BOOLEAN DEFAULT true,
  email_enabled BOOLEAN DEFAULT true,
  quiet_hours_start TIME DEFAULT '23:00',
  quiet_hours_end TIME DEFAULT '07:00',
  per_module_preferences JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ── Push Tokens ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform push_platform NOT NULL,
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id, is_active);

-- ── Notification Log ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  type VARCHAR(100) NOT NULL,
  channel notification_channel NOT NULL,
  title VARCHAR(300),
  body TEXT,
  status notification_status DEFAULT 'queued',
  provider_message_id VARCHAR(100),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_log_user ON notification_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_log_status ON notification_log(status, created_at DESC);

-- ── In-App Notifications ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS in_app_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(100) NOT NULL,
  title VARCHAR(300) NOT NULL,
  body TEXT NOT NULL,
  action_url TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_in_app_inbox ON in_app_notifications(user_id, is_read, created_at DESC);
