/**
 * Auth Service — Fastify Application Entry Point
 *
 * Registers all plugins, middleware, routes, and starts the server
 * with graceful shutdown handling for SIGTERM and SIGINT.
 */

import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyMultipart from '@fastify/multipart';
import cluster from 'node:cluster';
import os from 'node:os';

import { createLogger } from '@nexus/utils';
import { config } from './config.js';
import dbPlugin from './plugins/db.js';
import redisPlugin from './plugins/redis.js';
import kafkaPlugin from './plugins/kafka.js';
import healthRoute from './routes/health.js';
import authRoutes from './modules/auth/auth.routes.js';
import { verificationRoutes } from './modules/verification/verification.routes.js';

import './types/index.js';

export const logger = createLogger('auth-service', config.LOG_LEVEL);

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
    origin: config.AUTH_CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB
    },
  });

  await app.register(fastifyJwt, {
    secret: config.JWT_ACCESS_SECRET,
    sign: {
      expiresIn: config.JWT_ACCESS_EXPIRY,
    },
  });

  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
  });

  // ── JWT Authentication Decorator ──────────────────
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const user = request.user as { jti?: string };

      // Check JTI blocklist
      if (user.jti !== undefined) {
        const blocked = await app.redis.get(`token:blocklist:${user.jti}`);
        if (blocked !== null) {
          void reply.status(401).send({ error: 'Token has been revoked' });
          return;
        }
      }
    } catch {
      void reply.status(401).send({ error: 'Invalid or expired token' });
    }
  });

  // ── API Documentation ─────────────────────────────
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'NEXUS Auth Service',
        description: 'Authentication and authorization service for the NEXUS campus super-app. Handles user registration, OTP verification, JWT issuance, and session management.',
        version: '0.1.0',
        contact: {
          name: 'NEXUS Platform Team',
          email: 'platform@nexus.campus',
        },
      },
      servers: [
        {
          url: `http://localhost:${String(config.AUTH_PORT)}`,
          description: 'Local development',
        },
      ],
      tags: [
        { name: 'Health', description: 'Service health endpoints' },
        { name: 'Auth', description: 'Authentication endpoints' },
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
  await app.register(authRoutes);
  await app.register(verificationRoutes, { prefix: '/api/v1/verify' });

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
  if (process.env.CLUSTER_MODE === 'true' && cluster.isPrimary) {
    const numCPUs = os.cpus().length;
    logger.info(`Primary ${process.pid} is running. Forking ${numCPUs} workers...`);

    for (let i = 0; i < numCPUs; i++) {
      cluster.fork();
    }

    cluster.on('exit', (worker) => {
      logger.warn(`Worker ${worker.process.pid} died. Forking a new one...`);
      cluster.fork();
    });
    return;
  }

  let app: ReturnType<typeof Fastify> | undefined;

  try {
    app = await buildApp();

    await app.listen({
      host: '0.0.0.0',
      port: config.AUTH_PORT,
    });

    logger.info(
      { port: config.AUTH_PORT, env: config.NODE_ENV },
      `Auth service started on port ${String(config.AUTH_PORT)}`,
    );
  } catch (error: unknown) {
    logger.fatal({ err: error }, 'Failed to start auth service');
    process.exit(1);
  }

  // ── Graceful Shutdown ─────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Received shutdown signal, draining connections...');
    if (app !== undefined) {
      await app.close();
    }
    logger.info('Auth service shut down gracefully');
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
