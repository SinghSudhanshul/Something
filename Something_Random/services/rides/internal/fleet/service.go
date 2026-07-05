package fleet

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"

	internalKafka "nexus/rides/internal/kafka"
)

// Telemetry alert thresholds.
const (
	thresholdEngineTempHigh  = 105.0
	thresholdFuelLow         = 10
	thresholdBatteryLow      = 15
	thresholdSpeedMax        = 120.0
	diagnosticWindowHours    = 24
	serviceDueAlertWindow    = 7 * 24 * time.Hour
)

// Service contains the business logic for fleet management.
type Service struct {
	repo     *Repository
	pool     *pgxpool.Pool
	kafka    *internalKafka.Producer
	logger   *zap.Logger
}

// NewService constructs a new fleet Service.
func NewService(repo *Repository, pool *pgxpool.Pool, kafka *internalKafka.Producer, logger *zap.Logger) *Service {
	return &Service{
		repo:   repo,
		pool:   pool,
		kafka:  kafka,
		logger: logger,
	}
}

// ---------------------------------------------------------------------------
// Vehicle lifecycle
// ---------------------------------------------------------------------------

// RegisterVehicle validates input, creates the vehicle, and publishes a Kafka event.
func (s *Service) RegisterVehicle(ctx context.Context, input RegisterVehicleInput) (*Vehicle, error) {
	if !ValidFuelTypes[input.FuelType] {
		return nil, fmt.Errorf("invalid fuel_type: %s", input.FuelType)
	}

	campusID, err := uuid.Parse(input.CampusID)
	if err != nil {
		return nil, fmt.Errorf("invalid campus_id: %w", err)
	}

	now := time.Now()
	vehicle := &Vehicle{
		ID:                 uuid.New(),
		RegistrationNumber: input.RegistrationNumber,
		VehicleType:        input.VehicleType,
		Make:               input.Make,
		Model:              input.Model,
		Color:              input.Color,
		Year:               input.Year,
		CampusID:           campusID,
		Status:             VehicleStatusIdle,
		MileageKm:          input.MileageKm,
		FuelType:           input.FuelType,
		SeatingCapacity:    input.SeatingCapacity,
		InsuranceExpiry:    input.InsuranceExpiry,
		PermitExpiry:       input.PermitExpiry,
		VINNumber:          input.VINNumber,
		QRCode:             input.QRCode,
		Features:           input.Features,
		CreatedAt:          now,
		UpdatedAt:          now,
	}

	created, err := s.repo.CreateVehicle(ctx, vehicle)
	if err != nil {
		s.logger.Error("failed to create vehicle", zap.Error(err))
		return nil, fmt.Errorf("register vehicle: %w", err)
	}

	s.publishEvent(ctx, "fleet.vehicle.registered", map[string]interface{}{
		"vehicle_id":          created.ID.String(),
		"registration_number": created.RegistrationNumber,
		"campus_id":           created.CampusID.String(),
		"vehicle_type":        created.VehicleType,
	})

	s.logger.Info("vehicle registered",
		zap.String("vehicle_id", created.ID.String()),
		zap.String("registration", created.RegistrationNumber),
	)

	return created, nil
}

// UpdateVehicle applies a partial update and publishes a Kafka event.
func (s *Service) UpdateVehicle(ctx context.Context, vehicleID uuid.UUID, input UpdateVehicleInput) (*Vehicle, error) {
	if input.Status != nil && !ValidVehicleStatuses[*input.Status] {
		return nil, fmt.Errorf("invalid status: %s", *input.Status)
	}
	if input.FuelType != nil && !ValidFuelTypes[*input.FuelType] {
		return nil, fmt.Errorf("invalid fuel_type: %s", *input.FuelType)
	}

	updated, err := s.repo.UpdateVehicle(ctx, vehicleID, input)
	if err != nil {
		s.logger.Error("failed to update vehicle", zap.String("vehicle_id", vehicleID.String()), zap.Error(err))
		return nil, fmt.Errorf("update vehicle: %w", err)
	}

	s.publishEvent(ctx, "fleet.vehicle.updated", map[string]interface{}{
		"vehicle_id": updated.ID.String(),
		"status":     updated.Status,
	})

	return updated, nil
}

// RetireVehicle marks a vehicle as retired and publishes a Kafka event.
func (s *Service) RetireVehicle(ctx context.Context, vehicleID uuid.UUID) error {
	if err := s.repo.RetireVehicle(ctx, vehicleID); err != nil {
		s.logger.Error("failed to retire vehicle", zap.String("vehicle_id", vehicleID.String()), zap.Error(err))
		return fmt.Errorf("retire vehicle: %w", err)
	}

	s.publishEvent(ctx, "fleet.vehicle.retired", map[string]interface{}{
		"vehicle_id": vehicleID.String(),
	})

	s.logger.Info("vehicle retired", zap.String("vehicle_id", vehicleID.String()))
	return nil
}

// GetVehicle retrieves a vehicle by ID.
func (s *Service) GetVehicle(ctx context.Context, vehicleID uuid.UUID) (*Vehicle, error) {
	v, err := s.repo.GetVehicleByID(ctx, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("get vehicle: %w", err)
	}
	return v, nil
}

// ListVehicles returns a filtered, paginated list of vehicles.
func (s *Service) ListVehicles(ctx context.Context, filters VehicleListFilters) ([]Vehicle, error) {
	vehicles, err := s.repo.ListVehicles(ctx, filters)
	if err != nil {
		return nil, fmt.Errorf("list vehicles: %w", err)
	}
	return vehicles, nil
}

// ---------------------------------------------------------------------------
// Driver assignment
// ---------------------------------------------------------------------------

// AssignDriverToVehicle assigns a driver to a vehicle.
func (s *Service) AssignDriverToVehicle(ctx context.Context, vehicleID, driverID uuid.UUID) error {
	if err := s.repo.AssignDriver(ctx, vehicleID, driverID); err != nil {
		s.logger.Error("failed to assign driver",
			zap.String("vehicle_id", vehicleID.String()),
			zap.String("driver_id", driverID.String()),
			zap.Error(err),
		)
		return fmt.Errorf("assign driver: %w", err)
	}

	s.publishEvent(ctx, "fleet.driver.assigned", map[string]interface{}{
		"vehicle_id": vehicleID.String(),
		"driver_id":  driverID.String(),
	})

	return nil
}

// UnassignDriverFromVehicle removes the driver assignment.
func (s *Service) UnassignDriverFromVehicle(ctx context.Context, vehicleID uuid.UUID) error {
	if err := s.repo.UnassignDriver(ctx, vehicleID); err != nil {
		s.logger.Error("failed to unassign driver", zap.String("vehicle_id", vehicleID.String()), zap.Error(err))
		return fmt.Errorf("unassign driver: %w", err)
	}

	s.publishEvent(ctx, "fleet.driver.unassigned", map[string]interface{}{
		"vehicle_id": vehicleID.String(),
	})

	return nil
}

// ---------------------------------------------------------------------------
// Service logging
// ---------------------------------------------------------------------------

// LogService creates a service log and updates the vehicle's service dates.
func (s *Service) LogService(ctx context.Context, vehicleID uuid.UUID, input CreateServiceLogInput) (*VehicleServiceLog, error) {
	// Verify the vehicle exists.
	_, err := s.repo.GetVehicleByID(ctx, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("log service: vehicle lookup: %w", err)
	}

	now := time.Now()
	serviceLog := &VehicleServiceLog{
		ID:               uuid.New(),
		VehicleID:        vehicleID,
		ServiceType:      input.ServiceType,
		Description:      input.Description,
		PartsReplaced:    input.PartsReplaced,
		MileageAtService: input.MileageAtService,
		Cost:             input.Cost,
		PerformedBy:      input.PerformedBy,
		WorkshopName:     input.WorkshopName,
		InvoiceURL:       input.InvoiceURL,
		StartedAt:        input.StartedAt,
		CompletedAt:      input.CompletedAt,
		NextServiceDue:   input.NextServiceDue,
		Notes:            input.Notes,
		CreatedAt:        now,
	}

	created, err := s.repo.CreateServiceLog(ctx, serviceLog)
	if err != nil {
		s.logger.Error("failed to create service log", zap.String("vehicle_id", vehicleID.String()), zap.Error(err))
		return nil, fmt.Errorf("log service: %w", err)
	}

	// Update the vehicle's service tracking dates.
	serviceDate := input.StartedAt
	if input.CompletedAt != nil {
		serviceDate = *input.CompletedAt
	}
	if err := s.repo.UpdateVehicleServiceDates(ctx, vehicleID, serviceDate, input.NextServiceDue); err != nil {
		s.logger.Error("failed to update vehicle service dates",
			zap.String("vehicle_id", vehicleID.String()),
			zap.Error(err),
		)
	}

	s.publishEvent(ctx, "fleet.vehicle.serviced", map[string]interface{}{
		"vehicle_id":   vehicleID.String(),
		"service_type": created.ServiceType,
		"cost":         created.Cost,
	})

	return created, nil
}

// GetServiceLogs retrieves paginated service logs for a vehicle.
func (s *Service) GetServiceLogs(ctx context.Context, vehicleID uuid.UUID, limit int, cursor *uuid.UUID) ([]VehicleServiceLog, error) {
	logs, err := s.repo.GetServiceLogs(ctx, vehicleID, limit, cursor)
	if err != nil {
		return nil, fmt.Errorf("get service logs: %w", err)
	}
	return logs, nil
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

// RecordTelemetry stores a telemetry data point and checks alert thresholds.
func (s *Service) RecordTelemetry(ctx context.Context, vehicleID uuid.UUID, input RecordTelemetryInput) (*VehicleTelemetry, error) {
	recordedAt := time.Now()
	if input.RecordedAt != nil {
		recordedAt = *input.RecordedAt
	}

	telemetry := &VehicleTelemetry{
		ID:           uuid.New(),
		VehicleID:    vehicleID,
		BatteryPct:   input.BatteryPct,
		FuelPct:      input.FuelPct,
		SpeedKmh:     input.SpeedKmh,
		EngineTempC:  input.EngineTempC,
		TirePressure: input.TirePressure,
		OdometerKm:   input.OdometerKm,
		Lat:          input.Lat,
		Lng:          input.Lng,
		Heading:      input.Heading,
		AltitudeM:    input.AltitudeM,
		Diagnostics:  input.Diagnostics,
		RecordedAt:   recordedAt,
	}

	created, err := s.repo.RecordTelemetry(ctx, telemetry)
	if err != nil {
		s.logger.Error("failed to record telemetry", zap.String("vehicle_id", vehicleID.String()), zap.Error(err))
		return nil, fmt.Errorf("record telemetry: %w", err)
	}

	// Update the vehicle's location if coordinates are provided.
	if input.Lat != nil && input.Lng != nil {
		_, _ = s.repo.UpdateVehicle(ctx, vehicleID, UpdateVehicleInput{
			Lat: input.Lat,
			Lng: input.Lng,
		})
	}

	// Check thresholds and fire alerts.
	s.checkTelemetryThresholds(ctx, vehicleID, created)

	return created, nil
}

// GetLatestTelemetry retrieves the latest telemetry for a vehicle.
func (s *Service) GetLatestTelemetry(ctx context.Context, vehicleID uuid.UUID) (*VehicleTelemetry, error) {
	t, err := s.repo.GetLatestTelemetry(ctx, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("get latest telemetry: %w", err)
	}
	return t, nil
}

// GetTelemetryHistory retrieves telemetry records in a time range (deprecated: scans table).
func (s *Service) GetTelemetryHistory(ctx context.Context, vehicleID uuid.UUID, from, to time.Time, limit int) ([]VehicleTelemetry, error) {
	records, err := s.repo.GetTelemetryHistory(ctx, vehicleID, from, to, limit)
	if err != nil {
		return nil, fmt.Errorf("get telemetry history: %w", err)
	}
	return records, nil
}

// checkTelemetryThresholds evaluates a telemetry reading for anomalies and publishes alerts.
func (s *Service) checkTelemetryThresholds(ctx context.Context, vehicleID uuid.UUID, t *VehicleTelemetry) {
	if t.EngineTempC != nil && *t.EngineTempC > thresholdEngineTempHigh {
		s.publishEvent(ctx, "fleet.alert.engine_overheat", map[string]interface{}{
			"vehicle_id":    vehicleID.String(),
			"engine_temp_c": *t.EngineTempC,
			"severity":      "critical",
		})
		s.logger.Warn("engine overheat alert",
			zap.String("vehicle_id", vehicleID.String()),
			zap.Float64("engine_temp_c", *t.EngineTempC),
		)
	}

	if t.FuelPct != nil && *t.FuelPct < thresholdFuelLow {
		s.publishEvent(ctx, "fleet.alert.fuel_low", map[string]interface{}{
			"vehicle_id": vehicleID.String(),
			"fuel_pct":   *t.FuelPct,
			"severity":   "warning",
		})
	}

	if t.BatteryPct != nil && *t.BatteryPct < thresholdBatteryLow {
		s.publishEvent(ctx, "fleet.alert.battery_low", map[string]interface{}{
			"vehicle_id":  vehicleID.String(),
			"battery_pct": *t.BatteryPct,
			"severity":    "warning",
		})
	}

	if t.SpeedKmh != nil && *t.SpeedKmh > thresholdSpeedMax {
		s.publishEvent(ctx, "fleet.alert.overspeed", map[string]interface{}{
			"vehicle_id": vehicleID.String(),
			"speed_kmh":  *t.SpeedKmh,
			"severity":   "critical",
		})
	}
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

// RunDiagnostics aggregates the last 24h of telemetry into a diagnostic report.
func (s *Service) RunDiagnostics(ctx context.Context, vehicleID uuid.UUID) (*DiagnosticReport, error) {
	now := time.Now()
	from := now.Add(-time.Duration(diagnosticWindowHours) * time.Hour)

	records, err := s.repo.GetTelemetryHistory(ctx, vehicleID, from, now, 500)
	if err != nil {
		return nil, fmt.Errorf("run diagnostics: %w", err)
	}

	report := &DiagnosticReport{
		VehicleID:         vehicleID,
		ReportGeneratedAt: now,
		SampleCount:       len(records),
		HealthScore:       100,
		Anomalies:         make([]string, 0),
		Recommendations:   make([]string, 0),
		RawDiagnostics:    make(map[string]interface{}),
	}

	if len(records) == 0 {
		report.HealthScore = 0
		report.Anomalies = append(report.Anomalies, "no telemetry data in the last 24 hours")
		report.Recommendations = append(report.Recommendations, "verify vehicle telemetry unit is operational")
		return report, nil
	}

	var (
		speedSum, speedMax             float64
		speedCount                     int
		tempSum, tempMax               float64
		tempCount                      int
		fuelSum                        float64
		fuelMin                        int = math.MaxInt32
		fuelCount                      int
		batterySum                     float64
		batteryMin                     int = math.MaxInt32
		batteryCount                   int
		firstOdometer, lastOdometer    *float64
	)

	for i, r := range records {
		if r.SpeedKmh != nil {
			speedSum += *r.SpeedKmh
			speedCount++
			if *r.SpeedKmh > speedMax {
				speedMax = *r.SpeedKmh
			}
		}
		if r.EngineTempC != nil {
			tempSum += *r.EngineTempC
			tempCount++
			if *r.EngineTempC > tempMax {
				tempMax = *r.EngineTempC
			}
		}
		if r.FuelPct != nil {
			fuelSum += float64(*r.FuelPct)
			fuelCount++
			if *r.FuelPct < fuelMin {
				fuelMin = *r.FuelPct
			}
		}
		if r.BatteryPct != nil {
			batterySum += float64(*r.BatteryPct)
			batteryCount++
			if *r.BatteryPct < batteryMin {
				batteryMin = *r.BatteryPct
			}
		}
		if r.OdometerKm != nil {
			if i == 0 {
				lastOdometer = r.OdometerKm
			}
			firstOdometer = r.OdometerKm
		}
	}

	if speedCount > 0 {
		avg := speedSum / float64(speedCount)
		report.AvgSpeedKmh = &avg
		report.MaxSpeedKmh = &speedMax
		if speedMax > thresholdSpeedMax {
			report.Anomalies = append(report.Anomalies, fmt.Sprintf("overspeed detected: %.1f km/h", speedMax))
			report.HealthScore -= 10
		}
	}

	if tempCount > 0 {
		avg := tempSum / float64(tempCount)
		report.AvgEngineTempC = &avg
		report.MaxEngineTempC = &tempMax
		if tempMax > thresholdEngineTempHigh {
			report.Anomalies = append(report.Anomalies, fmt.Sprintf("engine overheating detected: %.1f°C", tempMax))
			report.Recommendations = append(report.Recommendations, "inspect cooling system immediately")
			report.HealthScore -= 25
		}
	}

	if fuelCount > 0 {
		avg := fuelSum / float64(fuelCount)
		report.AvgFuelPct = &avg
		if fuelMin < math.MaxInt32 {
			report.MinFuelPct = &fuelMin
		}
		if fuelMin < thresholdFuelLow {
			report.Anomalies = append(report.Anomalies, "critically low fuel level detected")
			report.HealthScore -= 5
		}
	}

	if batteryCount > 0 {
		avg := batterySum / float64(batteryCount)
		report.AvgBatteryPct = &avg
		if batteryMin < math.MaxInt32 {
			report.MinBatteryPct = &batteryMin
		}
		if batteryMin < thresholdBatteryLow {
			report.Anomalies = append(report.Anomalies, "low battery level detected")
			report.Recommendations = append(report.Recommendations, "check battery health and charging system")
			report.HealthScore -= 10
		}
	}

	if firstOdometer != nil && lastOdometer != nil {
		dist := math.Abs(*lastOdometer - *firstOdometer)
		report.TotalDistanceKm = &dist
	}

	if report.HealthScore < 0 {
		report.HealthScore = 0
	}

	return report, nil
}

// ---------------------------------------------------------------------------
// Skins
// ---------------------------------------------------------------------------

// CreateSkin creates a new vehicle skin.
func (s *Service) CreateSkin(ctx context.Context, input CreateSkinInput) (*VehicleSkin, error) {
	skin := &VehicleSkin{
		ID:          uuid.New(),
		Name:        input.Name,
		Description: input.Description,
		ImageURL:    input.ImageURL,
		WrapType:    input.WrapType,
		IsActive:    true,
		CreatedAt:   time.Now(),
	}

	if input.CampusID != nil {
		parsed, err := uuid.Parse(*input.CampusID)
		if err != nil {
			return nil, fmt.Errorf("create skin: invalid campus_id: %w", err)
		}
		skin.CampusID = &parsed
	}

	created, err := s.repo.CreateSkin(ctx, skin)
	if err != nil {
		s.logger.Error("failed to create skin", zap.Error(err))
		return nil, fmt.Errorf("create skin: %w", err)
	}
	return created, nil
}

// ListSkins returns skins filtered by optional campus.
func (s *Service) ListSkins(ctx context.Context, campusID *uuid.UUID) ([]VehicleSkin, error) {
	skins, err := s.repo.ListSkins(ctx, campusID)
	if err != nil {
		return nil, fmt.Errorf("list skins: %w", err)
	}
	return skins, nil
}

// ApplySkinToVehicle sets a skin on a vehicle.
func (s *Service) ApplySkinToVehicle(ctx context.Context, vehicleID, skinID uuid.UUID) error {
	// Verify the skin exists.
	skin, err := s.repo.ListSkins(ctx, nil)
	if err != nil {
		return fmt.Errorf("apply skin: %w", err)
	}
	found := false
	for _, sk := range skin {
		if sk.ID == skinID {
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("apply skin: skin not found")
	}

	if err := s.repo.ApplySkin(ctx, vehicleID, skinID); err != nil {
		s.logger.Error("failed to apply skin",
			zap.String("vehicle_id", vehicleID.String()),
			zap.String("skin_id", skinID.String()),
			zap.Error(err),
		)
		return fmt.Errorf("apply skin: %w", err)
	}

	s.publishEvent(ctx, "fleet.vehicle.skin_applied", map[string]interface{}{
		"vehicle_id": vehicleID.String(),
		"skin_id":    skinID.String(),
	})

	return nil
}

// ---------------------------------------------------------------------------
// Deployment zones
// ---------------------------------------------------------------------------

// CreateZone creates a new deployment zone.
func (s *Service) CreateZone(ctx context.Context, input CreateZoneInput) (*DeploymentZone, error) {
	campusID, err := uuid.Parse(input.CampusID)
	if err != nil {
		return nil, fmt.Errorf("create zone: invalid campus_id: %w", err)
	}

	if input.MaxVehicles < input.TargetVehicles {
		return nil, fmt.Errorf("create zone: max_vehicles must be >= target_vehicles")
	}

	now := time.Now()
	zone := &DeploymentZone{
		ID:             uuid.New(),
		CampusID:       campusID,
		Name:           input.Name,
		Description:    input.Description,
		Priority:       input.Priority,
		TargetVehicles: input.TargetVehicles,
		MaxVehicles:    input.MaxVehicles,
		IsActive:       true,
		OperatingHours: input.OperatingHours,
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	created, err := s.repo.CreateZone(ctx, zone)
	if err != nil {
		s.logger.Error("failed to create zone", zap.Error(err))
		return nil, fmt.Errorf("create zone: %w", err)
	}
	return created, nil
}

// ListZones returns active zones for a campus.
func (s *Service) ListZones(ctx context.Context, campusID uuid.UUID) ([]DeploymentZone, error) {
	zones, err := s.repo.ListZones(ctx, campusID)
	if err != nil {
		return nil, fmt.Errorf("list zones: %w", err)
	}
	return zones, nil
}

// GetZone retrieves a single zone.
func (s *Service) GetZone(ctx context.Context, zoneID uuid.UUID) (*DeploymentZone, error) {
	zone, err := s.repo.GetZoneByID(ctx, zoneID)
	if err != nil {
		return nil, fmt.Errorf("get zone: %w", err)
	}
	return zone, nil
}

// ---------------------------------------------------------------------------
// Fleet overview
// ---------------------------------------------------------------------------

// GetFleetOverview combines stats, alerts, and zone deployment summaries.
func (s *Service) GetFleetOverview(ctx context.Context, campusID uuid.UUID) (*FleetOverview, error) {
	overview, err := s.repo.GetFleetStats(ctx, campusID)
	if err != nil {
		return nil, fmt.Errorf("fleet overview: %w", err)
	}

	// Build alerts from vehicles needing service.
	alerts := make([]FleetAlert, 0)
	serviceDue, err := s.repo.GetVehiclesNeedingService(ctx, campusID, serviceDueAlertWindow)
	if err != nil {
		s.logger.Warn("failed to fetch service-due vehicles for alerts", zap.Error(err))
	} else {
		for _, v := range serviceDue {
			alerts = append(alerts, FleetAlert{
				Severity:  "warning",
				VehicleID: v.ID,
				Message:   fmt.Sprintf("vehicle %s is due for service", v.RegistrationNumber),
				CreatedAt: time.Now(),
			})
		}
	}
	overview.Alerts = alerts

	// Build zone deployment summaries.
	zones, err := s.repo.ListZones(ctx, campusID)
	if err != nil {
		s.logger.Warn("failed to fetch zones for overview", zap.Error(err))
	} else {
		summaries := make([]ZoneSummary, 0, len(zones))
		for _, z := range zones {
			vehicles, err := s.repo.GetVehiclesInZone(ctx, z.ID)
			currentCount := 0
			if err != nil {
				s.logger.Warn("failed to count vehicles in zone",
					zap.String("zone_id", z.ID.String()),
					zap.Error(err),
				)
			} else {
				currentCount = len(vehicles)
			}

			deficit := z.TargetVehicles - currentCount
			if deficit < 0 {
				deficit = 0
			}

			summaries = append(summaries, ZoneSummary{
				ZoneID:         z.ID,
				ZoneName:       z.Name,
				TargetVehicles: z.TargetVehicles,
				CurrentCount:   currentCount,
				Deficit:        deficit,
			})
		}
		overview.ZoneSummaries = summaries
	}

	return overview, nil
}

// ---------------------------------------------------------------------------
// Weather impact
// ---------------------------------------------------------------------------

// GetWeatherImpact fetches weather data from an external API and returns an impact assessment.
// The weather API URL is configured via the WEATHER_API_URL environment variable.
func (s *Service) GetWeatherImpact(ctx context.Context, campusID uuid.UUID, lat, lng float64) (*WeatherImpact, error) {
	apiURL := os.Getenv("WEATHER_API_URL")
	if apiURL == "" {
		return &WeatherImpact{
			CampusID:        campusID,
			Condition:       "unknown",
			Temperature:     0,
			Visibility:      "unknown",
			RoadCondition:   "unknown",
			ImpactLevel:     "none",
			Recommendations: []string{"weather API not configured"},
			FetchedAt:       time.Now(),
		}, nil
	}

	reqURL := fmt.Sprintf("%s?lat=%.6f&lon=%.6f", apiURL, lat, lng)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("weather impact: build request: %w", err)
	}

	apiKey := os.Getenv("WEATHER_API_KEY")
	if apiKey != "" {
		req.Header.Set("X-API-Key", apiKey)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		s.logger.Warn("weather API call failed", zap.Error(err))
		return &WeatherImpact{
			CampusID:        campusID,
			Condition:       "unavailable",
			ImpactLevel:     "unknown",
			Recommendations: []string{"weather data temporarily unavailable"},
			FetchedAt:       time.Now(),
		}, nil
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("weather impact: read response: %w", err)
	}

	var weatherData struct {
		Condition   string  `json:"condition"`
		Temperature float64 `json:"temperature"`
		Visibility  string  `json:"visibility"`
		WindSpeed   float64 `json:"wind_speed"`
		Humidity    float64 `json:"humidity"`
	}
	if err := json.Unmarshal(body, &weatherData); err != nil {
		return nil, fmt.Errorf("weather impact: parse response: %w", err)
	}

	impact := &WeatherImpact{
		CampusID:        campusID,
		Condition:       weatherData.Condition,
		Temperature:     weatherData.Temperature,
		Visibility:      weatherData.Visibility,
		FetchedAt:       time.Now(),
		Recommendations: make([]string, 0),
	}

	// Assess impact level based on conditions.
	switch {
	case weatherData.Condition == "thunderstorm" || weatherData.Condition == "heavy_rain":
		impact.ImpactLevel = "high"
		impact.RoadCondition = "hazardous"
		impact.Recommendations = append(impact.Recommendations,
			"reduce fleet deployment",
			"alert drivers about road conditions",
			"consider suspending non-essential routes",
		)
	case weatherData.Condition == "rain" || weatherData.Condition == "fog":
		impact.ImpactLevel = "moderate"
		impact.RoadCondition = "slippery"
		impact.Recommendations = append(impact.Recommendations,
			"advise drivers to reduce speed",
			"ensure headlights are operational",
		)
	case weatherData.Temperature > 45:
		impact.ImpactLevel = "moderate"
		impact.RoadCondition = "normal"
		impact.Recommendations = append(impact.Recommendations,
			"monitor engine temperatures closely",
			"ensure AC systems are operational",
		)
	default:
		impact.ImpactLevel = "low"
		impact.RoadCondition = "normal"
	}

	return impact, nil
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

func (s *Service) publishEvent(ctx context.Context, eventType string, payload map[string]interface{}) {
	event := internalKafka.Event{
		Type:    eventType,
		Payload: payload,
	}
	if err := s.kafka.Publish(ctx, eventType, "", event); err != nil {
		s.logger.Error("failed to publish kafka event",
			zap.String("event_type", eventType),
			zap.Error(err),
		)
	}
}
