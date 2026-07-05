-- ============================================================================
-- NEXUS RIDE & GO — Complete Backend Migration
-- Version: 002
-- Description: Creates all tables for fleet management, curator shifts,
--              admin dashboard, saved places, rewards, incidents, and payments.
-- ============================================================================

BEGIN;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- CUSTOM ENUM TYPES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$ BEGIN
    CREATE TYPE vehicle_status AS ENUM ('active', 'maintenance', 'retired', 'deployed', 'decommissioned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE service_type AS ENUM ('routine', 'repair', 'inspection', 'emergency', 'recall');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE shift_status AS ENUM ('active', 'completed', 'abandoned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE badge_type AS ENUM (
        'speed_star', 'safety_hero', 'top_earner', 'ride_master',
        'campus_legend', 'night_owl', 'early_bird', 'perfect_week',
        'century_rides', 'thousand_rides', 'five_star_streak',
        'zero_cancellation', 'community_builder', 'weather_warrior'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE incident_type AS ENUM (
        'accident', 'harassment', 'vehicle_damage', 'route_deviation',
        'fare_dispute', 'lost_item', 'unsafe_driving', 'intoxication',
        'unauthorized_stop', 'other'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE incident_severity AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE incident_status AS ENUM ('open', 'investigating', 'resolved', 'escalated', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE reward_tier AS ENUM ('bronze', 'silver', 'gold', 'platinum', 'diamond');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE reward_tx_type AS ENUM ('earned', 'redeemed', 'expired', 'bonus', 'penalty', 'refund');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE reward_source AS ENUM (
        'ride_completed', 'referral', 'streak_bonus', 'milestone',
        'challenge', 'rating_bonus', 'first_ride', 'pool_ride',
        'off_peak', 'feedback', 'manual_admin'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE payment_method_type AS ENUM ('upi', 'card', 'wallet', 'cod', 'nexus_credits');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE payment_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'refunded', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE collab_ride_status AS ENUM ('open', 'full', 'matched', 'completed', 'cancelled', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE luggage_size AS ENUM ('none', 'small', 'medium', 'large');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- FLEET MANAGEMENT
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS vehicles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_number VARCHAR(20) NOT NULL UNIQUE,
    vehicle_type        vehicle_type NOT NULL DEFAULT 'car',
    make                VARCHAR(100) NOT NULL,
    model               VARCHAR(100) NOT NULL,
    color               VARCHAR(50) NOT NULL,
    year                INTEGER NOT NULL CHECK (year >= 1990 AND year <= 2100),
    campus_id           UUID NOT NULL,
    assigned_driver_id  UUID REFERENCES drivers(id) ON DELETE SET NULL,
    status              vehicle_status NOT NULL DEFAULT 'active',
    skin_id             UUID,
    mileage_km          NUMERIC(10,2) NOT NULL DEFAULT 0,
    fuel_type           VARCHAR(30) NOT NULL DEFAULT 'petrol',
    seating_capacity    INTEGER NOT NULL DEFAULT 4 CHECK (seating_capacity >= 1 AND seating_capacity <= 50),
    insurance_expiry    DATE,
    permit_expiry       DATE,
    last_service_at     TIMESTAMPTZ,
    next_service_due    TIMESTAMPTZ,
    location            geography(Point, 4326),
    vin_number          VARCHAR(50),
    qr_code             VARCHAR(255),
    features            JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicles_campus ON vehicles(campus_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);
CREATE INDEX IF NOT EXISTS idx_vehicles_driver ON vehicles(assigned_driver_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_location ON vehicles USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_vehicles_service_due ON vehicles(next_service_due) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS vehicle_service_logs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id        UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    service_type      service_type NOT NULL,
    description       TEXT NOT NULL,
    parts_replaced    TEXT[],
    mileage_at_service NUMERIC(10,2),
    cost              NUMERIC(10,2) NOT NULL DEFAULT 0,
    performed_by      VARCHAR(255),
    workshop_name     VARCHAR(255),
    invoice_url       VARCHAR(500),
    started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at      TIMESTAMPTZ,
    next_service_due  TIMESTAMPTZ,
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vsl_vehicle ON vehicle_service_logs(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vsl_type ON vehicle_service_logs(service_type);
CREATE INDEX IF NOT EXISTS idx_vsl_date ON vehicle_service_logs(started_at DESC);

CREATE TABLE IF NOT EXISTS vehicle_telemetry (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id      UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    battery_pct     SMALLINT CHECK (battery_pct >= 0 AND battery_pct <= 100),
    fuel_pct        SMALLINT CHECK (fuel_pct >= 0 AND fuel_pct <= 100),
    speed_kmh       NUMERIC(6,2),
    engine_temp_c   NUMERIC(5,1),
    tire_pressure   JSONB,                      -- {"fl": 32, "fr": 32, "rl": 30, "rr": 30}
    odometer_km     NUMERIC(10,2),
    location        geography(Point, 4326),
    heading         NUMERIC(5,2),               -- degrees 0-360
    altitude_m      NUMERIC(8,2),
    diagnostics     JSONB NOT NULL DEFAULT '{}', -- OBD-II codes, sensor data
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vt_vehicle ON vehicle_telemetry(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vt_time ON vehicle_telemetry(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_vt_location ON vehicle_telemetry USING GIST(location);
-- Partition hint: for production, partition by recorded_at (monthly)

CREATE TABLE IF NOT EXISTS vehicle_skins (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    image_url   VARCHAR(500),
    wrap_type   VARCHAR(50) NOT NULL DEFAULT 'full',
    campus_id   UUID,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deployment_zones (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campus_id       UUID NOT NULL,
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    boundary        geography(Polygon, 4326) NOT NULL,
    center          geography(Point, 4326),
    priority        INTEGER NOT NULL DEFAULT 1 CHECK (priority >= 1 AND priority <= 10),
    target_vehicles INTEGER NOT NULL DEFAULT 0,
    max_vehicles    INTEGER NOT NULL DEFAULT 50,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    operating_hours JSONB,  -- {"start": "06:00", "end": "23:00", "days": [1,2,3,4,5]}
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dz_campus ON deployment_zones(campus_id);
CREATE INDEX IF NOT EXISTS idx_dz_boundary ON deployment_zones USING GIST(boundary);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- CURATOR SHIFTS & ANALYTICS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS curator_shifts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id           UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    campus_id           UUID NOT NULL,
    status              shift_status NOT NULL DEFAULT 'active',
    started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at            TIMESTAMPTZ,
    start_location      geography(Point, 4326),
    end_location        geography(Point, 4326),
    total_rides         INTEGER NOT NULL DEFAULT 0,
    total_earnings      NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_distance_km   NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_online_min    NUMERIC(10,2) NOT NULL DEFAULT 0,
    avg_rating          NUMERIC(3,2),
    cancellations       INTEGER NOT NULL DEFAULT 0,
    peak_hours_worked   INTEGER NOT NULL DEFAULT 0,
    breaks_taken        INTEGER NOT NULL DEFAULT 0,
    break_duration_min  NUMERIC(8,2) NOT NULL DEFAULT 0,
    notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_shifts_driver ON curator_shifts(driver_id);
CREATE INDEX IF NOT EXISTS idx_shifts_campus ON curator_shifts(campus_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON curator_shifts(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_shifts_started ON curator_shifts(started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_active_driver ON curator_shifts(driver_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS performance_badges (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id   UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    badge_type  badge_type NOT NULL,
    title       VARCHAR(100) NOT NULL,
    description TEXT,
    icon_url    VARCHAR(500),
    tier        INTEGER NOT NULL DEFAULT 1 CHECK (tier >= 1 AND tier <= 5),
    metadata    JSONB NOT NULL DEFAULT '{}',
    earned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(driver_id, badge_type, tier)
);

CREATE INDEX IF NOT EXISTS idx_badges_driver ON performance_badges(driver_id);

CREATE TABLE IF NOT EXISTS curator_settings (
    driver_id               UUID PRIMARY KEY REFERENCES drivers(id) ON DELETE CASCADE,
    auto_accept_enabled     BOOLEAN NOT NULL DEFAULT false,
    max_pickup_radius_m     INTEGER NOT NULL DEFAULT 2000 CHECK (max_pickup_radius_m >= 100 AND max_pickup_radius_m <= 10000),
    preferred_vehicle_types TEXT[] NOT NULL DEFAULT ARRAY['car', 'motorcycle', 'bicycle'],
    preferred_ride_types    TEXT[] NOT NULL DEFAULT ARRAY['solo', 'pool'],
    notification_sound      VARCHAR(50) NOT NULL DEFAULT 'default',
    quiet_hours_enabled     BOOLEAN NOT NULL DEFAULT false,
    quiet_hours_start       TIME,
    quiet_hours_end         TIME,
    language                VARCHAR(10) NOT NULL DEFAULT 'en',
    accept_women_only       BOOLEAN NOT NULL DEFAULT false,
    max_passengers          INTEGER NOT NULL DEFAULT 4 CHECK (max_passengers >= 1 AND max_passengers <= 8),
    accept_luggage          luggage_size NOT NULL DEFAULT 'medium',
    navigation_app          VARCHAR(30) NOT NULL DEFAULT 'google_maps',
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- ADMIN DASHBOARD & AUDIT
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id        UUID NOT NULL,
    actor_role      VARCHAR(50) NOT NULL,
    action          VARCHAR(100) NOT NULL,
    resource_type   VARCHAR(50) NOT NULL,
    resource_id     VARCHAR(255),
    campus_id       UUID,
    details         JSONB NOT NULL DEFAULT '{}',
    ip_address      INET,
    user_agent      TEXT,
    request_id      VARCHAR(100),
    duration_ms     INTEGER,
    status_code     INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_campus ON audit_logs(campus_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at DESC);
-- For production: partition by created_at (monthly), add retention policy

CREATE TABLE IF NOT EXISTS demand_heatmap_cache (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campus_id   UUID NOT NULL,
    cell_lat    NUMERIC(9,6) NOT NULL,
    cell_lng    NUMERIC(9,6) NOT NULL,
    cell_size   NUMERIC(6,4) NOT NULL DEFAULT 0.005, -- ~500m grid
    demand_score    NUMERIC(8,4) NOT NULL DEFAULT 0,
    supply_score    NUMERIC(8,4) NOT NULL DEFAULT 0,
    surge_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.00,
    ride_count      INTEGER NOT NULL DEFAULT 0,
    time_bucket     TIMESTAMPTZ NOT NULL,
    prediction      BOOLEAN NOT NULL DEFAULT false,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_heatmap_campus ON demand_heatmap_cache(campus_id);
CREATE INDEX IF NOT EXISTS idx_heatmap_time ON demand_heatmap_cache(time_bucket DESC);
CREATE INDEX IF NOT EXISTS idx_heatmap_cell ON demand_heatmap_cache(campus_id, cell_lat, cell_lng, time_bucket);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SAVED PLACES & RIDE PREFERENCES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS saved_places (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL,
    label       VARCHAR(50) NOT NULL DEFAULT 'custom',  -- home, work, campus, gym, etc.
    name        VARCHAR(255) NOT NULL,
    address     TEXT,
    location    geography(Point, 4326) NOT NULL,
    icon        VARCHAR(50) NOT NULL DEFAULT 'pin',
    use_count   INTEGER NOT NULL DEFAULT 0,
    last_used   TIMESTAMPTZ,
    is_favorite BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sp_user ON saved_places(user_id);
CREATE INDEX IF NOT EXISTS idx_sp_user_label ON saved_places(user_id, label);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sp_user_name ON saved_places(user_id, name);

CREATE TABLE IF NOT EXISTS ride_preferences (
    user_id                 UUID PRIMARY KEY,
    default_ride_type       VARCHAR(10) NOT NULL DEFAULT 'solo',
    preferred_payment       payment_method_type NOT NULL DEFAULT 'upi',
    luggage_size            luggage_size NOT NULL DEFAULT 'none',
    accessibility_needs     JSONB NOT NULL DEFAULT '{}',
    auto_tip_percent        NUMERIC(4,2) NOT NULL DEFAULT 0 CHECK (auto_tip_percent >= 0 AND auto_tip_percent <= 50),
    quiet_ride              BOOLEAN NOT NULL DEFAULT false,
    music_preference        VARCHAR(50) NOT NULL DEFAULT 'driver_choice',
    temperature_preference  VARCHAR(20) NOT NULL DEFAULT 'normal',
    conversation_mode       VARCHAR(20) NOT NULL DEFAULT 'friendly',   -- friendly, quiet, professional
    women_only_ride         BOOLEAN NOT NULL DEFAULT false,
    share_eta               BOOLEAN NOT NULL DEFAULT true,
    auto_share_contacts     UUID[],                                     -- emergency contact user IDs
    preferred_route         VARCHAR(20) NOT NULL DEFAULT 'fastest',     -- fastest, shortest, safest
    max_pool_passengers     INTEGER NOT NULL DEFAULT 3,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- COLLABORATIVE RIDES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS collab_rides (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id          UUID NOT NULL,
    campus_id           UUID NOT NULL,
    pickup_location     geography(Point, 4326) NOT NULL,
    pickup_label        VARCHAR(255) NOT NULL,
    dropoff_location    geography(Point, 4326) NOT NULL,
    dropoff_label       VARCHAR(255) NOT NULL,
    scheduled_at        TIMESTAMPTZ NOT NULL,
    max_riders          INTEGER NOT NULL DEFAULT 4 CHECK (max_riders >= 2 AND max_riders <= 8),
    current_riders      INTEGER NOT NULL DEFAULT 1,
    status              collab_ride_status NOT NULL DEFAULT 'open',
    ride_request_id     UUID REFERENCES ride_requests(id),
    note                TEXT,
    recurrence          JSONB,  -- {"days": [1,2,3,4,5], "until": "2026-12-31"}
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collab_campus ON collab_rides(campus_id);
CREATE INDEX IF NOT EXISTS idx_collab_status ON collab_rides(status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_collab_scheduled ON collab_rides(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_collab_creator ON collab_rides(creator_id);
CREATE INDEX IF NOT EXISTS idx_collab_pickup ON collab_rides USING GIST(pickup_location);

CREATE TABLE IF NOT EXISTS collab_ride_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collab_ride_id  UUID NOT NULL REFERENCES collab_rides(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'joined', -- joined, confirmed, left, no_show
    pickup_location geography(Point, 4326),
    pickup_label    VARCHAR(255),
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(collab_ride_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_ride ON collab_ride_members(collab_ride_id);
CREATE INDEX IF NOT EXISTS idx_crm_user ON collab_ride_members(user_id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- REWARDS & LOYALTY
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS reward_balances (
    user_id         UUID PRIMARY KEY,
    points          INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
    tier            reward_tier NOT NULL DEFAULT 'bronze',
    lifetime_points INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_points >= 0),
    current_streak  INTEGER NOT NULL DEFAULT 0,
    longest_streak  INTEGER NOT NULL DEFAULT 0,
    last_ride_date  DATE,
    referral_code   VARCHAR(20) UNIQUE,
    referred_by     UUID,
    total_referrals INTEGER NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reward_transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    points          INTEGER NOT NULL,                   -- positive=earn, negative=redeem
    type            reward_tx_type NOT NULL,
    source          reward_source NOT NULL,
    reference_id    UUID,                               -- ride_id, referral_id, etc.
    description     TEXT,
    balance_after   INTEGER NOT NULL,
    multiplier      NUMERIC(4,2) NOT NULL DEFAULT 1.00, -- streak/tier multiplier applied
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rt_user ON reward_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_rt_type ON reward_transactions(type);
CREATE INDEX IF NOT EXISTS idx_rt_time ON reward_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rt_expiry ON reward_transactions(expires_at) WHERE expires_at IS NOT NULL AND type = 'earned';

CREATE TABLE IF NOT EXISTS reward_challenges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           VARCHAR(255) NOT NULL,
    description     TEXT NOT NULL,
    icon_url        VARCHAR(500),
    challenge_type  VARCHAR(50) NOT NULL,       -- ride_count, spend_amount, streak, referral, time_based
    target_value    INTEGER NOT NULL,
    reward_points   INTEGER NOT NULL,
    campus_id       UUID,                       -- NULL = global
    tier_required   reward_tier,                -- NULL = any tier
    starts_at       TIMESTAMPTZ NOT NULL,
    ends_at         TIMESTAMPTZ NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    max_completions INTEGER,                    -- NULL = unlimited
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rc_active ON reward_challenges(is_active, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_rc_campus ON reward_challenges(campus_id);

CREATE TABLE IF NOT EXISTS reward_challenge_progress (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    challenge_id    UUID NOT NULL REFERENCES reward_challenges(id) ON DELETE CASCADE,
    current_value   INTEGER NOT NULL DEFAULT 0,
    completed       BOOLEAN NOT NULL DEFAULT false,
    claimed         BOOLEAN NOT NULL DEFAULT false,
    completed_at    TIMESTAMPTZ,
    claimed_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, challenge_id)
);

CREATE INDEX IF NOT EXISTS idx_rcp_user ON reward_challenge_progress(user_id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- INCIDENTS & SAFETY
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS incidents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id         UUID REFERENCES ride_requests(id),
    campus_id       UUID NOT NULL,
    reported_by     UUID NOT NULL,
    reported_role   VARCHAR(20) NOT NULL DEFAULT 'rider', -- rider, curator, admin, system
    type            incident_type NOT NULL,
    severity        incident_severity NOT NULL DEFAULT 'medium',
    title           VARCHAR(255) NOT NULL,
    description     TEXT NOT NULL,
    status          incident_status NOT NULL DEFAULT 'open',
    assigned_to     UUID,
    location        geography(Point, 4326),
    evidence_urls   TEXT[],
    witness_ids     UUID[],
    resolution_note TEXT,
    resolution_type VARCHAR(50),        -- warning, suspension, ban, refund, apology, no_action
    resolved_at     TIMESTAMPTZ,
    resolved_by     UUID,
    escalated_at    TIMESTAMPTZ,
    escalated_to    UUID,
    sla_deadline    TIMESTAMPTZ,        -- based on severity
    tags            TEXT[],
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inc_campus ON incidents(campus_id);
CREATE INDEX IF NOT EXISTS idx_inc_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_inc_severity ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_inc_ride ON incidents(ride_id);
CREATE INDEX IF NOT EXISTS idx_inc_reporter ON incidents(reported_by);
CREATE INDEX IF NOT EXISTS idx_inc_assigned ON incidents(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inc_time ON incidents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inc_sla ON incidents(sla_deadline) WHERE status IN ('open', 'investigating');

CREATE TABLE IF NOT EXISTS safety_protocols (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campus_id       UUID,               -- NULL = global
    title           VARCHAR(255) NOT NULL,
    description     TEXT NOT NULL,
    category        VARCHAR(50) NOT NULL, -- general, emergency, weather, night, vehicle, campus
    priority        INTEGER NOT NULL DEFAULT 1,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    effective_from  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_until TIMESTAMPTZ,
    version         INTEGER NOT NULL DEFAULT 1,
    approved_by     UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sp_proto_campus ON safety_protocols(campus_id);
CREATE INDEX IF NOT EXISTS idx_sp_proto_active ON safety_protocols(is_active, category);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PAYMENT METHODS & TRANSACTIONS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS payment_methods (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    type            payment_method_type NOT NULL,
    label           VARCHAR(100) NOT NULL,      -- "HDFC Debit ****1234", "PhonePe UPI"
    provider        VARCHAR(50),                -- razorpay, phonepe, paytm, googlepay
    token           VARCHAR(500),               -- encrypted payment token/VPA
    is_default      BOOLEAN NOT NULL DEFAULT false,
    is_verified     BOOLEAN NOT NULL DEFAULT false,
    metadata        JSONB NOT NULL DEFAULT '{}', -- card_last4, upi_vpa, etc.
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pm_user ON payment_methods(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pm_default ON payment_methods(user_id) WHERE is_default = true;

CREATE TABLE IF NOT EXISTS ride_payments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id             UUID NOT NULL REFERENCES ride_requests(id),
    payer_id            UUID NOT NULL,
    payment_method_id   UUID REFERENCES payment_methods(id),
    amount              NUMERIC(10,2) NOT NULL,
    currency            VARCHAR(3) NOT NULL DEFAULT 'INR',
    status              payment_status NOT NULL DEFAULT 'pending',
    gateway_order_id    VARCHAR(255),           -- Razorpay order ID
    gateway_payment_id  VARCHAR(255),           -- Razorpay payment ID
    gateway_signature   VARCHAR(500),           -- verification signature
    tip_amount          NUMERIC(10,2) NOT NULL DEFAULT 0,
    discount_amount     NUMERIC(10,2) NOT NULL DEFAULT 0,
    reward_points_used  INTEGER NOT NULL DEFAULT 0,
    fare_breakdown      JSONB NOT NULL DEFAULT '{}', -- {base, per_km, surge, night, discount, tip, total}
    refund_amount       NUMERIC(10,2),
    refund_reason       TEXT,
    idempotency_key     VARCHAR(255) UNIQUE,
    paid_at             TIMESTAMPTZ,
    refunded_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rp_ride ON ride_payments(ride_id);
CREATE INDEX IF NOT EXISTS idx_rp_payer ON ride_payments(payer_id);
CREATE INDEX IF NOT EXISTS idx_rp_status ON ride_payments(status);
CREATE INDEX IF NOT EXISTS idx_rp_gateway ON ride_payments(gateway_order_id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SURGE PRICING
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS surge_zones (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campus_id       UUID NOT NULL,
    zone_name       VARCHAR(100) NOT NULL,
    boundary        geography(Polygon, 4326) NOT NULL,
    multiplier      NUMERIC(4,2) NOT NULL DEFAULT 1.00 CHECK (multiplier >= 1.00 AND multiplier <= 5.00),
    reason          VARCHAR(100),                   -- event, weather, peak_hour, high_demand
    active_from     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    active_until    TIMESTAMPTZ,
    auto_computed   BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sz_campus ON surge_zones(campus_id);
CREATE INDEX IF NOT EXISTS idx_sz_active ON surge_zones(active_from, active_until);
CREATE INDEX IF NOT EXISTS idx_sz_boundary ON surge_zones USING GIST(boundary);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TRIGGERS & FUNCTIONS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ 
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY[
        'vehicles', 'deployment_zones', 'saved_places',
        'ride_preferences', 'incidents', 'safety_protocols',
        'payment_methods', 'ride_payments', 'curator_settings'
    ])
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS set_updated_at ON %I; CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();',
            tbl, tbl
        );
    END LOOP;
END $$;

-- Auto-compute reward tier from lifetime points
CREATE OR REPLACE FUNCTION compute_reward_tier(lifetime INTEGER)
RETURNS reward_tier AS $$
BEGIN
    IF lifetime >= 50000 THEN RETURN 'diamond';
    ELSIF lifetime >= 20000 THEN RETURN 'platinum';
    ELSIF lifetime >= 8000 THEN RETURN 'gold';
    ELSIF lifetime >= 3000 THEN RETURN 'silver';
    ELSE RETURN 'bronze';
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- SLA deadline computation based on incident severity
CREATE OR REPLACE FUNCTION compute_sla_deadline(sev incident_severity)
RETURNS INTERVAL AS $$
BEGIN
    CASE sev
        WHEN 'critical' THEN RETURN INTERVAL '30 minutes';
        WHEN 'high' THEN RETURN INTERVAL '2 hours';
        WHEN 'medium' THEN RETURN INTERVAL '24 hours';
        WHEN 'low' THEN RETURN INTERVAL '72 hours';
    END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Auto-set SLA deadline on incident creation
CREATE OR REPLACE FUNCTION trigger_set_incident_sla()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.sla_deadline IS NULL THEN
        NEW.sla_deadline = NEW.created_at + compute_sla_deadline(NEW.severity);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_incident_sla ON incidents;
CREATE TRIGGER set_incident_sla
    BEFORE INSERT ON incidents
    FOR EACH ROW EXECUTE FUNCTION trigger_set_incident_sla();

COMMIT;
