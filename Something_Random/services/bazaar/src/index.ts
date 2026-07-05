/**
 * NEXUS Bazaar Service — Fastify Application Entry Point
 *
 * Campus marketplace for buying and selling goods between students.
 * Registers all plugins, routes, consumers, and workers.
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
import elasticsearchPlugin from './plugins/elasticsearch.plugin.js';
import healthRoute from './routes/health.js';
import listingRoutes from './modules/listing/listing.routes.js';
import reviewRoutes from './modules/review/review.routes.js';
import uploadRoutes from './modules/upload/upload.routes.js';
import { startS3CleanupWorker } from './workers/s3-cleanup.worker.js';

import './types/index.js';

const logger = createLogger('bazaar-service', config.LOG_LEVEL);

export async function buildApp() {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL, timestamp: () => `,"time":"${new Date().toISOString()}"` },
    trustProxy: true,
    requestTimeout: 30000,
  });

  await app.register(fastifyHelmet, { contentSecurityPolicy: config.NODE_ENV === 'production' });
  await app.register(fastifyCors, {
    origin: config.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(fastifyJwt, { secret: config.JWT_ACCESS_SECRET, sign: { expiresIn: '15m' } });
  await app.register(fastifyRateLimit, { max: 100, timeWindow: '1 minute', keyGenerator: (req) => req.ip });
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.3',
      info: { title: 'NEXUS Bazaar Service', description: 'Campus marketplace', version: '0.2.0' },
      servers: [{ url: `http://localhost:${config.PORT}`, description: 'Local development' }],
      tags: [
        { name: 'Health', description: 'Service health' },
        { name: 'Listings', description: 'Listing CRUD' },
        { name: 'Offers', description: 'Listing offers' },
        { name: 'Transactions', description: 'Buy flow' },
        { name: 'Reviews', description: 'Reviews and ratings' },
      ],
    },
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/docs', uiConfig: { docExpansion: 'list', deepLinking: true } });

  // Infrastructure plugins
  await app.register(dbPlugin);
  await app.register(redisPlugin);
  await app.register(kafkaPlugin);
  await app.register(elasticsearchPlugin);

  // Routes
  await app.register(healthRoute);
  await app.register(listingRoutes);
  await app.register(reviewRoutes);
  await app.register(uploadRoutes);

  return app;
}

async function start(): Promise<void> {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let cleanupInterval: NodeJS.Timeout | undefined;

  try {
    app = await buildApp();
    await app.listen({ host: '0.0.0.0', port: config.PORT });

    // Start background workers
    cleanupInterval = startS3CleanupWorker(app);

    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'NEXUS Bazaar Service started');
  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start bazaar service');
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal, draining connections...');
    if (cleanupInterval) clearInterval(cleanupInterval);
    if (app) await app.close();
    logger.info('NEXUS Bazaar Service shut down gracefully');
    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
}

void start();
