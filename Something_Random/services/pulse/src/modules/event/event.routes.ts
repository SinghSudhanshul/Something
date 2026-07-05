/**
 * NEXUS Pulse — Event & Club Routes
 *
 * Zod-validated request bodies.
 */

import type { FastifyInstance } from 'fastify';
import { requireAuth, requireVerificationLevel } from '@nexus/utils';
import { EventService } from './event.service.js';
import {
  CreateEventSchema, PurchaseTicketsSchema, CheckInSchema,
  CreateClubSchema, EventParamsSchema, TicketParamsSchema, ClubParamsSchema,
} from './event.schema.js';

export default async function eventRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new EventService(fastify);
  const getUser = (req: any) => ({
    id: req.user.id, campusId: req.user.campusId,
    role: req.user.role, trustScore: Number(req.user.trustScore ?? 0),
  });

  // ━━━ Events ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  fastify.post('/api/v1/pulse/events', {
    preHandler: [requireAuth(), requireVerificationLevel(2)],
    schema: { tags: ['Events'], summary: 'Create event' },
  }, async (req, reply) => {
    const u = getUser(req);
    const data = CreateEventSchema.parse(req.body);
    return reply.code(201).send(await service.createEvent(u.id, u.campusId, data as any, u.trustScore));
  });

  fastify.get('/api/v1/pulse/events', {
    preHandler: [requireAuth()],
    schema: { tags: ['Events'], summary: 'List upcoming events' },
  }, async (req, reply) => {
    return reply.send({ items: await service.getEvents(getUser(req).campusId) });
  });

  fastify.get('/api/v1/pulse/events/:id', {
    preHandler: [requireAuth()],
    schema: { tags: ['Events'], summary: 'Get event detail' },
  }, async (req, reply) => {
    const { id } = EventParamsSchema.parse(req.params);
    return reply.send(await service.getEvent(id));
  });

  fastify.post('/api/v1/pulse/events/:id/publish', {
    preHandler: [requireAuth()],
    schema: { tags: ['Events'], summary: 'Publish event (organizer only)' },
  }, async (req, reply) => {
    const { id } = EventParamsSchema.parse(req.params);
    return reply.send(await service.publishEvent(id, getUser(req).id));
  });

  fastify.post('/api/v1/pulse/events/:id/tickets', {
    preHandler: [requireAuth(), requireVerificationLevel(2)],
    schema: { tags: ['Events'], summary: 'Purchase tickets' },
  }, async (req, reply) => {
    const { id } = EventParamsSchema.parse(req.params);
    const { ticketTypeId, quantity } = PurchaseTicketsSchema.parse(req.body);
    return reply.code(201).send(await service.purchaseTickets(id, ticketTypeId, quantity, getUser(req).id));
  });

  fastify.get('/api/v1/pulse/events/me/tickets', {
    preHandler: [requireAuth()],
    schema: { tags: ['Events'], summary: 'My tickets' },
  }, async (req, reply) => {
    return reply.send({ items: await service.getMyTickets(getUser(req).id) });
  });

  fastify.post('/api/v1/pulse/tickets/:id/checkin', {
    preHandler: [requireAuth()],
    schema: { tags: ['Events'], summary: 'Check-in with QR' },
  }, async (req, reply) => {
    const { id } = TicketParamsSchema.parse(req.params);
    const { qrCodeHash } = CheckInSchema.parse(req.body);
    return reply.send(await service.checkInTicket(id, qrCodeHash, getUser(req).id));
  });

  // ━━━ Clubs ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  fastify.get('/api/v1/pulse/clubs', {
    preHandler: [requireAuth()],
    schema: { tags: ['Clubs'], summary: 'List clubs' },
  }, async (req, reply) => {
    return reply.send({ items: await service.getClubs(getUser(req).campusId) });
  });

  fastify.get('/api/v1/pulse/clubs/:id', {
    preHandler: [requireAuth()],
    schema: { tags: ['Clubs'], summary: 'Get club detail' },
  }, async (req, reply) => {
    const { id } = ClubParamsSchema.parse(req.params);
    return reply.send(await service.getClub(id));
  });

  fastify.post('/api/v1/pulse/clubs', {
    preHandler: [requireAuth()],
    schema: { tags: ['Clubs'], summary: 'Create a club' },
  }, async (req, reply) => {
    const u = getUser(req);
    const data = CreateClubSchema.parse(req.body);
    return reply.code(201).send(await service.createClub(u.campusId, { ...data, leaderId: u.id }));
  });

  fastify.post('/api/v1/pulse/clubs/:id/join', {
    preHandler: [requireAuth()],
    schema: { tags: ['Clubs'], summary: 'Join a club' },
  }, async (req, reply) => {
    const { id } = ClubParamsSchema.parse(req.params);
    await service.joinClub(id, getUser(req).id);
    return reply.send({ joined: true });
  });
}
