package payment

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"

	"nexus/rides/internal/kafka"
)

// Service orchestrates the payment flow: creates the row, calls the
// gateway, applies webhooks, manages COD OTP, and refunds.
type Service struct {
	repo     *Repository
	rdb      *redis.Client
	producer *kafka.Producer
	logger   *zap.Logger
}

// NewService constructs a service.
func NewService(repo *Repository, rdb *redis.Client, producer *kafka.Producer, logger *zap.Logger) *Service {
	return &Service{repo: repo, rdb: rdb, producer: producer, logger: logger}
}

// Authorize is the initial gateway authorization (UPI / Card / etc).
func (s *Service) Authorize(ctx context.Context, in CreatePaymentInput, gatewayPaymentID string) (*PaymentRow, error) {
	if !validMethod(in.Method) {
		return nil, fmt.Errorf("invalid payment method: %s", in.Method)
	}
	if in.Total.LessThanOrEqual(decimal.Zero) {
		return nil, errors.New("payment total must be positive")
	}
	row, err := s.repo.Create(ctx, in)
	if err != nil {
		return nil, err
	}
	if err := s.repo.MarkAuthorized(ctx, row.ID, gatewayPaymentID); err != nil {
		return nil, err
	}
	row.Status = "authorized"
	if gatewayPaymentID != "" {
		row.GatewayPaymentID = &gatewayPaymentID
	}
	_ = s.producer.Publish(ctx, "rides.payment.authorized", row.ID.String(), kafka.Event{
		Type: "rides.payment.authorized",
		Payload: map[string]interface{}{
			"payment_id":          row.ID,
			"ride_id":             row.RideID,
			"rider_id":            row.RiderID,
			"amount":              row.Total.String(),
			"gateway_payment_id":  gatewayPaymentID,
		},
	})
	return row, nil
}

// Capture is invoked when the gateway confirms settlement.
func (s *Service) Capture(ctx context.Context, paymentID uuid.UUID) (*PaymentRow, error) {
	if err := s.repo.MarkCaptured(ctx, paymentID); err != nil {
		return nil, err
	}
	row, err := s.repo.FindByID(ctx, paymentID)
	if err != nil {
		return nil, err
	}
	_ = s.producer.Publish(ctx, "rides.payment.captured", paymentID.String(), kafka.Event{
		Type: "rides.payment.captured",
		Payload: map[string]interface{}{
			"payment_id": paymentID,
			"ride_id":    row.RideID,
			"rider_id":   row.RiderID,
			"amount":     row.Total.String(),
			"method":     row.Method,
		},
	})
	return row, nil
}

// MarkFailed flips a pending authorization to failed.
func (s *Service) MarkFailed(ctx context.Context, paymentID uuid.UUID, reason string) error {
	if err := s.repo.MarkFailed(ctx, paymentID, reason); err != nil {
		return err
	}
	row, err := s.repo.FindByID(ctx, paymentID)
	if err != nil {
		return err
	}
	_ = s.producer.Publish(ctx, "rides.payment.failed", paymentID.String(), kafka.Event{
		Type: "rides.payment.failed",
		Payload: map[string]interface{}{
			"payment_id": paymentID,
			"reason":     reason,
		},
	})
	return nil
}

// Refund performs a refund.
func (s *Service) Refund(ctx context.Context, paymentID uuid.UUID, amount decimal.Decimal, reason string) (*PaymentRow, error) {
	if amount.LessThan(decimal.Zero) {
		return nil, errors.New("refund amount cannot be negative")
	}
	if err := s.repo.Refund(ctx, paymentID, amount, reason); err != nil {
		return nil, err
	}
	row, err := s.repo.FindByID(ctx, paymentID)
	if err != nil {
		return nil, err
	}
	_ = s.producer.Publish(ctx, "rides.payment.refunded", paymentID.String(), kafka.Event{
		Type: "rides.payment.refunded",
		Payload: map[string]interface{}{
			"payment_id": paymentID,
			"amount":     amount.String(),
			"reason":     reason,
		},
	})
	return row, nil
}

// RequestCodOtp creates and returns the OTP for a COD ride.
func (s *Service) RequestCodOtp(ctx context.Context, rideID, riderID, driverID uuid.UUID) (string, *CodVerification, error) {
	otp, v, err := s.repo.CreateCodVerification(ctx, rideID, riderID, driverID, 10*time.Minute)
	if err != nil {
		return "", nil, err
	}
	_ = s.producer.Publish(ctx, "rides.payment.cod_verification_requested", rideID.String(), kafka.Event{
		Type: "rides.payment.cod_verification_requested",
		Payload: map[string]interface{}{
			"ride_id":   rideID,
			"rider_id":  riderID,
			"driver_id": driverID,
		},
	})
	return otp, v, nil
}

// VerifyCodOtp verifies the rider's OTP to release payment.
func (s *Service) VerifyCodOtp(ctx context.Context, rideID uuid.UUID, otp string) (*CodVerification, error) {
	v, err := s.repo.VerifyCod(ctx, rideID, otp)
	if err != nil {
		return nil, err
	}
	_ = s.producer.Publish(ctx, "rides.payment.cod_verification_completed", rideID.String(), kafka.Event{
		Type: "rides.payment.cod_verification_completed",
		Payload: map[string]interface{}{
			"ride_id": rideID,
			"status":  v.Status,
		},
	})
	return v, nil
}

// HandleGatewayWebhook processes a payment gateway webhook idempotently.
func (s *Service) HandleGatewayWebhook(ctx context.Context, gw GatewayWebhook) error {
	idemKey := fmt.Sprintf("rides:webhook:%s:%s", gw.GatewayOrderID, gw.Event)
	ok, err := s.rdb.SetNX(ctx, idemKey, time.Now().UTC().Format(time.RFC3339), 24*time.Hour).Result()
	if err != nil {
		return err
	}
	if !ok {
		s.logger.Info("duplicate webhook ignored", zap.String("key", idemKey))
		return nil
	}
	row, err := s.repo.FindByGatewayOrder(ctx, gw.GatewayOrderID)
	if err != nil {
		return err
	}
	switch gw.Event {
	case "authorized":
		return s.repo.MarkAuthorized(ctx, row.ID, gw.GatewayPaymentID)
	case "captured", "settled":
		return s.repo.MarkCaptured(ctx, row.ID)
	case "failed":
		return s.repo.MarkFailed(ctx, row.ID, "gateway_failed")
	default:
		s.logger.Warn("unknown webhook event", zap.String("event", gw.Event))
		return nil
	}
}

// HistoryByRider returns all payments for a rider within window.
func (s *Service) HistoryByRider(ctx context.Context, riderID uuid.UUID, limit int) ([]*PaymentRow, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.repo.pool.Query(ctx, `
		SELECT id, ride_id, rider_id, driver_id, amount, tax, tip, platform_fee, total,
		       method, status, gateway_order_id, gateway_payment_id, refund_amount,
		       refund_reason, refunded_at, cod_collected_at, cod_collected_by,
		       invoice_url, created_at, updated_at
		FROM ride_payments
		WHERE rider_id = $1
		ORDER BY created_at DESC LIMIT $2`, riderID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*PaymentRow{}
	for rows.Next() {
		var r PaymentRow
		if err := rows.Scan(
			&r.ID, &r.RideID, &r.RiderID, &r.DriverID,
			&r.Amount, &r.Tax, &r.Tip, &r.PlatformFee, &r.Total,
			&r.Method, &r.Status, &r.GatewayOrderID, &r.GatewayPaymentID,
			&r.RefundAmount, &r.RefundReason, &r.RefundedAt,
			&r.CODCollectedAt, &r.CODCollectedBy, &r.InvoiceURL,
			&r.CreatedAt, &r.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, &r)
	}
	return out, rows.Err()
}

// StatsByRider returns aggregate spending for a rider.
func (s *Service) StatsByRider(ctx context.Context, riderID uuid.UUID, since time.Time) (totalSpend decimal.Decimal, rideCount int, err error) {
	err = s.repo.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(total), 0)::text, COUNT(*)
		FROM ride_payments
		WHERE rider_id = $1 AND status IN ('captured','cod_collected') AND created_at >= $2`,
		riderID, since,
	).Scan(&totalSpend, &rideCount)
	if err != nil {
		return decimal.Zero, 0, err
	}
	return
}

// ---------- Internal helpers ----------

func validMethod(method string) bool {
	switch method {
	case "upi", "card", "wallet", "cod", "campus_card", "net_banking":
		return true
	}
	return false
}