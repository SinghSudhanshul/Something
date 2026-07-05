package places

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"nexus/rides/internal/kafka"
)

// Service provides saved places, recent places, POI suggestions, and
// per-user ride preferences. Cache results via Redis with appropriate
// TTLs; the DB is the source of truth.
type Service struct {
	repo   *Repository
	rdb    *redis.Client
	producer *kafka.Producer
	logger *zap.Logger
}

// NewService constructs a places service.
func NewService(repo *Repository, rdb *redis.Client, producer *kafka.Producer, logger *zap.Logger) *Service {
	return &Service{repo: repo, rdb: rdb, producer: producer, logger: logger}
}

// ---------- Saved places ----------

// GetSavedPlaces returns the user's saved places (cached briefly).
func (s *Service) GetSavedPlaces(ctx context.Context, userID uuid.UUID) ([]SavedPlace, error) {
	return s.repo.GetSavedPlaces(ctx, userID)
}

// CreateSavedPlace adds a new saved place for the user.
func (s *Service) CreateSavedPlace(ctx context.Context, input CreateSavedPlaceInput) (*SavedPlace, error) {
	if input.Label == "" {
		input.Label = "custom"
	}
	if input.Icon == "" {
		input.Icon = "pin"
	}
	return s.repo.CreateSavedPlace(ctx, input.UserID, input)
}

// UpdateSavedPlace patches an existing saved place.
func (s *Service) UpdateSavedPlace(ctx context.Context, id, userID uuid.UUID, input UpdateSavedPlaceInput) (*SavedPlace, error) {
	return s.repo.UpdateSavedPlace(ctx, id, userID, input)
}

// DeleteSavedPlace removes a saved place.
func (s *Service) DeleteSavedPlace(ctx context.Context, id, userID uuid.UUID) error {
	return s.repo.DeleteSavedPlace(ctx, id, userID)
}

// UsePlace records that a saved place was just used as a pickup/dropoff.
func (s *Service) UsePlace(ctx context.Context, id uuid.UUID) error {
	return s.repo.IncrementPlaceUsage(ctx, id)
}

// ---------- Recent places ----------

// GetRecentPlaces returns the user's most recent destinations.
func (s *Service) GetRecentPlaces(ctx context.Context, userID uuid.UUID) ([]RecentPlace, error) {
	cacheKey := fmt.Sprintf("recent_places:%s", userID)
	cached, err := s.rdb.Get(ctx, cacheKey).Bytes()
	if err == nil {
		var out []RecentPlace
		if json.Unmarshal(cached, &out) == nil {
			return out, nil
		}
	}
	out, err := s.repo.GetRecentPlaces(ctx, userID)
	if err != nil {
		return nil, err
	}
	if data, err := json.Marshal(out); err == nil {
		s.rdb.Set(ctx, cacheKey, data, 5*time.Minute)
	}
	return out, nil
}

// InvalidateRecentPlacesCache clears the cached recents for a user.
func (s *Service) InvalidateRecentPlacesCache(ctx context.Context, userID uuid.UUID) {
	s.rdb.Del(ctx, fmt.Sprintf("recent_places:%s", userID))
}

// ---------- Campus POIs ----------

// GetCampusSuggestions returns popular POIs for a campus (cached 30m).
func (s *Service) GetCampusSuggestions(ctx context.Context, campusID uuid.UUID) ([]CampusSuggestion, error) {
	cacheKey := fmt.Sprintf("campus_suggestions:%s", campusID)
	cached, err := s.rdb.Get(ctx, cacheKey).Bytes()
	if err == nil {
		var out []CampusSuggestion
		if json.Unmarshal(cached, &out) == nil {
			return out, nil
		}
	}
	out, err := s.repo.GetCampusSuggestions(ctx, campusID)
	if err != nil {
		return nil, err
	}
	if data, err := json.Marshal(out); err == nil {
		s.rdb.Set(ctx, cacheKey, data, 30*time.Minute)
	}
	return out, nil
}

// FindNearby returns POIs near a point.
func (s *Service) FindNearby(ctx context.Context, campusID uuid.UUID, lat, lng float64, radiusM int) ([]CampusSuggestion, error) {
	if radiusM <= 0 || radiusM > 10000 {
		radiusM = 2000
	}
	return s.repo.FindNearbyPlaces(ctx, campusID, lat, lng, radiusM)
}

// UpsertCampusPlace adds or updates a POI.
func (s *Service) UpsertCampusPlace(ctx context.Context, input CreateCampusPlaceInput, campusID uuid.UUID) (*CampusPlace, error) {
	if input.Category == "" {
		input.Category = "general"
	}
	if input.PopularityScore < 0 {
		input.PopularityScore = 0
	}
	p := &CampusPlace{
		ID:              uuid.New(),
		CampusID:        campusID,
		Name:            input.Name,
		Address:         input.Address,
		Lat:             input.Lat,
		Lng:             input.Lng,
		Category:        input.Category,
		PopularityScore: input.PopularityScore,
		IsActive:        true,
	}
	if err := s.repo.UpsertPlace(ctx, p); err != nil {
		return nil, err
	}
	// Bust the suggestions cache.
	s.rdb.Del(ctx, fmt.Sprintf("campus_suggestions:%s", campusID))
	return p, nil
}

// ---------- Preferences ----------

// GetPreferences returns the user's ride preferences.
func (s *Service) GetPreferences(ctx context.Context, userID uuid.UUID) (*RidePreference, error) {
	return s.repo.GetPreferences(ctx, userID)
}

// UpdatePreferences upserts the user's preferences.
func (s *Service) UpdatePreferences(ctx context.Context, userID uuid.UUID, input UpdatePreferencesInput) (*RidePreference, error) {
	if err := s.repo.UpsertPreferences(ctx, userID, input); err != nil {
		return nil, fmt.Errorf("update preferences: %w", err)
	}
	return s.repo.GetPreferences(ctx, userID)
}