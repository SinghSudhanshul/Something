/**
 * Avatar Routes
 *
 * Avatar upload endpoint.
 */

import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '@nexus/utils';
import type { RequestUser } from '@nexus/utils';

import { uploadAvatar } from './avatar.service.js';

const avatarRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/v1/users/me/avatar — upload avatar
  fastify.post(
    '/api/v1/users/me/avatar',
    { preHandler: [requireAuth()] },
    async (request, reply) => {
      const user = request.user as RequestUser;
      const result = await uploadAvatar(fastify, request, user.id);
      return reply.send({ data: result });
    },
  );
};

export default avatarRoutes;
