/**
 * NEXUS Notifications Service — Zod-validated Environment Configuration
 *
 * All environment variables are validated at startup. Invalid or missing
 * required variables cause the process to exit with a human-readable error
 * listing. Optional provider credentials (Expo, MSG91) allow the service to
 * start in development mode without external dependencies.
 *
 * Environment variables:
 * - DATABASE_URL: PostgreSQL connection string (required)
 * - REDIS_URL: Redis connection string for caching/pub-sub (required)
 * - KAFKA_BROKERS: Comma-separated Kafka broker addresses (required)
 * - EXPO_ACCESS_TOKEN: Expo push notification token (nullable — dev logs)
 * - AWS_SES_FROM_EMAIL: Sender email for AWS SES (default: noreply@nexus-app.com)
 * - MSG91_AUTH_KEY: MSG91 API key for SMS (nullable — dev logs)
 * - PORT: HTTP server port (default: 3010)
 *
 * @module config
 */

import { z } from 'zod';
import 'dotenv/config';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Default port for the Notifications Service. */
const DEFAULT_PORT = 3010;

/** Default quiet hours (IST 23:00 – 07:00). */
const DEFAULT_QUIET_HOURS_START = '23:00';
const DEFAULT_QUIET_HOURS_END = '07:00';

/** Default concurrency settings for BullMQ workers. */
const DEFAULT_PUSH_CONCURRENCY = 10;
const DEFAULT_EMAIL_CONCURRENCY = 5;
const DEFAULT_SMS_CONCURRENCY = 3;
const DEFAULT_INAPP_CONCURRENCY = 20;

/** Default batch size for Expo push notifications. */
const DEFAULT_PUSH_BATCH_SIZE = 100;

/** Default idempotency key TTL in seconds (24 hours). */
const DEFAULT_IDEMPOTENCY_TTL_SECONDS = 86400;

/** Default notification log retention in seconds (completed jobs: 24h, failed: 7d). */
const COMPLETED_JOB_RETENTION_SECONDS = 86400;
const FAILED_JOB_RETENTION_SECONDS = 604800;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Nullable string helper
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * A Zod schema that coerces empty strings to null, making it safe
 * to use with optional external provider tokens.
 */
const nullableString = z
  .string()
  .nullable()
  .default(null)
  .transform((v) => (v === '' ? null : v));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Zod Schema
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Zod schema for strict environment validation.
 *
 * Required variables will fail fast at boot if absent.
 * Optional provider credentials are nullable — workers fall back to
 * dev-mode logging when they are not configured.
 */
const envSchema = z.object({
  // ── Runtime ────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(DEFAULT_PORT),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // ── Infrastructure ────────────────────────────────────
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL connection string'),
  REDIS_URL: z.string().url('REDIS_URL must be a valid Redis connection string'),
  KAFKA_BROKERS: z.string().min(1, 'KAFKA_BROKERS must contain at least one broker address'),

  // ── Auth / Security ───────────────────────────────────
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  NOTIFICATIONS_CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // ── BullMQ ────────────────────────────────────────────
  BULLMQ_REDIS_URL: z.string().default('redis://localhost:6379'),

  // ── Expo Push Notifications (nullable in dev) ─────────
  EXPO_ACCESS_TOKEN: nullableString,

  // ── AWS SES Email ─────────────────────────────────────
  AWS_SES_REGION: z.string().default('ap-south-1'),
  AWS_SES_FROM_EMAIL: z.string().email().default('noreply@nexus-app.com'),
  AWS_SES_ACCESS_KEY_ID: nullableString,
  AWS_SES_SECRET_ACCESS_KEY: nullableString,

  // ── MSG91 SMS (nullable in dev — DLT-compliant) ───────
  MSG91_AUTH_KEY: nullableString,
  MSG91_SENDER_ID: nullableString,
  MSG91_DLT_TE_ID: nullableString,
  MSG91_ROUTE: z.coerce.number().int().default(4), // Transactional route

  // ── Service Tuning ────────────────────────────────────
  PUSH_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(DEFAULT_PUSH_CONCURRENCY),
  EMAIL_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(DEFAULT_EMAIL_CONCURRENCY),
  SMS_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(DEFAULT_SMS_CONCURRENCY),
  INAPP_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(DEFAULT_INAPP_CONCURRENCY),
  PUSH_BATCH_SIZE: z.coerce.number().int().positive().default(DEFAULT_PUSH_BATCH_SIZE),

  // ── Idempotency ───────────────────────────────────────
  IDEMPOTENCY_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_IDEMPOTENCY_TTL_SECONDS),

  // ── Quiet Hours Defaults ──────────────────────────────
  DEFAULT_QUIET_HOURS_START: z.string().default(DEFAULT_QUIET_HOURS_START),
  DEFAULT_QUIET_HOURS_END: z.string().default(DEFAULT_QUIET_HOURS_END),

  // ── WebSocket / Real-time ─────────────────────────────
  WS_REDIS_CHANNEL_PREFIX: z.string().default('nexus:notifications:realtime:'),

  // ── Deprecated (kept for backwards-compat, mapped) ────
  NOTIFICATIONS_PORT: z.coerce.number().int().positive().optional(),
});

/** Strongly-typed configuration object derived from the Zod schema. */
export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Derived constants exposed alongside the env config for convenience.
 * These are computed from the validated config and frozen.
 */
export interface DerivedConfig {
  /** Whether the service is running in production mode. */
  readonly isProduction: boolean;
  /** Whether the service is running in development mode. */
  readonly isDevelopment: boolean;
  /** Whether Expo push is available (access token configured). */
  readonly isExpoPushAvailable: boolean;
  /** Whether AWS SES is available (access keys configured). */
  readonly isSesAvailable: boolean;
  /** Whether MSG91 SMS is available (auth key configured). */
  readonly isMsg91Available: boolean;
  /** Parsed Kafka broker list. */
  readonly kafkaBrokers: readonly string[];
  /** Parsed CORS origins. */
  readonly corsOrigins: readonly string[];
  /** BullMQ completed job retention in seconds. */
  readonly completedJobRetentionSeconds: number;
  /** BullMQ failed job retention in seconds. */
  readonly failedJobRetentionSeconds: number;
}

/**
 * Loads, validates, and freezes the environment configuration.
 *
 * Exits the process with code 1 on validation failure, printing each
 * individual issue to stderr so operators can fix all problems in one pass.
 *
 * @returns Frozen, validated configuration object
 */
function loadConfig(): EnvConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  ✗ ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    console.error(`\n╔══════════════════════════════════════════════╗`);
    console.error(`║  NOTIFICATIONS SERVICE — CONFIG ERROR        ║`);
    console.error(`╚══════════════════════════════════════════════╝\n`);
    console.error(`Missing or invalid environment variables:\n${formatted}\n`);
    process.exit(1);
  }

  const data = result.data;

  // If legacy NOTIFICATIONS_PORT was provided but PORT was not explicitly set,
  // use the legacy value for backwards compatibility.
  if (data.NOTIFICATIONS_PORT !== undefined && data.PORT === DEFAULT_PORT) {
    (data as { PORT: number }).PORT = data.NOTIFICATIONS_PORT;
  }

  return Object.freeze(data);
}

/** Frozen, validated configuration singleton. */
export const config = loadConfig();

/**
 * Builds derived configuration from the validated environment config.
 *
 * @returns Frozen derived config object
 */
function buildDerivedConfig(): DerivedConfig {
  return Object.freeze({
    isProduction: config.NODE_ENV === 'production',
    isDevelopment: config.NODE_ENV === 'development',
    isExpoPushAvailable: config.EXPO_ACCESS_TOKEN !== null,
    isSesAvailable:
      config.AWS_SES_ACCESS_KEY_ID !== null && config.AWS_SES_SECRET_ACCESS_KEY !== null,
    isMsg91Available: config.MSG91_AUTH_KEY !== null,
    kafkaBrokers: Object.freeze(config.KAFKA_BROKERS.split(',').map((b) => b.trim())),
    corsOrigins: Object.freeze(
      config.NOTIFICATIONS_CORS_ORIGIN.split(',').map((o) => o.trim()),
    ),
    completedJobRetentionSeconds: COMPLETED_JOB_RETENTION_SECONDS,
    failedJobRetentionSeconds: FAILED_JOB_RETENTION_SECONDS,
  });
}

/** Frozen derived configuration singleton. */
export const derived = buildDerivedConfig();
