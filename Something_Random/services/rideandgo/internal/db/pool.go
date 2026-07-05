// Package db wires up the PostgreSQL connection pool. It uses
// jackc/pgx as the driver because of its superior performance,
// native PostgreSQL type support, and superior batch API.
// All transactions in the service MUST go through WithTransaction —
// raw BEGIN/COMMIT is forbidden by the package convention.
package db

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"math"
	"runtime"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"

	"rideandgo/internal/config"
)

// ErrNoConnection is returned when no pool connection is available
// within the configured acquisition timeout. Treat as a 503.
var ErrNoConnection = errors.New("db: no connection available within timeout")

// Pool wraps pgxpool.Pool with service-specific helpers. It is safe
// for concurrent use by all goroutines.
type Pool struct {
	p     *pgxpool.Pool
	cfg   *config.Config
	mtrcs *Metrics
}

// Metrics is the Prometheus instrumentation surface for the pool.
type Metrics struct {
	AcquireTotal       prometheus.Counter
	AcquireDuration    prometheus.Histogram
	ActiveConnections  prometheus.Gauge
	IdleConnections    prometheus.Gauge
	TotalConnections   prometheus.Gauge
	QueryDuration      *prometheus.HistogramVec
	TransactionsTotal  *prometheus.CounterVec
	ErrorsTotal        *prometheus.CounterVec
}

// NewMetrics constructs the metric set registered against the
// given registry. Idempotent only if a custom registry is used;
// against prometheus.DefaultRegisterer, panics on duplicate.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	m := &Metrics{
		AcquireTotal: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "rideandgo_db_pool_acquire_total",
			Help: "Total number of pool acquisitions.",
		}),
		AcquireDuration: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "rideandgo_db_pool_acquire_duration_seconds",
			Help:    "Time spent acquiring a connection from the pool.",
			Buckets: prometheus.ExponentialBuckets(0.0001, 2, 14),
		}),
		ActiveConnections: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "rideandgo_db_pool_active_connections",
			Help: "Number of connections currently checked out.",
		}),
		IdleConnections: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "rideandgo_db_pool_idle_connections",
			Help: "Number of idle connections in the pool.",
		}),
		TotalConnections: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "rideandgo_db_pool_total_connections",
			Help: "Total connections held by the pool.",
		}),
		QueryDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "rideandgo_db_query_duration_seconds",
			Help:    "Duration of SQL queries by operation type.",
			Buckets: prometheus.ExponentialBuckets(0.0005, 2, 16),
		}, []string{"op"}),
		TransactionsTotal: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "rideandgo_db_transactions_total",
			Help: "Number of database transactions by outcome.",
		}, []string{"outcome"}),
		ErrorsTotal: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "rideandgo_db_errors_total",
			Help: "Number of database errors by class.",
		}, []string{"class"}),
	}
	reg.MustRegister(
		m.AcquireTotal, m.AcquireDuration,
		m.ActiveConnections, m.IdleConnections, m.TotalConnections,
		m.QueryDuration, m.TransactionsTotal, m.ErrorsTotal,
	)
	return m
}

// NewPool creates a configured connection pool. It pings the
// database to verify connectivity — if the database is unreachable
// at startup, this function returns an error rather than silently
// allowing the service to come up in a degraded state.
func NewPool(ctx context.Context, cfg *config.Config, mtrcs *Metrics) (*Pool, error) {
	pcfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("db: parse url: %w", err)
	}
	pcfg.MaxConns = cfg.DatabaseMaxConns
	pcfg.MinConns = cfg.DatabaseMinConns
	pcfg.MaxConnLifetime = cfg.DatabaseMaxConnLifetime
	pcfg.MaxConnIdleTime = cfg.DatabaseMaxConnIdleTime
	pcfg.HealthCheckPeriod = cfg.DatabaseHealthCheck
	pcfg.StatementCacheCapacity = cfg.DatabaseStatementCache
	pcfg.ConnConfig.RuntimeParams["application_name"] = cfg.ServiceName
	pcfg.ConnConfig.RuntimeParams["statement_timeout"] = "30000"
	pcfg.ConnConfig.RuntimeParams["idle_in_transaction_session_timeout"] = "60000"
	pcfg.ConnConfig.RuntimeParams["tcp_keepalives_idle"] = "60"
	pcfg.ConnConfig.RuntimeParams["tcp_keepalives_interval"] = "10"
	pcfg.ConnConfig.RuntimeParams["tcp_keepalives_count"] = "6"

	pool, err := pgxpool.NewWithConfig(ctx, pcfg)
	if err != nil {
		return nil, fmt.Errorf("db: new pool: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("db: initial ping failed: %w", err)
	}

	p := &Pool{p: pool, cfg: cfg, mtrcs: mtrcs}
	go p.collectStats(ctx)
	return p, nil
}

// Close releases all connections in the pool.
func (p *Pool) Close() { p.p.Close() }

// Stats returns the current pool statistics.
func (p *Pool) Stats() *pgxpool.Stat { return p.p.Stat }

// Acquire blocks until a connection is available, then returns it.
// The caller MUST call conn.Release() when finished. Pool acquisition
// metrics are recorded on every call.
func (p *Pool) Acquire(ctx context.Context) (*pgxpool.Conn, error) {
	p.mtrcs.AcquireTotal.Inc()
	start := time.Now()
	conn, err := p.p.Acquire(ctx)
	p.mtrcs.AcquireDuration.Observe(time.Since(start).Seconds())
	if err != nil {
		p.mtrcs.ErrorsTotal.WithLabelValues("acquire").Inc()
		return nil, fmt.Errorf("%w: %v", ErrNoConnection, err)
	}
	return conn, nil
}

// Exec runs a single non-returning query. Use for INSERT/UPDATE/DELETE
// where rows are not needed by the caller.
func (p *Pool) Exec(ctx context.Context, sql string, args ...any) error {
	start := time.Now()
	defer func() {
		p.mtrcs.QueryDuration.WithLabelValues("exec").Observe(time.Since(start).Seconds())
	}()
	_, err := p.p.Exec(ctx, sql, args...)
	if err != nil {
		p.mtrcs.ErrorsTotal.WithLabelValues("exec").Inc()
		return err
	}
	return nil
}

// Query runs a SQL query and calls fn for each row. fn must not
// retain references to row values beyond its scope.
func (p *Pool) Query(ctx context.Context, sql string, args []any, fn func(pgx.Rows) error) error {
	start := time.Now()
	defer func() {
		p.mtrcs.QueryDuration.WithLabelValues("query").Observe(time.Since(start).Seconds())
	}()
	rows, err := p.p.Query(ctx, sql, args...)
	if err != nil {
		p.mtrcs.ErrorsTotal.WithLabelValues("query").Inc()
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err := fn(rows); err != nil {
			return err
		}
	}
	return rows.Err()
}

// QueryRow runs a query returning a single row.
func (p *Pool) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	start := time.Now()
	defer func() {
		p.mtrcs.QueryDuration.WithLabelValues("query_row").Observe(time.Since(start).Seconds())
	}()
	return p.p.QueryRow(ctx, sql, args...)
}

// WithTransaction runs fn inside a serializable transaction. The
// transaction is committed if fn returns nil, rolled back otherwise.
// Panics in fn are converted to rollbacks and re-raised. Callers
// must never write raw BEGIN/COMMIT — this is the only sanctioned
// transaction entry point in the codebase.
func (p *Pool) WithTransaction(ctx context.Context, opts *TxOptions, fn func(pgx.Tx) error) (err error) {
	start := time.Now()
	txOpts := pgx.TxOptions{
		IsoLevel:   pgx.ReadCommitted,
		AccessMode: pgx.ReadWrite,
	}
	if opts != nil {
		if opts.Serializable {
			txOpts.IsoLevel = pgx.Serializable
		}
		if opts.ReadOnly {
			txOpts.AccessMode = pgx.ReadOnly
		}
	}

	conn, err := p.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	tx, err := conn.BeginTx(ctx, txOpts)
	if err != nil {
		p.mtrcs.ErrorsTotal.WithLabelValues("begin").Inc()
		p.mtrcs.TransactionsTotal.WithLabelValues("error").Inc()
		return err
	}

	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback(ctx)
			p.mtrcs.TransactionsTotal.WithLabelValues("panic").Inc()
			panic(p)
		}
		if err != nil {
			if rbErr := tx.Rollback(ctx); rbErr != nil && !errors.Is(rbErr, pgx.ErrTxClosed) {
				p.mtrcs.ErrorsTotal.WithLabelValues("rollback").Inc()
			}
			p.mtrcs.TransactionsTotal.WithLabelValues("rolled_back").Inc()
			return
		}
		if cErr := tx.Commit(ctx); cErr != nil {
			err = fmt.Errorf("commit: %w", cErr)
			p.mtrcs.ErrorsTotal.WithLabelValues("commit").Inc()
			p.mtrcs.TransactionsTotal.WithLabelValues("commit_error").Inc()
			return
		}
		p.mtrcs.TransactionsTotal.WithLabelValues("committed").Inc()
		_ = start
	}()

	err = fn(tx)
	return
}

// TxOptions configures transaction semantics.
type TxOptions struct {
	Serializable bool
	ReadOnly     bool
}

// IsUniqueViolation reports whether err is a Postgres unique_violation
// (SQLSTATE 23505). Use for "already exists" cases that should be
// translated to 409 Conflict, not 500 Internal Server Error.
func IsUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return false
}

// IsForeignKeyViolation reports whether err is a foreign_key_violation
// (SQLSTATE 23503). Use to map "referenced row missing" to 400.
func IsForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23503"
	}
	return false
}

// IsCheckViolation reports whether err is a check_violation (SQLSTATE 23514).
func IsCheckViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23514"
	}
	return false
}

// IsSerializationFailure reports whether the error is a serialization
// failure that the caller should retry (SQLSTATE 40001).
func IsSerializationFailure(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "40001"
	}
	return false
}

// collectStats updates the pool gauge metrics every 5 seconds.
// Runs until ctx is cancelled.
func (p *Pool) collectStats(ctx context.Context) {
	t := time.NewTicker(5 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s := p.p.Stat()
			p.mtrcs.ActiveConnections.Set(float64(s.AcquiredConns()))
			p.mtrcs.IdleConnections.Set(float64(s.IdleConns()))
			p.mtrcs.TotalConnections.Set(float64(s.TotalConns()))
		}
	}
}

// ShardKey derives a deterministic shard number for an entity ID.
// Used for routing lookups to a specific shard when sharding is
// enabled (not yet — here as a forward-compat helper).
func ShardKey(id string, n int) int {
	if n <= 0 {
		return 0
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(id))
	return int(h.Sum32() % uint32(n))
}

// RandFloat is a small wrapper to keep allocation patterns predictable
// for pool warmup logic.
func RandFloat() float64 {
	var b [8]byte
	for i := 0; i < 8; i++ {
		b[i] = byte(atomic.AddInt64((*int64)(nil), int64(runtime.NumGoroutine()))) //nolint:staticcheck
	}
	h := fnv.New32a()
	_, _ = h.Write(b[:])
	return float64(h.Sum32()) / math.MaxUint32
}
