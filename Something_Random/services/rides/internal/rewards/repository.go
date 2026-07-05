package rewards

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Errors.
var (
	ErrBalanceNotFound  = errors.New("balance not found")
	ErrInsufficient     = errors.New("insufficient points")
	ErrChallengeMissing = errors.New("challenge not found")
	ErrNotCompleted     = errors.New("challenge not yet completed")
	ErrAlreadyClaimed   = errors.New("challenge already claimed")
)

// Repository owns ride_rewards SQL.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a repo.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

// GetBalance loads or creates the user's balance.
func (r *Repository) GetBalance(ctx context.Context, userID uuid.UUID) (*Balance, error) {
	code := generateReferralCode()
	_, err := r.pool.Exec(ctx, `
		INSERT INTO ride_rewards (user_id, points, lifetime_points, tier, referral_code, current_streak, longest_streak)
		VALUES ($1, 0, 0, 'bronze', $2, 0, 0)
		ON CONFLICT (user_id) DO NOTHING`, userID, code)
	if err != nil {
		return nil, err
	}
	var b Balance
	err = r.pool.QueryRow(ctx, `
		SELECT user_id, points, tier, lifetime_points, current_streak, longest_streak,
		       last_ride_date::text, referral_code, referred_by, total_referrals, updated_at
		FROM ride_rewards WHERE user_id = $1`, userID).Scan(
		&b.UserID, &b.Points, &b.Tier, &b.LifetimePoints,
		&b.CurrentStreak, &b.LongestStreak, &b.LastRideDate, &b.ReferralCode,
		&b.ReferredBy, &b.TotalReferrals, &b.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &b, nil
}

// EarnPoints adds points and writes a transaction.
func (r *Repository) EarnPoints(ctx context.Context, userID uuid.UUID, points int, source, description string, referenceID *uuid.UUID, multiplier float64) (*Balance, error) {
	actual := int(float64(points) * multiplier)
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var newBalance, newLifetime int
	err = tx.QueryRow(ctx, `
		UPDATE ride_rewards SET points = points + $2, lifetime_points = lifetime_points + $2
		WHERE user_id = $1 RETURNING points, lifetime_points`, userID, actual).Scan(&newBalance, &newLifetime)
	if err != nil {
		return nil, err
	}
	_, _ = tx.Exec(ctx, `
		UPDATE ride_rewards SET tier = (CASE
		    WHEN $2 >= 50000 THEN 'diamond'
		    WHEN $2 >= 20000 THEN 'platinum'
		    WHEN $2 >= 8000 THEN 'gold'
		    WHEN $2 >= 3000 THEN 'silver'
		    ELSE 'bronze' END)
		WHERE user_id = $1`, userID, newLifetime)
	expiresAt := time.Now().AddDate(1, 0, 0)
	_, err = tx.Exec(ctx, `
		INSERT INTO ride_reward_transactions (
			user_id, points, type, source, reference_id, description, balance_after, multiplier, expires_at
		) VALUES ($1, $2, 'earned', $3, $4, $5, $6, $7, $8)`,
		userID, actual, source, referenceID, description, newBalance, multiplier, expiresAt)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetBalance(ctx, userID)
}

// RedeemPoints deducts points and writes a redemption row. Returns discount in INR.
func (r *Repository) RedeemPoints(ctx context.Context, userID uuid.UUID, points int, rideID uuid.UUID) (float64, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var current int
	err = tx.QueryRow(ctx, `SELECT points FROM ride_rewards WHERE user_id = $1 FOR UPDATE`, userID).Scan(&current)
	if err != nil {
		return 0, ErrBalanceNotFound
	}
	if current < points {
		return 0, ErrInsufficient
	}
	newBalance := current - points
	_, err = tx.Exec(ctx, `UPDATE ride_rewards SET points = $2 WHERE user_id = $1`, userID, newBalance)
	if err != nil {
		return 0, err
	}
	discount := float64(points) * 0.10
	desc := fmt.Sprintf("Redeemed %d points for ₹%.2f discount", points, discount)
	_, err = tx.Exec(ctx, `
		INSERT INTO ride_reward_transactions (
			user_id, points, type, source, reference_id, description, balance_after, multiplier
		) VALUES ($1, $2, 'redeemed', 'ride_completed', $3, $4, $5, 1.00)`,
		userID, -points, rideID, desc, newBalance)
	if err != nil {
		return 0, err
	}
	return discount, tx.Commit(ctx)
}

// GetTransactions returns history.
func (r *Repository) GetTransactions(ctx context.Context, userID uuid.UUID, txType *string, limit int) ([]Transaction, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := `SELECT id, user_id, points, type, source, reference_id, description,
	             balance_after, multiplier, expires_at, created_at
	      FROM ride_reward_transactions WHERE user_id = $1`
	args := []any{userID}
	idx := 2
	if txType != nil {
		q += fmt.Sprintf(" AND type = $%d", idx)
		args = append(args, *txType)
		idx++
	}
	q += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d", idx)
	args = append(args, limit)
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Transaction{}
	for rows.Next() {
		var t Transaction
		if err := rows.Scan(&t.ID, &t.UserID, &t.Points, &t.Type, &t.Source,
			&t.ReferenceID, &t.Description, &t.BalanceAfter, &t.Multiplier,
			&t.ExpiresAt, &t.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// UpdateStreak updates the streak based on the last ride date.
func (r *Repository) UpdateStreak(ctx context.Context, userID uuid.UUID) (int, error) {
	today := time.Now().Format("2006-01-02")
	var lastRideDate *string
	var currentStreak, longestStreak int
	err := r.pool.QueryRow(ctx, `
		SELECT last_ride_date::text, current_streak, longest_streak
		FROM ride_rewards WHERE user_id = $1`, userID).Scan(&lastRideDate, &currentStreak, &longestStreak)
	if err != nil {
		return 0, err
	}
	if lastRideDate != nil && *lastRideDate == today {
		return currentStreak, nil
	}
	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	if lastRideDate != nil && *lastRideDate == yesterday {
		currentStreak++
	} else {
		currentStreak = 1
	}
	if currentStreak > longestStreak {
		longestStreak = currentStreak
	}
	_, err = r.pool.Exec(ctx, `
		UPDATE ride_rewards SET current_streak = $2, longest_streak = $3, last_ride_date = $4::date
		WHERE user_id = $1`, userID, currentStreak, longestStreak, today)
	return currentStreak, err
}

// GetActiveChallenges returns the catalogue of active challenges.
func (r *Repository) GetActiveChallenges(ctx context.Context, userTier string, campusID *uuid.UUID) ([]Challenge, error) {
	q := `
		SELECT id, title, description, icon_url, challenge_type, target_value, reward_points,
		       campus_id, tier_required, starts_at, ends_at, is_active, max_completions, created_at
		FROM ride_reward_challenges
		WHERE is_active = true AND starts_at <= NOW() AND ends_at >= NOW()
		  AND (campus_id IS NULL OR ($1::uuid IS NULL OR campus_id = $1))`
	args := []any{campusID}
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Challenge{}
	for rows.Next() {
		var ch Challenge
		if err := rows.Scan(&ch.ID, &ch.Title, &ch.Description, &ch.IconURL,
			&ch.ChallengeType, &ch.TargetValue, &ch.RewardPoints, &ch.CampusID,
			&ch.TierRequired, &ch.StartsAt, &ch.EndsAt, &ch.IsActive,
			&ch.MaxCompletions, &ch.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, ch)
	}
	return out, rows.Err()
}

// GetChallengeProgress loads the user's progress on active challenges.
func (r *Repository) GetChallengeProgress(ctx context.Context, userID uuid.UUID) ([]ChallengeProgress, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT p.id, p.user_id, p.challenge_id, p.current_value,
		       p.completed, p.claimed, p.completed_at, p.claimed_at, p.updated_at,
		       c.title, c.description, c.challenge_type, c.target_value, c.reward_points, c.ends_at
		FROM ride_reward_challenge_progress p
		JOIN ride_reward_challenges c ON c.id = p.challenge_id
		WHERE p.user_id = $1 AND c.is_active = true
		ORDER BY p.completed ASC, c.ends_at ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ChallengeProgress{}
	for rows.Next() {
		var p ChallengeProgress
		var ch Challenge
		if err := rows.Scan(&p.ID, &p.UserID, &p.ChallengeID, &p.CurrentValue,
			&p.Completed, &p.Claimed, &p.CompletedAt, &p.ClaimedAt, &p.UpdatedAt,
			&ch.Title, &ch.Description, &ch.ChallengeType, &ch.TargetValue,
			&ch.RewardPoints, &ch.EndsAt); err != nil {
			return nil, err
		}
		ch.ID = p.ChallengeID
		p.Challenge = &ch
		out = append(out, p)
	}
	return out, rows.Err()
}

// ClaimChallenge marks a challenge as claimed and awards points.
func (r *Repository) ClaimChallenge(ctx context.Context, userID, challengeID uuid.UUID) (int, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var completed, claimed bool
	var rewardPoints int
	err = tx.QueryRow(ctx, `
		SELECT p.completed, p.claimed, c.reward_points
		FROM ride_reward_challenge_progress p
		JOIN ride_reward_challenges c ON c.id = p.challenge_id
		WHERE p.user_id = $1 AND p.challenge_id = $2`, userID, challengeID).Scan(&completed, &claimed, &rewardPoints)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrChallengeMissing
		}
		return 0, err
	}
	if !completed {
		return 0, ErrNotCompleted
	}
	if claimed {
		return 0, ErrAlreadyClaimed
	}
	_, err = tx.Exec(ctx, `
		UPDATE ride_reward_challenge_progress SET claimed = true, claimed_at = NOW()
		WHERE user_id = $1 AND challenge_id = $2`, userID, challengeID)
	if err != nil {
		return 0, err
	}
	var newBalance int
	err = tx.QueryRow(ctx, `
		UPDATE ride_rewards SET points = points + $2, lifetime_points = lifetime_points + $2
		WHERE user_id = $1 RETURNING points`, userID, rewardPoints).Scan(&newBalance)
	if err != nil {
		return 0, err
	}
	_, _ = tx.Exec(ctx, `
		INSERT INTO ride_reward_transactions (
			user_id, points, type, source, reference_id, description, balance_after, multiplier
		) VALUES ($1, $2, 'earned', 'challenge', $3, $4, $5, 1.00)`,
		userID, rewardPoints, challengeID, "Challenge reward claimed", newBalance)
	return rewardPoints, tx.Commit(ctx)
}

// CreateChallenge inserts a new challenge (admin).
func (r *Repository) CreateChallenge(ctx context.Context, ch *Challenge) (*Challenge, error) {
	var out Challenge
	err := r.pool.QueryRow(ctx, `
		INSERT INTO ride_reward_challenges (
			title, description, icon_url, challenge_type, target_value, reward_points,
			campus_id, tier_required, starts_at, ends_at, is_active, max_completions
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		RETURNING id, title, description, icon_url, challenge_type, target_value, reward_points,
		          campus_id, tier_required, starts_at, ends_at, is_active, max_completions, created_at`,
		ch.Title, ch.Description, ch.IconURL, ch.ChallengeType, ch.TargetValue, ch.RewardPoints,
		ch.CampusID, ch.TierRequired, ch.StartsAt, ch.EndsAt, ch.IsActive, ch.MaxCompletions,
	).Scan(&out.ID, &out.Title, &out.Description, &out.IconURL,
		&out.ChallengeType, &out.TargetValue, &out.RewardPoints,
		&out.CampusID, &out.TierRequired, &out.StartsAt, &out.EndsAt, &out.IsActive,
		&out.MaxCompletions, &out.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func generateReferralCode() string {
	const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	code := make([]byte, 8)
	for i := range code {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		code[i] = charset[n.Int64()]
	}
	return string(code)
}