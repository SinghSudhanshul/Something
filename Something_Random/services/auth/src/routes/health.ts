/**
 * Auth Service — Health Route
 *
 * GET /health — Returns service health status, version, and uptime.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { HealthResponse } from '@nexus/types';

const startTime = Date.now();

async function healthRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/health',
    {
      schema: {
        tags: ['Health'],
        summary: 'Service health check',
        description: 'Returns the current health status of the auth service.',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok', 'degraded'] },
              service: { type: 'string' },
              version: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
              uptime: { type: 'number' },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply): Promise<HealthResponse> => {
      return {
        status: 'ok',
        service: 'auth',
        version: '0.1.0',
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - startTime) / 1000),
      };
    },
  );
}

export default healthRoute;
