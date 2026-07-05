/**
 * NEXUS Notifications Service — Health Route
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
        service: 'notifications',
        version: '0.1.0',
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - startTime) / 1000),
      };
    },
  );
}

export default healthRoute;
