package places

import (
	"time"

	"github.com/google/uuid"
)

// ---------------------------------------------------------------------------
// Saved Places
// ---------------------------------------------------------------------------

// SavedPlace is a user-bookmarked location (home, work, gym, etc.).
type SavedPlace struct {
	ID         uuid.UUID  `json:"id"`
	UserID     uuid.UUID  `json:"user_id"`
	Label      string     `json:"label"`
	Name       string     `json:"name"`
	Address    string     `json:"address"`
	Lat        float64    `json:"lat"`
	Lng        float64    `json:"lng"`
	Icon       string     `json:"icon"`
	UseCount   int        `json:"use_count"`
	LastUsed   *time.Time `json:"last_used,omitempty"`
	IsFavorite bool       `json:"is_favorite"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

// CreateSavedPlaceInput carries data for creating a saved place.
type CreateSavedPlaceInput struct {
	UserID     uuid.UUID `json:"user_id"`
	Label      string    `json:"label"      binding:"required,min=1,max=50"`
	Name       string    `json:"name"       binding:"required,min=1,max=120"`
	Address    string    `json:"address"    binding:"required,min=1,max=300"`
	Lat        float64   `json:"lat"        binding:"required,min=-90,max=90"`
	Lng        float64   `json:"lng"        binding:"required,min=-180,max=180"`
	Icon       string    `json:"icon"       binding:"omitempty,max=50"`
	IsFavorite bool      `json:"is_favorite"`
}

// UpdateSavedPlaceInput carries data for updating a saved place.
type UpdateSavedPlaceInput struct {
	Label      *string  `json:"label"       binding:"omitempty,min=1,max=50"`
	Name       *string  `json:"name"        binding:"omitempty,min=1,max=120"`
	Address    *string  `json:"address"     binding:"omitempty,min=1,max=300"`
	Lat        *float64 `json:"lat"         binding:"omitempty,min=-90,max=90"`
	Lng        *float64 `json:"lng"         binding:"omitempty,min=-180,max=180"`
	Icon       *string  `json:"icon"        binding:"omitempty,max=50"`
	IsFavorite *bool    `json:"is_favorite"`
}

// ---------------------------------------------------------------------------
// Recent & Suggested Places
// ---------------------------------------------------------------------------

// RecentPlace is a recently used dropoff location from ride history.
type RecentPlace struct {
	Name       string    `json:"name"`
	Address    string    `json:"address"`
	Lat        float64   `json:"lat"`
	Lng        float64   `json:"lng"`
	LastUsedAt time.Time `json:"last_used_at"`
	UseCount   int       `json:"use_count"`
}

// CampusSuggestion represents a popular dropoff destination on campus.
type CampusSuggestion struct {
	Name       string  `json:"name"`
	Address    string  `json:"address"`
	Lat        float64 `json:"lat"`
	Lng        float64 `json:"lng"`
	Category   string  `json:"category"`
	Popularity int     `json:"popularity"`
}

// ---------------------------------------------------------------------------
// Ride Preferences
// ---------------------------------------------------------------------------

// RidePreference stores per-user ride defaults and comfort settings.
type RidePreference struct {
	UserID                uuid.UUID              `json:"user_id"`
	DefaultRideType       string                 `json:"default_ride_type"`
	PreferredPayment      string                 `json:"preferred_payment"`
	LuggageSize           string                 `json:"luggage_size"`
	AccessibilityNeeds    map[string]interface{} `json:"accessibility_needs,omitempty"`
	AutoTipPercent        float64                `json:"auto_tip_percent"`
	QuietRide             bool                   `json:"quiet_ride"`
	MusicPreference       string                 `json:"music_preference"`
	TemperaturePreference string                 `json:"temperature_preference"`
	ConversationMode      string                 `json:"conversation_mode"`
	WomenOnlyRide         bool                   `json:"women_only_ride"`
	ShareETA              bool                   `json:"share_eta"`
	AutoShareContacts     []string               `json:"auto_share_contacts,omitempty"`
	PreferredRoute        string                 `json:"preferred_route"`
	MaxPoolPassengers     int                    `json:"max_pool_passengers"`
	UpdatedAt             time.Time              `json:"updated_at"`
}

// UpdatePreferencesInput carries partial preference updates.
type UpdatePreferencesInput struct {
	DefaultRideType       *string                `json:"default_ride_type"       binding:"omitempty,oneof=solo pool women_only auto"`
	PreferredPayment      *string                `json:"preferred_payment"       binding:"omitempty,oneof=wallet upi cash card"`
	LuggageSize           *string                `json:"luggage_size"            binding:"omitempty,oneof=none small medium large"`
	AccessibilityNeeds    map[string]interface{} `json:"accessibility_needs"`
	AutoTipPercent        *float64               `json:"auto_tip_percent"        binding:"omitempty,min=0,max=100"`
	QuietRide             *bool                  `json:"quiet_ride"`
	MusicPreference       *string                `json:"music_preference"        binding:"omitempty,max=50"`
	TemperaturePreference *string                `json:"temperature_preference"  binding:"omitempty,oneof=cool normal warm"`
	ConversationMode      *string                `json:"conversation_mode"       binding:"omitempty,oneof=silent minimal chatty"`
	WomenOnlyRide         *bool                  `json:"women_only_ride"`
	ShareETA              *bool                  `json:"share_eta"`
	AutoShareContacts     []string               `json:"auto_share_contacts"     binding:"omitempty,max=10"`
	PreferredRoute        *string                `json:"preferred_route"         binding:"omitempty,oneof=fastest shortest cheapest"`
	MaxPoolPassengers     *int                   `json:"max_pool_passengers"     binding:"omitempty,min=1,max=6"`
}

// ---------------------------------------------------------------------------
// Collab Rides
// ---------------------------------------------------------------------------

// CollabRide is a user-created group ride proposal.
type CollabRide struct {
	ID             uuid.UUID              `json:"id"`
	CreatorID      uuid.UUID              `json:"creator_id"`
	CampusID       uuid.UUID              `json:"campus_id"`
	PickupLat      float64                `json:"pickup_lat"`
	PickupLng      float64                `json:"pickup_lng"`
	PickupLabel    string                 `json:"pickup_label"`
	DropoffLat     float64                `json:"dropoff_lat"`
	DropoffLng     float64                `json:"dropoff_lng"`
	DropoffLabel   string                 `json:"dropoff_label"`
	ScheduledAt    time.Time              `json:"scheduled_at"`
	MaxRiders      int                    `json:"max_riders"`
	CurrentRiders  int                    `json:"current_riders"`
	Status         string                 `json:"status"`
	RideRequestID  *uuid.UUID             `json:"ride_request_id,omitempty"`
	Note           *string                `json:"note,omitempty"`
	Recurrence     map[string]interface{} `json:"recurrence,omitempty"`
	CreatedAt      time.Time              `json:"created_at"`
	ExpiresAt      time.Time              `json:"expires_at"`
}

// CollabRideMember records a user who joined a collab ride.
type CollabRideMember struct {
	ID           uuid.UUID `json:"id"`
	CollabRideID uuid.UUID `json:"collab_ride_id"`
	UserID       uuid.UUID `json:"user_id"`
	Status       string    `json:"status"`
	PickupLat    *float64  `json:"pickup_lat,omitempty"`
	PickupLng    *float64  `json:"pickup_lng,omitempty"`
	PickupLabel  *string   `json:"pickup_label,omitempty"`
	JoinedAt     time.Time `json:"joined_at"`
}

// CreateCollabRideInput carries data for creating a collab ride.
type CreateCollabRideInput struct {
	CampusID     uuid.UUID              `json:"campus_id"     binding:"required"`
	PickupLat    float64                `json:"pickup_lat"    binding:"required,min=-90,max=90"`
	PickupLng    float64                `json:"pickup_lng"    binding:"required,min=-180,max=180"`
	PickupLabel  string                 `json:"pickup_label"  binding:"required,min=1,max=200"`
	DropoffLat   float64                `json:"dropoff_lat"   binding:"required,min=-90,max=90"`
	DropoffLng   float64                `json:"dropoff_lng"   binding:"required,min=-180,max=180"`
	DropoffLabel string                 `json:"dropoff_label" binding:"required,min=1,max=200"`
	ScheduledAt  time.Time              `json:"scheduled_at"  binding:"required"`
	MaxRiders    int                    `json:"max_riders"    binding:"required,min=2,max=6"`
	Note         *string                `json:"note"          binding:"omitempty,max=500"`
	Recurrence   map[string]interface{} `json:"recurrence"`
}

// JoinCollabRideInput carries pickup details for joining a collab ride.
type JoinCollabRideInput struct {
	PickupLat   *float64 `json:"pickup_lat"   binding:"omitempty,min=-90,max=90"`
	PickupLng   *float64 `json:"pickup_lng"   binding:"omitempty,min=-180,max=180"`
	PickupLabel *string  `json:"pickup_label" binding:"omitempty,max=200"`
}

// CollabRideDetail bundles a collab ride with its members.
type CollabRideDetail struct {
	CollabRide
	Members []CollabRideMember `json:"members"`
}

// CampusPlace mirrors ride_places — the catalogue of POIs.
type CampusPlace struct {
	ID              uuid.UUID `json:"id"`
	CampusID        uuid.UUID `json:"campus_id"`
	Name            string    `json:"name"`
	Address         string    `json:"address"`
	Lat             float64   `json:"lat"`
	Lng             float64   `json:"lng"`
	Category        string    `json:"category"`
	PopularityScore int       `json:"popularity_score"`
	IsActive        bool      `json:"is_active"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// CreateCampusPlaceInput is the request to add a POI.
type CreateCampusPlaceInput struct {
	Name            string  `json:"name"`
	Address         string  `json:"address"`
	Lat             float64 `json:"lat"`
	Lng             float64 `json:"lng"`
	Category        string  `json:"category"`
	PopularityScore int     `json:"popularity_score"`
}
