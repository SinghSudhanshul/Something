package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository handles all admin dashboard database operations.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository creates a new admin repository.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// ist returns the Asia/Kolkata timezone for date boundaries.
func ist() *time.Location {
	loc, _ := time.LoadLocation("Asia/Kolkata")
	return loc
}

// todayBounds returns the start and end of the current IST day in UTC.
func todayBounds() (time.Time, time.Time) {
	now := time.Now().In(ist())
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, ist())
	end := start.Add(24 * time.Hour)
	return start.UTC(), end.UTC()
}

// dateBounds returns start-of-day and end-of-day for a given YYYY-MM-DD string.
func dateBounds(dateStr string) (time.Time, time.Time, error) {
	t, err := time.ParseInLocation("2006-01-02", dateStr, ist())
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("invalid date format, expected YYYY-MM-DD: %w", err)
	}
	return t.UTC(), t.Add(24 * time.Hour).UTC(), nil
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DASHBOARD STATS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GetDashboardStats aggregates real-time counts from ride_requests, drivers,
// sos_alerts, and curator_shifts into a single DashboardStats snapshot.
func (r *Repository) GetDashboardStats(ctx context.Context, campusID *uuid.UUID) (*DashboardStats, error) {
	dayStart, dayEnd := todayBounds()
	var stats DashboardStats

	// Build campus filter clause
	campusClause := ""
	args := []interface{}{dayStart, dayEnd}
	if campusID != nil {
		campusClause = " AND campus_id = $3"
		args = append(args, *campusID)
	}

	query := fmt.Sprintf(`
		SELECT
			-- Active rides currently in progress
			(SELECT COUNT(*) FROM ride_requests WHERE status IN ('matched','in_progress') %[1]s),
			-- Online drivers (available + verified)
			(SELECT COUNT(*) FROM drivers WHERE is_available = true AND is_verified = true %[1]s),
			-- Unresolved SOS alerts
			(SELECT COUNT(*) FROM sos_alerts sa JOIN ride_requests rr ON rr.id = sa.ride_request_id
			 WHERE sa.resolved_at IS NULL %[1]s),
			-- Today total rides
			(SELECT COUNT(*) FROM ride_requests WHERE created_at >= $1 AND created_at < $2 %[1]s),
			-- Today completed
			(SELECT COUNT(*) FROM ride_requests WHERE status = 'completed' AND completed_at >= $1 AND completed_at < $2 %[1]s),
			-- Today cancelled
			(SELECT COUNT(*) FROM ride_requests WHERE status = 'cancelled' AND created_at >= $1 AND created_at < $2 %[1]s),
			-- Today revenue
			(SELECT COALESCE(SUM(rp.amount), 0) FROM ride_payments rp
			 JOIN ride_requests rr ON rr.id = rp.ride_id
			 WHERE rp.status = 'completed' AND rp.paid_at >= $1 AND rp.paid_at < $2 %[1]s),
			-- Average rating (last 30 days)
			(SELECT COALESCE(AVG(cs.avg_rating), 0) FROM curator_shifts cs WHERE cs.avg_rating IS NOT NULL
			 AND cs.started_at >= NOW() - INTERVAL '30 days' %[1]s),
			-- Active shifts
			(SELECT COUNT(*) FROM curator_shifts WHERE status = 'active' %[1]s),
			-- Peak hour today
			(SELECT COALESCE(
				(SELECT TO_CHAR(created_at AT TIME ZONE 'Asia/Kolkata', 'HH24:00')
				 FROM ride_requests
				 WHERE created_at >= $1 AND created_at < $2 %[1]s
				 GROUP BY TO_CHAR(created_at AT TIME ZONE 'Asia/Kolkata', 'HH24:00')
				 ORDER BY COUNT(*) DESC LIMIT 1),
				'--:--'
			)),
			-- Avg match time (seconds) for today
			(SELECT COALESCE(
				AVG(EXTRACT(EPOCH FROM (matched_at - created_at))), 0
			) FROM ride_requests
			 WHERE matched_at IS NOT NULL AND created_at >= $1 AND created_at < $2 %[1]s)
	`, campusClause)

	var peakHour string
	var avgMatchSec float64
	err := r.pool.QueryRow(ctx, query, args...).Scan(
		&stats.ActiveRides,
		&stats.OnlineDrivers,
		&stats.PendingSOS,
		&stats.TodayRides,
		&stats.TodayCompleted,
		&stats.TodayCancelled,
		&stats.TodayRevenue,
		&stats.AvgRating,
		&stats.ActiveShifts,
		&peakHour,
		&avgMatchSec,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get dashboard stats: %w", err)
	}

	stats.PeakHour = peakHour
	if avgMatchSec > 0 {
		stats.AvgMatchTime = fmt.Sprintf("%.0fs", avgMatchSec)
	} else {
		stats.AvgMatchTime = "--"
	}
	if stats.TodayRides > 0 {
		stats.CompletionRate = float64(stats.TodayCompleted) / float64(stats.TodayRides) * 100
	}

	return &stats, nil
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REVENUE PULSE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GetRevenuePulse builds a RevenuePulse snapshot for the given period.
// period: "daily" (today), "weekly" (last 7 days), "monthly" (last 30 days).
func (r *Repository) GetRevenuePulse(ctx context.Context, period string, campusID *uuid.UUID) (*RevenuePulse, error) {
	var intervalCurrent, intervalPrev string
	var truncFormat string
	switch period {
	case "weekly":
		intervalCurrent = "7 days"
		intervalPrev = "14 days"
		truncFormat = "YYYY-MM-DD"
	case "monthly":
		intervalCurrent = "30 days"
		intervalPrev = "60 days"
		truncFormat = "YYYY-MM-DD"
	default: // daily
		intervalCurrent = "1 day"
		intervalPrev = "2 days"
		truncFormat = "YYYY-MM-DD HH24:00"
	}

	campusClause := ""
	args := []interface{}{}
	if campusID != nil {
		campusClause = " AND rr.campus_id = $1"
		args = append(args, *campusID)
	}

	paramOffset := len(args)

	// ---------- Totals for current and previous period ----------
	totalsQuery := fmt.Sprintf(`
		SELECT
			COALESCE(SUM(CASE WHEN rp.paid_at >= NOW() - INTERVAL '%[1]s' THEN rp.amount ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN rp.paid_at >= NOW() - INTERVAL '%[2]s' AND rp.paid_at < NOW() - INTERVAL '%[1]s' THEN rp.amount ELSE 0 END), 0),
			COALESCE(AVG(CASE WHEN rp.paid_at >= NOW() - INTERVAL '%[1]s' THEN rp.amount END), 0),
			COALESCE(AVG(CASE WHEN rp.paid_at >= NOW() - INTERVAL '%[1]s' THEN rp.tip_amount END), 0),
			COALESCE(COUNT(CASE WHEN rp.paid_at >= NOW() - INTERVAL '%[1]s' THEN 1 END), 0)
		FROM ride_payments rp
		JOIN ride_requests rr ON rr.id = rp.ride_id
		WHERE rp.status = 'completed' AND rp.paid_at >= NOW() - INTERVAL '%[2]s'
		%[3]s
	`, intervalCurrent, intervalPrev, campusClause)

	pulse := &RevenuePulse{
		ByRideType: make(map[string]float64),
	}
	err := r.pool.QueryRow(ctx, totalsQuery, args...).Scan(
		&pulse.TotalRevenue,
		&pulse.PreviousPeriodRevenue,
		&pulse.AvgFare,
		&pulse.AvgTip,
		&pulse.TotalRides,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get revenue totals: %w", err)
	}

	// ---------- Revenue by ride type ----------
	byTypeQuery := fmt.Sprintf(`
		SELECT rr.ride_type, COALESCE(SUM(rp.amount), 0)
		FROM ride_payments rp
		JOIN ride_requests rr ON rr.id = rp.ride_id
		WHERE rp.status = 'completed' AND rp.paid_at >= NOW() - INTERVAL '%s'
		%s
		GROUP BY rr.ride_type
	`, intervalCurrent, campusClause)

	typeRows, err := r.pool.Query(ctx, byTypeQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to get revenue by ride type: %w", err)
	}
	defer typeRows.Close()

	for typeRows.Next() {
		var rideType string
		var revenue float64
		if err := typeRows.Scan(&rideType, &revenue); err != nil {
			return nil, fmt.Errorf("failed to scan ride type revenue: %w", err)
		}
		pulse.ByRideType[rideType] = revenue
	}

	// ---------- Revenue by campus ----------
	byCampusQuery := fmt.Sprintf(`
		SELECT rr.campus_id, COALESCE(SUM(rp.amount), 0), COUNT(rp.id)
		FROM ride_payments rp
		JOIN ride_requests rr ON rr.id = rp.ride_id
		WHERE rp.status = 'completed' AND rp.paid_at >= NOW() - INTERVAL '%s'
		%s
		GROUP BY rr.campus_id
		ORDER BY SUM(rp.amount) DESC
	`, intervalCurrent, campusClause)

	campusRows, err := r.pool.Query(ctx, byCampusQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to get revenue by campus: %w", err)
	}
	defer campusRows.Close()

	for campusRows.Next() {
		var cr CampusRevenue
		if err := campusRows.Scan(&cr.CampusID, &cr.Revenue, &cr.RideCount); err != nil {
			return nil, fmt.Errorf("failed to scan campus revenue: %w", err)
		}
		pulse.ByCampus = append(pulse.ByCampus, cr)
	}

	// ---------- Time series ----------
	_ = paramOffset
	tsQuery := fmt.Sprintf(`
		SELECT TO_CHAR(rp.paid_at AT TIME ZONE 'Asia/Kolkata', '%[1]s') AS bucket,
		       COALESCE(SUM(rp.amount), 0)
		FROM ride_payments rp
		JOIN ride_requests rr ON rr.id = rp.ride_id
		WHERE rp.status = 'completed' AND rp.paid_at >= NOW() - INTERVAL '%[2]s'
		%[3]s
		GROUP BY bucket
		ORDER BY bucket ASC
	`, truncFormat, intervalCurrent, campusClause)

	tsRows, err := r.pool.Query(ctx, tsQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to get revenue time series: %w", err)
	}
	defer tsRows.Close()

	for tsRows.Next() {
		var pt TimeSeriesPoint
		if err := tsRows.Scan(&pt.Timestamp, &pt.Value); err != nil {
			return nil, fmt.Errorf("failed to scan time series point: %w", err)
		}
		pulse.TimeSeries = append(pulse.TimeSeries, pt)
	}

	return pulse, nil
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CURATOR MANAGEMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ListCurators returns a paginated, filterable list of curators.
func (r *Repository) ListCurators(ctx context.Context, filter CuratorListFilter) ([]CuratorDetail, error) {
	if filter.Limit <= 0 || filter.Limit > 100 {
		filter.Limit = 25
	}

	query := `
		SELECT d.id, COALESCE(sp.full_name, 'Unknown'), d.vehicle_type, d.vehicle_number,
		       d.is_verified, d.is_available, d.total_rides,
		       COALESCE(sp.trust_score, 0)::float,
		       COALESCE((SELECT SUM(total_earnings) FROM curator_shifts WHERE driver_id = d.id), 0)::float,
		       d.created_at, d.last_location_at,
		       CASE
		         WHEN NOT d.is_verified THEN 'pending_verification'
		         WHEN d.is_available THEN 'online'
		         ELSE 'offline'
		       END AS status
		FROM drivers d
		LEFT JOIN student_profiles sp ON sp.user_id = d.user_id
		WHERE 1=1
	`
	args := []interface{}{}
	paramIdx := 1

	if filter.CampusID != nil {
		query += fmt.Sprintf(" AND d.campus_id = $%d", paramIdx)
		args = append(args, *filter.CampusID)
		paramIdx++
	}
	if filter.Verified != nil {
		query += fmt.Sprintf(" AND d.is_verified = $%d", paramIdx)
		args = append(args, *filter.Verified)
		paramIdx++
	}
	if filter.Available != nil {
		query += fmt.Sprintf(" AND d.is_available = $%d", paramIdx)
		args = append(args, *filter.Available)
		paramIdx++
	}
	if filter.Search != "" {
		query += fmt.Sprintf(" AND (sp.full_name ILIKE $%d OR d.vehicle_number ILIKE $%d)", paramIdx, paramIdx)
		args = append(args, "%"+filter.Search+"%")
		paramIdx++
	}
	if filter.Cursor != nil {
		query += fmt.Sprintf(" AND d.id > $%d", paramIdx)
		args = append(args, *filter.Cursor)
		paramIdx++
	}

	query += fmt.Sprintf(" ORDER BY d.id ASC LIMIT $%d", paramIdx)
	args = append(args, filter.Limit)

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list curators: %w", err)
	}
	defer rows.Close()

	var curators []CuratorDetail
	for rows.Next() {
		var c CuratorDetail
		if err := rows.Scan(
			&c.DriverID, &c.Name, &c.VehicleType, &c.VehicleNumber,
			&c.IsVerified, &c.IsAvailable, &c.TotalRides,
			&c.AvgRating, &c.TotalEarnings,
			&c.JoinedAt, &c.LastActiveAt, &c.Status,
		); err != nil {
			return nil, fmt.Errorf("failed to scan curator: %w", err)
		}
		c.Flags = r.computeCuratorFlags(c)
		curators = append(curators, c)
	}
	return curators, nil
}

// computeCuratorFlags derives warning flags from curator data.
func (r *Repository) computeCuratorFlags(c CuratorDetail) []string {
	var flags []string
	if c.AvgRating > 0 && c.AvgRating < 3.5 {
		flags = append(flags, "low_rating")
	}
	if !c.IsVerified {
		flags = append(flags, "unverified")
	}
	if c.TotalRides == 0 && time.Since(c.JoinedAt) > 7*24*time.Hour {
		flags = append(flags, "inactive_new")
	}
	if c.LastActiveAt != nil && time.Since(*c.LastActiveAt) > 14*24*time.Hour {
		flags = append(flags, "dormant")
	}
	if flags == nil {
		flags = []string{}
	}
	return flags
}

// GetCuratorDetail returns a single curator's enriched profile.
func (r *Repository) GetCuratorDetail(ctx context.Context, driverID uuid.UUID) (*CuratorDetail, error) {
	var c CuratorDetail
	err := r.pool.QueryRow(ctx, `
		SELECT d.id, COALESCE(sp.full_name, 'Unknown'), d.vehicle_type, d.vehicle_number,
		       d.is_verified, d.is_available, d.total_rides,
		       COALESCE(sp.trust_score, 0)::float,
		       COALESCE((SELECT SUM(total_earnings) FROM curator_shifts WHERE driver_id = d.id), 0)::float,
		       d.created_at, d.last_location_at,
		       CASE
		         WHEN NOT d.is_verified THEN 'pending_verification'
		         WHEN d.is_available THEN 'online'
		         ELSE 'offline'
		       END AS status
		FROM drivers d
		LEFT JOIN student_profiles sp ON sp.user_id = d.user_id
		WHERE d.id = $1
	`, driverID).Scan(
		&c.DriverID, &c.Name, &c.VehicleType, &c.VehicleNumber,
		&c.IsVerified, &c.IsAvailable, &c.TotalRides,
		&c.AvgRating, &c.TotalEarnings,
		&c.JoinedAt, &c.LastActiveAt, &c.Status,
	)
	if err != nil {
		return nil, fmt.Errorf("curator not found: %w", err)
	}
	c.Flags = r.computeCuratorFlags(c)
	return &c, nil
}

// ApproveCurator sets a driver as verified.
func (r *Repository) ApproveCurator(ctx context.Context, driverID uuid.UUID) error {
	result, err := r.pool.Exec(ctx, `
		UPDATE drivers SET is_verified = true, updated_at = NOW() WHERE id = $1
	`, driverID)
	if err != nil {
		return fmt.Errorf("failed to approve curator: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("curator not found: %s", driverID)
	}
	return nil
}

// SuspendCurator marks a driver as unverified and unavailable.
func (r *Repository) SuspendCurator(ctx context.Context, driverID uuid.UUID) error {
	result, err := r.pool.Exec(ctx, `
		UPDATE drivers SET is_verified = false, is_available = false, updated_at = NOW() WHERE id = $1
	`, driverID)
	if err != nil {
		return fmt.Errorf("failed to suspend curator: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("curator not found: %s", driverID)
	}
	return nil
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUDIT LOGS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// CreateAuditLog persists an audit log entry.
func (r *Repository) CreateAuditLog(ctx context.Context, input CreateAuditLogInput) (*AuditLog, error) {
	detailsJSON, err := json.Marshal(input.Details)
	if err != nil {
		detailsJSON = []byte("{}")
	}

	var log AuditLog
	err = r.pool.QueryRow(ctx, `
		INSERT INTO audit_logs (actor_id, actor_role, action, resource_type, resource_id,
		                        campus_id, details, ip_address, user_agent, request_id,
		                        duration_ms, status_code)
		VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::inet, $9, $10, $11, $12)
		RETURNING id, actor_id, actor_role, action, resource_type, resource_id,
		          campus_id, details, ip_address::text, user_agent, request_id,
		          duration_ms, status_code, created_at
	`, input.ActorID, input.ActorRole, input.Action, input.ResourceType, input.ResourceID,
		input.CampusID, string(detailsJSON), input.IPAddress, input.UserAgent, input.RequestID,
		input.DurationMs, input.StatusCode,
	).Scan(
		&log.ID, &log.ActorID, &log.ActorRole, &log.Action, &log.ResourceType, &log.ResourceID,
		&log.CampusID, &log.Details, &log.IPAddress, &log.UserAgent, &log.RequestID,
		&log.DurationMs, &log.StatusCode, &log.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create audit log: %w", err)
	}
	return &log, nil
}

// ListAuditLogs returns a paginated, filterable list of audit log entries.
func (r *Repository) ListAuditLogs(ctx context.Context, filter AuditLogFilter) ([]AuditLog, error) {
	if filter.Limit <= 0 || filter.Limit > 100 {
		filter.Limit = 25
	}

	conditions := []string{}
	args := []interface{}{}
	paramIdx := 1

	if filter.Action != "" {
		conditions = append(conditions, fmt.Sprintf("action = $%d", paramIdx))
		args = append(args, filter.Action)
		paramIdx++
	}
	if filter.ResourceType != "" {
		conditions = append(conditions, fmt.Sprintf("resource_type = $%d", paramIdx))
		args = append(args, filter.ResourceType)
		paramIdx++
	}
	if filter.ActorID != nil {
		conditions = append(conditions, fmt.Sprintf("actor_id = $%d", paramIdx))
		args = append(args, *filter.ActorID)
		paramIdx++
	}
	if filter.From != nil {
		conditions = append(conditions, fmt.Sprintf("created_at >= $%d", paramIdx))
		args = append(args, *filter.From)
		paramIdx++
	}
	if filter.To != nil {
		conditions = append(conditions, fmt.Sprintf("created_at < $%d", paramIdx))
		args = append(args, *filter.To)
		paramIdx++
	}
	if filter.Cursor != nil {
		conditions = append(conditions, fmt.Sprintf("created_at < $%d", paramIdx))
		args = append(args, *filter.Cursor)
		paramIdx++
	}

	where := ""
	if len(conditions) > 0 {
		where = "WHERE " + strings.Join(conditions, " AND ")
	}

	query := fmt.Sprintf(`
		SELECT id, actor_id, actor_role, action, resource_type, resource_id,
		       campus_id, details, ip_address::text, user_agent, request_id,
		       duration_ms, status_code, created_at
		FROM audit_logs
		%s
		ORDER BY created_at DESC
		LIMIT $%d
	`, where, paramIdx)
	args = append(args, filter.Limit)

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list audit logs: %w", err)
	}
	defer rows.Close()

	var logs []AuditLog
	for rows.Next() {
		var l AuditLog
		if err := rows.Scan(
			&l.ID, &l.ActorID, &l.ActorRole, &l.Action, &l.ResourceType, &l.ResourceID,
			&l.CampusID, &l.Details, &l.IPAddress, &l.UserAgent, &l.RequestID,
			&l.DurationMs, &l.StatusCode, &l.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan audit log: %w", err)
		}
		logs = append(logs, l)
	}
	return logs, nil
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DEMAND HEATMAP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GetDemandHeatmap aggregates ride pickups into geo grid cells for the given time window.
func (r *Repository) GetDemandHeatmap(ctx context.Context, campusID uuid.UUID, from, to time.Time) ([]HeatmapCell, error) {
	query := `
		SELECT
			$1::uuid AS campus_id,
			ROUND(ST_Y(pickup_location::geometry) / 0.005) * 0.005 AS lat,
			ROUND(ST_X(pickup_location::geometry) / 0.005) * 0.005 AS lng,
			0.005 AS cell_size,
			COUNT(*)::float AS demand_score,
			COALESCE(
				(SELECT COUNT(*) FROM drivers d
				 WHERE d.is_available = true AND d.is_verified = true AND d.campus_id = $1
				 AND ST_DWithin(d.location,
					ST_SetSRID(ST_MakePoint(
						ROUND(ST_X(rr.pickup_location::geometry) / 0.005) * 0.005,
						ROUND(ST_Y(rr.pickup_location::geometry) / 0.005) * 0.005
					), 4326)::geography, 500)
				), 0)::float AS supply_score,
			COALESCE(
				(SELECT sz.multiplier FROM surge_zones sz
				 WHERE sz.campus_id = $1
				 AND ST_Contains(sz.boundary::geometry,
					ST_SetSRID(ST_MakePoint(
						ROUND(ST_X(rr.pickup_location::geometry) / 0.005) * 0.005,
						ROUND(ST_Y(rr.pickup_location::geometry) / 0.005) * 0.005
					), 4326))
				 AND (sz.active_until IS NULL OR sz.active_until > NOW())
				 ORDER BY sz.multiplier DESC LIMIT 1
				), 1.0) AS surge_multiplier,
			COUNT(*) AS ride_count,
			DATE_TRUNC('hour', rr.created_at) AS time_bucket,
			false AS prediction
		FROM ride_requests rr
		WHERE rr.campus_id = $1
		  AND rr.created_at >= $2
		  AND rr.created_at < $3
		GROUP BY lat, lng, time_bucket, rr.pickup_location
		HAVING COUNT(*) >= 1
		ORDER BY demand_score DESC
		LIMIT 500
	`

	rows, err := r.pool.Query(ctx, query, campusID, from, to)
	if err != nil {
		return nil, fmt.Errorf("failed to get demand heatmap: %w", err)
	}
	defer rows.Close()

	var cells []HeatmapCell
	for rows.Next() {
		var cell HeatmapCell
		if err := rows.Scan(
			&cell.CampusID, &cell.Lat, &cell.Lng, &cell.CellSize,
			&cell.DemandScore, &cell.SupplyScore, &cell.SurgeMultiplier,
			&cell.RideCount, &cell.TimeBucket, &cell.Prediction,
		); err != nil {
			return nil, fmt.Errorf("failed to scan heatmap cell: %w", err)
		}
		cells = append(cells, cell)
	}
	return cells, nil
}

// GetPredictedDemand returns predicted demand based on historical averages by hour-of-day.
func (r *Repository) GetPredictedDemand(ctx context.Context, campusID uuid.UUID) ([]HeatmapCell, error) {
	// Aggregate last 4 weeks of data by hour-of-day and geo cell to produce predictions
	query := `
		SELECT
			$1::uuid AS campus_id,
			ROUND(ST_Y(pickup_location::geometry) / 0.005) * 0.005 AS lat,
			ROUND(ST_X(pickup_location::geometry) / 0.005) * 0.005 AS lng,
			0.005 AS cell_size,
			(COUNT(*)::float / 4.0) AS demand_score,
			0::float AS supply_score,
			1.0 AS surge_multiplier,
			(COUNT(*) / 4) AS ride_count,
			DATE_TRUNC('hour', NOW() AT TIME ZONE 'Asia/Kolkata') +
			  (EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Kolkata') * INTERVAL '1 hour') AS time_bucket,
			true AS prediction
		FROM ride_requests
		WHERE campus_id = $1
		  AND created_at >= NOW() - INTERVAL '28 days'
		  AND EXTRACT(DOW FROM created_at AT TIME ZONE 'Asia/Kolkata') = EXTRACT(DOW FROM NOW() AT TIME ZONE 'Asia/Kolkata')
		GROUP BY lat, lng, EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Kolkata')
		HAVING COUNT(*) >= 2
		ORDER BY demand_score DESC
		LIMIT 200
	`

	rows, err := r.pool.Query(ctx, query, campusID)
	if err != nil {
		return nil, fmt.Errorf("failed to get predicted demand: %w", err)
	}
	defer rows.Close()

	var cells []HeatmapCell
	for rows.Next() {
		var cell HeatmapCell
		if err := rows.Scan(
			&cell.CampusID, &cell.Lat, &cell.Lng, &cell.CellSize,
			&cell.DemandScore, &cell.SupplyScore, &cell.SurgeMultiplier,
			&cell.RideCount, &cell.TimeBucket, &cell.Prediction,
		); err != nil {
			return nil, fmt.Errorf("failed to scan predicted cell: %w", err)
		}
		cells = append(cells, cell)
	}
	return cells, nil
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DAILY / CAMPUS REPORTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GetDailyReport generates a comprehensive report for a single day.
func (r *Repository) GetDailyReport(ctx context.Context, dateStr string, campusID *uuid.UUID) (*DailyReport, error) {
	dayStart, dayEnd, err := dateBounds(dateStr)
	if err != nil {
		return nil, err
	}

	campusClause := ""
	args := []interface{}{dayStart, dayEnd}
	if campusID != nil {
		campusClause = " AND rr.campus_id = $3"
		args = append(args, *campusID)
	}

	report := &DailyReport{Date: dateStr}

	// Core metrics
	coreQuery := fmt.Sprintf(`
		SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE rr.status = 'completed'),
			COUNT(*) FILTER (WHERE rr.status = 'cancelled'),
			COALESCE(SUM(rp.amount) FILTER (WHERE rp.status = 'completed'), 0),
			COALESCE(AVG(rp.amount) FILTER (WHERE rp.status = 'completed'), 0),
			COALESCE(
				(SELECT TO_CHAR(rr2.created_at AT TIME ZONE 'Asia/Kolkata', 'HH24:00')
				 FROM ride_requests rr2
				 WHERE rr2.created_at >= $1 AND rr2.created_at < $2 %[1]s
				 GROUP BY TO_CHAR(rr2.created_at AT TIME ZONE 'Asia/Kolkata', 'HH24:00')
				 ORDER BY COUNT(*) DESC LIMIT 1),
				'--:--'
			),
			COALESCE(AVG(EXTRACT(EPOCH FROM (rr.matched_at - rr.created_at)))
				FILTER (WHERE rr.matched_at IS NOT NULL), 0)
		FROM ride_requests rr
		LEFT JOIN ride_payments rp ON rp.ride_id = rr.id
		WHERE rr.created_at >= $1 AND rr.created_at < $2
		%[1]s
	`, campusClause)

	err = r.pool.QueryRow(ctx, coreQuery, args...).Scan(
		&report.TotalRides,
		&report.CompletedRides,
		&report.CancelledRides,
		&report.Revenue,
		&report.AvgFare,
		&report.PeakHour,
		&report.AvgMatchTimeSec,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get daily report core metrics: %w", err)
	}

	// SOS count
	sosCampusClause := ""
	sosArgs := []interface{}{dayStart, dayEnd}
	if campusID != nil {
		sosCampusClause = " AND rr.campus_id = $3"
		sosArgs = append(sosArgs, *campusID)
	}
	sosQuery := fmt.Sprintf(`
		SELECT COUNT(*)
		FROM sos_alerts sa
		JOIN ride_requests rr ON rr.id = sa.ride_request_id
		WHERE sa.created_at >= $1 AND sa.created_at < $2 %s
	`, sosCampusClause)
	_ = r.pool.QueryRow(ctx, sosQuery, sosArgs...).Scan(&report.SOSCount)

	// Incident count
	incCampusClause := ""
	incArgs := []interface{}{dayStart, dayEnd}
	if campusID != nil {
		incCampusClause = " AND campus_id = $3"
		incArgs = append(incArgs, *campusID)
	}
	incQuery := fmt.Sprintf(`
		SELECT COUNT(*) FROM incidents WHERE created_at >= $1 AND created_at < $2 %s
	`, incCampusClause)
	_ = r.pool.QueryRow(ctx, incQuery, incArgs...).Scan(&report.IncidentCount)

	// Top curators
	topQuery := fmt.Sprintf(`
		SELECT COALESCE(sp.full_name, 'Unknown'), COUNT(*) AS cnt
		FROM ride_requests rr
		JOIN drivers d ON d.id = rr.driver_id
		LEFT JOIN student_profiles sp ON sp.user_id = d.user_id
		WHERE rr.status = 'completed' AND rr.completed_at >= $1 AND rr.completed_at < $2
		%s
		GROUP BY sp.full_name
		ORDER BY cnt DESC
		LIMIT 5
	`, campusClause)
	topRows, err := r.pool.Query(ctx, topQuery, args...)
	if err == nil {
		defer topRows.Close()
		for topRows.Next() {
			var entry LeaderEntry
			if err := topRows.Scan(&entry.Name, &entry.Value); err == nil {
				report.TopCurators = append(report.TopCurators, entry)
			}
		}
	}
	if report.TopCurators == nil {
		report.TopCurators = []LeaderEntry{}
	}

	// Busiest routes
	routeQuery := fmt.Sprintf(`
		SELECT rr.pickup_label, rr.dropoff_label, COUNT(*) AS cnt
		FROM ride_requests rr
		WHERE rr.created_at >= $1 AND rr.created_at < $2
		%s
		GROUP BY rr.pickup_label, rr.dropoff_label
		ORDER BY cnt DESC
		LIMIT 5
	`, campusClause)
	routeRows, err := r.pool.Query(ctx, routeQuery, args...)
	if err == nil {
		defer routeRows.Close()
		for routeRows.Next() {
			var entry RouteEntry
			if err := routeRows.Scan(&entry.From, &entry.To, &entry.Count); err == nil {
				report.BusiestRoutes = append(report.BusiestRoutes, entry)
			}
		}
	}
	if report.BusiestRoutes == nil {
		report.BusiestRoutes = []RouteEntry{}
	}

	return report, nil
}

// GetCampusReport generates a campus-specific daily report.
func (r *Repository) GetCampusReport(ctx context.Context, campusID uuid.UUID, dateStr string) (*DailyReport, error) {
	return r.GetDailyReport(ctx, dateStr, &campusID)
}
