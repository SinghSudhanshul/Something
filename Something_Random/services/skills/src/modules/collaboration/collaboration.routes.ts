/**
 * NEXUS Skills — Collaboration Routes
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@nexus/utils';
import { CollaborationService } from './collaboration.service.js';

const CreateCollabPostSchema = z.object({
  title: z.string().min(5).max(200),
  description: z.string().min(50).max(5000),
  projectType: z.enum(['hackathon', 'research', 'startup', 'open_source', 'academic', 'other']),
  skillsNeeded: z.array(z.string().max(50)).min(1).max(20),
  teamSize: z.number().int().min(2).max(20),
  commitment: z.enum(['part_time', 'full_time', 'weekend', 'flexible']).optional(),
  durationWeeks: z.number().int().positive().max(104).optional(),
  tags: z.array(z.string().max(50)).max(10).default([]),
});

const ApplyToCollabSchema = z.object({
  message: z.string().min(20).max(2000),
  relevantSkills: z.array(z.string().max(50)).max(20).default([]),
});

const RespondCollabSchema = z.object({
  action: z.enum(['accepted', 'rejected']),
});

const UpdateStatusSchema = z.object({
  status: z.enum(['open', 'closed', 'in_progress']),
});

export default async function collaborationRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new CollaborationService(fastify);
  const getUser = (req: any) => ({ id: req.user.id, campusId: req.user.campusId });

  fastify.post('/api/v1/skills/collaborations', {
    preHandler: [requireAuth()],
    schema: { tags: ['Collaboration'], summary: 'Create a collaboration post' },
  }, async (req, reply) => {
    const u = getUser(req);
    const data = CreateCollabPostSchema.parse(req.body);
    return reply.code(201).send(await service.createPost(u.id, u.campusId, data));
  });

  fastify.get('/api/v1/skills/collaborations', {
    preHandler: [requireAuth()],
    schema: { tags: ['Collaboration'], summary: 'List collaboration posts' },
  }, async (req, reply) => {
    const u = getUser(req);
    const query = z.object({
      projectType: z.string().optional(),
      status: z.string().default('open'),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }).parse(req.query);
    const items = await service.listPosts(u.campusId, query.projectType, query.status, query.limit, query.cursor);
    return reply.send({ items, cursor: items.length === query.limit ? String((parseInt(query.cursor ?? '0', 10) || 0) + query.limit) : null });
  });

  fastify.get('/api/v1/skills/collaborations/:id', {
    preHandler: [requireAuth()],
    schema: { tags: ['Collaboration'], summary: 'Get collaboration post with team' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    return reply.send(await service.getPost(params.id));
  });

  fastify.patch('/api/v1/skills/collaborations/:id/status', {
    preHandler: [requireAuth()],
    schema: { tags: ['Collaboration'], summary: 'Update post status (author only)' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const data = UpdateStatusSchema.parse(req.body);
    await service.updatePostStatus(params.id, getUser(req).id, data.status);
    return reply.send({ status: data.status });
  });

  fastify.post('/api/v1/skills/collaborations/:id/apply', {
    preHandler: [requireAuth()],
    schema: { tags: ['Collaboration'], summary: 'Apply to join collaboration' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const data = ApplyToCollabSchema.parse(req.body);
    return reply.code(201).send(await service.applyToPost(params.id, getUser(req).id, data));
  });

  fastify.get('/api/v1/skills/collaborations/:id/applications', {
    preHandler: [requireAuth()],
    schema: { tags: ['Collaboration'], summary: 'List applications (author only)' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    return reply.send({ items: await service.getApplicationsForPost(params.id, getUser(req).id) });
  });

  fastify.patch('/api/v1/skills/collaboration-applications/:id', {
    preHandler: [requireAuth()],
    schema: { tags: ['Collaboration'], summary: 'Accept or reject application' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const data = RespondCollabSchema.parse(req.body);
    await service.respondToApplication(params.id, getUser(req).id, data.action);
    return reply.send({ status: data.action });
  });

  fastify.get('/api/v1/skills/collaborations/me/applications', {
    preHandler: [requireAuth()],
    schema: { tags: ['Collaboration'], summary: 'My applications' },
  }, async (req, reply) => {
    return reply.send({ items: await service.getMyApplications(getUser(req).id) });
  });
}
