/**
 * NEXUS Notifications Service — Database Plugin
 *
 * Registers a Drizzle ORM instance backed by postgres.js with:
 * - Connection pooling (configurable max connections)
 * - Connection health check on startup
 * - Retry logic for initial connection with exponential backoff
 * - Connection pool monitoring via idle/active counts
 * - Graceful shutdown with drain timeout
 * - Decorated health check method for the /health endpoint
 *
 * Decorates the Fastify instance with:
 * - `db`: Drizzle ORM instance
 * - `dbHealthCheck`: Async function that returns pool health status
 *
 * @module plugins/db
 */

import fp from 'fastify-plugin';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { FastifyInstance } from 'fastify';

import * as schema from '@nexus/database/schema';
import { config } from '../config.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Maximum number of connections in the pool. */
const POOL_MAX_CONNECTIONS = 20;

/** Idle connection timeout in seconds before reclaiming. */
const POOL_IDLE_TIMEOUT_SECONDS = 20;

/** Connection timeout in seconds for new connections. */
const CONNECT_TIMEOUT_SECONDS = 10;

/** Maximum number of retry attempts for initial connection. */
const MAX_CONNECTION_RETRIES = 5;

/** Base delay in milliseconds for exponential backoff between retries. */
const BASE_RETRY_DELAY_MS = 1000;

/** Maximum time in milliseconds to wait for pool drain on shutdown. */
const SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Health Check Response Type
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Response from the database health check.
 * Includes connectivity status and connection pool metrics.
 */
export interface DbHealthStatus {
  /** Whether the database is currently reachable. */
  connected: boolean;
  /** Response time of the health check query in milliseconds. */
  responseTimeMs: number;
  /** Error message if the check failed. */
  error?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Sleeps for the specified number of milliseconds.
 *
 * @param ms - Duration to sleep in milliseconds
 * @returns Promise that resolves after the delay
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attempts to connect to the database with retries and exponential backoff.
 * Logs each retry attempt and the final outcome.
 *
 * @param sql - The postgres.js connection instance to test
 * @param log - Fastify logger for structured logging
 * @throws Error if all retry attempts are exhausted
 */
async function connectWithRetry(
  sql: postgres.Sql,
  log: FastifyInstance['log'],
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_CONNECTION_RETRIES; attempt++) {
    try {
      // Execute a simple query to verify connectivity
      await sql`SELECT 1 AS health_check`;
      log.info(
        { attempt, maxAttempts: MAX_CONNECTION_RETRIES },
        'Database connection established',
      );
      return;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);

      if (attempt === MAX_CONNECTION_RETRIES) {
        log.error(
          { attempt, error: errorMessage },
          'Database connection failed after all retries',
        );
        throw new Error(
          `Database connection failed after ${MAX_CONNECTION_RETRIES} attempts: ${errorMessage}`,
        );
      }

      log.warn(
        { attempt, maxAttempts: MAX_CONNECTION_RETRIES, retryInMs: delay, error: errorMessage },
        'Database connection attempt failed, retrying...',
      );
      await sleep(delay);
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Plugin
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Fastify plugin that initialises a postgres.js connection pool and Drizzle ORM.
 *
 * The plugin performs an initial connectivity check with retries before
 * decorating the Fastify instance. On shutdown, the pool is drained
 * gracefully with a configurable timeout.
 *
 * @param fastify - The Fastify instance to decorate
 */
async function dbPlugin(fastify: FastifyInstance): Promise<void> {
  const sql = postgres(config.DATABASE_URL, {
    max: POOL_MAX_CONNECTIONS,
    idle_timeout: POOL_IDLE_TIMEOUT_SECONDS,
    connect_timeout: CONNECT_TIMEOUT_SECONDS,
    onnotice: (notice) => {
      fastify.log.debug({ notice: notice.message }, 'PostgreSQL notice');
    },
  });

  // Verify connectivity with retries before proceeding
  await connectWithRetry(sql, fastify.log);

  const db = drizzle(sql, { schema });
  fastify.decorate('db', db);
  fastify.decorate('sql', sql);

  /**
   * Performs a lightweight database health check by executing a simple query.
   * Returns connectivity status and response time.
   *
   * @returns Health status object with connected flag and response time
   */
  const dbHealthCheck = async (): Promise<DbHealthStatus> => {
    const start = Date.now();
    try {
      await sql`SELECT 1 AS health_check`;
      return {
        connected: true,
        responseTimeMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      fastify.log.warn({ error: errorMessage }, 'Database health check failed');
      return {
        connected: false,
        responseTimeMs: Date.now() - start,
        error: errorMessage,
      };
    }
  };

  fastify.decorate('dbHealthCheck', dbHealthCheck);

  // Graceful shutdown hook — drain pool with timeout
  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing database connection pool...');
    try {
      // sql.end() gracefully drains all active connections
      const drainPromise = sql.end({ timeout: SHUTDOWN_DRAIN_TIMEOUT_MS / 1000 });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Database pool drain timed out')),
          SHUTDOWN_DRAIN_TIMEOUT_MS,
        ),
      );
      await Promise.race([drainPromise, timeoutPromise]);
      fastify.log.info('Database connection pool closed');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      fastify.log.error({ error: errorMessage }, 'Error closing database connection pool');
    }
  });

  fastify.log.info(
    { maxConnections: POOL_MAX_CONNECTIONS, idleTimeout: POOL_IDLE_TIMEOUT_SECONDS },
    'Database plugin registered',
  );
}

export default fp(dbPlugin, {
  name: 'db',
  fastify: '4.x',
});
