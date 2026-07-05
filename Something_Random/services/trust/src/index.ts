/**
 * NEXUS Trust Service — Fastify Application Entry Point
 *
 * The Trust Service is the nervous system's integrity layer. It:
 *  - Calculates and maintains trust scores for all users
 *  - Detects fraud via rule-based heuristics and ML model
 *  - Manages fraud flags with auto-suspension thresholds
 *  - Provides campus leaderboards
 *  - Runs nightly recompute for score reconciliation
 *  - Consumes events from all NEXUS services via Kafka
 *
 * Port: 3009
 * Stack: Node.js + TypeScript + Fastify + kafkajs + ioredis + pg
 *
 * @module trust-service
 */

import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { Pool } from 'pg';

import { createLogger } from '@nexus/utils';
import { createKafkaConsumer, createKafkaProducer, disconnectConsumer, disconnectProducer } from '@nexus/kafka';
import { config } from './config.js';
import dbPlugin from './plugins/db.js';
import redisPlugin from './plugins/redis.js';
import kafkaPlugin from './plugins/kafka.js';
import healthRoute from './routes/health.js';

import { ScoreRepository } from './modules/score/score.repository.js';
import { ScoreService } from './modules/score/score.service.js';
import { registerScoreRoutes } from './modules/score/score.routes.js';
import { FraudService } from './modules/fraud/fraud.service.js';
import { setupTrustConsumer } from './consumers/trust.consumer.js';

import './types/index.js';

const logger = createLogger('trust-service', config.LOG_LEVEL);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Application Builder
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function buildApp(): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
    },
    trustProxy: true,
    requestTimeout: 30000,
    bodyLimit: 1048576, // 1MB
  });

  // ── Security ────────────────────────────────
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: config.NODE_ENV === 'production',
  });

  await app.register(fastifyCors, {
    origin: config.TRUST_CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type', 'Authorization', 'X-Request-Id',
      'X-Authenticated-Userid', 'X-User-Campus-Id',
      'X-User-Verification-Level', 'X-User-Trust-Tier',
      'X-User-Roles', 'X-Internal-Secret',
    ],
  });

  await app.register(fastifyJwt, {
    secret: config.JWT_ACCESS_SECRET,
    sign: { expiresIn: '15m' },
  });

  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      // Use authenticated user ID if available, otherwise IP
      const userId = request.headers['x-authenticated-userid'] as string;
      return userId || request.ip;
    },
  });

  // ── API Documentation ───────────────────────
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'NEXUS Trust Service',
        description: 'User trust scoring, fraud detection, campus leaderboards, and moderation',
        version: '1.0.0',
        contact: { name: 'NEXUS Team' },
      },
      servers: [
        { url: `http://localhost:${String(config.TRUST_PORT)}`, description: 'Local development' },
      ],
      tags: [
        { name: 'Health', description: 'Service health endpoints' },
        { name: 'Trust', description: 'Trust score management' },
        { name: 'Fraud', description: 'Fraud detection and flag management' },
        { name: 'Admin', description: 'Administrative operations' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
          internalSecret: {
            type: 'apiKey',
            in: 'header',
            name: 'X-Internal-Secret',
          },
        },
      },
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });

  // ── Plugins ─────────────────────────────────
  await app.register(dbPlugin);
  await app.register(redisPlugin);
  await app.register(kafkaPlugin);
  await app.register(healthRoute);

  // ── Request Hooks ───────────────────────────
  app.addHook('onRequest', async (request, reply) => {
    // Add request ID for correlation
    const requestId = (request.headers['x-request-id'] as string) || crypto.randomUUID();
    request.headers['x-request-id'] = requestId;
  });

  app.addHook('onResponse', async (request, reply) => {
    const latency = reply.elapsedTime;
    if (latency > 500) {
      logger.warn(
        {
          method: request.method,
          url: request.url,
          statusCode: reply.statusCode,
          latencyMs: Math.round(latency),
        },
        'Slow request detected',
      );
    }
  });

  // ── Initialize Business Logic ───────────────
  const pgPool = new Pool({
    connectionString: config.DATABASE_URL,
    max: 20,
    min: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  // Verify DB connection on startup
  try {
    const client = await pgPool.connect();
    const { rows } = await client.query('SELECT NOW()');
    client.release();
    logger.info({ serverTime: rows[0].now }, 'PostgreSQL connection verified');
  } catch (err) {
    logger.fatal({ err }, 'Failed to connect to PostgreSQL — trust service cannot start');
    process.exit(1);
  }

  const scoreRepo = new ScoreRepository(pgPool);
  const fraudService = new FraudService(config.FRAUD_MODEL_URL, pgPool, app.redis);

  // Create Kafka producer wrapper for ScoreService
  const kafkaProducerWrapper = app.kafka
    ? {
        send: async (topic: string, messages: Array<{ key: string; value: string }>) => {
          await app.kafka.send({
            topic,
            messages: messages.map((m) => ({ key: m.key, value: m.value })),
          });
        },
      }
    : null;

  const scoreService = new ScoreService(scoreRepo, app.redis, kafkaProducerWrapper);

  // ── Register Routes ─────────────────────────
  await registerScoreRoutes(app as any, scoreService, fraudService);

  // ── Start Nightly Cron ──────────────────────
  scoreService.startCron();
  logger.info('Nightly recompute cron scheduled');

  // ── Start Kafka Consumer ────────────────────
  const brokers = config.KAFKA_BROKERS.split(',').map((b) => b.trim());
  let kafkaConsumer: any = null;
  let kafkaDlqProducer: any = null;

  try {
    kafkaConsumer = await createKafkaConsumer('trust-service-consumer', brokers);
    kafkaDlqProducer = await createKafkaProducer('trust-service-dlq', brokers);

    await setupTrustConsumer(kafkaConsumer, scoreService, fraudService, app.redis, kafkaDlqProducer);

    logger.info({ brokers }, 'Trust Kafka consumer started');
  } catch (err) {
    logger.warn({ err }, 'Trust Kafka consumer failed to start — running without event consumption');
  }

  // ── Shutdown Hooks ──────────────────────────
  app.addHook('onClose', async () => {
    logger.info('Shutting down trust service...');

    // Stop cron
    scoreService.stopCron();

    // Disconnect Kafka
    if (kafkaConsumer) {
      await disconnectConsumer(kafkaConsumer).catch((err: unknown) => {
        logger.warn({ err }, 'Error disconnecting Kafka consumer');
      });
    }
    if (kafkaDlqProducer) {
      await disconnectProducer(kafkaDlqProducer).catch((err: unknown) => {
        logger.warn({ err }, 'Error disconnecting Kafka DLQ producer');
      });
    }

    // Close PostgreSQL pool
    await pgPool.end().catch((err: unknown) => {
      logger.warn({ err }, 'Error closing PostgreSQL pool');
    });

    logger.info('Trust service cleanup complete');
  });

  // ── Decorate App ────────────────────────────
  app.decorate('scoreService', scoreService);
  app.decorate('fraudService', fraudService);

  return app;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Server Startup
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function start(): Promise<void> {
  let app: ReturnType<typeof Fastify> | undefined;

  try {
    app = await buildApp();
    await app.listen({ host: '0.0.0.0', port: config.TRUST_PORT });

    logger.info(
      {
        port: config.TRUST_PORT,
        env: config.NODE_ENV,
        version: '1.0.0',
        pid: process.pid,
        nodeVersion: process.version,
      },
      '🛡️  NEXUS Trust Service started',
    );
  } catch (error: unknown) {
    logger.fatal({ err: error }, 'Failed to start trust service');
    process.exit(1);
  }

  // ── Graceful Shutdown ───────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Received shutdown signal, draining connections...');

    // Set a hard timeout for shutdown
    const forceTimeout = setTimeout(() => {
      logger.error('Forced shutdown after 30s timeout');
      process.exit(1);
    }, 30000);

    try {
      if (app !== undefined) {
        await app.close();
      }
      clearTimeout(forceTimeout);
      logger.info('🛡️  NEXUS Trust Service shut down gracefully');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during graceful shutdown');
      clearTimeout(forceTimeout);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });

  // Handle uncaught errors
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    void shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled rejection');
    void shutdown('unhandledRejection');
  });
}

void start();
