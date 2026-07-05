package rewards

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	internalKafka "nexus/rides/internal/kafka"
)

// Service provides rewards and loyalty business logic.
type Service struct {
	repo             *Repository
	pool             *pgxpool.Pool
	rdb              *redis.Client
	kafka            *internalKafka.Producer
	logger           *zap.Logger
	pointsPerRide    int
	referralBonus    int
}

// NewService creates a new rewards service.
func NewService(repo *Repository, pool *pgxpool.Pool, rdb *redis.Client, kafka *internalKafka.Producer, logger *zap.Logger, pointsPerRide, referralBonus int) *Service {
	if pointsPerRide <= 0 {
		pointsPerRide = 10
	}
	if referralBonus <= 0 {
		referralBonus = 50
	}
	return &Service{repo: repo, pool: pool, rdb: rdb, kafka: kafka, logger: logger, pointsPerRide: pointsPerRide, referralBonus: referralBonus}
}

// GetBalance returns the user's current balance.
func (s *Service) GetBalance(ctx context.Context, userID uuid.UUID) (*Balance, error) {
	return s.repo.GetBalance(ctx, userID)
}

// GetTierInfo returns tier details and progress to next tier.
func (s *Service) GetTierInfo(ctx context.Context, userID uuid.UUID) (*TierInfo, error) {
	balance, err := s.repo.GetBalance(ctx, userID)
	if err != nil {
		return nil, err
	}

	tiers := []struct {
		name       string
		min        int
		multiplier float64
		benefits   []string
	}{
		{"bronze", 0, 1.0, []string{"Base ride rewards", "Access to challenges"}},
		{"silver", 3000, 1.15, []string{"1.15x points multiplier", "Priority support", "Monthly bonus"}},
		{"gold", 8000, 1.3, []string{"1.3x points multiplier", "Free cancellation", "Exclusive challenges", "Birthday bonus"}},
		{"platinum", 20000, 1.5, []string{"1.5x points multiplier", "VIP support", "Free upgrades", "Partner perks"}},
		{"diamond", 50000, 2.0, []string{"2x points multiplier", "Dedicated concierge", "All platinum benefits", "Invite-only events"}},
	}

	var info TierInfo
	for i, t := range tiers {
		if t.name == balance.Tier {
			info.Tier = t.name
			info.MinPoints = t.min
			info.Benefits = t.benefits
			info.Multiplier = t.multiplier
			info.CurrentPoints = balance.LifetimePoints
			if i < len(tiers)-1 {
				next := tiers[i+1]
				info.NextTier = &next.name
				diff := next.min - balance.LifetimePoints
				info.PointsToNext = &diff
			}
			break
		}
	}
	return &info, nil
}

// EarnPoints awards points for a ride completion.
func (s *Service) EarnPoints(ctx context.Context, userID uuid.UUID, rideID uuid.UUID, rideType string) (*Balance, error) {
	balance, err := s.repo.GetBalance(ctx, userID)
	if err != nil {
		return nil, err
	}

	// Calculate multipliers
	tierMultiplier := s.getTierMultiplier(balance.Tier)
	streakMultiplier := s.getStreakMultiplier(balance.CurrentStreak)
	totalMultiplier := tierMultiplier * streakMultiplier

	// Bonus for pool rides
	points := s.pointsPerRide
	if rideType == "pool" {
		points = int(float64(points) * 1.5)
	}

	desc := fmt.Sprintf("Ride completed (+%d base × %.2fx multiplier)", points, totalMultiplier)
	newBalance, err := s.repo.EarnPoints(ctx, userID, points, "ride_completed", desc, &rideID, totalMultiplier)
	if err != nil {
		return nil, err
	}

	// Update streak
	_, _ = s.repo.UpdateStreak(ctx, userID)

	_ = s.kafka.Publish(ctx, "nexus.rewards.points_earned", userID.String(), internalKafka.Event{
		Type: "nexus.rewards.points_earned",
		Payload: map[string]interface{}{
			"user_id": userID, "ride_id": rideID, "points": points,
			"multiplier": totalMultiplier, "new_balance": newBalance.Points,
		},
	})

	return newBalance, nil
}

// RedeemPoints redeems points for a discount. Returns discount amount in INR.
func (s *Service) RedeemPoints(ctx context.Context, userID uuid.UUID, input RedeemInput) (float64, error) {
	if input.Points < 10 {
		return 0, fmt.Errorf("minimum redemption is 10 points")
	}
	discount, err := s.repo.RedeemPoints(ctx, userID, input.Points, input.RideID)
	if err != nil {
		return 0, err
	}
	_ = s.kafka.Publish(ctx, "nexus.rewards.points_redeemed", userID.String(), internalKafka.Event{
		Type: "nexus.rewards.points_redeemed",
		Payload: map[string]interface{}{
			"user_id": userID, "points": input.Points, "discount": discount, "ride_id": input.RideID,
		},
	})
	return discount, nil
}

// GetTransactionHistory returns paginated transactions.
func (s *Service) GetTransactionHistory(ctx context.Context, userID uuid.UUID, txType *string, limit int) ([]Transaction, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	return s.repo.GetTransactions(ctx, userID, txType, limit)
}

// GetStreakInfo returns current streak info.
func (s *Service) GetStreakInfo(ctx context.Context, userID uuid.UUID) (*StreakInfo, error) {
	balance, err := s.repo.GetBalance(ctx, userID)
	if err != nil {
		return nil, err
	}
	streak := balance.CurrentStreak
	milestones := []int{3, 7, 14, 30, 60, 100}
	nextMilestone := milestones[len(milestones)-1]
	for _, m := range milestones {
		if streak < m {
			nextMilestone = m
			break
		}
	}
	return &StreakInfo{
		CurrentStreak:   streak,
		LongestStreak:   balance.LongestStreak,
		LastRideDate:    balance.LastRideDate,
		NextMilestone:   nextMilestone,
		StreakMultiplier: s.getStreakMultiplier(streak),
	}, nil
}

// GetActiveChallenges returns available challenges for the user.
func (s *Service) GetActiveChallenges(ctx context.Context, userID uuid.UUID) ([]Challenge, error) {
	balance, err := s.repo.GetBalance(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.repo.GetActiveChallenges(ctx, balance.Tier, nil)
}

// GetChallengeProgress returns user's progress on challenges.
func (s *Service) GetChallengeProgress(ctx context.Context, userID uuid.UUID) ([]ChallengeProgress, error) {
	return s.repo.GetChallengeProgress(ctx, userID)
}

// ClaimChallengeReward claims a completed challenge's reward.
func (s *Service) ClaimChallengeReward(ctx context.Context, userID, challengeID uuid.UUID) (int, error) {
	points, err := s.repo.ClaimChallenge(ctx, userID, challengeID)
	if err != nil {
		return 0, err
	}
	_ = s.kafka.Publish(ctx, "nexus.rewards.challenge_claimed", userID.String(), internalKafka.Event{
		Type: "nexus.rewards.challenge_claimed",
		Payload: map[string]interface{}{"user_id": userID, "challenge_id": challengeID, "points": points},
	})
	return points, nil
}

// GetReferralInfo returns referral program info.
func (s *Service) GetReferralInfo(ctx context.Context, userID uuid.UUID) (*ReferralInfo, error) {
	balance, err := s.repo.GetBalance(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &ReferralInfo{
		Code:             balance.ReferralCode,
		TotalReferrals:   balance.TotalReferrals,
		BonusPerReferral: s.referralBonus,
		TotalEarned:      balance.TotalReferrals * s.referralBonus,
	}, nil
}

func (s *Service) getTierMultiplier(tier string) float64 {
	switch tier {
	case "silver":
		return 1.15
	case "gold":
		return 1.30
	case "platinum":
		return 1.50
	case "diamond":
		return 2.00
	default:
		return 1.00
	}
}

func (s *Service) getStreakMultiplier(streak int) float64 {
	switch {
	case streak >= 30:
		return 2.00
	case streak >= 14:
		return 1.75
	case streak >= 7:
		return 1.50
	case streak >= 4:
		return 1.25
	default:
		return 1.00
	}
}
