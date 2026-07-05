package ride

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// Pool is the high-level composite ride container for shared rides.
type Pool struct {
	ID            uuid.UUID       `json:"id"`
	CampusID      uuid.UUID       `json:"campus_id"`
	DriverID      *uuid.UUID      `json:"driver_id,omitempty"`
	VehicleID     *uuid.UUID      `json:"vehicle_id,omitempty"`
	Status        string          `json:"status"`
	Origin        AddressSnapshot `json:"origin"`
	Destination   AddressSnapshot `json:"destination"`
	Capacity      int             `json:"capacity"`
	SeatsTaken    int             `json:"seats_taken"`
	DiscountPct   decimal.Decimal `json:"discount_pct"`
	DetectedAt    time.Time       `json:"detected_at"`
	DispatchedAt  *time.Time      `json:"dispatched_at,omitempty"`
	CompletedAt   *time.Time      `json:"completed_at,omitempty"`
}

// AddressSnapshot mirrors the embedded pickup/dropoff columns.
type AddressSnapshot struct {
	Label    string  `json:"label"`
	Address  string  `json:"address,omitempty"`
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
	Building string  `json:"building,omitempty"`
	Floor    string  `json:"floor,omitempty"`
}

// PoolMember is one rider in a pool.
type PoolMember struct {
	ID            uuid.UUID       `json:"id"`
	PoolID        uuid.UUID       `json:"pool_id"`
	RideID        uuid.UUID       `json:"ride_id"`
	RiderID       uuid.UUID       `json:"rider_id"`
	JoinOrder     int             `json:"join_order"`
	FareShare     decimal.Decimal `json:"fare_share"`
	PickedUpAt    *time.Time      `json:"picked_up_at,omitempty"`
	DroppedOffAt  *time.Time      `json:"dropped_off_at,omitempty"`
}

// PoolCreateInput is the payload to create a pool plan.
type PoolCreateInput struct {
	CampusID     uuid.UUID
	Origin       AddressSnapshot
	Destination  AddressSnapshot
	Capacity     int
	DiscountPct  decimal.Decimal
	RideIDs      []uuid.UUID
}

// PoolRepository owns all SQL touching ride_pools / ride_pool_members.
type PoolRepository struct {
	repo *RideRepository
}

// NewPoolRepository constructs a pool repo.
func NewPoolRepository(repo *RideRepository) *PoolRepository {
	return &PoolRepository{repo: repo}
}

// Create persists a new pool and links the supplied rides.
func (p *PoolRepository) Create(ctx context.Context, in PoolCreateInput) (*Pool, error) {
	if in.Capacity <= 0 {
		in.Capacity = 3
	}
	if in.DiscountPct.IsZero() {
		in.DiscountPct = decimal.NewFromFloat(0.30)
	}
	tx, err := p.repo.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var id uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO ride_pools (
			campus_id, status, origin_lat, origin_lng, origin_label,
			destination_lat, destination_lng, destination_label,
			capacity, seats_taken, discount_pct
		) VALUES (
			$1, 'filling', $2, $3, $4,
			$5, $6, $7,
			$8, 0, $9
		) RETURNING id`,
		in.CampusID,
		in.Origin.Lat, in.Origin.Lng, in.Origin.Label,
		in.Destination.Lat, in.Destination.Lng, in.Destination.Label,
		in.Capacity, in.DiscountPct.String(),
	).Scan(&id)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}
	for i, rideID := range in.RideIDs {
		var riderID uuid.UUID
		if err := tx.QueryRow(ctx, `SELECT rider_id FROM ride_requests WHERE id = $1`, rideID).Scan(&riderID); err != nil {
			return nil, fmt.Errorf("lookup rider: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO ride_pool_members (pool_id, ride_id, rider_id, join_order, fare_share)
			VALUES ($1, $2, $3, $4, 0)`,
			id, rideID, riderID, i+1); err != nil {
			return nil, fmt.Errorf("insert pool member: %w", err)
		}
		if _, err := tx.Exec(ctx, `UPDATE ride_requests SET pool_id = $1 WHERE id = $2`, id, rideID); err != nil {
			return nil, fmt.Errorf("link ride to pool: %w", err)
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE ride_pools SET seats_taken = $1 WHERE id = $2`, len(in.RideIDs), id); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return p.FindByID(ctx, id)
}

// FindByID loads a pool with members.
func (p *PoolRepository) FindByID(ctx context.Context, id uuid.UUID) (*Pool, error) {
	var pool Pool
	err := p.repo.pool.QueryRow(ctx, `
		SELECT id, campus_id, driver_id, vehicle_id, status,
		       origin_lat, origin_lng, origin_label,
		       destination_lat, destination_lng, destination_label,
		       capacity, seats_taken, discount_pct::text,
		       detected_at, dispatched_at, completed_at
		FROM ride_pools WHERE id = $1`, id).Scan(
		&pool.ID, &pool.CampusID, &pool.DriverID, &pool.VehicleID, &pool.Status,
		&pool.Origin.Lat, &pool.Origin.Lng, &pool.Origin.Label,
		&pool.Destination.Lat, &pool.Destination.Lng, &pool.Destination.Label,
		&pool.Capacity, &pool.SeatsTaken, &pool.DiscountPct,
		&pool.DetectedAt, &pool.DispatchedAt, &pool.CompletedAt,
	)
	if err != nil {
		return nil, ErrPoolNotFound
	}
	return &pool, nil
}

// Members returns the riders in the pool.
func (p *PoolRepository) Members(ctx context.Context, poolID uuid.UUID) ([]PoolMember, error) {
	rows, err := p.repo.pool.Query(ctx, `
		SELECT id, pool_id, ride_id, rider_id, join_order,
		       fare_share::text, picked_up_at, dropped_off_at
		FROM ride_pool_members WHERE pool_id = $1 ORDER BY join_order ASC`, poolID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PoolMember{}
	for rows.Next() {
		var m PoolMember
		var fs string
		if err := rows.Scan(&m.ID, &m.PoolID, &m.RideID, &m.RiderID, &m.JoinOrder,
			&fs, &m.PickedUpAt, &m.DroppedOffAt); err != nil {
			return nil, err
		}
		share, _ := decimal.NewFromString(fs)
		m.FareShare = share
		out = append(out, m)
	}
	return out, rows.Err()
}

// AssignDriver links a driver to the pool and updates the underlying rides.
func (p *PoolRepository) AssignDriver(ctx context.Context, poolID, driverID, vehicleID uuid.UUID) error {
	tx, err := p.repo.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `
		UPDATE ride_pools
		SET driver_id = $1, vehicle_id = $2, status = 'dispatched', dispatched_at = NOW()
		WHERE id = $3`, driverID, vehicleID, poolID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE ride_requests
		SET driver_id = $1, vehicle_id = $2, status = 'accepted', accepted_at = NOW()
		WHERE pool_id = $3`, driverID, vehicleID, poolID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// DistributeFare splits the total fare equally among active members.
func (p *PoolRepository) DistributeFare(ctx context.Context, poolID uuid.UUID, totalFare decimal.Decimal) error {
	members, err := p.Members(ctx, poolID)
	if err != nil {
		return err
	}
	if len(members) == 0 {
		return errors.New("pool has no members")
	}
	shares := SplitFare(totalFare, len(members))
	for i, m := range members {
		if _, err := p.repo.pool.Exec(ctx, `
			UPDATE ride_pool_members SET fare_share = $1 WHERE id = $2`,
			shares[i].String(), m.ID); err != nil {
			return err
		}
	}
	return nil
}

// Cancel sets the pool to cancelled and propagates to rides.
func (p *PoolRepository) Cancel(ctx context.Context, poolID uuid.UUID, reason string) error {
	tx, err := p.repo.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `
		UPDATE ride_pools SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1`, poolID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE ride_requests SET status = 'cancelled_by_system',
		    cancelled_at = NOW(), cancel_reason = NULLIF($1, '')
		WHERE pool_id = $2 AND status IN ('requested','matching','offered')`, reason, poolID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// PlanJSON serialises a plan to embed in ride metadata.
func (p *Pool) PlanJSON() ([]byte, error) {
	return json.Marshal(p)
}