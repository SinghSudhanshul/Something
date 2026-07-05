import { RequestUser } from '@nexus/utils';

declare module 'fastify' {
  interface FastifyInstance {
    db: import('drizzle-orm/postgres-js').PostgresJsDatabase<Record<string, unknown>>;
    redis: import('ioredis').Redis;
    kafka: import('kafkajs').Producer;
  }

  interface FastifyRequest {
    user?: RequestUser;
  }
}
