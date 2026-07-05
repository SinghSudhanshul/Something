package fleet

import (
	"time"

	"github.com/google/uuid"
)

// ---------------------------------------------------------------------------
// Core domain models
// ---------------------------------------------------------------------------

// Vehicle represents a physical vehicle in the Nexus fleet.
type Vehicle struct {
	ID                 uuid.UUID              `json:"id"`
	RegistrationNumber string                 `json:"registration_number"`
	VehicleType        string                 `json:"vehicle_type"`
	Make               string                 `json:"make"`
	Model              string                 `json:"model"`
	Color              string                 `json:"color"`
	Year               int                    `json:"year"`
	CampusID           uuid.UUID              `json:"campus_id"`
	AssignedDriverID   *uuid.UUID             `json:"assigned_driver_id,omitempty"`
	Status             string                 `json:"status"`
	SkinID             *uuid.UUID             `json:"skin_id,omitempty"`
	MileageKm          float64                `json:"mileage_km"`
	FuelType           string                 `json:"fuel_type"`
	SeatingCapacity    int                    `json:"seating_capacity"`
	InsuranceExpiry    *time.Time             `json:"insurance_expiry,omitempty"`
	PermitExpiry       *time.Time             `json:"permit_expiry,omitempty"`
	LastServiceAt      *time.Time             `json:"last_service_at,omitempty"`
	NextServiceDue     *time.Time             `json:"next_service_due,omitempty"`
	Lat                *float64               `json:"lat,omitempty"`
	Lng                *float64               `json:"lng,omitempty"`
	VINNumber          *string                `json:"vin_number,omitempty"`
	QRCode             *string                `json:"qr_code,omitempty"`
	Features           map[string]interface{} `json:"features,omitempty"`
	CreatedAt          time.Time              `json:"created_at"`
	UpdatedAt          time.Time              `json:"updated_at"`
}

// VehicleServiceLog records a maintenance or service event for a vehicle.
type VehicleServiceLog struct {
	ID               uuid.UUID  `json:"id"`
	VehicleID        uuid.UUID  `json:"vehicle_id"`
	ServiceType      string     `json:"service_type"`
	Description      string     `json:"description"`
	PartsReplaced    []string   `json:"parts_replaced,omitempty"`
	MileageAtService float64    `json:"mileage_at_service"`
	Cost             float64    `json:"cost"`
	PerformedBy      string     `json:"performed_by"`
	WorkshopName     string     `json:"workshop_name"`
	InvoiceURL       *string    `json:"invoice_url,omitempty"`
	StartedAt        time.Time  `json:"started_at"`
	CompletedAt      *time.Time `json:"completed_at,omitempty"`
	NextServiceDue   *time.Time `json:"next_service_due,omitempty"`
	Notes            *string    `json:"notes,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
}

// VehicleTelemetry stores a point-in-time snapshot of vehicle sensor data.
type VehicleTelemetry struct {
	ID           uuid.UUID              `json:"id"`
	VehicleID    uuid.UUID              `json:"vehicle_id"`
	BatteryPct   *int                   `json:"battery_pct,omitempty"`
	FuelPct      *int                   `json:"fuel_pct,omitempty"`
	SpeedKmh     *float64               `json:"speed_kmh,omitempty"`
	EngineTempC  *float64               `json:"engine_temp_c,omitempty"`
	TirePressure map[string]float64     `json:"tire_pressure,omitempty"`
	OdometerKm   *float64               `json:"odometer_km,omitempty"`
	Lat          *float64               `json:"lat,omitempty"`
	Lng          *float64               `json:"lng,omitempty"`
	Heading      *float64               `json:"heading,omitempty"`
	AltitudeM    *float64               `json:"altitude_m,omitempty"`
	Diagnostics  map[string]interface{} `json:"diagnostics,omitempty"`
	RecordedAt   time.Time              `json:"recorded_at"`
}

// VehicleSkin represents a visual wrap or branding option for vehicles.
type VehicleSkin struct {
	ID          uuid.UUID  `json:"id"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	ImageURL    *string    `json:"image_url,omitempty"`
	WrapType    string     `json:"wrap_type"`
	CampusID    *uuid.UUID `json:"campus_id,omitempty"`
	IsActive    bool       `json:"is_active"`
	CreatedAt   time.Time  `json:"created_at"`
}

// DeploymentZone defines a geographic area where vehicles should be staged.
type DeploymentZone struct {
	ID             uuid.UUID              `json:"id"`
	CampusID       uuid.UUID              `json:"campus_id"`
	Name           string                 `json:"name"`
	Description    string                 `json:"description"`
	Priority       int                    `json:"priority"`
	TargetVehicles int                    `json:"target_vehicles"`
	MaxVehicles    int                    `json:"max_vehicles"`
	IsActive       bool                   `json:"is_active"`
	OperatingHours map[string]interface{} `json:"operating_hours,omitempty"`
	CreatedAt      time.Time              `json:"created_at"`
	UpdatedAt      time.Time              `json:"updated_at"`
}

// ---------------------------------------------------------------------------
// Input structs
// ---------------------------------------------------------------------------

// RegisterVehicleInput is the payload to register a new vehicle.
type RegisterVehicleInput struct {
	RegistrationNumber string                 `json:"registration_number" binding:"required"`
	VehicleType        string                 `json:"vehicle_type" binding:"required"`
	Make               string                 `json:"make" binding:"required"`
	Model              string                 `json:"model" binding:"required"`
	Color              string                 `json:"color" binding:"required"`
	Year               int                    `json:"year" binding:"required,min=1990"`
	CampusID           string                 `json:"campus_id" binding:"required,uuid"`
	FuelType           string                 `json:"fuel_type" binding:"required"`
	SeatingCapacity    int                    `json:"seating_capacity" binding:"required,min=1,max=60"`
	InsuranceExpiry    *time.Time             `json:"insurance_expiry,omitempty"`
	PermitExpiry       *time.Time             `json:"permit_expiry,omitempty"`
	VINNumber          *string                `json:"vin_number,omitempty"`
	QRCode             *string                `json:"qr_code,omitempty"`
	MileageKm          float64                `json:"mileage_km"`
	Features           map[string]interface{} `json:"features,omitempty"`
}

// UpdateVehicleInput is the payload to patch an existing vehicle.
type UpdateVehicleInput struct {
	RegistrationNumber *string                `json:"registration_number,omitempty"`
	VehicleType        *string                `json:"vehicle_type,omitempty"`
	Make               *string                `json:"make,omitempty"`
	Model              *string                `json:"model,omitempty"`
	Color              *string                `json:"color,omitempty"`
	Year               *int                   `json:"year,omitempty"`
	FuelType           *string                `json:"fuel_type,omitempty"`
	SeatingCapacity    *int                   `json:"seating_capacity,omitempty"`
	InsuranceExpiry    *time.Time             `json:"insurance_expiry,omitempty"`
	PermitExpiry       *time.Time             `json:"permit_expiry,omitempty"`
	VINNumber          *string                `json:"vin_number,omitempty"`
	QRCode             *string                `json:"qr_code,omitempty"`
	MileageKm          *float64               `json:"mileage_km,omitempty"`
	Status             *string                `json:"status,omitempty"`
	Lat                *float64               `json:"lat,omitempty"`
	Lng                *float64               `json:"lng,omitempty"`
	Features           map[string]interface{} `json:"features,omitempty"`
}

// CreateServiceLogInput is the payload to record a vehicle service event.
type CreateServiceLogInput struct {
	ServiceType      string     `json:"service_type" binding:"required"`
	Description      string     `json:"description" binding:"required"`
	PartsReplaced    []string   `json:"parts_replaced,omitempty"`
	MileageAtService float64    `json:"mileage_at_service" binding:"required"`
	Cost             float64    `json:"cost" binding:"required,min=0"`
	PerformedBy      string     `json:"performed_by" binding:"required"`
	WorkshopName     string     `json:"workshop_name" binding:"required"`
	InvoiceURL       *string    `json:"invoice_url,omitempty"`
	StartedAt        time.Time  `json:"started_at" binding:"required"`
	CompletedAt      *time.Time `json:"completed_at,omitempty"`
	NextServiceDue   *time.Time `json:"next_service_due,omitempty"`
	Notes            *string    `json:"notes,omitempty"`
}

// RecordTelemetryInput is the payload for a telemetry data point.
type RecordTelemetryInput struct {
	BatteryPct   *int                   `json:"battery_pct,omitempty"`
	FuelPct      *int                   `json:"fuel_pct,omitempty"`
	SpeedKmh     *float64               `json:"speed_kmh,omitempty"`
	EngineTempC  *float64               `json:"engine_temp_c,omitempty"`
	TirePressure map[string]float64     `json:"tire_pressure,omitempty"`
	OdometerKm   *float64               `json:"odometer_km,omitempty"`
	Lat          *float64               `json:"lat,omitempty"`
	Lng          *float64               `json:"lng,omitempty"`
	Heading      *float64               `json:"heading,omitempty"`
	AltitudeM    *float64               `json:"altitude_m,omitempty"`
	Diagnostics  map[string]interface{} `json:"diagnostics,omitempty"`
	RecordedAt   *time.Time             `json:"recorded_at,omitempty"`
}

// CreateSkinInput is the payload to create a new vehicle skin.
type CreateSkinInput struct {
	Name        string  `json:"name" binding:"required"`
	Description string  `json:"description" binding:"required"`
	ImageURL    *string `json:"image_url,omitempty"`
	WrapType    string  `json:"wrap_type" binding:"required"`
	CampusID    *string `json:"campus_id,omitempty"`
}

// CreateZoneInput is the payload to create a deployment zone.
type CreateZoneInput struct {
	CampusID       string                 `json:"campus_id" binding:"required,uuid"`
	Name           string                 `json:"name" binding:"required"`
	Description    string                 `json:"description" binding:"required"`
	Priority       int                    `json:"priority" binding:"min=0"`
	TargetVehicles int                    `json:"target_vehicles" binding:"required,min=1"`
	MaxVehicles    int                    `json:"max_vehicles" binding:"required,min=1"`
	OperatingHours map[string]interface{} `json:"operating_hours,omitempty"`
}

// ---------------------------------------------------------------------------
// Response structs
// ---------------------------------------------------------------------------

// VehicleResponse is the API representation of a vehicle.
type VehicleResponse struct {
	ID                 uuid.UUID              `json:"id"`
	RegistrationNumber string                 `json:"registration_number"`
	VehicleType        string                 `json:"vehicle_type"`
	Make               string                 `json:"make"`
	Model              string                 `json:"model"`
	Color              string                 `json:"color"`
	Year               int                    `json:"year"`
	CampusID           uuid.UUID              `json:"campus_id"`
	AssignedDriverID   *uuid.UUID             `json:"assigned_driver_id,omitempty"`
	Status             string                 `json:"status"`
	SkinID             *uuid.UUID             `json:"skin_id,omitempty"`
	MileageKm          float64                `json:"mileage_km"`
	FuelType           string                 `json:"fuel_type"`
	SeatingCapacity    int                    `json:"seating_capacity"`
	InsuranceExpiry    *time.Time             `json:"insurance_expiry,omitempty"`
	PermitExpiry       *time.Time             `json:"permit_expiry,omitempty"`
	LastServiceAt      *time.Time             `json:"last_service_at,omitempty"`
	NextServiceDue     *time.Time             `json:"next_service_due,omitempty"`
	Lat                *float64               `json:"lat,omitempty"`
	Lng                *float64               `json:"lng,omitempty"`
	VINNumber          *string                `json:"vin_number,omitempty"`
	QRCode             *string                `json:"qr_code,omitempty"`
	Features           map[string]interface{} `json:"features,omitempty"`
	LatestTelemetry    *VehicleTelemetry      `json:"latest_telemetry,omitempty"`
	CreatedAt          time.Time              `json:"created_at"`
	UpdatedAt          time.Time              `json:"updated_at"`
}

// ToResponse converts a Vehicle domain model to its API response representation.
func (v *Vehicle) ToResponse() VehicleResponse {
	return VehicleResponse{
		ID:                 v.ID,
		RegistrationNumber: v.RegistrationNumber,
		VehicleType:        v.VehicleType,
		Make:               v.Make,
		Model:              v.Model,
		Color:              v.Color,
		Year:               v.Year,
		CampusID:           v.CampusID,
		AssignedDriverID:   v.AssignedDriverID,
		Status:             v.Status,
		SkinID:             v.SkinID,
		MileageKm:          v.MileageKm,
		FuelType:           v.FuelType,
		SeatingCapacity:    v.SeatingCapacity,
		InsuranceExpiry:    v.InsuranceExpiry,
		PermitExpiry:       v.PermitExpiry,
		LastServiceAt:      v.LastServiceAt,
		NextServiceDue:     v.NextServiceDue,
		Lat:                v.Lat,
		Lng:                v.Lng,
		VINNumber:          v.VINNumber,
		QRCode:             v.QRCode,
		Features:           v.Features,
		CreatedAt:          v.CreatedAt,
		UpdatedAt:          v.UpdatedAt,
	}
}

// FleetStatusCounts holds aggregated vehicle counts broken down by status.
type FleetStatusCounts struct {
	Active      int `json:"active"`
	Idle        int `json:"idle"`
	Maintenance int `json:"maintenance"`
	Retired     int `json:"retired"`
	Total       int `json:"total"`
}

// FleetOverview provides a holistic view of fleet health and deployment.
type FleetOverview struct {
	StatusCounts    FleetStatusCounts `json:"status_counts"`
	AvgMileageKm    float64           `json:"avg_mileage_km"`
	ServiceDueCount int               `json:"service_due_count"`
	InsuranceDueSoon int              `json:"insurance_due_soon"`
	PermitDueSoon   int               `json:"permit_due_soon"`
	Alerts          []FleetAlert      `json:"alerts"`
	ZoneSummaries   []ZoneSummary     `json:"zone_summaries,omitempty"`
}

// FleetAlert represents an actionable alert for the fleet manager.
type FleetAlert struct {
	Severity  string    `json:"severity"`
	VehicleID uuid.UUID `json:"vehicle_id"`
	Message   string    `json:"message"`
	CreatedAt time.Time `json:"created_at"`
}

// ZoneSummary provides a snapshot of vehicles deployed to a zone.
type ZoneSummary struct {
	ZoneID         uuid.UUID `json:"zone_id"`
	ZoneName       string    `json:"zone_name"`
	TargetVehicles int       `json:"target_vehicles"`
	CurrentCount   int       `json:"current_count"`
	Deficit        int       `json:"deficit"`
}

// DiagnosticReport aggregates recent telemetry into actionable diagnostics.
type DiagnosticReport struct {
	VehicleID        uuid.UUID              `json:"vehicle_id"`
	ReportGeneratedAt time.Time             `json:"report_generated_at"`
	SampleCount      int                    `json:"sample_count"`
	AvgSpeedKmh      *float64               `json:"avg_speed_kmh,omitempty"`
	MaxSpeedKmh      *float64               `json:"max_speed_kmh,omitempty"`
	AvgEngineTempC   *float64               `json:"avg_engine_temp_c,omitempty"`
	MaxEngineTempC   *float64               `json:"max_engine_temp_c,omitempty"`
	AvgFuelPct       *float64               `json:"avg_fuel_pct,omitempty"`
	MinFuelPct       *int                   `json:"min_fuel_pct,omitempty"`
	AvgBatteryPct    *float64               `json:"avg_battery_pct,omitempty"`
	MinBatteryPct    *int                   `json:"min_battery_pct,omitempty"`
	TotalDistanceKm  *float64               `json:"total_distance_km,omitempty"`
	Anomalies        []string               `json:"anomalies,omitempty"`
	HealthScore      int                    `json:"health_score"`
	Recommendations  []string               `json:"recommendations,omitempty"`
	RawDiagnostics   map[string]interface{} `json:"raw_diagnostics,omitempty"`
}

// WeatherImpact provides an assessment of how weather affects fleet ops.
type WeatherImpact struct {
	CampusID       uuid.UUID `json:"campus_id"`
	Condition      string    `json:"condition"`
	Temperature    float64   `json:"temperature"`
	Visibility     string    `json:"visibility"`
	RoadCondition  string    `json:"road_condition"`
	ImpactLevel    string    `json:"impact_level"`
	Recommendations []string `json:"recommendations,omitempty"`
	FetchedAt      time.Time `json:"fetched_at"`
}

// VehicleListFilters holds query parameters for listing vehicles.
type VehicleListFilters struct {
	CampusID    *uuid.UUID
	Status      *string
	VehicleType *string
	Limit       int
	Cursor      *uuid.UUID
}

// ---------------------------------------------------------------------------
// Allowed constants
// ---------------------------------------------------------------------------

const (
	VehicleStatusActive      = "active"
	VehicleStatusIdle        = "idle"
	VehicleStatusMaintenance = "maintenance"
	VehicleStatusRetired     = "retired"

	FuelTypePetrol   = "petrol"
	FuelTypeDiesel   = "diesel"
	FuelTypeElectric = "electric"
	FuelTypeCNG      = "cng"
	FuelTypeHybrid   = "hybrid"

	WrapTypeFull    = "full"
	WrapTypePartial = "partial"
	WrapTypeDecal   = "decal"
)

// ValidVehicleStatuses is the set of permissible vehicle statuses.
var ValidVehicleStatuses = map[string]bool{
	VehicleStatusActive:      true,
	VehicleStatusIdle:        true,
	VehicleStatusMaintenance: true,
	VehicleStatusRetired:     true,
}

// ValidFuelTypes is the set of permissible fuel types.
var ValidFuelTypes = map[string]bool{
	FuelTypePetrol:   true,
	FuelTypeDiesel:   true,
	FuelTypeElectric: true,
	FuelTypeCNG:      true,
	FuelTypeHybrid:   true,
}
