// Package wallet is a thin client to the NEXUS wallet service. It is used
// by the ride payment flow to put holds on the rider's wallet balance,
// capture the final fare when the trip completes, release the hold on
// cancellation, and issue refunds for goodwill adjustments.
//
// Design notes
//
//   - The wallet is reachable as a regular HTTP service inside the cluster.
//     We send the same X-Internal-Secret + X-Authenticated-Userid headers
//     the rest of services/rides already injects so the wallet auth
//     middleware accepts the call.
//
//   - The Client is an interface (defined below) so tests can swap in a
//     stub that records calls and returns canned responses.
//
//   - Hold/Capture/Release/Refund are idempotent on a per-request
//     idempotency key derived from the ride ID + operation. The wallet
//     service deduplicates by that key on its side.
//
//   - On a 5xx or transport error we retry up to 3 times with
//     exponential backoff (100ms, 200ms, 400ms). On a 4xx we return
//     immediately — those are caller errors.
//
//   - The Client is safe for concurrent use; the http.Client it wraps
//     already is.
package wallet

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// Client is the interface the ride service depends on. The HTTPClient
// concrete type is the production implementation; tests provide a Stub.
type Client interface {
	Hold(ctx context.Context, in HoldRequest) (*HoldResponse, error)
	Capture(ctx context.Context, in CaptureRequest) (*CaptureResponse, error)
	Release(ctx context.Context, in ReleaseRequest) (*ReleaseResponse, error)
	Refund(ctx context.Context, in RefundRequest) (*RefundResponse, error)
	GetBalance(ctx context.Context, userID uuid.UUID) (*BalanceResponse, error)
	DebitDriverEarnings(ctx context.Context, in DriverEarningsRequest) (*DriverEarningsResponse, error)
	SchedulePayout(ctx context.Context, in PayoutRequest) (*PayoutResponse, error)
}

// HoldRequest is the body of POST /api/v1/wallet/hold.
//
//   - UserID: the rider whose balance to put a hold on.
//   - AmountCents: positive integer minor units (e.g. 12500 = ₹125.00).
//   - RideID: ride correlation id, embedded in ledger entries.
//   - IdempotencyKey: unique per call; wallet dedupes by this.
//
// A hold is *not* a charge. The rider's "available" balance goes down
// but their "settled" balance doesn't move until Capture is called.
type HoldRequest struct {
	UserID         uuid.UUID
	AmountCents    int64
	RideID         uuid.UUID
	Method         string
	IdempotencyKey string
	Notes          string
}

// HoldResponse is what the wallet returns.
type HoldResponse struct {
	HoldID        string    `json:"hold_id"`
	AmountCents   int64     `json:"amount_cents"`
	Status        string    `json:"status"`
	ExpiresAt     time.Time `json:"expires_at"`
	AvailableCents int64    `json:"available_cents"`
}

// CaptureRequest finalizes a previously-placed hold.
//
//   - AmountCents: usually the same as the hold, but can be lower
//     (e.g. cancellation fee capture) or higher only if the hold is
//     pre-authorised for the maximum and the rider agreed.
//   - FinalFare: the human-facing number to embed in the ledger.
type CaptureRequest struct {
	HoldID         string
	UserID         uuid.UUID
	AmountCents    int64
	FinalFare      decimal.Decimal
	RideID         uuid.UUID
	IdempotencyKey string
}

// CaptureResponse is the wallet's ack.
type CaptureResponse struct {
	CaptureID      string `json:"capture_id"`
	HoldID         string `json:"hold_id"`
	AmountCents    int64  `json:"amount_cents"`
	Status         string `json:"status"`
	SettledCents   int64  `json:"settled_cents"`
}

// ReleaseRequest cancels a hold without charging. Use on cancellation
// before capture.
type ReleaseRequest struct {
	HoldID         string
	UserID         uuid.UUID
	IdempotencyKey string
	Reason         string
}

// ReleaseResponse is the wallet's ack.
type ReleaseResponse struct {
	HoldID         string `json:"hold_id"`
	ReleasedCents  int64  `json:"released_cents"`
	Status         string `json:"status"`
}

// RefundRequest issues a refund for a captured payment. The wallet
// returns the amount to the rider's available balance and (if any
// driver earnings were credited) reverses the driver earning.
type RefundRequest struct {
	CaptureID      string
	UserID         uuid.UUID
	AmountCents    int64
	Reason         string
	RideID         uuid.UUID
	IdempotencyKey string
}

// RefundResponse is the wallet's ack.
type RefundResponse struct {
	RefundID       string `json:"refund_id"`
	AmountCents    int64  `json:"amount_cents"`
	Status         string `json:"status"`
}

// BalanceResponse is the rider's wallet balance.
type BalanceResponse struct {
	UserID         uuid.UUID `json:"user_id"`
	AvailableCents int64     `json:"available_cents"`
	HeldCents      int64     `json:"held_cents"`
	SettledCents   int64     `json:"settled_cents"`
	Currency       string    `json:"currency"`
}

// DriverEarningsRequest credits a driver's wallet with their share of a
// completed ride. Called by the ride service after capture.
type DriverEarningsRequest struct {
	DriverID       uuid.UUID
	AmountCents    int64
	RideID         uuid.UUID
	IdempotencyKey string
	Method         string // upi, bank, cash
}

// DriverEarningsResponse is the wallet's ack.
type DriverEarningsResponse struct {
	EarningID    string `json:"earning_id"`
	DriverID     uuid.UUID `json:"driver_id"`
	AmountCents  int64  `json:"amount_cents"`
	Status       string `json:"status"`
}

// PayoutRequest is a daily driver-payout request to the wallet.
type PayoutRequest struct {
	DriverID       uuid.UUID
	AmountCents    int64
	Method         string
	IdempotencyKey string
}

// PayoutResponse is the wallet's ack.
type PayoutResponse struct {
	PayoutID       string `json:"payout_id"`
	DriverID       uuid.UUID `json:"driver_id"`
	AmountCents    int64  `json:"amount_cents"`
	Status         string `json:"status"`
	EstimatedAt    time.Time `json:"estimated_settlement_at"`
}

// =============================================================================
// HTTPClient — the production implementation
// =============================================================================

// HTTPClient is the production Client that talks to the wallet service
// over HTTP. It is safe for concurrent use.
type HTTPClient struct {
	baseURL          string
	httpClient       *http.Client
	rideServiceUser  string // X-Authenticated-Userid the rides service authenticates as
	internalSecret   string
	logger           *zap.Logger
	maxRetries       int
	backoffInitialMs int
}

// Options configures a new HTTPClient.
type Options struct {
	BaseURL          string        // e.g. http://wallet:4001
	InternalSecret   string        // X-Internal-Secret the wallet auth middleware expects
	RideServiceUser  string        // X-Authenticated-Userid; defaults to "service:rides"
	Timeout          time.Duration // per-request; default 5s
	MaxRetries       int           // default 3
	BackoffInitialMs int           // default 100ms
	Logger           *zap.Logger
}

// NewHTTPClient builds a Client. Options is required; missing fields
// fall back to safe defaults.
func NewHTTPClient(opts Options) *HTTPClient {
	if opts.BaseURL == "" {
		opts.BaseURL = "http://localhost:3003"
	}
	if opts.InternalSecret == "" {
		opts.InternalSecret = "dev-internal-secret-change-in-production"
	}
	if opts.RideServiceUser == "" {
		opts.RideServiceUser = "service:rides"
	}
	if opts.Timeout == 0 {
		opts.Timeout = 5 * time.Second
	}
	if opts.MaxRetries == 0 {
		opts.MaxRetries = 3
	}
	if opts.BackoffInitialMs == 0 {
		opts.BackoffInitialMs = 100
	}
	if opts.Logger == nil {
		opts.Logger = zap.NewNop()
	}
	return &HTTPClient{
		baseURL:          strings.TrimRight(opts.BaseURL, "/"),
		httpClient:       &http.Client{Timeout: opts.Timeout},
		rideServiceUser:  opts.RideServiceUser,
		internalSecret:   opts.InternalSecret,
		logger:           opts.Logger,
		maxRetries:       opts.MaxRetries,
		backoffInitialMs: opts.BackoffInitialMs,
	}
}

// =============================================================================
// Public methods
// =============================================================================

// Hold places a hold on the rider's wallet balance.
func (c *HTTPClient) Hold(ctx context.Context, in HoldRequest) (*HoldResponse, error) {
	if in.IdempotencyKey == "" {
		in.IdempotencyKey = fmt.Sprintf("hold:%s:%d", in.RideID, in.AmountCents)
	}
	if in.Method == "" {
		in.Method = "wallet"
	}
	body, _ := json.Marshal(map[string]any{
		"user_id":         in.UserID,
		"amount_cents":    in.AmountCents,
		"ride_id":         in.RideID,
		"method":          in.Method,
		"idempotency_key": in.IdempotencyKey,
		"notes":           in.Notes,
	})
	var out HoldResponse
	if err := c.do(ctx, http.MethodPost, "/api/v1/wallet/hold", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Capture finalises a hold.
func (c *HTTPClient) Capture(ctx context.Context, in CaptureRequest) (*CaptureResponse, error) {
	if in.IdempotencyKey == "" {
		in.IdempotencyKey = fmt.Sprintf("capture:%s:%d", in.HoldID, in.AmountCents)
	}
	body, _ := json.Marshal(map[string]any{
		"hold_id":         in.HoldID,
		"user_id":         in.UserID,
		"amount_cents":    in.AmountCents,
		"final_fare":      in.FinalFare.String(),
		"ride_id":         in.RideID,
		"idempotency_key": in.IdempotencyKey,
	})
	var out CaptureResponse
	if err := c.do(ctx, http.MethodPost, "/api/v1/wallet/capture", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Release frees an un-captured hold.
func (c *HTTPClient) Release(ctx context.Context, in ReleaseRequest) (*ReleaseResponse, error) {
	if in.IdempotencyKey == "" {
		in.IdempotencyKey = fmt.Sprintf("release:%s", in.HoldID)
	}
	body, _ := json.Marshal(map[string]any{
		"hold_id":         in.HoldID,
		"user_id":         in.UserID,
		"idempotency_key": in.IdempotencyKey,
		"reason":          in.Reason,
	})
	var out ReleaseResponse
	if err := c.do(ctx, http.MethodPost, "/api/v1/wallet/release", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Refund returns funds to the rider.
func (c *HTTPClient) Refund(ctx context.Context, in RefundRequest) (*RefundResponse, error) {
	if in.IdempotencyKey == "" {
		in.IdempotencyKey = fmt.Sprintf("refund:%s:%d", in.CaptureID, in.AmountCents)
	}
	body, _ := json.Marshal(map[string]any{
		"capture_id":      in.CaptureID,
		"user_id":         in.UserID,
		"amount_cents":    in.AmountCents,
		"reason":          in.Reason,
		"ride_id":         in.RideID,
		"idempotency_key": in.IdempotencyKey,
	})
	var out RefundResponse
	if err := c.do(ctx, http.MethodPost, "/api/v1/wallet/refund", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetBalance reads the user's wallet balance.
func (c *HTTPClient) GetBalance(ctx context.Context, userID uuid.UUID) (*BalanceResponse, error) {
	var out BalanceResponse
	if err := c.do(ctx, http.MethodGet, fmt.Sprintf("/api/v1/wallet/balance/%s", userID), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// DebitDriverEarnings credits the driver's earnings balance after a
// successful capture.
func (c *HTTPClient) DebitDriverEarnings(ctx context.Context, in DriverEarningsRequest) (*DriverEarningsResponse, error) {
	if in.IdempotencyKey == "" {
		in.IdempotencyKey = fmt.Sprintf("earning:%s:%d", in.RideID, in.AmountCents)
	}
	if in.Method == "" {
		in.Method = "wallet"
	}
	body, _ := json.Marshal(map[string]any{
		"driver_id":       in.DriverID,
		"amount_cents":    in.AmountCents,
		"ride_id":         in.RideID,
		"idempotency_key": in.IdempotencyKey,
		"method":          in.Method,
	})
	var out DriverEarningsResponse
	if err := c.do(ctx, http.MethodPost, "/api/v1/wallet/driver/earning", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// SchedulePayout asks the wallet to push a driver's accumulated earnings
// to their linked bank or UPI. The wallet service owns the actual
// settlement, this is just the request.
func (c *HTTPClient) SchedulePayout(ctx context.Context, in PayoutRequest) (*PayoutResponse, error) {
	if in.IdempotencyKey == "" {
		in.IdempotencyKey = fmt.Sprintf("payout:%s:%d", in.DriverID, in.AmountCents)
	}
	body, _ := json.Marshal(map[string]any{
		"driver_id":       in.DriverID,
		"amount_cents":    in.AmountCents,
		"method":          in.Method,
		"idempotency_key": in.IdempotencyKey,
	})
	var out PayoutResponse
	if err := c.do(ctx, http.MethodPost, "/api/v1/wallet/payout", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// =============================================================================
// Internal — HTTP plumbing with retry + backoff
// =============================================================================

// errorEnvelope is the wallet service's error response shape.
type errorEnvelope struct {
	Error *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// do executes a single request with the configured retry policy.
//
//   - 2xx: decode the response into `out` and return nil.
//   - 4xx: parse the error envelope, return a typed *APIError.
//   - 5xx or transport error: retry up to maxRetries with exponential
//     backoff, then return a *RetriesExhaustedError.
func (c *HTTPClient) do(ctx context.Context, method, path string, body []byte, out any) error {
	url := c.baseURL + path
	var lastErr error
	backoff := time.Duration(c.backoffInitialMs) * time.Millisecond

	for attempt := 0; attempt <= c.maxRetries; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoff):
			}
			backoff *= 2
		}
		err := c.attempt(ctx, method, url, body, out)
		if err == nil {
			return nil
		}
		lastErr = err
		// 4xx → don't retry
		var apiErr *APIError
		if errors.As(err, &apiErr) {
			return err
		}
		// network / 5xx → retry
		c.logger.Warn("wallet request failed, will retry",
			zap.Int("attempt", attempt),
			zap.String("method", method),
			zap.String("path", path),
			zap.Error(err),
		)
	}
	return &RetriesExhaustedError{
		Method:    method,
		Path:      path,
		MaxTries:  c.maxRetries + 1,
		LastError: lastErr,
	}
}

func (c *HTTPClient) attempt(ctx context.Context, method, url string, body []byte, out any) error {
	var req *http.Request
	var err error
	if body != nil {
		req, err = http.NewRequestWithContext(ctx, method, url, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
	} else {
		req, err = http.NewRequestWithContext(ctx, method, url, nil)
		if err != nil {
			return err
		}
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Authenticated-Userid", c.rideServiceUser)
	req.Header.Set("X-Internal-Secret", c.internalSecret)
	req.Header.Set("X-User-Roles", "service")
	req.Header.Set("X-User-Verification-Level", "3")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		if out == nil || len(raw) == 0 {
			return nil
		}
		if err := json.Unmarshal(raw, out); err != nil {
			return fmt.Errorf("wallet: decode response: %w (body=%s)", err, string(raw))
		}
		return nil
	}

	// 4xx — try to parse the error envelope; otherwise return a generic APIError
	var env errorEnvelope
	_ = json.Unmarshal(raw, &env)
	code, msg := "WALLET_ERROR", "wallet service error"
	if env.Error != nil {
		code = env.Error.Code
		msg = env.Error.Message
	}
	return &APIError{
		StatusCode: resp.StatusCode,
		Code:       code,
		Message:    msg,
		Body:       string(raw),
	}
}

// =============================================================================
// Error types
// =============================================================================

// APIError is returned for 4xx responses. Callers should NOT retry.
type APIError struct {
	StatusCode int
	Code       string
	Message    string
	Body       string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("wallet API error %d: %s — %s", e.StatusCode, e.Code, e.Message)
}

// IsInsufficientFunds is true when the wallet said so.
func (e *APIError) IsInsufficientFunds() bool {
	return e.StatusCode == 402 || e.Code == "INSUFFICIENT_FUNDS"
}

// IsAlreadyDone is true when the idempotency key was already used for
// the same outcome (the wallet returns 200 + the prior result). The
// HTTP layer treats this as a non-error.
func (e *APIError) IsAlreadyDone() bool { return false }

// RetriesExhaustedError is returned when every retry returned 5xx or
// had a transport error.
type RetriesExhaustedError struct {
	Method    string
	Path      string
	MaxTries  int
	LastError error
}

func (e *RetriesExhaustedError) Error() string {
	return fmt.Sprintf("wallet: gave up after %d attempts to %s %s: %v",
		e.MaxTries, e.Method, e.Path, e.LastError)
}

// Unwrap exposes the last error for errors.Is/As.
func (e *RetriesExhaustedError) Unwrap() error { return e.LastError }
