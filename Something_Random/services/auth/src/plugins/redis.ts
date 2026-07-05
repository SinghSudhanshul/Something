/**
 * Auth Service — Redis Plugin
 *
 * Registers ioredis client as a Fastify plugin.
 * Exposes `fastify.redis` for caching, sessions, and rate limiting.
 */

import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';

import { config } from '../config.js';

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times: number): number | null {
    if (times > 10) {
      return null;
    }
    return Math.min(times * 200, 5000);
  },
  lazyConnect: true,
});

async function redisPlugin(fastify: FastifyInstance): Promise<void> {
  await redis.connect();

  fastify.decorate('redis', redis);

  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing Redis connection...');
    await redis.quit();
  });

  fastify.log.info('Redis plugin registered');
}

export default fp(redisPlugin, {
  name: 'redis',
  fastify: '4.x',
});
