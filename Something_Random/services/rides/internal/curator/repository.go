package curator

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// IST is the Indian Standard Time timezone used for all time operations.
var IST *time.Location

func init() {
	var err error
	IST, err = time.LoadLocation("Asia/Kolkata")
	if err != nil {
		panic(fmt.Sprintf("curator: failed to load IST timezone: %v", err))
	}
}

// Errors.
var (
	ErrCuratorNotFound  = errors.New("curator not found")
	ErrShiftNotFound    = errors.New("shift not found")
	ErrAlreadyCheckedIn = errors.New("already checked in")
	ErrNotCheckedIn     = errors.New("no active check-in to end")
	ErrInvalidShift     = errors.New("invalid shift times")
)

// Repository handles all curator-related database access.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository creates a new curator repository.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Curator Identity
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// UpsertCurator creates or updates a curator record.
func (r *Repository) UpsertCurator(ctx context.Context, input UpsertCuratorInput) (*Curator, error) {
	var c Curator
	var trainingJSON []byte
	err := r.pool.QueryRow(ctx, `
		INSERT INTO ride_curators (user_id, campus_id, display_name, avatar_url)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id) DO UPDATE SET
		    display_name = EXCLUDED.display_name,
		    avatar_url = EXCLUDED.avatar_url,
		    last_active_at = NOW()
		RETURNING id, user_id, campus_id, display_name, avatar_url, tier, curator_score,
		          rides_curated, issues_resolved, tribes_led, rituals_completed,
		          biweekly_points, lifetime_points, training_completed,
		          joined_at, last_active_at, is_active`,
		input.UserID, input.CampusID, input.DisplayName, input.AvatarURL,
	).Scan(&c.ID, &c.UserID, &c.CampusID, &c.DisplayName, &c.AvatarURL, &c.Tier, &c.CuratorScore,
		&c.RidesCurated, &c.IssuesResolved, &c.TribesLed, &c.RitualsCompleted,
		&c.BiweeklyPoints, &c.LifetimePoints, &trainingJSON,
		&c.JoinedAt, &c.LastActiveAt, &c.IsActive)
	if err != nil {
		return nil, fmt.Errorf("upsert curator: %w", err)
	}
	if trainingJSON != nil {
		_ = json.Unmarshal(trainingJSON, &c.TrainingCompleted)
	}
	return &c, nil
}

// GetCurator fetches a curator by id.
func (r *Repository) GetCurator(ctx context.Context, curatorID uuid.UUID) (*Curator, error) {
	return r.fetchCurator(ctx, "id = $1", curatorID)
}

// GetCuratorByUser fetches a curator by user_id.
func (r *Repository) GetCuratorByUser(ctx context.Context, userID uuid.UUID) (*Curator, error) {
	return r.fetchCurator(ctx, "user_id = $1", userID)
}

// ListCuratorsForCampus returns active curators for a campus.
func (r *Repository) ListCuratorsForCampus(ctx context.Context, campusID uuid.UUID, limit int) ([]Curator, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := r.pool.Query(ctx, `
		SELECT id, user_id, campus_id, display_name, avatar_url, tier, curator_score,
		       rides_curated, issues_resolved, tribes_led, rituals_completed,
		       biweekly_points, lifetime_points, training_completed,
		       joined_at, last_active_at, is_active
		FROM ride_curators
		WHERE campus_id = $1 AND is_active = true
		ORDER BY curator_score DESC, last_active_at DESC
		LIMIT $2`, campusID, limit)
	if err != nil {
		return nil, fmt.Errorf("list curators: %w", err)
	}
	defer rows.Close()
	return r.scanCurators(rows)
}

func (r *Repository) fetchCurator(ctx context.Context, where string, arg any) (*Curator, error) {
	q := fmt.Sprintf(`
		SELECT id, user_id, campus_id, display_name, avatar_url, tier, curator_score,
		       rides_curated, issues_resolved, tribes_led, rituals_completed,
		       biweekly_points, lifetime_points, training_completed,
		       joined_at, last_active_at, is_active
		FROM ride_curators WHERE %s LIMIT 1`, where)
	var c Curator
	var trainingJSON []byte
	err := r.pool.QueryRow(ctx, q, arg).Scan(
		&c.ID, &c.UserID, &c.CampusID, &c.DisplayName, &c.AvatarURL, &c.Tier, &c.CuratorScore,
		&c.RidesCurated, &c.IssuesResolved, &c.TribesLed, &c.RitualsCompleted,
		&c.BiweeklyPoints, &c.LifetimePoints, &trainingJSON,
		&c.JoinedAt, &c.LastActiveAt, &c.IsActive,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrCuratorNotFound
		}
		return nil, err
	}
	if trainingJSON != nil {
		_ = json.Unmarshal(trainingJSON, &c.TrainingCompleted)
	}
	return &c, nil
}

func (r *Repository) scanCurators(rows pgx.Rows) ([]Curator, error) {
	out := []Curator{}
	for rows.Next() {
		var c Curator
		var trainingJSON []byte
		if err := rows.Scan(&c.ID, &c.UserID, &c.CampusID, &c.DisplayName, &c.AvatarURL,
			&c.Tier, &c.CuratorScore, &c.RidesCurated, &c.IssuesResolved,
			&c.TribesLed, &c.RitualsCompleted, &c.BiweeklyPoints, &c.LifetimePoints,
			&trainingJSON, &c.JoinedAt, &c.LastActiveAt, &c.IsActive); err != nil {
			return nil, err
		}
		if trainingJSON != nil {
			_ = json.Unmarshal(trainingJSON, &c.TrainingCompleted)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// IncrementStats bumps the aggregate stats for a curator.
func (r *Repository) IncrementStats(ctx context.Context, curatorID uuid.UUID, rides, issues, tribes, rituals, points int) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE ride_curators SET
		    rides_curated = rides_curated + $2,
		    issues_resolved = issues_resolved + $3,
		    tribes_led = tribes_led + $4,
		    rituals_completed = rituals_completed + $5,
		    biweekly_points = biweekly_points + $6,
		    lifetime_points = lifetime_points + $6,
		    curator_score = curator_score + $6,
		    last_active_at = NOW()
		WHERE id = $1`, curatorID, rides, issues, tribes, rituals, points)
	return err
}

// RecomputeTier updates the curator's tier based on curator_score.
func (r *Repository) RecomputeTier(ctx context.Context, curatorID uuid.UUID) error {
	var score int
	if err := r.pool.QueryRow(ctx, `SELECT COALESCE(curator_score,0)::int FROM ride_curators WHERE id = $1`, curatorID).Scan(&score); err != nil {
		return err
	}
	tier := "bronze"
	switch {
	case score >= 50000:
		tier = "diamond"
	case score >= 20000:
		tier = "platinum"
	case score >= 8000:
		tier = "gold"
	case score >= 3000:
		tier = "silver"
	}
	_, err := r.pool.Exec(ctx, `UPDATE ride_curators SET tier = $2 WHERE id = $1`, curatorID, tier)
	return err
}

// CompleteTraining appends a module to training_completed if missing.
func (r *Repository) CompleteTraining(ctx context.Context, curatorID uuid.UUID, moduleID string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE ride_curators
		SET training_completed = (
		    SELECT to_jsonb(array_agg(DISTINCT v))
		    FROM jsonb_array_elements_text(training_completed) AS v
		    WHERE v <> ''
		    UNION
		    SELECT $2::text
		),
		last_active_at = NOW()
		WHERE id = $1`, curatorID, moduleID)
	return err
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Shifts
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ScheduleShift inserts a future-curator shift.
func (r *Repository) ScheduleShift(ctx context.Context, input ScheduleShiftInput) (*Shift, error) {
	if !input.ScheduledEnd.After(input.ScheduledStart) {
		return nil, ErrInvalidShift
	}
	var s Shift
	var breaksJSON []byte
	err := r.pool.QueryRow(ctx, `
		INSERT INTO ride_curator_shifts (curator_id, campus_id, scheduled_start, scheduled_end, notes)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, curator_id, campus_id, scheduled_start, scheduled_end,
		          checked_in_at, checked_out_at, breaks, status,
		          rides_monitored, issues_handled, points_earned, notes`,
		input.CuratorID, input.CampusID, input.ScheduledStart, input.ScheduledEnd, input.Notes,
	).Scan(&s.ID, &s.CuratorID, &s.CampusID, &s.ScheduledStart, &s.ScheduledEnd,
		&s.CheckedInAt, &s.CheckedOutAt, &breaksJSON, &s.Status,
		&s.RidesMonitored, &s.IssuesHandled, &s.PointsEarned, &s.Notes)
	if err != nil {
		return nil, fmt.Errorf("schedule shift: %w", err)
	}
	if breaksJSON != nil {
		_ = json.Unmarshal(breaksJSON, &s.Breaks)
	}
	return &s, nil
}

// CheckIn marks a shift as active and records the check-in time.
func (r *Repository) CheckIn(ctx context.Context, shiftID, curatorID uuid.UUID) (*Shift, error) {
	var s Shift
	var breaksJSON []byte
	err := r.pool.QueryRow(ctx, `
		UPDATE ride_curator_shifts
		SET status = 'active', checked_in_at = NOW()
		WHERE id = $1 AND curator_id = $2 AND checked_in_at IS NULL
		RETURNING id, curator_id, campus_id, scheduled_start, scheduled_end,
		          checked_in_at, checked_out_at, breaks, status,
		          rides_monitored, issues_handled, points_earned, notes`,
		shiftID, curatorID,
	).Scan(&s.ID, &s.CuratorID, &s.CampusID, &s.ScheduledStart, &s.ScheduledEnd,
		&s.CheckedInAt, &s.CheckedOutAt, &breaksJSON, &s.Status,
		&s.RidesMonitored, &s.IssuesHandled, &s.PointsEarned, &s.Notes)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAlreadyCheckedIn
		}
		return nil, err
	}
	if breaksJSON != nil {
		_ = json.Unmarshal(breaksJSON, &s.Breaks)
	}
	return &s, nil
}

// CheckOut ends a shift and finalises its counters.
func (r *Repository) CheckOut(ctx context.Context, shiftID, curatorID uuid.UUID, pointsEarned int, notes *string) (*Shift, error) {
	var s Shift
	var breaksJSON []byte
	err := r.pool.QueryRow(ctx, `
		UPDATE ride_curator_shifts
		SET status = 'completed', checked_out_at = NOW(),
		    points_earned = $3, notes = COALESCE($4, notes)
		WHERE id = $1 AND curator_id = $2 AND checked_in_at IS NOT NULL AND checked_out_at IS NULL
		RETURNING id, curator_id, campus_id, scheduled_start, scheduled_end,
		          checked_in_at, checked_out_at, breaks, status,
		          rides_monitored, issues_handled, points_earned, notes`,
		shiftID, curatorID, pointsEarned, notes,
	).Scan(&s.ID, &s.CuratorID, &s.CampusID, &s.ScheduledStart, &s.ScheduledEnd,
		&s.CheckedInAt, &s.CheckedOutAt, &breaksJSON, &s.Status,
		&s.RidesMonitored, &s.IssuesHandled, &s.PointsEarned, &s.Notes)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotCheckedIn
		}
		return nil, err
	}
	if breaksJSON != nil {
		_ = json.Unmarshal(breaksJSON, &s.Breaks)
	}
	return &s, nil
}

// AddBreak appends a break record to a shift.
func (r *Repository) AddBreak(ctx context.Context, shiftID, curatorID uuid.UUID, br BreakRecord) error {
	brJSON, _ := json.Marshal(br)
	_, err := r.pool.Exec(ctx, `
		UPDATE ride_curator_shifts
		SET breaks = COALESCE(breaks, '[]'::jsonb) || $3::jsonb
		WHERE id = $1 AND curator_id = $2`, shiftID, curatorID, string(brJSON))
	return err
}

// GetShiftByID returns a single shift.
func (r *Repository) GetShiftByID(ctx context.Context, shiftID uuid.UUID) (*Shift, error) {
	var s Shift
	var breaksJSON []byte
	err := r.pool.QueryRow(ctx, `
		SELECT id, curator_id, campus_id, scheduled_start, scheduled_end,
		       checked_in_at, checked_out_at, breaks, status,
		       rides_monitored, issues_handled, points_earned, notes
		FROM ride_curator_shifts WHERE id = $1`, shiftID).Scan(
		&s.ID, &s.CuratorID, &s.CampusID, &s.ScheduledStart, &s.ScheduledEnd,
		&s.CheckedInAt, &s.CheckedOutAt, &breaksJSON, &s.Status,
		&s.RidesMonitored, &s.IssuesHandled, &s.PointsEarned, &s.Notes)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrShiftNotFound
		}
		return nil, err
	}
	if breaksJSON != nil {
		_ = json.Unmarshal(breaksJSON, &s.Breaks)
	}
	return &s, nil
}

// GetActiveShift returns the current checked-in shift, if any.
func (r *Repository) GetActiveShift(ctx context.Context, curatorID uuid.UUID) (*Shift, error) {
	var s Shift
	var breaksJSON []byte
	err := r.pool.QueryRow(ctx, `
		SELECT id, curator_id, campus_id, scheduled_start, scheduled_end,
		       checked_in_at, checked_out_at, breaks, status,
		       rides_monitored, issues_handled, points_earned, notes
		FROM ride_curator_shifts
		WHERE curator_id = $1 AND status = 'active'
		ORDER BY checked_in_at DESC
		LIMIT 1`, curatorID).Scan(
		&s.ID, &s.CuratorID, &s.CampusID, &s.ScheduledStart, &s.ScheduledEnd,
		&s.CheckedInAt, &s.CheckedOutAt, &breaksJSON, &s.Status,
		&s.RidesMonitored, &s.IssuesHandled, &s.PointsEarned, &s.Notes)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrShiftNotFound
		}
		return nil, err
	}
	if breaksJSON != nil {
		_ = json.Unmarshal(breaksJSON, &s.Breaks)
	}
	return &s, nil
}

// ListShifts returns shift history for a curator.
func (r *Repository) ListShifts(ctx context.Context, curatorID uuid.UUID, limit int, beforeID *uuid.UUID) ([]Shift, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	args := []any{curatorID}
	q := `
		SELECT id, curator_id, campus_id, scheduled_start, scheduled_end,
		       checked_in_at, checked_out_at, breaks, status,
		       rides_monitored, issues_handled, points_earned, notes
		FROM ride_curator_shifts
		WHERE curator_id = $1`
	if beforeID != nil {
		q += ` AND scheduled_start < (SELECT scheduled_start FROM ride_curator_shifts WHERE id = $2)`
		args = append(args, *beforeID)
	}
	q += ` ORDER BY scheduled_start DESC LIMIT ` + fmt.Sprintf("%d", limit)
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("list shifts: %w", err)
	}
	defer rows.Close()
	out := []Shift{}
	for rows.Next() {
		var s Shift
		var breaksJSON []byte
		if err := rows.Scan(&s.ID, &s.CuratorID, &s.CampusID, &s.ScheduledStart, &s.ScheduledEnd,
			&s.CheckedInAt, &s.CheckedOutAt, &breaksJSON, &s.Status,
			&s.RidesMonitored, &s.IssuesHandled, &s.PointsEarned, &s.Notes); err != nil {
			return nil, err
		}
		if breaksJSON != nil {
			_ = json.Unmarshal(breaksJSON, &s.Breaks)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// BumpShiftCounters increments ride/issue counters on the active shift.
func (r *Repository) BumpShiftCounters(ctx context.Context, curatorID uuid.UUID, rides, issues int) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE ride_curator_shifts
		SET rides_monitored = rides_monitored + $2,
		    issues_handled = issues_handled + $3
		WHERE curator_id = $1 AND status = 'active'`, curatorID, rides, issues)
	return err
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Leaderboard
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GetLeaderboard returns the leaderboard entries for a campus + period.
func (r *Repository) GetLeaderboard(ctx context.Context, campusID uuid.UUID, period string, limit int) ([]LeaderboardEntry, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	periodStart, periodEnd := computePeriodWindow(period)
	rows, err := r.pool.Query(ctx, `
		SELECT id, campus_id, period, period_start, period_end, curator_id,
		       rank, score, rides_curated, issues_resolved, bonus_points, reward
		FROM ride_curator_leaderboard
		WHERE campus_id = $1 AND period = $2 AND period_start = $3
		ORDER BY rank ASC LIMIT $4`, campusID, period, periodStart, limit)
	if err != nil {
		return nil, fmt.Errorf("get leaderboard: %w", err)
	}
	defer rows.Close()
	out := []LeaderboardEntry{}
	for rows.Next() {
		var e LeaderboardEntry
		var rewardJSON []byte
		if err := rows.Scan(&e.ID, &e.CampusID, &e.Period, &e.PeriodStart, &e.PeriodEnd,
			&e.CuratorID, &e.Rank, &e.Score, &e.RidesCurated, &e.IssuesResolved,
			&e.BonusPoints, &rewardJSON); err != nil {
			return nil, err
		}
		if rewardJSON != nil {
			_ = json.Unmarshal(rewardJSON, &e.Reward)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// GetMyEntry returns the requesting curator's leaderboard row, if present.
func (r *Repository) GetMyEntry(ctx context.Context, curatorID, campusID uuid.UUID, period string) (*LeaderboardEntry, error) {
	periodStart, _ := computePeriodWindow(period)
	var e LeaderboardEntry
	var rewardJSON []byte
	err := r.pool.QueryRow(ctx, `
		SELECT id, campus_id, period, period_start, period_end, curator_id,
		       rank, score, rides_curated, issues_resolved, bonus_points, reward
		FROM ride_curator_leaderboard
		WHERE campus_id = $1 AND period = $2 AND period_start = $3 AND curator_id = $4`,
		campusID, period, periodStart, curatorID,
	).Scan(&e.ID, &e.CampusID, &e.Period, &e.PeriodStart, &e.PeriodEnd,
		&e.CuratorID, &e.Rank, &e.Score, &e.RidesCurated, &e.IssuesResolved,
		&e.BonusPoints, &rewardJSON)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if rewardJSON != nil {
		_ = json.Unmarshal(rewardJSON, &e.Reward)
	}
	return &e, nil
}

// UpsertLeaderboardEntry inserts or updates a leaderboard row.
func (r *Repository) UpsertLeaderboardEntry(ctx context.Context, e LeaderboardEntry) error {
	rewardJSON, _ := json.Marshal(e.Reward)
	_, err := r.pool.Exec(ctx, `
		INSERT INTO ride_curator_leaderboard (
			campus_id, period, period_start, period_end, curator_id,
			rank, score, rides_curated, issues_resolved, bonus_points, reward
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (campus_id, period, period_start, curator_id) DO UPDATE SET
			rank = EXCLUDED.rank,
			score = EXCLUDED.score,
			rides_curated = EXCLUDED.rides_curated,
			issues_resolved = EXCLUDED.issues_resolved,
			bonus_points = EXCLUDED.bonus_points,
			reward = EXCLUDED.reward`,
		e.CampusID, e.Period, e.PeriodStart, e.PeriodEnd, e.CuratorID,
		e.Rank, e.Score, e.RidesCurated, e.IssuesResolved, e.BonusPoints, rewardJSON)
	return err
}

// RecomputeLeaderboard rebuilds the leaderboard rows for a campus+period from scratch.
func (r *Repository) RecomputeLeaderboard(ctx context.Context, campusID uuid.UUID, period string) error {
	periodStart, periodEnd := computePeriodWindow(period)
	// Recompute from ride_curator_shifts & curator stats.
	rows, err := r.pool.Query(ctx, `
		SELECT c.id AS curator_id,
		       COALESCE(SUM(s.rides_monitored),0)::int AS rides_curated,
		       COALESCE(SUM(s.issues_handled),0)::int AS issues_resolved,
		       COALESCE(SUM(s.points_earned),0)::int AS points
		FROM ride_curators c
		LEFT JOIN ride_curator_shifts s ON s.curator_id = c.id
		     AND s.scheduled_start >= $2 AND s.scheduled_start <= $3
		WHERE c.campus_id = $1 AND c.is_active = true
		GROUP BY c.id`, campusID, periodStart, periodEnd)
	if err != nil {
		return err
	}
	type row struct {
		curatorID     uuid.UUID
		ridesCurated  int
		issuesResolved int
		points        int
	}
	var rowsList []row
	for rs := range rowsSlice(rows) {
		rowsList = append(rowsList, rs)
	}
	// Order & rank
	for i := range rowsList {
		_ = i
	}
	// sort descending by points
	for i := 0; i < len(rowsList); i++ {
		for j := i + 1; j < len(rowsList); j++ {
			if rowsList[j].points > rowsList[i].points {
				rowsList[i], rowsList[j] = rowsList[j], rowsList[i]
			}
		}
	}
	for rank, r := range rowsList {
		reward := LeaderboardReward{Type: "coin", Value: 0, Label: ""}
		switch {
		case rank == 0:
			reward = LeaderboardReward{Type: "coin", Value: 500, Label: "🥇 Top Curator"}
		case rank == 1:
			reward = LeaderboardReward{Type: "coin", Value: 300, Label: "🥈 Runner Up"}
		case rank == 2:
			reward = LeaderboardReward{Type: "coin", Value: 150, Label: "🥉 Third Place"}
		case rank < 10:
			reward = LeaderboardReward{Type: "coin", Value: 50, Label: "Top 10"}
		}
		if err := r.UpsertLeaderboardEntry(ctx, LeaderboardEntry{
			CampusID: campusID, Period: period, PeriodStart: periodStart, PeriodEnd: periodEnd,
			CuratorID: r.curatorID, Rank: rank + 1, Score: r.points,
			RidesCurated: r.ridesCurated, IssuesResolved: r.issuesResolved,
			BonusPoints: reward.Value, Reward: reward,
		}); err != nil {
			return err
		}
	}
	_ = rows.Err()
	return nil
}

// rowsSlice drains a rows iterator into a slice of decoded rows.
type rawLeaderboardRow struct {
	CuratorID     uuid.UUID
	RidesCurated  int
	IssuesResolved int
	Points        int
}

func rowsSlice(rows pgx.Rows) <-chan rawLeaderboardRow {
	ch := make(chan rawLeaderboardRow)
	go func() {
		defer close(ch)
		for rows.Next() {
			var r rawLeaderboardRow
			if err := rows.Scan(&r.CuratorID, &r.RidesCurated, &r.IssuesResolved, &r.Points); err == nil {
				ch <- r
			}
		}
	}()
	return ch
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Analytics
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GetAnalytics returns aggregated curator analytics.
func (r *Repository) GetAnalytics(ctx context.Context, curatorID uuid.UUID, period string) (*CuratorAnalytics, error) {
	periodStart, periodEnd := computePeriodWindow(period)
	a := &CuratorAnalytics{Period: period}
	var avgRating *float64
	err := r.pool.QueryRow(ctx, `
		SELECT
		    COUNT(*) FILTER (WHERE status = 'completed'),
		    COALESCE(SUM(EXTRACT(EPOCH FROM (checked_out_at - checked_in_at))/60.0), 0),
		    COALESCE(SUM(issues_handled), 0),
		    COALESCE(SUM(rides_monitored), 0),
		    COALESCE(SUM(points_earned), 0)
		FROM ride_curator_shifts
		WHERE curator_id = $1 AND scheduled_start >= $2 AND scheduled_start <= $3`,
		curatorID, periodStart, periodEnd,
	).Scan(&a.TotalShifts, &a.TotalHours, &a.TotalIssues, &a.TotalRides, &a.TotalPoints)
	if err != nil {
		return nil, fmt.Errorf("analytics totals: %w", err)
	}
	a.TotalHours = math.Round((a.TotalHours/60.0)*100) / 100
	if a.TotalShifts > 0 {
		a.AvgIssuesPerShift = math.Round((float64(a.TotalIssues)/float64(a.TotalShifts))*100) / 100
	}
	_ = avgRating

	a.ShiftsByDay = r.dailyStat(ctx, `
		SELECT (scheduled_start AT TIME ZONE 'Asia/Kolkata')::date::text AS day, COUNT(*)::float
		FROM ride_curator_shifts
		WHERE curator_id = $1 AND scheduled_start >= $2 AND scheduled_start <= $3
		GROUP BY day ORDER BY day`, curatorID, periodStart, periodEnd)

	a.PointsByDay = r.dailyStat(ctx, `
		SELECT (scheduled_start AT TIME ZONE 'Asia/Kolkata')::date::text AS day,
		       COALESCE(SUM(points_earned),0)::float
		FROM ride_curator_shifts
		WHERE curator_id = $1 AND scheduled_start >= $2 AND scheduled_start <= $3
		GROUP BY day ORDER BY day`, curatorID, periodStart, periodEnd)

	a.IssuesByDay = r.dailyStat(ctx, `
		SELECT (scheduled_start AT TIME ZONE 'Asia/Kolkata')::date::text AS day,
		       COALESCE(SUM(issues_handled),0)::float
		FROM ride_curator_shifts
		WHERE curator_id = $1 AND scheduled_start >= $2 AND scheduled_start <= $3
		GROUP BY day ORDER BY day`, curatorID, periodStart, periodEnd)

	return a, nil
}

func (r *Repository) dailyStat(ctx context.Context, q string, args ...any) []DayStat {
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return []DayStat{}
	}
	defer rows.Close()
	out := []DayStat{}
	for rows.Next() {
		var s DayStat
		if err := rows.Scan(&s.Date, &s.Value); err == nil {
			s.Value = math.Round(s.Value*100) / 100
			out = append(out, s)
		}
	}
	return out
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Activity log (writes go via Kafka; this is a stub for
// returning recent activity from a kafka consumer table if present)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ListRecentActivity returns the recent shift + activity for a curator.
func (r *Repository) ListRecentActivity(ctx context.Context, curatorID uuid.UUID, limit int) ([]ActivityEntry, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, curator_id, status, issues_handled, rides_monitored, points_earned, scheduled_start
		FROM ride_curator_shifts
		WHERE curator_id = $1
		ORDER BY scheduled_start DESC LIMIT $2`, curatorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ActivityEntry{}
	for rows.Next() {
		var a ActivityEntry
		if err := rows.Scan(&a.ID, &a.CuratorID, &a.ActionType,
			&a.SubjectType, &a.SubjectID, &a.PointsDelta, &a.OccurredAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// computePeriodWindow returns the start and end time for a leaderboard period.
func computePeriodWindow(period string) (time.Time, time.Time) {
	now := time.Now().In(IST)
	switch period {
	case "daily":
		start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, IST)
		return start, now
	case "weekly":
		start := now.AddDate(0, 0, -7)
		return start, now
	case "monthly":
		start := now.AddDate(0, -1, 0)
		return start, now
	default:
		start := now.AddDate(0, 0, -7)
		return start, now
	}
}