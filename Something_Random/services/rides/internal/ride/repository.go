package ride

// =============================================================================
// Repository — Ride & Go
//
// Owns every SQL access to the rides family of tables. Designed for the full
// lifecycle: request → match → in-progress → complete, plus cancellations,
// re-dispatch, sharing, pooling, scheduled rides, promos, ratings, and
// immutable trip telemetry. All multi-row mutations run inside a transaction
// passed by the caller so the service layer can compose them with payments,
// ledger entries, driver state, etc.
//
// Conventions
//   - All query methods take a context.Context first.
//   - Errors are wrapped with `fmt.Errorf("rides.<op>: %w", err)`.
//   - pgx.ErrNoRows becomes a typed `ErrNotFound`.
//   - Each repository method is safe to call concurrently; all state machines
//     are gated by a `version` column for optimistic locking.
//   - Mutations return the post-image so callers don't need a second read.
// =============================================================================

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is the canonical "row not found" sentinel.
var ErrNotFound = errors.New("rides: not found")

// ErrVersionConflict is returned when optimistic locking detects a stale read.
var ErrVersionConflict = errors.New("rides: version conflict")

// Repository exposes the entire ride data surface.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRideRepository wires the repo to a pgx pool.
func NewRideRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

// Pool exposes the underlying connection pool (used by services that need to
// compose multi-table transactions).
func (r *Repository) Pool() *pgxpool.Pool { return r.pool }

// -----------------------------------------------------------------------------
// CREATE
// -----------------------------------------------------------------------------

// CreateRide inserts a freshly-requested ride. Computes the postGIS geography
// from the lat/lng columns and returns the post-image.
func (r *Repository) CreateRide(ctx context.Context, ride *Ride) (*Ride, error) {
	const q = `
INSERT INTO rides (
    rider_id, ride_type, status, campus_id,
    pickup_address, pickup_lat, pickup_lng, pickup_point, pickup_landmark, pickup_place_id, pickup_floor, pickup_unit,
    dropoff_address, dropoff_lat, dropoff_lng, dropoff_point, dropoff_landmark, dropoff_place_id, dropoff_floor, dropoff_unit,
    stops, currency,
    base_fare_cents, distance_fare_cents, time_fare_cents, surge_amount_cents, surge_multiplier,
    toll_cents, tax_cents, platform_fee_cents, total_fare_cents,
    estimated_fare_min_cents, estimated_fare_max_cents,
    estimated_distance_km, estimated_duration_s,
    payment_method_id, promo_code,
    is_scheduled, scheduled_for, is_pool, is_corporate, corporate_account_id,
    is_accessibility, is_pet_friendly, is_women_only,
    accessibility_needs, pet_count, luggage_count, luggage_size, passenger_count,
    surge_zone_id, demand_score, supply_score, search_radius_km,
    rider_app_version, source, metadata
) VALUES (
    $1,$2,'requested',$3,
    $4,$5,$6,ST_SetSRID(ST_MakePoint($6,$5),4326)::geography,$7,$8,$9,$10,
    $11,$12,$13,ST_SetSRID(ST_MakePoint($13,$12),4326)::geography,$14,$15,$16,$17,
    $18,$19,
    $20,$21,$22,$23,$24,$25,
    $26,$27,$28,$29,
    $30,$31,
    $32,$33,
    $34,$35,
    $36,$37,$38,$39,$40,
    $41,$42,$43,
    $44,$45,$46,$47,$48,
    $49,$50,$51,$52,
    $53,$54,$55
)
RETURNING id, ride_code, share_token, version, requested_at, created_at, updated_at, status
`
	err := r.pool.QueryRow(ctx, q,
		ride.RiderID, ride.RideType, ride.CampusID,
		ride.PickupAddress, ride.PickupLat, ride.PickupLng, ride.PickupLandmark, ride.PickupPlaceID, ride.PickupFloor, ride.PickupUnit,
		ride.DropoffAddress, ride.DropoffLat, ride.DropoffLng, ride.DropoffLandmark, ride.DropoffPlaceID, ride.DropoffFloor, ride.DropoffUnit,
		ride.StopsJSON, ride.Currency,
		ride.BaseFareCents, ride.DistanceFareCents, ride.TimeFareCents, ride.SurgeAmountCents, ride.SurgeMultiplier,
		ride.TollCents, ride.TaxCents, ride.PlatformFeeCents, ride.TotalFareCents,
		ride.EstimatedFareMinCents, ride.EstimatedFareMaxCents,
		ride.EstimatedDistanceKm, ride.EstimatedDurationS,
		ride.PaymentMethodID, ride.PromoCode,
		ride.IsScheduled, ride.ScheduledFor, ride.IsPool, ride.IsCorporate, ride.CorporateAccountID,
		ride.IsAccessibility, ride.IsPetFriendly, ride.IsWomenOnly,
		ride.AccessibilityJSON, ride.PetCount, ride.LuggageCount, ride.LuggageSize, ride.PassengerCount,
		ride.SurgeZoneID, ride.DemandScore, ride.SupplyScore, ride.SearchRadiusKm,
		ride.RiderAppVersion, ride.Source, ride.Metadata,
	).Scan(&ride.ID, &ride.RideCode, &ride.ShareToken, &ride.Version, &ride.RequestedAt, &ride.CreatedAt, &ride.UpdatedAt, &ride.Status)
	if err != nil {
		return nil, fmt.Errorf("rides.CreateRide: %w", err)
	}
	return ride, nil
}

// -----------------------------------------------------------------------------
// READ — every read uses SELECT * so adding columns doesn't break callers.
// -----------------------------------------------------------------------------

// GetByID fetches a ride by primary key.
func (r *Repository) GetByID(ctx context.Context, id uuid.UUID) (*Ride, error) {
	return r.fetchOne(ctx, `SELECT row_to_json(r) FROM rides r WHERE id = $1 AND deleted_at IS NULL`, id)
}

// GetByCode fetches a ride by its short human-facing code.
func (r *Repository) GetByCode(ctx context.Context, code string) (*Ride, error) {
	return r.fetchOne(ctx, `SELECT row_to_json(r) FROM rides r WHERE ride_code = $1 AND deleted_at IS NULL`, code)
}

// GetByShareToken fetches a ride via its public share token.
func (r *Repository) GetByShareToken(ctx context.Context, token string) (*Ride, error) {
	return r.fetchOne(ctx, `SELECT row_to_json(r) FROM rides r WHERE share_token = $1 AND deleted_at IS NULL`, token)
}

// ListByRider returns paginated rides for a rider, newest first.
func (r *Repository) ListByRider(ctx context.Context, riderID uuid.UUID, status *RideStatus, limit, offset int) ([]*Ride, error) {
	args := []any{riderID}
	q := `SELECT row_to_json(r) FROM rides r WHERE rider_id = $1 AND deleted_at IS NULL`
	if status != nil {
		args = append(args, *status)
		q += fmt.Sprintf(" AND status = $%d", len(args))
	}
	args = append(args, limit, offset)
	q += fmt.Sprintf(" ORDER BY requested_at DESC LIMIT $%d OFFSET $%d", len(args)-1, len(args))
	return r.fetchMany(ctx, q, args...)
}

// ListByDriver returns paginated rides for a driver, newest first.
func (r *Repository) ListByDriver(ctx context.Context, driverID uuid.UUID, status *RideStatus, limit, offset int) ([]*Ride, error) {
	args := []any{driverID}
	q := `SELECT row_to_json(r) FROM rides r WHERE driver_id = $1 AND deleted_at IS NULL`
	if status != nil {
		args = append(args, *status)
		q += fmt.Sprintf(" AND status = $%d", len(args))
	}
	args = append(args, limit, offset)
	q += fmt.Sprintf(" ORDER BY requested_at DESC LIMIT $%d OFFSET $%d", len(args)-1, len(args))
	return r.fetchMany(ctx, q, args...)
}

// ListInFlightByRider returns any active (non-terminal) rides for a rider.
func (r *Repository) ListInFlightByRider(ctx context.Context, riderID uuid.UUID) ([]*Ride, error) {
	const q = `SELECT row_to_json(r) FROM rides r WHERE rider_id = $1 AND status IN ('requested','searching','driver_assigned','driver_enroute','driver_arrived','in_progress') AND deleted_at IS NULL`
	return r.fetchMany(ctx, q, riderID)
}

// ListInFlightByDriver returns any active rides for a driver.
func (r *Repository) ListInFlightByDriver(ctx context.Context, driverID uuid.UUID) ([]*Ride, error) {
	const q = `SELECT row_to_json(r) FROM rides r WHERE driver_id = $1 AND status IN ('driver_assigned','driver_enroute','driver_arrived','in_progress') AND deleted_at IS NULL`
	return r.fetchMany(ctx, q, driverID)
}

// CountByStatus is the workhorse query for dashboards / hot counters.
func (r *Repository) CountByStatus(ctx context.Context, campusID *uuid.UUID, since time.Time) (map[RideStatus]int, error) {
	args := []any{since}
	q := `SELECT status, COUNT(*) FROM rides WHERE deleted_at IS NULL AND requested_at >= $1`
	if campusID != nil {
		args = append(args, *campusID)
		q += fmt.Sprintf(" AND campus_id = $%d", len(args))
	}
	q += " GROUP BY status"
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("rides.CountByStatus: %w", err)
	}
	defer rows.Close()
	out := make(map[RideStatus]int, 16)
	for rows.Next() {
		var s string
		var c int
		if err := rows.Scan(&s, &c); err != nil {
			return nil, fmt.Errorf("rides.CountByStatus scan: %w", err)
		}
		out[RideStatus(s)] = c
	}
	return out, rows.Err()
}

// ListForSurgeRecalc is a high-throughput call from the dispatch worker.
func (r *Repository) ListForSurgeRecalc(ctx context.Context, since time.Time, campusID *uuid.UUID, limit int) ([]*Ride, error) {
	args := []any{since}
	q := `SELECT row_to_json(r) FROM rides r WHERE status IN ('completed','cancelled') AND completed_at >= $1`
	if campusID != nil {
		args = append(args, *campusID)
		q += fmt.Sprintf(" AND campus_id = $%d", len(args))
	}
	args = append(args, limit)
	q += fmt.Sprintf(" ORDER BY completed_at DESC LIMIT $%d", len(args))
	return r.fetchMany(ctx, q, args...)
}

// ListByIDs fetches many rides in one round-trip.
func (r *Repository) ListByIDs(ctx context.Context, ids []uuid.UUID) ([]*Ride, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	q := `SELECT row_to_json(r) FROM rides r WHERE id = ANY($1) AND deleted_at IS NULL`
	return r.fetchMany(ctx, q, ids)
}

// -----------------------------------------------------------------------------
// STATE TRANSITIONS — every transition bumps version
// -----------------------------------------------------------------------------

// AssignDriver sets status=driver_assigned, attaches driver+vehicle, computes ETA.
func (r *Repository) AssignDriver(ctx context.Context, rideID, driverID, vehicleID uuid.UUID, matchScore, distanceKm, etaS float64, expectedVersion int) (*Ride, error) {
	const q = `
UPDATE rides SET
    status = 'driver_assigned',
    driver_id = $2,
    vehicle_id = $3,
    match_score = $4,
    distance_to_pickup_km = $5,
    eta_to_pickup_s = $6,
    driver_assigned_at = now(),
    driver_enroute_at = now(),
    version = version + 1,
    updated_at = now()
WHERE id = $1 AND version = $7 AND status IN ('requested','searching') AND deleted_at IS NULL
RETURNING row_to_json(rides)
`
	return r.fetchOne(ctx, q, rideID, driverID, vehicleID, matchScore, distanceKm, int(etaS), expectedVersion)
}

// MarkEnroute transitions to driver_enroute.
func (r *Repository) MarkEnroute(ctx context.Context, rideID uuid.UUID, expectedVersion int) (*Ride, error) {
	const q = `UPDATE rides SET status='driver_enroute', driver_enroute_at = COALESCE(driver_enroute_at, now()), version = version + 1, updated_at = now() WHERE id = $1 AND version = $2 AND status = 'driver_assigned' AND deleted_at IS NULL RETURNING row_to_json(rides)`
	return r.fetchOne(ctx, q, rideID, expectedVersion)
}

// MarkArrived transitions to driver_arrived.
func (r *Repository) MarkArrived(ctx context.Context, rideID uuid.UUID, expectedVersion int) (*Ride, error) {
	const q = `UPDATE rides SET status='driver_arrived', driver_arrived_at = now(), version = version + 1, updated_at = now() WHERE id = $1 AND version = $2 AND status IN ('driver_assigned','driver_enroute') AND deleted_at IS NULL RETURNING row_to_json(rides)`
	return r.fetchOne(ctx, q, rideID, expectedVersion)
}

// StartTrip transitions to in_progress and stamps the start time.
func (r *Repository) StartTrip(ctx context.Context, rideID uuid.UUID, expectedVersion int, startLat, startLng float64) (*Ride, error) {
	const q = `UPDATE rides SET status='in_progress', in_progress_at = now(), start_lat = $3, start_lng = $4, start_point = ST_SetSRID(ST_MakePoint($4,$3),4326)::geography, version = version + 1, updated_at = now() WHERE id = $1 AND version = $2 AND status = 'driver_arrived' AND deleted_at IS NULL RETURNING row_to_json(rides)`
	return r.fetchOne(ctx, q, rideID, expectedVersion, startLat, startLng)
}

// CompleteTrip transitions to completed and writes final fare/metrics.
func (r *Repository) CompleteTrip(ctx context.Context, rideID uuid.UUID, expectedVersion int, finish RideCompletion) (*Ride, error) {
	const q = `UPDATE rides SET
status = 'completed', completed_at = now(),
end_lat = $3, end_lng = $4, end_point = ST_SetSRID(ST_MakePoint($4,$3),4326)::geography,
actual_distance_km = $5, actual_duration_s = $6,
distance_fare_cents = $7, time_fare_cents = $8, toll_cents = $9, tax_cents = $10, platform_fee_cents = $11,
tip_cents = $12, total_fare_cents = $13, rider_paid_cents = $13, driver_earnings_cents = $14,
polyline_encoded = $15, version = version + 1, updated_at = now()
WHERE id = $1 AND version = $16 AND status = 'in_progress' AND deleted_at IS NULL
RETURNING row_to_json(rides)`
	return r.fetchOne(ctx, q,
		rideID, expectedVersion,
		finish.EndLat, finish.EndLng,
		finish.DistanceKm, finish.DurationS,
		finish.DistanceFareCents, finish.TimeFareCents,
		finish.TollCents, finish.TaxCents, finish.PlatformFeeCents,
		finish.TipCents, finish.TotalFareCents, finish.DriverEarningsCents,
		finish.PolylineEncoded,
	)
}

// Cancel transitions to cancelled with the supplied reason/actor and writes a
// row into ride_cancellation_log atomically.
func (r *Repository) Cancel(ctx context.Context, rideID uuid.UUID, expectedVersion int, cancel Cancellation) (*Ride, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return nil, fmt.Errorf("rides.Cancel begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const q = `UPDATE rides SET
status = 'cancelled', cancelled_at = now(),
cancellation_reason = $3, cancellation_actor = $4, cancellation_note = $5,
cancellation_fee_cents = $6, version = version + 1, updated_at = now()
WHERE id = $1 AND version = $2 AND status IN ('requested','searching','driver_assigned','driver_enroute','driver_arrived') AND deleted_at IS NULL
RETURNING row_to_json(rides)`
	ride, err := fetchOneTx(ctx, tx, q, rideID, expectedVersion, cancel.Reason, cancel.Actor, cancel.Note, cancel.FeeCents)
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO ride_cancellation_log (ride_id, cancelled_by, actor_role, reason, note, fee_charged_cents, refund_issued_cents)
VALUES ($1, $2, $3, $4, $5, $6, $7)`, rideID, cancel.CancelledBy, cancel.Actor, cancel.Reason, cancel.Note, cancel.FeeCents, cancel.RefundCents); err != nil {
		return nil, fmt.Errorf("rides.Cancel log: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("rides.Cancel commit: %w", err)
	}
	return ride, nil
}

// MarkNoShow transitions to no_show when neither party shows up.
func (r *Repository) MarkNoShow(ctx context.Context, rideID uuid.UUID, expectedVersion int) (*Ride, error) {
	const q = `UPDATE rides SET status='no_show', no_show_at = now(), version = version + 1, updated_at = now() WHERE id = $1 AND version = $2 AND status IN ('driver_arrived','driver_enroute') AND deleted_at IS NULL RETURNING row_to_json(rides)`
	return r.fetchOne(ctx, q, rideID, expectedVersion)
}

// SetStatus is a generic setter used by the matching sweep worker.
func (r *Repository) SetStatus(ctx context.Context, rideID uuid.UUID, expectedVersion int, status RideStatus) (*Ride, error) {
	const q = `UPDATE rides SET status=$3, version=version+1, updated_at=now() WHERE id=$1 AND version=$2 AND deleted_at IS NULL RETURNING row_to_json(rides)`
	return r.fetchOne(ctx, q, rideID, expectedVersion, status)
}

// IncOfferCount bumps the offer counter and search radius.
func (r *Repository) IncOfferCount(ctx context.Context, rideID uuid.UUID, searchRadiusKm float64) error {
	_, err := r.pool.Exec(ctx, `UPDATE rides SET driver_offer_count = driver_offer_count + 1, search_radius_km = $2, updated_at = now() WHERE id = $1`, rideID, searchRadiusKm)
	if err != nil {
		return fmt.Errorf("rides.IncOfferCount: %w", err)
	}
	return nil
}

// SetPromoRedemption stores the promo binding and adjusts the discount.
func (r *Repository) SetPromoRedemption(ctx context.Context, rideID, redemptionID uuid.UUID, promoCode string, discountCents int64) error {
	_, err := r.pool.Exec(ctx, `UPDATE rides SET promo_redemption_id=$2, promo_code=$3, promo_discount_cents=$4, total_fare_cents = GREATEST(0, total_fare_cents - $4), updated_at=now() WHERE id=$1`,
		rideID, redemptionID, promoCode, discountCents)
	if err != nil {
		return fmt.Errorf("rides.SetPromoRedemption: %w", err)
	}
	return nil
}

// SetPaymentInfo persists the payment-method pointer and the gateway hold ID.
func (r *Repository) SetPaymentInfo(ctx context.Context, rideID, paymentMethodID uuid.UUID, holdID, intentID string) error {
	_, err := r.pool.Exec(ctx, `UPDATE rides SET payment_method_id=$2, payment_hold_id=$3, payment_intent_id=$4, payment_authorized_at = now(), payment_status = 'authorized', updated_at=now() WHERE id=$1`,
		rideID, paymentMethodID, holdID, intentID)
	if err != nil {
		return fmt.Errorf("rides.SetPaymentInfo: %w", err)
	}
	return nil
}

// SetPaymentStatus updates the payment status and timestamps.
func (r *Repository) SetPaymentStatus(ctx context.Context, rideID uuid.UUID, status RidePaymentStatus, capturedAt, refundedAt *time.Time) error {
	_, err := r.pool.Exec(ctx, `UPDATE rides SET payment_status=$2, payment_captured_at = COALESCE($3, payment_captured_at), payment_refunded_at = COALESCE($4, payment_refunded_at), updated_at=now() WHERE id=$1`,
		rideID, status, capturedAt, refundedAt)
	if err != nil {
		return fmt.Errorf("rides.SetPaymentStatus: %w", err)
	}
	return nil
}

// AddTip stamps a tip on the ride.
func (r *Repository) AddTip(ctx context.Context, rideID uuid.UUID, tipCents int64) error {
	_, err := r.pool.Exec(ctx, `UPDATE rides SET tip_cents = tip_cents + $2, total_fare_cents = total_fare_cents + $2, rider_paid_cents = rider_paid_cents + $2, driver_earnings_cents = driver_earnings_cents + $2, updated_at=now() WHERE id=$1`,
		rideID, tipCents)
	if err != nil {
		return fmt.Errorf("rides.AddTip: %w", err)
	}
	return nil
}

// SetDriverRating stamps the rider's rating of the driver.
func (r *Repository) SetDriverRating(ctx context.Context, rideID uuid.UUID, rating int, tags []string, comment string) error {
	_, err := r.pool.Exec(ctx, `UPDATE rides SET driver_rating=$2, driver_rating_tags=$3, driver_rating_comment=$4, driver_rated_at=now(), updated_at=now() WHERE id=$1`,
		rideID, rating, tags, comment)
	if err != nil {
		return fmt.Errorf("rides.SetDriverRating: %w", err)
	}
	return nil
}

// SetRiderRating stamps the driver's rating of the rider.
func (r *Repository) SetRiderRating(ctx context.Context, rideID uuid.UUID, rating int, tags []string, comment string) error {
	_, err := r.pool.Exec(ctx, `UPDATE rides SET rider_rating=$2, rider_rating_tags=$3, rider_rating_comment=$4, rider_rated_at=now(), updated_at=now() WHERE id=$1`,
		rideID, rating, tags, comment)
	if err != nil {
		return fmt.Errorf("rides.SetRiderRating: %w", err)
	}
	return nil
}

// -----------------------------------------------------------------------------
// RIDE OFFERS
// -----------------------------------------------------------------------------

// InsertOffer stores an offer sent to a driver.
func (r *Repository) InsertOffer(ctx context.Context, offer *RideOffer) error {
	const q = `INSERT INTO ride_offers (ride_id, driver_id, offer_score, distance_to_pickup_km, eta_to_pickup_s, expires_at)
VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, offered_at`
	return r.pool.QueryRow(ctx, q, offer.RideID, offer.DriverID, offer.Score, offer.DistanceKm, offer.ETAS, offer.ExpiresAt).
		Scan(&offer.ID, &offer.OfferedAt)
}

// ListPendingOffers fetches all un-expired offers for a ride.
func (r *Repository) ListPendingOffers(ctx context.Context, rideID uuid.UUID) ([]*RideOffer, error) {
	const q = `SELECT id, ride_id, driver_id, offer_score, distance_to_pickup_km, eta_to_pickup_s, offered_at, expires_at
FROM ride_offers WHERE ride_id=$1 AND response IS NULL AND expires_at > now() ORDER BY offer_score DESC`
	rows, err := r.pool.Query(ctx, q, rideID)
	if err != nil {
		return nil, fmt.Errorf("rides.ListPendingOffers: %w", err)
	}
	defer rows.Close()
	var out []*RideOffer
	for rows.Next() {
		o := &RideOffer{}
		if err := rows.Scan(&o.ID, &o.RideID, &o.DriverID, &o.Score, &o.DistanceKm, &o.ETAS, &o.OfferedAt, &o.ExpiresAt); err != nil {
			return nil, fmt.Errorf("rides.ListPendingOffers scan: %w", err)
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// MarkOfferResponded records the driver response to an offer.
func (r *Repository) MarkOfferResponded(ctx context.Context, offerID uuid.UUID, response, declineReason string) error {
	_, err := r.pool.Exec(ctx, `UPDATE ride_offers SET response=$2, response_payload=$2, decline_reason=$3, responded_at=now() WHERE id=$1`,
		offerID, response, declineReason)
	if err != nil {
		return fmt.Errorf("rides.MarkOfferResponded: %w", err)
	}
	return nil
}

// ExpireOffers is called by the matching worker on every tick.
func (r *Repository) ExpireOffers(ctx context.Context, now time.Time) (int64, error) {
	tag, err := r.pool.Exec(ctx, `UPDATE ride_offers SET response='expired' WHERE response IS NULL AND expires_at < $1`, now)
	if err != nil {
		return 0, fmt.Errorf("rides.ExpireOffers: %w", err)
	}
	return tag.RowsAffected(), nil
}

// -----------------------------------------------------------------------------
// TRACKING
// -----------------------------------------------------------------------------

// InsertTrackingPoint is called from the driver's location stream.
func (r *Repository) InsertTrackingPoint(ctx context.Context, p TrackingPoint) error {
	const q = `INSERT INTO ride_tracking_points
(ride_id, driver_id, point, bearing_deg, speed_kph, accuracy_m, phase, battery_pct, distance_so_far_km, duration_so_far_s, recorded_at)
VALUES ($1,$2,ST_SetSRID(ST_MakePoint($4,$3),4326)::geography,$5,$6,$7,$8,$9,$10,$11,$12)`
	_, err := r.pool.Exec(ctx, q,
		p.RideID, p.DriverID, p.Lat, p.Lng, p.Bearing, p.Speed, p.Accuracy, p.Phase, p.Battery, p.DistanceSoFarKm, p.DurationSoFarS, p.RecordedAt)
	if err != nil {
		return fmt.Errorf("rides.InsertTrackingPoint: %w", err)
	}
	return nil
}

// GetTrackingStream returns the breadcrumb trail of a ride.
func (r *Repository) GetTrackingStream(ctx context.Context, rideID uuid.UUID, limit int) ([]*TrackingPoint, error) {
	const q = `SELECT ride_id, driver_id, ST_Y(point::geometry) AS lat, ST_X(point::geometry) AS lng, bearing_deg, speed_kph, accuracy_m, phase, battery_pct, distance_so_far_km, duration_so_far_s, recorded_at
FROM ride_tracking_points WHERE ride_id=$1 ORDER BY recorded_at ASC LIMIT $2`
	rows, err := r.pool.Query(ctx, q, rideID, limit)
	if err != nil {
		return nil, fmt.Errorf("rides.GetTrackingStream: %w", err)
	}
	defer rows.Close()
	var out []*TrackingPoint
	for rows.Next() {
		p := &TrackingPoint{}
		if err := rows.Scan(&p.RideID, &p.DriverID, &p.Lat, &p.Lng, &p.Bearing, &p.Speed, &p.Accuracy, &p.Phase, &p.Battery, &p.DistanceSoFarKm, &p.DurationSoFarS, &p.RecordedAt); err != nil {
			return nil, fmt.Errorf("rides.GetTrackingStream scan: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// -----------------------------------------------------------------------------
// RATINGS
// -----------------------------------------------------------------------------

// SubmitRating writes a single rating row (idempotent on (ride_id, rater_role)).
func (r *Repository) SubmitRating(ctx context.Context, rating *RideRating) error {
	const q = `INSERT INTO ride_ratings (ride_id, rater_id, rater_role, ratee_id, ratee_role, rating, tags, comment, is_public, category_breakdown)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
ON CONFLICT (ride_id, rater_role) DO UPDATE SET rating=EXCLUDED.rating, tags=EXCLUDED.tags, comment=EXCLUDED.comment, category_breakdown=EXCLUDED.category_breakdown
RETURNING id, created_at`
	return r.pool.QueryRow(ctx, q, rating.RideID, rating.RaterID, rating.RaterRole, rating.RateeID, rating.RateeRole, rating.Rating, rating.Tags, rating.Comment, rating.IsPublic, rating.CategoryBreakdown).
		Scan(&rating.ID, &rating.CreatedAt)
}

// GetRatingForRide returns the rating (if any) submitted by a single party.
func (r *Repository) GetRatingForRide(ctx context.Context, rideID uuid.UUID, raterRole string) (*RideRating, error) {
	const q = `SELECT id, ride_id, rater_id, rater_role, ratee_id, ratee_role, rating, tags, comment, is_public, created_at
FROM ride_ratings WHERE ride_id=$1 AND rater_role=$2`
	rating := &RideRating{}
	var tags []string
	var comment *string
	err := r.pool.QueryRow(ctx, q, rideID, raterRole).Scan(
		&rating.ID, &rating.RideID, &rating.RaterID, &rating.RaterRole, &rating.RateeID, &rating.RateeRole,
		&rating.Rating, &tags, &comment, &rating.IsPublic, &rating.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("rides.GetRatingForRide: %w", err)
	}
	rating.Tags = tags
	rating.Comment = comment
	return rating, nil
}

// -----------------------------------------------------------------------------
// POOL
// -----------------------------------------------------------------------------

// CreatePool opens a new pool session.
func (r *Repository) CreatePool(ctx context.Context, p *RidePool) error {
	const q = `INSERT INTO ride_pools (driver_id, vehicle_id, max_seats, discount_pct, pickup_point, dropoff_point)
VALUES ($1,$2,$3,$4,ST_SetSRID(ST_MakePoint($6,$5),4326)::geography,ST_SetSRID(ST_MakePoint($8,$7),4326)::geography)
RETURNING id, created_at, updated_at, status`
	return r.pool.QueryRow(ctx, q, p.DriverID, p.VehicleID, p.MaxSeats, p.DiscountPct,
		p.PickupLat, p.PickupLng, p.DropoffLat, p.DropoffLng).
		Scan(&p.ID, &p.CreatedAt, &p.UpdatedAt, &p.Status)
}

// AddRideToPool links a ride to an open pool.
func (r *Repository) AddRideToPool(ctx context.Context, poolID, rideID uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `UPDATE rides SET pool_id=$2, updated_at=now() WHERE id=$1`, rideID, poolID)
	if err != nil {
		return fmt.Errorf("rides.AddRideToPool: %w", err)
	}
	return nil
}

// ClosePool marks a pool as completed.
func (r *Repository) ClosePool(ctx context.Context, poolID uuid.UUID, totalDistanceKm float64, totalFareCents int64) error {
	_, err := r.pool.Exec(ctx, `UPDATE ride_pools SET status='completed', completed_at=now(), total_distance_km=$2, total_actual_fare_cents=$3 WHERE id=$1`,
		poolID, totalDistanceKm, totalFareCents)
	if err != nil {
		return fmt.Errorf("rides.ClosePool: %w", err)
	}
	return nil
}

// -----------------------------------------------------------------------------
// SHARE LINKS
// -----------------------------------------------------------------------------

// CreateShareLink grants a temporary public link to view the trip.
func (r *Repository) CreateShareLink(ctx context.Context, link *RideShareLink) error {
	const q = `INSERT INTO ride_share_links (ride_id, token, created_by, expires_at, shared_with)
VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at, status`
	return r.pool.QueryRow(ctx, q, link.RideID, link.Token, link.CreatedBy, link.ExpiresAt, link.SharedWith).
		Scan(&link.ID, &link.CreatedAt, &link.Status)
}

// RevokeShareLink invalidates a share link.
func (r *Repository) RevokeShareLink(ctx context.Context, token string) error {
	_, err := r.pool.Exec(ctx, `UPDATE ride_share_links SET revoked_at=now(), status='revoked' WHERE token=$1`, token)
	if err != nil {
		return fmt.Errorf("rides.RevokeShareLink: %w", err)
	}
	return nil
}

// BumpShareView counts a view of a share link.
func (r *Repository) BumpShareView(ctx context.Context, token string) error {
	_, err := r.pool.Exec(ctx, `UPDATE ride_share_links SET view_count=view_count+1, last_viewed_at=now() WHERE token=$1 AND status='active' AND expires_at > now()`, token)
	if err != nil {
		return fmt.Errorf("rides.BumpShareView: %w", err)
	}
	return nil
}

// -----------------------------------------------------------------------------
// STOPS
// -----------------------------------------------------------------------------

// ReplaceStops wipes and reinserts the ordered stops for a ride.
func (r *Repository) ReplaceStops(ctx context.Context, rideID uuid.UUID, stops []RideStop) error {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("rides.ReplaceStops begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DELETE FROM ride_stops WHERE ride_id=$1`, rideID); err != nil {
		return fmt.Errorf("rides.ReplaceStops delete: %w", err)
	}
	for _, s := range stops {
		if _, err := tx.Exec(ctx, `INSERT INTO ride_stops (ride_id, stop_order, address, lat, lng, point, notes) VALUES ($1,$2,$3,$4,$5,ST_SetSRID(ST_MakePoint($5,$4),4326)::geography,$6)`,
			rideID, s.Order, s.Address, s.Lat, s.Lng, s.Notes); err != nil {
			return fmt.Errorf("rides.ReplaceStops insert: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("rides.ReplaceStops commit: %w", err)
	}
	return nil
}

// -----------------------------------------------------------------------------
// SCHEDULED RIDES
// -----------------------------------------------------------------------------

// CreateScheduledRide adds a future ride to the schedule.
func (r *Repository) CreateScheduledRide(ctx context.Context, s *ScheduledRide) error {
	const q = `INSERT INTO scheduled_rides (rider_id, scheduled_for, pickup_address, pickup_lat, pickup_lng, pickup_point,
dropoff_address, dropoff_lat, dropoff_lng, dropoff_point, ride_type, payment_method_id, estimated_fare_cents, notes)
VALUES ($1,$2,$3,$4,$5,ST_SetSRID(ST_MakePoint($5,$4),4326)::geography,$6,$7,$8,ST_SetSRID(ST_MakePoint($8,$7),4326)::geography,$9,$10,$11,$12)
RETURNING id, created_at, status`
	return r.pool.QueryRow(ctx, q, s.RiderID, s.ScheduledFor, s.PickupAddress, s.PickupLat, s.PickupLng,
		s.DropoffAddress, s.DropoffLat, s.DropoffLng, s.RideType, s.PaymentMethodID, s.EstimatedFareCents, s.Notes).
		Scan(&s.ID, &s.CreatedAt, &s.Status)
}

// ListUpcomingScheduled fetches scheduled rides ready to dispatch.
func (r *Repository) ListUpcomingScheduled(ctx context.Context, before time.Time) ([]*ScheduledRide, error) {
	const q = `SELECT id, rider_id, scheduled_for, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng,
ride_type, payment_method_id, estimated_fare_cents, notes, status FROM scheduled_rides
WHERE status='pending' AND scheduled_for <= $1 ORDER BY scheduled_for ASC LIMIT 200`
	rows, err := r.pool.Query(ctx, q, before)
	if err != nil {
		return nil, fmt.Errorf("rides.ListUpcomingScheduled: %w", err)
	}
	defer rows.Close()
	var out []*ScheduledRide
	for rows.Next() {
		s := &ScheduledRide{}
		if err := rows.Scan(&s.ID, &s.RiderID, &s.ScheduledFor, &s.PickupAddress, &s.PickupLat, &s.PickupLng, &s.DropoffAddress, &s.DropoffLat, &s.DropoffLng,
			&s.RideType, &s.PaymentMethodID, &s.EstimatedFareCents, &s.Notes, &s.Status); err != nil {
			return nil, fmt.Errorf("rides.ListUpcomingScheduled scan: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// SetScheduledRideID converts a scheduled_rides row into a real ride id.
func (r *Repository) SetScheduledRideID(ctx context.Context, scheduledID, rideID uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `UPDATE scheduled_rides SET ride_id=$2, status='dispatching', dispatched_at = now() WHERE id=$1`, scheduledID, rideID)
	if err != nil {
		return fmt.Errorf("rides.SetScheduledRideID: %w", err)
	}
	return nil
}

// -----------------------------------------------------------------------------
// INTERNAL HELPERS
// -----------------------------------------------------------------------------

// fetchOne runs a query that returns a single row of `row_to_json(rides)`.
func (r *Repository) fetchOne(ctx context.Context, q string, args ...any) (*Ride, error) {
	var raw []byte
	if err := r.pool.QueryRow(ctx, q, args...).Scan(&raw); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("rides.fetchOne: %w", err)
	}
	ride, err := unmarshalRide(raw)
	if err != nil {
		return nil, err
	}
	return ride, nil
}

// fetchMany runs a query returning many `row_to_json(rides)` rows.
func (r *Repository) fetchMany(ctx context.Context, q string, args ...any) ([]*Ride, error) {
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("rides.fetchMany: %w", err)
	}
	defer rows.Close()
	var out []*Ride
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, fmt.Errorf("rides.fetchMany scan: %w", err)
		}
		ride, err := unmarshalRide(raw)
		if err != nil {
			return nil, err
		}
		out = append(out, ride)
	}
	return out, rows.Err()
}

// fetchOneTx is the tx-bound variant of fetchOne.
func fetchOneTx(ctx context.Context, tx pgx.Tx, q string, args ...any) (*Ride, error) {
	var raw []byte
	if err := tx.QueryRow(ctx, q, args...).Scan(&raw); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrVersionConflict
		}
		return nil, fmt.Errorf("rides.fetchOneTx: %w", err)
	}
	ride, err := unmarshalRide(raw)
	if err != nil {
		return nil, err
	}
	return ride, nil
}
