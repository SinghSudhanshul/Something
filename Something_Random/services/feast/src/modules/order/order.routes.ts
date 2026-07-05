/**
 * NEXUS Feast — Order Routes
 *
 * All HTTP route definitions for food ordering operations.
 * Zod-validated request bodies.
 */

import type { FastifyInstance } from 'fastify';
import { requireAuth, requireVerificationLevel } from '@nexus/utils';
import { OrderService } from './order.service.js';
import {
  PlaceOrderSchema, UpdateOrderStatusSchema, RateOrderSchema,
  CancelOrderSchema, OrderParamsSchema,
} from './order.schema.js';

export default async function orderRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new OrderService(fastify);
  const getUser = (req: any) => ({
    id: req.user.id, campusId: req.user.campusId,
    role: req.user.role ?? req.user.roles?.[0],
  });

  fastify.post('/api/v1/feast/orders', {
    preHandler: [requireAuth(), requireVerificationLevel(2)],
    schema: { tags: ['Orders'], summary: 'Place a food order' },
  }, async (req, reply) => {
    const data = PlaceOrderSchema.parse(req.body);
    const result = await service.placeOrder(
      getUser(req).id, data.canteenId, data.items,
      data.deliveryType, data.deliveryLocation, data.instructions,
    );
    return reply.code(201).send(result);
  });

  fastify.get('/api/v1/feast/orders/me', {
    preHandler: [requireAuth()],
    schema: { tags: ['Orders'], summary: 'My orders' },
  }, async (req, reply) => {
    return reply.send({ items: await service.getMyOrders(getUser(req).id) });
  });

  fastify.get('/api/v1/feast/orders/:id', {
    preHandler: [requireAuth()],
    schema: { tags: ['Orders'], summary: 'Get order detail' },
  }, async (req, reply) => {
    const { id } = OrderParamsSchema.parse(req.params);
    return reply.send(await service.getOrder(id, getUser(req).id));
  });

  fastify.post('/api/v1/feast/orders/:id/cancel', {
    preHandler: [requireAuth()],
    schema: { tags: ['Orders'], summary: 'Cancel order (before preparation)' },
  }, async (req, reply) => {
    const { id } = OrderParamsSchema.parse(req.params);
    const { reason } = CancelOrderSchema.parse(req.body);
    await service.cancelOrder(id, getUser(req).id, reason);
    return reply.send({ status: 'cancelled' });
  });

  fastify.patch('/api/v1/feast/orders/:id/status', {
    preHandler: [requireAuth()],
    schema: { tags: ['Orders'], summary: 'Update order status (vendor only)' },
  }, async (req, reply) => {
    const { id } = OrderParamsSchema.parse(req.params);
    const { status } = UpdateOrderStatusSchema.parse(req.body);
    await service.updateOrderStatus(id, status, getUser(req).id);
    return reply.send({ status });
  });

  fastify.post('/api/v1/feast/orders/:id/rate', {
    preHandler: [requireAuth()],
    schema: { tags: ['Orders'], summary: 'Rate a completed order' },
  }, async (req, reply) => {
    const { id } = OrderParamsSchema.parse(req.params);
    const { score, review_text } = RateOrderSchema.parse(req.body);
    await service.rateOrder(id, getUser(req).id, score, review_text);
    return reply.code(201).send({ rated: true });
  });
}
