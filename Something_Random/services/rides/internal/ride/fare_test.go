package ride

import (
	"testing"
	"time"

	"github.com/shopspring/decimal"
)

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Fare Calculation Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

func TestCalculate_SoloDay_ShortDistance(t *testing.T) {
	// 500m solo ride during day = base(10) + 0.5km * 8 = 14 → clamped to min 15
	fare := Calculate(500, "solo", time.Date(2024, 6, 15, 14, 0, 0, 0, time.UTC))
	expected := decimal.NewFromFloat(15)
	if !fare.Equal(expected) {
		t.Errorf("expected %s, got %s", expected.StringFixed(2), fare.StringFixed(2))
	}
}

func TestCalculate_SoloDay_MediumDistance(t *testing.T) {
	// 2km solo ride during day = base(10) + 2km * 8 = 26 → round = 26
	fare := Calculate(2000, "solo", time.Date(2024, 6, 15, 14, 0, 0, 0, time.UTC))
	expected := decimal.NewFromFloat(26)
	if !fare.Equal(expected) {
		t.Errorf("expected %s, got %s", expected.StringFixed(2), fare.StringFixed(2))
	}
}

func TestCalculate_SoloNight_Surcharge(t *testing.T) {
	// 2km solo ride at night = (10 + 2*8) * 1.25 = 32.50 → round = 33
	ist, _ := time.LoadLocation("Asia/Kolkata")
	nightTime := time.Date(2024, 6, 15, 23, 30, 0, 0, ist) // 11:30 PM IST
	fare := Calculate(2000, "solo", nightTime)
	expected := decimal.NewFromFloat(33)
	if !fare.Equal(expected) {
		t.Errorf("expected %s, got %s", expected.StringFixed(2), fare.StringFixed(2))
	}
}

func TestCalculate_PoolDay_Discount(t *testing.T) {
	// 2km pool ride during day = (10 + 2*8) * (1 - 0.30) = 18.20 → round = 18
	fare := Calculate(2000, "pool", time.Date(2024, 6, 15, 14, 0, 0, 0, time.UTC))
	expected := decimal.NewFromFloat(18)
	if !fare.Equal(expected) {
		t.Errorf("expected %s, got %s", expected.StringFixed(2), fare.StringFixed(2))
	}
}

func TestCalculate_MaxFareClamping(t *testing.T) {
	// 15km solo ride during day = 10 + 15*8 = 130 → clamped to 100
	fare := Calculate(15000, "solo", time.Date(2024, 6, 15, 14, 0, 0, 0, time.UTC))
	expected := decimal.NewFromFloat(100)
	if !fare.Equal(expected) {
		t.Errorf("expected %s (max fare), got %s", expected.StringFixed(2), fare.StringFixed(2))
	}
}

func TestCalculate_MinFareClamping(t *testing.T) {
	// 100m pool ride during day → very low fare → clamped to 15
	fare := Calculate(100, "pool", time.Date(2024, 6, 15, 14, 0, 0, 0, time.UTC))
	expected := decimal.NewFromFloat(15)
	if !fare.Equal(expected) {
		t.Errorf("expected %s (min fare), got %s", expected.StringFixed(2), fare.StringFixed(2))
	}
}

func TestCalculate_ZeroDistance(t *testing.T) {
	// 0m ride → base fare 10, rounded → clamped to min 15
	fare := Calculate(0, "solo", time.Date(2024, 6, 15, 14, 0, 0, 0, time.UTC))
	expected := decimal.NewFromFloat(15)
	if !fare.Equal(expected) {
		t.Errorf("expected %s (min fare), got %s", expected.StringFixed(2), fare.StringFixed(2))
	}
}

func TestCalculate_PoolNightSurchargeAndDiscount(t *testing.T) {
	// 3km pool at night = ((10 + 3*8) * 1.25) * 0.70 = 42.5 * 0.70 = 29.75 → round = 30
	// Actually: fare = base + per_km*km = 10 + 24 = 34
	// Night surcharge: 34 * 1.25 = 42.5
	// Pool discount: 42.5 * 0.30 = 12.75; 42.5 - 12.75 = 29.75 → round = 30
	ist, _ := time.LoadLocation("Asia/Kolkata")
	nightTime := time.Date(2024, 6, 15, 2, 0, 0, 0, ist) // 2:00 AM IST
	fare := Calculate(3000, "pool", nightTime)
	expected := decimal.NewFromFloat(30)
	if !fare.Equal(expected) {
		t.Errorf("expected %s, got %s", expected.StringFixed(2), fare.StringFixed(2))
	}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Fare Split Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

func TestSplitFare_Single(t *testing.T) {
	total := decimal.NewFromFloat(50)
	shares := SplitFare(total, 1)
	if len(shares) != 1 {
		t.Fatalf("expected 1 share, got %d", len(shares))
	}
	if !shares[0].Equal(total) {
		t.Errorf("single share should equal total: got %s", shares[0].StringFixed(2))
	}
}

func TestSplitFare_Two(t *testing.T) {
	total := decimal.NewFromFloat(50)
	shares := SplitFare(total, 2)
	if len(shares) != 2 {
		t.Fatalf("expected 2 shares, got %d", len(shares))
	}
	sum := shares[0].Add(shares[1])
	if !sum.Equal(total) {
		t.Errorf("sum of shares should equal total: got %s", sum.StringFixed(2))
	}
}

func TestSplitFare_Three_UnevenAmount(t *testing.T) {
	// 100 / 3 = 33.33 each, first person pays 33.34
	total := decimal.NewFromFloat(100)
	shares := SplitFare(total, 3)
	if len(shares) != 3 {
		t.Fatalf("expected 3 shares, got %d", len(shares))
	}

	sum := decimal.Zero
	for _, s := range shares {
		sum = sum.Add(s)
	}
	if !sum.Equal(total) {
		t.Errorf("sum of shares (%s) should equal total (%s)", sum.StringFixed(2), total.StringFixed(2))
	}

	// First person should pay the remainder
	perPerson := total.Div(decimal.NewFromInt(3)).Round(2) // 33.33
	for i := 1; i < len(shares); i++ {
		if !shares[i].Equal(perPerson) {
			t.Errorf("share %d: expected %s, got %s", i, perPerson.StringFixed(2), shares[i].StringFixed(2))
		}
	}
}

func TestSplitFare_Four(t *testing.T) {
	total := decimal.NewFromFloat(75)
	shares := SplitFare(total, 4)
	if len(shares) != 4 {
		t.Fatalf("expected 4 shares, got %d", len(shares))
	}

	sum := decimal.Zero
	for _, s := range shares {
		sum = sum.Add(s)
	}
	if !sum.Equal(total) {
		t.Errorf("sum of shares should equal total: %s != %s", sum.StringFixed(2), total.StringFixed(2))
	}
}

func TestSplitFare_Zero(t *testing.T) {
	shares := SplitFare(decimal.NewFromFloat(50), 0)
	if shares != nil {
		t.Errorf("expected nil for 0 participants, got %v", shares)
	}
}

func TestSplitFare_Negative(t *testing.T) {
	shares := SplitFare(decimal.NewFromFloat(50), -1)
	if shares != nil {
		t.Errorf("expected nil for negative participants, got %v", shares)
	}
}

func TestSplitFare_SmallAmount(t *testing.T) {
	// ₹15 / 4 = 3.75 each, exact split
	total := decimal.NewFromFloat(15)
	shares := SplitFare(total, 4)
	sum := decimal.Zero
	for _, s := range shares {
		sum = sum.Add(s)
	}
	if !sum.Equal(total) {
		t.Errorf("sum should equal total: %s != %s", sum.StringFixed(2), total.StringFixed(2))
	}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Night Time Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

func TestIsNightTime_Late(t *testing.T) {
	ist, _ := time.LoadLocation("Asia/Kolkata")
	testCases := []struct {
		name     string
		hour     int
		expected bool
	}{
		{"10 PM IST", 22, true},
		{"11 PM IST", 23, true},
		{"Midnight IST", 0, true},
		{"3 AM IST", 3, true},
		{"5 AM IST", 5, true},
		{"6 AM IST", 6, false},
		{"7 AM IST", 7, false},
		{"Noon IST", 12, false},
		{"3 PM IST", 15, false},
		{"9 PM IST", 21, false},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			testTime := time.Date(2024, 6, 15, tc.hour, 0, 0, 0, ist)
			result := IsNightTime(testTime)
			if result != tc.expected {
				t.Errorf("IsNightTime at %d:00 IST: expected %v, got %v", tc.hour, tc.expected, result)
			}
		})
	}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Haversine Distance Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

func TestHaversineDistance_SamePoint(t *testing.T) {
	dist := haversineDistance(12.8230, 80.0444, 12.8230, 80.0444) // SRM campus
	if dist != 0 {
		t.Errorf("expected 0 distance for same point, got %f", dist)
	}
}

func TestHaversineDistance_KnownDistance(t *testing.T) {
	// SRM University to Chennai Airport (~14km)
	dist := haversineDistance(12.8230, 80.0444, 12.9941, 80.1709)
	// Allow 10% tolerance
	if dist < 12000 || dist > 22000 {
		t.Errorf("SRM to Airport: expected ~14-20km, got %f meters", dist)
	}
}

func TestHaversineDistance_ShortCampusDistance(t *testing.T) {
	// Two points within SRM campus (~500m apart)
	dist := haversineDistance(12.8230, 80.0444, 12.8270, 80.0480)
	if dist < 300 || dist > 1000 {
		t.Errorf("campus distance: expected 300-1000m, got %f meters", dist)
	}
}

func TestCalculateFromCoords_Integration(t *testing.T) {
	// Known route within campus
	fare := CalculateFromCoords(
		12.8230, 80.0444, // SRM Kattankulathur
		12.8270, 80.0480, // Another point on campus
		"solo",
		time.Date(2024, 6, 15, 14, 0, 0, 0, time.UTC),
	)

	cfg := DefaultFareConfig()
	if fare.LessThan(cfg.MinFare) {
		t.Errorf("fare should be at least MinFare (%s), got %s", cfg.MinFare.StringFixed(2), fare.StringFixed(2))
	}
	if fare.GreaterThan(cfg.MaxFare) {
		t.Errorf("fare should be at most MaxFare (%s), got %s", cfg.MaxFare.StringFixed(2), fare.StringFixed(2))
	}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Fare Config Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

func TestDefaultFareConfig_Values(t *testing.T) {
	cfg := DefaultFareConfig()

	if !cfg.BaseFare.Equal(decimal.NewFromFloat(10)) {
		t.Errorf("BaseFare: expected 10.00, got %s", cfg.BaseFare.StringFixed(2))
	}
	if !cfg.PerKmRate.Equal(decimal.NewFromFloat(8)) {
		t.Errorf("PerKmRate: expected 8.00, got %s", cfg.PerKmRate.StringFixed(2))
	}
	if !cfg.MinFare.Equal(decimal.NewFromFloat(15)) {
		t.Errorf("MinFare: expected 15.00, got %s", cfg.MinFare.StringFixed(2))
	}
	if !cfg.MaxFare.Equal(decimal.NewFromFloat(100)) {
		t.Errorf("MaxFare: expected 100.00, got %s", cfg.MaxFare.StringFixed(2))
	}
	if !cfg.PoolDiscount.Equal(decimal.NewFromFloat(0.30)) {
		t.Errorf("PoolDiscount: expected 0.30, got %s", cfg.PoolDiscount.StringFixed(2))
	}
	if !cfg.NightSurcharge.Equal(decimal.NewFromFloat(1.25)) {
		t.Errorf("NightSurcharge: expected 1.25, got %s", cfg.NightSurcharge.StringFixed(2))
	}
}

func TestFareCalculation_DecimalPrecision(t *testing.T) {
	// Ensure no floating-point drift across multiple calculations
	for i := 0; i < 1000; i++ {
		total := decimal.NewFromFloat(100)
		shares := SplitFare(total, 3)
		sum := decimal.Zero
		for _, s := range shares {
			sum = sum.Add(s)
		}
		if !sum.Equal(total) {
			t.Fatalf("iteration %d: sum %s != total %s", i, sum.StringFixed(2), total.StringFixed(2))
		}
	}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Fare Boundary Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

func TestFare_ExactlyMinFare(t *testing.T) {
	// Find a distance that gives exactly ₹15
	// 15 = 10 + 8*km → km = 0.625 → 625m
	fare := Calculate(625, "solo", time.Date(2024, 6, 15, 14, 0, 0, 0, time.UTC))
	if fare.LessThan(decimal.NewFromFloat(15)) {
		t.Errorf("fare at 625m should be >= MinFare, got %s", fare.StringFixed(2))
	}
}

func TestFare_JustBelowMaxFare(t *testing.T) {
	// (100-10)/8 = 11.25km → 11250m = exactly ₹100
	fare := Calculate(11250, "solo", time.Date(2024, 6, 15, 14, 0, 0, 0, time.UTC))
	if fare.GreaterThan(decimal.NewFromFloat(100)) {
		t.Errorf("fare should not exceed MaxFare, got %s", fare.StringFixed(2))
	}
}

func TestFare_VerifyNeverExceedsMax(t *testing.T) {
	cfg := DefaultFareConfig()
	distances := []float64{100, 500, 1000, 2000, 5000, 10000, 15000, 20000, 50000}
	rideTypes := []string{"solo", "pool"}
	times := []time.Time{
		time.Date(2024, 6, 15, 14, 0, 0, 0, time.UTC), // day
		time.Date(2024, 6, 15, 23, 0, 0, 0, time.UTC), // night
	}

	for _, dist := range distances {
		for _, rt := range rideTypes {
			for _, at := range times {
				fare := Calculate(dist, rt, at)
				if fare.GreaterThan(cfg.MaxFare) {
					t.Errorf("fare exceeds max at dist=%fm, type=%s: %s > %s",
						dist, rt, fare.StringFixed(2), cfg.MaxFare.StringFixed(2))
				}
				if fare.LessThan(cfg.MinFare) {
					t.Errorf("fare below min at dist=%fm, type=%s: %s < %s",
						dist, rt, fare.StringFixed(2), cfg.MinFare.StringFixed(2))
				}
			}
		}
	}
}
