package ride

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("ride not found")

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

type RideSession struct {
	ID              uuid.UUID  `json:"id"`
	RiderID         uuid.UUID  `json:"rider_id"`
	DriverID        *uuid.UUID `json:"driver_id"`
	Status          string     `json:"status"`
	PickupAddress   string     `json:"pickup_address"`
	DropoffAddress  string     `json:"dropoff_address"`
	PickupLat       float64    `json:"pickup_lat"`
	PickupLng       float64    `json:"pickup_lng"`
	DropoffLat      float64    `json:"dropoff_lat"`
	DropoffLng      float64    `json:"dropoff_lng"`
}

func (r *Repository) CreateRide(ctx context.Context, session *RideSession) error {
	query := `
		INSERT INTO ride_sessions (id, rider_id, status, pickup_location, dropoff_location, pickup_address, dropoff_address)
		VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4,$5), 4326), ST_SetSRID(ST_MakePoint($6,$7), 4326), $8, $9)
	`
	_, err := r.pool.Exec(ctx, query, session.ID, session.RiderID, session.Status, session.PickupLng, session.PickupLat, session.DropoffLng, session.DropoffLat, session.PickupAddress, session.DropoffAddress)
	return err
}

func (r *Repository) GetRide(ctx context.Context, id uuid.UUID) (*RideSession, error) {
	query := `
		SELECT
			id, rider_id, driver_id, status, pickup_address, dropoff_address,
			ST_Y(pickup_location::geometry) as pickup_lat, ST_X(pickup_location::geometry) as pickup_lng,
			ST_Y(dropoff_location::geometry) as dropoff_lat, ST_X(dropoff_location::geometry) as dropoff_lng
		FROM ride_sessions
		WHERE id = $1
	`
	row := r.pool.QueryRow(ctx, query, id)

	var session RideSession
	err := row.Scan(
		&session.ID, &session.RiderID, &session.DriverID, &session.Status,
		&session.PickupAddress, &session.DropoffAddress,
		&session.PickupLat, &session.PickupLng, &session.DropoffLat, &session.DropoffLng,
	)
	if err != nil {
		return nil, err
	}
	return &session, nil
}
