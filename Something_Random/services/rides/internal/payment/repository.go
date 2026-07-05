package payment

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"
)

// Errors returned by this package.
var (
	ErrPaymentNotFound = errors.New("payment not found")
	ErrInvalidStatus   = errors.New("invalid payment status transition")
	ErrAlreadyRefunded = errors.New("payment already refunded")
	ErrCodNotFound     = errors.New("cod verification not found")
	ErrCodExpired      = errors.New("cod verification expired")
	ErrCodMaxAttempts  = errors.New("cod verification max attempts exceeded")
	ErrCodAlreadyDone  = errors.New("cod verification already completed")
)

// Repository handles payment persistence.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository builds a repo.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

// Create persists a payment row.
func (r *Repository) Create(ctx context.Context, in CreatePaymentInput) (*PaymentRow, error) {
	var row PaymentRow
	gatewayOrder := nilIfEmpty(in.GatewayOrderID)
	err := r.pool.QueryRow(ctx, `
		INSERT INTO ride_payments (
			ride_id, rider_id, driver_id, amount, tax, tip, platform_fee, total,
			method, status, gateway_order_id
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::ride_payment_method, 'pending', NULLIF($10, ''))
		RETURNING id, ride_id, rider_id, driver_id, amount, tax, tip, platform_fee, total,
		          method, status, gateway_order_id, gateway_payment_id, refund_amount,
		          refund_reason, refunded_at, cod_collected_at, cod_collected_by,
		          invoice_url, created_at, updated_at`,
		in.RideID, in.RiderID, in.DriverID,
		in.Amount.String(), in.Tax.String(), in.Tip.String(), in.PlatformFee.String(), in.Total.String(),
		in.Method, gatewayOrder,
	).Scan(
		&row.ID, &row.RideID, &row.RiderID, &row.DriverID,
		&row.Amount, &row.Tax, &row.Tip, &row.PlatformFee, &row.Total,
		&row.Method, &row.Status, &row.GatewayOrderID, &row.GatewayPaymentID,
		&row.RefundAmount, &row.RefundReason, &row.RefundedAt,
		&row.CODCollectedAt, &row.CODCollectedBy, &row.InvoiceURL,
		&row.CreatedAt, &row.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("create payment: %w", err)
	}
	return &row, nil
}

// FindByRide returns the payment record for a ride.
func (r *Repository) FindByRide(ctx context.Context, rideID uuid.UUID) (*PaymentRow, error) {
	var row PaymentRow
	err := r.pool.QueryRow(ctx, `
		SELECT id, ride_id, rider_id, driver_id, amount, tax, tip, platform_fee, total,
		       method, status, gateway_order_id, gateway_payment_id, refund_amount,
		       refund_reason, refunded_at, cod_collected_at, cod_collected_by,
		       invoice_url, created_at, updated_at
		FROM ride_payments WHERE ride_id = $1`, rideID).Scan(
		&row.ID, &row.RideID, &row.RiderID, &row.DriverID,
		&row.Amount, &row.Tax, &row.Tip, &row.PlatformFee, &row.Total,
		&row.Method, &row.Status, &row.GatewayOrderID, &row.GatewayPaymentID,
		&row.RefundAmount, &row.RefundReason, &row.RefundedAt,
		&row.CODCollectedAt, &row.CODCollectedBy, &row.InvoiceURL,
		&row.CreatedAt, &row.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrPaymentNotFound
		}
		return nil, err
	}
	return &row, nil
}

// FindByID is the id-based lookup.
func (r *Repository) FindByID(ctx context.Context, id uuid.UUID) (*PaymentRow, error) {
	var row PaymentRow
	err := r.pool.QueryRow(ctx, `
		SELECT id, ride_id, rider_id, driver_id, amount, tax, tip, platform_fee, total,
		       method, status, gateway_order_id, gateway_payment_id, refund_amount,
		       refund_reason, refunded_at, cod_collected_at, cod_collected_by,
		       invoice_url, created_at, updated_at
		FROM ride_payments WHERE id = $1`, id).Scan(
		&row.ID, &row.RideID, &row.RiderID, &row.DriverID,
		&row.Amount, &row.Tax, &row.Tip, &row.PlatformFee, &row.Total,
		&row.Method, &row.Status, &row.GatewayOrderID, &row.GatewayPaymentID,
		&row.RefundAmount, &row.RefundReason, &row.RefundedAt,
		&row.CODCollectedAt, &row.CODCollectedBy, &row.InvoiceURL,
		&row.CreatedAt, &row.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrPaymentNotFound
		}
		return nil, err
	}
	return &row, nil
}

// FindByGatewayOrder finds by the gateway order id (for webhooks).
func (r *Repository) FindByGatewayOrder(ctx context.Context, orderID string) (*PaymentRow, error) {
	var row PaymentRow
	err := r.pool.QueryRow(ctx, `
		SELECT id, ride_id, rider_id, driver_id, amount, tax, tip, platform_fee, total,
		       method, status, gateway_order_id, gateway_payment_id, refund_amount,
		       refund_reason, refunded_at, cod_collected_at, cod_collected_by,
		       invoice_url, created_at, updated_at
		FROM ride_payments WHERE gateway_order_id = $1`, orderID).Scan(
		&row.ID, &row.RideID, &row.RiderID, &row.DriverID,
		&row.Amount, &row.Tax, &row.Tip, &row.PlatformFee, &row.Total,
		&row.Method, &row.Status, &row.GatewayOrderID, &row.GatewayPaymentID,
		&row.RefundAmount, &row.RefundReason, &row.RefundedAt,
		&row.CODCollectedAt, &row.CODCollectedBy, &row.InvoiceURL,
		&row.CreatedAt, &row.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrPaymentNotFound
		}
		return nil, err
	}
	return &row, nil
}

// MarkAuthorized transitions to AUTHORIZED with gateway payment id.
func (r *Repository) MarkAuthorized(ctx context.Context, id uuid.UUID, gatewayPaymentID string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE ride_payments SET status = 'authorized', gateway_payment_id = NULLIF($1, ''),
		       updated_at = NOW() WHERE id = $2 AND status = 'pending'`, gatewayPaymentID, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrInvalidStatus
	}
	return nil
}

// MarkCaptured marks the payment captured.
func (r *Repository) MarkCaptured(ctx context.Context, id uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE ride_payments SET status = 'captured', updated_at = NOW()
		WHERE id = $1 AND status IN ('authorized','pending')`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrInvalidStatus
	}
	return nil
}

// MarkFailed sets status to failed.
func (r *Repository) MarkFailed(ctx context.Context, id uuid.UUID, reason string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE ride_payments SET status = 'failed',
		    metadata = metadata || jsonb_build_object('failure_reason', $1::text),
		    updated_at = NOW() WHERE id = $2`, reason, id)
	return err
}

// Refund issues a partial or full refund.
func (r *Repository) Refund(ctx context.Context, id uuid.UUID, amount decimal.Decimal, reason string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var status string
	if err := tx.QueryRow(ctx, `SELECT status FROM ride_payments WHERE id = $1 FOR UPDATE`, id).Scan(&status); err != nil {
		return err
	}
	if status == "refunded" {
		return ErrAlreadyRefunded
	}
	if status != "captured" && status != "partial_refund" {
		return ErrInvalidStatus
	}
	newStatus := "refunded"
	if amount.GreaterThan(decimal.Zero) {
		newStatus = "partial_refund"
	}
	if _, err := tx.Exec(ctx, `
		UPDATE ride_payments SET status = $1::ride_payment_status, refund_amount = $2,
		    refund_reason = $3, refunded_at = NOW(), updated_at = NOW()
		WHERE id = $4`, newStatus, amount.String(), reason, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// MarkCodCollected is the driver confirmation that cash was collected.
func (r *Repository) MarkCodCollected(ctx context.Context, paymentID, by uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE ride_payments SET status = 'cod_collected', cod_collected_at = NOW(),
		    cod_collected_by = $1, updated_at = NOW()
		WHERE id = $2 AND status IN ('cod_pending','pending','authorized')`, by, paymentID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrInvalidStatus
	}
	return nil
}

// CreateCodVerification generates an OTP, stores only the hash, and
// returns the plaintext OTP so the caller can dispatch it.
func (r *Repository) CreateCodVerification(ctx context.Context, rideID, riderID, driverID uuid.UUID, ttl time.Duration) (string, *CodVerification, error) {
	otp, err := generateOTP(6)
	if err != nil {
		return "", nil, err
	}
	hash := hashOTP(otp)
	expires := time.Now().Add(ttl)
	var v CodVerification
	err = r.pool.QueryRow(ctx, `
		INSERT INTO ride_cod_verifications (
			ride_id, rider_id, driver_id, otp_hash, expires_at, status
		) VALUES ($1, $2, $3, $4, $5, 'otp_sent')
		RETURNING id, ride_id, rider_id, driver_id, otp_hash, expires_at,
		          attempts, max_attempts, status, verified_at, failure_reason, created_at`,
		rideID, riderID, driverID, hash, expires,
	).Scan(
		&v.ID, &v.RideID, &v.RiderID, &v.DriverID, &v.OTPHash, &v.ExpiresAt,
		&v.Attempts, &v.MaxAttempts, &v.Status, &v.VerifiedAt, &v.Failure, &v.CreatedAt,
	)
	if err != nil {
		return "", nil, err
	}
	return otp, &v, nil
}

// VerifyCod checks the OTP and atomically marks success/failure.
func (r *Repository) VerifyCod(ctx context.Context, rideID uuid.UUID, otp string) (*CodVerification, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var v CodVerification
	err = tx.QueryRow(ctx, `
		SELECT id, ride_id, rider_id, driver_id, otp_hash, expires_at,
		       attempts, max_attempts, status, verified_at, failure_reason, created_at
		FROM ride_cod_verifications
		WHERE ride_id = $1 AND status = 'otp_sent'
		ORDER BY created_at DESC LIMIT 1
		FOR UPDATE`, rideID).Scan(
		&v.ID, &v.RideID, &v.RiderID, &v.DriverID, &v.OTPHash, &v.ExpiresAt,
		&v.Attempts, &v.MaxAttempts, &v.Status, &v.VerifiedAt, &v.Failure, &v.CreatedAt,
	)
	if err != nil {
		return nil, ErrCodNotFound
	}
	if v.Status == "verified" {
		return &v, ErrCodAlreadyDone
	}
	if time.Now().After(v.ExpiresAt) {
		_, _ = tx.Exec(ctx, `UPDATE ride_cod_verifications SET status = 'expired', failure_reason = 'expired' WHERE id = $1`, v.ID)
		_ = tx.Commit(ctx)
		return nil, ErrCodExpired
	}
	if v.Attempts >= v.MaxAttempts {
		_, _ = tx.Exec(ctx, `UPDATE ride_cod_verifications SET status = 'failed', failure_reason = 'max_attempts' WHERE id = $1`, v.ID)
		_ = tx.Commit(ctx)
		return nil, ErrCodMaxAttempts
	}
	if hashOTP(otp) != v.OTPHash {
		_, _ = tx.Exec(ctx, `UPDATE ride_cod_verifications SET attempts = attempts + 1, failure_reason = 'mismatch' WHERE id = $1`, v.ID)
		_ = tx.Commit(ctx)
		return nil, errors.New("otp mismatch")
	}
	if _, err := tx.Exec(ctx, `UPDATE ride_cod_verifications SET status = 'verified', verified_at = NOW() WHERE id = $1`, v.ID); err != nil {
		return nil, err
	}
	_, _ = tx.Exec(ctx, `UPDATE ride_payments SET status = 'cod_collected', cod_collected_at = NOW() WHERE ride_id = $1 AND status = 'cod_pending'`, rideID)
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	v.Status = "verified"
	now := time.Now()
	v.VerifiedAt = &now
	return &v, nil
}

// ---------- Helpers ----------

func generateOTP(digits int) (string, error) {
	if digits <= 0 || digits > 12 {
		digits = 6
	}
	max := 1
	for i := 0; i < digits; i++ {
		max *= 10
	}
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	n := int(b[0])<<24 | int(b[1])<<16 | int(b[2])<<8 | int(b[3])
	n = n % max
	out := fmt.Sprintf("%0*d", digits, n)
	return out, nil
}

func hashOTP(otp string) string {
	pepper := "nexus:campus:ride"
	combined := []byte(pepper + otp)
	out := make([]byte, len(combined)*2)
	for i, c := range combined {
		out[i*2] = "0123456789abcdef"[c>>4]
		out[i*2+1] = "0123456789abcdef"[c&0x0f]
	}
	return hex.EncodeToString(out)[:32]
}

func nilIfEmpty(s string) string {
	if strings.TrimSpace(s) == "" {
		return ""
	}
	return s
}