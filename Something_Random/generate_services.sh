#!/bin/bash
# Generate all remaining Node.js services with Fastify structure
# Services: bazaar(3002), feast(3004), swift(3006), skills(3007), pulse(3008), trust(3009), notifications(3010), search(3011)

SERVICES=(
  "bazaar:3002:NEXUS Bazaar Service:Campus marketplace for buying and selling goods between students"
  "feast:3004:NEXUS Feast Service:Campus food ordering and delivery service"
  "swift:3006:NEXUS Swift Service:Errand and task completion service for campus needs"
  "skills:3007:NEXUS Skills Service:Skill sharing and tutoring marketplace"
  "pulse:3008:NEXUS Pulse Service:Campus events discovery and management"
  "trust:3009:NEXUS Trust Service:User trust scoring, moderation, and dispute resolution"
  "notifications:3010:NEXUS Notifications Service:Multi-channel notification delivery via push, SMS, email"
  "search:3011:NEXUS Search Service:Unified search across all NEXUS modules powered by Elasticsearch"
)

BASE="/Users/techguy/Desktop/Something_Random/services"

for SERVICE_DEF in "${SERVICES[@]}"; do
  IFS=':' read -r NAME PORT TITLE DESC <<< "$SERVICE_DEF"
  DIR="$BASE/$NAME"
  UPPER_NAME=$(echo "$NAME" | tr '[:lower:]' '[:upper:]')
  
  # Create directories
  mkdir -p "$DIR/src/plugins" "$DIR/src/routes" "$DIR/src/types"
  
  # package.json
  cat > "$DIR/package.json" << EOF
{
  "name": "@nexus/${NAME}-service",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src --ext .ts",
    "type-check": "tsc --noEmit",
    "clean": "rm -rf dist coverage"
  },
  "dependencies": {
    "@nexus/types": "workspace:*",
    "@nexus/utils": "workspace:*",
    "@nexus/database": "workspace:*",
    "@nexus/kafka": "workspace:*",
    "fastify": "^4.26.0",
    "@fastify/cors": "^9.0.1",
    "@fastify/helmet": "^11.1.1",
    "@fastify/jwt": "^8.0.1",
    "@fastify/rate-limit": "^9.1.0",
    "@fastify/swagger": "^8.14.0",
    "@fastify/swagger-ui": "^4.0.0",
    "drizzle-orm": "^0.30.10",
    "postgres": "^3.4.3",
    "ioredis": "^5.3.2",
    "kafkajs": "^2.2.4",
    "zod": "^3.22.4",
    "pino": "^8.19.0",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "typescript": "^5.4.5",
    "@types/node": "^20.12.12",
    "tsx": "^4.11.0",
    "vitest": "^1.6.0",
    "@vitest/coverage-v8": "^1.6.0",
    "supertest": "^7.0.0",
    "pino-pretty": "^11.0.0"
  }
}
EOF

  # tsconfig.json
  cat > "$DIR/tsconfig.json" << 'EOF'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.spec.ts"]
}
EOF

  # config.ts
  cat > "$DIR/src/config.ts" << EOF
/**
 * ${TITLE} — Zod-validated Environment Configuration
 */

import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  ${UPPER_NAME}_PORT: z.coerce.number().int().positive().default(${PORT}),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL connection string'),
  REDIS_URL: z.string().url('REDIS_URL must be a valid Redis connection string'),
  KAFKA_BROKERS: z.string().min(1, 'KAFKA_BROKERS must be a comma-separated list of broker addresses'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ${UPPER_NAME}_CORS_ORIGIN: z.string().default('http://localhost:3000'),
});

export type EnvConfig = z.infer<typeof envSchema>;

function loadConfig(): EnvConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => \`  ✗ \${issue.path.join('.')}: \${issue.message}\`)
      .join('\\n');

    console.error(\`\\n╔══════════════════════════════════════════════╗\`);
    console.error(\`║  ${UPPER_NAME} SERVICE — CONFIGURATION ERROR     ║\`);
    console.error(\`╚══════════════════════════════════════════════╝\\n\`);
    console.error(\`Missing or invalid environment variables:\\n\${formatted}\\n\`);
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();
EOF

  # plugins/db.ts
  cat > "$DIR/src/plugins/db.ts" << EOF
/**
 * ${TITLE} — Database Plugin
 */

import fp from 'fastify-plugin';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { FastifyInstance } from 'fastify';

import * as schema from '@nexus/database/schema';
import { config } from '../config.js';

async function dbPlugin(fastify: FastifyInstance): Promise<void> {
  const sql = postgres(config.DATABASE_URL, {
    max: 20,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  const db = drizzle(sql, { schema });
  fastify.decorate('db', db);

  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing database connection...');
    await sql.end();
  });

  fastify.log.info('Database plugin registered');
}

export default fp(dbPlugin, { name: 'db', fastify: '4.x' });
EOF

  # plugins/redis.ts
  cat > "$DIR/src/plugins/redis.ts" << EOF
/**
 * ${TITLE} — Redis Plugin
 */

import fp from 'fastify-plugin';
import Redis from 'ioredis';
import type { FastifyInstance } from 'fastify';

import { config } from '../config.js';

async function redisPlugin(fastify: FastifyInstance): Promise<void> {
  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times: number): number | null {
      if (times > 10) return null;
      return Math.min(times * 200, 5000);
    },
    lazyConnect: true,
  });

  await redis.connect();
  fastify.decorate('redis', redis);

  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing Redis connection...');
    await redis.quit();
  });

  fastify.log.info('Redis plugin registered');
}

export default fp(redisPlugin, { name: 'redis', fastify: '4.x' });
EOF

  # plugins/kafka.ts
  cat > "$DIR/src/plugins/kafka.ts" << EOF
/**
 * ${TITLE} — Kafka Plugin
 */

import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Producer } from 'kafkajs';

import { createKafkaProducer, disconnectProducer } from '@nexus/kafka';
import { config } from '../config.js';

async function kafkaPlugin(fastify: FastifyInstance): Promise<void> {
  const brokers = config.KAFKA_BROKERS.split(',').map((b) => b.trim());
  let producer: Producer;

  try {
    producer = await createKafkaProducer('${NAME}-service', brokers);
  } catch (error: unknown) {
    fastify.log.warn({ err: error }, 'Kafka producer connection failed — running without Kafka');
    return;
  }

  fastify.decorate('kafka', producer);

  fastify.addHook('onClose', async () => {
    fastify.log.info('Disconnecting Kafka producer...');
    await disconnectProducer(producer);
  });

  fastify.log.info('Kafka plugin registered');
}

export default fp(kafkaPlugin, { name: 'kafka', fastify: '4.x' });
EOF

  # routes/health.ts
  cat > "$DIR/src/routes/health.ts" << EOF
/**
 * ${TITLE} — Health Route
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { HealthResponse } from '@nexus/types';

const startTime = Date.now();

async function healthRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/health',
    {
      schema: {
        tags: ['Health'],
        summary: 'Service health check',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok', 'degraded'] },
              service: { type: 'string' },
              version: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
              uptime: { type: 'number' },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply): Promise<HealthResponse> => {
      return {
        status: 'ok',
        service: '${NAME}',
        version: '0.1.0',
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - startTime) / 1000),
      };
    },
  );
}

export default healthRoute;
EOF

  # types/index.ts
  cat > "$DIR/src/types/index.ts" << EOF
/**
 * ${TITLE} — Type Extensions
 */

import type { drizzle } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import type { Producer } from 'kafkajs';

declare module 'fastify' {
  interface FastifyInstance {
    db: ReturnType<typeof drizzle>;
    redis: Redis;
    kafka: Producer;
  }
}
EOF

  # index.ts (entry point)
  cat > "$DIR/src/index.ts" << EOF
/**
 * ${TITLE} — Fastify Application Entry Point
 *
 * ${DESC}
 */

import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';

import { createLogger } from '@nexus/utils';
import { config } from './config.js';
import dbPlugin from './plugins/db.js';
import redisPlugin from './plugins/redis.js';
import kafkaPlugin from './plugins/kafka.js';
import healthRoute from './routes/health.js';

import './types/index.js';

const logger = createLogger('${NAME}-service', config.LOG_LEVEL);

async function buildApp(): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      timestamp: () => \`,"time":"\${new Date().toISOString()}"\`,
    },
    trustProxy: true,
    requestTimeout: 30000,
  });

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: config.NODE_ENV === 'production',
  });

  await app.register(fastifyCors, {
    origin: config.${UPPER_NAME}_CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(fastifyJwt, {
    secret: config.JWT_ACCESS_SECRET,
    sign: { expiresIn: '15m' },
  });

  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
  });

  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: '${TITLE}',
        description: '${DESC}',
        version: '0.1.0',
      },
      servers: [
        {
          url: \`http://localhost:\${String(config.${UPPER_NAME}_PORT)}\`,
          description: 'Local development',
        },
      ],
      tags: [
        { name: 'Health', description: 'Service health endpoints' },
      ],
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });

  await app.register(dbPlugin);
  await app.register(redisPlugin);
  await app.register(kafkaPlugin);
  await app.register(healthRoute);

  return app;
}

async function start(): Promise<void> {
  let app: ReturnType<typeof Fastify> | undefined;

  try {
    app = await buildApp();
    await app.listen({ host: '0.0.0.0', port: config.${UPPER_NAME}_PORT });
    logger.info({ port: config.${UPPER_NAME}_PORT, env: config.NODE_ENV }, '${TITLE} started');
  } catch (error: unknown) {
    logger.fatal({ err: error }, 'Failed to start ${NAME} service');
    process.exit(1);
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Received shutdown signal, draining connections...');
    if (app !== undefined) {
      await app.close();
    }
    logger.info('${TITLE} shut down gracefully');
    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
}

void start();
EOF

  echo "✓ Generated service: $NAME (port $PORT)"
done

echo ""
echo "All 8 Node.js services generated successfully."
