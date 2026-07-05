/**
 * NEXUS Search & Recommendations Service — Fastify Entry Point
 *
 * Full-text search, autocomplete, personalized recommendations,
 * and real-time sync from Kafka to Elasticsearch.
 *
 * Port: 3011
 * Stack: Node.js + TypeScript + Fastify + Elasticsearch + Redis + Kafka
 *
 * @module search-service
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
import elasticPlugin from './plugins/elasticsearch.plugin.js';
import healthRoute from './routes/health.js';

import { SearchService } from './modules/search/search.service.js';
import { RecommendationEngine } from './modules/search/recommendation.engine.js';
import { registerSearchRoutes } from './modules/search/search.routes.js';
import { setupSyncConsumer } from './consumers/sync.consumer.js';

import './types/index.js';

const logger = createLogger('search-service', config.LOG_LEVEL);

async function buildApp(): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL, timestamp: () => `,"time":"${new Date().toISOString()}"` },
    trustProxy: true,
    requestTimeout: 30000,
    bodyLimit: 1048576,
  });

  // Security
  await app.register(fastifyHelmet, { contentSecurityPolicy: config.NODE_ENV === 'production' });
  await app.register(fastifyCors, {
    origin: config.SEARCH_CORS_ORIGIN?.split(',').map((o) => o.trim()) ?? ['*'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type', 'Authorization', 'X-Request-Id',
      'X-Authenticated-Userid', 'X-User-Campus-Id', 'X-User-Roles',
      'X-Internal-Secret',
    ],
  });

  await app.register(fastifyJwt, { secret: config.JWT_ACCESS_SECRET, sign: { expiresIn: '15m' } });
  await app.register(fastifyRateLimit, {
    max: 200,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      return (request.headers['x-authenticated-userid'] as string) || request.ip;
    },
  });

  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'NEXUS Search & Recommendations',
        description: 'Full-text search, autocomplete, and personalized recommendations',
        version: '1.0.0',
      },
      servers: [{ url: `http://localhost:${String(config.SEARCH_PORT)}` }],
      tags: [
        { name: 'Search', description: 'Search endpoints' },
        { name: 'Recommendations', description: 'Personalized recommendations' },
        { name: 'Health', description: 'Service health' },
      ],
    },
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });

  // Plugins
  await app.register(dbPlugin);
  await app.register(redisPlugin);
  await app.register(kafkaPlugin);
  await app.register(elasticPlugin);
  await app.register(healthRoute);

  // Request hooks
  app.addHook('onResponse', async (request, reply) => {
    if (reply.elapsedTime > 500) {
      logger.warn(
        { method: request.method, url: request.url, statusCode: reply.statusCode, latencyMs: Math.round(reply.elapsedTime) },
        'Slow search request',
      );
    }
  });

  // Initialize services
  const pgPool = new Pool({
    connectionString: config.DATABASE_URL,
    max: 15,
    min: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  const searchService = new SearchService((app as any).elastic ?? null, pgPool, (app as any).redis, config.ELASTICSEARCH_INDEX_PREFIX);
  const recommendationEngine = new RecommendationEngine((app as any).elastic ?? null, pgPool, (app as any).redis, config.ELASTICSEARCH_INDEX_PREFIX);

  // Register routes
  await registerSearchRoutes(app as any, searchService, recommendationEngine, config.INTERNAL_SERVICE_SECRET);

  // Expose for full reindex
  searchService.setTriggerReindex(async () => {
    if ((app as any).elastic) {
      const { fullReindex } = await import('./consumers/sync.consumer.js');
      return fullReindex((app as any).elastic, pgPool, config.ELASTICSEARCH_INDEX_PREFIX);
    }
    throw new Error('Elasticsearch not available');
  });

  // Start Kafka consumer for sync
  const brokers = config.KAFKA_BROKERS.split(',').map((b) => b.trim());
  let kafkaConsumer: any = null;

  try {
    kafkaConsumer = await createKafkaConsumer('search-sync-consumer', brokers);
    await setupSyncConsumer(kafkaConsumer, (app as any).elastic ?? null, pgPool, (app as any).redis, config.ELASTICSEARCH_INDEX_PREFIX);
    logger.info({ brokers }, 'Search sync consumer started');
  } catch (err) {
    logger.warn({ err }, 'Search sync consumer failed — running without real-time sync');
  }

  // Shutdown hooks
  app.addHook('onClose', async () => {
    if (kafkaConsumer) await disconnectConsumer(kafkaConsumer).catch(() => {});
    await pgPool.end().catch(() => {});
    logger.info('Search service cleanup complete');
  });

  app.decorate('searchService', searchService);
  app.decorate('recommendationEngine', recommendationEngine);

  return app;
}

async function start(): Promise<void> {
  let app: ReturnType<typeof Fastify> | undefined;

  try {
    app = await buildApp();
    await app.listen({ host: '0.0.0.0', port: config.SEARCH_PORT });
    logger.info({ port: config.SEARCH_PORT, env: config.NODE_ENV, pid: process.pid }, '🔍 NEXUS Search Service started');
  } catch (error: unknown) {
    logger.fatal({ err: error }, 'Failed to start search service');
    process.exit(1);
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Received shutdown signal');
    const forceTimeout = setTimeout(() => { process.exit(1); }, 30000);
    try {
      if (app) await app.close();
      clearTimeout(forceTimeout);
      logger.info('🔍 NEXUS Search Service shut down gracefully');
      process.exit(0);
    } catch {
      clearTimeout(forceTimeout);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('uncaughtException', (err) => { logger.fatal({ err }, 'Uncaught exception'); void shutdown('uncaughtException'); });
  process.on('unhandledRejection', (reason) => { logger.fatal({ err: reason }, 'Unhandled rejection'); void shutdown('unhandledRejection'); });
}

void start();
