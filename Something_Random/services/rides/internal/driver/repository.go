package driver

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Driver represents a registered driver.
type Driver struct {
	ID             uuid.UUID  `json:"id"`
	UserID         uuid.UUID  `json:"user_id"`
	CampusID       uuid.UUID  `json:"campus_id"`
	LicenseNumber  string     `json:"license_number"`
	VehicleType    string     `json:"vehicle_type"`
	VehicleNumber  string     `json:"vehicle_number"`
	VehicleColor   string     `json:"vehicle_color"`
	IsVerified     bool       `json:"is_verified"`
	IsAvailable    bool       `json:"is_available"`
	IsWomenOnly    bool       `json:"is_women_only"`
	Lat            *float64   `json:"lat,omitempty"`
	Lng            *float64   `json:"lng,omitempty"`
	LastLocationAt *time.Time `json:"last_location_at,omitempty"`
	TotalRides     int        `json:"total_rides"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// DriverWithDistance is a driver record with computed distance and trust score.
type DriverWithDistance struct {
	Driver
	DistanceMeters float64 `json:"distance_meters"`
	TrustScore     float64 `json:"trust_score"`
	CompositeScore float64 `json:"composite_score"`
}

// Repository handles all driver DB access.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository creates a new driver repository.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// CreateInput holds data for creating a new driver.
type CreateInput struct {
	UserID        uuid.UUID
	CampusID      uuid.UUID
	LicenseNumber string
	VehicleType   string
	VehicleNumber string
	VehicleColor  string
	IsWomenOnly   bool
}

// Create registers a new driver in the database.
func (r *Repository) Create(ctx context.Context, data CreateInput) (*Driver, error) {
	var d Driver
	err := r.pool.QueryRow(ctx, `
		INSERT INTO drivers (user_id, campus_id, license_number, vehicle_type, vehicle_number, vehicle_color, is_women_only)
		VALUES ($1, $2, $3, $4::vehicle_type, $5, $6, $7)
		RETURNING id, user_id, campus_id, license_number, vehicle_type, vehicle_number, vehicle_color,
		          is_verified, is_available, is_women_only, total_rides, created_at, updated_at
	`, data.UserID, data.CampusID, data.LicenseNumber, data.VehicleType, data.VehicleNumber, data.VehicleColor, data.IsWomenOnly,
	).Scan(
		&d.ID, &d.UserID, &d.CampusID, &d.LicenseNumber, &d.VehicleType, &d.VehicleNumber, &d.VehicleColor,
		&d.IsVerified, &d.IsAvailable, &d.IsWomenOnly, &d.TotalRides, &d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create driver: %w", err)
	}
	return &d, nil
}

// FindByUserID retrieves a driver by their user ID.
func (r *Repository) FindByUserID(ctx context.Context, userID uuid.UUID) (*Driver, error) {
	var d Driver
	var lat, lng *float64
	err := r.pool.QueryRow(ctx, `
		SELECT id, user_id, campus_id, license_number, vehicle_type, vehicle_number, vehicle_color,
		       is_verified, is_available, is_women_only,
		       ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
		       last_location_at, total_rides, created_at, updated_at
		FROM drivers WHERE user_id = $1
	`, userID).Scan(
		&d.ID, &d.UserID, &d.CampusID, &d.LicenseNumber, &d.VehicleType, &d.VehicleNumber, &d.VehicleColor,
		&d.IsVerified, &d.IsAvailable, &d.IsWomenOnly,
		&lat, &lng,
		&d.LastLocationAt, &d.TotalRides, &d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("driver not found: %w", err)
	}
	d.Lat = lat
	d.Lng = lng
	return &d, nil
}

// FindByID retrieves a driver by their driver ID.
func (r *Repository) FindByID(ctx context.Context, driverID uuid.UUID) (*Driver, error) {
	var d Driver
	var lat, lng *float64
	err := r.pool.QueryRow(ctx, `
		SELECT id, user_id, campus_id, license_number, vehicle_type, vehicle_number, vehicle_color,
		       is_verified, is_available, is_women_only,
		       ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
		       last_location_at, total_rides, created_at, updated_at
		FROM drivers WHERE id = $1
	`, driverID).Scan(
		&d.ID, &d.UserID, &d.CampusID, &d.LicenseNumber, &d.VehicleType, &d.VehicleNumber, &d.VehicleColor,
		&d.IsVerified, &d.IsAvailable, &d.IsWomenOnly,
		&lat, &lng,
		&d.LastLocationAt, &d.TotalRides, &d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("driver not found: %w", err)
	}
	d.Lat = lat
	d.Lng = lng
	return &d, nil
}

// UpdateLocation updates the driver's GPS location in the database.
func (r *Repository) UpdateLocation(ctx context.Context, driverID uuid.UUID, lat, lng float64) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE drivers
		SET location = ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
		    last_location_at = NOW(),
		    updated_at = NOW()
		WHERE id = $3
	`, lat, lng, driverID)
	if err != nil {
		return fmt.Errorf("failed to update location: %w", err)
	}
	return nil
}

// SetAvailability toggles driver availability.
func (r *Repository) SetAvailability(ctx context.Context, driverID uuid.UUID, available bool) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE drivers SET is_available = $1, updated_at = NOW() WHERE id = $2
	`, available, driverID)
	if err != nil {
		return fmt.Errorf("failed to set availability: %w", err)
	}
	return nil
}

// FindAvailableNearby finds available drivers within a radius, ordered by composite score.
// Composite score: (distance_meters * 0.6) + ((5.0 - trust_score) * 0.4 * 1000)
func (r *Repository) FindAvailableNearby(ctx context.Context, lat, lng, radiusMeters float64, campusID uuid.UUID, womenOnly bool) ([]DriverWithDistance, error) {
	query := `
		SELECT d.id, d.user_id, d.campus_id, d.license_number, d.vehicle_type,
		       d.vehicle_number, d.vehicle_color, d.is_verified, d.is_available,
		       d.is_women_only, d.total_rides, d.created_at, d.updated_at,
		       ST_Distance(d.location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS distance_meters,
		       COALESCE(sp.trust_score, 3.00)::float AS trust_score,
		       (ST_Distance(d.location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) * 0.6 
		        + ((5.0 - COALESCE(sp.trust_score, 3.00)) * 0.4 * 1000)) AS composite_score
		FROM drivers d
		LEFT JOIN student_profiles sp ON sp.user_id = d.user_id
		WHERE d.is_available = true
		  AND d.is_verified = true
		  AND d.campus_id = $3
		  AND d.location IS NOT NULL
		  AND ST_DWithin(d.location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $4)
	`

	if womenOnly {
		query += ` AND d.is_women_only = true`
	}

	query += ` ORDER BY composite_score ASC LIMIT 10`

	rows, err := r.pool.Query(ctx, query, lat, lng, campusID, radiusMeters)
	if err != nil {
		return nil, fmt.Errorf("failed to find nearby drivers: %w", err)
	}
	defer rows.Close()

	var drivers []DriverWithDistance
	for rows.Next() {
		var dwd DriverWithDistance
		err := rows.Scan(
			&dwd.ID, &dwd.UserID, &dwd.CampusID, &dwd.LicenseNumber, &dwd.VehicleType,
			&dwd.VehicleNumber, &dwd.VehicleColor, &dwd.IsVerified, &dwd.IsAvailable,
			&dwd.IsWomenOnly, &dwd.TotalRides, &dwd.CreatedAt, &dwd.UpdatedAt,
			&dwd.DistanceMeters, &dwd.TrustScore, &dwd.CompositeScore,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan driver: %w", err)
		}
		drivers = append(drivers, dwd)
	}

	return drivers, nil
}

// UpdateVerificationStatus updates the driver's verification status.
func (r *Repository) UpdateVerificationStatus(ctx context.Context, driverID uuid.UUID, verified bool) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE drivers SET is_verified = $1, updated_at = NOW() WHERE id = $2
	`, verified, driverID)
	if err != nil {
		return fmt.Errorf("failed to update verification status: %w", err)
	}
	return nil
}

// IncrementTotalRides increments the driver's total ride count.
func (r *Repository) IncrementTotalRides(ctx context.Context, driverID uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE drivers SET total_rides = total_rides + 1, updated_at = NOW() WHERE id = $2
	`, driverID)
	if err != nil {
		return fmt.Errorf("failed to increment total rides: %w", err)
	}
	return nil
}

// GetRideHistory retrieves past rides for a driver with pagination.
func (r *Repository) GetRideHistory(ctx context.Context, driverID uuid.UUID, limit int, cursor *time.Time) ([]map[string]interface{}, error) {
	query := `
		SELECT rr.id, rr.pickup_label, rr.dropoff_label, rr.ride_type,
		       rr.estimated_fare, rr.status, rr.started_at, rr.completed_at, rr.created_at
		FROM ride_requests rr
		WHERE rr.driver_id = $1 AND rr.status IN ('completed', 'cancelled')
	`
	args := []interface{}{driverID}

	if cursor != nil {
		query += ` AND rr.created_at < $2`
		args = append(args, *cursor)
	}

	query += ` ORDER BY rr.created_at DESC LIMIT ` + fmt.Sprintf("%d", limit)

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to get ride history: %w", err)
	}
	defer rows.Close()

	var rides []map[string]interface{}
	for rows.Next() {
		var id uuid.UUID
		var pickupLabel, dropoffLabel, rideType, status string
		var estimatedFare *float64
		var startedAt, completedAt *time.Time
		var createdAt time.Time

		if err := rows.Scan(&id, &pickupLabel, &dropoffLabel, &rideType,
			&estimatedFare, &status, &startedAt, &completedAt, &createdAt); err != nil {
			return nil, fmt.Errorf("failed to scan ride: %w", err)
		}

		rides = append(rides, map[string]interface{}{
			"id":             id,
			"pickup_label":   pickupLabel,
			"dropoff_label":  dropoffLabel,
			"ride_type":      rideType,
			"estimated_fare": estimatedFare,
			"status":         status,
			"started_at":     startedAt,
			"completed_at":   completedAt,
			"created_at":     createdAt,
		})
	}

	return rides, nil
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RecomputeRating & helpers used by the new Ride module (Phase 1)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// DriverV2 mirrors the new ride_drivers row. The V1 Driver struct above
// continues to back the legacy endpoints so we can run both during the
// migration window.
type DriverV2 struct {
	ID                    uuid.UUID  `json:"id"`
	UserID                uuid.UUID  `json:"user_id"`
	CampusID              uuid.UUID  `json:"campus_id"`
	IsVerified            bool       `json:"is_verified"`
	IsWomenOnly           bool       `json:"is_women_only"`
	IsPremiumEligible     bool       `json:"is_premium_eligible"`
	IsAccessibilityTrained bool      `json:"is_accessibility_trained"`
	TrustScore            float64    `json:"trust_score"`
	AcceptanceRate        float64    `json:"acceptance_rate"`
	CancellationRate      float64    `json:"cancellation_rate"`
	CompletedTrips        int        `json:"completed_trips"`
	TotalEarnings         float64    `json:"total_earnings"`
	Rating                float64    `json:"rating"`
	RatingCount           int        `json:"rating_count"`
	Status                string     `json:"status"`
	CurrentVehicleID      *uuid.UUID `json:"current_vehicle_id,omitempty"`
	CurrentLat            *float64   `json:"current_lat,omitempty"`
	CurrentLng            *float64   `json:"current_lng,omitempty"`
	LastPingAt            *time.Time `json:"last_ping_at,omitempty"`
	CreatedAt             time.Time  `json:"created_at"`
	UpdatedAt             time.Time  `json:"updated_at"`
}

// FindV2ByUserID locates a driver record in the new ride_drivers table.
func (r *Repository) FindV2ByUserID(ctx context.Context, userID uuid.UUID) (*DriverV2, error) {
	var d DriverV2
	err := r.pool.QueryRow(ctx, `
		SELECT id, user_id, campus_id,
		       is_verified, is_women_only, is_premium_eligible, is_accessibility_trained,
		       trust_score, acceptance_rate, cancellation_rate,
		       completed_trips, total_earnings, rating, rating_count,
		       status, current_vehicle_id, current_lat, current_lng, last_ping_at,
		       created_at, updated_at
		FROM ride_drivers WHERE user_id = $1`, userID).Scan(
		&d.ID, &d.UserID, &d.CampusID,
		&d.IsVerified, &d.IsWomenOnly, &d.IsPremiumEligible, &d.IsAccessibilityTrained,
		&d.TrustScore, &d.AcceptanceRate, &d.CancellationRate,
		&d.CompletedTrips, &d.TotalEarnings, &d.Rating, &d.RatingCount,
		&d.Status, &d.CurrentVehicleID, &d.CurrentLat, &d.CurrentLng, &d.LastPingAt,
		&d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

// FindV2ByID is the same lookup by driver id.
func (r *Repository) FindV2ByID(ctx context.Context, id uuid.UUID) (*DriverV2, error) {
	var d DriverV2
	err := r.pool.QueryRow(ctx, `
		SELECT id, user_id, campus_id,
		       is_verified, is_women_only, is_premium_eligible, is_accessibility_trained,
		       trust_score, acceptance_rate, cancellation_rate,
		       completed_trips, total_earnings, rating, rating_count,
		       status, current_vehicle_id, current_lat, current_lng, last_ping_at,
		       created_at, updated_at
		FROM ride_drivers WHERE id = $1`, id).Scan(
		&d.ID, &d.UserID, &d.CampusID,
		&d.IsVerified, &d.IsWomenOnly, &d.IsPremiumEligible, &d.IsAccessibilityTrained,
		&d.TrustScore, &d.AcceptanceRate, &d.CancellationRate,
		&d.CompletedTrips, &d.TotalEarnings, &d.Rating, &d.RatingCount,
		&d.Status, &d.CurrentVehicleID, &d.CurrentLat, &d.CurrentLng, &d.LastPingAt,
		&d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

// FindAvailableNearbyV2 queries the new ride_drivers + current vehicle
// for campus-aware filtering. The composite score mirrors the V1
// implementation but is recomputed against the V2 columns.
func (r *Repository) FindAvailableNearbyV2(ctx context.Context, lat, lng, radiusMeters float64, campusID uuid.UUID, womenOnly bool) ([]DriverWithDistance, error) {
	q := `
		SELECT d.id, d.user_id, d.campus_id, d.license_number, v.vehicle_type::text AS vehicle_type,
		       '' as vehicle_number, '' as vehicle_color,
		       d.is_verified, CASE WHEN d.status IN ('online','on_break','enroute_to_pickup','arrived_at_pickup') THEN true ELSE false END AS is_available,
		       d.is_women_only, d.completed_trips, d.created_at, d.updated_at,
		       (6371000 * acos(LEAST(1.0, GREATEST(-1.0,
		           cos(radians($1)) * cos(radians(d.current_lat)) * cos(radians(d.current_lng) - radians($2))
		           + sin(radians($1)) * sin(radians(d.current_lat))
		       )))) AS distance_meters,
		       d.trust_score AS trust_score,
		       ((6371000 * acos(LEAST(1.0, GREATEST(-1.0,
		           cos(radians($1)) * cos(radians(d.current_lat)) * cos(radians(d.current_lng) - radians($2))
		           + sin(radians($1)) * sin(radians(d.current_lat))
		       )))) * 0.6 + ((5.0 - d.trust_score) * 0.4 * 1000)) AS composite_score
		FROM ride_drivers d
		LEFT JOIN ride_vehicles v ON v.id = d.current_vehicle_id
		WHERE d.is_verified = true
		  AND d.status IN ('online','on_break')
		  AND d.current_lat IS NOT NULL
		  AND d.campus_id = $3
		  AND (6371000 * acos(LEAST(1.0, GREATEST(-1.0,
		      cos(radians($1)) * cos(radians(d.current_lat)) * cos(radians(d.current_lng) - radians($2))
		      + sin(radians($1)) * sin(radians(d.current_lat))
		  )))) <= $4`
	if womenOnly {
		q += ` AND d.is_women_only = true`
	}
	q += ` ORDER BY composite_score ASC LIMIT 10`
	rows, err := r.pool.Query(ctx, q, lat, lng, campusID, radiusMeters)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var drivers []DriverWithDistance
	for rows.Next() {
		var dwd DriverWithDistance
		if err := rows.Scan(
			&dwd.ID, &dwd.UserID, &dwd.CampusID, &dwd.LicenseNumber, &dwd.VehicleType,
			&dwd.VehicleNumber, &dwd.VehicleColor,
			&dwd.IsVerified, &dwd.IsAvailable, &dwd.IsWomenOnly,
			&dwd.TotalRides, &dwd.CreatedAt, &dwd.UpdatedAt,
			&dwd.DistanceMeters, &dwd.TrustScore, &dwd.CompositeScore,
		); err != nil {
			return nil, err
		}
		drivers = append(drivers, dwd)
	}
	return drivers, nil
}

// RecomputeRating recalculates the driver's average rating from ride_ratings.
func (r *Repository) RecomputeRating(ctx context.Context, driverID uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE ride_drivers d
		SET rating = COALESCE((
		        SELECT AVG(rating)::numeric(3,2)
		        FROM ride_ratings rr
		        JOIN ride_drivers rd ON rd.user_id = rr.ratee_id
		        WHERE rd.id = d.id
		    ), 5.00),
		    rating_count = COALESCE((
		        SELECT COUNT(*)
		        FROM ride_ratings rr
		        JOIN ride_drivers rd ON rd.user_id = rr.ratee_id
		        WHERE rd.id = d.id
		    ), 0)
		WHERE d.id = $1`, driverID)
	return err
}

// FindByUserID (V2) is the canonical FindByUserID for the new schema.
// The existing V1 driver.Repository.FindByUserID is preserved below for
// the legacy endpoints.
func (r *Repository) FindByUserIDV2(ctx context.Context, userID uuid.UUID) (*DriverV2, error) {
	return r.FindV2ByUserID(ctx, userID)
}
