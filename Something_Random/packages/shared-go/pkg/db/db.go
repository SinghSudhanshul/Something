package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rideandgo/shared-go/pkg/config"
	"github.com/rideandgo/shared-go/pkg/log"
)

type DB struct {
	Pool *pgxpool.Pool
}

func Connect(ctx context.Context, cfg config.DatabaseConfig) (*DB, error) {
	poolConfig, err := pgxpool.ParseConfig(cfg.DSN())
	if err != nil {
		return nil, fmt.Errorf("failed to parse database config: %w", err)
	}

	poolConfig.MaxConns = int32(cfg.MaxOpenConns)
	poolConfig.MinConns = int32(cfg.MaxIdleConns)
	poolConfig.MaxConnLifetime = cfg.ConnMaxLifetime
	poolConfig.MaxConnIdleTime = cfg.ConnMaxIdleTime
	poolConfig.HealthCheckPeriod = 1 * time.Minute

	poolConfig.BeforeAcquire = func(ctx context.Context, c *pgx.Conn) bool {
		return c.Ping(ctx) == nil
	}

	poolConfig.AfterRelease = func(c *pgx.Conn) bool {
		return c.Ping(ctx) == nil
	}

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	log.Info("database connected",
		log.String("host", cfg.Host),
		log.Int("port", cfg.Port),
		log.String("database", cfg.Name),
		log.Int("max_open_conns", cfg.MaxOpenConns),
	)

	return &DB{Pool: pool}, nil
}

func (db *DB) Close() {
	db.Pool.Close()
	log.Info("database connection closed")
}

func (db *DB) Ping(ctx context.Context) error {
	return db.Pool.Ping(ctx)
}

func (db *DB) BeginTx(ctx context.Context, opts pgx.TxOptions) (pgx.Tx, error) {
	return db.Pool.BeginTx(ctx, opts)
}

func (db *DB) Exec(ctx context.Context, sql string, args ...interface{}) (pgx.CommandTag, error) {
	return db.Pool.Exec(ctx, sql, args...)
}

func (db *DB) Query(ctx context.Context, sql string, args ...interface{}) (pgx.Rows, error) {
	return db.Pool.Query(ctx, sql, args...)
}

func (db *DB) QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row {
	return db.Pool.QueryRow(ctx, sql, args...)
}

func (db *DB) CopyFrom(ctx context.Context, tableName pgx.Identifier, columnNames []string, rowSource pgx.CopyFromSource) (int64, error) {
	return db.Pool.CopyFrom(ctx, tableName, columnNames, rowSource)
}

func (db *DB) SendBatch(ctx context.Context, b *pgx.Batch) pgx.BatchResults {
	return db.Pool.SendBatch(ctx, b)
}

func WithTx(ctx context.Context, db *DB, fn func(pgx.Tx) error) error {
	tx, err := db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}

	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback(ctx)
			panic(p)
		}
	}()

	if err := fn(tx); err != nil {
		if rbErr := tx.Rollback(ctx); rbErr != nil {
			log.Error("failed to rollback transaction", log.Error(rbErr))
		}
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

func (db *DB) Stats() *pgxpool.Stat {
	return db.Pool.Stat()
}