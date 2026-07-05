/**
 * NEXUS Feast — Canteen Routes
 *
 * All HTTP route definitions for canteen and menu item operations.
 * Zod-validated request bodies.
 */

import type { FastifyInstance } from 'fastify';
import { requireAuth, requireVerificationLevel } from '@nexus/utils';
import { CanteenService } from './canteen.service.js';
import {
  CreateCanteenSchema, CreateMenuItemSchema, MenuItemAvailabilitySchema,
  CanteenParamsSchema, MenuItemParamsSchema,
} from './canteen.schema.js';

export default async function canteenRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new CanteenService(fastify);
  const getUser = (req: any) => ({
    id: req.user.id, campusId: req.user.campusId,
    role: req.user.role ?? req.user.roles?.[0],
  });

  fastify.post('/api/v1/feast/canteens', {
    preHandler: [requireAuth()],
    schema: { tags: ['Canteens'], summary: 'Onboard a new canteen (vendor only)' },
  }, async (req, reply) => {
    const user = getUser(req);
    const data = CreateCanteenSchema.parse(req.body);
    const result = await service.onboardCanteen(user.id, user.campusId, data as any, user.role);
    return reply.code(201).send(result);
  });

  fastify.get('/api/v1/feast/canteens', {
    preHandler: [requireAuth()],
    schema: { tags: ['Canteens'], summary: 'List canteens by campus' },
  }, async (req, reply) => {
    const result = await service.getCanteensByCAmpus(getUser(req).campusId);
    return reply.send({ items: result });
  });

  fastify.get('/api/v1/feast/canteens/:id', {
    preHandler: [requireAuth()],
    schema: { tags: ['Canteens'], summary: 'Get canteen detail' },
  }, async (req, reply) => {
    const { id } = CanteenParamsSchema.parse(req.params);
    return reply.send(await service.getCanteen(id));
  });

  fastify.get('/api/v1/feast/canteens/:id/menu', {
    preHandler: [requireAuth()],
    schema: { tags: ['Canteens'], summary: 'Get canteen menu' },
  }, async (req, reply) => {
    const { id } = CanteenParamsSchema.parse(req.params);
    return reply.send(await service.getCanteenMenu(id));
  });

  fastify.post('/api/v1/feast/canteens/:id/menu', {
    preHandler: [requireAuth()],
    schema: { tags: ['Canteens'], summary: 'Add menu item (canteen owner only)' },
  }, async (req, reply) => {
    const { id } = CanteenParamsSchema.parse(req.params);
    const data = CreateMenuItemSchema.parse(req.body);
    const result = await service.addMenuItem(id, getUser(req).id, data as any);
    return reply.code(201).send(result);
  });

  fastify.patch('/api/v1/feast/canteens/:id/menu/:itemId/availability', {
    preHandler: [requireAuth()],
    schema: { tags: ['Canteens'], summary: 'Toggle menu item availability' },
  }, async (req, reply) => {
    const { id, itemId } = MenuItemParamsSchema.parse(req.params);
    const { is_available } = MenuItemAvailabilitySchema.parse(req.body);
    await service.updateItemAvailability(id, itemId, getUser(req).id, is_available);
    return reply.send({ updated: true });
  });
}
