/**
 * Social Routes
 *
 * Block, unblock, and report user endpoints.
 */

import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '@nexus/utils';
import type { RequestUser } from '@nexus/utils';

import * as socialService from './social.service.js';

const socialRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/v1/users/:userId/block — block a user
  fastify.post(
    '/api/v1/users/:userId/block',
    { preHandler: [requireAuth()] },
    async (request, reply) => {
      const user = request.user as RequestUser;
      const { userId } = request.params as { userId: string };
      const body = request.body as { reason?: string } | undefined;

      await socialService.blockUser(fastify, user.id, userId, body?.reason);
      return reply.status(204).send();
    },
  );

  // DELETE /api/v1/users/:userId/block — unblock a user
  fastify.delete(
    '/api/v1/users/:userId/block',
    { preHandler: [requireAuth()] },
    async (request, reply) => {
      const user = request.user as RequestUser;
      const { userId } = request.params as { userId: string };

      await socialService.unblockUser(fastify, user.id, userId);
      return reply.status(204).send();
    },
  );

  // POST /api/v1/users/:userId/report — report a user
  fastify.post(
    '/api/v1/users/:userId/report',
    { preHandler: [requireAuth()] },
    async (request, reply) => {
      const user = request.user as RequestUser;
      const { userId } = request.params as { userId: string };
      const body = request.body as {
        category: string;
        description?: string;
        reference_id?: string;
        reference_type?: string;
      };

      const result = await socialService.reportUser(
        fastify,
        user.id,
        userId,
        body.category,
        body.description,
        body.reference_id,
        body.reference_type,
      );

      return reply.status(201).send({ data: result });
    },
  );

  // GET /api/v1/users/me/blocked — list blocked users
  fastify.get(
    '/api/v1/users/me/blocked',
    { preHandler: [requireAuth()] },
    async (request, reply) => {
      const user = request.user as RequestUser;
      const blockedIds = await socialService.getBlockedUsers(fastify, user.id);
      return reply.send({ data: { blocked_user_ids: blockedIds } });
    },
  );
};

export default socialRoutes;
