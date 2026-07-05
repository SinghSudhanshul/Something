package transfer

import (
	"context"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"

	"nexus/wallet/internal/middleware"
	walletPkg "nexus/wallet/internal/wallet"
)

// Service handles P2P transfers with deadlock prevention.
type Service struct {
	db     *pgxpool.Pool
	logger *zap.Logger
}

// NewService creates a transfer service.
func NewService(db *pgxpool.Pool, logger *zap.Logger) *Service {
	return &Service{db: db, logger: logger}
}

// Transfer executes a P2P transfer between two users.
// Deadlock prevention: always lock wallets in consistent order (smaller UUID first).
func (s *Service) Transfer(ctx context.Context, senderID, receiverID uuid.UUID, amount decimal.Decimal, idempotencyKey string) error {
	if senderID == receiverID {
		return walletPkg.ErrSelfTransfer
	}
	if !amount.IsPositive() {
		return walletPkg.ErrInvalidAmount
	}

	// Idempotency check before acquiring locks
	var exists bool
	err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM wallet_ledger WHERE idempotency_key = $1)`,
		idempotencyKey+"-sender",
	).Scan(&exists)
	if err != nil {
		return err
	}
	if exists {
		return nil // Already processed
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Lock wallets in deterministic order (smaller UUID first)
	senderWallet, receiverWallet, err := lockWalletsInOrder(ctx, tx, senderID, receiverID)
	if err != nil {
		return err
	}

	// Validate sender
	if senderWallet.IsFrozen {
		return walletPkg.ErrWalletFrozen
	}
	if senderWallet.Balance.LessThan(amount) {
		return walletPkg.ErrInsufficientBalance
	}

	// Debit sender
	newSenderBalance := senderWallet.Balance.Sub(amount)
	_, err = tx.Exec(ctx,
		`UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2`,
		newSenderBalance.StringFixed(2), senderWallet.ID)
	if err != nil {
		return err
	}

	// Credit receiver
	newReceiverBalance := receiverWallet.Balance.Add(amount)
	_, err = tx.Exec(ctx,
		`UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2`,
		newReceiverBalance.StringFixed(2), receiverWallet.ID)
	if err != nil {
		return err
	}

	// Sender ledger entry
	_, err = tx.Exec(ctx,
		`INSERT INTO wallet_ledger (wallet_id, entry_type, amount, balance_after, locked_after, description, idempotency_key, created_at)
		 VALUES ($1, 'debit', $2, $3, $4, $5, $6, NOW())`,
		senderWallet.ID, amount.StringFixed(2), newSenderBalance.StringFixed(2),
		senderWallet.LockedAmount.StringFixed(2),
		fmt.Sprintf("P2P transfer to %s", receiverID.String()),
		idempotencyKey+"-sender")
	if err != nil {
		return err
	}

	// Receiver ledger entry
	_, err = tx.Exec(ctx,
		`INSERT INTO wallet_ledger (wallet_id, entry_type, amount, balance_after, locked_after, description, idempotency_key, created_at)
		 VALUES ($1, 'credit', $2, $3, $4, $5, $6, NOW())`,
		receiverWallet.ID, amount.StringFixed(2), newReceiverBalance.StringFixed(2),
		receiverWallet.LockedAmount.StringFixed(2),
		fmt.Sprintf("P2P transfer from %s", senderID.String()),
		idempotencyKey+"-receiver")
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

type walletRow struct {
	ID           uuid.UUID
	UserID       uuid.UUID
	Balance      decimal.Decimal
	LockedAmount decimal.Decimal
	IsFrozen     bool
}

// lockWalletsInOrder locks wallets in deterministic UUID order to prevent deadlocks.
func lockWalletsInOrder(ctx context.Context, tx pgx.Tx, id1, id2 uuid.UUID) (*walletRow, *walletRow, error) {
	first, second := id1, id2
	if id1.String() > id2.String() {
		first, second = id2, id1
	}

	var w1, w2 walletRow
	err := tx.QueryRow(ctx,
		`SELECT id, user_id, balance, locked_amount, is_frozen FROM wallets WHERE user_id = $1 FOR UPDATE`, first,
	).Scan(&w1.ID, &w1.UserID, &w1.Balance, &w1.LockedAmount, &w1.IsFrozen)
	if err != nil {
		return nil, nil, fmt.Errorf("lock first wallet: %w", err)
	}

	err = tx.QueryRow(ctx,
		`SELECT id, user_id, balance, locked_amount, is_frozen FROM wallets WHERE user_id = $1 FOR UPDATE`, second,
	).Scan(&w2.ID, &w2.UserID, &w2.Balance, &w2.LockedAmount, &w2.IsFrozen)
	if err != nil {
		return nil, nil, fmt.Errorf("lock second wallet: %w", err)
	}

	// Return in sender/receiver order
	if w1.UserID == id1 {
		return &w1, &w2, nil
	}
	return &w2, &w1, nil
}

// Handler holds P2P transfer HTTP handlers.
type Handler struct {
	service *Service
}

// NewHandler creates transfer handlers.
func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// HandleTransfer processes P2P transfer requests.
func (h *Handler) HandleTransfer(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req struct {
		ReceiverID     string `json:"receiver_id" binding:"required"`
		Amount         string `json:"amount" binding:"required"`
		IdempotencyKey string `json:"idempotency_key" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	senderID, err := uuid.Parse(user.ID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid sender ID"})
		return
	}

	receiverID, err := uuid.Parse(req.ReceiverID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid receiver ID"})
		return
	}

	amount, err := decimal.NewFromString(req.Amount)
	if err != nil || !amount.IsPositive() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid amount"})
		return
	}

	err = h.service.Transfer(c.Request.Context(), senderID, receiverID, amount, req.IdempotencyKey)
	if err != nil {
		switch err {
		case walletPkg.ErrSelfTransfer:
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		case walletPkg.ErrInsufficientBalance:
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		case walletPkg.ErrWalletFrozen:
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		case walletPkg.ErrWalletNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		default:
			h.service.logger.Error("transfer failed", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "transfer failed"})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"status":  "completed",
		"amount":  amount.StringFixed(2),
		"message": "Transfer successful",
	}})
}
