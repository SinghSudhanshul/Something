/**
 * Profile Routes
 *
 * User profile CRUD, search, and QR scan endpoints.
 */

import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '@nexus/utils';
import type { RequestUser } from '@nexus/utils';

import * as profileService from './profile.service.js';

const profileRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/users/me/profile — full own profile (cached 5 min)
  fastify.get(
    '/api/v1/users/me/profile',
    { preHandler: [requireAuth()] },
    async (request, reply) => {
      const user = request.user as RequestUser;
      const profile = await profileService.getMyProfile(fastify, user.id);
      return reply.send({ data: profile });
    },
  );

  // PATCH /api/v1/users/me/profile — partial update
  fastify.patch(
    '/api/v1/users/me/profile',
    { preHandler: [requireAuth()] },
    async (request, reply) => {
      const user = request.user as RequestUser;
      const body = request.body as {
        full_name?: string;
        department?: string;
        year_of_study?: number;
        hostel_block?: string;
        room_number?: string;
        bio?: string;
        interests?: string[];
      };

      const profile = await profileService.updateMyProfile(fastify, user.id, body);
      return reply.send({ data: profile });
    },
  );

  // GET /api/v1/users/:userId/profile — public view
  fastify.get(
    '/api/v1/users/:userId/profile',
    { preHandler: [requireAuth()] },
    async (request, reply) => {
      const user = request.user as RequestUser;
      const { userId } = request.params as { userId: string };

      // If requesting own profile, return full profile
      if (userId === user.id) {
        const profile = await profileService.getMyProfile(fastify, user.id);
        return reply.send({ data: profile });
      }

      const profile = await profileService.getPublicProfile(fastify, userId, user);
      return reply.send({ data: profile });
    },
  );

  // GET /api/v1/users/search — campus-scoped search
  fastify.get(
    '/api/v1/users/search',
    { preHandler: [requireAuth()] },
    async (request, reply) => {
      const user = request.user as RequestUser;
      const query = request.query as {
        q?: string;
        cursor?: string;
        limit?: string;
        campus_id?: string;
      };

      const limit = Math.min(Math.max(parseInt(query.limit ?? '20', 10), 1), 100);

      const results = await profileService.searchUsers(
        fastify,
        user,
        query.q ?? '',
        query.cursor ?? null,
        limit,
        query.campus_id,
      );

      return reply.send({ data: results });
    },
  );

  // GET /api/v1/users/search/qr/:userId — minimal profile for QR scan
  fastify.get(
    '/api/v1/users/search/qr/:userId',
    { preHandler: [requireAuth()] },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const profile = await profileService.getQrProfile(fastify, userId);
      return reply.send({ data: profile });
    },
  );
};

export default profileRoutes;
