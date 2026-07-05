// Package models defines the domain types for the wallet service.
// All monetary amounts use shopspring/decimal — never float64.
package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// Wallet represents a user's wallet with balance and locked amount.
type Wallet struct {
	ID              uuid.UUID       `json:"id"`
	UserID          uuid.UUID       `json:"user_id"`
	Balance         decimal.Decimal `json:"balance"`
	LockedAmount    decimal.Decimal `json:"locked_amount"`
	DailySpent      decimal.Decimal `json:"daily_spent"`
	DailyLimit      decimal.Decimal `json:"daily_limit"`
	IsFrozen        bool            `json:"is_frozen"`
	Currency        string          `json:"currency"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

// WalletResponse is the JSON response for wallet data.
// Money fields are ALWAYS string — never JSON number.
type WalletResponse struct {
	ID               string `json:"id"`
	Balance          string `json:"balance"`
	LockedAmount     string `json:"locked_amount"`
	AvailableBalance string `json:"available_balance"`
	DailySpent       string `json:"daily_spent"`
	DailyLimit       string `json:"daily_limit"`
	IsFrozen         bool   `json:"is_frozen"`
	Currency         string `json:"currency"`
}

// ToResponse converts a Wallet to its JSON response form.
func (w *Wallet) ToResponse() WalletResponse {
	available := w.Balance.Sub(w.LockedAmount)
	return WalletResponse{
		ID:               w.ID.String(),
		Balance:          w.Balance.StringFixed(2),
		LockedAmount:     w.LockedAmount.StringFixed(2),
		AvailableBalance: available.StringFixed(2),
		DailySpent:       w.DailySpent.StringFixed(2),
		DailyLimit:       w.DailyLimit.StringFixed(2),
		IsFrozen:         w.IsFrozen,
		Currency:         w.Currency,
	}
}

// LedgerEntry represents a single entry in the append-only wallet ledger.
type LedgerEntry struct {
	ID             int64           `json:"id"`
	WalletID       uuid.UUID       `json:"wallet_id"`
	TransactionID  *uuid.UUID      `json:"transaction_id,omitempty"`
	EntryType      string          `json:"entry_type"` // credit | debit | lock | unlock
	Amount         decimal.Decimal `json:"amount"`
	BalanceAfter   decimal.Decimal `json:"balance_after"`
	LockedAfter    decimal.Decimal `json:"locked_after"`
	Description    string          `json:"description"`
	IdempotencyKey string          `json:"idempotency_key"`
	CreatedAt      time.Time       `json:"created_at"`
}

// LedgerEntryResponse is the JSON response for ledger entries.
type LedgerEntryResponse struct {
	ID             int64  `json:"id"`
	EntryType      string `json:"entry_type"`
	Amount         string `json:"amount"`
	BalanceAfter   string `json:"balance_after"`
	Description    string `json:"description"`
	IdempotencyKey string `json:"idempotency_key"`
	CreatedAt      string `json:"created_at"`
}

// Transaction represents a marketplace or P2P transaction.
type Transaction struct {
	ID              uuid.UUID       `json:"id"`
	BuyerID         uuid.UUID       `json:"buyer_id"`
	SellerID        uuid.UUID       `json:"seller_id"`
	Amount          decimal.Decimal `json:"amount"`
	PlatformFee     decimal.Decimal `json:"platform_fee"`
	SellerAmount    decimal.Decimal `json:"seller_amount"`
	Status          string          `json:"status"` // initiated | payment_held | completed | disputed | refunded
	Module          string          `json:"module"` // bazaar | feast | swift | skills | p2p
	EscrowReleaseAt *time.Time      `json:"escrow_release_at,omitempty"`
	IdempotencyKey  string          `json:"idempotency_key"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

// PaymentOrder represents a Razorpay payment order.
type PaymentOrder struct {
	ID               uuid.UUID       `json:"id"`
	UserID           uuid.UUID       `json:"user_id"`
	Amount           decimal.Decimal `json:"amount"`
	RazorpayOrderID  string          `json:"razorpay_order_id"`
	RazorpayPaymentID *string        `json:"razorpay_payment_id,omitempty"`
	Status           string          `json:"status"` // created | captured | failed
	IdempotencyKey   string          `json:"idempotency_key"`
	CreatedAt        time.Time       `json:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
}

// TransferRequest represents a P2P transfer request.
type TransferRequest struct {
	ID             uuid.UUID       `json:"id"`
	SenderID       uuid.UUID       `json:"sender_id"`
	ReceiverID     uuid.UUID       `json:"receiver_id"`
	Amount         decimal.Decimal `json:"amount"`
	Status         string          `json:"status"`
	IdempotencyKey string          `json:"idempotency_key"`
	CreatedAt      time.Time       `json:"created_at"`
}
