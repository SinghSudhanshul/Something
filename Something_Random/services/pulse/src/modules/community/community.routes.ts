/**
 * NEXUS Pulse — Community Groups & Team Formation Routes
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@nexus/utils';
import { CommunityService } from './community.service.js';

const CreateGroupSchema = z.object({
  name: z.string().min(3).max(200),
  description: z.string().min(20).max(2000),
  category: z.enum(['academic', 'cultural', 'sports', 'tech', 'social', 'arts', 'other']),
  isPublic: z.boolean().default(true),
  requiresApproval: z.boolean().default(false),
  tags: z.array(z.string().max(50)).max(10).default([]),
  rules: z.string().max(2000).optional(),
});

const CreatePostSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  body: z.string().min(1).max(10000),
  imageUrls: z.array(z.string().url()).max(10).default([]),
  isPinned: z.boolean().default(false),
});

const CreateCommentSchema = z.object({
  body: z.string().min(1).max(2000),
  parentCommentId: z.string().uuid().optional(),
});

const CreateTeamPostSchema = z.object({
  teamName: z.string().min(3).max(100),
  description: z.string().max(2000).optional(),
  skillsNeeded: z.array(z.string().max(50)).min(1).max(20),
  teamSize: z.number().int().min(2).max(20),
});

const JoinTeamSchema = z.object({
  message: z.string().max(500).optional(),
});

export default async function communityRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new CommunityService(fastify);
  const getUser = (req: any) => ({ id: req.user.id, campusId: req.user.campusId });

  // ━━━ Groups ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  fastify.post('/api/v1/pulse/groups', {
    preHandler: [requireAuth()],
    schema: { tags: ['Community'], summary: 'Create a community group' },
  }, async (req, reply) => {
    const u = getUser(req);
    const data = CreateGroupSchema.parse(req.body);
    return reply.code(201).send(await service.createGroup(u.id, u.campusId, data as any));
  });

  fastify.get('/api/v1/pulse/groups', {
    preHandler: [requireAuth()],
    schema: { tags: ['Community'], summary: 'List groups on campus' },
  }, async (req, reply) => {
    const u = getUser(req);
    const query = z.object({
      category: z.string().optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }).parse(req.query);
    const items = await service.listGroups(u.campusId, query.category, query.limit, query.cursor);
    return reply.send({ items, cursor: items.length === query.limit ? String((parseInt(query.cursor ?? '0', 10) || 0) + query.limit) : null });
  });

  fastify.get('/api/v1/pulse/groups/:id', {
    preHandler: [requireAuth()],
    schema: { tags: ['Community'], summary: 'Get group detail' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    return reply.send(await service.getGroup(params.id));
  });

  fastify.post('/api/v1/pulse/groups/:id/join', {
    preHandler: [requireAuth()],
    schema: { tags: ['Community'], summary: 'Join a group' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    await service.joinGroup(params.id, getUser(req).id);
    return reply.send({ joined: true });
  });

  fastify.post('/api/v1/pulse/groups/:id/leave', {
    preHandler: [requireAuth()],
    schema: { tags: ['Community'], summary: 'Leave a group' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    await service.leaveGroup(params.id, getUser(req).id);
    return reply.code(204).send();
  });

  fastify.get('/api/v1/pulse/groups/:id/members', {
    preHandler: [requireAuth()],
    schema: { tags: ['Community'], summary: 'List group members' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    return reply.send({ items: await service.listGroupMembers(params.id) });
  });

  // ━━━ Posts ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  fastify.post('/api/v1/pulse/groups/:id/posts', {
    preHandler: [requireAuth()],
    schema: { tags: ['Community'], summary: 'Create post in group' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const data = CreatePostSchema.parse(req.body);
    return reply.code(201).send(await service.createPost(getUser(req).id, params.id, data as any));
  });

  fastify.get('/api/v1/pulse/groups/:id/posts', {
    preHandler: [requireAuth()],
    schema: { tags: ['Community'], summary: 'List posts in group' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const query = z.object({
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }).parse(req.query);
    const items = await service.listPosts(params.id, query.limit, query.cursor);
    return reply.send({ items, cursor: items.length === query.limit ? String((parseInt(query.cursor ?? '0', 10) || 0) + query.limit) : null });
  });

  fastify.get('/api/v1/pulse/posts/:id', {
    preHandler: [requireAuth()],
    schema: { tags: ['Community'], summary: 'Get post detail' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    return reply.send(await service.getPost(params.id));
  });

  fastify.delete('/api/v1/pulse/posts/:id', {
    preHandler: [requireAuth()],
    schema: { tags: ['Community'], summary: 'Delete post' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    await service.deletePost(params.id, getUser(req).id);
    return reply.code(204).send();
  });

  fastify.patch('/api/v1/pulse/posts/:id/pin', {
    preHandler: [requireAuth()],
    schema: { tags: ['Community'], summary: 'Pin/unpin post (admin only)' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ isPinned: z.boolean() }).parse(req.body);
    await service.pinPost(params.id, getUser(req).id, body.isPinned);
    return reply.send({ isPinned: body.isPinned });
  });

  // ━━━ Comments ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  fastify.post('/api/v1/pulse/posts/:id/comments', {
    preHandler: [requireAuth()],
    schema: { tags: ['Community'], summary: 'Comment on a post' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const data = CreateCommentSchema.parse(req.body);
    return reply.code(201).send(await service.createComment(getUser(req).id, params.id, data.body, data.parentCommentId));
  });

  fastify.get('/api/v1/pulse/posts/:id/comments', {
    preHandler: [requireAuth()],
    schema: { tags: ['Community'], summary: 'List comments on a post' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    return reply.send({ items: await service.listComments(params.id) });
  });

  // ━━━ Team Formation ━━━━━━━━━━━━━━━━━━━━━━━━━━

  fastify.post('/api/v1/pulse/events/:id/teams', {
    preHandler: [requireAuth()],
    schema: { tags: ['Teams'], summary: 'Create a team for event' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const data = CreateTeamPostSchema.parse(req.body);
    return reply.code(201).send(await service.createTeamFormationPost(getUser(req).id, params.id, data as any));
  });

  fastify.get('/api/v1/pulse/events/:id/teams', {
    preHandler: [requireAuth()],
    schema: { tags: ['Teams'], summary: 'List teams for event' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const query = z.object({ open: z.coerce.boolean().default(true) }).parse(req.query);
    return reply.send({ items: await service.listTeamFormationPosts(params.id, query.open) });
  });

  fastify.get('/api/v1/pulse/teams/:id', {
    preHandler: [requireAuth()],
    schema: { tags: ['Teams'], summary: 'Get team formation post' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    return reply.send(await service.getTeamFormationPost(params.id));
  });

  fastify.post('/api/v1/pulse/teams/:id/join', {
    preHandler: [requireAuth()],
    schema: { tags: ['Teams'], summary: 'Request to join team' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const data = JoinTeamSchema.parse(req.body ?? {});
    return reply.code(201).send(await service.requestToJoinTeam(params.id, getUser(req).id, data.message));
  });

  fastify.get('/api/v1/pulse/teams/:id/requests', {
    preHandler: [requireAuth()],
    schema: { tags: ['Teams'], summary: 'List join requests (creator only)' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    return reply.send({ items: await service.listJoinRequests(params.id, getUser(req).id) });
  });

  fastify.patch('/api/v1/pulse/team-requests/:id', {
    preHandler: [requireAuth()],
    schema: { tags: ['Teams'], summary: 'Accept or reject join request (creator only)' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ action: z.enum(['accepted', 'rejected']) }).parse(req.body);
    await service.respondToJoinRequest(params.id, getUser(req).id, body.action);
    return reply.send({ status: body.action });
  });
}
