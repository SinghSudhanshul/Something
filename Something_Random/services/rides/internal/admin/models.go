package admin

import (
	"time"

	"github.com/google/uuid"
)

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUDIT LOGS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// AuditLog records every admin action for compliance and traceability.
type AuditLog struct {
	ID           uuid.UUID              `json:"id"`
	ActorID      uuid.UUID              `json:"actor_id"`
	ActorRole    string                 `json:"actor_role"`
	Action       string                 `json:"action"`
	ResourceType string                 `json:"resource_type"`
	ResourceID   string                 `json:"resource_id"`
	CampusID     *uuid.UUID             `json:"campus_id,omitempty"`
	Details      map[string]interface{} `json:"details"`
	IPAddress    *string                `json:"ip_address,omitempty"`
	UserAgent    *string                `json:"user_agent,omitempty"`
	RequestID    *string                `json:"request_id,omitempty"`
	DurationMs   *int                   `json:"duration_ms,omitempty"`
	StatusCode   *int                   `json:"status_code,omitempty"`
	CreatedAt    time.Time              `json:"created_at"`
}

// CreateAuditLogInput holds data for inserting an audit log entry.
type CreateAuditLogInput struct {
	ActorID      uuid.UUID
	ActorRole    string
	Action       string
	ResourceType string
	ResourceID   string
	CampusID     *uuid.UUID
	Details      map[string]interface{}
	IPAddress    *string
	UserAgent    *string
	RequestID    *string
	DurationMs   *int
	StatusCode   *int
}

// AuditLogFilter provides cursor-paginated, filterable access to audit logs.
type AuditLogFilter struct {
	Action       string
	ResourceType string
	ActorID      *uuid.UUID
	From         *time.Time
	To           *time.Time
	Limit        int
	Cursor       *time.Time
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DEMAND HEATMAP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// HeatmapCell represents demand/supply intensity at a single geographic grid cell.
type HeatmapCell struct {
	CampusID        uuid.UUID `json:"campus_id"`
	Lat             float64   `json:"lat"`
	Lng             float64   `json:"lng"`
	CellSize        float64   `json:"cell_size"`
	DemandScore     float64   `json:"demand_score"`
	SupplyScore     float64   `json:"supply_score"`
	SurgeMultiplier float64   `json:"surge_multiplier"`
	RideCount       int       `json:"ride_count"`
	TimeBucket      time.Time `json:"time_bucket"`
	Prediction      bool      `json:"prediction"`
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DASHBOARD STATS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// DashboardStats provides a real-time overview for the command centre.
type DashboardStats struct {
	ActiveRides    int     `json:"active_rides"`
	OnlineDrivers  int     `json:"online_drivers"`
	PendingSOS     int     `json:"pending_sos"`
	TodayRides     int     `json:"today_rides"`
	TodayCompleted int     `json:"today_completed"`
	TodayCancelled int     `json:"today_cancelled"`
	TodayRevenue   float64 `json:"today_revenue"`
	AvgRating      float64 `json:"avg_rating"`
	CompletionRate float64 `json:"completion_rate"`
	ActiveShifts   int     `json:"active_shifts"`
	PeakHour       string  `json:"peak_hour"`
	AvgMatchTime   string  `json:"avg_match_time"`
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REVENUE ANALYTICS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// RevenuePulse provides a comprehensive revenue snapshot with growth tracking.
type RevenuePulse struct {
	TotalRevenue          float64           `json:"total_revenue"`
	PreviousPeriodRevenue float64           `json:"previous_period_revenue"`
	GrowthRate            float64           `json:"growth_rate"`
	ByRideType            map[string]float64 `json:"by_ride_type"`
	ByCampus              []CampusRevenue   `json:"by_campus"`
	TimeSeries            []TimeSeriesPoint `json:"time_series"`
	AvgFare               float64           `json:"avg_fare"`
	AvgTip                float64           `json:"avg_tip"`
	TotalRides            int               `json:"total_rides"`
}

// CampusRevenue breaks down revenue at campus level.
type CampusRevenue struct {
	CampusID   uuid.UUID `json:"campus_id"`
	CampusName string    `json:"campus_name"`
	Revenue    float64   `json:"revenue"`
	RideCount  int       `json:"ride_count"`
}

// TimeSeriesPoint is a single data point in a time series.
type TimeSeriesPoint struct {
	Timestamp string  `json:"timestamp"`
	Value     float64 `json:"value"`
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SYSTEM HEALTH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// SystemHealth reports infrastructure-level metrics for ops monitoring.
type SystemHealth struct {
	DBPoolActive   int     `json:"db_pool_active"`
	DBPoolIdle     int     `json:"db_pool_idle"`
	DBPoolTotal    int     `json:"db_pool_total"`
	RedisConnected bool    `json:"redis_connected"`
	RedisLatencyMs float64 `json:"redis_latency_ms"`
	KafkaHealthy   bool    `json:"kafka_healthy"`
	Uptime         string  `json:"uptime"`
	MemoryUsageMB  float64 `json:"memory_usage_mb"`
	GoroutineCount int     `json:"goroutine_count"`
	CPUUsage       float64 `json:"cpu_usage"`
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CURATOR (DRIVER) MANAGEMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// CuratorDetail provides an enriched driver profile for admin review.
type CuratorDetail struct {
	DriverID      uuid.UUID  `json:"driver_id"`
	Name          string     `json:"name"`
	VehicleType   string     `json:"vehicle_type"`
	VehicleNumber string     `json:"vehicle_number"`
	IsVerified    bool       `json:"is_verified"`
	IsAvailable   bool       `json:"is_available"`
	TotalRides    int        `json:"total_rides"`
	AvgRating     float64    `json:"avg_rating"`
	TotalEarnings float64    `json:"total_earnings"`
	JoinedAt      time.Time  `json:"joined_at"`
	LastActiveAt  *time.Time `json:"last_active_at,omitempty"`
	Status        string     `json:"status"`
	Flags         []string   `json:"flags"`
}

// CuratorListFilter provides cursor-paginated, filterable access to curators.
type CuratorListFilter struct {
	CampusID  *uuid.UUID
	Verified  *bool
	Available *bool
	Search    string
	Limit     int
	Cursor    *uuid.UUID
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DAILY REPORTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// DailyReport captures a comprehensive snapshot of a single day's operations.
type DailyReport struct {
	Date            string        `json:"date"`
	TotalRides      int           `json:"total_rides"`
	CompletedRides  int           `json:"completed_rides"`
	CancelledRides  int           `json:"cancelled_rides"`
	Revenue         float64       `json:"revenue"`
	AvgFare         float64       `json:"avg_fare"`
	PeakHour        string        `json:"peak_hour"`
	AvgMatchTimeSec float64       `json:"avg_match_time_sec"`
	SOSCount        int           `json:"sos_count"`
	IncidentCount   int           `json:"incident_count"`
	TopCurators     []LeaderEntry `json:"top_curators"`
	BusiestRoutes   []RouteEntry  `json:"busiest_routes"`
}

// LeaderEntry represents a ranked item in a leaderboard.
type LeaderEntry struct {
	Name  string  `json:"name"`
	Value float64 `json:"value"`
}

// RouteEntry represents a popular route with ride count.
type RouteEntry struct {
	From  string `json:"from"`
	To    string `json:"to"`
	Count int    `json:"count"`
}
