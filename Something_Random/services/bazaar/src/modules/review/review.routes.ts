/**
 * NEXUS Bazaar — Review Routes
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireAuth, requireVerificationLevel } from '@nexus/utils';
import { ReviewService } from './review.service.js';
import { CreateReviewSchema, ReviewQuerySchema, ReviewParamsSchema } from './review.schema.js';

export default async function reviewRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new ReviewService(fastify);

  const extractUser = (req: FastifyRequest) => ({
    id: (req as any).user.id,
    campusId: (req as any).user.campusId,
    verificationLevel: (req as any).user.verificationLevel,
    roles: (req as any).user.roles ?? [(req as any).user.role],
  });

  // ━━━ Create review ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  fastify.post('/api/v1/reviews', {
    preHandler: [requireAuth(), requireVerificationLevel(2)],
    schema: { tags: ['Reviews'], summary: 'Submit a review after a completed transaction' },
  }, async (req, reply) => {
    const data = CreateReviewSchema.parse(req.body);
    const result = await service.createReview(extractUser(req), data);
    return reply.code(201).send(result);
  });

  // ━━━ List reviews for a user or listing ━━━━━━━━

  fastify.get('/api/v1/reviews', {
    preHandler: [requireAuth()],
    schema: { tags: ['Reviews'], summary: 'List reviews by user or listing' },
  }, async (req, reply) => {
    const query = ReviewQuerySchema.parse(req.query);
    const result = await service.getUserReviews(query);
    return reply.send(result);
  });

  // ━━━ Aggregate stats ━━━━━━━━━━━━━━━━━━━━━━━━━━

  fastify.get('/api/v1/users/:id/reviews/aggregate', {
    preHandler: [requireAuth()],
    schema: { tags: ['Reviews'], summary: 'Rating aggregate for a user' },
  }, async (req, reply) => {
    const { id } = ReviewParamsSchema.parse(req.params);
    const result = await service.getAggregate(id);
    return reply.send(result);
  });
}
