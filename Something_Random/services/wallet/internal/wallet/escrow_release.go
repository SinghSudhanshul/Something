package wallet

import (
	"context"
	"time"

	"go.uber.org/zap"
)

// StartEscrowReleaseJob polls every 5 minutes for expired escrows.
func (s *Service) StartEscrowReleaseJob(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				s.releaseExpiredEscrows(ctx)
			case <-ctx.Done():
				return
			}
		}
	}()
	s.logger.Info("escrow auto-release job started (5 min interval)")
}

func (s *Service) releaseExpiredEscrows(ctx context.Context) {
	defer func() {
		if r := recover(); r != nil {
			s.logger.Error("escrow release panic", zap.Any("panic", r))
		}
	}()

	rows, err := s.db.Query(ctx,
		`SELECT id, buyer_id, seller_id, amount, platform_fee
		 FROM transactions
		 WHERE status = 'payment_held' AND escrow_release_at <= NOW()
		 LIMIT 100`)
	if err != nil {
		s.logger.Error("failed to query expired escrows", zap.Error(err))
		return
	}
	defer rows.Close()

	released := 0
	for rows.Next() {
		var txnID, buyerID, sellerID string
		var amount, platformFee string

		if err := rows.Scan(&txnID, &buyerID, &sellerID, &amount, &platformFee); err != nil {
			s.logger.Error("failed to scan escrow row", zap.Error(err))
			continue
		}

		// Skip if disputes exist (graceful check)
		var hasDispute bool
		err := s.db.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM disputes WHERE transaction_id = $1 AND status IN ('open', 'investigating'))`,
			txnID).Scan(&hasDispute)
		if err != nil {
			s.logger.Error("failed to check disputes", zap.Error(err), zap.String("txn_id", txnID))
			continue
		}
		if hasDispute {
			s.logger.Info("skipping escrow release — active dispute", zap.String("txn_id", txnID))
			continue
		}

		// Update transaction status
		_, err = s.db.Exec(ctx,
			`UPDATE transactions SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
			txnID)
		if err != nil {
			s.logger.Error("failed to complete transaction", zap.Error(err), zap.String("txn_id", txnID))
			continue
		}

		released++
		s.logger.Info("escrow auto-released",
			zap.String("txn_id", txnID),
			zap.String("amount", amount))
	}

	if released > 0 {
		s.logger.Info("escrow release batch completed", zap.Int("released", released))
	}
}
