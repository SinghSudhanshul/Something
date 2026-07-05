/**
 * NEXUS Feast — Delivery Routes
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@nexus/utils';
import { DeliveryService } from './delivery.service.js';

const RegisterPartnerSchema = z.object({
  vehicleType: z.enum(['bike', 'bicycle', 'walk']),
  vehicleNumber: z.string().max(50).optional(),
  licenseNumber: z.string().max(50).optional(),
});

const UpdateAvailabilitySchema = z.object({
  isAvailable: z.boolean(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

const UpdateLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const VerifyPartnerSchema = z.object({
  approved: z.boolean(),
  notes: z.string().max(500).optional(),
});

export default async function deliveryRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new DeliveryService(fastify);
  const getUser = (req: any) => ({ id: req.user.id, campusId: req.user.campusId, role: req.user.role });

  // Partner self-service
  fastify.post('/api/v1/feast/delivery/register', {
    preHandler: [requireAuth()],
    schema: { tags: ['Delivery'], summary: 'Register as delivery partner' },
  }, async (req, reply) => {
    const u = getUser(req);
    const data = RegisterPartnerSchema.parse(req.body);
    return reply.code(201).send(await service.registerPartner(u.id, u.campusId, data));
  });

  fastify.get('/api/v1/feast/delivery/me', {
    preHandler: [requireAuth()],
    schema: { tags: ['Delivery'], summary: 'Get my delivery partner profile' },
  }, async (req, reply) => {
    return reply.send(await service.getMyPartnerProfile(getUser(req).id));
  });

  fastify.patch('/api/v1/feast/delivery/me/availability', {
    preHandler: [requireAuth()],
    schema: { tags: ['Delivery'], summary: 'Toggle availability' },
  }, async (req, reply) => {
    const data = UpdateAvailabilitySchema.parse(req.body);
    await service.updateAvailability(getUser(req).id, data.isAvailable, data.latitude, data.longitude);
    return reply.send({ isAvailable: data.isAvailable });
  });

  fastify.post('/api/v1/feast/delivery/me/location', {
    preHandler: [requireAuth()],
    schema: { tags: ['Delivery'], summary: 'Update my location' },
  }, async (req, reply) => {
    const data = UpdateLocationSchema.parse(req.body);
    await service.updateLocation(getUser(req).id, data.latitude, data.longitude);
    return reply.send({ updated: true });
  });

  fastify.get('/api/v1/feast/delivery/me/orders', {
    preHandler: [requireAuth()],
    schema: { tags: ['Delivery'], summary: 'My assigned delivery orders' },
  }, async (req, reply) => {
    const query = z.object({ status: z.string().optional() }).parse(req.query);
    return reply.send({ items: await service.getMyDeliveries(getUser(req).id, query.status) });
  });

  // Order lifecycle
  fastify.post('/api/v1/feast/delivery/orders/:id/assign', {
    preHandler: [requireAuth()],
    schema: { tags: ['Delivery'], summary: 'Auto-assign delivery partner' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const result = await service.findAndAssignDeliveryPartner(params.id);
    return reply.send(result);
  });

  fastify.post('/api/v1/feast/delivery/orders/:id/pickup', {
    preHandler: [requireAuth()],
    schema: { tags: ['Delivery'], summary: 'Mark order as picked up (partner only)' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    await service.pickUpOrder(params.id, getUser(req).id);
    return reply.send({ status: 'picked_up' });
  });

  fastify.post('/api/v1/feast/delivery/orders/:id/delivered', {
    preHandler: [requireAuth()],
    schema: { tags: ['Delivery'], summary: 'Mark order as delivered (partner only)' },
  }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    await service.markDelivered(params.id, getUser(req).id);
    return reply.send({ status: 'delivered' });
  });

  // Admin
  fastify.post('/api/v1/feast/delivery/partners/:id/verify', {
    preHandler: [requireAuth()],
    schema: { tags: ['Delivery'], summary: 'Approve/reject delivery partner (admin)' },
  }, async (req, reply) => {
    const u = getUser(req);
    if (u.role !== 'campus_admin' && u.role !== 'super_admin') {
      throw new (await import('@nexus/utils')).AppError(403, 'FORBIDDEN', 'Admin only');
    }
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const data = VerifyPartnerSchema.parse(req.body);
    return reply.send(await service.verifyPartner(params.id, u.id, data.approved, data.notes));
  });

  fastify.get('/api/v1/feast/delivery/available', {
    preHandler: [requireAuth()],
    schema: { tags: ['Delivery'], summary: 'List available delivery partners on campus' },
  }, async (req, reply) => {
    return reply.send({ items: await service.getAvailablePartners(getUser(req).campusId) });
  });
}
