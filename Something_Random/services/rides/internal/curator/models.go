package curator

import (
	"time"

	"github.com/google/uuid"
)

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Curator Identity
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Curator represents a campus ride curator (analogous to a driver with extra roles).
type Curator struct {
	ID               uuid.UUID              `json:"id"`
	UserID           uuid.UUID              `json:"user_id"`
	CampusID         uuid.UUID              `json:"campus_id"`
	DisplayName      string                 `json:"display_name"`
	AvatarURL        *string                `json:"avatar_url,omitempty"`
	Tier             string                 `json:"tier"`
	CuratorScore     float64                `json:"curator_score"`
	RidesCurated     int                    `json:"rides_curated"`
	IssuesResolved   int                    `json:"issues_resolved"`
	TribesLed        int                    `json:"tribes_led"`
	RitualsCompleted int                    `json:"rituals_completed"`
	BiweeklyPoints   int                    `json:"biweekly_points"`
	LifetimePoints   int                    `json:"lifetime_points"`
	TrainingCompleted []string              `json:"training_completed,omitempty"`
	JoinedAt         time.Time              `json:"joined_at"`
	LastActiveAt     time.Time              `json:"last_active_at"`
	IsActive         bool                   `json:"is_active"`
}

// CuratorTier describes tier benefits and progression.
type CuratorTier struct {
	Tier         string   `json:"tier"`
	MinScore     int      `json:"min_score"`
	Multiplier   float64  `json:"multiplier"`
	Benefits     []string `json:"benefits"`
	NextTier     *string  `json:"next_tier,omitempty"`
	PointsToNext *int     `json:"points_to_next,omitempty"`
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Shift Models
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// BreakRecord records a single break during a shift.
type BreakRecord struct {
	StartedAt time.Time `json:"started_at"`
	EndedAt   *time.Time `json:"ended_at,omitempty"`
	Reason    string    `json:"reason"`
}

// Shift represents a curator's on-duty session.
type Shift struct {
	ID             uuid.UUID     `json:"id"`
	CuratorID      uuid.UUID     `json:"curator_id"`
	CampusID       uuid.UUID     `json:"campus_id"`
	ScheduledStart time.Time     `json:"scheduled_start"`
	ScheduledEnd   time.Time     `json:"scheduled_end"`
	CheckedInAt    *time.Time    `json:"checked_in_at,omitempty"`
	CheckedOutAt   *time.Time    `json:"checked_out_at,omitempty"`
	Breaks         []BreakRecord `json:"breaks,omitempty"`
	Status         string        `json:"status"`
	RidesMonitored int           `json:"rides_monitored"`
	IssuesHandled  int           `json:"issues_handled"`
	PointsEarned   int           `json:"points_earned"`
	Notes          *string       `json:"notes,omitempty"`
}

// ShiftSummary provides an enriched view of a completed shift.
type ShiftSummary struct {
	Shift
	DurationMin       float64 `json:"duration_min"`
	BreakDurationMin  float64 `json:"break_duration_min"`
	EffectiveMin      float64 `json:"effective_min"`
	IssuesPerHour     float64 `json:"issues_per_hour"`
	PointsPerHour     float64 `json:"points_per_hour"`
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Leaderboard
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// LeaderboardReward is the JSON reward structure on ride_curator_leaderboard.
type LeaderboardReward struct {
	Type  string  `json:"type"`
	Value int     `json:"value"`
	Label string  `json:"label"`
}

// LeaderboardEntry is a single curator's ranked position.
type LeaderboardEntry struct {
	ID            uuid.UUID         `json:"id"`
	CampusID      uuid.UUID         `json:"campus_id"`
	Period        string            `json:"period"`
	PeriodStart   time.Time         `json:"period_start"`
	PeriodEnd     time.Time         `json:"period_end"`
	CuratorID     uuid.UUID         `json:"curator_id"`
	Rank          int               `json:"rank"`
	Score         int               `json:"score"`
	RidesCurated  int               `json:"rides_curated"`
	IssuesResolved int              `json:"issues_resolved"`
	BonusPoints   int               `json:"bonus_points"`
	Reward        LeaderboardReward `json:"reward"`
}

// LeaderboardResponse is the full leaderboard view including curator display data.
type LeaderboardResponse struct {
	Period    string            `json:"period"`
	PeriodStart time.Time       `json:"period_start"`
	PeriodEnd   time.Time       `json:"period_end"`
	Entries   []LeaderboardEntry `json:"entries"`
	MyEntry   *LeaderboardEntry  `json:"my_entry,omitempty"`
	TotalParticipants int        `json:"total_participants"`
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Analytics
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// DayStat is a single data point in a time-series analytics response.
type DayStat struct {
	Date  string  `json:"date"`
	Value float64 `json:"value"`
}

// CuratorAnalytics aggregates curator performance metrics.
type CuratorAnalytics struct {
	Period            string    `json:"period"`
	TotalShifts       int       `json:"total_shifts"`
	TotalHours        float64   `json:"total_hours"`
	TotalIssues       int       `json:"total_issues"`
	TotalRides        int       `json:"total_rides"`
	TotalPoints       int       `json:"total_points"`
	AvgIssuesPerShift float64   `json:"avg_issues_per_shift"`
	AvgRating         float64   `json:"avg_rating"`
	ShiftsByDay       []DayStat `json:"shifts_by_day"`
	PointsByDay       []DayStat `json:"points_by_day"`
	IssuesByDay       []DayStat `json:"issues_by_day"`
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Issue / Activity Log
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ActivityEntry is a single curated ride-monitoring activity.
type ActivityEntry struct {
	ID           uuid.UUID `json:"id"`
	CuratorID    uuid.UUID `json:"curator_id"`
	ActionType   string    `json:"action_type"`
	SubjectType  string    `json:"subject_type"`
	SubjectID    *uuid.UUID `json:"subject_id,omitempty"`
	Notes        *string   `json:"notes,omitempty"`
	PointsDelta  int       `json:"points_delta"`
	OccurredAt   time.Time `json:"occurred_at"`
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Input Structs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// UpsertCuratorInput is used to register or update a curator.
type UpsertCuratorInput struct {
	UserID      uuid.UUID `json:"user_id"      binding:"required"`
	CampusID    uuid.UUID `json:"campus_id"    binding:"required"`
	DisplayName string    `json:"display_name" binding:"required,min=1,max=128"`
	AvatarURL   *string   `json:"avatar_url"`
}

// ScheduleShiftInput schedules a future shift.
type ScheduleShiftInput struct {
	CuratorID      uuid.UUID `json:"curator_id"      binding:"required"`
	CampusID       uuid.UUID `json:"campus_id"       binding:"required"`
	ScheduledStart time.Time `json:"scheduled_start" binding:"required"`
	ScheduledEnd   time.Time `json:"scheduled_end"   binding:"required"`
	Notes          *string   `json:"notes"`
}

// CheckInInput is the request payload for checking into a shift.
type CheckInInput struct {
	Lat *float64 `json:"lat,omitempty"`
	Lng *float64 `json:"lng,omitempty"`
}

// CheckOutInput ends an active shift.
type CheckOutInput struct {
	Lat   *float64 `json:"lat,omitempty"`
	Lng   *float64 `json:"lng,omitempty"`
	Notes *string  `json:"notes,omitempty"`
}

// BreakInput records a break.
type BreakInput struct {
	Reason string `json:"reason" binding:"required,min=1,max=120"`
}

// LogActivityInput is used for curator activity logging.
type LogActivityInput struct {
	ActionType  string     `json:"action_type"  binding:"required,min=1,max=60"`
	SubjectType string     `json:"subject_type" binding:"required,min=1,max=60"`
	SubjectID   *uuid.UUID `json:"subject_id"`
	Notes       *string    `json:"notes"`
}

// CompleteTrainingInput marks a training module complete.
type CompleteTrainingInput struct {
	ModuleID string `json:"module_id" binding:"required,min=1,max=80"`
}