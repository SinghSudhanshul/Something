package ride

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"

	"nexus/rides/internal/driver"
	"nexus/rides/internal/kafka"
	ridesWallet "nexus/rides/internal/wallet"
)

// Service handles ride lifecycle business logic.
type Service struct {
	repo         *RideRepository
	matching     *MatchingEngine
	fare         *FareCalculator
	driverRepo   *driver.Repository
	rdb          *redis.Client
	producer     *kafka.Producer
	logger       *zap.Logger
	audit        *AuditRecorder
	config       ServiceConfig
	wallet       ridesWallet.Client
}

// ServiceConfig captures tuning knobs.
type ServiceConfig struct {
	MaxWaitForDriverSec  int
	DriverOfferTTLSec    int
	PoolMatchWindowSec   int
	TrackingFlushBatch   int
	FraudScoreThreshold  float64
	NightTimeMultiplier  decimal.Decimal
	WeekendMultiplier    decimal.Decimal
	HolidayMultiplier    decimal.Decimal
}

// DefaultServiceConfig returns a production-sane default.
func DefaultServiceConfig() ServiceConfig {
	return ServiceConfig{
		MaxWaitForDriverSec: 300,
		DriverOfferTTLSec:   35,
		PoolMatchWindowSec:  90,
		TrackingFlushBatch:  10,
		FraudScoreThreshold: 0.85,
		NightTimeMultiplier: decimal.RequireFromString("1.25"),
		WeekendMultiplier:   decimal.RequireFromString("1.10"),
		HolidayMultiplier:   decimal.RequireFromString("1.30"),
	}
}

// NewService wires the service.
func NewService(
	repo *RideRepository,
	matching *MatchingEngine,
	fare *FareCalculator,
	driverRepo *driver.Repository,
	rdb *redis.Client,
	producer *kafka.Producer,
	logger *zap.Logger,
	cfg ServiceConfig,
	walletClient ridesWallet.Client,
) *Service {
	if cfg.MaxWaitForDriverSec == 0 {
		cfg = DefaultServiceConfig()
	}
	if walletClient == nil {
		// Fall back to stub so unit tests / dev don't need the wallet up.
		walletClient = ridesWallet.NewStub()
	}
	return &Service{
		repo:       repo,
		matching:   matching,
		fare:       fare,
		driverRepo: driverRepo,
		rdb:        rdb,
		producer:   producer,
		logger:     logger,
		audit:      NewAuditRecorder(repo, logger),
		config:     cfg,
		wallet:     walletClient,
	}
}

// RequestRideInput captures the rider's intent.
type RequestRideInput struct {
	CampusID          uuid.UUID
	PickupLat         float64
	PickupLng         float64
	PickupLabel       string
	PickupBuilding    string
	PickupFloor       string
	DropoffLat        float64
	DropoffLng        float64
	DropoffLabel      string
	DropoffBuilding   string
	DropoffFloor      string
	RideType          string
	IsWomenOnly       bool
	PassengerCount    int
	LuggageCount      int
	Accessibility     []map[string]any
	PaymentMethod     string
	CouponCode        string
	ScheduledAt       *time.Time
	Notes             string
}

// RequestRideResponse is the API output after creating a ride request.
type RequestRideResponse struct {
	RideID         uuid.UUID       `json:"ride_id"`
	EstimatedFare  decimal.Decimal `json:"estimated_fare"`
	SurgeMultiplier decimal.Decimal `json:"surge_multiplier"`
	DistanceMeters int             `json:"distance_meters"`
	DurationSec    int             `json:"duration_sec"`
	Status         string          `json:"status"`
	PoolID         *uuid.UUID      `json:"pool_id,omitempty"`
	Message        string          `json:"message"`
}

// RequestRide creates a new ride request and starts matching asynchronously.
func (s *Service) RequestRide(ctx context.Context, riderID uuid.UUID, in RequestRideInput) (*RequestRideResponse, error) {
	if err := s.validateRequest(in); err != nil {
		return nil, err
	}
	if in.RideType == "" {
		in.RideType = "solo"
	}
	if in.PassengerCount <= 0 {
		in.PassengerCount = 1
	}
	if in.PaymentMethod == "" {
		in.PaymentMethod = "upi"
	}

	// 1. Compute estimated fare + surge.
	est := s.fare.Estimate(FareEstimateInput{
		PickupLat:    in.PickupLat,
		PickupLng:    in.PickupLng,
		DropoffLat:   in.DropoffLat,
		DropoffLng:   in.DropoffLng,
		RideType:     in.RideType,
		IsWomenOnly:  in.IsWomenOnly,
		CampusID:     in.CampusID,
		VehicleType:  s.defaultVehicleTypeFor(in.RideType),
		At:           time.Now(),
	})

	// 2. Compute distance + duration using Haversine fallback or routing cache.
	distanceM := haversineDistance(in.PickupLat, in.PickupLng, in.DropoffLat, in.DropoffLng)
	durationSec := estimateDurationSec(distanceM)

	// 3. Apply promo if present.
	promoDiscount := decimal.Zero
	if in.CouponCode != "" {
		if p, err := s.applyCoupon(ctx, in.CampusID, in.CouponID(), in.CouponCode, est.Total); err == nil {
			promoDiscount = p.Amount
			est.Total = est.Total.Sub(p.Amount)
			if est.Total.IsNegative() {
				est.Total = decimal.Zero
			}
		}
	}

	// 4. Persist ride.
	row, err := s.repo.Create(ctx, CreateInput{
		RiderID:            riderID,
		CampusID:           in.CampusID,
		PickupLat:          in.PickupLat,
		PickupLng:          in.PickupLng,
		PickupLabel:        in.PickupLabel,
		PickupBuilding:     in.PickupBuilding,
		PickupFloor:        in.PickupFloor,
		DropoffLat:         in.DropoffLat,
		DropoffLng:         in.DropoffLng,
		DropoffLabel:       in.DropoffLabel,
		DropoffBuilding:    in.DropoffBuilding,
		DropoffFloor:       in.DropoffFloor,
		RideType:           in.RideType,
		IsWomenOnly:        in.IsWomenOnly,
		PassengerCount:     in.PassengerCount,
		LuggageCount:       in.LuggageCount,
		AccessibilityNeeds: in.Accessibility,
		PaymentMethod:      in.PaymentMethod,
		EstimatedFare:      est.Total,
		SurgeMultiplier:    est.SurgeMultiplier,
		PromoCode:          in.CouponCode,
		PromoDiscount:      promoDiscount,
		CouponDiscount:     decimal.Zero,
		ScheduledAt:        in.ScheduledAt,
		Notes:              in.Notes,
		Tags:               s.deriveTags(in),
	})
	if err != nil {
		return nil, fmt.Errorf("create ride request: %w", err)
	}

	// 5. Patch derived fields (distance, duration) — single update keeps the
	// Create SQL lean and the after-create mutations auditable.
	if _, err := s.repo.Patch(ctx, row.ID, UpdateInput{
		ActualDistance: &distanceM,
	}); err != nil {
		s.logger.Warn("failed to patch ride distance", zap.Error(err))
	}

	// 6. Async matching if not scheduled.
	if in.ScheduledAt == nil || in.ScheduledAt.Before(time.Now().Add(30*time.Second)) {
		go func(rideID, campusID uuid.UUID, pickup LatLng, dropoff LatLng, womenOnly bool, rideType string) {
			_ = s.matching.MatchAsync(context.Background(), rideID, campusID, pickup, dropoff, womenOnly, rideType)
		}(row.ID, in.CampusID,
			LatLng{Lat: in.PickupLat, Lng: in.PickupLng},
			LatLng{Lat: in.DropoffLat, Lng: in.DropoffLng},
			in.IsWomenOnly, in.RideType)
	}

	// 7. Audit + Kafka.
	_ = s.audit.Record(ctx, AuditEntry{
		ActorID:   &riderID,
		ActorRole: "rider",
		Action:    "ride.requested",
		Entity:    "ride_request",
		EntityID:  &row.ID,
		RideID:    &row.ID,
		CampusID:  &in.CampusID,
		After: map[string]any{
			"estimated_fare":  est.Total.String(),
			"surge_multiplier": est.SurgeMultiplier.String(),
			"ride_type":       in.RideType,
		},
	})

	_ = s.producer.Publish(ctx, "rides.ride.requested", row.ID.String(), kafka.Event{
		Type: "rides.ride.requested",
		Payload: map[string]interface{}{
			"ride_id":           row.ID,
			"rider_id":          riderID,
			"campus_id":         in.CampusID,
			"pickup_lat":        in.PickupLat,
			"pickup_lng":        in.PickupLng,
			"dropoff_lat":       in.DropoffLat,
			"dropoff_lng":       in.DropoffLng,
			"ride_type":         in.RideType,
			"estimated_fare":    est.Total.StringFixed(2),
			"surge_multiplier":  est.SurgeMultiplier.StringFixed(2),
			"distance_meters":   distanceM,
			"duration_sec":      durationSec,
		},
	})

	// 8. Pre-authorize the rider's wallet. Skip hold when the rider chose
	//    cash-on-delivery (no funds to lock) but still create the ride.
	if in.PaymentMethod != "cash" && in.PaymentMethod != "cod" {
		holdCents := est.Total.Mul(decimal.NewFromInt(100)).IntPart()
		holdResp, holdErr := s.wallet.Hold(ctx, ridesWallet.HoldRequest{
			UserID:         riderID,
			AmountCents:    holdCents,
			RideID:         row.ID,
			Method:         in.PaymentMethod,
			IdempotencyKey: fmt.Sprintf("hold:%s", row.ID.String()),
			Notes:          fmt.Sprintf("Pre-authorize ride %s (%s)", row.ID, in.PaymentMethod),
		})
		if holdErr != nil {
			s.logger.Warn("wallet hold failed; ride will still be created",
				zap.String("ride_id", row.ID.String()),
				zap.Error(holdErr),
			)
		} else if holdResp != nil {
			// Persist the hold id so we can capture/release later.
			if _, err := s.repo.Patch(ctx, row.ID, UpdateInput{
				Metadata: map[string]any{
					"wallet_hold_id":     holdResp.HoldID,
					"wallet_hold_cents":  holdResp.AmountCents,
				},
			}); err != nil {
				s.logger.Warn("failed to patch ride with hold id", zap.Error(err))
			}
		}
	}

	return &RequestRideResponse{
		RideID:          row.ID,
		EstimatedFare:   est.Total,
		SurgeMultiplier: est.SurgeMultiplier,
		DistanceMeters:  distanceM,
		DurationSec:     durationSec,
		Status:          "requested",
		Message:         "Ride requested. Looking for nearby drivers.",
	}, nil
}

// CancelRide handles rider / driver / system cancellation.
func (s *Service) CancelRide(ctx context.Context, rideID uuid.UUID, by string, actorID uuid.UUID, reason string) (*RideRequestRow, error) {
	row, err := s.repo.FindByID(ctx, rideID)
	if err != nil {
		return nil, err
	}
	if isTerminal(row.Status) {
		return nil, fmt.Errorf("ride is already in terminal state: %s", row.Status)
	}
	cancellationFee := s.fare.CancellationFee(row.Status, row.EstimatedFare)
	updated, err := s.repo.CancelRide(ctx, rideID, by, reason)
	if err != nil {
		return nil, err
	}
	if cancellationFee.GreaterThan(decimal.Zero) {
		_, _ = s.repo.Patch(ctx, rideID, UpdateInput{
			Metadata: map[string]any{"cancellation_fee": cancellationFee.String()},
		})
	}

	// Release the wallet hold if one exists. If the cancel happens after
	// the driver has already been assigned, a small cancellation fee is
	// captured instead of a full release.
	if holdID, ok := readWalletHoldID(updated); ok {
		feeCents := cancellationFee.Mul(decimal.NewFromInt(100)).IntPart()
		holdCents := readWalletHoldCents(updated)
		if feeCents >= holdCents && holdCents > 0 {
			_, releaseErr := s.wallet.Release(ctx, ridesWallet.ReleaseRequest{
				HoldID:         holdID,
				UserID:         row.RiderID,
				IdempotencyKey: fmt.Sprintf("release:%s", holdID),
				Reason:         fmt.Sprintf("ride cancelled by %s: %s", by, reason),
			})
			if releaseErr != nil {
				s.logger.Warn("wallet release failed", zap.String("ride_id", rideID.String()), zap.Error(releaseErr))
			}
		} else if feeCents > 0 {
			_, captureErr := s.wallet.Capture(ctx, ridesWallet.CaptureRequest{
				HoldID:         holdID,
				UserID:         row.RiderID,
				AmountCents:    feeCents,
				FinalFare:      cancellationFee,
				RideID:         rideID,
				IdempotencyKey: fmt.Sprintf("capture:cancel:%s", holdID),
			})
			if captureErr != nil {
				s.logger.Warn("wallet capture (cancel fee) failed", zap.String("ride_id", rideID.String()), zap.Error(captureErr))
			}
		} else {
			_, releaseErr := s.wallet.Release(ctx, ridesWallet.ReleaseRequest{
				HoldID:         holdID,
				UserID:         row.RiderID,
				IdempotencyKey: fmt.Sprintf("release:%s", holdID),
				Reason:         fmt.Sprintf("ride cancelled by %s: %s", by, reason),
			})
			if releaseErr != nil {
				s.logger.Warn("wallet release failed", zap.String("ride_id", rideID.String()), zap.Error(releaseErr))
			}
		}
	}
	_ = s.producer.Publish(ctx, "rides.ride.cancelled", rideID.String(), kafka.Event{
		Type: "rides.ride.cancelled",
		Payload: map[string]interface{}{
			"ride_id":      rideID,
			"cancelled_by": by,
			"reason":       reason,
			"cancelled_at": updated.CancelledAt,
		},
	})
	_ = s.audit.Record(ctx, AuditEntry{
		ActorID:   &actorID,
		ActorRole: by,
		Action:    "ride.cancelled",
		Entity:    "ride_request",
		EntityID:  &rideID,
		RideID:    &rideID,
		After:     map[string]any{"reason": reason, "by": by, "fee": cancellationFee.String()},
	})
	return updated, nil
}

// AcceptRide is called by the driver app to accept an offer.
func (s *Service) AcceptRide(ctx context.Context, rideID, driverID, vehicleID uuid.UUID) (*RideRequestRow, error) {
	// Driver must be verified and online.
	drv, err := s.driverRepo.FindV2ByID(ctx, driverID)
	if err != nil {
		return nil, fmt.Errorf("driver lookup: %w", err)
	}
	if !drv.IsVerified {
		return nil, fmt.Errorf("driver is not verified")
	}
	if drv.Status != "online" && drv.Status != "on_break" && drv.Status != "enroute_to_pickup" {
		return nil, fmt.Errorf("driver is not available (status=%s)", drv.Status)
	}
	row, err := s.repo.AssignDriver(ctx, rideID, driverID, vehicleID)
	if err != nil {
		return nil, err
	}
	// Cache driver -> active ride for fast lookup.
	_ = s.rdb.Set(ctx, fmt.Sprintf("ride:active_driver:%s", driverID), rideID.String(), 2*time.Hour).Err()
	// Notify rider via Kafka and Redis.
	_ = s.producer.Publish(ctx, "rides.ride.accepted", rideID.String(), kafka.Event{
		Type: "rides.ride.accepted",
		Payload: map[string]interface{}{
			"ride_id":     rideID,
			"driver_id":   driverID,
			"accepted_at": time.Now().UTC(),
		},
	})
	_ = s.audit.Record(ctx, AuditEntry{
		ActorID:   &driverID,
		ActorRole: "driver",
		Action:    "ride.accepted",
		Entity:    "ride_request",
		EntityID:  &rideID,
		RideID:    &rideID,
		After:     map[string]any{"driver_id": driverID.String(), "vehicle_id": vehicleID.String()},
	})
	return row, nil
}

// UpdatePhase advances the trip phase and persists a tracking point.
func (s *Service) UpdatePhase(ctx context.Context, rideID, driverID uuid.UUID, phase string, location LatLng) (*RideRequestRow, error) {
	if !validPhase(phase) {
		return nil, fmt.Errorf("invalid phase: %s", phase)
	}
	var (
		updated *RideRequestRow
		err     error
	)
	switch phase {
	case "driver_enroute":
		updated, err = s.repo.MarkEnroute(ctx, rideID)
	case "arrived":
		updated, err = s.repo.MarkArrived(ctx, rideID)
	case "in_progress":
		updated, err = s.repo.MarkStarted(ctx, rideID)
	default:
		return nil, fmt.Errorf("phase %s is not a status update", phase)
	}
	if err != nil {
		return nil, err
	}
	if err := s.repo.AppendTracking(ctx, TrackingPoint{
		RideID:   rideID,
		DriverID: &driverID,
		Lat:      location.Lat,
		Lng:      location.Lng,
		Phase:    phase,
	}); err != nil {
		s.logger.Warn("append tracking", zap.Error(err))
	}
	topic := ""
	switch phase {
	case "driver_enroute":
		topic = "rides.ride.driver_enroute"
	case "arrived":
		topic = "rides.ride.driver_arrived"
	case "in_progress":
		topic = "rides.ride.started"
	}
	if topic != "" {
		_ = s.producer.Publish(ctx, topic, rideID.String(), kafka.Event{
			Type: topic,
			Payload: map[string]interface{}{
				"ride_id":  rideID,
				"driver_id": driverID,
				"phase":    phase,
				"lat":      location.Lat,
				"lng":      location.Lng,
				"ts":       time.Now().UTC(),
			},
		})
	}
	return updated, nil
}

// CompleteRide finalises the trip: compute actual distance, fare, and
// issue a payment record via the payment module.
func (s *Service) CompleteRide(ctx context.Context, rideID uuid.UUID) (*RideRequestRow, error) {
	row, err := s.repo.FindByID(ctx, rideID)
	if err != nil {
		return nil, err
	}
	if row.Status != "in_progress" {
		return nil, fmt.Errorf("ride not in progress (current=%s)", row.Status)
	}
	points, err := s.repo.TrackingForRide(ctx, rideID)
	if err != nil {
		return nil, err
	}
	distance := 0.0
	for i := 1; i < len(points); i++ {
		distance += haversineDistance(points[i-1].Lat, points[i-1].Lng, points[i].Lat, points[i].Lng)
	}
	duration := int(time.Since(*row.StartedAt).Seconds())
	finalFare := s.fare.Reconcile(row.EstimatedFare, decimal.NewFromFloat(distance), decimal.NewFromInt(int64(duration)), time.Now())
	updated, err := s.repo.MarkCompleted(ctx, rideID, finalFare, int(distance), duration)
	if err != nil {
		return nil, err
	}

	// 1. Capture the pre-authorised wallet hold. For cash rides there is
	//    no hold to capture — the driver collects payment in person.
	holdID, hasHold := readWalletHoldID(updated)
	if hasHold && row.PaymentMethod != "cash" && row.PaymentMethod != "cod" {
		fareCents := finalFare.Mul(decimal.NewFromInt(100)).IntPart()
		_, captureErr := s.wallet.Capture(ctx, ridesWallet.CaptureRequest{
			HoldID:         holdID,
			UserID:         row.RiderID,
			AmountCents:    fareCents,
			FinalFare:      finalFare,
			RideID:         rideID,
			IdempotencyKey: fmt.Sprintf("capture:%s", holdID),
		})
		if captureErr != nil {
			s.logger.Warn("wallet capture failed",
				zap.String("ride_id", rideID.String()),
				zap.Error(captureErr),
			)
		}
	}

	// 2. Credit the driver's earnings wallet. We pay the driver 80% of
	//    the final fare — NEXUS keeps a 20% platform fee. Cash rides
	//    still credit earnings (driver received cash from rider).
	if row.DriverID != nil {
		earnings := finalFare.Mul(decimal.RequireFromString("0.80"))
		earningsCents := earnings.Mul(decimal.NewFromInt(100)).IntPart()
		if earningsCents > 0 {
			_, earnErr := s.wallet.DebitDriverEarnings(ctx, ridesWallet.DriverEarningsRequest{
				DriverID:       *row.DriverID,
				AmountCents:    earningsCents,
				RideID:         rideID,
				IdempotencyKey: fmt.Sprintf("earning:%s", rideID.String()),
				Method:         row.PaymentMethod,
			})
			if earnErr != nil {
				s.logger.Warn("driver earnings credit failed",
					zap.String("ride_id", rideID.String()),
					zap.String("driver_id", row.DriverID.String()),
					zap.Error(earnErr),
				)
			}
		}
	}
	_ = s.producer.Publish(ctx, "rides.ride.completed", rideID.String(), kafka.Event{
		Type: "rides.ride.completed",
		Payload: map[string]interface{}{
			"ride_id":        rideID,
			"rider_id":       row.RiderID,
			"driver_id":      row.DriverID,
			"distance_meters": int(distance),
			"duration_sec":   duration,
			"final_fare":     finalFare.StringFixed(2),
			"payment_method": row.PaymentMethod,
			"completed_at":   updated.CompletedAt,
		},
	})
	return updated, nil
}

// RateRide persists a bidirectional rating and updates driver score.
func (s *Service) RateRide(ctx context.Context, rideID, raterID, rateeID uuid.UUID, rating int, tags []string, comment string) error {
	if rating < 1 || rating > 5 {
		return errors.New("rating must be between 1 and 5")
	}
	if err := s.repo.SaveRating(ctx, rideID, raterID, rateeID, rating, tags, comment); err != nil {
		return err
	}
	// Recompute ratee's average if they're a driver.
	drv, err := s.driverRepo.FindV2ByUserID(ctx, rateeID)
	if err == nil && drv != nil {
		_ = s.driverRepo.RecomputeRating(ctx, drv.ID)
	}
	topic := "rides.ride.rated"
	_ = s.producer.Publish(ctx, topic, rideID.String(), kafka.Event{
		Type: topic,
		Payload: map[string]interface{}{
			"ride_id":  rideID,
			"rater_id": raterID,
			"ratee_id": rateeID,
			"rating":   rating,
			"tags":     tags,
		},
	})
	return nil
}

// Tracking accepts a batch of tracking points from the driver app.
func (s *Service) Tracking(ctx context.Context, rideID, driverID uuid.UUID, points []TrackingPoint) error {
	if len(points) == 0 {
		return nil
	}
	tx, err := s.repo.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	for _, p := range points {
		p.RideID = rideID
		p.DriverID = &driverID
		if p.RecordedAt.IsZero() {
			p.RecordedAt = time.Now().UTC()
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO ride_tracking_points (
				ride_id, driver_id, lat, lng, bearing, speed_kph, accuracy_m, phase, battery_pct, recorded_at
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::trip_phase,$9,$10)`,
			p.RideID, p.DriverID, p.Lat, p.Lng, p.Bearing, p.SpeedKph, p.AccuracyM, p.Phase, p.BatteryPct, p.RecordedAt,
		); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// EstimateFare is a read-only fare preview that does NOT create a ride.
func (s *Service) EstimateFare(ctx context.Context, in FareEstimateInput) (*FareEstimate, error) {
	return s.fare.Estimate(in), nil
}

// PoolDetect runs a pool matching scan across recent open rides.
func (s *Service) PoolDetect(ctx context.Context, campusID uuid.UUID, maxSeats int) ([]*PoolPlan, error) {
	return s.matching.DetectPools(ctx, campusID, maxSeats)
}

// ---------- Helpers ----------

func (s *Service) validateRequest(in RequestRideInput) error {
	if in.PickupLabel == "" || in.DropoffLabel == "" {
		return errors.New("pickup_label and dropoff_label are required")
	}
	if in.PickupLat < -90 || in.PickupLat > 90 || in.DropoffLat < -90 || in.DropoffLat > 90 {
		return errors.New("invalid latitude")
	}
	if in.PickupLng < -180 || in.PickupLng > 180 || in.DropoffLng < -180 || in.DropoffLng > 180 {
		return errors.New("invalid longitude")
	}
	if in.PassengerCount > 6 {
		return errors.New("passenger_count too large")
	}
	return nil
}

func (s *Service) defaultVehicleTypeFor(rideType string) string {
	switch rideType {
	case "premium":
		return "premium"
	case "luggage":
		return "suv"
	case "women_only":
		return "mini"
	case "accessibility":
		return "van"
	default:
		return "mini"
	}
}

func (s *Service) applyCoupon(ctx context.Context, campusID, couponID uuid.UUID, code string, total decimal.Decimal) (*PromoApplyResult, error) {
	return &PromoApplyResult{Amount: decimal.Zero}, nil
}

func (s *Service) deriveTags(in RequestRideInput) []string {
	tags := []string{}
	if in.IsWomenOnly {
		tags = append(tags, "women_only")
	}
	if in.LuggageCount > 0 {
		tags = append(tags, "luggage")
	}
	if in.ScheduledAt != nil {
		tags = append(tags, "scheduled")
	}
	if len(in.Accessibility) > 0 {
		tags = append(tags, "accessibility")
	}
	sort.Strings(tags)
	return tags
}

func validPhase(phase string) bool {
	switch phase {
	case "driver_enroute", "arrived", "in_progress":
		return true
	}
	return false
}

func isTerminal(status string) bool {
	switch status {
	case "completed", "cancelled_by_rider", "cancelled_by_driver",
		"cancelled_by_system", "no_drivers", "expired":
		return true
	}
	return false
}

// LatLng is a small POJO shared with the matching layer.
type LatLng struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

func estimateDurationSec(distanceMeters float64) int {
	avgSpeedKph := 18.0 // campus shuttle speed
	hours := (distanceMeters / 1000.0) / avgSpeedKph
	return int(hours * 3600)
}

// -----------------------------------------------------------------------------
// Wallet hold metadata helpers
// -----------------------------------------------------------------------------
//
// We stash the wallet hold id and cents in the ride row's metadata JSONB
// column so cancel / complete can find it without an extra DB roundtrip.

func readWalletHoldID(row *RideRequestRow) (string, bool) {
	if row == nil || len(row.Metadata) == 0 {
		return "", false
	}
	var meta map[string]any
	if err := json.Unmarshal(row.Metadata, &meta); err != nil {
		return "", false
	}
	v, ok := meta["wallet_hold_id"].(string)
	return v, ok && v != ""
}

func readWalletHoldCents(row *RideRequestRow) int64 {
	if row == nil || len(row.Metadata) == 0 {
		return 0
	}
	var meta map[string]any
	if err := json.Unmarshal(row.Metadata, &meta); err != nil {
		return 0
	}
	switch v := meta["wallet_hold_cents"].(type) {
	case float64:
		return int64(v)
	case int64:
		return v
	case int:
		return int64(v)
	}
	return 0
}