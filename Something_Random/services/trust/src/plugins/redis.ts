/**
 * Redis Plugin for Fastify
 *
 * Registers an ioredis client on the Fastify instance as `app.redis`.
 * Supports connection retry, health checks, and graceful shutdown.
 *
 * @module plugins/redis
 */

import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { createLogger } from '@nexus/utils';
import { config } from '../config.js';

const logger = createLogger('trust-redis-plugin');

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

async function redisPlugin(app: FastifyInstance): Promise<void> {
  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => {
      if (times > 10) {
        logger.error({ retries: times }, 'Redis max retries exceeded');
        return null; // Stop retrying
      }
      const delay = Math.min(times * 200, 5000);
      logger.warn({ retries: times, delayMs: delay }, 'Redis reconnecting');
      return delay;
    },
    lazyConnect: false,
    enableReadyCheck: true,
    connectTimeout: 10_000,
    commandTimeout: 5_000,
    keepAlive: 30_000,
    db: 0,
  });

  redis.on('connect', () => {
    logger.info('Redis client connected');
  });

  redis.on('ready', () => {
    logger.info('Redis client ready');
  });

  redis.on('error', (err: Error) => {
    logger.error({ err }, 'Redis connection error');
  });

  redis.on('close', () => {
    logger.warn('Redis connection closed');
  });

  redis.on('reconnecting', (delayMs: number) => {
    logger.warn({ delayMs }, 'Redis reconnecting');
  });

  // Verify connection
  try {
    const pong = await redis.ping();
    if (pong !== 'PONG') {
      throw new Error(`Unexpected PING response: ${pong}`);
    }

    const info = await redis.info('memory');
    const usedMemory = info.match(/used_memory_human:(.+)/)?.[1]?.trim() ?? 'unknown';

    logger.info(
      { pong, usedMemory },
      'Redis connection verified',
    );
  } catch (err) {
    logger.warn({ err }, 'Redis connection verification failed — some features may be degraded');
  }

  app.decorate('redis', redis);

  app.addHook('onClose', async () => {
    logger.info('Closing Redis connection');
    redis.disconnect();
    logger.info('Redis connection closed');
  });
}

export default fp(redisPlugin, {
  name: 'redis',
  fastify: '4.x',
});
