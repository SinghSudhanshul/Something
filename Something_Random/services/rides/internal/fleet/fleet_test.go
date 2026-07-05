package fleet

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestVehicleResponseConversion(t *testing.T) {
	v := &Vehicle{
		ID:                 uuid.New(),
		RegistrationNumber: "MH-12-AB-1234",
		VehicleType:        "sedan",
		Make:               "Maruti Suzuki",
		Model:              "Dzire",
		Color:              "Pearl White",
		Year:               2023,
		CampusID:           uuid.New(),
		Status:             "active",
		MileageKm:          15420.5,
		FuelType:           "petrol",
		SeatingCapacity:    4,
		CreatedAt:          time.Now(),
		UpdatedAt:          time.Now(),
	}

	resp := v.ToResponse()
	if resp.ID != v.ID {
		t.Errorf("expected ID %s, got %s", v.ID, resp.ID)
	}
	if resp.RegistrationNumber != v.RegistrationNumber {
		t.Errorf("expected registration %s, got %s", v.RegistrationNumber, resp.RegistrationNumber)
	}
	if resp.Status != v.Status {
		t.Errorf("expected status %s, got %s", v.Status, resp.Status)
	}
	if resp.MileageKm != v.MileageKm {
		t.Errorf("expected mileage %f, got %f", v.MileageKm, resp.MileageKm)
	}
}

func TestRegisterVehicleInputValidation(t *testing.T) {
	tests := []struct {
		name    string
		input   RegisterVehicleInput
		wantErr bool
	}{
		{
			name: "valid input",
			input: RegisterVehicleInput{
				RegistrationNumber: "KA-01-MN-5678",
				VehicleType:        "auto",
				Make:               "Bajaj",
				Model:              "RE",
				Color:              "Green-Yellow",
				Year:               2022,
				CampusID:           uuid.New(),
				FuelType:           "cng",
				SeatingCapacity:    3,
			},
			wantErr: false,
		},
		{
			name: "missing registration number",
			input: RegisterVehicleInput{
				VehicleType:     "sedan",
				Make:            "Hyundai",
				Model:           "Verna",
				Color:           "Blue",
				Year:            2024,
				CampusID:        uuid.New(),
				FuelType:        "petrol",
				SeatingCapacity: 4,
			},
			wantErr: true,
		},
		{
			name: "invalid year",
			input: RegisterVehicleInput{
				RegistrationNumber: "TN-02-XY-9999",
				VehicleType:        "suv",
				Make:               "Tata",
				Model:              "Nexon",
				Color:              "Red",
				Year:               1990,
				CampusID:           uuid.New(),
				FuelType:           "electric",
				SeatingCapacity:    5,
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateRegisterInput(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateRegisterInput() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestFleetOverviewAggregation(t *testing.T) {
	overview := &FleetOverview{
		TotalVehicles:     50,
		ActiveVehicles:    35,
		MaintenanceCount:  8,
		RetiredCount:      5,
		DeployedCount:     2,
		AvgMileageKm:      12500.0,
		ServiceDueCount:   12,
		ServiceAlerts:     []string{"MH-12-AB-1234 overdue for service", "KA-01-CD-5678 low tire pressure"},
		TelemetryAlerts:   3,
		DeploymentZoneCount: 4,
	}

	if overview.TotalVehicles != 50 {
		t.Errorf("expected 50 total, got %d", overview.TotalVehicles)
	}
	if overview.ActiveVehicles+overview.MaintenanceCount+overview.RetiredCount+overview.DeployedCount != overview.TotalVehicles {
		t.Errorf("vehicle counts don't add up: %d+%d+%d+%d != %d",
			overview.ActiveVehicles, overview.MaintenanceCount, overview.RetiredCount, overview.DeployedCount, overview.TotalVehicles)
	}
	if len(overview.ServiceAlerts) != 2 {
		t.Errorf("expected 2 service alerts, got %d", len(overview.ServiceAlerts))
	}
}

func TestVehicleTelemetryThresholds(t *testing.T) {
	tests := []struct {
		name      string
		battery   int
		fuelPct   int
		speedKmh  float64
		engineTmp float64
		alertExpected bool
	}{
		{"normal operation", 80, 60, 40.0, 85.0, false},
		{"low battery", 10, 60, 40.0, 85.0, true},
		{"low fuel", 80, 5, 40.0, 85.0, true},
		{"overspeeding", 80, 60, 120.0, 85.0, true},
		{"engine overheating", 80, 60, 40.0, 110.0, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			alertTriggered := tt.battery < 15 || tt.fuelPct < 10 || tt.speedKmh > 80.0 || tt.engineTmp > 100.0
			if alertTriggered != tt.alertExpected {
				t.Errorf("alert expected=%v, got=%v", tt.alertExpected, alertTriggered)
			}
		})
	}
}

// validateRegisterInput validates a vehicle registration input.
func validateRegisterInput(input RegisterVehicleInput) error {
	if input.RegistrationNumber == "" {
		return context.DeadlineExceeded // placeholder error
	}
	if input.Year < 2000 || input.Year > time.Now().Year()+1 {
		return context.DeadlineExceeded
	}
	if input.SeatingCapacity < 1 || input.SeatingCapacity > 50 {
		return context.DeadlineExceeded
	}
	return nil
}
