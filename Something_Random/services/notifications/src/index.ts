/**
 * NEXUS Notifications Service — Fastify Entry Point
 *
 * Multi-channel notification delivery: push (Expo), email (SES),
 * SMS (MSG91), and in-app with real-time WebSocket pub/sub.
 *
 * Port: 3010
 * Stack: Node.js + TypeScript + Fastify + BullMQ + Redis + Kafka
 *
 * @module notifications-service
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
import { createKafkaConsumer, disconnectConsumer } from '@nexus/kafka';
import { config } from './config.js';
import dbPlugin from './plugins/db.js';
import redisPlugin from './plugins/redis.js';
import kafkaPlugin from './plugins/kafka.js';
import healthRoute from './routes/health.js';

import { registerNotificationRoutes } from './routes/notification.routes.js';
import { registerPreferenceRoutes } from './modules/preference/preference.routes.js';
import { NotificationQueueManager } from './modules/queue/notification.queue.js';
import { setupNotificationConsumer } from './consumers/notification.consumer.js';
import {
  createPushWorker,
  createEmailWorker,
  createSmsWorker,
  createInAppWorker,
} from './modules/workers/notification.workers.js';

const logger = createLogger('notifications-service', config.LOG_LEVEL);



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
    origin: config.NOTIFICATIONS_CORS_ORIGIN?.split(',').map((o: string) => o.trim()) ?? ['*'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type', 'Authorization', 'X-Request-Id',
      'X-Authenticated-Userid', 'X-User-Campus-Id', 'X-User-Roles',
      'X-Internal-Secret',
    ],
  });

  await app.register(fastifyJwt, {
    secret: config.JWT_ACCESS_SECRET,
    sign: { expiresIn: '15m' },
  });

  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (request) =>
      (request.headers['x-authenticated-userid'] as string) || request.ip,
  });

  // ── Documentation ───────────────────────────
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'NEXUS Notifications Service',
        description: 'Multi-channel notification delivery: push, email, SMS, in-app',
        version: '1.0.0',
      },
      servers: [{ url: `http://localhost:${String(config.PORT)}` }],
      tags: [
        { name: 'Notifications', description: 'Notification management' },
        { name: 'Preferences', description: 'User notification preferences' },
        { name: 'Health', description: 'Service health checks' },
      ],
    },
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });

  // ── Plugins ─────────────────────────────────
  await app.register(dbPlugin);
  await app.register(redisPlugin);
  await app.register(kafkaPlugin);
  await app.register(healthRoute);

  // ── Request Hooks ───────────────────────────
  app.addHook('onRequest', async (request) => {
    (request as any).startTime = Date.now();
  });

  app.addHook('onResponse', async (request, reply) => {
    const latency = Date.now() - ((request as any).startTime ?? Date.now());
    if (latency > 500) {
      logger.warn({
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        latencyMs: latency,
      }, 'Slow notification request');
    }
  });

  // ── Queue Manager ───────────────────────────
  const pgPool = new Pool({
    connectionString: config.DATABASE_URL,
    max: 15,
    min: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  const queueManager = new NotificationQueueManager(app.redis, pgPool);
  app.decorate('queueManager', queueManager);

  // ── Routes ──────────────────────────────────
  await registerNotificationRoutes(app);
  await registerPreferenceRoutes(app);

  // ── Workers ─────────────────────────────────
  const workerCleanups: Array<() => Promise<void>> = [];

  try {
    const pushWorker = createPushWorker(app.redis, pgPool);
    if (pushWorker) workerCleanups.push(() => pushWorker.close());
    logger.info('Push notification worker started');
  } catch (err) {
    logger.warn({ err }, 'Push worker failed to start');
  }

  try {
    const emailWorker = createEmailWorker(app.redis, pgPool);
    if (emailWorker) workerCleanups.push(() => emailWorker.close());
    logger.info('Email notification worker started');
  } catch (err) {
    logger.warn({ err }, 'Email worker failed to start');
  }

  try {
    const smsWorker = createSmsWorker(app.redis, pgPool);
    if (smsWorker) workerCleanups.push(() => smsWorker.close());
    logger.info('SMS notification worker started');
  } catch (err) {
    logger.warn({ err }, 'SMS worker failed to start');
  }

  try {
    const inAppWorker = createInAppWorker(app.redis, pgPool);
    if (inAppWorker) workerCleanups.push(() => inAppWorker.close());
    logger.info('In-app notification worker started');
  } catch (err) {
    logger.warn({ err }, 'In-app worker failed to start');
  }

  // ── Kafka Consumer ──────────────────────────
  const brokers = config.KAFKA_BROKERS.split(',').map((b) => b.trim());
  let kafkaConsumer: any = null;

  try {
    kafkaConsumer = await createKafkaConsumer('notification-consumer', brokers);
    await setupNotificationConsumer(kafkaConsumer, queueManager, app.redis);
    logger.info({ brokers }, 'Notification Kafka consumer started');
  } catch (err) {
    logger.warn({ err }, 'Kafka consumer failed to start — running without event consumption');
  }

  // ── Shutdown ────────────────────────────────
  app.addHook('onClose', async () => {
    logger.info('Starting graceful shutdown...');

    // Stop Kafka consumer
    if (kafkaConsumer) {
      await disconnectConsumer(kafkaConsumer).catch((e: unknown) => {
        logger.warn({ err: e }, 'Error disconnecting Kafka consumer');
      });
    }

    // Stop workers
    for (const cleanup of workerCleanups) {
      await cleanup().catch((e: unknown) => {
        logger.warn({ err: e }, 'Error cleaning up worker');
      });
    }

    // Close queue manager
    await queueManager.close().catch((e: unknown) => {
      logger.warn({ err: e }, 'Error closing queue manager');
    });

    // Close DB pool
    await pgPool.end().catch((e: unknown) => {
      logger.warn({ err: e }, 'Error closing DB pool');
    });

    logger.info('Notifications service cleanup complete');
  });

  return app;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Bootstrap
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function start(): Promise<void> {
  let app: ReturnType<typeof Fastify> | undefined;

  try {
    app = await buildApp();
    await app.listen({
      host: '0.0.0.0',
      port: config.PORT,
    });

    logger.info({
      port: config.PORT,
      env: config.NODE_ENV,
      pid: process.pid,
    }, '🔔 NEXUS Notifications Service started');
  } catch (error: unknown) {
    logger.fatal({ err: error }, 'Failed to start notifications service');
    process.exit(1);
  }

  // Graceful shutdown handlers
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Received shutdown signal');

    const forceTimeout = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);

    try {
      if (app) await app.close();
      clearTimeout(forceTimeout);
      logger.info('🔔 NEXUS Notifications Service shut down gracefully');
      process.exit(0);
    } catch {
      clearTimeout(forceTimeout);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });

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
