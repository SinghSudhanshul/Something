package curator

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	internalKafka "nexus/rides/internal/kafka"
)

// Service provides curator shift and analytics business logic.
type Service struct {
	repo   *Repository
	pool   *pgxpool.Pool
	rdb    *redis.Client
	kafka  *internalKafka.Producer
	logger *zap.Logger
}

// NewService creates a new curator service.
func NewService(repo *Repository, pool *pgxpool.Pool, rdb *redis.Client, kafka *internalKafka.Producer, logger *zap.Logger) *Service {
	return &Service{repo: repo, pool: pool, rdb: rdb, kafka: kafka, logger: logger}
}

// StartShift starts a new shift for a driver.
func (s *Service) StartShift(ctx context.Context, driverID uuid.UUID, campusID uuid.UUID, lat, lng *float64) (*Shift, error) {
	// Check for existing active shift
	existing, err := s.repo.GetActiveShift(ctx, driverID)
	if err == nil && existing != nil {
		return nil, fmt.Errorf("already have an active shift")
	}

	shift, err := s.repo.StartShift(ctx, driverID, campusID, lat, lng)
	if err != nil {
		return nil, fmt.Errorf("failed to start shift: %w", err)
	}

	_ = s.kafka.Publish(ctx, "nexus.rides.shift_started", driverID.String(), internalKafka.Event{
		Type: "nexus.rides.shift_started",
		Payload: map[string]interface{}{
			"driver_id": driverID, "shift_id": shift.ID, "campus_id": campusID,
		},
	})

	s.logger.Info("shift started", zap.String("driver_id", driverID.String()), zap.String("shift_id", shift.ID.String()))
	return shift, nil
}

// EndShift ends the active shift for a driver.
func (s *Service) EndShift(ctx context.Context, driverID uuid.UUID, lat, lng *float64, notes *string) (*Shift, error) {
	shift, err := s.repo.GetActiveShift(ctx, driverID)
	if err != nil || shift == nil {
		return nil, fmt.Errorf("no active shift found")
	}

	completed, err := s.repo.EndShift(ctx, shift.ID, lat, lng, notes)
	if err != nil {
		return nil, fmt.Errorf("failed to end shift: %w", err)
	}

	_ = s.kafka.Publish(ctx, "nexus.rides.shift_ended", driverID.String(), internalKafka.Event{
		Type: "nexus.rides.shift_ended",
		Payload: map[string]interface{}{
			"driver_id": driverID, "shift_id": shift.ID,
			"total_rides": completed.TotalRides, "total_earnings": completed.TotalEarnings,
			"duration_min": completed.TotalOnlineMin,
		},
	})

	return completed, nil
}

// GetActiveShift returns the current active shift.
func (s *Service) GetActiveShift(ctx context.Context, driverID uuid.UUID) (*Shift, error) {
	return s.repo.GetActiveShift(ctx, driverID)
}

// GetShiftHistory returns past shifts for a driver.
func (s *Service) GetShiftHistory(ctx context.Context, driverID uuid.UUID, limit int, cursor *string) ([]Shift, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	return s.repo.GetShiftHistory(ctx, driverID, limit, cursor)
}

// GetShiftSummary returns detailed summary for a specific shift.
func (s *Service) GetShiftSummary(ctx context.Context, shiftID uuid.UUID) (*Shift, error) {
	return s.repo.GetShiftByID(ctx, shiftID)
}

// GetAnalytics returns performance analytics for a driver.
func (s *Service) GetAnalytics(ctx context.Context, driverID uuid.UUID, period string) (*Analytics, error) {
	if period == "" {
		period = "weekly"
	}
	var days int
	switch period {
	case "daily":
		days = 1
	case "weekly":
		days = 7
	case "monthly":
		days = 30
	default:
		days = 7
	}
	return s.repo.GetAnalytics(ctx, driverID, days)
}

// GetLeaderboard returns the campus leaderboard.
func (s *Service) GetLeaderboard(ctx context.Context, campusID uuid.UUID, metric, period string, limit int) ([]LeaderboardEntry, error) {
	if metric == "" {
		metric = "rides"
	}
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	var days int
	switch period {
	case "daily":
		days = 1
	case "weekly":
		days = 7
	case "monthly":
		days = 30
	case "all_time":
		days = 3650
	default:
		days = 7
	}
	return s.repo.GetLeaderboard(ctx, campusID, metric, days, limit)
}

// GetBadges returns all earned badges for a driver.
func (s *Service) GetBadges(ctx context.Context, driverID uuid.UUID) ([]Badge, error) {
	return s.repo.GetBadges(ctx, driverID)
}

// CheckAndAwardBadges checks milestone thresholds and awards badges.
func (s *Service) CheckAndAwardBadges(ctx context.Context, driverID uuid.UUID) error {
	milestones, err := s.repo.CheckMilestones(ctx, driverID)
	if err != nil {
		return err
	}
	for _, m := range milestones {
		_ = s.kafka.Publish(ctx, "nexus.rides.badge_earned", driverID.String(), internalKafka.Event{
			Type: "nexus.rides.badge_earned",
			Payload: map[string]interface{}{
				"driver_id": driverID, "badge_type": m.BadgeType, "title": m.Title,
			},
		})
	}
	return nil
}

// GetEarningsProjection returns projected earnings.
func (s *Service) GetEarningsProjection(ctx context.Context, driverID uuid.UUID) (*EarningsProjection, error) {
	return s.repo.GetEarningsProjection(ctx, driverID)
}

// GetTribeMembers returns other drivers in the same campus.
func (s *Service) GetTribeMembers(ctx context.Context, driverID uuid.UUID, campusID uuid.UUID) ([]TribeMember, error) {
	return s.repo.GetTribeMembers(ctx, driverID, campusID)
}

// GetSettings returns curator preferences.
func (s *Service) GetSettings(ctx context.Context, driverID uuid.UUID) (*CuratorSettings, error) {
	return s.repo.GetSettings(ctx, driverID)
}

// UpdateSettings updates curator preferences.
func (s *Service) UpdateSettings(ctx context.Context, driverID uuid.UUID, input UpdateSettingsInput) (*CuratorSettings, error) {
	if err := s.repo.UpsertSettings(ctx, driverID, input); err != nil {
		return nil, fmt.Errorf("failed to update settings: %w", err)
	}
	return s.repo.GetSettings(ctx, driverID)
}

// UpdateSettingsInput holds the settings update fields.
type UpdateSettingsInput struct {
	AutoAcceptEnabled     *bool     `json:"auto_accept_enabled"`
	MaxPickupRadiusM      *int      `json:"max_pickup_radius_m"`
	PreferredVehicleTypes []string  `json:"preferred_vehicle_types"`
	PreferredRideTypes    []string  `json:"preferred_ride_types"`
	NotificationSound     *string   `json:"notification_sound"`
	QuietHoursEnabled     *bool     `json:"quiet_hours_enabled"`
	QuietHoursStart       *string   `json:"quiet_hours_start"`
	QuietHoursEnd         *string   `json:"quiet_hours_end"`
	Language              *string   `json:"language"`
	MaxPassengers         *int      `json:"max_passengers"`
	AcceptLuggage         *string   `json:"accept_luggage"`
	NavigationApp         *string   `json:"navigation_app"`
}

// EarningsProjection holds projected earnings data.
type EarningsProjection struct {
	ProjectedDaily   float64 `json:"projected_daily"`
	ProjectedWeekly  float64 `json:"projected_weekly"`
	ProjectedMonthly float64 `json:"projected_monthly"`
	Confidence       float64 `json:"confidence"`
	BasedOnWeeks     int     `json:"based_on_weeks"`
	TrendDirection   string  `json:"trend_direction"`
}

// Analytics holds performance analytics.
type Analytics struct {
	Period          string    `json:"period"`
	TotalRides      int       `json:"total_rides"`
	CompletedRides  int       `json:"completed_rides"`
	CancelledRides  int       `json:"cancelled_rides"`
	TotalEarnings   float64   `json:"total_earnings"`
	AvgEarnings     float64   `json:"avg_earnings_per_ride"`
	AvgRating       float64   `json:"avg_rating"`
	TotalDistanceKm float64   `json:"total_distance_km"`
	TotalOnlineHrs  float64   `json:"total_online_hours"`
	RidesByDay      []DayStat `json:"rides_by_day"`
	EarningsByDay   []DayStat `json:"earnings_by_day"`
}

// DayStat holds a date/value pair for analytics charts.
type DayStat struct {
	Date  string  `json:"date"`
	Value float64 `json:"value"`
}

// LeaderboardEntry holds a single leaderboard row.
type LeaderboardEntry struct {
	Rank       int       `json:"rank"`
	DriverID   uuid.UUID `json:"driver_id"`
	DriverName string    `json:"driver_name"`
	Value      float64   `json:"value"`
	TotalRides int       `json:"total_rides"`
	AvgRating  float64   `json:"avg_rating"`
}

// TribeMember holds info about another campus driver.
type TribeMember struct {
	DriverID    uuid.UUID `json:"driver_id"`
	Name        string    `json:"name"`
	VehicleType string    `json:"vehicle_type"`
	TotalRides  int       `json:"total_rides"`
	AvgRating   float64   `json:"avg_rating"`
	IsOnline    bool      `json:"is_online"`
	JoinedAt    time.Time `json:"joined_at"`
}
