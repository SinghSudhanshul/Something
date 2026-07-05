/**
 * NEXUS Swift — QuickGigs Routes
 */

import type { FastifyInstance } from 'fastify';
import { requireAuth, requireVerificationLevel } from '@nexus/utils';
import { GigService } from './gig.service.js';
import {
  CreateGigSchema,
  UpdateGigSchema,
  GigQuerySchema,
  GigParamsSchema,
  CreateApplicationSchema,
  RespondApplicationSchema,
} from './gig.schema.js';

export default async function gigRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new GigService(fastify);
  const getUser = (req: any) => ({ id: req.user.id, campusId: req.user.campusId });

  // ━━━ Gigs CRUD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  fastify.post('/api/v1/swift/gigs', {
    preHandler: [requireAuth(), requireVerificationLevel(2)],
    schema: { tags: ['Gigs'], summary: 'Post a new gig' },
  }, async (req, reply) => {
    const user = getUser(req);
    const data = CreateGigSchema.parse(req.body);
    const result = await service.createGig(user.id, user.campusId, data);
    return reply.code(201).send(result);
  });

  fastify.get('/api/v1/swift/gigs', {
    preHandler: [requireAuth()],
    schema: { tags: ['Gigs'], summary: 'Search and list gigs' },
  }, async (req, reply) => {
    const user = getUser(req);
    const query = GigQuerySchema.parse(req.query);
    const result = await service.searchGigs(query, user.campusId);
    return reply.send({
      items: result.items,
      total: result.total,
      cursor: result.items.length === query.limit ? String((parseInt(query.cursor ?? '0', 10) || 0) + query.limit) : null,
    });
  });

  fastify.get('/api/v1/swift/gigs/me/posted', {
    preHandler: [requireAuth()],
    schema: { tags: ['Gigs'], summary: 'My posted gigs' },
  }, async (req, reply) => {
    const user = getUser(req);
    const items = await service.getMyPostedGigs(user.id);
    return reply.send({ items });
  });

  fastify.get('/api/v1/swift/gigs/me/applications', {
    preHandler: [requireAuth()],
    schema: { tags: ['Gigs'], summary: 'My gig applications' },
  }, async (req, reply) => {
    const user = getUser(req);
    const items = await service.getMyApplications(user.id);
    return reply.send({ items });
  });

  fastify.get('/api/v1/swift/gigs/me/bookmarks', {
    preHandler: [requireAuth()],
    schema: { tags: ['Gigs'], summary: 'My bookmarked gigs' },
  }, async (req, reply) => {
    const user = getUser(req);
    const items = await service.getMyBookmarks(user.id);
    return reply.send({ items });
  });

  fastify.get('/api/v1/swift/gigs/recommended', {
    preHandler: [requireAuth()],
    schema: { tags: ['Gigs'], summary: 'Recommended gigs based on my skills' },
  }, async (req, reply) => {
    const user = getUser(req);
    const items = await service.getRecommendedGigsForUser(user.campusId, user.id);
    return reply.send({ items });
  });

  fastify.get('/api/v1/swift/gigs/:id', {
    preHandler: [requireAuth()],
    schema: { tags: ['Gigs'], summary: 'Get gig detail' },
  }, async (req, reply) => {
    const { id } = GigParamsSchema.parse(req.params);
    return reply.send(await service.getGig(id));
  });

  fastify.patch('/api/v1/swift/gigs/:id', {
    preHandler: [requireAuth()],
    schema: { tags: ['Gigs'], summary: 'Update gig (poster only)' },
  }, async (req, reply) => {
    const { id } = GigParamsSchema.parse(req.params);
    const data = UpdateGigSchema.parse(req.body);
    const result = await service.updateGig(id, getUser(req).id, data);
    return reply.send(result);
  });

  // ━━━ Applications ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  fastify.post('/api/v1/swift/gigs/:id/apply', {
    preHandler: [requireAuth(), requireVerificationLevel(2)],
    schema: { tags: ['Gigs'], summary: 'Apply for a gig' },
  }, async (req, reply) => {
    const { id } = GigParamsSchema.parse(req.params);
    const data = CreateApplicationSchema.parse(req.body);
    const result = await service.applyForGig(id, getUser(req).id, data);
    return reply.code(201).send(result);
  });

  fastify.get('/api/v1/swift/gigs/:id/applications', {
    preHandler: [requireAuth()],
    schema: { tags: ['Gigs'], summary: 'Get applications for gig (poster only)' },
  }, async (req, reply) => {
    const { id } = GigParamsSchema.parse(req.params);
    const items = await service.getApplicationsForGig(id, getUser(req).id);
    return reply.send({ items });
  });

  fastify.patch('/api/v1/swift/gigs/:id/applications/:applicationId', {
    preHandler: [requireAuth()],
    schema: { tags: ['Gigs'], summary: 'Accept or reject an application (poster only)' },
  }, async (req, reply) => {
    const params = req.params as { id: string; applicationId: string };
    const { action } = RespondApplicationSchema.parse(req.body);
    await service.respondToApplication(params.id, params.applicationId, getUser(req).id, action);
    return reply.send({ status: action });
  });

  // ━━━ Bookmarks ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  fastify.post('/api/v1/swift/gigs/:id/bookmark', {
    preHandler: [requireAuth()],
    schema: { tags: ['Gigs'], summary: 'Bookmark a gig' },
  }, async (req, reply) => {
    const { id } = GigParamsSchema.parse(req.params);
    await service.bookmarkGig(id, getUser(req).id);
    return reply.code(201).send({ bookmarked: true });
  });

  fastify.delete('/api/v1/swift/gigs/:id/bookmark', {
    preHandler: [requireAuth()],
    schema: { tags: ['Gigs'], summary: 'Remove bookmark' },
  }, async (req, reply) => {
    const { id } = GigParamsSchema.parse(req.params);
    await service.unbookmarkGig(id, getUser(req).id);
    return reply.code(204).send();
  });
}
