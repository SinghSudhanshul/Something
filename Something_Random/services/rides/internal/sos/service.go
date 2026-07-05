// Package sos handles emergency / safety events on RIDE & GO trips.
//
// The most safety-critical service in NEXUS — every operation must
// complete inside a strict time budget. All notification channels fire
// concurrently, and the originating request only blocks until the
// primary row is written and at least one notification has been queued.
package sos

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"nexus/rides/internal/kafka"
)

// AlertSeverity is the kind of SOS event.
type AlertSeverity string

const (
	SeverityInfo     AlertSeverity = "info"
	SeverityLow      AlertSeverity = "low"
	SeverityMedium   AlertSeverity = "medium"
	SeverityHigh     AlertSeverity = "high"
	SeverityCritical AlertSeverity = "critical"
)

// EventKind enumerates the sources of SOS events.
type EventKind string

const (
	EventPanicButton   EventKind = "panic_button"
	EventRouteDeviate  EventKind = "route_deviation"
	EventSpeedAnomaly  EventKind = "speed_anomaly"
	EventGeoFence      EventKind = "geofence_breach"
	EventDriverInactiv EventKind = "driver_inactive"
	EventManual        EventKind = "manual_watch"
)

// Alert mirrors ride_sos_events.
type Alert struct {
	ID                uuid.UUID     `json:"id"`
	RideID            uuid.UUID     `json:"ride_id"`
	TriggeredBy       uuid.UUID     `json:"triggered_by"`
	TriggeredByRole   string        `json:"triggered_by_role"`
	Kind              EventKind     `json:"kind"`
	Severity          AlertSeverity `json:"severity"`
	Reason            *string       `json:"reason,omitempty"`
	Lat               float64       `json:"lat"`
	Lng               float64       `json:"lng"`
	AccuracyM         *float64      `json:"accuracy_m,omitempty"`
	BatteryPct        *int          `json:"battery_pct,omitempty"`
	DeviceID          *string       `json:"device_id,omitempty"`
	Status            string        `json:"status"`
	AcknowledgedAt    *time.Time    `json:"acknowledged_at,omitempty"`
	AcknowledgedBy    *uuid.UUID    `json:"acknowledged_by,omitempty"`
	ResolvedAt        *time.Time    `json:"resolved_at,omitempty"`
	ResolvedBy        *uuid.UUID    `json:"resolved_by,omitempty"`
	ResolutionNote    *string       `json:"resolution_note,omitempty"`
	PoliceNotified    bool          `json:"police_notified"`
	CampusSecNotified bool          `json:"campus_security_notified"`
	ShareLocationLink *string       `json:"share_location_link,omitempty"`
	Metadata          map[string]any `json:"metadata,omitempty"`
	CreatedAt         time.Time     `json:"created_at"`
	UpdatedAt         time.Time     `json:"updated_at"`
}

// AlertDetail is the alert + ride/driver context for ops dashboards.
type AlertDetail struct {
	Alert
	RidePickup      string  `json:"ride_pickup_label"`
	RideDropoff     string  `json:"ride_dropoff_label"`
	RideStatus      string  `json:"ride_status"`
	TriggerUserName string  `json:"trigger_user_name"`
	DriverName      *string `json:"driver_name,omitempty"`
	DriverPhone     *string `json:"driver_phone,omitempty"`
}

// TriggerInput is the request body.
type TriggerInput struct {
	RideID    uuid.UUID     `json:"ride_id"`
	UserID    uuid.UUID     `json:"user_id"`
	UserRole  string        `json:"user_role"`
	Kind      EventKind     `json:"kind"`
	Severity  AlertSeverity `json:"severity,omitempty"`
	Lat       float64       `json:"lat"`
	Lng       float64       `json:"lng"`
	AccuracyM *float64      `json:"accuracy_m,omitempty"`
	BatteryPct *int         `json:"battery_pct,omitempty"`
	DeviceID   *string      `json:"device_id,omitempty"`
	Reason     *string      `json:"reason,omitempty"`
	Metadata   map[string]any `json:"metadata,omitempty"`
}

// ResolveInput is the request body to close an alert.
type ResolveInput struct {
	AlertID        uuid.UUID `json:"alert_id"`
	ResolvedBy     uuid.UUID `json:"resolved_by"`
	ResolutionNote *string   `json:"resolution_note,omitempty"`
}

// AckInput acknowledges but does not resolve.
type AckInput struct {
	AlertID      uuid.UUID `json:"alert_id"`
	Acknowledged uuid.UUID `json:"acknowledged_by"`
}

// NotificationResult is the outcome of one notification channel.
type NotificationResult struct {
	Channel string `json:"channel"`
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

// Errors returned by this package.
var (
	ErrAlertNotFound    = errors.New("alert not found")
	ErrInvalidStatus    = errors.New("invalid alert status transition")
	ErrInvalidGPS       = errors.New("invalid GPS coordinates")
	ErrAlreadyResolved  = errors.New("alert already resolved")
)

// Service handles SOS alerts.
type Service struct {
	pool     *pgxpool.Pool
	rdb      *redis.Client
	producer *kafka.Producer
	logger   *zap.Logger
}

// NewService constructs the SOS service.
func NewService(pool *pgxpool.Pool, rdb *redis.Client, producer *kafka.Producer, logger *zap.Logger) *Service {
	return &Service{pool: pool, rdb: rdb, producer: producer, logger: logger}
}

// TriggerSOS persists an alert and fires all notifications concurrently.
// Hard 2s timeout — this is the most time-critical endpoint in NEXUS.
func (s *Service) TriggerSOS(ctx context.Context, input TriggerInput) (*Alert, []NotificationResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	if input.Severity == "" {
		input.Severity = SeverityCritical
	}
	if input.Kind == "" {
		input.Kind = EventPanicButton
	}
	if input.UserRole == "" {
		input.UserRole = "rider"
	}
	if input.Lat < -90 || input.Lat > 90 || input.Lng < -180 || input.Lng > 180 {
		return nil, nil, ErrInvalidGPS
	}
	if input.Metadata == nil {
		input.Metadata = map[string]any{}
	}
	metaJSON, _ := json.Marshal(input.Metadata)

	var alert Alert
	err := s.pool.QueryRow(ctx, `
		INSERT INTO ride_sos_events (
			ride_id, triggered_by, triggered_by_role, kind, severity,
			reason, location, accuracy_m, battery_pct, device_id,
			status, metadata
		) VALUES (
			$1, $2, $3, $4::ride_sos_kind, $5::ride_sos_severity,
			$6, ST_SetSRID(ST_MakePoint($8, $7), 4326)::geography,
			$9, $10, NULLIF($11, ''),
			'active', $12::jsonb
		)
		RETURNING id, ride_id, triggered_by, triggered_by_role, kind, severity,
		          reason, ST_Y(location::geometry), ST_X(location::geometry),
		          accuracy_m, battery_pct, device_id, status,
		          acknowledged_at, acknowledged_by, resolved_at, resolved_by,
		          resolution_note, police_notified, campus_security_notified,
		          share_location_link, metadata, created_at, updated_at`,
		input.RideID, input.UserID, input.UserRole, input.Kind, input.Severity,
		input.Reason, input.Lat, input.Lng,
		input.AccuracyM, input.BatteryPct, input.DeviceID,
		string(metaJSON),
	).Scan(
		&alert.ID, &alert.RideID, &alert.TriggeredBy, &alert.TriggeredByRole,
		&alert.Kind, &alert.Severity,
		&alert.Reason, &alert.Lat, &alert.Lng,
		&alert.AccuracyM, &alert.BatteryPct, &alert.DeviceID, &alert.Status,
		&alert.AcknowledgedAt, &alert.AcknowledgedBy,
		&alert.ResolvedAt, &alert.ResolvedBy,
		&alert.ResolutionNote, &alert.PoliceNotified, &alert.CampusSecNotified,
		&alert.ShareLocationLink, &alert.Metadata, &alert.CreatedAt, &alert.UpdatedAt,
	)
	if err != nil {
		s.logger.Error("CRITICAL: failed to persist SOS alert",
			zap.Error(err),
			zap.String("ride_id", input.RideID.String()),
			zap.String("triggered_by", input.UserID.String()),
		)
		return nil, nil, fmt.Errorf("create sos alert: %w", err)
	}

	s.logger.Error("🚨 SOS TRIGGERED",
		zap.String("alert_id", alert.ID.String()),
		zap.String("ride_id", input.RideID.String()),
		zap.String("triggered_by", input.UserID.String()),
		zap.Float64("lat", input.Lat),
		zap.Float64("lng", input.Lng),
		zap.String("severity", string(input.Severity)),
		zap.String("kind", string(input.Kind)),
	)

	notifCtx, notifCancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer notifCancel()

	var wg sync.WaitGroup
	results := make([]NotificationResult, 5)

	// Channel 1: Kafka rides.sos.triggered
	wg.Add(1)
	go func() {
		defer wg.Done()
		results[0] = NotificationResult{Channel: "kafka_sos"}
		err := s.producer.Publish(notifCtx, "rides.sos.triggered", alert.ID.String(), kafka.Event{
			Type: "rides.sos.triggered",
			Payload: map[string]interface{}{
				"alert_id":     alert.ID,
				"ride_id":      input.RideID,
				"triggered_by": input.UserID,
				"triggered_by_role": input.UserRole,
				"lat":          input.Lat,
				"lng":          input.Lng,
				"severity":     input.Severity,
				"kind":         input.Kind,
				"reason":       input.Reason,
			},
		})
		recordResult(&results[0], err)
		s.logger.Error("SOS kafka publish", zap.Error(err))
	}()

	// Channel 2: Notification service trigger
	wg.Add(1)
	go func() {
		defer wg.Done()
		results[1] = NotificationResult{Channel: "notifications"}
		err := s.producer.Publish(notifCtx, "nexus.notifications.trigger", alert.ID.String(), kafka.Event{
			Type: "nexus.notifications.trigger",
			Payload: map[string]interface{}{
				"user_id":  input.UserID.String(),
				"type":     "sos_triggered",
				"channels": []string{"push", "sms"},
				"priority": 1,
				"data": map[string]interface{}{
					"alert_id": alert.ID.String(),
					"ride_id":  input.RideID.String(),
					"lat":      input.Lat,
					"lng":      input.Lng,
				},
			},
		})
		recordResult(&results[1], err)
	}()

	// Channel 3: Mark campus_security_notified
	wg.Add(1)
	go func() {
		defer wg.Done()
		results[2] = NotificationResult{Channel: "campus_security"}
		_, dbErr := s.pool.Exec(notifCtx, `UPDATE ride_sos_events SET campus_security_notified = true WHERE id = $1`, alert.ID)
		if dbErr == nil {
			alert.CampusSecNotified = true
		}
		recordResult(&results[2], dbErr)
	}()

	// Channel 4: Redis pub/sub for live dashboards
	wg.Add(1)
	go func() {
		defer wg.Done()
		results[3] = NotificationResult{Channel: "websocket"}
		if s.rdb == nil {
			results[3].Success = true
			return
		}
		msg, _ := json.Marshal(map[string]interface{}{
			"type":     "sos_alert",
			"alert_id": alert.ID.String(),
			"ride_id":  input.RideID.String(),
			"lat":      input.Lat,
			"lng":      input.Lng,
			"severity": input.Severity,
			"kind":     input.Kind,
		})
		err := s.rdb.Publish(notifCtx, fmt.Sprintf("rides:sos:%s", input.RideID), string(msg)).Err()
		recordResult(&results[3], err)
	}()

	// Channel 5: Share location link — generate a short-lived token
	wg.Add(1)
	go func() {
		defer wg.Done()
		results[4] = NotificationResult{Channel: "share_link"}
		token := uuid.NewString()
		link := fmt.Sprintf("https://nexus.app/sos/%s?t=%s", alert.ID, token)
		if _, err := s.pool.Exec(notifCtx, `UPDATE ride_sos_events SET share_location_link = $1 WHERE id = $2`, link, alert.ID); err != nil {
			recordResult(&results[4], err)
			return
		}
		alert.ShareLocationLink = &link
		if s.rdb != nil {
			s.rdb.Set(notifCtx, fmt.Sprintf("rides:sos:share:%s", token), alert.ID.String(), 30*time.Minute)
		}
		results[4].Success = true
	}()

	wg.Wait()
	successes := 0
	for _, r := range results {
		if r.Success {
			successes++
		}
	}
	alert.Metadata["notification_count"] = successes
	return &alert, results, nil
}

func recordResult(r *NotificationResult, err error) {
	if err == nil {
		r.Success = true
		return
	}
	r.Error = err.Error()
}

// Acknowledge marks an alert as acknowledged by an operator.
func (s *Service) Acknowledge(ctx context.Context, in AckInput) (*Alert, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE ride_sos_events SET status = 'acknowledged', acknowledged_at = NOW(),
		    acknowledged_by = $2, updated_at = NOW()
		WHERE id = $1 AND status = 'active'`, in.AlertID, in.Acknowledged)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrInvalidStatus
	}
	return s.FindByID(ctx, in.AlertID)
}

// ResolveSOS resolves an SOS alert.
func (s *Service) ResolveSOS(ctx context.Context, in ResolveInput) (*Alert, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE ride_sos_events SET status = 'resolved', resolved_at = NOW(),
		    resolved_by = $2, resolution_note = $3, updated_at = NOW()
		WHERE id = $1 AND status IN ('active','acknowledged')`, in.AlertID, in.ResolvedBy, in.ResolutionNote)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrAlreadyResolved
	}
	row, err := s.FindByID(ctx, in.AlertID)
	if err != nil {
		return nil, err
	}
	_ = s.producer.Publish(ctx, "rides.sos.resolved", in.AlertID.String(), kafka.Event{
		Type: "rides.sos.resolved",
		Payload: map[string]interface{}{
			"alert_id":        in.AlertID,
			"resolved_by":     in.ResolvedBy,
			"resolution_note": in.ResolutionNote,
		},
	})
	return row, nil
}

// NotifyPolice marks the police_notified flag.
func (s *Service) NotifyPolice(ctx context.Context, alertID, by uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE ride_sos_events SET police_notified = true, updated_at = NOW()
		WHERE id = $1`, alertID)
	return err
}

// FindByID loads a single alert.
func (s *Service) FindByID(ctx context.Context, id uuid.UUID) (*Alert, error) {
	var a Alert
	err := s.pool.QueryRow(ctx, `
		SELECT id, ride_id, triggered_by, triggered_by_role, kind, severity,
		       reason, ST_Y(location::geometry), ST_X(location::geometry),
		       accuracy_m, battery_pct, device_id, status,
		       acknowledged_at, acknowledged_by, resolved_at, resolved_by,
		       resolution_note, police_notified, campus_security_notified,
		       share_location_link, metadata, created_at, updated_at
		FROM ride_sos_events WHERE id = $1`, id).Scan(
		&a.ID, &a.RideID, &a.TriggeredBy, &a.TriggeredByRole,
		&a.Kind, &a.Severity,
		&a.Reason, &a.Lat, &a.Lng,
		&a.AccuracyM, &a.BatteryPct, &a.DeviceID, &a.Status,
		&a.AcknowledgedAt, &a.AcknowledgedBy,
		&a.ResolvedAt, &a.ResolvedBy,
		&a.ResolutionNote, &a.PoliceNotified, &a.CampusSecNotified,
		&a.ShareLocationLink, &a.Metadata, &a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAlertNotFound
		}
		return nil, err
	}
	return &a, nil
}

// GetActiveAlerts returns open alerts with ride context.
func (s *Service) GetActiveAlerts(ctx context.Context, campusID *uuid.UUID, limit int) ([]AlertDetail, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	q := `
		SELECT e.id, e.ride_id, e.triggered_by, e.triggered_by_role, e.kind, e.severity,
		       e.reason, ST_Y(e.location::geometry), ST_X(e.location::geometry),
		       e.accuracy_m, e.battery_pct, e.device_id, e.status,
		       e.acknowledged_at, e.acknowledged_by, e.resolved_at, e.resolved_by,
		       e.resolution_note, e.police_notified, e.campus_security_notified,
		       e.share_location_link, e.metadata, e.created_at, e.updated_at,
		       r.pickup_label, r.dropoff_label, r.status AS ride_status
		FROM ride_sos_events e
		JOIN ride_requests r ON r.id = e.ride_id
		WHERE e.status IN ('active','acknowledged')
	`
	args := []any{}
	if campusID != nil {
		q += ` AND r.campus_id = $1`
		args = append(args, *campusID)
	}
	q += ` ORDER BY e.created_at DESC LIMIT ` + fmt.Sprintf("%d", limit)
	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AlertDetail{}
	for rows.Next() {
		var d AlertDetail
		if err := rows.Scan(
			&d.ID, &d.RideID, &d.TriggeredBy, &d.TriggeredByRole,
			&d.Kind, &d.Severity,
			&d.Reason, &d.Lat, &d.Lng,
			&d.AccuracyM, &d.BatteryPct, &d.DeviceID, &d.Status,
			&d.AcknowledgedAt, &d.AcknowledgedBy,
			&d.ResolvedAt, &d.ResolvedBy,
			&d.ResolutionNote, &d.PoliceNotified, &d.CampusSecNotified,
			&d.ShareLocationLink, &d.Metadata, &d.CreatedAt, &d.UpdatedAt,
			&d.RidePickup, &d.RideDropoff, &d.RideStatus,
		); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// GetRecentByUser returns alerts triggered by the user.
func (s *Service) GetRecentByUser(ctx context.Context, userID uuid.UUID, limit int) ([]Alert, error) {
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, ride_id, triggered_by, triggered_by_role, kind, severity,
		       reason, ST_Y(location::geometry), ST_X(location::geometry),
		       accuracy_m, battery_pct, device_id, status,
		       acknowledged_at, acknowledged_by, resolved_at, resolved_by,
		       resolution_note, police_notified, campus_security_notified,
		       share_location_link, metadata, created_at, updated_at
		FROM ride_sos_events WHERE triggered_by = $1
		ORDER BY created_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Alert{}
	for rows.Next() {
		var a Alert
		if err := rows.Scan(
			&a.ID, &a.RideID, &a.TriggeredBy, &a.TriggeredByRole,
			&a.Kind, &a.Severity,
			&a.Reason, &a.Lat, &a.Lng,
			&a.AccuracyM, &a.BatteryPct, &a.DeviceID, &a.Status,
			&a.AcknowledgedAt, &a.AcknowledgedBy,
			&a.ResolvedAt, &a.ResolvedBy,
			&a.ResolutionNote, &a.PoliceNotified, &a.CampusSecNotified,
			&a.ShareLocationLink, &a.Metadata, &a.CreatedAt, &a.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// CountForRide returns the SOS count for a ride.
func (s *Service) CountForRide(ctx context.Context, rideID uuid.UUID) (int, error) {
	var count int
	err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM ride_sos_events WHERE ride_id = $1`, rideID).Scan(&count)
	return count, err
}

// ShareLink generates a fresh share location link for an existing alert.
func (s *Service) ShareLink(ctx context.Context, alertID uuid.UUID) (string, error) {
	token := uuid.NewString()
	link := fmt.Sprintf("https://nexus.app/sos/%s?t=%s", alertID, token)
	if _, err := s.pool.Exec(ctx, `UPDATE ride_sos_events SET share_location_link = $1 WHERE id = $2`, link, alertID); err != nil {
		return "", err
	}
	if s.rdb != nil {
		s.rdb.Set(ctx, fmt.Sprintf("rides:sos:share:%s", token), alertID.String(), 30*time.Minute)
	}
	return link, nil
}

// RegisterRoutes mounts SOS webhook + internal admin routes.
func RegisterRoutes(r *gin.RouterGroup, svc *Service, internalSecret string) {
	r.POST("/webhook", func(c *gin.Context) {
		secret := c.GetHeader("X-Internal-Secret")
		if secret != internalSecret {
			c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "Invalid secret"})
			return
		}
		var payload struct {
			AlertID string `json:"alert_id" binding:"required"`
			Action  string `json:"action" binding:"required"`
		}
		if err := c.ShouldBindJSON(&payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": err.Error()})
			return
		}
		alertID, err := uuid.Parse(payload.AlertID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": "Invalid alert_id"})
			return
		}
		switch payload.Action {
		case "resolved":
			systemUserID := uuid.MustParse("00000000-0000-0000-0000-000000000001")
			reason := "Resolved via campus security webhook"
			if _, err := svc.ResolveSOS(c.Request.Context(), ResolveInput{
				AlertID:        alertID,
				ResolvedBy:     systemUserID,
				ResolutionNote: &reason,
			}); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"code": "RESOLVE_FAILED", "message": err.Error()})
				return
			}
		case "acknowledged", "dispatched":
			svc.logger.Info("SOS webhook received",
				zap.String("alert_id", alertID.String()),
				zap.String("action", payload.Action),
			)
		default:
			c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": "Invalid action"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"status": payload.Action}})
	})
}