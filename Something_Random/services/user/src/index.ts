/**
 * User Service — Fastify Application Entry Point
 *
 * Registers all plugins, middleware, routes, and starts the server
 * with graceful shutdown handling for SIGTERM and SIGINT.
 */

import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyMultipart from '@fastify/multipart';

import { createLogger } from '@nexus/utils';
import { config } from './config.js';
import dbPlugin from './plugins/db.js';
import redisPlugin from './plugins/redis.js';
import kafkaPlugin from './plugins/kafka.js';
import healthRoute from './modules/health/health.routes.js';
import profileRoutes from './modules/profile/profile.routes.js';
import avatarRoutes from './modules/avatar/avatar.routes.js';
import socialRoutes from './modules/social/social.routes.js';

import './types/index.js';

const logger = createLogger('user-service', config.LOG_LEVEL);

export async function buildApp(): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
    },
    trustProxy: true,
    requestTimeout: 30000,
  });

  // ── Security Plugins ──────────────────────────────
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: config.NODE_ENV === 'production',
  });

  await app.register(fastifyCors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 6 * 1024 * 1024, // 6MB (max 5MB file, some buffer for multipart overhead)
    },
  });

  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
  });

  // ── API Documentation ─────────────────────────────
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'NEXUS User Service',
        description:
          'User profiles, trust scores, avatars, campus-scoped search, and social features for the NEXUS campus super-app.',
        version: '0.1.0',
        contact: {
          name: 'NEXUS Platform Team',
          email: 'platform@nexus.campus',
        },
      },
      servers: [
        {
          url: `http://localhost:${String(config.PORT)}`,
          description: 'Local development',
        },
      ],
      tags: [
        { name: 'Health', description: 'Service health endpoints' },
        { name: 'Profile', description: 'User profile endpoints' },
        { name: 'Avatar', description: 'Avatar upload endpoints' },
        { name: 'Social', description: 'Block and report endpoints' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  // ── Infrastructure Plugins ────────────────────────
  await app.register(dbPlugin);
  await app.register(redisPlugin);
  await app.register(kafkaPlugin);

  // ── Routes ────────────────────────────────────────
  await app.register(healthRoute);
  await app.register(profileRoutes);
  await app.register(avatarRoutes);
  await app.register(socialRoutes);

  // ── Global Error Handler ──────────────────────────
  app.setErrorHandler((error, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const message = statusCode < 500 ? error.message : 'Internal server error';

    if (statusCode >= 500) {
      app.log.error({ err: error }, 'Unhandled error');
    }

    void reply.status(statusCode).send({
      error: message,
      statusCode,
      ...(error.validation !== undefined ? { validation: error.validation } : {}),
    });
  });

  return app;
}

async function start(): Promise<void> {
  let app: ReturnType<typeof Fastify> | undefined;

  try {
    app = await buildApp();

    await app.listen({
      host: '0.0.0.0',
      port: config.PORT,
    });

    logger.info(
      { port: config.PORT, env: config.NODE_ENV },
      `User service started on port ${String(config.PORT)}`,
    );
  } catch (error: unknown) {
    logger.fatal({ err: error }, 'Failed to start user service');
    process.exit(1);
  }

  // ── Graceful Shutdown ─────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Received shutdown signal, draining connections...');
    if (app !== undefined) {
      await app.close();
    }
    logger.info('User service shut down gracefully');
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

void start();
