/**
 * Health Routes
 *
 * Liveness and readiness probes for the user service.
 */

import type { FastifyPluginAsync } from 'fastify';

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /health — liveness probe
  fastify.get('/health', async () => {
    return { status: 'ok', service: 'user-service', uptime: process.uptime() };
  });

  // GET /ready — readiness probe
  fastify.get('/ready', async (_request, reply) => {
    try {
      // quick DB ping
      const db = (fastify as unknown as { db?: { execute?: (q: string) => Promise<unknown> } }).db;
      if (db?.execute) {
        await db.execute('SELECT 1');
      }
      return { status: 'ready', service: 'user-service' };
    } catch (err) {
      return reply.status(503).send({ status: 'not-ready', service: 'user-service', error: (err as Error).message });
    }
  });
};

export default healthRoutes;
