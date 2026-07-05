/**
 * Auth Service — Type Extensions
 *
 * Augments Fastify types with custom decorators (db, redis, kafka, authenticate).
 */

import type { drizzle } from 'drizzle-orm/postgres-js';
import type { Redis } from 'ioredis';
import type { Producer } from 'kafkajs';

declare module 'fastify' {
  interface FastifyInstance {
    db: ReturnType<typeof drizzle>;
    redis: Redis;
    kafka: Producer;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
