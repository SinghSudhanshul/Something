// Package places owns user-saved places, recent destinations, campus
// POIs, and ride preferences. All persistent state lives in
// ride_places / ride_user_places / ride_ride_preferences.
//
// Recent destinations are computed on-the-fly from ride_requests;
// campus suggestions are precomputed aggregates in ride_places.
package places

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Errors.
var (
	ErrPlaceNotFound  = errors.New("place not found")
	ErrPlaceLimit     = errors.New("saved place limit reached")
	ErrCollabFull     = errors.New("collab ride is full")
	ErrCollabClosed   = errors.New("collab ride is closed")
	ErrAlreadyJoined  = errors.New("already joined")
	ErrNotMember      = errors.New("not a member")
)

// Repository is the data access layer for the places module.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a repo.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

// ---------- Saved places ----------

// CreateSavedPlace inserts a new ride_user_places row.
func (r *Repository) CreateSavedPlace(ctx context.Context, userID uuid.UUID, input CreateSavedPlaceInput) (*SavedPlace, error) {
	var count int
	if err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM ride_user_places WHERE user_id = $1`, userID).Scan(&count); err != nil {
		return nil, err
	}
	if count >= 50 {
		return nil, ErrPlaceLimit
	}
	var p SavedPlace
	err := r.pool.QueryRow(ctx, `
		INSERT INTO ride_user_places (
			user_id, label, name, address, location, icon, is_favorite, use_count
		) VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography, $7, $8, 0)
		RETURNING id, user_id, label, name, address,
		          ST_Y(location::geometry), ST_X(location::geometry),
		          icon, use_count, last_used, is_favorite, created_at, updated_at`,
		userID, input.Label, input.Name, input.Address, input.Lat, input.Lng, input.Icon, input.IsFavorite,
	).Scan(&p.ID, &p.UserID, &p.Label, &p.Name, &p.Address,
		&p.Lat, &p.Lng, &p.Icon, &p.UseCount, &p.LastUsed, &p.IsFavorite, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// GetSavedPlaces returns up to 50 user places, favorites first.
func (r *Repository) GetSavedPlaces(ctx context.Context, userID uuid.UUID) ([]SavedPlace, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, user_id, label, name, address,
		       ST_Y(location::geometry), ST_X(location::geometry),
		       icon, use_count, last_used, is_favorite, created_at, updated_at
		FROM ride_user_places
		WHERE user_id = $1
		ORDER BY is_favorite DESC, use_count DESC, created_at DESC
		LIMIT 50`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SavedPlace{}
	for rows.Next() {
		var p SavedPlace
		if err := rows.Scan(&p.ID, &p.UserID, &p.Label, &p.Name, &p.Address,
			&p.Lat, &p.Lng, &p.Icon, &p.UseCount, &p.LastUsed, &p.IsFavorite,
			&p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// UpdateSavedPlace patches fields.
func (r *Repository) UpdateSavedPlace(ctx context.Context, id, userID uuid.UUID, input UpdateSavedPlaceInput) (*SavedPlace, error) {
	sets := []string{}
	args := []any{}
	idx := 1
	if input.Label != nil {
		sets = append(sets, fmt.Sprintf("label = $%d", idx))
		args = append(args, *input.Label)
		idx++
	}
	if input.Name != nil {
		sets = append(sets, fmt.Sprintf("name = $%d", idx))
		args = append(args, *input.Name)
		idx++
	}
	if input.Address != nil {
		sets = append(sets, fmt.Sprintf("address = $%d", idx))
		args = append(args, *input.Address)
		idx++
	}
	if input.Icon != nil {
		sets = append(sets, fmt.Sprintf("icon = $%d", idx))
		args = append(args, *input.Icon)
		idx++
	}
	if input.IsFavorite != nil {
		sets = append(sets, fmt.Sprintf("is_favorite = $%d", idx))
		args = append(args, *input.IsFavorite)
		idx++
	}
	if input.Lat != nil && input.Lng != nil {
		sets = append(sets, fmt.Sprintf("location = ST_SetSRID(ST_MakePoint($%d, $%d), 4326)::geography", idx+1, idx))
		args = append(args, *input.Lng, *input.Lat)
		idx += 2
	}
	if len(sets) == 0 {
		return r.FindSavedPlace(ctx, id, userID)
	}
	sets = append(sets, "updated_at = NOW()")
	args = append(args, id, userID)
	q := fmt.Sprintf(`UPDATE ride_user_places SET %s WHERE id = $%d AND user_id = $%d`, joinComma(sets), idx, idx+1)
	var p SavedPlace
	err := r.pool.QueryRow(ctx, q, args...).Scan(
		&p.ID, &p.UserID, &p.Label, &p.Name, &p.Address,
		&p.Lat, &p.Lng, &p.Icon, &p.UseCount, &p.LastUsed, &p.IsFavorite,
		&p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// FindSavedPlace returns a single saved place scoped to the owner.
func (r *Repository) FindSavedPlace(ctx context.Context, id, userID uuid.UUID) (*SavedPlace, error) {
	var p SavedPlace
	err := r.pool.QueryRow(ctx, `
		SELECT id, user_id, label, name, address,
		       ST_Y(location::geometry), ST_X(location::geometry),
		       icon, use_count, last_used, is_favorite, created_at, updated_at
		FROM ride_user_places WHERE id = $1 AND user_id = $2`, id, userID).Scan(
		&p.ID, &p.UserID, &p.Label, &p.Name, &p.Address,
		&p.Lat, &p.Lng, &p.Icon, &p.UseCount, &p.LastUsed, &p.IsFavorite,
		&p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrPlaceNotFound
		}
		return nil, err
	}
	return &p, nil
}

// DeleteSavedPlace removes a saved place.
func (r *Repository) DeleteSavedPlace(ctx context.Context, id, userID uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM ride_user_places WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrPlaceNotFound
	}
	return nil
}

// IncrementPlaceUsage increments use_count and bumps last_used.
func (r *Repository) IncrementPlaceUsage(ctx context.Context, id uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE ride_user_places SET use_count = use_count + 1, last_used = NOW()
		WHERE id = $1`, id)
	return err
}

// ---------- Recent places (computed from ride_requests) ----------

// GetRecentPlaces returns the most recent 10 unique dropoffs.
func (r *Repository) GetRecentPlaces(ctx context.Context, userID uuid.UUID) ([]RecentPlace, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT DISTINCT ON (r.dropoff_label)
		    r.dropoff_label, COALESCE(r.dropoff_label,'') AS address,
		    r.dropoff_lat, r.dropoff_lng, r.completed_at, 1
		FROM ride_requests r
		WHERE r.rider_id = $1 AND r.status = 'completed' AND r.dropoff_label IS NOT NULL
		ORDER BY r.dropoff_label, r.completed_at DESC
		LIMIT 10`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RecentPlace{}
	for rows.Next() {
		var p RecentPlace
		if err := rows.Scan(&p.Name, &p.Address, &p.Lat, &p.Lng, &p.LastUsedAt, &p.UseCount); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ---------- Campus suggestions (from ride_places POIs) ----------

// GetCampusSuggestions returns popular dropoffs for a campus.
func (r *Repository) GetCampusSuggestions(ctx context.Context, campusID uuid.UUID) ([]CampusSuggestion, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT name, address, lat, lng, category, popularity_score
		FROM ride_places
		WHERE campus_id = $1 AND is_active = true
		ORDER BY popularity_score DESC LIMIT 15`, campusID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CampusSuggestion{}
	for rows.Next() {
		var s CampusSuggestion
		if err := rows.Scan(&s.Name, &s.Address, &s.Lat, &s.Lng, &s.Category, &s.Popularity); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// FindNearbyPlaces returns POIs within a radius of a point.
func (r *Repository) FindNearbyPlaces(ctx context.Context, campusID uuid.UUID, lat, lng float64, radiusM int) ([]CampusSuggestion, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT name, address, lat, lng, category, popularity_score
		FROM ride_places
		WHERE campus_id = $1 AND is_active = true
		  AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, $4)
		ORDER BY popularity_score DESC LIMIT 25`, campusID, lat, lng, radiusM)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CampusSuggestion{}
	for rows.Next() {
		var s CampusSuggestion
		if err := rows.Scan(&s.Name, &s.Address, &s.Lat, &s.Lng, &s.Category, &s.Popularity); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// UpsertPlace inserts or updates a ride_places POI.
func (r *Repository) UpsertPlace(ctx context.Context, p *CampusPlace) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO ride_places (id, campus_id, name, address, lat, lng, location, category, popularity_score, is_active)
		VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($8, $7), 4326)::geography, $9, $10, $11)
		ON CONFLICT (campus_id, name, address) DO UPDATE
		    SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, popularity_score = EXCLUDED.popularity_score, is_active = EXCLUDED.is_active, updated_at = NOW()`,
		p.ID, p.CampusID, p.Name, p.Address, p.Lat, p.Lng, p.Lat, p.Lng,
		p.Category, p.PopularityScore, p.IsActive,
	)
	return err
}

// ---------- Preferences (legacy ride_preferences, retained) ----------

// GetPreferences loads user preferences.
func (r *Repository) GetPreferences(ctx context.Context, userID uuid.UUID) (*RidePreference, error) {
	var pref RidePreference
	err := r.pool.QueryRow(ctx, `
		SELECT user_id, default_ride_type, preferred_payment, luggage_size,
		       auto_tip_percent, quiet_ride, music_preference,
		       temperature_preference, conversation_mode, women_only_ride, share_eta,
		       preferred_route, max_pool_passengers, updated_at
		FROM ride_preferences WHERE user_id = $1`, userID).Scan(
		&pref.UserID, &pref.DefaultRideType, &pref.PreferredPayment,
		&pref.LuggageSize, &pref.AutoTipPercent,
		&pref.QuietRide, &pref.MusicPreference, &pref.TemperaturePreference,
		&pref.ConversationMode, &pref.WomenOnlyRide, &pref.ShareETA,
		&pref.PreferredRoute, &pref.MaxPoolPassengers, &pref.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &RidePreference{
				UserID: userID, DefaultRideType: "solo", PreferredPayment: "upi",
				LuggageSize: "none", PreferredRoute: "fastest", MaxPoolPassengers: 3,
			}, nil
		}
		return nil, err
	}
	return &pref, nil
}

// UpsertPreferences creates or updates preferences.
func (r *Repository) UpsertPreferences(ctx context.Context, userID uuid.UUID, input UpdatePreferencesInput) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO ride_preferences (
			user_id, default_ride_type, preferred_payment, luggage_size,
			auto_tip_percent, quiet_ride, music_preference, temperature_preference,
			conversation_mode, women_only_ride, share_eta, preferred_route, max_pool_passengers
		) VALUES ($1, COALESCE($2,'solo'), COALESCE($3,'upi'), COALESCE($4,'none'),
		          COALESCE($5,0), COALESCE($6,false), COALESCE($7,'driver_choice'),
		          COALESCE($8,'normal'), COALESCE($9,'friendly'), COALESCE($10,false),
		          COALESCE($11,true), COALESCE($12,'fastest'), COALESCE($13,3))
		ON CONFLICT (user_id) DO UPDATE SET
			default_ride_type = COALESCE($2, ride_preferences.default_ride_type),
			preferred_payment = COALESCE($3, ride_preferences.preferred_payment),
			luggage_size = COALESCE($4, ride_preferences.luggage_size),
			auto_tip_percent = COALESCE($5, ride_preferences.auto_tip_percent),
			quiet_ride = COALESCE($6, ride_preferences.quiet_ride),
			music_preference = COALESCE($7, ride_preferences.music_preference),
			temperature_preference = COALESCE($8, ride_preferences.temperature_preference),
			conversation_mode = COALESCE($9, ride_preferences.conversation_mode),
			women_only_ride = COALESCE($10, ride_preferences.women_only_ride),
			share_eta = COALESCE($11, ride_preferences.share_eta),
			preferred_route = COALESCE($12, ride_preferences.preferred_route),
			max_pool_passengers = COALESCE($13, ride_preferences.max_pool_passengers),
			updated_at = NOW()`,
		userID, input.DefaultRideType, input.PreferredPayment, input.LuggageSize,
		input.AutoTipPercent, input.QuietRide, input.MusicPreference,
		input.TemperaturePreference, input.ConversationMode, input.WomenOnlyRide,
		input.ShareETA, input.PreferredRoute, input.MaxPoolPassengers,
	)
	return err
}

// ---------- Collab rides (re-use ride_requests with is_collab flag in metadata) ----------
// For now we keep collab rides as a thin layer over ride_pools; the
// detailed proposal flow is implemented in the service.

func joinComma(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += ", "
		}
		out += p
	}
	return out
}

// Now is exposed for tests.
var Now = func() time.Time { return time.Now() }