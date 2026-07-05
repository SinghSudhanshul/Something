/**
 * NEXUS Feast Service — Type Extensions
 */

import type { drizzle } from 'drizzle-orm/postgres-js';
import type { Redis } from 'ioredis';
import type { Producer } from 'kafkajs';

declare module 'fastify' {
  interface FastifyInstance {
    db: ReturnType<typeof drizzle>;
    redis: Redis;
    redisPub: Redis;
    redisSub: Redis;
    kafka: { producer: Producer };
  }
}
