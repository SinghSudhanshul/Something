package rewards

import (
	"time"

	"github.com/google/uuid"
)

// Balance holds a user's reward points balance.
type Balance struct {
	UserID         uuid.UUID  `json:"user_id"`
	Points         int        `json:"points"`
	Tier           string     `json:"tier"`
	LifetimePoints int        `json:"lifetime_points"`
	CurrentStreak  int        `json:"current_streak"`
	LongestStreak  int        `json:"longest_streak"`
	LastRideDate   *string    `json:"last_ride_date"`
	ReferralCode   string     `json:"referral_code"`
	ReferredBy     *uuid.UUID `json:"referred_by,omitempty"`
	TotalReferrals int        `json:"total_referrals"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// Transaction holds a single reward points transaction.
type Transaction struct {
	ID           uuid.UUID  `json:"id"`
	UserID       uuid.UUID  `json:"user_id"`
	Points       int        `json:"points"`
	Type         string     `json:"type"`
	Source       string     `json:"source"`
	ReferenceID  *uuid.UUID `json:"reference_id,omitempty"`
	Description  *string    `json:"description,omitempty"`
	BalanceAfter int        `json:"balance_after"`
	Multiplier   float64    `json:"multiplier"`
	ExpiresAt    *time.Time `json:"expires_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

// Challenge holds a reward challenge/mission.
type Challenge struct {
	ID             uuid.UUID  `json:"id"`
	Title          string     `json:"title"`
	Description    string     `json:"description"`
	IconURL        *string    `json:"icon_url,omitempty"`
	ChallengeType  string     `json:"challenge_type"`
	TargetValue    int        `json:"target_value"`
	RewardPoints   int        `json:"reward_points"`
	CampusID       *uuid.UUID `json:"campus_id,omitempty"`
	TierRequired   *string    `json:"tier_required,omitempty"`
	StartsAt       time.Time  `json:"starts_at"`
	EndsAt         time.Time  `json:"ends_at"`
	IsActive       bool       `json:"is_active"`
	MaxCompletions *int       `json:"max_completions,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

// ChallengeProgress tracks user's progress on a challenge.
type ChallengeProgress struct {
	ID          uuid.UUID  `json:"id"`
	UserID      uuid.UUID  `json:"user_id"`
	ChallengeID uuid.UUID  `json:"challenge_id"`
	Challenge   *Challenge `json:"challenge,omitempty"`
	CurrentValue int       `json:"current_value"`
	Completed   bool       `json:"completed"`
	Claimed     bool       `json:"claimed"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	ClaimedAt   *time.Time `json:"claimed_at,omitempty"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// TierInfo describes a reward tier and its benefits.
type TierInfo struct {
	Tier         string   `json:"tier"`
	MinPoints    int      `json:"min_points"`
	Benefits     []string `json:"benefits"`
	Multiplier   float64  `json:"multiplier"`
	NextTier     *string  `json:"next_tier,omitempty"`
	PointsToNext *int     `json:"points_to_next,omitempty"`
	CurrentPoints int     `json:"current_points"`
}

// StreakInfo holds streak data.
type StreakInfo struct {
	CurrentStreak   int     `json:"current_streak"`
	LongestStreak   int     `json:"longest_streak"`
	LastRideDate    *string `json:"last_ride_date,omitempty"`
	NextMilestone   int     `json:"next_milestone"`
	StreakMultiplier float64 `json:"streak_multiplier"`
}

// ReferralInfo holds referral program data.
type ReferralInfo struct {
	Code            string `json:"code"`
	TotalReferrals  int    `json:"total_referrals"`
	BonusPerReferral int   `json:"bonus_per_referral"`
	TotalEarned     int    `json:"total_earned"`
}

// RedeemInput holds input for points redemption.
type RedeemInput struct {
	Points int       `json:"points" binding:"required,min=10"`
	RideID uuid.UUID `json:"ride_id" binding:"required"`
}
