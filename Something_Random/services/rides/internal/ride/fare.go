package ride

import (
	"errors"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// FareConfig holds campus-specific fare configuration.
type FareConfig struct {
	BaseFare        decimal.Decimal
	PerKmRate       decimal.Decimal
	PerMinRate      decimal.Decimal
	MinFare         decimal.Decimal
	MaxFare         decimal.Decimal
	PoolDiscount    decimal.Decimal // 0.30 = 30% off
	NightSurcharge  decimal.Decimal // 1.25x
	WaitingFeePerMin decimal.Decimal
	PlatformFee     decimal.Decimal
	GstPct          decimal.Decimal
	SurgeCeiling    decimal.Decimal
}

// DefaultFareConfig returns the default campus fare configuration.
func DefaultFareConfig() FareConfig {
	return FareConfig{
		BaseFare:        decimal.NewFromFloat(10.00),
		PerKmRate:       decimal.NewFromFloat(8.00),
		PerMinRate:      decimal.NewFromFloat(1.00),
		MinFare:         decimal.NewFromFloat(15.00),
		MaxFare:         decimal.NewFromFloat(100.00),
		PoolDiscount:    decimal.NewFromFloat(0.30),
		NightSurcharge:  decimal.NewFromFloat(1.25),
		WaitingFeePerMin: decimal.NewFromFloat(2.00),
		PlatformFee:     decimal.NewFromFloat(5.00),
		GstPct:          decimal.NewFromFloat(5.00),
		SurgeCeiling:    decimal.NewFromFloat(2.50),
	}
}

// PremiumFareConfig returns a higher-tier fare table.
func PremiumFareConfig() FareConfig {
	return FareConfig{
		BaseFare:        decimal.NewFromFloat(25.00),
		PerKmRate:       decimal.NewFromFloat(14.00),
		PerMinRate:      decimal.NewFromFloat(2.00),
		MinFare:         decimal.NewFromFloat(40.00),
		MaxFare:         decimal.NewFromFloat(400.00),
		PoolDiscount:    decimal.NewFromFloat(0.15),
		NightSurcharge:  decimal.NewFromFloat(1.30),
		WaitingFeePerMin: decimal.NewFromFloat(3.00),
		PlatformFee:     decimal.NewFromFloat(10.00),
		GstPct:          decimal.NewFromFloat(5.00),
		SurgeCeiling:    decimal.NewFromFloat(2.50),
	}
}

// FareEstimateInput captures the inputs for a fare calculation.
type FareEstimateInput struct {
	CampusID     uuid.UUID
	PickupLat    float64
	PickupLng    float64
	DropoffLat   float64
	DropoffLng   float64
	RideType     string
	VehicleType  string
	IsWomenOnly  bool
	CouponCode   string
	At           time.Time
	SurgeDemand  float64 // 0..1
	SurgeSupply  float64 // 0..1
}

// FareEstimate is the resulting fare breakdown.
type FareEstimate struct {
	BaseFare        decimal.Decimal `json:"base_fare"`
	DistanceFare    decimal.Decimal `json:"distance_fare"`
	TimeFare        decimal.Decimal `json:"time_fare"`
	SurgeMultiplier decimal.Decimal `json:"surge_multiplier"`
	PlatformFee     decimal.Decimal `json:"platform_fee"`
	WaitingFee      decimal.Decimal `json:"waiting_fee"`
	Tax             decimal.Decimal `json:"tax"`
	Discount        decimal.Decimal `json:"discount"`
	Total           decimal.Decimal `json:"total"`
	DistanceMeters  float64         `json:"distance_meters"`
	DurationSec     int             `json:"duration_sec"`
	ExpiresAt       time.Time       `json:"expires_at"`
}

// IsNightTime checks if the given time is between 22:00 and 06:00 IST.
func IsNightTime(t time.Time) bool {
	ist, _ := time.LoadLocation("Asia/Kolkata")
	istTime := t.In(ist)
	hour := istTime.Hour()
	return hour >= 22 || hour < 6
}

// IsWeekend checks if the given date is a weekend (Sat/Sun) in IST.
func IsWeekend(t time.Time) bool {
	ist, _ := time.LoadLocation("Asia/Kolkata")
	w := t.In(ist).Weekday()
	return w == time.Saturday || w == time.Sunday
}

// IsIndianHoliday returns true if the date matches a known holiday.
// In production this would consult an admin-managed list; for the
// monolith we ship with a few fixed dates.
func IsIndianHoliday(t time.Time) bool {
	ist, _ := time.LoadLocation("Asia/Kolkata")
	d := t.In(ist)
	switch d.Format("01-02") {
	case "01-26", // Republic Day
		"08-15", // Independence Day
		"10-02": // Gandhi Jayanti
		return true
	}
	return false
}

// FareCalculator encapsulates the active fare rules.
type FareCalculator struct {
	config    FareConfig
	repo      *RideRepository
	isPremium bool
}

// NewFareCalculator constructs a calculator.
func NewFareCalculator(repo *RideRepository, cfg FareConfig) *FareCalculator {
	if cfg.BaseFare.IsZero() {
		cfg = DefaultFareConfig()
	}
	return &FareCalculator{repo: repo, config: cfg}
}

// SetPremium toggles premium pricing.
func (f *FareCalculator) SetPremium(premium bool) {
	f.isPremium = premium
}

// Estimate computes a fare estimate based on input coordinates.
//
// The function:
//  1. Computes the distance using Haversine
//  2. Estimates the time using the campus average speed
//  3. Applies surge based on demand/supply
//  4. Applies night / weekend / holiday multipliers
//  5. Applies pool discount
//  6. Adds platform fee + GST
//  7. Clamps between min and max
func (f *FareCalculator) Estimate(in FareEstimateInput) *FareEstimate {
	cfg := f.config
	if f.isPremium || in.RideType == "premium" {
		cfg = PremiumFareConfig()
	}
	if in.VehicleType == "bicycle" || in.VehicleType == "electric_scooter" {
		// micro-mobility: half price, no platform fee
		cfg.BaseFare = cfg.BaseFare.Div(decimal.NewFromInt(2))
		cfg.PerKmRate = cfg.PerKmRate.Div(decimal.NewFromInt(2))
		cfg.PlatformFee = decimal.Zero
	}

	if in.At.IsZero() {
		in.At = time.Now()
	}

	distance := haversineDistance(in.PickupLat, in.PickupLng, in.DropoffLat, in.DropoffLng)
	durationSec := estimateDurationSec(distance)

	// Compute fare components
	kmFare := cfg.PerKmRate.Mul(decimal.NewFromFloat(distance / 1000.0))
	timeFare := cfg.PerMinRate.Mul(decimal.NewFromInt(int64(durationSec / 60)))
	subtotal := cfg.BaseFare.Add(kmFare).Add(timeFare)

	// Surge multiplier.
	surge := surgeMultiplier(in.SurgeDemand, in.SurgeSupply, cfg.SurgeCeiling)
	subtotal = subtotal.Mul(surge)

	// Time-of-day adjustments.
	if IsNightTime(in.At) {
		subtotal = subtotal.Mul(cfg.NightSurcharge)
	}
	if IsWeekend(in.At) {
		subtotal = subtotal.Mul(decimal.NewFromFloat(1.10))
	}
	if IsIndianHoliday(in.At) {
		subtotal = subtotal.Mul(decimal.NewFromFloat(1.30))
	}

	// Pool discount
	discount := decimal.Zero
	if in.RideType == "pool" {
		discount = subtotal.Mul(cfg.PoolDiscount)
		subtotal = subtotal.Sub(discount)
	}
	// Round to nearest rupee
	subtotal = subtotal.Round(0)

	// Platform fee
	platform := cfg.PlatformFee

	// GST
	tax := subtotal.Add(platform).Mul(cfg.GstPct).Div(decimal.NewFromInt(100))

	total := subtotal.Add(platform).Add(tax)
	if total.LessThan(cfg.MinFare) {
		total = cfg.MinFare
	}
	if total.GreaterThan(cfg.MaxFare) {
		total = cfg.MaxFare
	}

	return &FareEstimate{
		BaseFare:        cfg.BaseFare,
		DistanceFare:    kmFare,
		TimeFare:        timeFare,
		SurgeMultiplier: surge,
		PlatformFee:     platform,
		Tax:             tax,
		Discount:        discount,
		Total:           total,
		DistanceMeters:  distance,
		DurationSec:     durationSec,
		ExpiresAt:       time.Now().Add(2 * time.Minute),
	}
}

// surgeMultiplier computes surge using a soft sigmoid over the
// demand-supply gap. Supply of 1.0 with demand of 0.0 = 1.0x; supply
// 0.0 with demand 1.0 = ceiling.
func surgeMultiplier(demand, supply, ceiling decimal.Decimal) decimal.Decimal {
	if supply.IsZero() {
		return ceiling
	}
	if demand.IsZero() {
		return decimal.NewFromInt(1)
	}
	gap := demand.Sub(supply)
	if gap.LessThanOrEqual(decimal.Zero) {
		return decimal.NewFromInt(1)
	}
	multiplier := decimal.NewFromFloat(1.0).Add(gap.Mul(decimal.NewFromFloat(2.5)))
	if multiplier.GreaterThan(ceiling) {
		multiplier = ceiling
	}
	return multiplier.Round(2)
}

// ReconciliationInput is the post-trip recompute payload.
type ReconciliationInput struct {
	EstimatedFare decimal.Decimal
	Distance      decimal.Decimal // meters
	Duration      decimal.Decimal // seconds
	WaitingSec    int
	At            time.Time
}

// Reconcile recomputes the final fare at trip completion. Adjusts the
// estimated fare up or down based on the actual distance / duration.
func (f *FareCalculator) Reconcile(estimatedFare, distance, duration decimal.Decimal, at time.Time) decimal.Decimal {
	cfg := f.config
	if f.isPremium {
		cfg = PremiumFareConfig()
	}
	kmFare := cfg.PerKmRate.Mul(distance.Div(decimal.NewFromInt(1000)))
	timeFare := cfg.PerMinRate.Mul(duration.Div(decimal.NewFromInt(60)))
	waiting := cfg.WaitingFeePerMin.Mul(decimal.NewFromInt(int64(floorDivInt(f.config, 0))))
	_ = waiting

	final := cfg.BaseFare.Add(kmFare).Add(timeFare)
	if IsNightTime(at) {
		final = final.Mul(cfg.NightSurcharge)
	}
	final = final.Add(cfg.PlatformFee)
	final = final.Add(final.Mul(cfg.GstPct).Div(decimal.NewFromInt(100)))
	// Blend 60/40 with estimate to dampen GPS noise.
	blended := estimatedFare.Mul(decimal.NewFromFloat(0.4)).Add(final.Mul(decimal.NewFromFloat(0.6)))
	if blended.LessThan(cfg.MinFare) {
		blended = cfg.MinFare
	}
	if blended.GreaterThan(cfg.MaxFare) {
		blended = cfg.MaxFare
	}
	return blended.Round(0)
}

func floorDivInt(_ FareConfig, _ int) int { return 0 }

// CancellationFee returns the fee charged when a ride is cancelled.
// Free if cancelled before matching; 25% after matching; 50% after
// pickup.
func (f *FareCalculator) CancellationFee(status string, estimatedFare decimal.Decimal) decimal.Decimal {
	switch status {
	case "requested", "matching":
		return decimal.Zero
	case "offered", "accepted", "driver_enroute":
		return estimatedFare.Mul(decimal.NewFromFloat(0.25)).Round(0)
	case "arrived", "in_progress":
		return estimatedFare.Mul(decimal.NewFromFloat(0.50)).Round(0)
	}
	return decimal.Zero
}

// Calculate is the legacy entry point kept for backwards compatibility.
func Calculate(distanceMeters float64, rideType string, at time.Time) decimal.Decimal {
	fc := DefaultFareConfig()
	distanceKm := decimal.NewFromFloat(distanceMeters / 1000.0)
	fare := fc.BaseFare.Add(fc.PerKmRate.Mul(distanceKm))
	if IsNightTime(at) {
		fare = fare.Mul(fc.NightSurcharge)
	}
	if rideType == "pool" {
		discount := fare.Mul(fc.PoolDiscount)
		fare = fare.Sub(discount)
	}
	fare = fare.Round(0)
	if fare.LessThan(fc.MinFare) {
		fare = fc.MinFare
	}
	if fare.GreaterThan(fc.MaxFare) {
		fare = fc.MaxFare
	}
	return fare
}

// CalculateFromCoords computes fare from coordinates.
func CalculateFromCoords(pickupLat, pickupLng, dropoffLat, dropoffLng float64, rideType string, at time.Time) decimal.Decimal {
	d := haversineDistance(pickupLat, pickupLng, dropoffLat, dropoffLng)
	return Calculate(d, rideType, at)
}

// SplitFare distributes fare equally among participants. If the
// amount doesn't divide evenly, the first participant pays the
// remainder.
func SplitFare(totalFare decimal.Decimal, participants int) []decimal.Decimal {
	if participants <= 0 {
		return nil
	}
	if participants == 1 {
		return []decimal.Decimal{totalFare}
	}
	shares := make([]decimal.Decimal, participants)
	perPerson := totalFare.Div(decimal.NewFromInt(int64(participants))).Round(2)
	othersTotal := perPerson.Mul(decimal.NewFromInt(int64(participants - 1)))
	shares[0] = totalFare.Sub(othersTotal)
	for i := 1; i < participants; i++ {
		shares[i] = perPerson
	}
	return shares
}

// PoolDiscountAmount returns the discount amount for a given ride type.
func PoolDiscountAmount(total decimal.Decimal, rideType string) decimal.Decimal {
	if rideType != "pool" {
		return decimal.Zero
	}
	return total.Mul(DefaultFareConfig().PoolDiscount).Round(0)
}

// estimateDurationSec mirrors the helper in service.go but is local
// to fare calculations so the package compiles independently.
func estimateDurationSec(distanceMeters float64) int {
	avgSpeedKph := 18.0
	hours := (distanceMeters / 1000.0) / avgSpeedKph
	return int(hours * 3600)
}

// Ensure imports referenced.
var _ = errors.New
var _ = math.Round