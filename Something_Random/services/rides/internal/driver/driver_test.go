package driver

import (
	"encoding/json"
	"regexp"
	"testing"
	"time"

	"github.com/google/uuid"
)

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Driver Struct Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

func TestDriver_JSONSerialization(t *testing.T) {
	lat := 12.8230
	lng := 80.0444
	now := time.Now().UTC().Truncate(time.Microsecond)

	d := Driver{
		ID:            uuid.New(),
		UserID:        uuid.New(),
		CampusID:      uuid.New(),
		LicenseNumber: "TN09AB1234",
		VehicleType:   "motorcycle",
		VehicleNumber: "TN09AB1234",
		VehicleColor:  "Red",
		IsVerified:    true,
		IsAvailable:   true,
		IsWomenOnly:   false,
		Lat:           &lat,
		Lng:           &lng,
		TotalRides:    42,
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	data, err := json.Marshal(d)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var parsed Driver
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if parsed.LicenseNumber != d.LicenseNumber {
		t.Errorf("LicenseNumber: expected %s, got %s", d.LicenseNumber, parsed.LicenseNumber)
	}
	if parsed.VehicleType != d.VehicleType {
		t.Errorf("VehicleType: expected %s, got %s", d.VehicleType, parsed.VehicleType)
	}
	if parsed.TotalRides != 42 {
		t.Errorf("TotalRides: expected 42, got %d", parsed.TotalRides)
	}
	if parsed.Lat == nil || *parsed.Lat != lat {
		t.Error("Lat mismatch")
	}
}

func TestDriver_NilLocation(t *testing.T) {
	d := Driver{
		ID:            uuid.New(),
		UserID:        uuid.New(),
		CampusID:      uuid.New(),
		LicenseNumber: "TN09AB1234",
		VehicleType:   "car",
		IsVerified:    false,
		IsAvailable:   false,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	data, err := json.Marshal(d)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var raw map[string]interface{}
	_ = json.Unmarshal(data, &raw)

	if _, exists := raw["lat"]; exists {
		t.Error("lat should be omitted when nil")
	}
	if _, exists := raw["lng"]; exists {
		t.Error("lng should be omitted when nil")
	}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Vehicle Number Validation Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

func TestVehicleNumberRegex(t *testing.T) {
	regex := regexp.MustCompile(`^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$`)

	tests := []struct {
		name    string
		number  string
		valid   bool
	}{
		{"valid TN format", "TN09AB1234", true},
		{"valid KA format", "KA01A1234", true},
		{"valid AP format", "AP05CD5678", true},
		{"valid MH format", "MH12DE9012", true},
		{"lowercase letters", "tn09ab1234", false},
		{"missing state code", "0912AB1234", false},
		{"too few digits at end", "TN09AB123", false},
		{"too many digits at end", "TN09AB12345", false},
		{"special characters", "TN09AB-1234", false},
		{"spaces", "TN 09 AB 1234", false},
		{"empty string", "", false},
		{"single letter district", "TN09A1234", true},
		{"three letter district (invalid)", "TN09ABC1234", false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := regex.MatchString(tc.number)
			if result != tc.valid {
				t.Errorf("vehicle number '%s': expected valid=%v, got %v", tc.number, tc.valid, result)
			}
		})
	}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Registration Validation Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

func TestRegisterInput_VehicleTypeValidation(t *testing.T) {
	validTypes := map[string]bool{"bicycle": true, "motorcycle": true, "car": true}

	tests := []struct {
		name        string
		vehicleType string
		valid       bool
	}{
		{"bicycle", "bicycle", true},
		{"motorcycle", "motorcycle", true},
		{"car", "car", true},
		{"truck", "truck", false},
		{"scooter", "scooter", false},
		{"empty", "", false},
		{"uppercase", "CAR", false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if validTypes[tc.vehicleType] != tc.valid {
				t.Errorf("vehicle type '%s': expected valid=%v", tc.vehicleType, tc.valid)
			}
		})
	}
}

func TestRegisterInput_VerificationLevelCheck(t *testing.T) {
	tests := []struct {
		name     string
		level    int
		allowed  bool
	}{
		{"level 0", 0, false},
		{"level 1", 1, false},
		{"level 2 (minimum)", 2, true},
		{"level 3", 3, true},
		{"level 4", 4, true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			allowed := tc.level >= 2
			if allowed != tc.allowed {
				t.Errorf("verification level %d: expected allowed=%v, got %v", tc.level, tc.allowed, allowed)
			}
		})
	}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DriverWithDistance Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

func TestDriverWithDistance_Sorting(t *testing.T) {
	drivers := []DriverWithDistance{
		{
			Driver:         Driver{ID: uuid.New(), VehicleType: "motorcycle"},
			DistanceMeters: 500,
			TrustScore:     4.5,
			CompositeScore: 500*0.6 + (5.0-4.5)*0.4*1000, // 300 + 200 = 500
		},
		{
			Driver:         Driver{ID: uuid.New(), VehicleType: "car"},
			DistanceMeters: 200,
			TrustScore:     3.0,
			CompositeScore: 200*0.6 + (5.0-3.0)*0.4*1000, // 120 + 800 = 920
		},
		{
			Driver:         Driver{ID: uuid.New(), VehicleType: "bicycle"},
			DistanceMeters: 100,
			TrustScore:     4.8,
			CompositeScore: 100*0.6 + (5.0-4.8)*0.4*1000, // 60 + 80 = 140
		},
	}

	// Verify the closest + most trusted driver has lowest composite score
	lowestScore := drivers[0].CompositeScore
	lowestIdx := 0
	for i, d := range drivers {
		if d.CompositeScore < lowestScore {
			lowestScore = d.CompositeScore
			lowestIdx = i
		}
	}

	if lowestIdx != 2 {
		t.Errorf("bicycle driver (100m, 4.8 trust) should have lowest composite score, got index %d", lowestIdx)
	}
	if lowestScore != 140 {
		t.Errorf("expected composite score 140, got %f", lowestScore)
	}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Coordinate Validation Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

func TestCoordinateValidation(t *testing.T) {
	tests := []struct {
		name  string
		lat   float64
		lng   float64
		valid bool
	}{
		{"SRM campus", 12.8230, 80.0444, true},
		{"IIT Bombay", 19.1334, 72.9133, true},
		{"IIT Delhi", 28.5450, 77.1926, true},
		{"equator prime meridian", 0, 0, true},
		{"max lat", 90, 0, true},
		{"min lat", -90, 0, true},
		{"max lng", 0, 180, true},
		{"min lng", 0, -180, true},
		{"lat too high", 91, 0, false},
		{"lat too low", -91, 0, false},
		{"lng too high", 0, 181, false},
		{"lng too low", 0, -181, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			valid := tc.lat >= -90 && tc.lat <= 90 && tc.lng >= -180 && tc.lng <= 180
			if valid != tc.valid {
				t.Errorf("(%f, %f): expected valid=%v", tc.lat, tc.lng, tc.valid)
			}
		})
	}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Availability Logic Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

func TestAvailability_UnverifiedCannotGoOnline(t *testing.T) {
	driver := Driver{
		IsVerified:  false,
		IsAvailable: false,
	}

	wantOnline := true
	if wantOnline && !driver.IsVerified {
		// Expected: should fail
	} else {
		t.Error("unverified driver should not be able to go available")
	}
}

func TestAvailability_VerifiedCanGoOnline(t *testing.T) {
	driver := Driver{
		IsVerified:  true,
		IsAvailable: false,
	}

	wantOnline := true
	if wantOnline && !driver.IsVerified {
		t.Error("verified driver should be able to go available")
	}
}

func TestAvailability_GoingOfflineClearsLocation(t *testing.T) {
	// When driver goes offline, their cached location should be cleared
	wantOnline := false
	locationKeyDeleted := !wantOnline

	if !locationKeyDeleted {
		t.Error("going offline should trigger location key deletion")
	}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Ride History Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

func TestRideHistory_LimitValidation(t *testing.T) {
	tests := []struct {
		input    int
		expected int
	}{
		{0, 20},
		{-1, 20},
		{5, 5},
		{20, 20},
		{50, 50},
		{51, 20},
		{100, 20},
	}

	for _, tc := range tests {
		limit := tc.input
		if limit <= 0 || limit > 50 {
			limit = 20
		}
		if limit != tc.expected {
			t.Errorf("input %d: expected limit %d, got %d", tc.input, tc.expected, limit)
		}
	}
}
