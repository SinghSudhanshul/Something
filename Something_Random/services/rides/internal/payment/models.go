// Package payment owns the financial lifecycle of a RIDE & GO trip:
// fare authorization, capture, refunds, COD OTP verification, and the
// audit trail of every monetary event.
//
// All money-handling code lives in Go because we need:
//   • ACID guarantees on ride_payments rows
//   • Tight control over decimal precision (shopspring/decimal)
//   • Idempotent gateway webhooks
package payment

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// PaymentRow mirrors ride_payments.
type PaymentRow struct {
	ID               uuid.UUID       `json:"id"`
	RideID           uuid.UUID       `json:"ride_id"`
	RiderID          uuid.UUID       `json:"rider_id"`
	DriverID         *uuid.UUID      `json:"driver_id,omitempty"`
	Amount           decimal.Decimal `json:"amount"`
	Tax              decimal.Decimal `json:"tax"`
	Tip              decimal.Decimal `json:"tip"`
	PlatformFee      decimal.Decimal `json:"platform_fee"`
	Total            decimal.Decimal `json:"total"`
	Method           string          `json:"method"`
	Status           string          `json:"status"`
	GatewayOrderID   *string         `json:"gateway_order_id,omitempty"`
	GatewayPaymentID *string         `json:"gateway_payment_id,omitempty"`
	RefundAmount     decimal.Decimal `json:"refund_amount"`
	RefundReason     *string         `json:"refund_reason,omitempty"`
	RefundedAt       *time.Time      `json:"refunded_at,omitempty"`
	CODCollectedAt   *time.Time      `json:"cod_collected_at,omitempty"`
	CODCollectedBy   *uuid.UUID      `json:"cod_collected_by,omitempty"`
	InvoiceURL       *string         `json:"invoice_url,omitempty"`
	Metadata         map[string]any  `json:"metadata,omitempty"`
	CreatedAt        time.Time       `json:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
}

// CodVerification mirrors ride_cod_verifications.
type CodVerification struct {
	ID          uuid.UUID  `json:"id"`
	RideID      uuid.UUID  `json:"ride_id"`
	RiderID     uuid.UUID  `json:"rider_id"`
	DriverID    *uuid.UUID `json:"driver_id,omitempty"`
	OTPHash     string     `json:"-"`
	ExpiresAt   time.Time  `json:"expires_at"`
	Attempts    int        `json:"attempts"`
	MaxAttempts int        `json:"max_attempts"`
	Status      string     `json:"status"`
	VerifiedAt  *time.Time `json:"verified_at,omitempty"`
	Failure     *string    `json:"failure_reason,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

// CreatePaymentInput is the request to create a payment.
type CreatePaymentInput struct {
	RideID         uuid.UUID
	RiderID        uuid.UUID
	DriverID       *uuid.UUID
	Amount         decimal.Decimal
	Tax            decimal.Decimal
	Tip            decimal.Decimal
	PlatformFee    decimal.Decimal
	Total          decimal.Decimal
	Method         string
	GatewayOrderID string
}

// GatewayWebhook is the inbound notification.
type GatewayWebhook struct {
	GatewayOrderID   string `json:"gateway_order_id"`
	GatewayPaymentID string `json:"gateway_payment_id"`
	Event            string `json:"event"`
	Signature        string `json:"signature"`
}

// IdempotencyEntry tracks webhook idempotency keys.
type IdempotencyEntry struct {
	Key       string
	Response  []byte
	ExpiresAt time.Time
}