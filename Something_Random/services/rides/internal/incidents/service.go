package incidents

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	internalKafka "nexus/rides/internal/kafka"
)

// Service provides incident management business logic.
type Service struct {
	repo   *Repository
	pool   *pgxpool.Pool
	rdb    *redis.Client
	kafka  *internalKafka.Producer
	logger *zap.Logger
}

// NewService creates a new incidents service.
func NewService(repo *Repository, pool *pgxpool.Pool, rdb *redis.Client, kafka *internalKafka.Producer, logger *zap.Logger) *Service {
	return &Service{repo: repo, pool: pool, rdb: rdb, kafka: kafka, logger: logger}
}

// ReportIncident creates a new incident report.
func (s *Service) ReportIncident(ctx context.Context, input ReportIncidentInput, reportedBy, campusID uuid.UUID, role string) (*Incident, error) {
	inc, err := s.repo.CreateIncident(ctx, input, reportedBy, campusID, role)
	if err != nil {
		return nil, err
	}

	_ = s.kafka.Publish(ctx, "rides.incident.reported", inc.ID.String(), internalKafka.Event{
		Type: "rides.incident.reported",
		Payload: map[string]interface{}{
			"incident_id": inc.ID,
			"type":        inc.Type,
			"severity":    inc.Severity,
			"campus_id":   campusID,
			"ride_id":     input.RideID,
			"reported_by": reportedBy,
		},
	})

	if inc.Severity == "critical" || inc.Severity == "high" {
		_ = s.kafka.Publish(ctx, "nexus.notifications.urgent", inc.ID.String(), internalKafka.Event{
			Type: "nexus.notifications.urgent",
			Payload: map[string]interface{}{
				"title":   fmt.Sprintf("🚨 %s Incident: %s", inc.Severity, inc.Title),
				"body":    inc.Description,
				"channel": "admin",
				"data":    map[string]interface{}{"incident_id": inc.ID, "type": "incident"},
			},
		})
	}

	s.logger.Info("incident reported",
		zap.String("id", inc.ID.String()),
		zap.String("type", inc.Type),
		zap.String("severity", inc.Severity),
	)
	return inc, nil
}

// GetIncident returns an incident by ID.
func (s *Service) GetIncident(ctx context.Context, id uuid.UUID) (*Incident, error) {
	return s.repo.GetIncidentByID(ctx, id)
}

// ListIncidents returns filtered incidents.
func (s *Service) ListIncidents(ctx context.Context, status, severity, incType *string, campusID *uuid.UUID, limit int) ([]Incident, error) {
	return s.repo.ListIncidents(ctx, status, severity, incType, campusID, limit)
}

// UpdateIncident patches fields.
func (s *Service) UpdateIncident(ctx context.Context, id uuid.UUID, in UpdateIncidentInput) (*Incident, error) {
	return s.repo.UpdateIncident(ctx, id, in)
}

// ResolveIncident resolves an incident.
func (s *Service) ResolveIncident(ctx context.Context, id, resolvedBy uuid.UUID, note, resolutionType string) error {
	if err := s.repo.ResolveIncident(ctx, id, resolvedBy, note, resolutionType); err != nil {
		return err
	}
	_ = s.kafka.Publish(ctx, "rides.incident.resolved", id.String(), internalKafka.Event{
		Type: "rides.incident.resolved",
		Payload: map[string]interface{}{
			"incident_id":     id,
			"resolved_by":     resolvedBy,
			"resolution_type": resolutionType,
		},
	})
	return nil
}

// EscalateIncident escalates an incident.
func (s *Service) EscalateIncident(ctx context.Context, id, escalatedTo uuid.UUID, reason string) error {
	if err := s.repo.EscalateIncident(ctx, id, escalatedTo, reason); err != nil {
		return err
	}
	_ = s.kafka.Publish(ctx, "rides.incident.escalated", id.String(), internalKafka.Event{
		Type: "rides.incident.escalated",
		Payload: map[string]interface{}{
			"incident_id": id,
			"escalated_to": escalatedTo,
			"reason": reason,
		},
	})
	return nil
}

// DismissIncident dismisses an incident.
func (s *Service) DismissIncident(ctx context.Context, id uuid.UUID, reason string, dismissedBy uuid.UUID) error {
	return s.repo.DismissIncident(ctx, id, reason, dismissedBy)
}

// GetSafetyDashboard returns comprehensive safety metrics.
func (s *Service) GetSafetyDashboard(ctx context.Context, campusID *uuid.UUID) (*SafetyDashboard, error) {
	dash, err := s.repo.GetDashboardStats(ctx, campusID)
	if err != nil {
		return nil, err
	}
	if campusID != nil {
		dash.SafetyScore, _ = s.repo.GetSafetyScore(ctx, *campusID)
	} else {
		dash.SafetyScore = 95.0
	}
	dash.TrendData, _ = s.repo.GetTrendData(ctx, campusID)
	dash.RecentIncidents, _ = s.repo.GetRecentIncidents(ctx, 10)
	return dash, nil
}

// GetSafetyScore returns the safety score for a campus.
func (s *Service) GetSafetyScore(ctx context.Context, campusID uuid.UUID) (float64, error) {
	return s.repo.GetSafetyScore(ctx, campusID)
}

// GetProtocols returns safety protocols.
func (s *Service) GetProtocols(ctx context.Context, campusID *uuid.UUID, category *string) ([]SafetyProtocol, error) {
	return s.repo.GetProtocols(ctx, campusID, category)
}

// CountForRide returns the open incident count.
func (s *Service) CountForRide(ctx context.Context, rideID uuid.UUID) (int, error) {
	return s.repo.CountOpenForRide(ctx, rideID)
}

// SLAOverdue returns the global SLA overdue count.
func (s *Service) SLAOverdue(ctx context.Context) (int, error) {
	return s.repo.SLAOverdue(ctx)
}

// DriverSafetySummary returns aggregated safety metrics for a driver.
type DriverSafetySummary struct {
	DriverID       uuid.UUID `json:"driver_id"`
	TotalIncidents int       `json:"total_incidents"`
	OpenIncidents  int       `json:"open_incidents"`
	Resolved       int       `json:"resolved"`
	SOSCount       int       `json:"sos_count"`
	SafetyScore    float64   `json:"safety_score"`
	LastIncident   *time.Time `json:"last_incident_at,omitempty"`
}

// DriverSafety computes the safety record for a driver.
func (s *Service) DriverSafety(ctx context.Context, driverID uuid.UUID) (*DriverSafetySummary, error) {
	out := &DriverSafetySummary{DriverID: driverID}
	err := s.pool.QueryRow(ctx, `
		SELECT
		    COUNT(*),
		    COUNT(*) FILTER (WHERE status NOT IN ('resolved','dismissed')),
		    COUNT(*) FILTER (WHERE status = 'resolved')
		FROM ride_incidents i
		JOIN ride_requests r ON r.id = i.ride_id
		WHERE r.driver_id = $1`, driverID).Scan(&out.TotalIncidents, &out.OpenIncidents, &out.Resolved)
	if err != nil {
		return nil, err
	}
	s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM ride_sos_events e
		JOIN ride_requests r ON r.id = e.ride_id
		WHERE r.driver_id = $1`, driverID).Scan(&out.SOSCount)
	s.pool.QueryRow(ctx, `
		SELECT MAX(i.created_at) FROM ride_incidents i
		JOIN ride_requests r ON r.id = i.ride_id
		WHERE r.driver_id = $1`, driverID).Scan(&out.LastIncident)

	if out.TotalIncidents == 0 {
		out.SafetyScore = 100
	} else {
		score := 100.0
		score -= float64(out.OpenIncidents) * 5
		score -= float64(out.SOSCount) * 3
		if score < 0 {
			score = 0
		}
		out.SafetyScore = score
	}
	return out, nil
}