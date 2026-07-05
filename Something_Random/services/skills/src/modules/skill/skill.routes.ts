/**
 * NEXUS Skills — Skill Routes
 *
 * Zod-validated request bodies.
 */

import type { FastifyInstance } from 'fastify';
import { requireAuth, requireVerificationLevel } from '@nexus/utils';
import { SkillService } from './skill.service.js';
import {
  CreateSkillListingSchema, PlaceSkillOrderSchema, SubmitDeliverySchema,
  RevisionRequestSchema, RateSkillOrderSchema,
  SkillListingParamsSchema, SkillOrderParamsSchema,
} from './skill.schema.js';

export default async function skillRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new SkillService(fastify);
  const getUser = (req: any) => ({ id: req.user.id, campusId: req.user.campusId });

  fastify.post('/api/v1/skills/listings', {
    preHandler: [requireAuth(), requireVerificationLevel(2)],
    schema: { tags: ['Skill Listings'], summary: 'Create skill listing' },
  }, async (req, reply) => {
    const u = getUser(req);
    const data = CreateSkillListingSchema.parse(req.body);
    return reply.code(201).send(await service.createListing(u.id, u.campusId, data));
  });

  fastify.get('/api/v1/skills/listings', {
    preHandler: [requireAuth()],
    schema: { tags: ['Skill Listings'], summary: 'List skill listings' },
  }, async (req, reply) => {
    return reply.send({ items: await service.getListings(getUser(req).campusId) });
  });

  fastify.get('/api/v1/skills/listings/:id', {
    preHandler: [requireAuth()],
    schema: { tags: ['Skill Listings'], summary: 'Get skill listing detail' },
  }, async (req, reply) => {
    const { id } = SkillListingParamsSchema.parse(req.params);
    return reply.send(await service.getListing(id));
  });

  fastify.post('/api/v1/skills/listings/:id/order', {
    preHandler: [requireAuth(), requireVerificationLevel(2)],
    schema: { tags: ['Skill Orders'], summary: 'Place a skill order' },
  }, async (req, reply) => {
    const { id } = SkillListingParamsSchema.parse(req.params);
    const { packageId, requirements } = PlaceSkillOrderSchema.parse(req.body);
    return reply.code(201).send(await service.placeOrder(getUser(req).id, id, packageId, requirements));
  });

  fastify.get('/api/v1/skills/orders/me/buying', {
    preHandler: [requireAuth()],
    schema: { tags: ['Skill Orders'], summary: 'My buying orders' },
  }, async (req, reply) => {
    return reply.send({ items: await service.getMyBuyingOrders(getUser(req).id) });
  });

  fastify.get('/api/v1/skills/orders/me/providing', {
    preHandler: [requireAuth()],
    schema: { tags: ['Skill Orders'], summary: 'My providing orders' },
  }, async (req, reply) => {
    return reply.send({ items: await service.getMyProvidingOrders(getUser(req).id) });
  });

  fastify.get('/api/v1/skills/orders/:id', {
    preHandler: [requireAuth()],
    schema: { tags: ['Skill Orders'], summary: 'Get order detail' },
  }, async (req, reply) => {
    const { id } = SkillOrderParamsSchema.parse(req.params);
    return reply.send(await service.getOrder(id, getUser(req).id));
  });

  fastify.post('/api/v1/skills/orders/:id/deliver', {
    preHandler: [requireAuth()],
    schema: { tags: ['Skill Orders'], summary: 'Submit delivery proof' },
  }, async (req, reply) => {
    const { id } = SkillOrderParamsSchema.parse(req.params);
    const { proofUrl } = SubmitDeliverySchema.parse(req.body);
    await service.submitDelivery(id, getUser(req).id, proofUrl);
    return reply.send({ status: 'pending_review' });
  });

  fastify.post('/api/v1/skills/orders/:id/approve', {
    preHandler: [requireAuth()],
    schema: { tags: ['Skill Orders'], summary: 'Approve delivery' },
  }, async (req, reply) => {
    const { id } = SkillOrderParamsSchema.parse(req.params);
    await service.approveDelivery(id, getUser(req).id);
    return reply.send({ status: 'completed' });
  });

  fastify.post('/api/v1/skills/orders/:id/revision', {
    preHandler: [requireAuth()],
    schema: { tags: ['Skill Orders'], summary: 'Request revision' },
  }, async (req, reply) => {
    const { id } = SkillOrderParamsSchema.parse(req.params);
    const { feedback } = RevisionRequestSchema.parse(req.body);
    await service.requestRevision(id, getUser(req).id, feedback);
    return reply.send({ status: 'revision_requested' });
  });

  fastify.post('/api/v1/skills/orders/:id/rate', {
    preHandler: [requireAuth()],
    schema: { tags: ['Skill Orders'], summary: 'Rate completed order' },
  }, async (req, reply) => {
    const { id } = SkillOrderParamsSchema.parse(req.params);
    const { score, review_text } = RateSkillOrderSchema.parse(req.body);
    await service.rateOrder(id, getUser(req).id, score, review_text);
    return reply.code(201).send({ rated: true });
  });
}
