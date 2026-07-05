/**
 * NEXUS Notifications Service — Redis Plugin
 *
 * Registers an ioredis client with:
 * - Lazy connection with explicit connect call
 * - Exponential backoff retry strategy (max 10 retries)
 * - Event listeners for error, reconnecting, and ready states
 * - Dedicated subscriber connection for Redis Pub/Sub
 * - Health check method for service monitoring
 * - Graceful shutdown with ordered disconnection
 *
 * Decorates the Fastify instance with:
 * - `redis`: Primary ioredis client for commands and BullMQ
 * - `redisSub`: Dedicated subscriber client for Pub/Sub channels
 * - `redisHealthCheck`: Async function returning Redis health status
 *
 * @module plugins/redis
 */

import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';

import { config } from '../config.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Maximum retry attempts before giving up on Redis connection. */
const MAX_RETRIES = 10;

/** Maximum delay in milliseconds between retry attempts. */
const MAX_RETRY_DELAY_MS = 5000;

/** Base multiplier for exponential backoff (ms per retry count). */
const RETRY_DELAY_MULTIPLIER_MS = 200;

/** Timeout in milliseconds for the Redis PING health check. */
const HEALTH_CHECK_TIMEOUT_MS = 3000;

/** Timeout in milliseconds for graceful disconnect. */
const DISCONNECT_TIMEOUT_MS = 5000;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Health Check Response Type
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Response from the Redis health check.
 * Includes connectivity, latency, and memory usage info.
 */
export interface RedisHealthStatus {
  /** Whether Redis responded to PING. */
  connected: boolean;
  /** PING response time in milliseconds. */
  responseTimeMs: number;
  /** Redis server INFO memory summary (if available). */
  usedMemory?: string;
  /** Number of connected clients reported by server. */
  connectedClients?: number;
  /** Error message if health check failed. */
  error?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Creates an ioredis client with the shared retry strategy and configuration.
 *
 * @param name - Human-readable name for logging purposes
 * @param log - Fastify logger instance
 * @returns Configured ioredis client (not yet connected)
 */
function createRedisClient(name: string, log: FastifyInstance['log']): Redis {
  const client = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy(times: number): number | null {
      if (times > MAX_RETRIES) {
        log.error(
          { client: name, retryCount: times },
          'Redis max retries exceeded, giving up',
        );
        return null; // Stop retrying
      }
      const delay = Math.min(times * RETRY_DELAY_MULTIPLIER_MS, MAX_RETRY_DELAY_MS);
      log.warn(
        { client: name, retryCount: times, retryDelayMs: delay },
        'Redis connection retry scheduled',
      );
      return delay;
    },
    lazyConnect: true,
  });

  // Attach event listeners for observability
  client.on('connect', () => {
    log.info({ client: name }, 'Redis client connected');
  });

  client.on('ready', () => {
    log.info({ client: name }, 'Redis client ready');
  });

  client.on('error', (err: Error) => {
    log.error({ client: name, error: err.message }, 'Redis client error');
  });

  client.on('reconnecting', (delayMs: number) => {
    log.warn({ client: name, delayMs }, 'Redis client reconnecting');
  });

  client.on('close', () => {
    log.info({ client: name }, 'Redis client connection closed');
  });

  client.on('end', () => {
    log.info({ client: name }, 'Redis client connection ended');
  });

  return client;
}

/**
 * Gracefully disconnects a Redis client with a timeout.
 * Falls back to forced disconnect if quit doesn't complete in time.
 *
 * @param client - The ioredis client to disconnect
 * @param name - Human-readable name for logging
 * @param log - Fastify logger instance
 */
async function disconnectClient(
  client: Redis,
  name: string,
  log: FastifyInstance['log'],
): Promise<void> {
  try {
    const quitPromise = client.quit();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Redis ${name} quit timed out`)),
        DISCONNECT_TIMEOUT_MS,
      ),
    );
    await Promise.race([quitPromise, timeoutPromise]);
    log.info({ client: name }, 'Redis client disconnected gracefully');
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.warn({ client: name, error: errorMessage }, 'Redis graceful quit failed, forcing disconnect');
    client.disconnect();
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Plugin
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Fastify plugin that initialises primary and subscriber Redis connections.
 *
 * The primary client is used for general commands, caching, and as the
 * BullMQ connection. The subscriber client is a dedicated connection for
 * Redis Pub/Sub (required because a subscribed client cannot issue other commands).
 *
 * @param fastify - The Fastify instance to decorate
 */
async function redisPlugin(fastify: FastifyInstance): Promise<void> {
  // Create primary client
  const redis = createRedisClient('primary', fastify.log);
  await redis.connect();

  // Create dedicated subscriber client for Pub/Sub
  const redisSub = createRedisClient('subscriber', fastify.log);
  await redisSub.connect();

  // Decorate Fastify instance
  fastify.decorate('redis', redis);
  fastify.decorate('redisSub', redisSub);

  /**
   * Performs a Redis health check by sending a PING command with a timeout.
   * Optionally parses basic server info for memory and client metrics.
   *
   * @returns Health status object
   */
  const redisHealthCheck = async (): Promise<RedisHealthStatus> => {
    const start = Date.now();
    try {
      const pingPromise = redis.ping();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Redis health check timed out')),
          HEALTH_CHECK_TIMEOUT_MS,
        ),
      );
      await Promise.race([pingPromise, timeoutPromise]);

      const responseTimeMs = Date.now() - start;

      // Fetch basic server info for metrics
      let usedMemory: string | undefined;
      let connectedClients: number | undefined;
      try {
        const info = await redis.info('memory');
        const memMatch = info.match(/used_memory_human:(.+)/);
        if (memMatch?.[1]) usedMemory = memMatch[1].trim();

        const clientInfo = await redis.info('clients');
        const clientMatch = clientInfo.match(/connected_clients:(\d+)/);
        if (clientMatch?.[1]) connectedClients = parseInt(clientMatch[1], 10);
      } catch {
        // Non-critical — metrics are best-effort
      }

      return { 
        connected: true, 
        responseTimeMs, 
        ...(usedMemory !== undefined && { usedMemory }), 
        ...(connectedClients !== undefined && { connectedClients }) 
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        connected: false,
        responseTimeMs: Date.now() - start,
        error: errorMessage,
      };
    }
  };

  fastify.decorate('redisHealthCheck', redisHealthCheck);

  // Graceful shutdown — disconnect subscriber first, then primary
  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing Redis connections...');
    await disconnectClient(redisSub, 'subscriber', fastify.log);
    await disconnectClient(redis, 'primary', fastify.log);
    fastify.log.info('All Redis connections closed');
  });

  fastify.log.info('Redis plugin registered (primary + subscriber)');
}

export default fp(redisPlugin, {
  name: 'redis',
  fastify: '4.x',
});
