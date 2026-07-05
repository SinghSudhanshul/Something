package fleet

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Errors.
var (
	ErrVehicleNotFound    = errors.New("vehicle not found")
	ErrVehicleRetired     = errors.New("vehicle retired")
	ErrInvalidStatus      = errors.New("invalid status transition")
)

// Repository owns all ride_vehicles SQL.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a repo.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

// CreateVehicle inserts a new vehicle.
func (r *Repository) CreateVehicle(ctx context.Context, v *Vehicle) (*Vehicle, error) {
	featuresJSON, err := json.Marshal(v.Features)
	if err != nil {
		return nil, err
	}
	if v.Status == "" {
		v.Status = VehicleStatusActive
	}
	var created Vehicle
	err = r.pool.QueryRow(ctx, `
		INSERT INTO ride_vehicles (
			id, campus_id, driver_id, registration_number, vehicle_type,
			make, model, color, year, fuel_type, seating_capacity,
			insurance_expiry, fitness_expiry, permit_expiry,
			last_service_at, next_service_due, mileage_km,
			lat, lng, vin_number, qr_code, features, status
		) VALUES (
			$1, $2, $3, $4, $5::ride_vehicle_type, $6, $7, $8, $9, $10::ride_fuel_type,
			$11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22::jsonb, $23::ride_vehicle_status
		)
		RETURNING id, campus_id, driver_id, registration_number, vehicle_type,
		          make, model, color, year, fuel_type, seating_capacity,
		          insurance_expiry, fitness_expiry, permit_expiry,
		          last_service_at, next_service_due, mileage_km,
		          lat, lng, vin_number, qr_code, features, status, created_at, updated_at`,
		v.ID, v.CampusID, v.AssignedDriverID, v.RegistrationNumber, v.VehicleType,
		v.Make, v.Model, v.Color, v.Year, v.FuelType, v.SeatingCapacity,
		v.InsuranceExpiry, v.PermitExpiry, v.PermitExpiry,
		v.LastServiceAt, v.NextServiceDue, v.MileageKm,
		v.Lat, v.Lng, v.VINNumber, v.QRCode, featuresJSON, v.Status,
	).Scan(
		&created.ID, &created.CampusID, &created.AssignedDriverID,
		&created.RegistrationNumber, &created.VehicleType, &created.Make, &created.Model,
		&created.Color, &created.Year, &created.FuelType, &created.SeatingCapacity,
		&created.InsuranceExpiry, &created.PermitExpiry, &created.PermitExpiry,
		&created.LastServiceAt, &created.NextServiceDue, &created.MileageKm,
		&created.Lat, &created.Lng, &created.VINNumber, &created.QRCode, &created.Features,
		&created.Status, &created.CreatedAt, &created.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &created, nil
}

// GetVehicleByID loads a vehicle.
func (r *Repository) GetVehicleByID(ctx context.Context, id uuid.UUID) (*Vehicle, error) {
	var v Vehicle
	err := r.pool.QueryRow(ctx, `
		SELECT id, campus_id, driver_id, registration_number, vehicle_type,
		       make, model, color, year, fuel_type, seating_capacity,
		       insurance_expiry, fitness_expiry, permit_expiry,
		       last_service_at, next_service_due, mileage_km,
		       lat, lng, vin_number, qr_code, features, status, created_at, updated_at
		FROM ride_vehicles WHERE id = $1`, id).Scan(
		&v.ID, &v.CampusID, &v.AssignedDriverID, &v.RegistrationNumber,
		&v.VehicleType, &v.Make, &v.Model, &v.Color, &v.Year, &v.FuelType,
		&v.SeatingCapacity, &v.InsuranceExpiry, &v.PermitExpiry, &v.PermitExpiry,
		&v.LastServiceAt, &v.NextServiceDue, &v.MileageKm,
		&v.Lat, &v.Lng, &v.VINNumber, &v.QRCode, &v.Features, &v.Status,
		&v.CreatedAt, &v.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrVehicleNotFound
		}
		return nil, err
	}
	return &v, nil
}

// ListVehicles returns a paginated, filterable list.
func (r *Repository) ListVehicles(ctx context.Context, f VehicleListFilters) ([]Vehicle, error) {
	clauses := []string{"status != 'retired'"}
	args := []any{}
	idx := 1
	if f.CampusID != nil {
		clauses = append(clauses, fmt.Sprintf("campus_id = $%d", idx))
		args = append(args, *f.CampusID)
		idx++
	}
	if f.Status != nil {
		clauses = append(clauses, fmt.Sprintf("status = $%d", idx))
		args = append(args, *f.Status)
		idx++
	}
	if f.VehicleType != nil {
		clauses = append(clauses, fmt.Sprintf("vehicle_type = $%d", idx))
		args = append(args, *f.VehicleType)
		idx++
	}
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	args = append(args, limit)
	q := fmt.Sprintf(`
		SELECT id, campus_id, driver_id, registration_number, vehicle_type,
		       make, model, color, year, fuel_type, seating_capacity,
		       insurance_expiry, fitness_expiry, permit_expiry,
		       last_service_at, next_service_due, mileage_km,
		       lat, lng, vin_number, qr_code, features, status, created_at, updated_at
		FROM ride_vehicles
		WHERE %s
		ORDER BY registration_number ASC
		LIMIT $%d`, joinAnd(clauses), idx)
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Vehicle{}
	for rows.Next() {
		var v Vehicle
		if err := rows.Scan(
			&v.ID, &v.CampusID, &v.AssignedDriverID, &v.RegistrationNumber,
			&v.VehicleType, &v.Make, &v.Model, &v.Color, &v.Year, &v.FuelType,
			&v.SeatingCapacity, &v.InsuranceExpiry, &v.PermitExpiry, &v.PermitExpiry,
			&v.LastServiceAt, &v.NextServiceDue, &v.MileageKm,
			&v.Lat, &v.Lng, &v.VINNumber, &v.QRCode, &v.Features, &v.Status,
			&v.CreatedAt, &v.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// UpdateVehicle applies a partial update.
func (r *Repository) UpdateVehicle(ctx context.Context, id uuid.UUID, input UpdateVehicleInput) (*Vehicle, error) {
	sets := []string{}
	args := []any{}
	idx := 1
	if input.RegistrationNumber != nil {
		sets = append(sets, fmt.Sprintf("registration_number = $%d", idx))
		args = append(args, *input.RegistrationNumber)
		idx++
	}
	if input.VehicleType != nil {
		sets = append(sets, fmt.Sprintf("vehicle_type = $%d", idx))
		args = append(args, *input.VehicleType)
		idx++
	}
	if input.Make != nil {
		sets = append(sets, fmt.Sprintf("make = $%d", idx))
		args = append(args, *input.Make)
		idx++
	}
	if input.Model != nil {
		sets = append(sets, fmt.Sprintf("model = $%d", idx))
		args = append(args, *input.Model)
		idx++
	}
	if input.Color != nil {
		sets = append(sets, fmt.Sprintf("color = $%d", idx))
		args = append(args, *input.Color)
		idx++
	}
	if input.Year != nil {
		sets = append(sets, fmt.Sprintf("year = $%d", idx))
		args = append(args, *input.Year)
		idx++
	}
	if input.FuelType != nil {
		sets = append(sets, fmt.Sprintf("fuel_type = $%d", idx))
		args = append(args, *input.FuelType)
		idx++
	}
	if input.SeatingCapacity != nil {
		sets = append(sets, fmt.Sprintf("seating_capacity = $%d", idx))
		args = append(args, *input.SeatingCapacity)
		idx++
	}
	if input.InsuranceExpiry != nil {
		sets = append(sets, fmt.Sprintf("insurance_expiry = $%d", idx))
		args = append(args, *input.InsuranceExpiry)
		idx++
	}
	if input.PermitExpiry != nil {
		sets = append(sets, fmt.Sprintf("permit_expiry = $%d", idx))
		args = append(args, *input.PermitExpiry)
		idx++
	}
	if input.VINNumber != nil {
		sets = append(sets, fmt.Sprintf("vin_number = $%d", idx))
		args = append(args, *input.VINNumber)
		idx++
	}
	if input.QRCode != nil {
		sets = append(sets, fmt.Sprintf("qr_code = $%d", idx))
		args = append(args, *input.QRCode)
		idx++
	}
	if input.MileageKm != nil {
		sets = append(sets, fmt.Sprintf("mileage_km = $%d", idx))
		args = append(args, *input.MileageKm)
		idx++
	}
	if input.Status != nil {
		sets = append(sets, fmt.Sprintf("status = $%d", idx))
		args = append(args, *input.Status)
		idx++
	}
	if input.Lat != nil {
		sets = append(sets, fmt.Sprintf("lat = $%d", idx))
		args = append(args, *input.Lat)
		idx++
	}
	if input.Lng != nil {
		sets = append(sets, fmt.Sprintf("lng = $%d", idx))
		args = append(args, *input.Lng)
		idx++
	}
	if input.Features != nil {
		featJSON, _ := json.Marshal(input.Features)
		sets = append(sets, fmt.Sprintf("features = $%d::jsonb", idx))
		args = append(args, featJSON)
		idx++
	}
	if len(sets) == 0 {
		return r.GetVehicleByID(ctx, id)
	}
	sets = append(sets, "updated_at = NOW()")
	args = append(args, id)
	q := fmt.Sprintf(`UPDATE ride_vehicles SET %s WHERE id = $%d`, joinComma(sets), idx)
	if _, err := r.pool.Exec(ctx, q, args...); err != nil {
		return nil, err
	}
	return r.GetVehicleByID(ctx, id)
}

// RetireVehicle marks a vehicle as retired.
func (r *Repository) RetireVehicle(ctx context.Context, id uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `UPDATE ride_vehicles SET status = 'retired', driver_id = NULL, updated_at = NOW() WHERE id = $1 AND status != 'retired'`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrVehicleRetired
	}
	return nil
}

// AssignDriver sets the driver_id on a vehicle.
func (r *Repository) AssignDriver(ctx context.Context, vehicleID, driverID uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `UPDATE ride_vehicles SET driver_id = $2, updated_at = NOW() WHERE id = $1 AND status != 'retired'`, vehicleID, driverID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrVehicleRetired
	}
	return nil
}

// UnassignDriver clears driver_id.
func (r *Repository) UnassignDriver(ctx context.Context, vehicleID uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `UPDATE ride_vehicles SET driver_id = NULL, updated_at = NOW() WHERE id = $1`, vehicleID)
	return err
}

// CreateServiceLog inserts a maintenance log.
func (r *Repository) CreateServiceLog(ctx context.Context, log *VehicleServiceLog) (*VehicleServiceLog, error) {
	var created VehicleServiceLog
	err := r.pool.QueryRow(ctx, `
		INSERT INTO ride_maintenance_logs (
			id, vehicle_id, service_type, description, parts_replaced,
			mileage_at_service, cost, performed_by, workshop_name,
			invoice_url, started_at, completed_at, next_service_due, notes
		) VALUES ($1,$2,$3,$4,$5::text[],$6,$7,$8,$9,$10,$11,$12,$13,$14)
		RETURNING id, vehicle_id, service_type, description, parts_replaced,
		          mileage_at_service, cost, performed_by, workshop_name,
		          invoice_url, started_at, completed_at, next_service_due, notes, created_at`,
		log.ID, log.VehicleID, log.ServiceType, log.Description, log.PartsReplaced,
		log.MileageAtService, log.Cost, log.PerformedBy, log.WorkshopName,
		log.InvoiceURL, log.StartedAt, log.CompletedAt, log.NextServiceDue, log.Notes,
	).Scan(
		&created.ID, &created.VehicleID, &created.ServiceType, &created.Description,
		&created.PartsReplaced, &created.MileageAtService, &created.Cost,
		&created.PerformedBy, &created.WorkshopName, &created.InvoiceURL,
		&created.StartedAt, &created.CompletedAt, &created.NextServiceDue, &created.Notes, &created.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &created, nil
}

// GetServiceLogs returns maintenance logs.
func (r *Repository) GetServiceLogs(ctx context.Context, vehicleID uuid.UUID, limit int) ([]VehicleServiceLog, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	rows, err := r.pool.Query(ctx, `
		SELECT id, vehicle_id, service_type, description, parts_replaced,
		       mileage_at_service, cost, performed_by, workshop_name,
		       invoice_url, started_at, completed_at, next_service_due, notes, created_at
		FROM ride_maintenance_logs WHERE vehicle_id = $1
		ORDER BY started_at DESC LIMIT $2`, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []VehicleServiceLog{}
	for rows.Next() {
		var l VehicleServiceLog
		if err := rows.Scan(
			&l.ID, &l.VehicleID, &l.ServiceType, &l.Description,
			&l.PartsReplaced, &l.MileageAtService, &l.Cost,
			&l.PerformedBy, &l.WorkshopName, &l.InvoiceURL,
			&l.StartedAt, &l.CompletedAt, &l.NextServiceDue, &l.Notes, &l.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// RecordTelemetry inserts a vehicle scan (renamed from telemetry).
func (r *Repository) RecordTelemetry(ctx context.Context, t *VehicleTelemetry) (*VehicleTelemetry, error) {
	diagJSON, _ := json.Marshal(t.Diagnostics)
	if t.RecordedAt.IsZero() {
		t.RecordedAt = time.Now().UTC()
	}
	var created VehicleTelemetry
	err := r.pool.QueryRow(ctx, `
		INSERT INTO ride_vehicle_scans (
			id, vehicle_id, scanned_by, scan_type, lat, lng, odometer_km,
			battery_pct, fuel_pct, damage_notes, photos, scanned_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::text[],$12)
		RETURNING id, vehicle_id, scanned_by, scan_type, lat, lng, odometer_km,
		          battery_pct, fuel_pct, damage_notes, photos, scanned_at`,
		t.ID, t.VehicleID, nil, "general", t.Lat, t.Lng, t.OdometerKm,
		t.BatteryPct, t.FuelPct, nil, []string{}, t.RecordedAt,
	).Scan(
		&created.ID, &created.VehicleID, nil, "general", &created.Lat, &created.Lng,
		&created.OdometerKm, &created.BatteryPct, &created.FuelPct, nil, &created.RecordedAt,
	)
	if err != nil {
		return nil, err
	}
	created.Diagnostics = map[string]any{}
	if len(diagJSON) > 0 {
		_ = json.Unmarshal(diagJSON, &created.Diagnostics)
	}
	return &created, nil
}

// GetLatestTelemetry returns the most recent scan.
func (r *Repository) GetLatestTelemetry(ctx context.Context, vehicleID uuid.UUID) (*VehicleTelemetry, error) {
	var t VehicleTelemetry
	err := r.pool.QueryRow(ctx, `
		SELECT id, vehicle_id, odometer_km, battery_pct, fuel_pct, lat, lng, scanned_at
		FROM ride_vehicle_scans
		WHERE vehicle_id = $1
		ORDER BY scanned_at DESC LIMIT 1`, vehicleID).Scan(
		&t.ID, &t.VehicleID, &t.OdometerKm, &t.BatteryPct, &t.FuelPct,
		&t.Lat, &t.Lng, &t.RecordedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &t, nil
}

// GetTelemetryHistory returns scans within a time range.
func (r *Repository) GetTelemetryHistory(ctx context.Context, vehicleID uuid.UUID, from, to time.Time, limit int) ([]VehicleTelemetry, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := r.pool.Query(ctx, `
		SELECT id, vehicle_id, odometer_km, battery_pct, fuel_pct, lat, lng, scanned_at
		FROM ride_vehicle_scans
		WHERE vehicle_id = $1 AND scanned_at BETWEEN $2 AND $3
		ORDER BY scanned_at DESC LIMIT $4`, vehicleID, from, to, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []VehicleTelemetry{}
	for rows.Next() {
		var t VehicleTelemetry
		if err := rows.Scan(&t.ID, &t.VehicleID, &t.OdometerKm, &t.BatteryPct,
			&t.FuelPct, &t.Lat, &t.Lng, &t.RecordedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// GetVehiclesNeedingService returns vehicles whose next_service_due is within the threshold.
func (r *Repository) GetVehiclesNeedingService(ctx context.Context, campusID uuid.UUID, within time.Duration) ([]Vehicle, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, campus_id, driver_id, registration_number, vehicle_type,
		       make, model, color, year, fuel_type, seating_capacity,
		       insurance_expiry, fitness_expiry, permit_expiry,
		       last_service_at, next_service_due, mileage_km,
		       lat, lng, vin_number, qr_code, features, status, created_at, updated_at
		FROM ride_vehicles
		WHERE campus_id = $1 AND status != 'retired'
		  AND next_service_due IS NOT NULL
		  AND next_service_due <= NOW() + ($2::interval)
		ORDER BY next_service_due ASC`, campusID, fmt.Sprintf("%d seconds", int(within.Seconds())))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Vehicle{}
	for rows.Next() {
		var v Vehicle
		if err := rows.Scan(
			&v.ID, &v.CampusID, &v.AssignedDriverID, &v.RegistrationNumber,
			&v.VehicleType, &v.Make, &v.Model, &v.Color, &v.Year, &v.FuelType,
			&v.SeatingCapacity, &v.InsuranceExpiry, &v.PermitExpiry, &v.PermitExpiry,
			&v.LastServiceAt, &v.NextServiceDue, &v.MileageKm,
			&v.Lat, &v.Lng, &v.VINNumber, &v.QRCode, &v.Features, &v.Status,
			&v.CreatedAt, &v.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// GetVehiclesInZone uses PostGIS to count vehicles in a zone.
func (r *Repository) GetVehiclesInZone(ctx context.Context, zoneID uuid.UUID) ([]Vehicle, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT v.id, v.campus_id, v.driver_id, v.registration_number, v.vehicle_type,
		       v.make, v.model, v.color, v.year, v.fuel_type, v.seating_capacity,
		       v.insurance_expiry, v.fitness_expiry, v.permit_expiry,
		       v.last_service_at, v.next_service_due, v.mileage_km,
		       v.lat, v.lng, v.vin_number, v.qr_code, v.features, v.status, v.created_at, v.updated_at
		FROM ride_vehicles v
		JOIN ride_fleet_deployments dz ON dz.id = $1
		WHERE v.lat IS NOT NULL AND v.lng IS NOT NULL AND v.status != 'retired'
		  AND ST_Within(ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326)::geography,
		                dz.zone_geom::geography)`, zoneID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Vehicle{}
	for rows.Next() {
		var v Vehicle
		if err := rows.Scan(
			&v.ID, &v.CampusID, &v.AssignedDriverID, &v.RegistrationNumber,
			&v.VehicleType, &v.Make, &v.Model, &v.Color, &v.Year, &v.FuelType,
			&v.SeatingCapacity, &v.InsuranceExpiry, &v.PermitExpiry, &v.PermitExpiry,
			&v.LastServiceAt, &v.NextServiceDue, &v.MileageKm,
			&v.Lat, &v.Lng, &v.VINNumber, &v.QRCode, &v.Features, &v.Status,
			&v.CreatedAt, &v.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// UpdateVehicleServiceDates updates the maintenance timestamps.
func (r *Repository) UpdateVehicleServiceDates(ctx context.Context, vehicleID uuid.UUID, lastService time.Time, nextDue *time.Time) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE ride_vehicles SET last_service_at = $2, next_service_due = $3, updated_at = NOW()
		WHERE id = $1`, vehicleID, lastService, nextDue)
	return err
}

// ApplySkin sets a skin_id on a vehicle (stored as metadata; ride_vehicles has no skin_id in V2).
func (r *Repository) ApplySkin(ctx context.Context, vehicleID, skinID uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE ride_vehicles SET features = features || jsonb_build_object('skin_id', $2::text), updated_at = NOW()
		WHERE id = $1`, vehicleID, skinID.String())
	return err
}

// GetZoneByID returns a single deployment zone.
func (r *Repository) GetZoneByID(ctx context.Context, id uuid.UUID) (*DeploymentZone, error) {
	var z DeploymentZone
	err := r.pool.QueryRow(ctx, `
		SELECT id, campus_id, zone_name, priority, target_vehicles,
		       max_vehicles, is_active, operating_hours, created_at, updated_at
		FROM ride_fleet_deployments WHERE id = $1`, id).Scan(
		&z.ID, &z.CampusID, &z.Name, &z.Priority, &z.TargetVehicles,
		&z.MaxVehicles, &z.IsActive, &z.OperatingHours, &z.CreatedAt, &z.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &z, nil
}

// CreateSkin inserts a new skin.
func (r *Repository) CreateSkin(ctx context.Context, s *VehicleSkin) (*VehicleSkin, error) {
	var created VehicleSkin
	err := r.pool.QueryRow(ctx, `
		INSERT INTO ride_skins (
			id, name, description, image_url, wrap_type, campus_id, is_active
		) VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING id, name, description, image_url, wrap_type, campus_id, is_active, created_at`,
		s.ID, s.Name, s.Description, s.ImageURL, s.WrapType, s.CampusID, s.IsActive,
	).Scan(
		&created.ID, &created.Name, &created.Description, &created.ImageURL,
		&created.WrapType, &created.CampusID, &created.IsActive, &created.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &created, nil
}

// ListSkins returns skins.
func (r *Repository) ListSkins(ctx context.Context, campusID *uuid.UUID) ([]VehicleSkin, error) {
	q := `SELECT id, name, description, image_url, wrap_type, campus_id, is_active, created_at
	      FROM ride_skins WHERE is_active = true`
	args := []any{}
	if campusID != nil {
		q += ` AND (campus_id = $1 OR campus_id IS NULL)`
		args = append(args, *campusID)
	}
	q += ` ORDER BY name ASC`
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []VehicleSkin{}
	for rows.Next() {
		var s VehicleSkin
		if err := rows.Scan(&s.ID, &s.Name, &s.Description, &s.ImageURL,
			&s.WrapType, &s.CampusID, &s.IsActive, &s.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// CreateZone inserts a deployment zone.
func (r *Repository) CreateZone(ctx context.Context, z *DeploymentZone) (*DeploymentZone, error) {
	opsJSON, _ := json.Marshal(z.OperatingHours)
	var created DeploymentZone
	err := r.pool.QueryRow(ctx, `
		INSERT INTO ride_fleet_deployments (
			id, campus_id, zone_name, zone_geom, priority, target_vehicles,
			max_vehicles, is_active, operating_hours
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
		RETURNING id, campus_id, zone_name, priority, target_vehicles,
		          max_vehicles, is_active, operating_hours, created_at, updated_at`,
		z.ID, z.CampusID, z.Name, nil, z.Priority, z.TargetVehicles,
		z.MaxVehicles, z.IsActive, opsJSON,
	).Scan(
		&created.ID, &created.CampusID, &created.Name, &created.Priority,
		&created.TargetVehicles, &created.MaxVehicles, &created.IsActive,
		&created.OperatingHours, &created.CreatedAt, &created.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &created, nil
}

// ListZones returns active deployment zones.
func (r *Repository) ListZones(ctx context.Context, campusID uuid.UUID) ([]DeploymentZone, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, campus_id, zone_name, priority, target_vehicles,
		       max_vehicles, is_active, operating_hours, created_at, updated_at
		FROM ride_fleet_deployments
		WHERE campus_id = $1 AND is_active = true
		ORDER BY priority ASC, zone_name ASC`, campusID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DeploymentZone{}
	for rows.Next() {
		var z DeploymentZone
		if err := rows.Scan(&z.ID, &z.CampusID, &z.Name, &z.Priority,
			&z.TargetVehicles, &z.MaxVehicles, &z.IsActive,
			&z.OperatingHours, &z.CreatedAt, &z.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, z)
	}
	return out, rows.Err()
}

// GetFleetStats returns aggregates.
func (r *Repository) GetFleetStats(ctx context.Context, campusID uuid.UUID) (*FleetOverview, error) {
	overview := &FleetOverview{}
	err := r.pool.QueryRow(ctx, `
		SELECT
		    COUNT(*) FILTER (WHERE status = 'active'),
		    COUNT(*) FILTER (WHERE status = 'idle'),
		    COUNT(*) FILTER (WHERE status = 'maintenance'),
		    COUNT(*) FILTER (WHERE status = 'retired'),
		    COUNT(*),
		    COALESCE(AVG(mileage_km), 0)::float8,
		    COUNT(*) FILTER (WHERE next_service_due IS NOT NULL AND next_service_due <= NOW() + INTERVAL '7 days'),
		    COUNT(*) FILTER (WHERE insurance_expiry IS NOT NULL AND insurance_expiry <= NOW() + INTERVAL '30 days'),
		    COUNT(*) FILTER (WHERE permit_expiry IS NOT NULL AND permit_expiry <= NOW() + INTERVAL '30 days')
		FROM ride_vehicles WHERE campus_id = $1`, campusID).Scan(
		&overview.StatusCounts.Active, &overview.StatusCounts.Idle,
		&overview.StatusCounts.Maintenance, &overview.StatusCounts.Retired,
		&overview.StatusCounts.Total, &overview.AvgMileageKm,
		&overview.ServiceDueCount, &overview.InsuranceDueSoon, &overview.PermitDueSoon,
	)
	if err != nil {
		return nil, err
	}
	return overview, nil
}

// CountByStatus is a cheap aggregate.
func (r *Repository) CountByStatus(ctx context.Context, campusID uuid.UUID, status string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM ride_vehicles WHERE campus_id = $1 AND status = $2`,
		campusID, status).Scan(&n)
	return n, err
}

// ---------- helpers ----------

func joinAnd(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += " AND "
		}
		out += p
	}
	return out
}
func joinComma(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += ", "
		}
		out += p
	}
	return out
}