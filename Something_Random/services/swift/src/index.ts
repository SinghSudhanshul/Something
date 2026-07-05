/**
 * NEXUS Swift Service — Campus Errands Entry Point
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
import taskRoutes from './modules/task/task.routes.js';
import gigRoutes from './modules/gig/gig.routes.js';
import { TaskService } from './modules/task/task.service.js';
import { GigService } from './modules/gig/gig.service.js';
import './types/index.js';

const logger = createLogger('swift-service');

export async function buildApp() {
  const app = Fastify({ logger: { level: config.LOG_LEVEL }, trustProxy: true, requestTimeout: 30000 });
  await app.register(fastifyHelmet, { contentSecurityPolicy: config.NODE_ENV === 'production' });
  await app.register(fastifyCors, { origin: (config as any).CORS_ORIGIN?.split(',').map((o: string) => o.trim()) ?? ['*'], credentials: true });
  await app.register(fastifyJwt, { secret: (config as any).JWT_ACCESS_SECRET ?? 'dev-secret' });
  await app.register(fastifyRateLimit, { max: 100, timeWindow: '1 minute' });
  await app.register(fastifySwagger, { openapi: { openapi: '3.0.3', info: { title: 'NEXUS Swift Service', version: '0.2.0' } } });
  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });
  await app.register(dbPlugin);
  await app.register(redisPlugin);
  await app.register(kafkaPlugin);
  await app.register(healthRoute);
  await app.register(taskRoutes);
  await app.register(gigRoutes);
  return app;
}

async function start() {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let autoExpireInterval: NodeJS.Timeout | undefined;
  try {
    app = await buildApp();
    await app.listen({ host: '0.0.0.0', port: (config as any).SWIFT_PORT ?? (config as any).PORT ?? 3006 });
    // Auto-expire cron: every 5 minutes
    const taskService = new TaskService(app);
    const gigService = new GigService(app);
    autoExpireInterval = setInterval(async () => {
      try {
        const taskCount = await taskService.autoExpire();
        const gigCount = await gigService.autoExpire();
        const total = taskCount + gigCount;
        if (total > 0) logger.info({ tasks: taskCount, gigs: gigCount }, 'Auto-expired items');
      } catch (err) {
        logger.error({ err }, 'Auto-expire failed');
      }
    }, 5 * 60_000);
    logger.info({ port: (config as any).SWIFT_PORT ?? (config as any).PORT ?? 3006 }, 'NEXUS Swift Service started');
  } catch (error) { logger.fatal({ err: error }, 'Failed to start swift'); process.exit(1); }
  const shutdown = async (signal: string) => { if (autoExpireInterval) clearInterval(autoExpireInterval); if (app) await app.close(); process.exit(0); };
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
}

void start();
