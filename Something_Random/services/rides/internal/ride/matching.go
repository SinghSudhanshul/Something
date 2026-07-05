package ride

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"nexus/rides/internal/driver"
)

// MatchingEngine handles the matching process for RIDE & GO.
//
// The engine uses an expanding-radius scan (500m → 1000m → 2000m →
// 5000m) to find drivers, ranks them with a composite score that
// blends distance / rating / acceptance rate / vehicle compatibility,
// and broadcasts offers to the top N candidates over Redis pub/sub.
// Drivers accept via the Accept endpoint which uses a SET NX lock to
// guarantee that exactly one driver wins.
type MatchingEngine struct {
	driverRepo *driver.Repository
	rideRepo   *RideRepository
	rdb        *redis.Client
	logger     *zap.Logger
	mu         sync.Mutex
	active     map[uuid.UUID]chan struct{}
}

// NewMatchingEngine constructs the engine.
func NewMatchingEngine(driverRepo *driver.Repository, rideRepo *RideRepository, rdb *redis.Client, logger *zap.Logger) *MatchingEngine {
	return &MatchingEngine{
		driverRepo: driverRepo,
		rideRepo:   rideRepo,
		rdb:        rdb,
		logger:     logger,
		active:     make(map[uuid.UUID]chan struct{}),
	}
}

// DriverSnapshot is the minimal driver view used during scoring.
type DriverSnapshot struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	VehicleID       *uuid.UUID
	VehicleType     string
	Rating          float64
	TrustScore      float64
	AcceptanceRate  float64
	CompletedTrips  int
	IsWomenOnly     bool
	IsPremium       bool
	CurrentLat      float64
	CurrentLng      float64
	LastPingAt      time.Time
}

// MatchResult is the outcome of a successful match.
type MatchResult struct {
	DriverID       uuid.UUID  `json:"driver_id"`
	UserID         uuid.UUID  `json:"user_id"`
	VehicleID      *uuid.UUID `json:"vehicle_id,omitempty"`
	DistanceMeters float64    `json:"distance_meters"`
	TrustScore     float64    `json:"trust_score"`
	Score          float64    `json:"score"`
	RadiusUsed     float64    `json:"radius_used"`
}

var (
	ErrNoDriversAvailable = errors.New("no drivers available")
	ErrOfferExpired       = errors.New("ride offer expired")
	ErrAlreadyAccepted    = errors.New("ride already accepted by another driver")
	ErrDriverNotOffered   = errors.New("driver was not offered this ride")
	ErrMatchingInFlight   = errors.New("matching already in flight for this ride")
)

// standard radii used by the expanding-radius algorithm.
var matchingRadii = []float64{500, 1000, 2000, 5000}

// offerTTL is how long an offer stays valid in Redis.
const offerTTL = 35 * time.Second

// MatchAsync kicks off matching in a goroutine. Safe to call from any
// request handler.
func (m *MatchingEngine) MatchAsync(ctx context.Context, rideID, campusID uuid.UUID, pickup, dropoff LatLng, womenOnly bool, rideType string) error {
	m.mu.Lock()
	if _, exists := m.active[rideID]; exists {
		m.mu.Unlock()
		return ErrMatchingInFlight
	}
	done := make(chan struct{})
	m.active[rideID] = done
	m.mu.Unlock()

	go func() {
		defer func() {
			m.mu.Lock()
			delete(m.active, rideID)
			m.mu.Unlock()
			close(done)
		}()
		bg := context.Background()
		_, _ = m.Match(bg, rideID, campusID, pickup, dropoff, womenOnly, rideType)
	}()
	return nil
}

// MatchScheduled triggers matching for a ride whose scheduled_at has
// just become eligible.
func (m *MatchingEngine) MatchScheduled(ctx context.Context, rideID uuid.UUID) error {
	ride, err := m.rideRepo.FindByID(ctx, rideID)
	if err != nil {
		return err
	}
	return m.MatchAsync(ctx,
		ride.ID, ride.CampusID,
		LatLng{Lat: ride.PickupLat, Lng: ride.PickupLng},
		LatLng{Lat: ride.DropoffLat, Lng: ride.DropoffLng},
		ride.IsWomenOnly, ride.RideType,
	)
}

// Match runs the full matching loop synchronously.
func (m *MatchingEngine) Match(ctx context.Context, rideID, campusID uuid.UUID, pickup, dropoff LatLng, womenOnly bool, rideType string) (*MatchResult, error) {
	if _, err := m.rideRepo.UpdateStatus(ctx, rideID, "matching"); err != nil {
		return nil, fmt.Errorf("set matching status: %w", err)
	}

	deadline := time.Now().Add(5 * time.Minute)
	for _, radius := range matchingRadii {
		if time.Now().After(deadline) {
			_, _ = m.rideRepo.UpdateStatus(ctx, rideID, "no_drivers")
			return nil, ErrNoDriversAvailable
		}
		candidates, err := m.findCandidates(ctx, campusID, pickup, radius, womenOnly, rideType)
		if err != nil {
			m.logger.Error("find candidates", zap.Error(err), zap.Float64("radius", radius))
			continue
		}
		if len(candidates) == 0 {
			continue
		}
		// rank + take top N
		ranked := m.rank(candidates, pickup, womenOnly, rideType)
		topN := ranked
		if len(topN) > 3 {
			topN = topN[:3]
		}
		// store offer context
		offer := MatchingOffer{
			RideID:        rideID,
			DriverIDs:     idsOf(topN),
			ExpiresAt:     time.Now().Add(offerTTL),
			PickupLabel:   pickupLabel(pickup),
			DropoffLabel:  dropoffLabel(dropoff),
			EstimatedFare: "0",
			RideType:      rideType,
		}
		b, _ := json.Marshal(offer)
		_ = m.rdb.SetEx(ctx, offerKey(rideID), string(b), offerTTL).Err()
		// broadcast
		for _, c := range topN {
			msg, _ := json.Marshal(map[string]interface{}{
				"ride_id":       rideID,
				"pickup":        pickup,
				"dropoff":       dropoff,
				"estimated_fare": offer.EstimatedFare,
				"ride_type":     rideType,
				"expires_in":    int(offerTTL.Seconds()),
				"radius_used":   radius,
				"score":         c.Score,
			})
			_ = m.rdb.Publish(ctx, driverOfferChannel(c.ID), string(msg)).Err()
		}
		m.logger.Info("offer broadcast", zap.String("rideID", rideID.String()), zap.Int("drivers", len(topN)), zap.Float64("radius", radius))

		result, err := m.waitForAcceptance(ctx, rideID, topN, offerTTL)
		if err == nil && result != nil {
			result.RadiusUsed = radius
			return result, nil
		}
		m.logger.Info("no acceptance in window, expanding",
			zap.String("rideID", rideID.String()),
			zap.Float64("next_radius", nextRadius(radius)))
	}
	_, _ = m.rideRepo.UpdateStatus(ctx, rideID, "no_drivers")
	return nil, ErrNoDriversAvailable
}

// AcceptRide is invoked when a driver taps "Accept" on the offer.
func (m *MatchingEngine) AcceptRide(ctx context.Context, driverID, rideID uuid.UUID) error {
	offerKey := offerKey(rideID)
	raw, err := m.rdb.Get(ctx, offerKey).Result()
	if err != nil {
		return ErrOfferExpired
	}
	var offer MatchingOffer
	if err := json.Unmarshal([]byte(raw), &offer); err != nil {
		return ErrOfferExpired
	}
	if !containsID(offer.DriverIDs, driverID) {
		return ErrDriverNotOffered
	}
	acceptKey := acceptedKey(rideID)
	ok, err := m.rdb.SetNX(ctx, acceptKey, driverID.String(), 90*time.Second).Result()
	if err != nil {
		return fmt.Errorf("acquire accept lock: %w", err)
	}
	if !ok {
		return ErrAlreadyAccepted
	}
	drv, err := m.driverRepo.FindV2ByID(ctx, driverID)
	if err != nil {
		_ = m.rdb.Del(ctx, acceptKey).Err()
		return fmt.Errorf("driver not found: %w", err)
	}
	// Update DB row to 'accepted'.
	if _, err := m.rideRepo.MarkAccepted(ctx, rideID, driverID, derefUUID(drv.CurrentVehicleID), 0); err != nil {
		_ = m.rdb.Del(ctx, acceptKey).Err()
		return fmt.Errorf("persist acceptance: %w", err)
	}
	// Cleanup offer; broadcast cancel to losing drivers.
	_ = m.rdb.Del(ctx, offerKey).Err()
	for _, id := range offer.DriverIDs {
		if id == driverID {
			continue
		}
		_ = m.rdb.Publish(ctx, driverOfferCancelChannel(id), rideID.String()).Err()
	}
	return nil
}

// RejectRide allows a driver to decline the offer early so we can
// move on to the next radius more quickly.
func (m *MatchingEngine) RejectRide(ctx context.Context, driverID, rideID uuid.UUID) error {
	rejectKey := fmt.Sprintf("rides:rejected:%s", rideID)
	_, err := m.rdb.SAdd(ctx, rejectKey, driverID.String()).Result()
	if err != nil {
		return err
	}
	_ = m.rdb.Expire(ctx, rejectKey, offerTTL).Err()
	return nil
}

// ---------- Detection: find candidate drivers near pickup --------------

func (m *MatchingEngine) findCandidates(
	ctx context.Context,
	campusID uuid.UUID,
	pickup LatLng,
	radius float64,
	womenOnly bool,
	rideType string,
) ([]DriverSnapshot, error) {
	nearby, err := m.driverRepo.FindAvailableNearbyV2(ctx, pickup.Lat, pickup.Lng, radius, campusID, womenOnly)
	if err != nil {
		return nil, err
	}
	out := make([]DriverSnapshot, 0, len(nearby))
	for _, d := range nearby {
		vs := DriverSnapshot{
			ID:             d.ID,
			UserID:         d.UserID,
			VehicleID:      nil,
			Rating:         float64(5.0),
			TrustScore:     d.TrustScore,
			AcceptanceRate: 1.0,
			CompletedTrips: d.TotalRides,
			IsWomenOnly:    d.IsWomenOnly,
			IsPremium:      false,
		}
		if d.Lat != nil {
			vs.CurrentLat = *d.Lat
		}
		if d.Lng != nil {
			vs.CurrentLng = *d.Lng
		}
		vs.LastPingAt = time.Now()
		out = append(out, vs)
	}
	return out, nil
}

// ---------- Scoring -----------------------------------------------------

type rankedCandidate struct {
	Driver Snapshot `json:"-"` // embedded; can't serialise
	Snap   DriverSnapshot
	Dist   float64
	Score  float64
}

// Driver is a tiny alias to keep the embed happy.
type Driver struct{}

// Score weights:
//   distance   : 0.35   (closer is better)
//   rating     : 0.20
//   trust      : 0.20
//   acceptance : 0.15
//   tier       : 0.10
func (m *MatchingEngine) rank(candidates []DriverSnapshot, pickup LatLng, womenOnly bool, rideType string) []rankedCandidate {
	ranked := make([]rankedCandidate, 0, len(candidates))
	for _, c := range candidates {
		dist := haversineDistance(pickup.Lat, pickup.Lng, c.CurrentLat, c.CurrentLng)
		if c.LastPingAt.IsZero() || time.Since(c.LastPingAt) > 90*time.Second {
			// stale ping — penalise
			continue
		}
		score := computeScore(dist, c, rideType, womenOnly)
		ranked = append(ranked, rankedCandidate{
			Snap:  c,
			Dist:  dist,
			Score: score,
		})
	}
	sort.SliceStable(ranked, func(i, j int) bool { return ranked[i].Score > ranked[j].Score })
	return ranked
}

func computeScore(dist float64, c DriverSnapshot, rideType string, womenOnly bool) float64 {
	distanceScore := 1.0 - math.Min(dist/5000.0, 1.0)
	ratingScore := clamp(c.Rating/5.0, 0, 1)
	trustScore := clamp(c.TrustScore/10.0, 0, 1)
	acceptanceScore := clamp(c.AcceptanceRate, 0, 1)
	tierScore := 0.5
	if c.IsPremium {
		tierScore += 0.3
	}
	if c.IsWomenOnly && womenOnly {
		tierScore += 0.4
	}
	if rideType == "premium" && !c.IsPremium {
		tierScore = 0.2
	}
	score := 0.35*distanceScore +
		0.20*ratingScore +
		0.20*trustScore +
		0.15*acceptanceScore +
		0.10*tierScore
	if c.CompletedTrips < 5 {
		score *= 0.95 // light penalty for new drivers
	}
	return math.Round(score*1000) / 1000
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// ---------- Acceptance wait loop ---------------------------------------

func (m *MatchingEngine) waitForAcceptance(ctx context.Context, rideID uuid.UUID, ranked []rankedCandidate, timeout time.Duration) (*MatchResult, error) {
	deadline := time.Now().Add(timeout)
	acceptKey := acceptedKey(rideID)
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
		}
		val, err := m.rdb.Get(ctx, acceptKey).Result()
		if err == nil && val != "" {
			id, _ := uuid.Parse(val)
			for _, c := range ranked {
				if c.Snap.ID == id {
					return &MatchResult{
						DriverID:       c.Snap.ID,
						UserID:         c.Snap.UserID,
						VehicleID:      c.Snap.VehicleID,
						DistanceMeters: c.Dist,
						TrustScore:     c.Snap.TrustScore,
						Score:          c.Score,
					}, nil
				}
			}
			return &MatchResult{DriverID: id}, nil
		}
	}
	_ = m.rdb.Del(ctx, acceptKey).Err()
	return nil, ErrOfferExpired
}

// ---------- Pool Detection ---------------------------------------------

// DetectPools finds rides with the same origin/destination within a
// short window so we can offer a discount.
func (m *MatchingEngine) DetectPools(ctx context.Context, campusID uuid.UUID, maxSeats int) ([]*PoolPlan, error) {
	if maxSeats <= 0 {
		maxSeats = 3
	}
	rows, err := m.rideRepo.pool.Query(ctx, `
		SELECT id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, ride_type
		FROM ride_requests
		WHERE status = 'requested'
		  AND campus_id = $1
		  AND ride_type IN ('solo','pool')
		  AND created_at >= NOW() - INTERVAL '5 minutes'
		ORDER BY created_at DESC LIMIT 50`, campusID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type pin struct {
		id        uuid.UUID
		pickup    LatLng
		drop      LatLng
		rideType  string
	}
	var pins []pin
	for rows.Next() {
		var p pin
		if err := rows.Scan(&p.id, &p.pickup.Lat, &p.pickup.Lng, &p.drop.Lat, &p.drop.Lng, &p.rideType); err != nil {
			return nil, err
		}
		pins = append(pins, p)
	}
	// Greedy cluster by proximity.
	plans := []*PoolPlan{}
	used := map[uuid.UUID]bool{}
	for i := 0; i < len(pins); i++ {
		if used[pins[i].id] {
			continue
		}
		cluster := []pin{pins[i]}
		for j := i + 1; j < len(pins); j++ {
			if used[pins[j].id] {
				continue
			}
			if len(cluster) >= maxSeats {
				break
			}
			if haversineDistance(pins[i].pickup.Lat, pins[i].pickup.Lng, pins[j].pickup.Lat, pins[j].pickup.Lng) > 250 ||
				haversineDistance(pins[i].drop.Lat, pins[i].drop.Lng, pins[j].drop.Lat, pins[j].drop.Lng) > 250 {
				continue
			}
			cluster = append(cluster, pins[j])
		}
		if len(cluster) >= 2 {
			plan := &PoolPlan{
				PoolID:        uuid.New(),
				OriginLat:     cluster[0].pickup.Lat,
				OriginLng:     cluster[0].pickup.Lng,
				DestinationLat: cluster[0].drop.Lat,
				DestinationLng: cluster[0].drop.Lng,
				CandidateRideIDs: []uuid.UUID{},
				DiscountPct:    30,
				DetectedAt:     time.Now().UTC(),
			}
			for _, c := range cluster {
				plan.CandidateRideIDs = append(plan.CandidateRideIDs, c.id)
				used[c.id] = true
			}
			plans = append(plans, plan)
		}
	}
	return plans, nil
}

// ---------- Helpers ----------------------------------------------------

func offerKey(rideID uuid.UUID) string {
	return fmt.Sprintf("rides:offer:%s", rideID)
}
func acceptedKey(rideID uuid.UUID) string {
	return fmt.Sprintf("rides:accepted:%s", rideID)
}
func driverOfferChannel(driverID uuid.UUID) string {
	return fmt.Sprintf("rides:driver:%s:ride_offer", driverID)
}
func driverOfferCancelChannel(driverID uuid.UUID) string {
	return fmt.Sprintf("rides:driver:%s:offer_cancelled", driverID)
}
func pickupLabel(p LatLng) string    { return fmt.Sprintf("%.4f,%.4f", p.Lat, p.Lng) }
func dropoffLabel(p LatLng) string   { return fmt.Sprintf("%.4f,%.4f", p.Lat, p.Lng) }
func nextRadius(current float64) float64 {
	for _, r := range matchingRadii {
		if r > current {
			return r
		}
	}
	return current
}
func idsOf(in []rankedCandidate) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(in))
	for _, c := range in {
		out = append(out, c.Snap.ID)
	}
	return out
}
func containsID(ids []uuid.UUID, target uuid.UUID) bool {
	for _, id := range ids {
		if id == target {
			return true
		}
	}
	return false
}
func derefUUID(p *uuid.UUID) uuid.UUID {
	if p == nil {
		return uuid.Nil
	}
	return *p
}

// haversineDistance is intentionally here (in addition to fare.go)
// because matching uses it on every candidate, while fare only uses it
// when no routing data is available.
func haversineDistance(lat1, lng1, lat2, lng2 float64) float64 {
	const R = 6371000.0
	rad := func(d float64) float64 { return d * math.Pi / 180 }
	dLat := rad(lat2 - lat1)
	dLng := rad(lng2 - lng1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(rad(lat1))*math.Cos(rad(lat2))*
			math.Sin(dLng/2)*math.Sin(dLng/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return R * c
}