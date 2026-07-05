/**
 * NEXUS Bazaar Service — Type Extensions
 */

import type { drizzle } from 'drizzle-orm/postgres-js';
import type { Redis } from 'ioredis';
import type { Producer, Consumer } from 'kafkajs';

declare module 'fastify' {
  interface FastifyInstance {
    db: ReturnType<typeof drizzle>;
    redis: Redis;
    kafka: { producer: Producer; consumer?: Consumer };
  }
}
