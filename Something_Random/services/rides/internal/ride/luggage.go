package ride

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"
)

// LuggageConfig mirrors the persisted ride_luggage_configs row.
type LuggageConfig struct {
	RideID         uuid.UUID       `json:"ride_id"`
	RiderID        uuid.UUID       `json:"rider_id"`
	Pieces         int             `json:"pieces"`
	TotalWeightKg  *decimal.Decimal `json:"total_weight_kg,omitempty"`
	SizeBreakdown  []LuggagePiece  `json:"size_breakdown"`
	Fragile        bool            `json:"fragile"`
	RequiresBoots  bool            `json:"requires_boots"`
	Assistance     bool            `json:"assistance"`
	Notes          *string         `json:"notes,omitempty"`
	DeclaredAt     time.Time       `json:"declared_at"`
}

// LuggagePiece is a single bucket in the size breakdown.
type LuggagePiece struct {
	Size  string `json:"size"`
	Count int    `json:"count"`
}

// LuggageRepository owns luggage SQL.
type LuggageRepository struct {
	pool *pgxpool.Pool
}

// DefaultLuggageRepository returns a singleton-like repo; a real
// service would inject this rather than reading the pool.
func DefaultLuggageRepository(pool *pgxpool.Pool) *LuggageRepository {
	return &LuggageRepository{pool: pool}
}

// NewLuggageRepository constructs one explicitly.
func NewLuggageRepository(pool *pgxpool.Pool) *LuggageRepository {
	return &LuggageRepository{pool: pool}
}

// Upsert creates or updates the luggage config for a ride.
func (r *LuggageRepository) Upsert(ctx context.Context, rideID, riderID uuid.UUID, in LuggageDTO) error {
	if in.Pieces <= 0 {
		in.Pieces = 1
	}
	breakdown, err := json.Marshal(coerceSizeBreakdown(in.SizeBreakdown))
	if err != nil {
		return err
	}
	var totalWeight interface{}
	if in.TotalWeightKg != nil {
		totalWeight = *in.TotalWeightKg
	}
	_, err = r.pool.Exec(ctx, `
		INSERT INTO ride_luggage_configs (
			ride_id, rider_id, pieces, total_weight_kg, size_breakdown,
			fragile, requires_boots, assistance, notes
		) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, NULLIF($9, ''))
		ON CONFLICT (ride_id) DO UPDATE SET
			pieces = EXCLUDED.pieces,
			total_weight_kg = EXCLUDED.total_weight_kg,
			size_breakdown = EXCLUDED.size_breakdown,
			fragile = EXCLUDED.fragile,
			requires_boots = EXCLUDED.requires_boots,
			assistance = EXCLUDED.assistance,
			notes = EXCLUDED.notes,
			declared_at = NOW()`,
		rideID, riderID, in.Pieces, totalWeight, string(breakdown),
		in.Fragile, in.RequiresBoots, in.Assistance, in.Notes,
	)
	return err
}

// Find fetches the luggage config for a ride.
func (r *LuggageRepository) Find(ctx context.Context, rideID uuid.UUID) (*LuggageConfig, error) {
	var cfg LuggageConfig
	var rawJSON []byte
	var totalWeight *float64
	err := r.pool.QueryRow(ctx, `
		SELECT ride_id, rider_id, pieces, total_weight_kg, size_breakdown,
		       fragile, requires_boots, assistance, notes, declared_at
		FROM ride_luggage_configs WHERE ride_id = $1`, rideID).Scan(
		&cfg.RideID, &cfg.RiderID, &cfg.Pieces, &totalWeight, &rawJSON,
		&cfg.Fragile, &cfg.RequiresBoots, &cfg.Assistance, &cfg.Notes, &cfg.DeclaredAt,
	)
	if err != nil {
		return nil, errors.New("luggage not found")
	}
	if totalWeight != nil {
		d := decimal.NewFromFloat(*totalWeight)
		cfg.TotalWeightKg = &d
	}
	_ = json.Unmarshal(rawJSON, &cfg.SizeBreakdown)
	return &cfg, nil
}

func coerceSizeBreakdown(in []LuggagePiece) []LuggagePiece {
	if in == nil {
		return []LuggagePiece{}
	}
	out := make([]LuggagePiece, 0, len(in))
	for _, p := range in {
		switch p.Size {
		case "cabin", "medium", "large":
			out = append(out, p)
		}
	}
	return out
}