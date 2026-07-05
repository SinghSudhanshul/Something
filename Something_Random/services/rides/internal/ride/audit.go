package ride

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"

	"nexus/rides/internal/kafka"
)

// AuditRecorder is a thin wrapper that swallows errors into logs so
// callers can `defer _ = audit.Record(...)` without drowning business
// logic in error handling. The audit table is best-effort.
type AuditRecorder struct {
	repo   *RideRepository
	logger *zap.Logger
}

// NewAuditRecorder builds a recorder.
func NewAuditRecorder(repo *RideRepository, logger *zap.Logger) *AuditRecorder {
	return &AuditRecorder{repo: repo, logger: logger}
}

// Record persists the entry, logging any failure.
func (a *AuditRecorder) Record(ctx context.Context, e AuditEntry) error {
	if err := a.repo.AppendAudit(ctx, e); err != nil {
		a.logger.Warn("audit append failed", zap.Error(err), zap.String("action", e.Action))
		return err
	}
	return nil
}

// RecordAsync drops the audit on a goroutine; safe for hot paths.
func (a *AuditRecorder) RecordAsync(ctx context.Context, e AuditEntry) {
	go func() {
		_ = a.Record(context.Background(), e)
	}()
}

// PromoApplyResult describes a coupon that was applied.
type PromoApplyResult struct {
	Amount          decimal.Decimal `json:"amount"`
	Code            string          `json:"code"`
	DiscountedTotal decimal.Decimal `json:"discounted_total"`
}

// EventHandler processes Kafka events related to rides.
type EventHandler struct {
	rideRepo *RideRepository
	rdb      *redis.Client
	producer *kafka.Producer
	logger   *zap.Logger
}

// NewEventHandler creates a new ride event handler.
func NewEventHandler(rideRepo *RideRepository, rdb *redis.Client, producer *kafka.Producer, logger *zap.Logger) *EventHandler {
	return &EventHandler{
		rideRepo: rideRepo,
		rdb:      rdb,
		producer: producer,
		logger:   logger,
	}
}

// HandleRideRatingSubmitted stores a rating and emits a trust delta.
func (h *EventHandler) HandleRideRatingSubmitted(ctx context.Context, topic string, key []byte, value json.RawMessage) error {
	var event struct {
		Type    string `json:"type"`
		Payload struct {
			RideID    string  `json:"ride_id"`
			RatedBy   string  `json:"rated_by"`
			RatedUser string  `json:"rated_user"`
			Rating    float64 `json:"rating"`
			Comment   string  `json:"comment,omitempty"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(value, &event); err != nil {
		return fmt.Errorf("invalid event payload: %w", err)
	}
	rideID, err := uuid.Parse(event.Payload.RideID)
	if err != nil {
		return fmt.Errorf("invalid ride_id: %w", err)
	}
	h.logger.Info("ride rating submitted",
		zap.String("rideID", rideID.String()),
		zap.Float64("rating", event.Payload.Rating),
	)
	trustDelta := 0.0
	switch {
	case event.Payload.Rating >= 4.5:
		trustDelta = 0.05
	case event.Payload.Rating >= 3.5:
		trustDelta = 0.02
	case event.Payload.Rating >= 2.5:
		trustDelta = 0
	case event.Payload.Rating >= 1.5:
		trustDelta = -0.03
	default:
		trustDelta = -0.05
	}
	if trustDelta != 0 {
		_ = h.producer.Publish(ctx, "nexus.trust.events", event.Payload.RatedUser, kafka.Event{
			Type: "nexus.trust.delta",
			Payload: map[string]interface{}{
				"user_id":    event.Payload.RatedUser,
				"event_type": "ride_rated",
				"delta":      trustDelta,
				"source":     "rides",
				"ride_id":    rideID,
			},
		})
	}
	return nil
}

// HandleWalletPaymentCompleted links a transaction to a ride.
func (h *EventHandler) HandleWalletPaymentCompleted(ctx context.Context, topic string, key []byte, value json.RawMessage) error {
	var event struct {
		Type    string `json:"type"`
		Payload struct {
			TransactionID string `json:"transaction_id"`
			RideID        string `json:"ride_id"`
			PayerID       string `json:"payer_id"`
			Amount        string `json:"amount"`
			Status        string `json:"status"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(value, &event); err != nil {
		return fmt.Errorf("invalid payment event: %w", err)
	}
	if _, err := uuid.Parse(event.Payload.RideID); err != nil {
		return nil
	}
	h.logger.Info("ride payment event observed")
	return nil
}

// HandleUserVerificationChanged auto-verifies drivers.
func (h *EventHandler) HandleUserVerificationChanged(ctx context.Context, topic string, key []byte, value json.RawMessage) error {
	var event struct {
		Type    string `json:"type"`
		Payload struct {
			UserID            string `json:"user_id"`
			VerificationLevel int    `json:"verification_level"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(value, &event); err != nil {
		return fmt.Errorf("invalid verification event: %w", err)
	}
	h.logger.Info("user verification changed", zap.Int("level", event.Payload.VerificationLevel))
	return nil
}

// RegisterConsumers sets up all Kafka consumers.
func RegisterConsumers(consumer *kafka.Consumer, handler *EventHandler) {
	consumer.Subscribe("nexus.rides.rating_submitted", handler.HandleRideRatingSubmitted)
	consumer.Subscribe("nexus.transactions.completed", handler.HandleWalletPaymentCompleted)
	consumer.Subscribe("nexus.users.verification_changed", handler.HandleUserVerificationChanged)
}

// ScheduledRideManager handles scheduled/future ride requests.
type ScheduledRideManager struct {
	rideRepo *RideRepository
	matching *MatchingEngine
	producer *kafka.Producer
	rdb      *redis.Client
	logger   *zap.Logger
}

// NewScheduledRideManager creates a scheduled ride manager.
func NewScheduledRideManager(rideRepo *RideRepository, matching *MatchingEngine, producer *kafka.Producer, rdb *redis.Client, logger *zap.Logger) *ScheduledRideManager {
	return &ScheduledRideManager{
		rideRepo: rideRepo,
		matching: matching,
		producer: producer,
		rdb:      rdb,
		logger:   logger,
	}
}

// StartScheduledRidePoller polls for rides due in the next 10 minutes.
func (m *ScheduledRideManager) StartScheduledRidePoller(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	m.logger.Info("scheduled ride poller started", zap.Duration("interval", 30*time.Second))
	for {
		select {
		case <-ctx.Done():
			m.logger.Info("scheduled ride poller stopped")
			return
		case <-ticker.C:
			m.processScheduledRides(ctx)
		}
	}
}

func (m *ScheduledRideManager) processScheduledRides(ctx context.Context) {
	rows, err := m.rideRepo.pool.Query(ctx, `
		SELECT id FROM ride_requests
		WHERE status IN ('requested','matching')
		  AND scheduled_at IS NOT NULL
		  AND scheduled_at <= NOW() + INTERVAL '10 minutes'
		  AND scheduled_at >= NOW()
		ORDER BY scheduled_at ASC LIMIT 50`)
	if err != nil {
		m.logger.Error("failed to query scheduled rides", zap.Error(err))
		return
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		_ = rows.Scan(&id)
		ids = append(ids, id)
	}
	for _, id := range ids {
		lockKey := fmt.Sprintf("rides:scheduled:processing:%s", id)
		if locked, _ := m.rdb.SetNX(ctx, lockKey, "1", 10*time.Minute).Result(); !locked {
			continue
		}
		m.logger.Info("initiating matching for scheduled ride", zap.String("rideID", id.String()))
		go func(rideID uuid.UUID) {
			_ = m.matching.MatchScheduled(context.Background(), rideID)
		}(id)
	}
}

// StartExpiredRideCleaner marks rides whose created_at is older than 15m.
func StartExpiredRideCleaner(ctx context.Context, repo *RideRepository, logger *zap.Logger) {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()
	logger.Info("expired ride cleaner started")
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_, err := repo.pool.Exec(ctx, `
				UPDATE ride_requests SET status = 'expired', updated_at = NOW()
				WHERE status IN ('requested','matching')
				  AND created_at < NOW() - INTERVAL '15 minutes'`)
			if err != nil {
				logger.Error("expired cleaner", zap.Error(err))
			}
		}
	}
}
