package wallet

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"

	"nexus/wallet/internal/wallet/models"
)

// Service handles all wallet operations with STRICT ACID compliance.
type Service struct {
	db     *pgxpool.Pool
	logger *zap.Logger
}

// NewService creates a new wallet service.
func NewService(db *pgxpool.Pool, logger *zap.Logger) *Service {
	return &Service{db: db, logger: logger}
}

// CreateWallet creates a new wallet for a user.
func (s *Service) CreateWallet(ctx context.Context, userID uuid.UUID) (*models.Wallet, error) {
	var w models.Wallet
	err := s.db.QueryRow(ctx,
		`INSERT INTO wallets (id, user_id, balance, locked_amount, daily_spent, daily_limit, is_frozen, currency, created_at, updated_at)
		 VALUES ($1, $2, '0.00', '0.00', '0.00', '10000.00', false, 'INR', NOW(), NOW())
		 RETURNING id, user_id, balance, locked_amount, daily_spent, daily_limit, is_frozen, currency, created_at, updated_at`,
		uuid.New(), userID,
	).Scan(&w.ID, &w.UserID, &w.Balance, &w.LockedAmount, &w.DailySpent, &w.DailyLimit, &w.IsFrozen, &w.Currency, &w.CreatedAt, &w.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create wallet: %w", err)
	}
	return &w, nil
}

// GetWallet retrieves a wallet by user ID.
func (s *Service) GetWallet(ctx context.Context, userID uuid.UUID) (*models.Wallet, error) {
	var w models.Wallet
	err := s.db.QueryRow(ctx,
		`SELECT id, user_id, balance, locked_amount, daily_spent, daily_limit, is_frozen, currency, created_at, updated_at
		 FROM wallets WHERE user_id = $1`, userID,
	).Scan(&w.ID, &w.UserID, &w.Balance, &w.LockedAmount, &w.DailySpent, &w.DailyLimit, &w.IsFrozen, &w.Currency, &w.CreatedAt, &w.UpdatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrWalletNotFound
		}
		return nil, fmt.Errorf("get wallet: %w", err)
	}
	return &w, nil
}

// CreditWallet atomically credits a wallet and appends a ledger entry.
func (s *Service) CreditWallet(ctx context.Context, userID uuid.UUID, amount decimal.Decimal, description, idempotencyKey string, txnID *uuid.UUID) error {
	if !amount.IsPositive() {
		return ErrInvalidAmount
	}

	return s.withTransaction(ctx, func(tx pgx.Tx) error {
		// Idempotency check
		exists, err := s.ledgerExistsByKey(ctx, tx, idempotencyKey)
		if err != nil {
			return err
		}
		if exists {
			return nil // Already processed
		}

		// Lock wallet row
		var w models.Wallet
		err = tx.QueryRow(ctx,
			`SELECT id, balance, locked_amount, is_frozen FROM wallets WHERE user_id = $1 FOR UPDATE`, userID,
		).Scan(&w.ID, &w.Balance, &w.LockedAmount, &w.IsFrozen)
		if err != nil {
			if err == pgx.ErrNoRows {
				return ErrWalletNotFound
			}
			return err
		}

		newBalance := w.Balance.Add(amount)

		_, err = tx.Exec(ctx,
			`UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2`,
			newBalance.StringFixed(2), w.ID)
		if err != nil {
			return err
		}

		// Append ledger entry
		_, err = tx.Exec(ctx,
			`INSERT INTO wallet_ledger (wallet_id, transaction_id, entry_type, amount, balance_after, locked_after, description, idempotency_key, created_at)
			 VALUES ($1, $2, 'credit', $3, $4, $5, $6, $7, NOW())`,
			w.ID, txnID, amount.StringFixed(2), newBalance.StringFixed(2), w.LockedAmount.StringFixed(2), description, idempotencyKey)
		return err
	})
}

// DebitWallet atomically debits a wallet with balance and daily limit checks.
func (s *Service) DebitWallet(ctx context.Context, userID uuid.UUID, amount decimal.Decimal, description, idempotencyKey string, txnID *uuid.UUID) error {
	if !amount.IsPositive() {
		return ErrInvalidAmount
	}

	return s.withTransaction(ctx, func(tx pgx.Tx) error {
		exists, err := s.ledgerExistsByKey(ctx, tx, idempotencyKey)
		if err != nil {
			return err
		}
		if exists {
			return nil
		}

		var w models.Wallet
		err = tx.QueryRow(ctx,
			`SELECT id, balance, locked_amount, daily_spent, daily_limit, is_frozen FROM wallets WHERE user_id = $1 FOR UPDATE`, userID,
		).Scan(&w.ID, &w.Balance, &w.LockedAmount, &w.DailySpent, &w.DailyLimit, &w.IsFrozen)
		if err != nil {
			if err == pgx.ErrNoRows {
				return ErrWalletNotFound
			}
			return err
		}

		if w.IsFrozen {
			return ErrWalletFrozen
		}
		if w.Balance.LessThan(amount) {
			return ErrInsufficientBalance
		}
		if w.DailySpent.Add(amount).GreaterThan(w.DailyLimit) {
			return ErrDailyLimitExceeded
		}

		newBalance := w.Balance.Sub(amount)
		newDailySpent := w.DailySpent.Add(amount)

		_, err = tx.Exec(ctx,
			`UPDATE wallets SET balance = $1, daily_spent = $2, updated_at = NOW() WHERE id = $3`,
			newBalance.StringFixed(2), newDailySpent.StringFixed(2), w.ID)
		if err != nil {
			return err
		}

		_, err = tx.Exec(ctx,
			`INSERT INTO wallet_ledger (wallet_id, transaction_id, entry_type, amount, balance_after, locked_after, description, idempotency_key, created_at)
			 VALUES ($1, $2, 'debit', $3, $4, $5, $6, $7, NOW())`,
			w.ID, txnID, amount.StringFixed(2), newBalance.StringFixed(2), w.LockedAmount.StringFixed(2), description, idempotencyKey)
		return err
	})
}

// LockEscrow atomically locks funds for escrow.
func (s *Service) LockEscrow(ctx context.Context, buyerID uuid.UUID, amount decimal.Decimal, transactionID uuid.UUID, idempotencyKey string) error {
	if !amount.IsPositive() {
		return ErrInvalidAmount
	}

	// Idempotency check BEFORE acquiring lock
	var exists bool
	err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM wallet_ledger WHERE idempotency_key = $1)`, idempotencyKey,
	).Scan(&exists)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}

	return s.withTransaction(ctx, func(tx pgx.Tx) error {
		var w models.Wallet
		err := tx.QueryRow(ctx,
			`SELECT id, balance, locked_amount, daily_spent, daily_limit, is_frozen
			 FROM wallets WHERE user_id = $1 FOR UPDATE`, buyerID,
		).Scan(&w.ID, &w.Balance, &w.LockedAmount, &w.DailySpent, &w.DailyLimit, &w.IsFrozen)
		if err != nil {
			if err == pgx.ErrNoRows {
				return ErrWalletNotFound
			}
			return err
		}

		if w.IsFrozen {
			return ErrWalletFrozen
		}
		if w.Balance.LessThan(amount) {
			return ErrInsufficientBalance
		}
		if w.DailySpent.Add(amount).GreaterThan(w.DailyLimit) {
			return ErrDailyLimitExceeded
		}

		newBalance := w.Balance.Sub(amount)
		newLocked := w.LockedAmount.Add(amount)

		_, err = tx.Exec(ctx,
			`UPDATE wallets SET balance = $1, locked_amount = $2, updated_at = NOW() WHERE id = $3`,
			newBalance.StringFixed(2), newLocked.StringFixed(2), w.ID)
		if err != nil {
			return err
		}

		txnID := transactionID
		_, err = tx.Exec(ctx,
			`INSERT INTO wallet_ledger (wallet_id, transaction_id, entry_type, amount, balance_after, locked_after, description, idempotency_key, created_at)
			 VALUES ($1, $2, 'lock', $3, $4, $5, $6, $7, NOW())`,
			w.ID, &txnID, amount.StringFixed(2), newBalance.StringFixed(2), newLocked.StringFixed(2),
			fmt.Sprintf("Escrow lock for transaction %s", transactionID.String()), idempotencyKey)
		return err
	})
}

// ReleaseEscrow releases locked funds to a seller.
func (s *Service) ReleaseEscrow(ctx context.Context, buyerID, sellerID uuid.UUID, amount decimal.Decimal, transactionID uuid.UUID, idempotencyKey string) error {
	if !amount.IsPositive() {
		return ErrInvalidAmount
	}

	return s.withTransaction(ctx, func(tx pgx.Tx) error {
		exists, err := s.ledgerExistsByKey(ctx, tx, idempotencyKey)
		if err != nil {
			return err
		}
		if exists {
			return nil
		}

		// Lock both wallets in consistent order (smaller UUID first)
		first, second := buyerID, sellerID
		if buyerID.String() > sellerID.String() {
			first, second = sellerID, buyerID
		}

		var w1, w2 models.Wallet
		err = tx.QueryRow(ctx,
			`SELECT id, user_id, balance, locked_amount FROM wallets WHERE user_id = $1 FOR UPDATE`, first,
		).Scan(&w1.ID, &w1.UserID, &w1.Balance, &w1.LockedAmount)
		if err != nil {
			return fmt.Errorf("lock first wallet: %w", err)
		}

		err = tx.QueryRow(ctx,
			`SELECT id, user_id, balance, locked_amount FROM wallets WHERE user_id = $1 FOR UPDATE`, second,
		).Scan(&w2.ID, &w2.UserID, &w2.Balance, &w2.LockedAmount)
		if err != nil {
			return fmt.Errorf("lock second wallet: %w", err)
		}

		// Identify buyer and seller wallets
		var buyerWallet, sellerWallet *models.Wallet
		if w1.UserID == buyerID {
			buyerWallet = &w1
			sellerWallet = &w2
		} else {
			buyerWallet = &w2
			sellerWallet = &w1
		}

		// Unlock buyer
		newBuyerLocked := buyerWallet.LockedAmount.Sub(amount)
		_, err = tx.Exec(ctx,
			`UPDATE wallets SET locked_amount = $1, updated_at = NOW() WHERE id = $2`,
			newBuyerLocked.StringFixed(2), buyerWallet.ID)
		if err != nil {
			return err
		}

		// Credit seller
		newSellerBalance := sellerWallet.Balance.Add(amount)
		_, err = tx.Exec(ctx,
			`UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2`,
			newSellerBalance.StringFixed(2), sellerWallet.ID)
		if err != nil {
			return err
		}

		txnID := transactionID

		// Buyer ledger: unlock
		_, err = tx.Exec(ctx,
			`INSERT INTO wallet_ledger (wallet_id, transaction_id, entry_type, amount, balance_after, locked_after, description, idempotency_key, created_at)
			 VALUES ($1, $2, 'unlock', $3, $4, $5, $6, $7, NOW())`,
			buyerWallet.ID, &txnID, amount.StringFixed(2), buyerWallet.Balance.StringFixed(2), newBuyerLocked.StringFixed(2),
			"Escrow released", idempotencyKey+"-buyer")
		if err != nil {
			return err
		}

		// Seller ledger: credit
		_, err = tx.Exec(ctx,
			`INSERT INTO wallet_ledger (wallet_id, transaction_id, entry_type, amount, balance_after, locked_after, description, idempotency_key, created_at)
			 VALUES ($1, $2, 'credit', $3, $4, $5, $6, $7, NOW())`,
			sellerWallet.ID, &txnID, amount.StringFixed(2), newSellerBalance.StringFixed(2), sellerWallet.LockedAmount.StringFixed(2),
			"Escrow payment received", idempotencyKey+"-seller")
		return err
	})
}

// RefundEscrow refunds locked escrow funds to the buyer.
func (s *Service) RefundEscrow(ctx context.Context, buyerID uuid.UUID, amount decimal.Decimal, transactionID uuid.UUID, idempotencyKey string) error {
	if !amount.IsPositive() {
		return ErrInvalidAmount
	}

	return s.withTransaction(ctx, func(tx pgx.Tx) error {
		exists, err := s.ledgerExistsByKey(ctx, tx, idempotencyKey)
		if err != nil {
			return err
		}
		if exists {
			return nil
		}

		var w models.Wallet
		err = tx.QueryRow(ctx,
			`SELECT id, balance, locked_amount FROM wallets WHERE user_id = $1 FOR UPDATE`, buyerID,
		).Scan(&w.ID, &w.Balance, &w.LockedAmount)
		if err != nil {
			return err
		}

		newBalance := w.Balance.Add(amount)
		newLocked := w.LockedAmount.Sub(amount)

		_, err = tx.Exec(ctx,
			`UPDATE wallets SET balance = $1, locked_amount = $2, updated_at = NOW() WHERE id = $3`,
			newBalance.StringFixed(2), newLocked.StringFixed(2), w.ID)
		if err != nil {
			return err
		}

		txnID := transactionID
		_, err = tx.Exec(ctx,
			`INSERT INTO wallet_ledger (wallet_id, transaction_id, entry_type, amount, balance_after, locked_after, description, idempotency_key, created_at)
			 VALUES ($1, $2, 'credit', $3, $4, $5, $6, $7, NOW())`,
			w.ID, &txnID, amount.StringFixed(2), newBalance.StringFixed(2), newLocked.StringFixed(2),
			"Escrow refund", idempotencyKey)
		return err
	})
}

// GetLedger returns paginated ledger entries for a wallet.
func (s *Service) GetLedger(ctx context.Context, userID uuid.UUID, limit, offset int) ([]models.LedgerEntry, error) {
	rows, err := s.db.Query(ctx,
		`SELECT wl.id, wl.wallet_id, wl.transaction_id, wl.entry_type, wl.amount, wl.balance_after, wl.locked_after, wl.description, wl.idempotency_key, wl.created_at
		 FROM wallet_ledger wl
		 JOIN wallets w ON w.id = wl.wallet_id
		 WHERE w.user_id = $1
		 ORDER BY wl.created_at DESC
		 LIMIT $2 OFFSET $3`, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []models.LedgerEntry
	for rows.Next() {
		var e models.LedgerEntry
		err := rows.Scan(&e.ID, &e.WalletID, &e.TransactionID, &e.EntryType, &e.Amount, &e.BalanceAfter, &e.LockedAfter, &e.Description, &e.IdempotencyKey, &e.CreatedAt)
		if err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, nil
}

// StartDailyLimitReset resets daily_spent at midnight IST every day.
func (s *Service) StartDailyLimitReset(ctx context.Context) {
	go func() {
		for {
			now := time.Now().In(time.FixedZone("IST", 5*3600+30*60))
			next := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, now.Location())
			timer := time.NewTimer(next.Sub(now))

			select {
			case <-timer.C:
				_, err := s.db.Exec(ctx, `UPDATE wallets SET daily_spent = '0.00', updated_at = NOW()`)
				if err != nil {
					s.logger.Error("failed to reset daily spent", zap.Error(err))
				} else {
					s.logger.Info("daily spent reset completed")
				}
			case <-ctx.Done():
				timer.Stop()
				return
			}
		}
	}()
}

// Helper: run a function within a pgx transaction.
func (s *Service) withTransaction(ctx context.Context, fn func(tx pgx.Tx) error) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Helper: check if a ledger entry with the given idempotency key exists.
func (s *Service) ledgerExistsByKey(ctx context.Context, tx pgx.Tx, key string) (bool, error) {
	var exists bool
	err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM wallet_ledger WHERE idempotency_key = $1)`, key,
	).Scan(&exists)
	return exists, err
}
