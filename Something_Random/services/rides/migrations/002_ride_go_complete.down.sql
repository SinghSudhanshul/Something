-- ============================================================================
-- NEXUS RIDE & GO — Rollback Migration 002
-- ============================================================================

BEGIN;

-- Drop triggers first
DROP TRIGGER IF EXISTS set_incident_sla ON incidents;
DROP TRIGGER IF EXISTS set_updated_at ON ride_payments;
DROP TRIGGER IF EXISTS set_updated_at ON payment_methods;
DROP TRIGGER IF EXISTS set_updated_at ON safety_protocols;
DROP TRIGGER IF EXISTS set_updated_at ON incidents;
DROP TRIGGER IF EXISTS set_updated_at ON ride_preferences;
DROP TRIGGER IF EXISTS set_updated_at ON saved_places;
DROP TRIGGER IF EXISTS set_updated_at ON deployment_zones;
DROP TRIGGER IF EXISTS set_updated_at ON vehicles;
DROP TRIGGER IF EXISTS set_updated_at ON curator_settings;

-- Drop functions
DROP FUNCTION IF EXISTS trigger_set_incident_sla();
DROP FUNCTION IF EXISTS compute_sla_deadline(incident_severity);
DROP FUNCTION IF EXISTS compute_reward_tier(INTEGER);
DROP FUNCTION IF EXISTS trigger_set_updated_at();

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS surge_zones CASCADE;
DROP TABLE IF EXISTS ride_payments CASCADE;
DROP TABLE IF EXISTS payment_methods CASCADE;
DROP TABLE IF EXISTS safety_protocols CASCADE;
DROP TABLE IF EXISTS incidents CASCADE;
DROP TABLE IF EXISTS reward_challenge_progress CASCADE;
DROP TABLE IF EXISTS reward_challenges CASCADE;
DROP TABLE IF EXISTS reward_transactions CASCADE;
DROP TABLE IF EXISTS reward_balances CASCADE;
DROP TABLE IF EXISTS collab_ride_members CASCADE;
DROP TABLE IF EXISTS collab_rides CASCADE;
DROP TABLE IF EXISTS ride_preferences CASCADE;
DROP TABLE IF EXISTS saved_places CASCADE;
DROP TABLE IF EXISTS demand_heatmap_cache CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS curator_settings CASCADE;
DROP TABLE IF EXISTS performance_badges CASCADE;
DROP TABLE IF EXISTS curator_shifts CASCADE;
DROP TABLE IF EXISTS deployment_zones CASCADE;
DROP TABLE IF EXISTS vehicle_skins CASCADE;
DROP TABLE IF EXISTS vehicle_telemetry CASCADE;
DROP TABLE IF EXISTS vehicle_service_logs CASCADE;
DROP TABLE IF EXISTS vehicles CASCADE;

-- Drop custom types
DROP TYPE IF EXISTS luggage_size CASCADE;
DROP TYPE IF EXISTS collab_ride_status CASCADE;
DROP TYPE IF EXISTS payment_status CASCADE;
DROP TYPE IF EXISTS payment_method_type CASCADE;
DROP TYPE IF EXISTS reward_source CASCADE;
DROP TYPE IF EXISTS reward_tx_type CASCADE;
DROP TYPE IF EXISTS reward_tier CASCADE;
DROP TYPE IF EXISTS incident_status CASCADE;
DROP TYPE IF EXISTS incident_severity CASCADE;
DROP TYPE IF EXISTS incident_type CASCADE;
DROP TYPE IF EXISTS badge_type CASCADE;
DROP TYPE IF EXISTS shift_status CASCADE;
DROP TYPE IF EXISTS service_type CASCADE;
DROP TYPE IF EXISTS vehicle_status CASCADE;

COMMIT;
