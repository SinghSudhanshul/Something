-- ============================================================================
-- NEXUS RIDE & GO — Phase 1: Complete Production Database Schema
-- Version: 003
-- Description: Uber-grade ride-hailing backend with real payments, dispatch,
--              safety, ratings, fraud detection, corporate accounts, and
--              full audit trail. Drop-in replacement / extension for 002.
-- ============================================================================

BEGIN;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- EXTENSIONS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- ENUM TYPES — Ride & Go core domain
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DO $$ BEGIN CREATE TYPE ride_status AS ENUM (
    'requested','searching','driver_assigned','driver_enroute',
    'driver_arrived','in_progress','completed','cancelled',
    'no_show','rejected','failed','refunded','disputed'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE ride_type AS ENUM (
    'economy','comfort','premium','xl','pool','auto','bike','lux',
    'accessible','pet_friendly','women_only','scheduled','rental',
    'outstation','cargo'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE ride_payment_status AS ENUM (
    'unpaid','authorized','captured','refunded','partial_refund',
    'disputed','voided','chargeback'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE cancellation_reason AS ENUM (
    'user_request','driver_request','no_drivers','driver_no_show',
    'user_no_show','system_timeout','payment_failed','safety_concern',
    'vehicle_issue','wrong_pickup','fraud_detected','admin_cancel',
    'weather','other'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE cancellation_actor AS ENUM (
    'rider','driver','system','admin','payment_gateway'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE payment_method_kind AS ENUM (
    'upi','credit_card','debit_card','wallet','cod','nexus_credits',
    'corporate','net_banking','pay_later'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE payment_tx_type AS ENUM (
    'ride_fare','tip','cancellation_fee','toll','surge_share',
    'pool_discount','promo_discount','refund','payout','topup',
    'adjustment','tax','platform_fee','driver_incentive',
    'corporate_billing','cash_collection','cash_deposit'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE payment_tx_status AS ENUM (
    'pending','processing','succeeded','failed','reversed',
    'cancelled','on_hold','disputed'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE driver_status AS ENUM (
    'offline','available','enroute_to_pickup','at_pickup',
    'in_trip','on_break','unavailable','suspended','deactivated'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE driver_document_type AS ENUM (
    'drivers_license','pan_card','aadhaar','vehicle_rc',
    'vehicle_insurance','vehicle_puc','vehicle_fitness',
    'police_verification','medical_certificate','photo',
    'vehicle_photo','address_proof','bank_account','profile_photo',
    'selfie_with_id','video_kyc'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE document_status AS ENUM (
    'pending','submitted','under_review','approved','rejected',
    'expired','resubmit_required'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE kyc_status AS ENUM (
    'incomplete','in_progress','approved','rejected','suspended',
    'manual_review'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE vehicle_kind AS ENUM (
    'sedan','suv','hatchback','mini','auto_rickshaw','bike',
    'scooter','tempo','van','premium','luxury','electric_car',
    'cargo_truck','ev_scooter'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE fuel_kind AS ENUM (
    'petrol','diesel','cng','electric','hybrid','lpg'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE promo_kind AS ENUM (
    'percent_off','flat_off','cashback','free_ride','first_ride',
    'referral','loyalty','corporate','peak_off','surge_kill',
    'lounge_access','priority_pickup'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE promo_status AS ENUM (
    'active','paused','expired','exhausted','archived'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE promo_redemption_status AS ENUM (
    'reserved','applied','refunded','expired','cancelled'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE ticket_status AS ENUM (
    'open','awaiting_rider','awaiting_driver','investigating',
    'resolved','rejected','escalated','closed'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE ticket_category AS ENUM (
    'lost_item','payment_issue','overcharge','rude_behavior',
    'unsafe_driving','wrong_route','vehicle_condition',
    'app_issue','account_issue','refund_request','cancellation',
    'promo_issue','safety_incident','fraud_report','other'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE ticket_priority AS ENUM (
    'low','normal','high','urgent','critical'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE safety_event_type AS ENUM (
    'sos_triggered','route_deviation','speed_violation',
    'harsh_braking','harsh_acceleration','hard_cornering',
    'unauthorized_stop','long_idle','accident_detected',
    'phone_usage','geofence_breach','curfew_breach',
    'panic_word','silent_sos','fake_ride','impersonation',
    'driver_emergency','rider_emergency'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE safety_event_severity AS ENUM (
    'info','warning','high','critical'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE safety_event_status AS ENUM (
    'open','acknowledged','responded','resolved','false_positive'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE notification_kind AS ENUM (
    'ride_assigned','driver_arriving','driver_arrived','ride_started',
    'ride_completed','ride_cancelled','payment_succeeded',
    'payment_failed','promo','reward_earned','rating_reminder',
    'kyc_update','document_expiring','payout_processed',
    'safety_alert','marketing','system','support_reply',
    'ride_request','ride_offer','fleet_update','shift_reminder',
    'training_assigned','reward_tier_change','invite','referral'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE notification_channel AS ENUM (
    'push','sms','email','in_app','whatsapp'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE notification_status AS ENUM (
    'queued','sent','delivered','read','failed','cancelled'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE payout_status AS ENUM (
    'pending','queued','processing','paid','failed','on_hold',
    'reversed','disputed'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE chat_msg_status AS ENUM (
    'sent','delivered','read','failed'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE dispute_status AS ENUM (
    'opened','under_review','evidence_required','won','lost',
    'withdrawn','closed'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE fraud_alert_status AS ENUM (
    'open','investigating','confirmed','dismissed','escalated','closed'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE corporate_billing_status AS ENUM (
    'draft','issued','partially_paid','paid','overdue','cancelled'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE scheduled_ride_status AS ENUM (
    'pending','dispatching','driver_assigned','cancelled',
    'expired','completed'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE surge_state AS ENUM (
    'low','normal','medium','high','very_high','extreme'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE telemetry_source AS ENUM (
    'driver_app','rider_app','admin_panel','third_party_obd',
    'gps_device','simulated'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE audit_entity AS ENUM (
    'ride','driver','rider','vehicle','payment','promo','payout',
    'kyc','safety_event','ticket','admin','fleet','dispatch_zone',
    'surge_rule','corporate_account','dispute','rating',
    'shift','reward','notification','config','integration','api_key'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE integration_provider AS ENUM (
    'razorpay','stripe','payu','phonepe','gpay','bhim',
    'twilio','msg91','aws_sns','firebase','mapbox','google_maps',
    'ola_maps','rto_api','digilocker','truecaller','aws_s3',
    'sendgrid','ses','razorpayx','cashfree','sila'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE emergency_contact_relation AS ENUM (
    'spouse','parent','sibling','child','friend','colleague',
    'partner','guardian','other'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE ride_share_link_status AS ENUM (
    'active','expired','revoked'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE vehicle_inspection_status AS ENUM (
    'scheduled','in_progress','passed','failed','needs_repair'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- REFERENCE: COUNTRIES, STATES, CITIES, CAMPUSES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS countries (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    iso2         CHAR(2) NOT NULL UNIQUE,
    iso3         CHAR(3) NOT NULL UNIQUE,
    name         VARCHAR(100) NOT NULL,
    dial_code    VARCHAR(10) NOT NULL,
    currency     CHAR(3) NOT NULL,
    timezone     VARCHAR(50) NOT NULL DEFAULT 'UTC',
    is_active    BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campuses (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name           VARCHAR(200) NOT NULL,
    short_code     VARCHAR(20) NOT NULL UNIQUE,
    city           VARCHAR(120) NOT NULL,
    state          VARCHAR(120) NOT NULL,
    country_id     UUID NOT NULL REFERENCES countries(id),
    center_point   GEOGRAPHY(POINT, 4326) NOT NULL,
    service_radius_km NUMERIC(8,2) NOT NULL DEFAULT 50.0,
    timezone       VARCHAR(50) NOT NULL,
    is_active      BOOLEAN NOT NULL DEFAULT true,
    settings       JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_campuses_geo ON campuses USING GIST(center_point);
CREATE INDEX IF NOT EXISTS idx_campuses_active ON campuses(is_active) WHERE is_active = true;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- RIDERS (passengers)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS riders (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              UUID NOT NULL UNIQUE,             -- FK to users service
    phone                VARCHAR(20) NOT NULL UNIQUE,
    email                VARCHAR(255) UNIQUE,
    full_name            VARCHAR(200) NOT NULL,
    display_name         VARCHAR(80),
    avatar_url           TEXT,
    date_of_birth        DATE,
    gender               VARCHAR(20),
    preferred_language   VARCHAR(10) NOT NULL DEFAULT 'en',
    rating_avg           NUMERIC(3,2) NOT NULL DEFAULT 5.00,
    rating_count         INTEGER NOT NULL DEFAULT 0,
    lifetime_rides       INTEGER NOT NULL DEFAULT 0,
    lifetime_spend_cents BIGINT  NOT NULL DEFAULT 0,
    loyalty_tier         VARCHAR(20) NOT NULL DEFAULT 'bronze',
    loyalty_points       BIGINT  NOT NULL DEFAULT 0,
    campus_id            UUID REFERENCES campuses(id),
    home_address         JSONB,
    work_address         JSONB,
    default_payment_method_id UUID,
    is_verified          BOOLEAN NOT NULL DEFAULT false,
    is_blocked           BOOLEAN NOT NULL DEFAULT false,
    block_reason         TEXT,
    referred_by          UUID REFERENCES riders(id),
    referral_code        VARCHAR(20) UNIQUE,
    fcm_token            TEXT,
    apns_token           TEXT,
    web_push_sub         JSONB,
    last_active_at       TIMESTAMPTZ,
    last_known_location  GEOGRAPHY(POINT, 4326),
    metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_riders_user ON riders(user_id);
CREATE INDEX IF NOT EXISTS idx_riders_phone ON riders(phone);
CREATE INDEX IF NOT EXISTS idx_riders_campus ON riders(campus_id);
CREATE INDEX IF NOT EXISTS idx_riders_blocked ON riders(is_blocked) WHERE is_blocked = true;
CREATE INDEX IF NOT EXISTS idx_riders_location ON riders USING GIST(last_known_location);
CREATE INDEX IF NOT EXISTS idx_riders_referral ON riders(referral_code);

CREATE TABLE IF NOT EXISTS rider_emergency_contacts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id        UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
    full_name       VARCHAR(200) NOT NULL,
    phone           VARCHAR(20) NOT NULL,
    email           VARCHAR(255),
    relation        emergency_contact_relation NOT NULL DEFAULT 'other',
    is_auto_share   BOOLEAN NOT NULL DEFAULT true,
    last_notified_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rider_ec_rider ON rider_emergency_contacts(rider_id);

CREATE TABLE IF NOT EXISTS rider_payment_methods (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id              UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
    method_kind           payment_method_kind NOT NULL,
    provider              VARCHAR(50),                       -- e.g. 'razorpay','stripe'
    provider_token        TEXT,                              -- vault token
    display_label         VARCHAR(120) NOT NULL,             -- 'HDFC •••• 4242'
    masked_account        VARCHAR(40),                       -- '4242'
    card_brand            VARCHAR(20),                       -- visa,mastercard
    card_expiry_month     INTEGER,
    card_expiry_year      INTEGER,
    cardholder_name       VARCHAR(200),
    upi_handle            VARCHAR(120),                      -- user@bank
    bank_name             VARCHAR(120),
    wallet_provider       VARCHAR(50),
    wallet_balance_cents  BIGINT,
    is_default            BOOLEAN NOT NULL DEFAULT false,
    is_verified           BOOLEAN NOT NULL DEFAULT false,
    verification_payload  JSONB,
    billing_address       JSONB,
    metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_used_at          TIMESTAMPTZ,
    expires_at            TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rpm_rider ON rider_payment_methods(rider_id);
CREATE INDEX IF NOT EXISTS idx_rpm_default ON rider_payment_methods(rider_id) WHERE is_default = true;

CREATE TABLE IF NOT EXISTS rider_saved_places (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id        UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
    label           VARCHAR(80) NOT NULL,         -- 'Home','Work','Gym'
    icon            VARCHAR(40) DEFAULT 'place',
    address_line    TEXT NOT NULL,
    landmark        TEXT,
    city            VARCHAR(120),
    state           VARCHAR(120),
    postal_code     VARCHAR(20),
    country         VARCHAR(80),
    lat             NUMERIC(10,7) NOT NULL,
    lng             NUMERIC(10,7) NOT NULL,
    geo             GEOGRAPHY(POINT, 4326) NOT NULL,
    place_id        VARCHAR(120),                 -- google/mapbox place id
    usage_count     INTEGER NOT NULL DEFAULT 0,
    last_used_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rsp_rider ON rider_saved_places(rider_id);
CREATE INDEX IF NOT EXISTS idx_rsp_geo ON rider_saved_places USING GIST(geo);

CREATE TABLE IF NOT EXISTS rider_preferences (
    rider_id                  UUID PRIMARY KEY REFERENCES riders(id) ON DELETE CASCADE,
    preferred_ride_type       ride_type DEFAULT 'comfort',
    music_preference          VARCHAR(40) DEFAULT 'no_preference',
    temperature_pref_c        NUMERIC(4,1),
    conversation_pref         VARCHAR(20) DEFAULT 'no_preference',
    accessibility_needs       JSONB NOT NULL DEFAULT '[]'::jsonb,
    avoid_tolls               BOOLEAN NOT NULL DEFAULT false,
    avoid_highways            BOOLEAN NOT NULL DEFAULT false,
    share_trip_automatically  BOOLEAN NOT NULL DEFAULT false,
    auto_apply_promo          BOOLEAN NOT NULL DEFAULT true,
    default_tip_pct           INTEGER NOT NULL DEFAULT 10,
    pet_friendly_only         BOOLEAN NOT NULL DEFAULT false,
    women_only_pref           BOOLEAN NOT NULL DEFAULT false,
    language                  VARCHAR(10) DEFAULT 'en',
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- DRIVERS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS drivers (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  UUID NOT NULL UNIQUE,
    phone                    VARCHAR(20) NOT NULL UNIQUE,
    email                    VARCHAR(255) UNIQUE,
    full_name                VARCHAR(200) NOT NULL,
    display_name             VARCHAR(80),
    avatar_url               TEXT,
    date_of_birth            DATE,
    gender                   VARCHAR(20),
    blood_group              VARCHAR(5),
    pan_number               VARCHAR(20) UNIQUE,
    aadhaar_number_hash      VARCHAR(255),                 -- hashed for storage
    pan_verified             BOOLEAN NOT NULL DEFAULT false,
    aadhaar_verified         BOOLEAN NOT NULL DEFAULT false,
    permanent_address        JSONB,
    current_address          JSONB,
    current_location         GEOGRAPHY(POINT, 4326),
    location_accuracy_m      NUMERIC(8,2),
    heading_deg              NUMERIC(5,2),
    speed_kph                NUMERIC(6,2),
    status                   driver_status NOT NULL DEFAULT 'offline',
    last_status_change_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    rating_avg               NUMERIC(3,2) NOT NULL DEFAULT 5.00,
    rating_count             INTEGER NOT NULL DEFAULT 0,
    acceptance_rate          NUMERIC(5,4) NOT NULL DEFAULT 1.0,
    cancellation_rate        NUMERIC(5,4) NOT NULL DEFAULT 0.0,
    completion_rate          NUMERIC(5,4) NOT NULL DEFAULT 1.0,
    lifetime_trips           INTEGER NOT NULL DEFAULT 0,
    lifetime_distance_km     NUMERIC(14,2) NOT NULL DEFAULT 0,
    lifetime_earnings_cents  BIGINT  NOT NULL DEFAULT 0,
    lifetime_online_hours    NUMERIC(12,2) NOT NULL DEFAULT 0,
    weekly_target_cents      BIGINT  NOT NULL DEFAULT 0,
    weekly_progress_cents    BIGINT  NOT NULL DEFAULT 0,
    consecutive_trip_streak  INTEGER NOT NULL DEFAULT 0,
    loyalty_tier             VARCHAR(20) NOT NULL DEFAULT 'bronze',
    loyalty_points           BIGINT  NOT NULL DEFAULT 0,
    languages                TEXT[] NOT NULL DEFAULT ARRAY['en'],
    is_verified              BOOLEAN NOT NULL DEFAULT false,
    kyc_status               kyc_status NOT NULL DEFAULT 'incomplete',
    kyc_completed_at         TIMESTAMPTZ,
    background_check_status  VARCHAR(20) NOT NULL DEFAULT 'pending',
    background_check_at      TIMESTAMPTZ,
    is_blocked               BOOLEAN NOT NULL DEFAULT false,
    block_reason             TEXT,
    is_in_training           BOOLEAN NOT NULL DEFAULT false,
    campus_id                UUID REFERENCES campuses(id),
    primary_vehicle_id       UUID,
    default_payout_method_id UUID,
    referral_code            VARCHAR(20) UNIQUE,
    referred_by              UUID REFERENCES drivers(id),
    fcm_token                TEXT,
    apns_token               TEXT,
    last_active_at           TIMESTAMPTZ,
    metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at               TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_drivers_user ON drivers(user_id);
CREATE INDEX IF NOT EXISTS idx_drivers_phone ON drivers(phone);
CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(status);
CREATE INDEX IF NOT EXISTS idx_drivers_campus ON drivers(campus_id);
CREATE INDEX IF NOT EXISTS idx_drivers_geo ON drivers USING GIST(current_location);
CREATE INDEX IF NOT EXISTS idx_drivers_kyc ON drivers(kyc_status);
CREATE INDEX IF NOT EXISTS idx_drivers_blocked ON drivers(is_blocked) WHERE is_blocked = true;
CREATE INDEX IF NOT EXISTS idx_drivers_online ON drivers(status, campus_id) WHERE status IN ('available','enroute_to_pickup','at_pickup','in_trip');

CREATE TABLE IF NOT EXISTS driver_documents (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id          UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    document_type      driver_document_type NOT NULL,
    document_number    VARCHAR(120),
    document_url       TEXT,                              -- s3 presigned view
    thumbnail_url      TEXT,
    file_mime          VARCHAR(80),
    file_size_bytes    BIGINT,
    file_hash_sha256   VARCHAR(128),
    issued_at          DATE,
    expires_at         DATE,
    state              VARCHAR(80),                       -- issuing state/country
    verification_status document_status NOT NULL DEFAULT 'pending',
    verified_at        TIMESTAMPTZ,
    verified_by        UUID,                              -- admin user id
    rejection_reason   TEXT,
    ocr_payload        JSONB,                              -- extracted data
    digilocker_ref     VARCHAR(120),
    metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(driver_id, document_type)
);
CREATE INDEX IF NOT EXISTS idx_dd_driver ON driver_documents(driver_id);
CREATE INDEX IF NOT EXISTS idx_dd_status ON driver_documents(verification_status);
CREATE INDEX IF NOT EXISTS idx_dd_expiry ON driver_documents(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS driver_payout_methods (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id          UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    kind               VARCHAR(20) NOT NULL,              -- bank, upi, paypal, wallet
    bank_name          VARCHAR(120),
    account_holder     VARCHAR(200),
    account_number_enc BYTEA,                              -- encrypted
    ifsc_code          VARCHAR(20),
    upi_handle         VARCHAR(120),
    paypal_email       VARCHAR(255),
    provider           VARCHAR(50),                       -- razorpayx
    provider_account_id TEXT,
    is_default         BOOLEAN NOT NULL DEFAULT false,
    is_verified        BOOLEAN NOT NULL DEFAULT false,
    verified_at        TIMESTAMPTZ,
    metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dpm_driver ON driver_payout_methods(driver_id);

CREATE TABLE IF NOT EXISTS driver_emergency_contacts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id    UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    full_name    VARCHAR(200) NOT NULL,
    phone        VARCHAR(20) NOT NULL,
    relation     emergency_contact_relation NOT NULL DEFAULT 'other',
    is_auto_share BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS driver_vehicles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id           UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    vehicle_kind        vehicle_kind NOT NULL,
    registration_number VARCHAR(20) NOT NULL UNIQUE,
    make                VARCHAR(100) NOT NULL,
    model               VARCHAR(100) NOT NULL,
    variant             VARCHAR(100),
    year                INTEGER NOT NULL CHECK (year >= 1990),
    color               VARCHAR(50) NOT NULL,
    fuel_type           fuel_kind NOT NULL DEFAULT 'petrol',
    seats               INTEGER NOT NULL DEFAULT 4,
    luggage_capacity    INTEGER NOT NULL DEFAULT 2,
    ac_available        BOOLEAN NOT NULL DEFAULT true,
    insurance_policy_no VARCHAR(120),
    insurance_expires_at DATE,
    puc_expires_at      DATE,
    fitness_expires_at  DATE,
    permit_state        VARCHAR(80),
    rc_owner_name       VARCHAR(200),
    rc_verified         BOOLEAN NOT NULL DEFAULT false,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    is_primary          BOOLEAN NOT NULL DEFAULT false,
    assigned_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    photo_url           TEXT,
    interior_photo_url  TEXT,
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dv_driver ON driver_vehicles(driver_id);
CREATE INDEX IF NOT EXISTS idx_dv_active ON driver_vehicles(is_active) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS driver_locations_history (
    id            BIGSERIAL PRIMARY KEY,
    driver_id     UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    point         GEOGRAPHY(POINT, 4326) NOT NULL,
    accuracy_m    NUMERIC(8,2),
    heading_deg   NUMERIC(5,2),
    speed_kph     NUMERIC(6,2),
    battery_pct   INTEGER,
    network       VARCHAR(20),
    is_mock       BOOLEAN NOT NULL DEFAULT false,
    recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dlh_driver_time ON driver_locations_history(driver_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_dlh_point ON driver_locations_history USING GIST(point);

CREATE TABLE IF NOT EXISTS driver_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id       UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    session_token   VARCHAR(255) NOT NULL UNIQUE,
    device_id       VARCHAR(120),
    device_model    VARCHAR(120),
    os_version      VARCHAR(40),
    app_version     VARCHAR(40),
    ip_address      INET,
    user_agent      TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at        TIMESTAMPTZ,
    end_reason      VARCHAR(40),
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_dsession_driver ON driver_sessions(driver_id);

CREATE TABLE IF NOT EXISTS driver_breaks (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id    UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at     TIMESTAMPTZ,
    reason       VARCHAR(80),
    point        GEOGRAPHY(POINT, 4326),
    metadata     JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_dbreak_driver_open ON driver_breaks(driver_id) WHERE ended_at IS NULL;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- RIDES — core
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS rides (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_code               VARCHAR(12) NOT NULL UNIQUE,         -- short human code
    rider_id                UUID NOT NULL REFERENCES riders(id),
    driver_id               UUID REFERENCES drivers(id),
    vehicle_id              UUID REFERENCES driver_vehicles(id),
    ride_type               ride_type NOT NULL,
    status                  ride_status NOT NULL DEFAULT 'requested',
    campus_id               UUID REFERENCES campuses(id),

    -- Pickup
    pickup_address          TEXT NOT NULL,
    pickup_lat              NUMERIC(10,7) NOT NULL,
    pickup_lng              NUMERIC(10,7) NOT NULL,
    pickup_point            GEOGRAPHY(POINT, 4326) NOT NULL,
    pickup_landmark         TEXT,
    pickup_place_id         VARCHAR(120),
    pickup_floor            VARCHAR(20),
    pickup_unit             VARCHAR(40),

    -- Dropoff
    dropoff_address         TEXT NOT NULL,
    dropoff_lat             NUMERIC(10,7) NOT NULL,
    dropoff_lng             NUMERIC(10,7) NOT NULL,
    dropoff_point           GEOGRAPHY(POINT, 4326) NOT NULL,
    dropoff_landmark        TEXT,
    dropoff_place_id        VARCHAR(120),
    dropoff_floor           VARCHAR(20),
    dropoff_unit            VARCHAR(40),

    -- Stops (multi-stop)
    stops                   JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Fare
    currency                CHAR(3) NOT NULL,
    base_fare_cents         BIGINT NOT NULL DEFAULT 0,
    distance_fare_cents     BIGINT NOT NULL DEFAULT 0,
    time_fare_cents         BIGINT NOT NULL DEFAULT 0,
    surge_amount_cents      BIGINT NOT NULL DEFAULT 0,
    surge_multiplier        NUMERIC(4,2) NOT NULL DEFAULT 1.0,
    toll_cents              BIGINT NOT NULL DEFAULT 0,
    tax_cents               BIGINT NOT NULL DEFAULT 0,
    platform_fee_cents      BIGINT NOT NULL DEFAULT 0,
    tip_cents               BIGINT NOT NULL DEFAULT 0,
    discount_cents          BIGINT NOT NULL DEFAULT 0,
    promo_discount_cents    BIGINT NOT NULL DEFAULT 0,
    pool_discount_cents     BIGINT NOT NULL DEFAULT 0,
    total_fare_cents        BIGINT NOT NULL DEFAULT 0,
    rider_paid_cents        BIGINT NOT NULL DEFAULT 0,
    driver_earnings_cents   BIGINT NOT NULL DEFAULT 0,
    estimated_fare_min_cents BIGINT NOT NULL DEFAULT 0,
    estimated_fare_max_cents BIGINT NOT NULL DEFAULT 0,

    -- Distance & duration (planned and actual)
    estimated_distance_km   NUMERIC(10,2),
    estimated_duration_s    INTEGER,
    actual_distance_km      NUMERIC(10,2),
    actual_duration_s       INTEGER,

    -- Route
    polyline_encoded        TEXT,                                -- google polyline
    route_steps             JSONB NOT NULL DEFAULT '[]'::jsonb,
    route_alternatives      JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Payment
    payment_method_id       UUID REFERENCES rider_payment_methods(id),
    payment_status          ride_payment_status NOT NULL DEFAULT 'unpaid',
    payment_authorized_at   TIMESTAMPTZ,
    payment_captured_at     TIMESTAMPTZ,
    payment_refunded_at     TIMESTAMPTZ,
    payment_hold_id         VARCHAR(120),
    payment_intent_id       VARCHAR(120),

    -- Promo
    promo_code              VARCHAR(40),
    promo_redemption_id     UUID,

    -- Status timestamps
    requested_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    searching_started_at    TIMESTAMPTZ,
    driver_assigned_at      TIMESTAMPTZ,
    driver_enroute_at       TIMESTAMPTZ,
    driver_arrived_at       TIMESTAMPTZ,
    in_progress_at          TIMESTAMPTZ,
    completed_at            TIMESTAMPTZ,
    cancelled_at            TIMESTAMPTZ,
    no_show_at              TIMESTAMPTZ,

    -- Cancellation
    cancellation_reason     cancellation_reason,
    cancellation_actor      cancellation_actor,
    cancellation_note       TEXT,
    cancellation_fee_cents  BIGINT NOT NULL DEFAULT 0,

    -- Driver metrics
    driver_rating           INTEGER CHECK (driver_rating BETWEEN 1 AND 5),
    driver_rating_tags      TEXT[],
    driver_rating_comment   TEXT,
    driver_rated_at         TIMESTAMPTZ,

    -- Rider rating
    rider_rating            INTEGER CHECK (rider_rating BETWEEN 1 AND 5),
    rider_rating_tags       TEXT[],
    rider_rating_comment    TEXT,
    rider_rated_at          TIMESTAMPTZ,

    -- Special
    is_scheduled            BOOLEAN NOT NULL DEFAULT false,
    scheduled_for           TIMESTAMPTZ,
    is_pool                 BOOLEAN NOT NULL DEFAULT false,
    pool_id                 UUID,
    is_corporate            BOOLEAN NOT NULL DEFAULT false,
    corporate_account_id    UUID,
    is_accessibility        BOOLEAN NOT NULL DEFAULT false,
    is_pet_friendly         BOOLEAN NOT NULL DEFAULT false,
    is_women_only           BOOLEAN NOT NULL DEFAULT false,
    accessibility_needs     JSONB NOT NULL DEFAULT '[]'::jsonb,
    pet_count               INTEGER NOT NULL DEFAULT 0,
    luggage_count           INTEGER NOT NULL DEFAULT 0,
    luggage_size            VARCHAR(20),
    passenger_count         INTEGER NOT NULL DEFAULT 1,

    -- Surge & demand
    surge_zone_id           UUID,
    demand_score            NUMERIC(5,2),
    supply_score            NUMERIC(5,2),
    wait_time_s             INTEGER,
    match_score             NUMERIC(5,4),

    -- Sharing
    share_token             VARCHAR(64) UNIQUE,
    share_expires_at        TIMESTAMPTZ,

    -- Metadata
    driver_offer_count      INTEGER NOT NULL DEFAULT 0,
    search_radius_km        NUMERIC(6,2),
    re_dispatched_count     INTEGER NOT NULL DEFAULT 0,
    rider_app_version       VARCHAR(40),
    driver_app_version      VARCHAR(40),
    source                  VARCHAR(40) DEFAULT 'rider_app',
    metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Optimistic locking
    version                 INTEGER NOT NULL DEFAULT 0,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at              TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_rides_rider ON rides(rider_id);
CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id);
CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);
CREATE INDEX IF NOT EXISTS idx_rides_requested_at ON rides(requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_rides_completed_at ON rides(completed_at DESC) WHERE completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rides_campus ON rides(campus_id);
CREATE INDEX IF NOT EXISTS idx_rides_pool ON rides(pool_id) WHERE is_pool = true;
CREATE INDEX IF NOT EXISTS idx_rides_scheduled ON rides(scheduled_for) WHERE is_scheduled = true;
CREATE INDEX IF NOT EXISTS idx_rides_share ON rides(share_token) WHERE share_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rides_payment_status ON rides(payment_status);
CREATE INDEX IF NOT EXISTS idx_rides_corporate ON rides(corporate_account_id) WHERE is_corporate = true;

-- Pool rides: groups multiple rider requests under a single driver trip
CREATE TABLE IF NOT EXISTS ride_pools (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id            UUID REFERENCES drivers(id),
    vehicle_id           UUID REFERENCES driver_vehicles(id),
    status               VARCHAR(20) NOT NULL DEFAULT 'open',
    max_seats            INTEGER NOT NULL DEFAULT 4,
    discount_pct         NUMERIC(5,2) NOT NULL DEFAULT 20.0,
    pickup_zone_id       UUID,
    dropoff_zone_id      UUID,
    pickup_point         GEOGRAPHY(POINT, 4326),
    dropoff_point        GEOGRAPHY(POINT, 4326),
    scheduled_started_at TIMESTAMPTZ,
    actual_started_at    TIMESTAMPTZ,
    completed_at         TIMESTAMPTZ,
    total_distance_km    NUMERIC(10,2),
    total_actual_fare_cents BIGINT NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rp_driver ON ride_pools(driver_id);
CREATE INDEX IF NOT EXISTS idx_rp_status ON ride_pools(status);

-- Ride stops (multi-destination) — materialised for queryability
CREATE TABLE IF NOT EXISTS ride_stops (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id         UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    stop_order      INTEGER NOT NULL,
    address         TEXT NOT NULL,
    lat             NUMERIC(10,7) NOT NULL,
    lng             NUMERIC(10,7) NOT NULL,
    point           GEOGRAPHY(POINT, 4326) NOT NULL,
    arrived_at      TIMESTAMPTZ,
    departed_at     TIMESTAMPTZ,
    wait_minutes    INTEGER,
    notes           TEXT,
    UNIQUE(ride_id, stop_order)
);
CREATE INDEX IF NOT EXISTS idx_ride_stops_ride ON ride_stops(ride_id);

-- Tracks driver offer attempts
CREATE TABLE IF NOT EXISTS ride_offers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id             UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    driver_id           UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    offer_score         NUMERIC(5,4) NOT NULL,
    offered_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at          TIMESTAMPTZ NOT NULL,
    responded_at        TIMESTAMPTZ,
    response            VARCHAR(20),              -- 'accepted','declined','expired','timed_out'
    response_payload    JSONB,
    decline_reason      VARCHAR(40),
    distance_to_pickup_km NUMERIC(8,2),
    eta_to_pickup_s     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ro_ride ON ride_offers(ride_id);
CREATE INDEX IF NOT EXISTS idx_ro_driver ON ride_offers(driver_id);
CREATE INDEX IF NOT EXISTS idx_ro_pending ON ride_offers(expires_at) WHERE response IS NULL;

-- Telemetry breadcrumbs of the trip (one row per second per ride)
CREATE TABLE IF NOT EXISTS ride_tracking_points (
    id           BIGSERIAL PRIMARY KEY,
    ride_id      UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    driver_id    UUID REFERENCES drivers(id),
    point        GEOGRAPHY(POINT, 4326) NOT NULL,
    bearing_deg  NUMERIC(5,2),
    speed_kph    NUMERIC(6,2),
    accuracy_m   NUMERIC(8,2),
    phase        VARCHAR(30) NOT NULL,                 -- pickup, enroute, dropoff
    battery_pct  INTEGER,
    distance_so_far_km NUMERIC(10,3),
    duration_so_far_s  INTEGER,
    recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rtp_ride ON ride_tracking_points(ride_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_rtp_geo ON ride_tracking_points USING GIST(point);

-- Driver/rider ratings (one row per submission)
CREATE TABLE IF NOT EXISTS ride_ratings (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id       UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    rater_id      UUID NOT NULL,
    rater_role    VARCHAR(20) NOT NULL,                -- 'rider','driver'
    ratee_id      UUID NOT NULL,
    ratee_role    VARCHAR(20) NOT NULL,
    rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    tags          TEXT[],
    comment       TEXT,
    is_public     BOOLEAN NOT NULL DEFAULT true,
    category_breakdown JSONB,                            -- cleanliness, navigation, etc.
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(ride_id, rater_role)
);
CREATE INDEX IF NOT EXISTS idx_rr_ratee ON ride_ratings(ratee_id);
CREATE INDEX IF NOT EXISTS idx_rr_ride ON ride_ratings(ride_id);

-- Reasons
CREATE TABLE IF NOT EXISTS ride_cancellation_log (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id              UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    cancelled_by         UUID NOT NULL,
    actor_role           cancellation_actor NOT NULL,
    reason               cancellation_reason NOT NULL,
    note                 TEXT,
    fee_charged_cents    BIGINT NOT NULL DEFAULT 0,
    refund_issued_cents  BIGINT NOT NULL DEFAULT 0,
    cancelled_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reusable share tokens for live trip sharing
CREATE TABLE IF NOT EXISTS ride_share_links (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id      UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    token        VARCHAR(64) NOT NULL UNIQUE,
    created_by   UUID NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at   TIMESTAMPTZ,
    status       ride_share_link_status NOT NULL DEFAULT 'active',
    view_count   INTEGER NOT NULL DEFAULT 0,
    last_viewed_at TIMESTAMPTZ,
    shared_with  JSONB,                                -- array of {phone,email}
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rsl_ride ON ride_share_links(ride_id);
CREATE INDEX IF NOT EXISTS idx_rsl_token ON ride_share_links(token);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PAYMENTS, LEDGER, WALLETS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Method of payment chosen for a ride (snapshot)
CREATE TABLE IF NOT EXISTS payments (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id               UUID NOT NULL REFERENCES rides(id) ON DELETE RESTRICT,
    rider_id              UUID NOT NULL REFERENCES riders(id),
    driver_id             UUID REFERENCES drivers(id),
    method_kind           payment_method_kind NOT NULL,
    status                payment_tx_status NOT NULL DEFAULT 'pending',
    amount_cents          BIGINT NOT NULL,
    currency              CHAR(3) NOT NULL,
    provider              VARCHAR(50),                  -- razorpay,stripe,phonepe
    provider_payment_id   VARCHAR(120),
    provider_order_id     VARCHAR(120),
    provider_signature    VARCHAR(255),
    provider_payload      JSONB,
    vpa                   VARCHAR(120),                 -- UPI handle
    card_last4            VARCHAR(4),
    card_brand            VARCHAR(20),
    card_issuer           VARCHAR(80),
    card_issuer_country   CHAR(2),
    emi_plan_id           VARCHAR(120),
    emi_amount_cents      BIGINT,
    tip_cents             BIGINT NOT NULL DEFAULT 0,
    tax_cents             BIGINT NOT NULL DEFAULT 0,
    platform_fee_cents    BIGINT NOT NULL DEFAULT 0,
    refund_cents          BIGINT NOT NULL DEFAULT 0,
    refunded_at           TIMESTAMPTZ,
    refund_reason         TEXT,
    refund_provider_id    VARCHAR(120),
    failure_code          VARCHAR(40),
    failure_message       TEXT,
    attempt_count         INTEGER NOT NULL DEFAULT 0,
    next_retry_at         TIMESTAMPTZ,
    captured_at           TIMESTAMPTZ,
    authorized_at         TIMESTAMPTZ,
    expires_at            TIMESTAMPTZ,
    risk_score            NUMERIC(5,2),
    risk_flags            JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key       VARCHAR(80) UNIQUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_ride ON payments(ride_id);
CREATE INDEX IF NOT EXISTS idx_payments_rider ON payments(rider_id);
CREATE INDEX IF NOT EXISTS idx_payments_driver ON payments(driver_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_provider_id ON payments(provider_payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_idem ON payments(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at DESC);

-- Webhook events from providers (idempotent ingest)
CREATE TABLE IF NOT EXISTS payment_webhook_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider        VARCHAR(50) NOT NULL,
    event_id        VARCHAR(120) NOT NULL,
    event_type      VARCHAR(80) NOT NULL,
    payload         JSONB NOT NULL,
    signature       VARCHAR(255),
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at    TIMESTAMPTZ,
    process_status  VARCHAR(20) NOT NULL DEFAULT 'pending',
    process_log     TEXT,
    UNIQUE(provider, event_id)
);
CREATE INDEX IF NOT EXISTS idx_pwe_status ON payment_webhook_events(process_status, received_at);

-- Double-entry ledger
CREATE TABLE IF NOT EXISTS ledger_entries (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    txn_id            UUID NOT NULL,                    -- groups debit+credit
    account_type      VARCHAR(30) NOT NULL,             -- rider_wallet, driver_wallet, platform_revenue, gateway_holding
    account_owner_id  UUID,                             -- rider/driver id
    direction         VARCHAR(6) NOT NULL CHECK (direction IN ('debit','credit')),
    amount_cents      BIGINT NOT NULL,
    currency          CHAR(3) NOT NULL,
    balance_after_cents BIGINT,
    category          payment_tx_type NOT NULL,
    ref_type          VARCHAR(40),                      -- ride,payout,topup,refund
    ref_id            UUID,
    description       TEXT,
    metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
    posted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    idempotency_key   VARCHAR(80) UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_ledger_txn ON ledger_entries(txn_id);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger_entries(account_type, account_owner_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_ref ON ledger_entries(ref_type, ref_id);

-- Driver & rider wallets
CREATE TABLE IF NOT EXISTS wallets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID NOT NULL,
    owner_role      VARCHAR(20) NOT NULL,               -- 'rider','driver','platform'
    currency        CHAR(3) NOT NULL,
    balance_cents   BIGINT NOT NULL DEFAULT 0,
    held_cents      BIGINT NOT NULL DEFAULT 0,          -- escrow
    lifetime_credits BIGINT NOT NULL DEFAULT 0,
    lifetime_debits BIGINT NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(owner_id, owner_role, currency)
);
CREATE INDEX IF NOT EXISTS idx_wallets_owner ON wallets(owner_id, owner_role);

-- Driver payouts
CREATE TABLE IF NOT EXISTS payouts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id           UUID NOT NULL REFERENCES drivers(id),
    payout_method_id    UUID REFERENCES driver_payout_methods(id),
    period_start        DATE NOT NULL,
    period_end          DATE NOT NULL,
    gross_earnings_cents BIGINT NOT NULL,
    platform_fee_cents  BIGINT NOT NULL DEFAULT 0,
    tds_cents           BIGINT NOT NULL DEFAULT 0,
    incentives_cents    BIGINT NOT NULL DEFAULT 0,
    adjustments_cents   BIGINT NOT NULL DEFAULT 0,
    net_payout_cents    BIGINT NOT NULL,
    currency            CHAR(3) NOT NULL,
    status              payout_status NOT NULL DEFAULT 'pending',
    provider            VARCHAR(50),
    provider_payout_id  VARCHAR(120),
    utr_number          VARCHAR(80),
    bank_reference      VARCHAR(120),
    failure_reason      TEXT,
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at        TIMESTAMPTZ,
    settled_at          TIMESTAMPTZ,
    retry_count         INTEGER NOT NULL DEFAULT 0,
    next_retry_at       TIMESTAMPTZ,
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_payouts_driver ON payouts(driver_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
CREATE INDEX IF NOT EXISTS idx_payouts_period ON payouts(period_start, period_end);

-- Disputes (chargebacks, claims)
CREATE TABLE IF NOT EXISTS disputes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id         UUID REFERENCES rides(id),
    payment_id      UUID REFERENCES payments(id),
    raised_by       UUID NOT NULL,
    raised_by_role  VARCHAR(20) NOT NULL,
    reason_code     VARCHAR(40) NOT NULL,
    reason_text     TEXT,
    amount_cents    BIGINT NOT NULL,
    status          dispute_status NOT NULL DEFAULT 'opened',
    evidence        JSONB NOT NULL DEFAULT '[]'::jsonb,
    provider_dispute_id VARCHAR(120),
    resolved_at     TIMESTAMPTZ,
    resolved_by     UUID,
    resolution      TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_disputes_ride ON disputes(ride_id);
CREATE INDEX IF NOT EXISTS idx_disputes_payment ON disputes(payment_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PROMO CODES, REFERRALS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS promotions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                VARCHAR(40) NOT NULL UNIQUE,
    name                VARCHAR(200) NOT NULL,
    description         TEXT,
    kind                promo_kind NOT NULL,
    value               NUMERIC(10,2) NOT NULL,          -- e.g. 20.0 for 20% or ₹20
    max_discount_cents  BIGINT,
    min_ride_fare_cents BIGINT NOT NULL DEFAULT 0,
    max_redemptions     INTEGER,
    redemption_count    INTEGER NOT NULL DEFAULT 0,
    max_per_user        INTEGER NOT NULL DEFAULT 1,
    valid_from          TIMESTAMPTZ NOT NULL,
    valid_until         TIMESTAMPTZ NOT NULL,
    campus_id           UUID REFERENCES campuses(id),
    ride_types          ride_type[] NOT NULL DEFAULT ARRAY['economy','comfort','premium','xl']::ride_type[],
    payment_methods     payment_method_kind[],
    user_segments       JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_first_ride_only  BOOLEAN NOT NULL DEFAULT false,
    is_surge_killer     BOOLEAN NOT NULL DEFAULT false,
    is_public           BOOLEAN NOT NULL DEFAULT true,
    auto_apply          BOOLEAN NOT NULL DEFAULT false,
    status              promo_status NOT NULL DEFAULT 'active',
    terms_url           TEXT,
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by          UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_promo_code ON promotions(code);
CREATE INDEX IF NOT EXISTS idx_promo_status ON promotions(status, valid_from, valid_until);

CREATE TABLE IF NOT EXISTS promo_redemptions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    promotion_id        UUID NOT NULL REFERENCES promotions(id),
    rider_id            UUID NOT NULL REFERENCES riders(id),
    ride_id             UUID REFERENCES rides(id),
    code                VARCHAR(40) NOT NULL,
    discount_cents      BIGINT NOT NULL,
    status              promo_redemption_status NOT NULL DEFAULT 'reserved',
    reserved_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_at          TIMESTAMPTZ,
    refunded_at         TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ,
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_pr_rider ON promo_redemptions(rider_id);
CREATE INDEX IF NOT EXISTS idx_pr_ride ON promo_redemptions(ride_id);
CREATE INDEX IF NOT EXISTS idx_pr_status ON promo_redemptions(status);

CREATE TABLE IF NOT EXISTS referral_codes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_role      VARCHAR(20) NOT NULL,                 -- rider, driver
    owner_id        UUID NOT NULL,
    code            VARCHAR(20) NOT NULL UNIQUE,
    total_uses      INTEGER NOT NULL DEFAULT 0,
    total_reward_cents BIGINT NOT NULL DEFAULT 0,
    max_uses        INTEGER,
    expires_at      TIMESTAMPTZ,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS referral_redemptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referral_id     UUID NOT NULL REFERENCES referral_codes(id),
    referred_id     UUID NOT NULL,                       -- the new user
    referred_role   VARCHAR(20) NOT NULL,
    reward_cents    BIGINT NOT NULL DEFAULT 0,
    reward_paid     BOOLEAN NOT NULL DEFAULT false,
    reward_paid_at  TIMESTAMPTZ,
    ride_id         UUID REFERENCES rides(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(referred_id, referred_role)
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- REWARDS, LOYALTY
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS reward_accounts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id          UUID NOT NULL,
    owner_role        VARCHAR(20) NOT NULL,
    tier              VARCHAR(20) NOT NULL DEFAULT 'bronze',
    points            BIGINT NOT NULL DEFAULT 0,
    points_lifetime   BIGINT NOT NULL DEFAULT 0,
    points_redeemed   BIGINT NOT NULL DEFAULT 0,
    tier_progress_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
    next_tier         VARCHAR(20),
    next_tier_at      BIGINT,
    expires_at        TIMESTAMPTZ,
    metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(owner_id, owner_role)
);

CREATE TABLE IF NOT EXISTS reward_transactions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id        UUID NOT NULL REFERENCES reward_accounts(id) ON DELETE CASCADE,
    owner_id          UUID NOT NULL,
    points            BIGINT NOT NULL,
    kind              VARCHAR(20) NOT NULL,              -- earned,redeemed,expired,bonus,penalty
    source            VARCHAR(40) NOT NULL,              -- ride_completed, streak, milestone
    ride_id           UUID REFERENCES rides(id),
    description       TEXT,
    balance_after     BIGINT NOT NULL,
    expires_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rtx_account ON reward_transactions(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rtx_owner ON reward_transactions(owner_id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- DISPATCH, SURGE, ZONES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS dispatch_zones (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campus_id       UUID REFERENCES campuses(id),
    name            VARCHAR(120) NOT NULL,
    code            VARCHAR(40) NOT NULL UNIQUE,
    polygon         GEOGRAPHY(POLYGON, 4326) NOT NULL,
    centroid        GEOGRAPHY(POINT, 4326) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    surge_state     surge_state NOT NULL DEFAULT 'low',
    surge_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.0,
    demand_score    NUMERIC(5,2) NOT NULL DEFAULT 0,
    supply_score    NUMERIC(5,2) NOT NULL DEFAULT 0,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dz_polygon ON dispatch_zones USING GIST(polygon);
CREATE INDEX IF NOT EXISTS idx_dz_centroid ON dispatch_zones USING GIST(centroid);
CREATE INDEX IF NOT EXISTS idx_dz_active ON dispatch_zones(is_active) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS surge_history (
    id              BIGSERIAL PRIMARY KEY,
    zone_id         UUID NOT NULL REFERENCES dispatch_zones(id) ON DELETE CASCADE,
    multiplier      NUMERIC(4,2) NOT NULL,
    demand          INTEGER NOT NULL,
    supply          INTEGER NOT NULL,
    weather         JSONB,
    event           JSONB,
    triggered_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sh_zone_time ON surge_history(zone_id, triggered_at DESC);

CREATE TABLE IF NOT EXISTS surge_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_id         UUID REFERENCES dispatch_zones(id) ON DELETE CASCADE,
    name            VARCHAR(120) NOT NULL,
    min_multiplier  NUMERIC(4,2) NOT NULL DEFAULT 1.0,
    max_multiplier  NUMERIC(4,2) NOT NULL DEFAULT 3.0,
    demand_threshold INTEGER NOT NULL DEFAULT 10,
    supply_threshold INTEGER NOT NULL DEFAULT 5,
    schedule        JSONB,                              -- cron spec
    conditions      JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SCHEDULED RIDES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS scheduled_rides (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id            UUID NOT NULL REFERENCES riders(id),
    ride_id             UUID REFERENCES rides(id),
    status              scheduled_ride_status NOT NULL DEFAULT 'pending',
    scheduled_for       TIMESTAMPTZ NOT NULL,
    pickup_address      TEXT NOT NULL,
    pickup_lat          NUMERIC(10,7) NOT NULL,
    pickup_lng          NUMERIC(10,7) NOT NULL,
    pickup_point        GEOGRAPHY(POINT, 4326) NOT NULL,
    dropoff_address     TEXT NOT NULL,
    dropoff_lat         NUMERIC(10,7) NOT NULL,
    dropoff_lng         NUMERIC(10,7) NOT NULL,
    dropoff_point       GEOGRAPHY(POINT, 4326) NOT NULL,
    ride_type           ride_type NOT NULL,
    payment_method_id   UUID REFERENCES rider_payment_methods(id),
    estimated_fare_cents BIGINT NOT NULL DEFAULT 0,
    notes               TEXT,
    dispatched_at       TIMESTAMPTZ,
    driver_id           UUID REFERENCES drivers(id),
    cancelled_at        TIMESTAMPTZ,
    cancellation_reason VARCHAR(80),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sched_rider ON scheduled_rides(rider_id);
CREATE INDEX IF NOT EXISTS idx_sched_status_time ON scheduled_rides(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_sched_pickup ON scheduled_rides USING GIST(pickup_point);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- CHAT (in-trip messaging)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS chat_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id         UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL,
    sender_role     VARCHAR(20) NOT NULL,                -- 'rider'|'driver'|'system'|'support'
    recipient_id    UUID,
    body            TEXT NOT NULL,
    kind            VARCHAR(20) NOT NULL DEFAULT 'text', -- text,image,location,quick_reply
    attachment_url  TEXT,
    location        GEOGRAPHY(POINT, 4326),
    masked_numbers  JSONB,                              -- {rider,driver} numbers masked
    template_id     VARCHAR(40),
    status          chat_msg_status NOT NULL DEFAULT 'sent',
    delivered_at    TIMESTAMPTZ,
    read_at         TIMESTAMPTZ,
    edited_at       TIMESTAMPTZ,
    flagged         BOOLEAN NOT NULL DEFAULT false,
    flag_reason     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cm_ride_time ON chat_messages(ride_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cm_sender ON chat_messages(sender_id);

CREATE TABLE IF NOT EXISTS chat_quick_replies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role            VARCHAR(20) NOT NULL,                -- rider, driver
    label           VARCHAR(80) NOT NULL,
    body            TEXT NOT NULL,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT true
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SAFETY, SOS, INCIDENTS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS safety_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id         UUID REFERENCES rides(id) ON DELETE SET NULL,
    reporter_id     UUID,                               -- rider or driver
    reporter_role   VARCHAR(20),
    subject_id      UUID,                               -- whom the event is about
    subject_role    VARCHAR(20),
    event_type      safety_event_type NOT NULL,
    severity        safety_event_severity NOT NULL DEFAULT 'warning',
    status          safety_event_status NOT NULL DEFAULT 'open',
    point           GEOGRAPHY(POINT, 4326),
    description     TEXT,
    evidence        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- audio, video, photo URLs
    auto_detected   BOOLEAN NOT NULL DEFAULT false,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID,
    resolved_at     TIMESTAMPTZ,
    resolved_by     UUID,
    resolution      TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_se_ride ON safety_events(ride_id);
CREATE INDEX IF NOT EXISTS idx_se_status ON safety_events(status);
CREATE INDEX IF NOT EXISTS idx_se_severity ON safety_events(severity);
CREATE INDEX IF NOT EXISTS idx_se_geo ON safety_events USING GIST(point);

CREATE TABLE IF NOT EXISTS sos_alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id         UUID REFERENCES rides(id),
    raised_by       UUID NOT NULL,
    raised_by_role  VARCHAR(20) NOT NULL,
    point           GEOGRAPHY(POINT, 4326) NOT NULL,
    audio_url       TEXT,
    video_url       TEXT,
    contacts_notified JSONB NOT NULL DEFAULT '[]'::jsonb,
    authority_notified BOOLEAN NOT NULL DEFAULT false,
    authority_reference VARCHAR(120),
    response_team   VARCHAR(120),
    status          VARCHAR(20) NOT NULL DEFAULT 'active',  -- active,resolved,false_alarm
    resolved_at     TIMESTAMPTZ,
    resolved_by     UUID,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sos_ride ON sos_alerts(ride_id);
CREATE INDEX IF NOT EXISTS idx_sos_status ON sos_alerts(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_sos_point ON sos_alerts USING GIST(point);

CREATE TABLE IF NOT EXISTS fraud_alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id      UUID NOT NULL,                       -- rider/driver id
    subject_role    VARCHAR(20) NOT NULL,
    alert_kind      VARCHAR(50) NOT NULL,                -- fake_gps, promo_abuse, card_testing, synthetic_ride, collusion
    severity        safety_event_severity NOT NULL DEFAULT 'warning',
    score           NUMERIC(5,2) NOT NULL,               -- 0-100
    status          fraud_alert_status NOT NULL DEFAULT 'open',
    evidence        JSONB NOT NULL DEFAULT '{}'::jsonb,
    ride_id         UUID REFERENCES rides(id),
    payment_id      UUID REFERENCES payments(id),
    assigned_to     UUID,
    resolved_at     TIMESTAMPTZ,
    resolution      TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fa_subject ON fraud_alerts(subject_id);
CREATE INDEX IF NOT EXISTS idx_fa_status ON fraud_alerts(status);
CREATE INDEX IF NOT EXISTS idx_fa_kind ON fraud_alerts(alert_kind);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SUPPORT TICKETS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS support_tickets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number   VARCHAR(20) NOT NULL UNIQUE,
    rider_id        UUID REFERENCES riders(id),
    driver_id       UUID REFERENCES drivers(id),
    ride_id         UUID REFERENCES rides(id),
    payment_id      UUID REFERENCES payments(id),
    raised_by       UUID NOT NULL,
    raised_by_role  VARCHAR(20) NOT NULL,
    category        ticket_category NOT NULL,
    priority        ticket_priority NOT NULL DEFAULT 'normal',
    subject         VARCHAR(255) NOT NULL,
    description     TEXT NOT NULL,
    status          ticket_status NOT NULL DEFAULT 'open',
    assigned_to     UUID,
    resolution      TEXT,
    refund_amount_cents BIGINT,
    sla_due_at      TIMESTAMPTZ,
    resolved_at     TIMESTAMPTZ,
    closed_at       TIMESTAMPTZ,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tickets_rider ON support_tickets(rider_id);
CREATE INDEX IF NOT EXISTS idx_tickets_driver ON support_tickets(driver_id);
CREATE INDEX IF NOT EXISTS idx_tickets_ride ON support_tickets(ride_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority ON support_tickets(priority);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON support_tickets(assigned_to) WHERE status NOT IN ('closed','resolved');

CREATE TABLE IF NOT EXISTS support_ticket_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id       UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    author_id       UUID NOT NULL,
    author_role     VARCHAR(20) NOT NULL,
    body            TEXT NOT NULL,
    attachment_url  TEXT,
    is_internal     BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stm_ticket ON support_ticket_messages(ticket_id, created_at);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- CORPORATE ACCOUNTS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS corporate_accounts (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name          VARCHAR(200) NOT NULL,
    legal_name            VARCHAR(200) NOT NULL,
    tax_id                VARCHAR(80),
    billing_email         VARCHAR(255) NOT NULL,
    billing_phone         VARCHAR(20),
    billing_address       JSONB,
    contract_start        DATE NOT NULL,
    contract_end          DATE,
    billing_cycle         VARCHAR(20) NOT NULL DEFAULT 'monthly',  -- weekly,monthly
    credit_limit_cents    BIGINT NOT NULL DEFAULT 0,
    credit_used_cents     BIGINT NOT NULL DEFAULT 0,
    is_active             BOOLEAN NOT NULL DEFAULT true,
    payment_terms_days    INTEGER NOT NULL DEFAULT 30,
    rate_card             JSONB NOT NULL DEFAULT '{}'::jsonb,    -- overrides per ride type
    metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS corporate_employees (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corporate_id    UUID NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
    rider_id        UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
    employee_id     VARCHAR(80),
    department      VARCHAR(80),
    cost_center     VARCHAR(80),
    monthly_limit_cents BIGINT,
    monthly_used_cents  BIGINT NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    invited_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    joined_at       TIMESTAMPTZ,
    UNIQUE(corporate_id, rider_id)
);

CREATE TABLE IF NOT EXISTS corporate_invoices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corporate_id    UUID NOT NULL REFERENCES corporate_accounts(id),
    invoice_number  VARCHAR(40) NOT NULL UNIQUE,
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    total_rides     INTEGER NOT NULL,
    subtotal_cents  BIGINT NOT NULL,
    tax_cents       BIGINT NOT NULL DEFAULT 0,
    total_cents     BIGINT NOT NULL,
    amount_paid_cents BIGINT NOT NULL DEFAULT 0,
    status          corporate_billing_status NOT NULL DEFAULT 'draft',
    due_date        DATE NOT NULL,
    paid_at         TIMESTAMPTZ,
    pdf_url         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- NOTIFICATIONS, FCM, MESSAGES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    user_role       VARCHAR(20) NOT NULL,                 -- rider, driver, admin
    kind            notification_kind NOT NULL,
    channel         notification_channel NOT NULL,
    title           VARCHAR(200) NOT NULL,
    body            TEXT NOT NULL,
    icon_url        TEXT,
    image_url       TEXT,
    deep_link       TEXT,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    status          notification_status NOT NULL DEFAULT 'queued',
    sent_at         TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    read_at         TIMESTAMPTZ,
    failure_reason  TEXT,
    template_id     VARCHAR(40),
    locale          VARCHAR(10) DEFAULT 'en',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_status ON notifications(status);

CREATE TABLE IF NOT EXISTS notification_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_key    VARCHAR(80) NOT NULL UNIQUE,
    channel         notification_channel NOT NULL,
    locale          VARCHAR(10) NOT NULL DEFAULT 'en',
    title           VARCHAR(200) NOT NULL,
    body            TEXT NOT NULL,
    variables       JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    user_role       VARCHAR(20) NOT NULL,
    token           TEXT NOT NULL,
    platform        VARCHAR(20) NOT NULL,                 -- ios,android,web
    device_id       VARCHAR(120),
    app_version     VARCHAR(40),
    os_version      VARCHAR(40),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    last_used_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, platform, device_id)
);
CREATE INDEX IF NOT EXISTS idx_dt_user ON device_tokens(user_id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SHIFTS (curators / drivers)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS shifts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id       UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    campus_id       UUID REFERENCES campuses(id),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at        TIMESTAMPTZ,
    planned_hours   NUMERIC(5,2),
    actual_hours    NUMERIC(5,2),
    online_hours    NUMERIC(5,2) NOT NULL DEFAULT 0,
    busy_hours      NUMERIC(5,2) NOT NULL DEFAULT 0,
    idle_hours      NUMERIC(5,2) NOT NULL DEFAULT 0,
    total_rides     INTEGER NOT NULL DEFAULT 0,
    total_earnings_cents BIGINT NOT NULL DEFAULT 0,
    start_location  GEOGRAPHY(POINT, 4326),
    end_location    GEOGRAPHY(POINT, 4326),
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_shifts_driver ON shifts(driver_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_shifts_active ON shifts(driver_id) WHERE status = 'active';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- VEHICLE INSPECTION, MAINTENANCE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS vehicle_inspections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id      UUID NOT NULL REFERENCES driver_vehicles(id) ON DELETE CASCADE,
    driver_id       UUID NOT NULL REFERENCES drivers(id),
    inspector_id    UUID,                                -- admin
    status          vehicle_inspection_status NOT NULL DEFAULT 'scheduled',
    scheduled_for   TIMESTAMPTZ NOT NULL,
    completed_at    TIMESTAMPTZ,
    odometer_km     NUMERIC(10,2),
    checklist       JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {brakes:ok, lights:ok, ...}
    photos          JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes           TEXT,
    issues_found    JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vi_vehicle ON vehicle_inspections(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vi_scheduled ON vehicle_inspections(scheduled_for);

CREATE TABLE IF NOT EXISTS vehicle_service_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id      UUID NOT NULL REFERENCES driver_vehicles(id) ON DELETE CASCADE,
    service_type    VARCHAR(40) NOT NULL,
    performed_at    TIMESTAMPTZ NOT NULL,
    odometer_km     NUMERIC(10,2),
    description     TEXT NOT NULL,
    cost_cents      BIGINT,
    vendor          VARCHAR(200),
    receipt_url     TEXT,
    next_due_km     NUMERIC(10,2),
    next_due_at     DATE,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_vsl_vehicle ON vehicle_service_log(vehicle_id, performed_at DESC);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- FLEET — corporate fleets
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS fleets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(200) NOT NULL,
    corporate_id    UUID REFERENCES corporate_accounts(id),
    campus_id       UUID REFERENCES campuses(id),
    manager_id      UUID,
    vehicle_count   INTEGER NOT NULL DEFAULT 0,
    driver_count    INTEGER NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    settings        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- FARE CONFIG — per-region pricing
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS fare_config (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campus_id                UUID REFERENCES campuses(id),
    ride_type                ride_type NOT NULL,
    currency                 CHAR(3) NOT NULL,
    base_fare_cents          BIGINT NOT NULL,
    per_km_cents             BIGINT NOT NULL,
    per_minute_cents         BIGINT NOT NULL,
    minimum_fare_cents       BIGINT NOT NULL,
    cancellation_fee_cents   BIGINT NOT NULL DEFAULT 0,
    platform_fee_pct         NUMERIC(5,4) NOT NULL DEFAULT 0.20,
    tax_pct                  NUMERIC(5,4) NOT NULL DEFAULT 0.05,
    booking_fee_cents        BIGINT NOT NULL DEFAULT 0,
    surge_cap                NUMERIC(4,2) NOT NULL DEFAULT 3.0,
    night_surcharge_start    TIME,
    night_surcharge_end      TIME,
    night_surcharge_pct      NUMERIC(5,4) NOT NULL DEFAULT 0,
    peak_hours               JSONB,                        -- [{start:"08:00",end:"10:00",pct:1.5}]
    effective_from           TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_until          TIMESTAMPTZ,
    is_active                BOOLEAN NOT NULL DEFAULT true,
    metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE(campus_id, ride_type, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_fare_lookup ON fare_config(campus_id, ride_type) WHERE is_active = true;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- AUDIT LOG — append-only
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS audit_log (
    id              BIGSERIAL PRIMARY KEY,
    actor_id        UUID,
    actor_role      VARCHAR(40),
    actor_ip        INET,
    actor_user_agent TEXT,
    action          VARCHAR(80) NOT NULL,
    entity          audit_entity NOT NULL,
    entity_id       UUID,
    ride_id         UUID,
    campus_id       UUID,
    before          JSONB,
    after           JSONB,
    diff            JSONB,
    reason          TEXT,
    severity        VARCHAR(20) NOT NULL DEFAULT 'info',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_ride ON audit_log(ride_id);
CREATE INDEX IF NOT EXISTS idx_audit_action_time ON audit_log(action, created_at DESC);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- INTEGRATION SECRETS / CONFIG
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS integration_configs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider        integration_provider NOT NULL,
    env             VARCHAR(20) NOT NULL DEFAULT 'production',
    config          JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    last_synced_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(provider, env)
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SAVED ANALYTICS SNAPSHOTS (denormalised, pre-computed)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS daily_stats (
    id                  BIGSERIAL PRIMARY KEY,
    campus_id           UUID REFERENCES campuses(id),
    stat_date           DATE NOT NULL,
    total_rides         INTEGER NOT NULL DEFAULT 0,
    completed_rides     INTEGER NOT NULL DEFAULT 0,
    cancelled_rides     INTEGER NOT NULL DEFAULT 0,
    no_show_rides       INTEGER NOT NULL DEFAULT 0,
    gross_revenue_cents BIGINT NOT NULL DEFAULT 0,
    net_revenue_cents   BIGINT NOT NULL DEFAULT 0,
    driver_earnings_cents BIGINT NOT NULL DEFAULT 0,
    active_drivers      INTEGER NOT NULL DEFAULT 0,
    active_riders       INTEGER NOT NULL DEFAULT 0,
    new_riders          INTEGER NOT NULL DEFAULT 0,
    new_drivers         INTEGER NOT NULL DEFAULT 0,
    avg_wait_time_s     INTEGER,
    avg_ride_distance_km NUMERIC(10,2),
    avg_rating          NUMERIC(3,2),
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(campus_id, stat_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_stats_campus_date ON daily_stats(campus_id, stat_date DESC);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- ADMIN STAFF
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS admin_staff (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL UNIQUE,
    full_name       VARCHAR(200) NOT NULL,
    email           VARCHAR(255) NOT NULL UNIQUE,
    phone           VARCHAR(20),
    role            VARCHAR(40) NOT NULL DEFAULT 'support',  -- super_admin, ops, support, finance, fraud, fleet
    permissions     JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    last_active_at  TIMESTAMPTZ,
    hired_at        DATE NOT NULL DEFAULT CURRENT_DATE,
    terminated_at   DATE,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TRIGGER FUNCTIONS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN
        SELECT unnest(ARRAY[
            'campuses','riders','rider_payment_methods','rider_saved_places',
            'drivers','driver_documents','driver_payout_methods','driver_vehicles',
            'rides','ride_pools','payments','payouts','disputes',
            'promotions','referral_codes','reward_accounts','dispatch_zones',
            'scheduled_rides','support_tickets','corporate_accounts',
            'corporate_invoices','notifications','notification_templates',
            'integration_configs','fleets','wallets','surge_rules'
        ])
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON %I', t);
        EXECUTE format('CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
    END LOOP;
END $$;

-- A driver cannot be assigned to two vehicles
CREATE OR REPLACE FUNCTION enforce_primary_vehicle() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_primary = true THEN
        UPDATE driver_vehicles SET is_primary = false
        WHERE driver_id = NEW.driver_id AND id != NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_primary_vehicle ON driver_vehicles;
CREATE TRIGGER trg_primary_vehicle
    AFTER INSERT OR UPDATE OF is_primary ON driver_vehicles
    FOR EACH ROW
    WHEN (NEW.is_primary = true)
    EXECUTE FUNCTION enforce_primary_vehicle();

-- Auto-derive the ride_code from the id
CREATE OR REPLACE FUNCTION set_ride_code() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.ride_code IS NULL OR NEW.ride_code = '' THEN
        NEW.ride_code = 'NR' || upper(substring(replace(NEW.id::text,'-','') from 1 for 8));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ride_code ON rides;
CREATE TRIGGER trg_ride_code BEFORE INSERT ON rides FOR EACH ROW EXECUTE FUNCTION set_ride_code();

-- Auto-ticket-number
CREATE SEQUENCE IF NOT EXISTS ticket_seq START 100000;
CREATE OR REPLACE FUNCTION set_ticket_number() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' THEN
        NEW.ticket_number = 'TKT-' || to_char(now(),'YYYY') || '-' || lpad(nextval('ticket_seq')::text, 6, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ticket_number ON support_tickets;
CREATE TRIGGER trg_ticket_number BEFORE INSERT ON support_tickets FOR EACH ROW EXECUTE FUNCTION set_ticket_number();

-- Invoice numbering
CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1000;
CREATE OR REPLACE FUNCTION set_invoice_number() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
        NEW.invoice_number = 'INV-' || to_char(now(),'YYYYMM') || '-' || lpad(nextval('invoice_seq')::text, 5, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_number ON corporate_invoices;
CREATE TRIGGER trg_invoice_number BEFORE INSERT ON corporate_invoices FOR EACH ROW EXECUTE FUNCTION set_invoice_number();

-- Trip-code for share tokens
CREATE OR REPLACE FUNCTION gen_share_token() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.share_token IS NULL OR NEW.share_token = '' THEN
        NEW.share_token = encode(gen_random_bytes(24), 'hex');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_share_token ON rides;
CREATE TRIGGER trg_share_token BEFORE INSERT ON rides FOR EACH ROW EXECUTE FUNCTION gen_share_token();

-- Loyalty tier recompute
CREATE OR REPLACE FUNCTION recompute_loyalty_tier() RETURNS TRIGGER AS $$
DECLARE
    lp BIGINT;
    ntier VARCHAR(20);
BEGIN
    SELECT COALESCE(SUM(points),0) INTO lp FROM reward_transactions
    WHERE account_id = NEW.id AND kind IN ('earned','bonus') AND (expires_at IS NULL OR expires_at > now());
    NEW.points = GREATEST(NEW.points, lp);
    NEW.points_lifetime = GREATEST(NEW.points_lifetime, lp);
    ntier := CASE
        WHEN lp >= 100000 THEN 'diamond'
        WHEN lp >= 25000  THEN 'platinum'
        WHEN lp >= 10000  THEN 'gold'
        WHEN lp >= 2500   THEN 'silver'
        ELSE 'bronze'
    END;
    NEW.tier = ntier;
    NEW.tier_progress_pct = LEAST(100.0, lp::numeric / NULLIF(CASE ntier
        WHEN 'bronze' THEN 2500 WHEN 'silver' THEN 10000 WHEN 'gold' THEN 25000 WHEN 'platinum' THEN 100000 ELSE 250000 END,0) * 100);
    NEW.next_tier = CASE ntier
        WHEN 'bronze' THEN 'silver' WHEN 'silver' THEN 'gold' WHEN 'gold' THEN 'platinum'
        WHEN 'platinum' THEN 'diamond' ELSE NULL END;
    NEW.next_tier_at = CASE ntier
        WHEN 'bronze' THEN 2500 WHEN 'silver' THEN 10000 WHEN 'gold' THEN 25000
        WHEN 'platinum' THEN 100000 ELSE NULL END;
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recompute_loyalty ON reward_accounts;
CREATE TRIGGER trg_recompute_loyalty BEFORE UPDATE ON reward_accounts FOR EACH ROW EXECUTE FUNCTION recompute_loyalty_tier();

-- Rating aggregate refresh
CREATE OR REPLACE FUNCTION refresh_driver_rating() RETURNS TRIGGER AS $$
DECLARE
    drid UUID;
BEGIN
    IF NEW.ratee_role = 'driver' THEN
        drid := NEW.ratee_id;
    ELSIF NEW.ratee_role = 'rider' AND NEW.rater_role = 'driver' THEN
        drid := NEW.rater_id;
    ELSE
        RETURN NEW;
    END IF;
    UPDATE drivers SET
        rating_avg = COALESCE((SELECT AVG(rating)::numeric(3,2) FROM ride_ratings WHERE ratee_id = drid), 5.00),
        rating_count = COALESCE((SELECT COUNT(*) FROM ride_ratings WHERE ratee_id = drid), 0)
    WHERE id = drid;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rating_driver ON ride_ratings;
CREATE TRIGGER trg_rating_driver AFTER INSERT ON ride_ratings FOR EACH ROW EXECUTE FUNCTION refresh_driver_rating();

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- VIEWS — common queries
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE VIEW v_active_rides AS
SELECT r.*, dr.full_name AS driver_name, dr.phone AS driver_phone, dr.rating_avg AS driver_rating,
       drv.registration_number AS vehicle_reg, drv.make AS vehicle_make, drv.model AS vehicle_model,
       ri.full_name AS rider_name, ri.phone AS rider_phone
FROM rides r
LEFT JOIN drivers dr ON r.driver_id = dr.id
LEFT JOIN driver_vehicles drv ON r.vehicle_id = drv.id
LEFT JOIN riders ri ON r.rider_id = ri.id
WHERE r.deleted_at IS NULL
  AND r.status IN ('requested','searching','driver_assigned','driver_enroute','driver_arrived','in_progress');

CREATE OR REPLACE VIEW v_driver_earnings AS
SELECT
    d.id AS driver_id,
    d.full_name,
    d.phone,
    d.campus_id,
    COUNT(r.id) AS total_rides,
    COALESCE(SUM(r.driver_earnings_cents),0) AS total_earnings_cents,
    COALESCE(AVG(r.driver_rating)::numeric(3,2), 5.0) AS avg_rating,
    COALESCE(SUM(r.actual_distance_km), 0) AS total_distance_km,
    COALESCE(SUM(r.actual_duration_s), 0) AS total_duration_s
FROM drivers d
LEFT JOIN rides r ON r.driver_id = d.id AND r.status = 'completed' AND r.deleted_at IS NULL
WHERE d.deleted_at IS NULL
GROUP BY d.id, d.full_name, d.phone, d.campus_id;

CREATE OR REPLACE VIEW v_rider_history AS
SELECT
    ri.id AS rider_id,
    ri.full_name,
    ri.phone,
    COUNT(r.id) AS total_rides,
    COALESCE(SUM(r.total_fare_cents),0) AS lifetime_spend_cents,
    COALESCE(MAX(r.completed_at), ri.created_at) AS last_ride_at
FROM riders ri
LEFT JOIN rides r ON r.rider_id = ri.id AND r.status = 'completed' AND r.deleted_at IS NULL
WHERE ri.deleted_at IS NULL
GROUP BY ri.id, ri.full_name, ri.phone, ri.created_at;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SEED — minimal demo data
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSERT INTO countries (iso2, iso3, name, dial_code, currency, timezone) VALUES
    ('IN','IND','India','+91','INR','Asia/Kolkata'),
    ('US','USA','United States','+1','USD','America/Los_Angeles'),
    ('GB','GBR','United Kingdom','+44','GBP','Europe/London'),
    ('SG','SGP','Singapore','+65','SGD','Asia/Singapore'),
    ('AE','ARE','UAE','+971','AED','Asia/Dubai')
ON CONFLICT (iso2) DO NOTHING;

INSERT INTO fare_config (campus_id, ride_type, currency, base_fare_cents, per_km_cents, per_minute_cents, minimum_fare_cents, cancellation_fee_cents, platform_fee_pct, tax_pct)
VALUES
    (NULL,'economy','INR',3000, 1200, 200, 5000, 2500, 0.2000, 0.0500),
    (NULL,'comfort','INR',5000, 1600, 250, 8000, 3500, 0.2000, 0.0500),
    (NULL,'premium','INR',10000, 2800, 400, 15000, 5000, 0.2200, 0.0500),
    (NULL,'xl','INR',8000, 2200, 320, 12000, 4000, 0.2100, 0.0500),
    (NULL,'auto','INR',2000, 800, 150, 3000, 1500, 0.1800, 0.0500),
    (NULL,'bike','INR',1500, 500, 100, 2000, 1000, 0.1800, 0.0500),
    (NULL,'pool','INR',2500, 900, 180, 4000, 2000, 0.2000, 0.0500),
    (NULL,'lux','INR',20000, 4500, 600, 30000, 7500, 0.2500, 0.0500)
ON CONFLICT DO NOTHING;

INSERT INTO chat_quick_replies (role, label, body, sort_order) VALUES
    ('rider','I''m at pickup','Hi, I''m at the pickup location.',1),
    ('rider','Running late','Sorry, I''m running 2-3 mins late.',2),
    ('rider','Where are you?','Where are you right now?',3),
    ('rider','Call me','Please call me when you arrive.',4),
    ('rider','Cancel trip','I need to cancel the trip.',5),
    ('driver','Arriving now','I''m arriving in 1 minute.',1),
    ('driver','At pickup','I''ve arrived at the pickup point.',2),
    ('driver','Need directions','Could you share a landmark?',3),
    ('driver','Traffic delay','There''s traffic, will be there in 5 min.',4),
    ('driver','Wait please','Please wait, finding parking.',5)
ON CONFLICT DO NOTHING;

INSERT INTO notification_templates (template_key, channel, locale, title, body) VALUES
    ('ride_assigned','push','en','Driver on the way','{driver_name} is heading to pick you up.'),
    ('driver_arriving','push','en','Driver arriving','Your driver is 1 minute away.'),
    ('driver_arrived','push','en','Driver arrived','Your driver has arrived. Look for {vehicle_info}.'),
    ('ride_started','push','en','Trip started','Your trip has started. Sit back and relax.'),
    ('ride_completed','push','en','Trip complete','Your fare is ₹{fare}. Thanks for riding with us!'),
    ('ride_cancelled','push','en','Ride cancelled','Your ride has been cancelled. {reason}'),
    ('payment_succeeded','push','en','Payment received','We''ve charged ₹{amount} from {method}.'),
    ('payment_failed','push','en','Payment failed','We couldn''t process ₹{amount}. Please update your payment method.'),
    ('kyc_approved','push','en','KYC approved','Your KYC documents have been approved.'),
    ('kyc_rejected','push','en','KYC rejected','Your {document} was rejected: {reason}'),
    ('promo','push','en','Promo unlocked','Use code {code} to save ₹{amount} on your next ride!'),
    ('reward_earned','push','en','Reward earned','You earned {points} loyalty points!')
ON CONFLICT (template_key) DO NOTHING;

COMMIT;

-- ============================================================================
-- MIGRATION 003 COMPLETE
-- ============================================================================
