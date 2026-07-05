/**
 * Trust Service Health Route
 *
 * Provides health check endpoints for orchestration, load balancers,
 * and monitoring systems.
 *
 * Endpoints:
 *  - GET /health       — Basic liveness check
 *  - GET /health/ready — Readiness check (DB, Redis, Kafka)
 *  - GET /health/deep  — Deep health check with details
 *
 * @module routes/health
 */

import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createLogger } from '@nexus/utils';

const logger = createLogger('trust-health');

interface HealthComponent {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs?: number;
  details?: Record<string, unknown>;
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  service: string;
  version: string;
  uptime: number;
  timestamp: string;
  components?: Record<string, HealthComponent>;
}

async function healthRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /health — Liveness probe ───────────
  app.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      status: 'healthy',
      service: 'nexus-trust-service',
      version: '1.0.0',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // ── GET /health/ready — Readiness probe ────
  app.get('/health/ready', async (_request: FastifyRequest, reply: FastifyReply) => {
    const components: Record<string, HealthComponent> = {};
    let overallHealthy = true;

    // Check PostgreSQL
    try {
      const start = Date.now();
      if (app.db) {
        const client = await app.db.connect();
        await client.query('SELECT 1');
        client.release();
        components['postgresql'] = { status: 'healthy', latencyMs: Date.now() - start };
      } else {
        components['postgresql'] = { status: 'unhealthy', details: { error: 'Pool not initialized' } };
        overallHealthy = false;
      }
    } catch (err: unknown) {
      components['postgresql'] = {
        status: 'unhealthy',
        details: { error: err instanceof Error ? err.message : 'Unknown error' },
      };
      overallHealthy = false;
    }

    // Check Redis
    try {
      const start = Date.now();
      if (app.redis) {
        const pong = await app.redis.ping();
        components['redis'] = {
          status: pong === 'PONG' ? 'healthy' : 'degraded',
          latencyMs: Date.now() - start,
        };
      } else {
        components['redis'] = { status: 'unhealthy', details: { error: 'Client not initialized' } };
        overallHealthy = false;
      }
    } catch (err: unknown) {
      components['redis'] = {
        status: 'unhealthy',
        details: { error: err instanceof Error ? err.message : 'Unknown error' },
      };
      overallHealthy = false;
    }

    // Check Kafka
    try {
      if (app.kafka) {
        components['kafka'] = { status: 'healthy' };
      } else {
        components['kafka'] = { status: 'degraded', details: { error: 'Producer not initialized' } };
      }
    } catch (err: unknown) {
      components['kafka'] = {
        status: 'degraded',
        details: { error: err instanceof Error ? err.message : 'Unknown error' },
      };
    }

    const response: HealthResponse = {
      status: overallHealthy ? 'healthy' : 'degraded',
      service: 'nexus-trust-service',
      version: '1.0.0',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      components,
    };

    return reply.code(overallHealthy ? 200 : 503).send(response);
  });

  // ── GET /health/deep — Deep health check ───
  app.get('/health/deep', async (_request: FastifyRequest, reply: FastifyReply) => {
    const components: Record<string, HealthComponent> = {};

    // PostgreSQL: check tables exist
    try {
      const start = Date.now();
      if (app.db) {
        const { rows } = await app.db.query(
          `SELECT table_name FROM information_schema.tables 
           WHERE table_schema = 'public' 
           AND table_name IN ('trust_score_events', 'student_profiles', 'fraud_flags')`,
        );
        components['postgresql'] = {
          status: 'healthy',
          latencyMs: Date.now() - start,
          details: {
            tablesFound: rows.map((r: any) => r.table_name),
            poolTotal: (app.db as any).totalCount,
            poolIdle: (app.db as any).idleCount,
            poolWaiting: (app.db as any).waitingCount,
          },
        };
      }
    } catch (err: unknown) {
      components['postgresql'] = {
        status: 'unhealthy',
        details: { error: err instanceof Error ? err.message : 'Unknown' },
      };
    }

    // Redis: check memory usage
    try {
      const start = Date.now();
      if (app.redis) {
        const info = await app.redis.info('memory');
        const usedMemory = info.match(/used_memory_human:(.+)/)?.[1]?.trim() ?? 'unknown';
        const maxMemory = info.match(/maxmemory_human:(.+)/)?.[1]?.trim() ?? 'unknown';

        components['redis'] = {
          status: 'healthy',
          latencyMs: Date.now() - start,
          details: { usedMemory, maxMemory },
        };
      }
    } catch (err: unknown) {
      components['redis'] = {
        status: 'unhealthy',
        details: { error: err instanceof Error ? err.message : 'Unknown' },
      };
    }

    // Fraud model health
    try {
      if (app.fraudService) {
        const modelHealth = await app.fraudService.checkModelHealth();
        components['fraud_model'] = {
          status: modelHealth.available ? 'healthy' : 'degraded',
          latencyMs: modelHealth.latencyMs,
          details: { failureCount: app.fraudService.modelFailureCount },
        };
      }
    } catch {
      components['fraud_model'] = { status: 'degraded' };
    }

    // System metrics
    const memUsage = process.memoryUsage();
    components['system'] = {
      status: 'healthy',
      details: {
        heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
        rssMB: Math.round(memUsage.rss / 1024 / 1024),
        externalMB: Math.round(memUsage.external / 1024 / 1024),
        uptimeSeconds: Math.round(process.uptime()),
        pid: process.pid,
        nodeVersion: process.version,
      },
    };

    const allHealthy = Object.values(components).every((c) => c.status === 'healthy');

    return reply.code(allHealthy ? 200 : 503).send({
      status: allHealthy ? 'healthy' : 'degraded',
      service: 'nexus-trust-service',
      version: '1.0.0',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      components,
    });
  });
}

export default fp(healthRoutes, {
  name: 'health-routes',
  fastify: '4.x',
});
