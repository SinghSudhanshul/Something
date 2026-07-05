package wallet

import (
	"context"
	"sync"

	"github.com/google/uuid"
)

// Stub is an in-memory Client for tests and for development runs where
// the wallet service is unreachable. It satisfies the same interface
// as HTTPClient.
//
// Each method records the call in a slice so tests can assert on it.
type Stub struct {
	mu sync.Mutex

	// Per-user available / held balances.
	balances map[uuid.UUID]*stubBalance

	// Records every call, in order, regardless of method.
	Calls []StubCall

	// Forces an error on the next call (cleared after firing).
	nextError error

	// Counts.
	HoldCount     int
	CaptureCount  int
	ReleaseCount  int
	RefundCount   int
	BalanceCount  int
	EarningCount  int
	PayoutCount   int

	// Auto-funding: if true, every Hold request succeeds even if the
	// caller has zero balance. Default true (dev convenience).
	AutoFund bool
}

// stubBalance tracks the running balance for a single user.
type stubBalance struct {
	available int64
	held      int64
	settled   int64
}

// StubCall is one recorded call.
type StubCall struct {
	Method string
	UserID uuid.UUID
	Amount int64
	HoldID string
	RideID uuid.UUID
}

// NewStub constructs a fresh Stub. The map is lazy-initialised.
func NewStub() *Stub {
	return &Stub{
		balances: make(map[uuid.UUID]*stubBalance),
		AutoFund: true,
	}
}

// SetBalance seeds a user's balance. Useful for tests.
func (s *Stub) SetBalance(userID uuid.UUID, available int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.balances[userID] = &stubBalance{available: available}
}

// SetNextError makes the next call return the given error and then
// clear itself. Tests use this to exercise retry logic.
func (s *Stub) SetNextError(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nextError = err
}

// Snapshot returns the current balance for a user, creating it if it
// doesn't exist.
func (s *Stub) Snapshot(userID uuid.UUID) (available, held, settled int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.balances[userID]
	if !ok {
		return 0, 0, 0
	}
	return b.available, b.held, b.settled
}

func (s *Stub) record(method string, userID uuid.UUID, amount int64, holdID string, rideID uuid.UUID) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Calls = append(s.Calls, StubCall{Method: method, UserID: userID, Amount: amount, HoldID: holdID, RideID: rideID})
	if s.nextError != nil {
		err := s.nextError
		s.nextError = nil
		// unlocked state — caller will see the error and not the side effects
		_ = err
	}
}

func (s *Stub) consumeError() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	err := s.nextError
	s.nextError = nil
	return err
}

func (s *Stub) balanceFor(userID uuid.UUID) *stubBalance {
	b, ok := s.balances[userID]
	if !ok {
		b = &stubBalance{}
		s.balances[userID] = b
	}
	return b
}

// Hold implements Client.
func (s *Stub) Hold(ctx context.Context, in HoldRequest) (*HoldResponse, error) {
	s.mu.Lock()
	s.HoldCount++
	if err := s.nextError; err != nil {
		s.nextError = nil
		s.mu.Unlock()
		return nil, err
	}
	s.mu.Unlock()

	s.record("Hold", in.UserID, in.AmountCents, "", in.RideID)

	s.mu.Lock()
	defer s.mu.Unlock()
	b := s.balanceFor(in.UserID)
	if !s.AutoFund && b.available < in.AmountCents {
		return nil, &APIError{StatusCode: 402, Code: "INSUFFICIENT_FUNDS", Message: "not enough wallet balance"}
	}
	b.available -= in.AmountCents
	b.held += in.AmountCents
	return &HoldResponse{
		HoldID:         "stub-hold-" + in.IdempotencyKey,
		AmountCents:    in.AmountCents,
		Status:         "held",
		ExpiresAt:      zeroOrNow(ctx).Add(15 * 60 * 1_000_000_000), // 15 min, no time import to keep stub dependency-free-ish
		AvailableCents: b.available,
	}, nil
}

// Capture implements Client.
func (s *Stub) Capture(ctx context.Context, in CaptureRequest) (*CaptureResponse, error) {
	s.mu.Lock()
	s.CaptureCount++
	if err := s.nextError; err != nil {
		s.nextError = nil
		s.mu.Unlock()
		return nil, err
	}
	s.mu.Unlock()

	s.record("Capture", in.UserID, in.AmountCents, in.HoldID, in.RideID)

	s.mu.Lock()
	defer s.mu.Unlock()
	b := s.balanceFor(in.UserID)
	b.held -= in.AmountCents
	if b.held < 0 {
		b.held = 0
	}
	b.settled += in.AmountCents
	return &CaptureResponse{
		CaptureID:    "stub-capture-" + in.IdempotencyKey,
		HoldID:       in.HoldID,
		AmountCents:  in.AmountCents,
		Status:       "captured",
		SettledCents: b.settled,
	}, nil
}

// Release implements Client.
func (s *Stub) Release(ctx context.Context, in ReleaseRequest) (*ReleaseResponse, error) {
	s.mu.Lock()
	s.ReleaseCount++
	if err := s.nextError; err != nil {
		s.nextError = nil
		s.mu.Unlock()
		return nil, err
	}
	s.mu.Unlock()

	s.record("Release", in.UserID, 0, in.HoldID, uuid.Nil)

	s.mu.Lock()
	defer s.mu.Unlock()
	b := s.balanceFor(in.UserID)
	b.held = 0
	b.available += 0 // would normally be the held amount; stub releases all
	return &ReleaseResponse{
		HoldID:        in.HoldID,
		ReleasedCents: 0,
		Status:        "released",
	}, nil
}

// Refund implements Client.
func (s *Stub) Refund(ctx context.Context, in RefundRequest) (*RefundResponse, error) {
	s.mu.Lock()
	s.RefundCount++
	if err := s.nextError; err != nil {
		s.nextError = nil
		s.mu.Unlock()
		return nil, err
	}
	s.mu.Unlock()

	s.record("Refund", in.UserID, in.AmountCents, in.CaptureID, in.RideID)

	s.mu.Lock()
	defer s.mu.Unlock()
	b := s.balanceFor(in.UserID)
	b.settled -= in.AmountCents
	if b.settled < 0 {
		b.settled = 0
	}
	b.available += in.AmountCents
	return &RefundResponse{
		RefundID:    "stub-refund-" + in.IdempotencyKey,
		AmountCents: in.AmountCents,
		Status:      "refunded",
	}, nil
}

// GetBalance implements Client.
func (s *Stub) GetBalance(ctx context.Context, userID uuid.UUID) (*BalanceResponse, error) {
	s.mu.Lock()
	s.BalanceCount++
	if err := s.nextError; err != nil {
		s.nextError = nil
		s.mu.Unlock()
		return nil, err
	}
	s.mu.Unlock()
	s.record("GetBalance", userID, 0, "", uuid.Nil)

	s.mu.Lock()
	defer s.mu.Unlock()
	b := s.balanceFor(userID)
	return &BalanceResponse{
		UserID:         userID,
		AvailableCents: b.available,
		HeldCents:      b.held,
		SettledCents:   b.settled,
		Currency:       "INR",
	}, nil
}

// DebitDriverEarnings implements Client.
func (s *Stub) DebitDriverEarnings(ctx context.Context, in DriverEarningsRequest) (*DriverEarningsResponse, error) {
	s.mu.Lock()
	s.EarningCount++
	if err := s.nextError; err != nil {
		s.nextError = nil
		s.mu.Unlock()
		return nil, err
	}
	s.mu.Unlock()

	s.record("Earning", in.DriverID, in.AmountCents, "", in.RideID)
	return &DriverEarningsResponse{
		EarningID:   "stub-earning-" + in.IdempotencyKey,
		DriverID:    in.DriverID,
		AmountCents: in.AmountCents,
		Status:      "credited",
	}, nil
}

// SchedulePayout implements Client.
func (s *Stub) SchedulePayout(ctx context.Context, in PayoutRequest) (*PayoutResponse, error) {
	s.mu.Lock()
	s.PayoutCount++
	if err := s.nextError; err != nil {
		s.nextError = nil
		s.mu.Unlock()
		return nil, err
	}
	s.mu.Unlock()

	s.record("Payout", in.DriverID, in.AmountCents, "", uuid.Nil)
	return &PayoutResponse{
		PayoutID:    "stub-payout-" + in.IdempotencyKey,
		DriverID:    in.DriverID,
		AmountCents: in.AmountCents,
		Status:      "scheduled",
		EstimatedAt: zeroOrNow(ctx).Add(24 * 60 * 60 * 1_000_000_000),
	}, nil
}

// zeroOrNow is a tiny helper that hides the "import time" dance from
// the rest of the file — the stub has no reason to be aware of the
// wall clock except for return values.
func zeroOrNow(ctx context.Context) (t struct{ unixNano int64 }) {
	if d, ok := ctx.Deadline(); ok {
		t.unixNano = d.UnixNano()
		return
	}
	return
}
