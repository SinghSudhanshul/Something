-- Phase 3A: Rides Schema
-- All location columns use geography(POINT, 4326) for Earth-curvature-correct distance calculations
-- Requires PostGIS extension

CREATE EXTENSION IF NOT EXISTS postgis;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Enums
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$ BEGIN
  CREATE TYPE vehicle_type AS ENUM ('bicycle', 'motorcycle', 'car');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ride_type AS ENUM ('solo', 'pool');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ride_request_status AS ENUM ('open', 'matching', 'matched', 'in_progress', 'completed', 'cancelled', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE pool_participant_status AS ENUM ('pending', 'confirmed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE driver_doc_type AS ENUM ('license', 'rc_book', 'insurance');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE driver_doc_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Drivers
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  campus_id UUID NOT NULL REFERENCES campuses(id),
  license_number VARCHAR(30) NOT NULL,
  vehicle_type vehicle_type NOT NULL,
  vehicle_number VARCHAR(15),
  vehicle_color VARCHAR(30),
  is_verified BOOLEAN NOT NULL DEFAULT false,
  is_available BOOLEAN NOT NULL DEFAULT false,
  is_women_only BOOLEAN NOT NULL DEFAULT false,
  location geography(POINT, 4326),
  last_location_at TIMESTAMPTZ,
  total_rides INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Ride Requests
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS ride_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES users(id),
  campus_id UUID NOT NULL REFERENCES campuses(id),
  pickup_location geography(POINT, 4326) NOT NULL,
  pickup_label VARCHAR(200) NOT NULL,
  dropoff_location geography(POINT, 4326) NOT NULL,
  dropoff_label VARCHAR(200) NOT NULL,
  ride_type ride_type NOT NULL DEFAULT 'solo',
  is_women_only BOOLEAN NOT NULL DEFAULT false,
  passenger_count SMALLINT NOT NULL DEFAULT 1 CHECK (passenger_count >= 1 AND passenger_count <= 4),
  estimated_fare DECIMAL(8,2),
  status ride_request_status NOT NULL DEFAULT 'open',
  driver_id UUID REFERENCES drivers(id),
  matched_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  transaction_id UUID REFERENCES transactions(id),
  scheduled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes')
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Pool Participants
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS pool_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_request_id UUID NOT NULL REFERENCES ride_requests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  pickup_location geography(POINT, 4326),
  pickup_label VARCHAR(200),
  fare_share DECIMAL(8,2),
  status pool_participant_status NOT NULL DEFAULT 'pending',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Ride Route Log (append-only, partitioned)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS ride_route_log (
  id BIGSERIAL,
  ride_request_id UUID NOT NULL,
  driver_id UUID NOT NULL,
  location geography(POINT, 4326) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

-- Create default partition for current and next month
CREATE TABLE IF NOT EXISTS ride_route_log_default PARTITION OF ride_route_log DEFAULT;

-- Revoke UPDATE/DELETE for append-only semantics (graceful — do not error if role missing)
DO $$ BEGIN
  REVOKE UPDATE, DELETE ON ride_route_log FROM nexus_app;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Driver Verifications
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS driver_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  document_type driver_doc_type NOT NULL,
  document_s3_key TEXT,
  textract_result JSONB,
  verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  status driver_doc_status NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES users(id)
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SOS Alerts
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS sos_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_request_id UUID NOT NULL REFERENCES ride_requests(id),
  triggered_by UUID NOT NULL REFERENCES users(id),
  location geography(POINT, 4326) NOT NULL,
  campus_security_notified BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Spatial Indexes
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE INDEX IF NOT EXISTS idx_drivers_location ON drivers USING GIST(location) WHERE is_available = true;
CREATE INDEX IF NOT EXISTS idx_drivers_campus ON drivers(campus_id);
CREATE INDEX IF NOT EXISTS idx_drivers_user ON drivers(user_id);
CREATE INDEX IF NOT EXISTS idx_ride_requests_campus ON ride_requests(campus_id, status) WHERE status IN ('open', 'matching');
CREATE INDEX IF NOT EXISTS idx_ride_requests_pickup ON ride_requests USING GIST(pickup_location) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_ride_requests_requester ON ride_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_ride_requests_driver ON ride_requests(driver_id);
CREATE INDEX IF NOT EXISTS idx_pool_participants_ride ON pool_participants(ride_request_id);
CREATE INDEX IF NOT EXISTS idx_sos_alerts_ride ON sos_alerts(ride_request_id);
CREATE INDEX IF NOT EXISTS idx_sos_alerts_active ON sos_alerts(created_at) WHERE resolved_at IS NULL;
