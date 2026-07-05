/**
 * NEXUS Trust Service — Zod-validated Environment Configuration
 *
 * All environment variables are validated at boot time. Missing or invalid
 * variables cause a hard exit with a human-readable error summary.
 *
 * Phase 3B additions:
 *  - CLICKHOUSE_URL  — optional analytics store for high-volume event replay
 *  - FRAUD_MODEL_URL — ML fraud model endpoint (fails open when unavailable)
 *  - SERVICE_NAME    — used for structured logging correlation
 *  - Cron + batch tuning knobs
 *  - Fraud thresholds configurable via env vars
 *  - Feature flags for graceful rollout
 *
 * @module config
 */

import { z } from 'zod';
import 'dotenv/config';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Schema
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Schema for all trust service environment variables.
 * Defaults are set for local development; production values come from k8s secrets.
 */
const envSchema = z.object({
  // ── Core ──────────────────────────────────────────────
  /** Application environment */
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  /** Human-readable service name used in structured logging and Kafka client IDs */
  SERVICE_NAME: z.string().min(1).default('trust-service'),
  /** HTTP port the Fastify server binds to */
  TRUST_PORT: z.coerce.number().int().positive().default(3009),
  /** Pino log level */
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // ── Data stores ───────────────────────────────────────
  /** PostgreSQL connection string (required) */
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL connection string'),
  /** Redis connection string (required) */
  REDIS_URL: z.string().url('REDIS_URL must be a valid Redis connection string'),
  /** Comma-separated list of Kafka broker addresses (required) */
  KAFKA_BROKERS: z.string().min(1, 'KAFKA_BROKERS must be a comma-separated list'),

  // ── Optional analytics store ──────────────────────────
  /** ClickHouse URL for high-volume event replay (optional) */
  CLICKHOUSE_URL: z.string().url().optional().or(z.literal('')),

  // ── Auth / Security ───────────────────────────────────
  /** JWT signing secret — minimum 32 characters in production */
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  /** Comma-separated CORS allowed origins */
  TRUST_CORS_ORIGIN: z.string().default('http://localhost:3000'),
  /** Shared secret for internal service-to-service calls (X-Internal-Secret header) */
  INTERNAL_SERVICE_SECRET: z.string().min(1).default('dev-internal-secret-change-in-production'),

  // ── Fraud detection ───────────────────────────────────
  /** URL of the ML fraud scoring model endpoint */
  FRAUD_MODEL_URL: z.string().default('http://localhost:3012/predict'),
  /** Hard timeout (ms) for the ML model HTTP call */
  FRAUD_MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),

  // ── Nightly recompute ─────────────────────────────────
  /** Cron expression for nightly trust score recompute (default: 02:00 IST = 20:30 UTC) */
  NIGHTLY_RECOMPUTE_CRON: z.string().default('30 20 * * *'),
  /** Number of users to process per batch in the nightly recompute */
  NIGHTLY_RECOMPUTE_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  /** Delay between batches (ms) to avoid DB spikes */
  NIGHTLY_RECOMPUTE_BATCH_DELAY_MS: z.coerce.number().int().nonnegative().default(500),

  // ── DB connection pool ────────────────────────────────
  /** Maximum number of connections in the pg Pool */
  DB_POOL_MAX: z.coerce.number().int().positive().default(20),
  /** Idle timeout for pool connections (seconds) */
  DB_POOL_IDLE_TIMEOUT: z.coerce.number().int().positive().default(20),
  /** Connection timeout for new pool connections (seconds) */
  DB_POOL_CONNECT_TIMEOUT: z.coerce.number().int().positive().default(10),
  /** Statement timeout for pg queries (ms) */
  DB_STATEMENT_TIMEOUT: z.coerce.number().int().positive().default(30000),

  // ── Redis cache ───────────────────────────────────────
  /** TTL for cached trust scores (seconds) */
  TRUST_SCORE_CACHE_TTL_SECS: z.coerce.number().int().positive().default(300),
  /** TTL for consumer idempotency keys (seconds) */
  IDEMPOTENCY_KEY_TTL_SECS: z.coerce.number().int().positive().default(86400),
  /** TTL for leaderboard sorted sets (seconds) */
  LEADERBOARD_CACHE_TTL_SECS: z.coerce.number().int().positive().default(3600),

  // ── Rate limiting ─────────────────────────────────────
  /** Maximum requests per window for rate limiting */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  /** Rate limit time window (e.g. '1 minute') */
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),

  // ── Fraud thresholds (0-100) ──────────────────────────
  /** Fraud score below this → allow */
  FRAUD_THRESHOLD_ALLOW: z.coerce.number().int().nonnegative().default(20),
  /** Fraud score below this (but >= allow) → allow_with_monitoring */
  FRAUD_THRESHOLD_MONITOR: z.coerce.number().int().nonnegative().default(50),
  /** Fraud score below this (but >= monitor) → require_selfie */
  FRAUD_THRESHOLD_SELFIE: z.coerce.number().int().nonnegative().default(75),
  /** Number of fraud flags within FRAUD_FLAG_WINDOW_DAYS to trigger auto-suspension */
  FRAUD_AUTO_SUSPEND_FLAG_COUNT: z.coerce.number().int().positive().default(3),
  /** Rolling window (days) for counting fraud flags toward auto-suspension */
  FRAUD_FLAG_WINDOW_DAYS: z.coerce.number().int().positive().default(7),

  // ── New user fraud protection ─────────────────────────
  /** Number of initial listings that trigger fraud scoring for new users */
  NEW_USER_LISTING_FRAUD_CHECK_COUNT: z.coerce.number().int().positive().default(3),
  /** Account age (days) threshold below which a user is considered "new" for fraud checks */
  NEW_USER_AGE_DAYS: z.coerce.number().int().positive().default(7),

  // ── Kafka consumer ────────────────────────────────────
  /** Consumer group ID for the trust consumer */
  KAFKA_CONSUMER_GROUP_ID: z.string().default('trust-service-consumer'),
  /** Maximum retries for a failed message before sending to DLQ */
  KAFKA_CONSUMER_MAX_RETRIES: z.coerce.number().int().positive().default(3),

  // ── Feature flags ─────────────────────────────────────
  /** Enable the nightly cron recompute job */
  ENABLE_NIGHTLY_CRON: z.coerce.boolean().default(true),
  /** Enable the Kafka consumer for cross-service events */
  ENABLE_KAFKA_CONSUMER: z.coerce.boolean().default(true),
  /** Enable ClickHouse event sink for analytics */
  ENABLE_CLICKHOUSE_SINK: z.coerce.boolean().default(false),
  /** Enable fraud model calls (disable to use rule-based only) */
  ENABLE_FRAUD_MODEL: z.coerce.boolean().default(true),
});

/** Validated environment configuration type */
export interface EnvConfig {
  NODE_ENV: 'development' | 'staging' | 'production';
  SERVICE_NAME: string;
  TRUST_PORT: number;
  LOG_LEVEL: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  DATABASE_URL: string;
  REDIS_URL: string;
  KAFKA_BROKERS: string;
  CLICKHOUSE_URL?: string;
  JWT_ACCESS_SECRET: string;
  TRUST_CORS_ORIGIN: string;
  INTERNAL_SERVICE_SECRET: string;
  FRAUD_MODEL_URL: string;
  FRAUD_MODEL_TIMEOUT_MS: number;
  NIGHTLY_RECOMPUTE_CRON: string;
  NIGHTLY_RECOMPUTE_BATCH_SIZE: number;
  NIGHTLY_RECOMPUTE_BATCH_DELAY_MS: number;
  DB_POOL_MAX: number;
  DB_POOL_IDLE_TIMEOUT: number;
  DB_POOL_CONNECT_TIMEOUT: number;
  DB_STATEMENT_TIMEOUT: number;
  TRUST_SCORE_CACHE_TTL_SECS: number;
  IDEMPOTENCY_KEY_TTL_SECS: number;
  LEADERBOARD_CACHE_TTL_SECS: number;
  RATE_LIMIT_MAX: number;
  RATE_LIMIT_WINDOW: string;
  FRAUD_THRESHOLD_ALLOW: number;
  FRAUD_THRESHOLD_MONITOR: number;
  FRAUD_THRESHOLD_SELFIE: number;
  FRAUD_AUTO_SUSPEND_FLAG_COUNT: number;
  FRAUD_FLAG_WINDOW_DAYS: number;
  NEW_USER_LISTING_FRAUD_CHECK_COUNT: number;
  NEW_USER_AGE_DAYS: number;
  KAFKA_CONSUMER_GROUP_ID: string;
  KAFKA_CONSUMER_MAX_RETRIES: number;
  ENABLE_NIGHTLY_CRON: boolean;
  ENABLE_KAFKA_CONSUMER: boolean;
  ENABLE_CLICKHOUSE_SINK: boolean;
  ENABLE_FRAUD_MODEL: boolean;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helper Accessors
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Parses KAFKA_BROKERS from a comma-separated string into an array.
 * Filters empty entries from trailing commas or whitespace.
 *
 * @param cfg - Validated environment config
 * @returns Array of broker addresses (e.g. ['localhost:9092'])
 */
export function getKafkaBrokers(cfg: EnvConfig): string[] {
  return cfg.KAFKA_BROKERS.split(',').map((b) => b.trim()).filter(Boolean);
}

/**
 * Returns CORS origins as an array.
 *
 * @param cfg - Validated environment config
 * @returns Array of allowed origin strings
 */
export function getCorsOrigins(cfg: EnvConfig): string[] {
  return cfg.TRUST_CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
}

/**
 * Returns the fraud action thresholds from configuration.
 * Used by FraudService to map numeric scores to FraudAction enums.
 *
 * @param cfg - Validated environment config
 * @returns Object with allow, monitor, selfie thresholds
 */
export function getFraudThresholds(cfg: EnvConfig): {
  allow: number;
  monitor: number;
  selfie: number;
} {
  return {
    allow: cfg.FRAUD_THRESHOLD_ALLOW,
    monitor: cfg.FRAUD_THRESHOLD_MONITOR,
    selfie: cfg.FRAUD_THRESHOLD_SELFIE,
  };
}

/**
 * Returns pg Pool configuration derived from environment variables.
 *
 * @param cfg - Validated environment config
 * @returns Configuration object for the pg Pool constructor
 */
export function getPgPoolConfig(cfg: EnvConfig): {
  connectionString: string;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  statement_timeout: number;
} {
  return {
    connectionString: cfg.DATABASE_URL,
    max: cfg.DB_POOL_MAX,
    idleTimeoutMillis: cfg.DB_POOL_IDLE_TIMEOUT * 1000,
    connectionTimeoutMillis: cfg.DB_POOL_CONNECT_TIMEOUT * 1000,
    statement_timeout: cfg.DB_STATEMENT_TIMEOUT,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Boot-time Validation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Loads and validates environment configuration.
 * Exits the process with a formatted error message on validation failure.
 * This runs synchronously at module load time to fail fast.
 *
 * @returns Frozen, validated environment configuration
 */
function loadConfig(): EnvConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  ✗ ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    console.error(`\n╔══════════════════════════════════════════════╗`);
    console.error(`║  TRUST SERVICE — CONFIGURATION ERROR         ║`);
    console.error(`╚══════════════════════════════════════════════╝\n`);
    console.error(`Missing or invalid environment variables:\n${formatted}\n`);
    process.exit(1);
  }

  const configData = result.data as EnvConfig;

  // Cross-field validation: thresholds must be ordered
  if (configData.FRAUD_THRESHOLD_ALLOW >= configData.FRAUD_THRESHOLD_MONITOR) {
    console.error('FRAUD_THRESHOLD_ALLOW must be less than FRAUD_THRESHOLD_MONITOR');
    process.exit(1);
  }
  if (configData.FRAUD_THRESHOLD_MONITOR >= configData.FRAUD_THRESHOLD_SELFIE) {
    console.error('FRAUD_THRESHOLD_MONITOR must be less than FRAUD_THRESHOLD_SELFIE');
    process.exit(1);
  }

  return Object.freeze(configData);
}

/** Validated, frozen environment configuration singleton. */
export const config = loadConfig();
