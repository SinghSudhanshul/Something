/**
 * NEXUS Skills Service — Campus Gig Economy
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
import skillRoutes from './modules/skill/skill.routes.js';
import { SkillService } from './modules/skill/skill.service.js';
import './types/index.js';

const logger = createLogger('skills-service');

export async function buildApp() {
  const app = Fastify({ logger: { level: config.LOG_LEVEL }, trustProxy: true, requestTimeout: 30000 });
  await app.register(fastifyHelmet, { contentSecurityPolicy: config.NODE_ENV === 'production' });
  await app.register(fastifyCors, { origin: (config as any).CORS_ORIGIN?.split(',') ?? ['*'], credentials: true });
  await app.register(fastifyJwt, { secret: (config as any).JWT_ACCESS_SECRET ?? 'dev-secret' });
  await app.register(fastifyRateLimit, { max: 100, timeWindow: '1 minute' });
  await app.register(fastifySwagger, { openapi: { openapi: '3.0.3', info: { title: 'NEXUS Skills Service', version: '0.2.0' } } });
  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });
  await app.register(dbPlugin);
  await app.register(redisPlugin);
  await app.register(kafkaPlugin);
  await app.register(healthRoute);
  await app.register(skillRoutes);
  return app;
}

async function start() {
  let autoReleaseInterval: NodeJS.Timeout | undefined;
  try {
    const app = await buildApp();
    await app.listen({ host: '0.0.0.0', port: (config as any).SKILLS_PORT ?? (config as any).PORT ?? 3010 });

    // 72-hour auto-release cron: every 15 minutes
    const skillService = new SkillService(app);
    autoReleaseInterval = setInterval(async () => {
      try { const count = await skillService.autoReleaseEscrow(); if (count > 0) logger.info({ released: count }, 'Auto-released skill orders'); } catch (err) { logger.error({ err }, 'Auto-release failed'); }
    }, 15 * 60_000);

    logger.info({ port: (config as any).SKILLS_PORT ?? 3010 }, 'NEXUS Skills Service started');

    const shutdown = async (signal: string) => { if (autoReleaseInterval) clearInterval(autoReleaseInterval); await app.close(); process.exit(0); };
    process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
    process.on('SIGINT', () => { void shutdown('SIGINT'); });
  } catch (error) { logger.fatal({ err: error }, 'Failed to start skills'); process.exit(1); }
}

void start();
