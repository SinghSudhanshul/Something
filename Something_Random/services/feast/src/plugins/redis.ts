/**
 * NEXUS Feast Service — Redis Plugin
 * 3-client model for normal commands, pub, and sub.
 */

import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';

import { config } from '../config.js';

async function redisPlugin(fastify: FastifyInstance): Promise<void> {
  const options = {
    maxRetriesPerRequest: 3,
    retryStrategy(times: number): number | null {
      if (times > 10) return null;
      return Math.min(times * 200, 5000);
    },
    lazyConnect: true,
  };

  const redis = new Redis(config.REDIS_URL, options);
  const redisPub = new Redis(config.REDIS_URL, options);
  const redisSub = new Redis(config.REDIS_URL, options);

  await Promise.all([
    redis.connect(),
    redisPub.connect(),
    redisSub.connect()
  ]);

  fastify.decorate('redis', redis);
  fastify.decorate('redisPub', redisPub);
  fastify.decorate('redisSub', redisSub);

  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing Redis connections...');
    await Promise.all([
      redis.quit(),
      redisPub.quit(),
      redisSub.quit()
    ]);
  });

  fastify.log.info('Redis plugin registered (3-client model)');
}

export default fp(redisPlugin, { name: 'redis', fastify: '4.x' });
