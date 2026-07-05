/**
 * NEXUS Pulse Service — Events, Tickets & Clubs
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
import mongoosePlugin from './plugins/mongoose.plugin.js';
import healthRoute from './routes/health.js';
import eventRoutes from './modules/event/event.routes.js';
import communityRoutes from './modules/community/community.routes.js';
import './types/index.js';

const logger = createLogger('pulse-service');

export async function buildApp() {
  const app = Fastify({ logger: { level: config.LOG_LEVEL }, trustProxy: true, requestTimeout: 30000 });
  await app.register(fastifyHelmet, { contentSecurityPolicy: config.NODE_ENV === 'production' });
  await app.register(fastifyCors, { origin: (config as any).CORS_ORIGIN?.split(',') ?? ['*'], credentials: true });
  await app.register(fastifyJwt, { secret: (config as any).JWT_ACCESS_SECRET ?? 'dev-secret' });
  await app.register(fastifyRateLimit, { max: 100, timeWindow: '1 minute' });
  await app.register(fastifySwagger, { openapi: { openapi: '3.0.3', info: { title: 'NEXUS Pulse Service', version: '0.2.0' } } });
  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });
  await app.register(dbPlugin);
  await app.register(redisPlugin);
  await app.register(kafkaPlugin);
  await app.register(mongoosePlugin);
  await app.register(healthRoute);
  await app.register(eventRoutes);
  await app.register(communityRoutes);
  return app;
}

async function start() {
  try {
    const app = await buildApp();
    await app.listen({ host: '0.0.0.0', port: (config as any).PULSE_PORT ?? (config as any).PORT ?? 3008 });
    logger.info({ port: (config as any).PULSE_PORT ?? 3008 }, 'NEXUS Pulse Service started');
    const shutdown = async (signal: string) => { await app.close(); process.exit(0); };
    process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
    process.on('SIGINT', () => { void shutdown('SIGINT'); });
  } catch (error) { logger.fatal({ err: error }, 'Failed to start pulse'); process.exit(1); }
}

void start();
