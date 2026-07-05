package driver

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"nexus/rides/internal/kafka"
)

type Service struct {
	repo     *Repository
	rdb      *redis.Client
	producer *kafka.Producer
	logger   *zap.Logger
}

func NewService(repo *Repository, rdb *redis.Client, producer *kafka.Producer, logger *zap.Logger) *Service {
	return &Service{repo: repo, rdb: rdb, producer: producer, logger: logger}
}

var vehicleNumberRegex = regexp.MustCompile(`^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$`)

type RegisterInput struct {
	CampusID      uuid.UUID `json:"campus_id"`
	LicenseNumber string    `json:"license_number"`
	VehicleType   string    `json:"vehicle_type"`
	VehicleNumber string    `json:"vehicle_number"`
	VehicleColor  string    `json:"vehicle_color"`
	IsWomenOnly   bool      `json:"is_women_only"`
}

func (s *Service) RegisterAsDriver(ctx context.Context, userID uuid.UUID, verificationLevel int, input RegisterInput) (*Driver, error) {
	if verificationLevel < 2 {
		return nil, fmt.Errorf("verification_level must be >= 2")
	}
	if input.LicenseNumber == "" {
		return nil, fmt.Errorf("license_number is required")
	}
	if input.VehicleNumber != "" && !vehicleNumberRegex.MatchString(input.VehicleNumber) {
		return nil, fmt.Errorf("invalid vehicle_number format")
	}
	validTypes := map[string]bool{"bicycle": true, "motorcycle": true, "car": true}
	if !validTypes[input.VehicleType] {
		return nil, fmt.Errorf("invalid vehicle_type")
	}

	driver, err := s.repo.Create(ctx, CreateInput{
		UserID: userID, CampusID: input.CampusID, LicenseNumber: input.LicenseNumber,
		VehicleType: input.VehicleType, VehicleNumber: input.VehicleNumber,
		VehicleColor: input.VehicleColor, IsWomenOnly: input.IsWomenOnly,
	})
	if err != nil {
		return nil, err
	}

	_ = s.producer.Publish(ctx, "nexus.rides.driver_registered", driver.ID.String(), kafka.Event{
		Type:    "nexus.rides.driver_registered",
		Payload: map[string]interface{}{"driver_id": driver.ID, "user_id": userID},
	})
	return driver, nil
}

func (s *Service) UpdateLocation(ctx context.Context, driverID uuid.UUID, lat, lng float64) error {
	if lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		return fmt.Errorf("invalid coordinates")
	}
	if err := s.repo.UpdateLocation(ctx, driverID, lat, lng); err != nil {
		return err
	}
	locData, _ := json.Marshal(map[string]interface{}{"lat": lat, "lng": lng, "ts": time.Now().UTC().Format(time.RFC3339)})
	s.rdb.SetEx(ctx, fmt.Sprintf("driver:loc:%s", driverID), string(locData), 30*time.Second)
	s.rdb.Publish(ctx, fmt.Sprintf("rides:driver:%s:location", driverID), string(locData))
	return nil
}

func (s *Service) ToggleAvailability(ctx context.Context, driverID uuid.UUID, available bool) error {
	driver, err := s.repo.FindByID(ctx, driverID)
	if err != nil {
		return err
	}
	if available && !driver.IsVerified {
		return fmt.Errorf("unverified drivers cannot go available")
	}
	if err := s.repo.SetAvailability(ctx, driverID, available); err != nil {
		return err
	}
	if !available {
		s.rdb.Del(ctx, fmt.Sprintf("driver:loc:%s", driverID))
	}
	return nil
}

func (s *Service) GetProfile(ctx context.Context, userID uuid.UUID) (*Driver, error) {
	return s.repo.FindByUserID(ctx, userID)
}

func (s *Service) GetHistory(ctx context.Context, driverID uuid.UUID, limit int, cursor *time.Time) ([]map[string]interface{}, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	return s.repo.GetRideHistory(ctx, driverID, limit, cursor)
}
