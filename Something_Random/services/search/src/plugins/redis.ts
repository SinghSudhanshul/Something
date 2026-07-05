/**
 * NEXUS Search Service — Redis Plugin
 *
 * Registers an ioredis client on the Fastify instance.  The plugin handles:
 *
 * - Exponential-backoff reconnection strategy
 * - Connection event logging (connect, error, reconnecting, close)
 * - Health-check helper for readiness probes
 * - Graceful shutdown (QUIT then disconnect)
 *
 * @module plugins/redis
 */

import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';

import { config } from '../config.js';

/**
 * Fastify plugin that creates and registers an ioredis client.
 *
 * The client is available on every request via `fastify.redis`.
 *
 * @param fastify - Fastify application instance.
 */
async function redisPlugin(fastify: FastifyInstance): Promise<void> {
  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    showFriendlyErrorStack: config.NODE_ENV !== 'production',
    keyPrefix: config.REDIS_KEY_PREFIX,
    retryStrategy(times: number): number | null {
      if (times > config.REDIS_MAX_RETRIES) {
        fastify.log.error(
          { attempts: times },
          'Redis retry limit reached — giving up reconnection',
        );
        return null;
      }
      const delay = Math.min(times * 200, 5_000);
      fastify.log.warn(
        { attempt: times, delayMs: delay },
        'Retrying Redis connection…',
      );
      return delay;
    },
    reconnectOnError(err: Error): boolean | 1 | 2 {
      const targetErrors = ['READONLY', 'ECONNRESET', 'ECONNREFUSED'];
      if (targetErrors.some((e) => err.message.includes(e))) {
        fastify.log.warn(
          { err: err.message },
          'Reconnectable Redis error detected — reconnecting',
        );
        return true;
      }
      return false;
    },
    lazyConnect: true,
  });

  /* Connection event listeners ─────────────────────────────────────────── */
  redis.on('connect', () => {
    fastify.log.info('Redis connection established');
  });

  redis.on('ready', () => {
    fastify.log.info('Redis is ready to accept commands');
  });

  redis.on('error', (err: Error) => {
    fastify.log.error({ err: err.message }, 'Redis connection error');
  });

  redis.on('reconnecting', (delayMs: number) => {
    fastify.log.warn({ delayMs }, 'Redis is reconnecting…');
  });

  redis.on('close', () => {
    fastify.log.info('Redis connection closed');
  });

  redis.on('end', () => {
    fastify.log.info('Redis connection ended — no more reconnections');
  });

  /* Connect ────────────────────────────────────────────────────────────── */
  try {
    await redis.connect();
    const info = await redis.info('server');
    const versionMatch = info.match(/redis_version:(\S+)/);
    fastify.log.info(
      { redisVersion: versionMatch?.[1] ?? 'unknown' },
      'Connected to Redis',
    );
  } catch (err: unknown) {
    fastify.log.error({ err }, 'Failed to connect to Redis at startup');
    throw err;
  }

  /* Register on Fastify ────────────────────────────────────────────────── */
  fastify.decorate('redis', redis);

  /**
   * Health-check helper — issues a PING and measures round-trip latency.
   *
   * @returns Object with `ok` flag and `latencyMs`.
   */
  fastify.decorate('redisHealthCheck', async (): Promise<{
    ok: boolean;
    latencyMs: number;
  }> => {
    const start = Date.now();
    try {
      const pong = await redis.ping();
      return { ok: pong === 'PONG', latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  });

  /* Graceful shutdown ──────────────────────────────────────────────────── */
  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing Redis connection…');
    try {
      await redis.quit();
    } catch {
      fastify.log.warn('Redis QUIT failed, forcing disconnect');
      redis.disconnect();
    }
    fastify.log.info('Redis connection closed');
  });

  fastify.log.info(
    { keyPrefix: config.REDIS_KEY_PREFIX, maxRetries: config.REDIS_MAX_RETRIES },
    'Redis plugin registered',
  );
}

export default fp(redisPlugin, {
  name: 'redis',
  fastify: '4.x',
});
