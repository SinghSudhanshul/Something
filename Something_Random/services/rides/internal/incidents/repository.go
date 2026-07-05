package incidents

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Errors.
var (
	ErrIncidentNotFound = errors.New("incident not found")
	ErrAlreadyResolved  = errors.New("incident already resolved")
	ErrInvalidStatus    = errors.New("invalid incident status transition")
)

// Repository handles ride_incidents persistence.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a repo.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

// CreateIncident inserts a new ride incident.
func (r *Repository) CreateIncident(ctx context.Context, input ReportIncidentInput, reportedBy, campusID uuid.UUID, role string) (*Incident, error) {
	severity := input.Severity
	if severity == "" {
		severity = "medium"
	}
	if role == "" {
		role = "rider"
	}
	var inc Incident
	err := r.pool.QueryRow(ctx, `
		INSERT INTO ride_incidents (
			ride_id, campus_id, reported_by, reported_role, type, severity,
			title, description, status, location, evidence_urls
		) VALUES (
			$1, $2, $3, $4, $5::ride_incident_type, $6::ride_incident_severity,
			$7, $8, 'open',
			CASE WHEN $9::float8 IS NOT NULL THEN ST_SetSRID(ST_MakePoint($10, $9), 4326)::geography ELSE NULL END,
			$11::text[]
		)
		RETURNING id, ride_id, campus_id, reported_by, reported_role, type, severity,
		          title, description, status, assigned_to,
		          ST_Y(location::geometry), ST_X(location::geometry),
		          evidence_urls, resolution_note, resolution_type,
		          resolved_at, resolved_by, escalated_at, escalated_to,
		          sla_deadline, tags, metadata, created_at, updated_at`,
		input.RideID, campusID, reportedBy, role, input.Type, severity,
		input.Title, input.Description, input.Lat, input.Lng, input.EvidenceURLs,
	).Scan(
		&inc.ID, &inc.RideID, &inc.CampusID, &inc.ReportedBy, &inc.ReportedRole,
		&inc.Type, &inc.Severity, &inc.Title, &inc.Description, &inc.Status,
		&inc.AssignedTo, &inc.Lat, &inc.Lng,
		&inc.EvidenceURLs, &inc.ResolutionNote, &inc.ResolutionType,
		&inc.ResolvedAt, &inc.ResolvedBy, &inc.EscalatedAt, &inc.EscalatedTo,
		&inc.SLADeadline, &inc.Tags, &inc.Metadata,
		&inc.CreatedAt, &inc.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("create incident: %w", err)
	}
	return &inc, nil
}

// GetIncidentByID returns a single incident.
func (r *Repository) GetIncidentByID(ctx context.Context, id uuid.UUID) (*Incident, error) {
	var inc Incident
	err := r.pool.QueryRow(ctx, `
		SELECT id, ride_id, campus_id, reported_by, reported_role, type, severity,
		       title, description, status, assigned_to,
		       ST_Y(location::geometry), ST_X(location::geometry),
		       evidence_urls, resolution_note, resolution_type,
		       resolved_at, resolved_by, escalated_at, escalated_to,
		       sla_deadline, tags, metadata, created_at, updated_at
		FROM ride_incidents WHERE id = $1`, id).Scan(
		&inc.ID, &inc.RideID, &inc.CampusID, &inc.ReportedBy, &inc.ReportedRole,
		&inc.Type, &inc.Severity, &inc.Title, &inc.Description, &inc.Status,
		&inc.AssignedTo, &inc.Lat, &inc.Lng,
		&inc.EvidenceURLs, &inc.ResolutionNote, &inc.ResolutionType,
		&inc.ResolvedAt, &inc.ResolvedBy, &inc.EscalatedAt, &inc.EscalatedTo,
		&inc.SLADeadline, &inc.Tags, &inc.Metadata,
		&inc.CreatedAt, &inc.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrIncidentNotFound
		}
		return nil, err
	}
	return &inc, nil
}

// ListIncidents returns filtered incidents.
func (r *Repository) ListIncidents(ctx context.Context, status, severity, incType *string, campusID *uuid.UUID, limit int) ([]Incident, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := `
		SELECT id, ride_id, campus_id, reported_by, reported_role, type, severity,
		       title, description, status, assigned_to,
		       ST_Y(location::geometry), ST_X(location::geometry),
		       evidence_urls, resolution_note, resolution_type,
		       resolved_at, resolved_by, escalated_at, escalated_to,
		       sla_deadline, tags, metadata, created_at, updated_at
		FROM ride_incidents WHERE 1=1
	`
	args := []any{}
	idx := 1
	if status != nil {
		q += fmt.Sprintf(" AND status = $%d", idx)
		args = append(args, *status)
		idx++
	}
	if severity != nil {
		q += fmt.Sprintf(" AND severity = $%d", idx)
		args = append(args, *severity)
		idx++
	}
	if incType != nil {
		q += fmt.Sprintf(" AND type = $%d", idx)
		args = append(args, *incType)
		idx++
	}
	if campusID != nil {
		q += fmt.Sprintf(" AND campus_id = $%d", idx)
		args = append(args, *campusID)
		idx++
	}
	q += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d", idx)
	args = append(args, limit)

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Incident{}
	for rows.Next() {
		var inc Incident
		if err := rows.Scan(
			&inc.ID, &inc.RideID, &inc.CampusID, &inc.ReportedBy, &inc.ReportedRole,
			&inc.Type, &inc.Severity, &inc.Title, &inc.Description, &inc.Status,
			&inc.AssignedTo, &inc.Lat, &inc.Lng,
			&inc.EvidenceURLs, &inc.ResolutionNote, &inc.ResolutionType,
			&inc.ResolvedAt, &inc.ResolvedBy, &inc.EscalatedAt, &inc.EscalatedTo,
			&inc.SLADeadline, &inc.Tags, &inc.Metadata,
			&inc.CreatedAt, &inc.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, inc)
	}
	return out, rows.Err()
}

// UpdateIncident patches fields on an open incident.
func (r *Repository) UpdateIncident(ctx context.Context, id uuid.UUID, in UpdateIncidentInput) (*Incident, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if in.Status != nil {
		if _, err := tx.Exec(ctx, `UPDATE ride_incidents SET status = $1::ride_incident_status, updated_at = NOW() WHERE id = $2`, *in.Status, id); err != nil {
			return nil, err
		}
	}
	if in.AssignedTo != nil {
		if _, err := tx.Exec(ctx, `UPDATE ride_incidents SET assigned_to = $1, updated_at = NOW() WHERE id = $2`, *in.AssignedTo, id); err != nil {
			return nil, err
		}
	}
	if in.Tags != nil {
		if _, err := tx.Exec(ctx, `UPDATE ride_incidents SET tags = $1::text[], updated_at = NOW() WHERE id = $2`, in.Tags, id); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetIncidentByID(ctx, id)
}

// ResolveIncident marks an incident as resolved.
func (r *Repository) ResolveIncident(ctx context.Context, id, resolvedBy uuid.UUID, note, resolutionType string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE ride_incidents SET status = 'resolved', resolved_at = NOW(), resolved_by = $2,
		    resolution_note = $3, resolution_type = $4, updated_at = NOW()
		WHERE id = $1 AND status IN ('open','investigating','escalated')`, id, resolvedBy, note, resolutionType)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrAlreadyResolved
	}
	return nil
}

// EscalateIncident escalates an incident.
func (r *Repository) EscalateIncident(ctx context.Context, id, escalatedTo uuid.UUID, reason string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE ride_incidents SET status = 'escalated', escalated_at = NOW(), escalated_to = $2,
		    tags = array_append(tags, $3), updated_at = NOW()
		WHERE id = $1 AND status IN ('open','investigating')`, id, escalatedTo, "escalated:"+reason)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrInvalidStatus
	}
	return nil
}

// DismissIncident dismisses an incident.
func (r *Repository) DismissIncident(ctx context.Context, id uuid.UUID, reason string, dismissedBy uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE ride_incidents SET status = 'dismissed', resolution_note = $2,
		    resolved_by = $3, resolved_at = NOW(), updated_at = NOW()
		WHERE id = $1`, id, reason, dismissedBy)
	return err
}

// GetDashboardStats returns aggregate metrics.
func (r *Repository) GetDashboardStats(ctx context.Context, campusID *uuid.UUID) (*SafetyDashboard, error) {
	dash := &SafetyDashboard{ByType: map[string]int{}, BySeverity: map[string]int{}}

	args := []any{}
	q := `SELECT status, COUNT(*) FROM ride_incidents WHERE created_at >= NOW() - INTERVAL '30 days'`
	if campusID != nil {
		q += ` AND campus_id = $1`
		args = append(args, *campusID)
	}
	q += ` GROUP BY status`
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var s string
		var c int
		_ = rows.Scan(&s, &c)
		dash.TotalIncidents += c
		switch s {
		case "open":
			dash.OpenIncidents = c
		case "investigating":
			dash.InvestigatingCount = c
		case "resolved":
			dash.ResolvedCount = c
		}
	}
	rows.Close()

	r.pool.QueryRow(ctx, `
		SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600), 0)::float8
		FROM ride_incidents
		WHERE status = 'resolved' AND resolved_at IS NOT NULL
		  AND created_at >= NOW() - INTERVAL '30 days'`).Scan(&dash.AvgResolutionHours)

	r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM ride_incidents
		WHERE sla_deadline < NOW() AND status IN ('open','investigating','escalated')`).Scan(&dash.OverdueSLA)

	typeArgs := []any{}
	typeQ := `SELECT type, COUNT(*) FROM ride_incidents WHERE created_at >= NOW() - INTERVAL '30 days'`
	if campusID != nil {
		typeQ += ` AND campus_id = $1`
		typeArgs = append(typeArgs, *campusID)
	}
	typeQ += ` GROUP BY type`
	if typeRows, err := r.pool.Query(ctx, typeQ, typeArgs...); err == nil {
		for typeRows.Next() {
			var t string
			var c int
			_ = typeRows.Scan(&t, &c)
			dash.ByType[t] = c
		}
		typeRows.Close()
	}

	sevArgs := []any{}
	sevQ := `SELECT severity, COUNT(*) FROM ride_incidents WHERE created_at >= NOW() - INTERVAL '30 days'`
	if campusID != nil {
		sevQ += ` AND campus_id = $1`
		sevArgs = append(sevArgs, *campusID)
	}
	sevQ += ` GROUP BY severity`
	if sevRows, err := r.pool.Query(ctx, sevQ, sevArgs...); err == nil {
		for sevRows.Next() {
			var s string
			var c int
			_ = sevRows.Scan(&s, &c)
			dash.BySeverity[s] = c
		}
		sevRows.Close()
	}

	return dash, nil
}

// GetSafetyScore returns a composite campus safety score.
func (r *Repository) GetSafetyScore(ctx context.Context, campusID uuid.UUID) (float64, error) {
	var score float64
	err := r.pool.QueryRow(ctx, `
		WITH stats AS (
			SELECT
				COUNT(*) FILTER (WHERE severity = 'critical') AS critical,
				COUNT(*) FILTER (WHERE severity = 'high') AS high,
				COUNT(*) FILTER (WHERE severity = 'medium') AS medium,
				COUNT(*) FILTER (WHERE severity = 'low') AS low
			FROM ride_incidents
			WHERE campus_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
		),
		rides AS (
			SELECT GREATEST(COUNT(*), 1) AS total FROM ride_requests
			WHERE campus_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
		)
		SELECT GREATEST(0, LEAST(100,
			100 - (stats.critical*10 + stats.high*5 + stats.medium*2 + stats.low*0.5)::float / rides.total * 100
		)) FROM stats, rides`, campusID).Scan(&score)
	if err != nil {
		return 95.0, nil
	}
	return score, nil
}

// GetTrendData returns incident counts by day.
func (r *Repository) GetTrendData(ctx context.Context, campusID *uuid.UUID) ([]TrendPoint, error) {
	q := `
		SELECT d::date::text, COALESCE(c, 0)
		FROM generate_series(NOW() - INTERVAL '30 days', NOW(), '1 day') d
		LEFT JOIN (
			SELECT created_at::date AS day, COUNT(*) AS c FROM ride_incidents
			WHERE created_at >= NOW() - INTERVAL '30 days'
	`
	args := []any{}
	if campusID != nil {
		q += ` AND campus_id = $1`
		args = append(args, *campusID)
	}
	q += ` GROUP BY day) sub ON d::date = sub.day ORDER BY d`
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TrendPoint{}
	for rows.Next() {
		var t TrendPoint
		_ = rows.Scan(&t.Date, &t.Count)
		out = append(out, t)
	}
	return out, rows.Err()
}

// GetRecentIncidents returns the N most recent incidents.
func (r *Repository) GetRecentIncidents(ctx context.Context, limit int) ([]Incident, error) {
	if limit <= 0 || limit > 100 {
		limit = 10
	}
	rows, err := r.pool.Query(ctx, `
		SELECT id, ride_id, campus_id, reported_by, reported_role, type, severity,
		       title, description, status, assigned_to,
		       ST_Y(location::geometry), ST_X(location::geometry),
		       evidence_urls, resolution_note, resolution_type,
		       resolved_at, resolved_by, escalated_at, escalated_to,
		       sla_deadline, tags, metadata, created_at, updated_at
		FROM ride_incidents ORDER BY created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Incident{}
	for rows.Next() {
		var inc Incident
		if err := rows.Scan(
			&inc.ID, &inc.RideID, &inc.CampusID, &inc.ReportedBy, &inc.ReportedRole,
			&inc.Type, &inc.Severity, &inc.Title, &inc.Description, &inc.Status,
			&inc.AssignedTo, &inc.Lat, &inc.Lng,
			&inc.EvidenceURLs, &inc.ResolutionNote, &inc.ResolutionType,
			&inc.ResolvedAt, &inc.ResolvedBy, &inc.EscalatedAt, &inc.EscalatedTo,
			&inc.SLADeadline, &inc.Tags, &inc.Metadata,
			&inc.CreatedAt, &inc.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, inc)
	}
	return out, rows.Err()
}

// GetProtocols returns safety protocols.
func (r *Repository) GetProtocols(ctx context.Context, campusID *uuid.UUID, category *string) ([]SafetyProtocol, error) {
	q := `SELECT id, campus_id, title, description, category, priority, is_active,
	             effective_from, effective_until, version, approved_by, created_at, updated_at
	      FROM safety_protocols WHERE is_active = true`
	args := []any{}
	idx := 1
	if campusID != nil {
		q += fmt.Sprintf(" AND (campus_id IS NULL OR campus_id = $%d)", idx)
		args = append(args, *campusID)
		idx++
	}
	if category != nil {
		q += fmt.Sprintf(" AND category = $%d", idx)
		args = append(args, *category)
		idx++
	}
	q += " ORDER BY priority ASC, created_at DESC"

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SafetyProtocol{}
	for rows.Next() {
		var p SafetyProtocol
		if err := rows.Scan(&p.ID, &p.CampusID, &p.Title, &p.Description, &p.Category,
			&p.Priority, &p.IsActive, &p.EffectiveFrom, &p.EffectiveUntil,
			&p.Version, &p.ApprovedBy, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// CountOpenForRide counts unresolved incidents.
func (r *Repository) CountOpenForRide(ctx context.Context, rideID uuid.UUID) (int, error) {
	var c int
	err := r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM ride_incidents
		WHERE ride_id = $1 AND status NOT IN ('resolved','dismissed')`, rideID).Scan(&c)
	return c, err
}

// SLAOverdue returns the count of incidents past their SLA deadline.
func (r *Repository) SLAOverdue(ctx context.Context) (int, error) {
	var c int
	err := r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM ride_incidents
		WHERE sla_deadline < $1 AND status IN ('open','investigating','escalated')`, time.Now()).Scan(&c)
	return c, err
}