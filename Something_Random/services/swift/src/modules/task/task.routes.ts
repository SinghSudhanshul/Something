/**
 * NEXUS Swift — Task Routes
 *
 * All HTTP route definitions for campus errands.
 * Zod-validated request bodies.
 */

import type { FastifyInstance } from 'fastify';
import { requireAuth, requireVerificationLevel } from '@nexus/utils';
import { TaskService } from './task.service.js';
import {
  PostTaskSchema, ApplyTaskSchema, AcceptRunnerParamsSchema,
  SubmitCompletionSchema, VerifyCompletionSchema, RateTaskSchema, TaskParamsSchema,
} from './task.schema.js';

export default async function taskRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new TaskService(fastify);
  const getUser = (req: any) => ({ id: req.user.id, campusId: req.user.campusId });

  fastify.post('/api/v1/swift/tasks', {
    preHandler: [requireAuth(), requireVerificationLevel(2)],
    schema: { tags: ['Tasks'], summary: 'Post a new task' },
  }, async (req, reply) => {
    const user = getUser(req);
    const data = PostTaskSchema.parse(req.body);
    const result = await service.postTask(user.id, user.campusId, data);
    return reply.code(201).send(result);
  });

  fastify.get('/api/v1/swift/tasks', {
    preHandler: [requireAuth()],
    schema: { tags: ['Tasks'], summary: 'List open tasks by campus' },
  }, async (req, reply) => {
    return reply.send({ items: await service.getTasks(getUser(req).campusId) });
  });

  fastify.get('/api/v1/swift/tasks/me/posted', {
    preHandler: [requireAuth()],
    schema: { tags: ['Tasks'], summary: 'My posted tasks' },
  }, async (req, reply) => {
    return reply.send({ items: await service.getMyPostedTasks(getUser(req).id) });
  });

  fastify.get('/api/v1/swift/tasks/me/running', {
    preHandler: [requireAuth()],
    schema: { tags: ['Tasks'], summary: 'My running tasks' },
  }, async (req, reply) => {
    return reply.send({ items: await service.getMyRunningTasks(getUser(req).id) });
  });

  fastify.get('/api/v1/swift/tasks/:id', {
    preHandler: [requireAuth()],
    schema: { tags: ['Tasks'], summary: 'Get task detail' },
  }, async (req, reply) => {
    const { id } = TaskParamsSchema.parse(req.params);
    return reply.send(await service.getTask(id));
  });

  fastify.post('/api/v1/swift/tasks/:id/apply', {
    preHandler: [requireAuth()],
    schema: { tags: ['Tasks'], summary: 'Apply for a task' },
  }, async (req, reply) => {
    const { id } = TaskParamsSchema.parse(req.params);
    const { message } = ApplyTaskSchema.parse(req.body ?? {});
    const result = await service.applyForTask(id, getUser(req).id, message);
    return reply.code(201).send(result);
  });

  fastify.get('/api/v1/swift/tasks/:id/applications', {
    preHandler: [requireAuth()],
    schema: { tags: ['Tasks'], summary: 'Get task applications (poster only)' },
  }, async (req, reply) => {
    const { id } = TaskParamsSchema.parse(req.params);
    return reply.send({ items: await service.getApplications(id, getUser(req).id) });
  });

  fastify.post('/api/v1/swift/tasks/:id/accept/:runnerId', {
    preHandler: [requireAuth()],
    schema: { tags: ['Tasks'], summary: 'Accept a runner' },
  }, async (req, reply) => {
    const { id, runnerId } = AcceptRunnerParamsSchema.parse(req.params);
    await service.acceptRunner(id, getUser(req).id, runnerId);
    return reply.send({ status: 'assigned' });
  });

  fastify.post('/api/v1/swift/tasks/:id/complete', {
    preHandler: [requireAuth()],
    schema: { tags: ['Tasks'], summary: 'Submit completion proof' },
  }, async (req, reply) => {
    const { id } = TaskParamsSchema.parse(req.params);
    const data = SubmitCompletionSchema.parse(req.body);
    await service.submitCompletion(id, getUser(req).id, data.proofUrl, data.proofType, data.notes);
    return reply.send({ status: 'pending_verification' });
  });

  fastify.post('/api/v1/swift/tasks/:id/verify', {
    preHandler: [requireAuth()],
    schema: { tags: ['Tasks'], summary: 'Verify task completion (poster only)' },
  }, async (req, reply) => {
    const { id } = TaskParamsSchema.parse(req.params);
    const { approve } = VerifyCompletionSchema.parse(req.body);
    await service.verifyCompletion(id, getUser(req).id, approve);
    return reply.send({ verified: approve });
  });

  fastify.post('/api/v1/swift/tasks/:id/rate', {
    preHandler: [requireAuth()],
    schema: { tags: ['Tasks'], summary: 'Rate a completed task' },
  }, async (req, reply) => {
    const { id } = TaskParamsSchema.parse(req.params);
    const { score, review_text } = RateTaskSchema.parse(req.body);
    await service.rateTask(id, getUser(req).id, score, review_text);
    return reply.code(201).send({ rated: true });
  });
}
