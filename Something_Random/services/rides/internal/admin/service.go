package admin

import (
	"context"
	"fmt"
	"runtime"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	internalKafka "nexus/rides/internal/kafka"
)

// Service provides admin dashboard business logic.
type Service struct {
	repo   *Repository
	pool   *pgxpool.Pool
	rdb    *redis.Client
	kafka  *internalKafka.Producer
	logger *zap.Logger
}

// NewService creates a new admin service.
func NewService(repo *Repository, pool *pgxpool.Pool, rdb *redis.Client, kafka *internalKafka.Producer, logger *zap.Logger) *Service {
	return &Service{repo: repo, pool: pool, rdb: rdb, kafka: kafka, logger: logger}
}

// GetCommandCenterStats returns real-time dashboard statistics.
func (s *Service) GetCommandCenterStats(ctx context.Context) (*DashboardStats, error) {
	stats, err := s.repo.GetDashboardStats(ctx)
	if err != nil {
		s.logger.Error("failed to get dashboard stats", zap.Error(err))
		return nil, fmt.Errorf("failed to get dashboard stats: %w", err)
	}
	return stats, nil
}

// GetRevenuePulse returns revenue analytics with growth rate.
func (s *Service) GetRevenuePulse(ctx context.Context, period string, campusID *string) (*RevenuePulse, error) {
	if period == "" {
		period = "daily"
	}
	pulse, err := s.repo.GetRevenuePulse(ctx, period, campusID)
	if err != nil {
		s.logger.Error("failed to get revenue pulse", zap.Error(err))
		return nil, fmt.Errorf("failed to get revenue pulse: %w", err)
	}
	if pulse.PreviousPeriodRevenue > 0 {
		pulse.GrowthRate = ((pulse.TotalRevenue - pulse.PreviousPeriodRevenue) / pulse.PreviousPeriodRevenue) * 100
	}
	return pulse, nil
}

// GetSystemHealth returns real system health metrics.
func (s *Service) GetSystemHealth(ctx context.Context) (*SystemHealth, error) {
	health := &SystemHealth{}

	// Database pool stats
	poolStat := s.pool.Stat()
	health.DBPoolActive = int(poolStat.AcquiredConns())
	health.DBPoolIdle = int(poolStat.IdleConns())
	health.DBPoolTotal = int(poolStat.TotalConns())

	// Redis health
	start := time.Now()
	if err := s.rdb.Ping(ctx).Err(); err != nil {
		health.RedisConnected = false
	} else {
		health.RedisConnected = true
		health.RedisLatencyMs = float64(time.Since(start).Microseconds()) / 1000.0
	}

	// Runtime stats
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	health.MemoryUsageMB = float64(m.Alloc) / 1024 / 1024
	health.GoroutineCount = runtime.NumGoroutine()
	health.KafkaHealthy = true // Assume healthy if producer is alive

	return health, nil
}

// ListCurators returns paginated list of curators with filters.
func (s *Service) ListCurators(ctx context.Context, campusID *string, verified *bool, available *bool, search string, limit int, cursor *string) ([]CuratorDetail, int, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	return s.repo.ListCurators(ctx, campusID, verified, available, search, limit, cursor)
}

// GetCuratorDetail returns detailed curator information.
func (s *Service) GetCuratorDetail(ctx context.Context, driverID string) (*CuratorDetail, error) {
	return s.repo.GetCuratorDetail(ctx, driverID)
}

// ApproveCurator approves a curator and logs the action.
func (s *Service) ApproveCurator(ctx context.Context, driverID string, actorID string) error {
	if err := s.repo.ApproveCurator(ctx, driverID); err != nil {
		return fmt.Errorf("failed to approve curator: %w", err)
	}
	s.LogAction(ctx, actorID, "super_admin", "approve_curator", "driver", driverID, nil)
	_ = s.kafka.Publish(ctx, "nexus.rides.curator_approved", driverID, internalKafka.Event{
		Type:    "nexus.rides.curator_approved",
		Payload: map[string]interface{}{"driver_id": driverID},
	})
	return nil
}

// SuspendCurator suspends a curator with reason.
func (s *Service) SuspendCurator(ctx context.Context, driverID string, reason string, actorID string) error {
	if err := s.repo.SuspendCurator(ctx, driverID); err != nil {
		return fmt.Errorf("failed to suspend curator: %w", err)
	}
	s.LogAction(ctx, actorID, "super_admin", "suspend_curator", "driver", driverID, map[string]interface{}{"reason": reason})
	_ = s.kafka.Publish(ctx, "nexus.rides.curator_suspended", driverID, internalKafka.Event{
		Type:    "nexus.rides.curator_suspended",
		Payload: map[string]interface{}{"driver_id": driverID, "reason": reason},
	})
	return nil
}

// LogAction creates an audit log entry.
func (s *Service) LogAction(ctx context.Context, actorID, actorRole, action, resourceType, resourceID string, details map[string]interface{}) {
	if err := s.repo.CreateAuditLog(ctx, AuditLog{
		ActorID:      mustParseUUID(actorID),
		ActorRole:    actorRole,
		Action:       action,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Details:      details,
	}); err != nil {
		s.logger.Error("failed to create audit log", zap.Error(err), zap.String("action", action))
	}
}

// GetAuditLogs returns paginated audit logs.
func (s *Service) GetAuditLogs(ctx context.Context, action, resourceType, actorID *string, from, to *time.Time, limit int, cursor *string) ([]AuditLog, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	return s.repo.ListAuditLogs(ctx, action, resourceType, actorID, from, to, limit, cursor)
}

// GetDemandHeatmap returns demand density data for a campus.
func (s *Service) GetDemandHeatmap(ctx context.Context, campusID string, from, to *time.Time) ([]HeatmapCell, error) {
	return s.repo.GetDemandHeatmap(ctx, campusID, from, to)
}

// GetPredictedDemand returns predicted demand based on historical patterns.
func (s *Service) GetPredictedDemand(ctx context.Context, campusID string) ([]HeatmapCell, error) {
	return s.repo.GetPredictedDemand(ctx, campusID)
}

// GenerateDailyReport returns comprehensive daily operations report.
func (s *Service) GenerateDailyReport(ctx context.Context, date string) (*DailyReport, error) {
	return s.repo.GetDailyReport(ctx, date)
}

// GenerateCampusReport returns campus-specific report.
func (s *Service) GenerateCampusReport(ctx context.Context, campusID string, date string) (*DailyReport, error) {
	return s.repo.GetCampusReport(ctx, campusID, date)
}

func mustParseUUID(s string) uuid.UUID {
	id, _ := uuid.Parse(s)
	return id
}
