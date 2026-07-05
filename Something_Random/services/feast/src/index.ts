/**
 * NEXUS Feast Service — Fastify Application Entry Point
 *
 * Campus food ordering with real-time WebSocket tracking.
 */

import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyWebsocket from '@fastify/websocket';
import { createLogger } from '@nexus/utils';
import { startFSSAICron } from './modules/canteen/fssai.cron.js';
import { config } from './config.js';
import dbPlugin from './plugins/db.js';
import redisPlugin from './plugins/redis.js';
import kafkaPlugin from './plugins/kafka.js';
import healthRoute from './routes/health.js';
import canteenRoutes from './modules/canteen/canteen.routes.js';
import orderRoutes from './modules/order/order.routes.js';
import deliveryRoutes from './modules/delivery/delivery.routes.js';
import orderGateway from './modules/realtime/order.gateway.js';
import './types/index.js';

const logger = createLogger('feast-service', config.LOG_LEVEL);

export async function buildApp() {
  const app = Fastify({ logger: { level: config.LOG_LEVEL }, trustProxy: true, requestTimeout: 30000 });
  await app.register(fastifyHelmet, { contentSecurityPolicy: config.NODE_ENV === 'production' });
  await app.register(fastifyCors, { origin: config.CORS_ORIGIN.split(',').map(o => o.trim()), credentials: true });
  await app.register(fastifyJwt, { secret: config.JWT_ACCESS_SECRET, sign: { expiresIn: '15m' } });
  await app.register(fastifyRateLimit, { max: 100, timeWindow: '1 minute' });
  await app.register(fastifyWebsocket);
  await app.register(fastifySwagger, { openapi: { openapi: '3.0.3', info: { title: 'NEXUS Feast Service', version: '0.2.0' }, tags: [{ name: 'Canteens' }, { name: 'Orders' }] } });
  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });
  await app.register(dbPlugin);
  await app.register(redisPlugin);
  await app.register(kafkaPlugin);
  await app.register(healthRoute);
  await app.register(canteenRoutes);
  await app.register(orderRoutes);
  await app.register(deliveryRoutes);
  await app.register(orderGateway);
  return app;
}

async function start() {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let fssaiCronInterval: NodeJS.Timeout | undefined;
  try {
    app = await buildApp();
    await app.listen({ host: '0.0.0.0', port: config.PORT });
    fssaiCronInterval = startFSSAICron(app);
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'NEXUS Feast Service started');
  } catch (error) { logger.fatal({ err: error }, 'Failed to start feast service'); process.exit(1); }
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');
    if (fssaiCronInterval) clearInterval(fssaiCronInterval);
    if (app) await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
}

void start();
