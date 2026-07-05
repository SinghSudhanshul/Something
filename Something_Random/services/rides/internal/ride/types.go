package ride

// =============================================================================
// Domain types — Ride & Go
// =============================================================================
//
// All persistent and DTO types live here. The repository hydrates these from
// `row_to_json(rides)` JSON snapshots produced by the SQL layer. Where the
// column lives in PostgreSQL as JSONB the corresponding field is []byte (or
// json.RawMessage) so we don't re-marshal unnecessarily on the hot path.

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// -----------------------------------------------------------------------------
// Ride status, type & payment enums (mirrored from the SQL ENUM types)
// -----------------------------------------------------------------------------

type RideStatus string

const (
	RideStatusRequested         RideStatus = "requested"
	RideStatusSearching         RideStatus = "searching"
	RideStatusDriverAssigned    RideStatus = "driver_assigned"
	RideStatusDriverEnroute     RideStatus = "driver_enroute"
	RideStatusDriverArrived     RideStatus = "driver_arrived"
	RideStatusInProgress        RideStatus = "in_progress"
	RideStatusCompleted         RideStatus = "completed"
	RideStatusCancelled         RideStatus = "cancelled"
	RideStatusNoShow            RideStatus = "no_show"
	RideStatusRejected          RideStatus = "rejected"
	RideStatusFailed            RideStatus = "failed"
	RideStatusRefunded          RideStatus = "refunded"
	RideStatusDisputed          RideStatus = "disputed"
)

type RideType string

const (
	RideTypeEconomy     RideType = "economy"
	RideTypeComfort     RideType = "comfort"
	RideTypePremium     RideType = "premium"
	RideTypeXL          RideType = "xl"
	RideTypePool        RideType = "pool"
	RideTypeAuto        RideType = "auto"
	RideTypeBike        RideType = "bike"
	RideTypeLux         RideType = "lux"
	RideTypeAccessible  RideType = "accessible"
	RideTypePetFriendly RideType = "pet_friendly"
	RideTypeWomenOnly   RideType = "women_only"
	RideTypeScheduled   RideType = "scheduled"
	RideTypeRental      RideType = "rental"
	RideTypeOutstation  RideType = "outstation"
	RideTypeCargo       RideType = "cargo"
)

type RidePaymentStatus string

const (
	PaymentStatusUnpaid        RidePaymentStatus = "unpaid"
	PaymentStatusAuthorized    RidePaymentStatus = "authorized"
	PaymentStatusCaptured      RidePaymentStatus = "captured"
	PaymentStatusRefunded      RidePaymentStatus = "refunded"
	PaymentStatusPartialRefund RidePaymentStatus = "partial_refund"
	PaymentStatusDisputed      RidePaymentStatus = "disputed"
	PaymentStatusVoided        RidePaymentStatus = "voided"
	PaymentStatusChargeback    RidePaymentStatus = "chargeback"
)

type CancellationReason string

const (
	CancelUserRequest     CancellationReason = "user_request"
	CancelDriverRequest   CancellationReason = "driver_request"
	CancelNoDrivers       CancellationReason = "no_drivers"
	CancelDriverNoShow    CancellationReason = "driver_no_show"
	CancelUserNoShow      CancellationReason = "user_no_show"
	CancelSystemTimeout   CancellationReason = "system_timeout"
	CancelPaymentFailed   CancellationReason = "payment_failed"
	CancelSafetyConcern   CancellationReason = "safety_concern"
	CancelVehicleIssue    CancellationReason = "vehicle_issue"
	CancelWrongPickup     CancellationReason = "wrong_pickup"
	CancelFraudDetected   CancellationReason = "fraud_detected"
	CancelAdmin           CancellationReason = "admin_cancel"
	CancelWeather         CancellationReason = "weather"
	CancelOther           CancellationReason = "other"
)

type CancellationActor string

const (
	CancelActorRider   CancellationActor = "rider"
	CancelActorDriver  CancellationActor = "driver"
	CancelActorSystem  CancellationActor = "system"
	CancelActorAdmin   CancellationActor = "admin"
	CancelActorGateway CancellationActor = "payment_gateway"
)

// Ride is the canonical ride row, with all fields nullable where appropriate.
type Ride struct {
	ID                     uuid.UUID           `json:"id"`
	RideCode               string              `json:"ride_code"`
	RiderID                uuid.UUID           `json:"rider_id"`
	DriverID               *uuid.UUID          `json:"driver_id,omitempty"`
	VehicleID              *uuid.UUID          `json:"vehicle_id,omitempty"`
	RideType               RideType            `json:"ride_type"`
	Status                 RideStatus          `json:"status"`
	CampusID               *uuid.UUID          `json:"campus_id,omitempty"`

	// Pickup
	PickupAddress          string              `json:"pickup_address"`
	PickupLat              float64             `json:"pickup_lat"`
	PickupLng              float64             `json:"pickup_lng"`
	PickupLandmark         string              `json:"pickup_landmark,omitempty"`
	PickupPlaceID          string              `json:"pickup_place_id,omitempty"`
	PickupFloor            string              `json:"pickup_floor,omitempty"`
	PickupUnit             string              `json:"pickup_unit,omitempty"`

	// Dropoff
	DropoffAddress         string              `json:"dropoff_address"`
	DropoffLat             float64             `json:"dropoff_lat"`
	DropoffLng             float64             `json:"dropoff_lng"`
	DropoffLandmark        string              `json:"dropoff_landmark,omitempty"`
	DropoffPlaceID         string              `json:"dropoff_place_id,omitempty"`
	DropoffFloor           string              `json:"dropoff_floor,omitempty"`
	DropoffUnit            string              `json:"dropoff_unit,omitempty"`

	// Trip geometry
	StartLat               *float64            `json:"start_lat,omitempty"`
	StartLng               *float64            `json:"start_lng,omitempty"`
	EndLat                 *float64            `json:"end_lat,omitempty"`
	EndLng                 *float64            `json:"end_lng,omitempty"`
	DistanceToPickupKm     *float64            `json:"distance_to_pickup_km,omitempty"`
	ETAToPickupS           *int                `json:"eta_to_pickup_s,omitempty"`

	// Stops and multi-destination
	StopsJSON              []byte              `json:"stops,omitempty"`
	AccessibilityJSON      []byte              `json:"accessibility_needs,omitempty"`

	// Fare
	Currency               string              `json:"currency"`
	BaseFareCents          int64               `json:"base_fare_cents"`
	DistanceFareCents      int64               `json:"distance_fare_cents"`
	TimeFareCents          int64               `json:"time_fare_cents"`
	SurgeAmountCents       int64               `json:"surge_amount_cents"`
	SurgeMultiplier        float64             `json:"surge_multiplier"`
	TollCents              int64               `json:"toll_cents"`
	TaxCents               int64               `json:"tax_cents"`
	PlatformFeeCents       int64               `json:"platform_fee_cents"`
	TipCents               int64               `json:"tip_cents"`
	DiscountCents          int64               `json:"discount_cents"`
	PromoDiscountCents     int64               `json:"promo_discount_cents"`
	PoolDiscountCct        int64               `json:"pool_discount_cents"`
	TotalFareCents         int64               `json:"total_fare_cents"`
	RiderPaidCents         int64               `json:"rider_paid_cents"`
	DriverEarningsCents    int64               `json:"driver_earnings_cents"`
	EstimatedFareMinCents  int64               `json:"estimated_fare_min_cents"`
	EstimatedFareMaxCents  int64               `json:"estimated_fare_max_cents"`

	// Distance / duration
	EstimatedDistanceKm    float64             `json:"estimated_distance_km"`
	EstimatedDurationS     int                 `json:"estimated_duration_s"`
	ActualDistanceKm       float64             `json:"actual_distance_km"`
	ActualDurationS        int                 `json:"actual_duration_s"`

	// Route
	PolylineEncoded        string              `json:"polyline_encoded,omitempty"`
	RouteSteps             json.RawMessage     `json:"route_steps,omitempty"`
	RouteAlternatives      json.RawMessage     `json:"route_alternatives,omitempty"`

	// Payment
	PaymentMethodID        *uuid.UUID          `json:"payment_method_id,omitempty"`
	PaymentStatus          RidePaymentStatus   `json:"payment_status"`
	PaymentAuthorizedAt    *time.Time          `json:"payment_authorized_at,omitempty"`
	PaymentCapturedAt      *time.Time          `json:"payment_captured_at,omitempty"`
	PaymentRefundedAt      *time.Time          `json:"payment_refunded_at,omitempty"`
	PaymentHoldID          string              `json:"payment_hold_id,omitempty"`
	PaymentIntentID        string              `json:"payment_intent_id,omitempty"`

	// Promo
	PromoCode              string              `json:"promo_code,omitempty"`
	PromoRedemptionID      *uuid.UUID          `json:"promo_redemption_id,omitempty"`

	// Status timestamps
	RequestedAt            time.Time           `json:"requested_at"`
	SearchingStartedAt     *time.Time          `json:"searching_started_at,omitempty"`
	DriverAssignedAt       *time.Time          `json:"driver_assigned_at,omitempty"`
	DriverEnrouteAt        *time.Time          `json:"driver_enroute_at,omitempty"`
	DriverArrivedAt        *time.Time          `json:"driver_arrived_at,omitempty"`
	InProgressAt           *time.Time          `json:"in_progress_at,omitempty"`
	CompletedAt            *time.Time          `json:"completed_at,omitempty"`
	CancelledAt            *time.Time          `json:"cancelled_at,omitempty"`
	NoShowAt               *time.Time          `json:"no_show_at,omitempty"`

	// Cancellation
	CancellationReason     *CancellationReason `json:"cancellation_reason,omitempty"`
	CancellationActor      *CancellationActor  `json:"cancellation_actor,omitempty"`
	CancellationNote       string              `json:"cancellation_note,omitempty"`
	CancellationFeeCents   int64               `json:"cancellation_fee_cents"`

	// Ratings
	DriverRating           int                 `json:"driver_rating"`
	DriverRatingTags       []string            `json:"driver_rating_tags,omitempty"`
	DriverRatingComment    string              `json:"driver_rating_comment,omitempty"`
	DriverRatedAt          *time.Time          `json:"driver_rated_at,omitempty"`
	RiderRating            int                 `json:"rider_rating"`
	RiderRatingTags        []string            `json:"rider_rating_tags,omitempty"`
	RiderRatingComment     string              `json:"rider_rating_comment,omitempty"`
	RiderRatedAt           *time.Time          `json:"rider_rated_at,omitempty"`

	// Special flags
	IsScheduled            bool                `json:"is_scheduled"`
	ScheduledFor           *time.Time          `json:"scheduled_for,omitempty"`
	IsPool                 bool                `json:"is_pool"`
	PoolID                 *uuid.UUID          `json:"pool_id,omitempty"`
	IsCorporate            bool                `json:"is_corporate"`
	CorporateAccountID     *uuid.UUID          `json:"corporate_account_id,omitempty"`
	IsAccessibility        bool                `json:"is_accessibility"`
	IsPetFriendly          bool                `json:"is_pet_friendly"`
	IsWomenOnly            bool                `json:"is_women_only"`
	PetCount               int                 `json:"pet_count"`
	LuggageCount           int                 `json:"luggage_count"`
	LuggageSize            string              `json:"luggage_size,omitempty"`
	PassengerCount         int                 `json:"passenger_count"`

	// Surge & supply/demand
	SurgeZoneID            *uuid.UUID          `json:"surge_zone_id,omitempty"`
	SurgeState             string              `json:"surge_state,omitempty"`
	DemandScore            float64             `json:"demand_score"`
	SupplyScore            float64             `json:"supply_score"`
	WaitTimeS              int                 `json:"wait_time_s"`
	MatchScore             float64             `json:"match_score"`

	// Sharing
	ShareToken             string              `json:"share_token,omitempty"`
	ShareExpiresAt         *time.Time          `json:"share_expires_at,omitempty"`

	// Metadata
	DriverOfferCount       int                 `json:"driver_offer_count"`
	SearchRadiusKm         float64             `json:"search_radius_km"`
	ReDispatchedCount      int                 `json:"re_dispatched_count"`
	RiderAppVersion        string              `json:"rider_app_version,omitempty"`
	DriverAppVersion       string              `json:"driver_app_version,omitempty"`
	Source                 string              `json:"source,omitempty"`
	Metadata               []byte              `json:"metadata,omitempty"`

	// Optimistic locking & audit
	Version                int                 `json:"version"`
	CreatedAt              time.Time           `json:"created_at"`
	UpdatedAt              time.Time           `json:"updated_at"`
	DeletedAt              *time.Time          `json:"deleted_at,omitempty"`
}

// Cancellation is the input to Repository.Cancel.
type Cancellation struct {
	CancelledBy  uuid.UUID          `json:"cancelled_by"`
	Actor        CancellationActor  `json:"actor"`
	Reason       CancellationReason `json:"reason"`
	Note         string             `json:"note,omitempty"`
	FeeCents     int64              `json:"fee_cents"`
	RefundCents  int64              `json:"refund_cents"`
}

// RideCompletion is the input to Repository.CompleteTrip.
type RideCompletion struct {
	EndLat              float64 `json:"end_lat"`
	EndLng              float64 `json:"end_lng"`
	DistanceKm          float64 `json:"distance_km"`
	DurationS           int     `json:"duration_s"`
	DistanceFareCents   int64   `json:"distance_fare_cents"`
	TimeFareCents       int64   `json:"time_fare_cents"`
	TollCents           int64   `json:"toll_cents"`
	TaxCents            int64   `json:"tax_cents"`
	PlatformFeeCents    int64   `json:"platform_fee_cents"`
	TipCents            int64   `json:"tip_cents"`
	TotalFareCents      int64   `json:"total_fare_cents"`
	DriverEarningsCents int64   `json:"driver_earnings_cents"`
	PolylineEncoded     string  `json:"polyline_encoded,omitempty"`
}

// RideOffer captures a single dispatch attempt.
type RideOffer struct {
	ID          uuid.UUID `json:"id"`
	RideID      uuid.UUID `json:"ride_id"`
	DriverID    uuid.UUID `json:"driver_id"`
	Score       float64   `json:"score"`
	DistanceKm  float64   `json:"distance_to_pickup_km"`
	ETAS        int       `json:"eta_to_pickup_s"`
	OfferedAt   time.Time `json:"offered_at"`
	ExpiresAt   time.Time `json:"expires_at"`
	RespondedAt *time.Time `json:"responded_at,omitempty"`
	Response    string    `json:"response,omitempty"`
	DeclineReason string  `json:"decline_reason,omitempty"`
}

// RideRating is the rating row.
type RideRating struct {
	ID                uuid.UUID       `json:"id"`
	RideID            uuid.UUID       `json:"ride_id"`
	RaterID           uuid.UUID       `json:"rater_id"`
	RaterRole         string          `json:"rater_role"`
	RateeID           uuid.UUID       `json:"ratee_id"`
	RateeRole         string          `json:"ratee_role"`
	Rating            int             `json:"rating"`
	Tags              []string        `json:"tags,omitempty"`
	Comment           *string         `json:"comment,omitempty"`
	IsPublic          bool            `json:"is_public"`
	CategoryBreakdown json.RawMessage `json:"category_breakdown,omitempty"`
	CreatedAt         time.Time       `json:"created_at"`
}

// RidePool is a shared ride grouping.
type RidePool struct {
	ID                uuid.UUID  `json:"id"`
	DriverID          *uuid.UUID `json:"driver_id,omitempty"`
	VehicleID         *uuid.UUID `json:"vehicle_id,omitempty"`
	Status            string     `json:"status"`
	MaxSeats          int        `json:"max_seats"`
	DiscountPct       float64    `json:"discount_pct"`
	PickupLat         float64    `json:"pickup_lat"`
	PickupLng         float64    `json:"pickup_lng"`
	DropoffLat        float64    `json:"dropoff_lat"`
	DropoffLng        float64    `json:"dropoff_lng"`
	TotalDistanceKm   float64    `json:"total_distance_km"`
	TotalFareCents    int64      `json:"total_actual_fare_cents"`
	CompletedAt       *time.Time `json:"completed_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

// RideShareLink allows a trusted contact to view the live trip.
type RideShareLink struct {
	ID            uuid.UUID  `json:"id"`
	RideID        uuid.UUID  `json:"ride_id"`
	Token         string     `json:"token"`
	CreatedBy     uuid.UUID  `json:"created_by"`
	ExpiresAt     time.Time  `json:"expires_at"`
	RevokedAt     *time.Time `json:"revoked_at,omitempty"`
	Status        string     `json:"status"`
	ViewCount     int        `json:"view_count"`
	LastViewedAt  *time.Time `json:"last_viewed_at,omitempty"`
	SharedWith    []byte     `json:"shared_with,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

// RideStop is a single intermediate stop.
type RideStop struct {
	Order   int     `json:"order"`
	Address string  `json:"address"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
	Notes   string  `json:"notes,omitempty"`
}

// ScheduledRide is a future-dated ride request.
type ScheduledRide struct {
	ID                 uuid.UUID  `json:"id"`
	RiderID            uuid.UUID  `json:"rider_id"`
	RideID             *uuid.UUID `json:"ride_id,omitempty"`
	Status             string     `json:"status"`
	ScheduledFor       time.Time  `json:"scheduled_for"`
	PickupAddress      string     `json:"pickup_address"`
	PickupLat          float64    `json:"pickup_lat"`
	PickupLng          float64    `json:"pickup_lng"`
	DropoffAddress     string     `json:"dropoff_address"`
	DropoffLat         float64    `json:"dropoff_lat"`
	DropoffLng         float64    `json:"dropoff_lng"`
	RideType           RideType   `json:"ride_type"`
	PaymentMethodID    *uuid.UUID `json:"payment_method_id,omitempty"`
	EstimatedFareCents int64      `json:"estimated_fare_cents"`
	Notes              string     `json:"notes,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
}

// -----------------------------------------------------------------------------
// Internal: JSON unmarshalling
// -----------------------------------------------------------------------------

// rideRow is the JSON shape emitted by `row_to_json(rides)`. It mirrors Ride
// exactly but is used only for unmarshalling — keeps the public type free of
// pgx-specific scan tags.
type rideRow = Ride

// unmarshalRide hydrates a Ride from the row_to_json blob.
func unmarshalRide(raw []byte) (*Ride, error) {
	if len(raw) == 0 {
		return nil, ErrNotFound
	}
	var r Ride
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, fmt.Errorf("rides.unmarshal: %w", err)
	}
	return &r, nil
}
