/**
 * NEXUS Bazaar — Listing Routes
 *
 * All HTTP route definitions for listings, offers, saves, and transactions.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth, requireVerificationLevel } from '@nexus/utils';
import { ListingService } from './listing.service.js';
import {
  CreateListingSchema, UpdateListingSchema, ListingQuerySchema,
  OfferSchema, OfferActionSchema, ListingParamsSchema,
  InitiatePurchaseSchema, CancelTransactionSchema,
} from './listing.schema.js';

export default async function listingRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new ListingService(fastify);

  const extractUser = (req: FastifyRequest) => ({
    id: (req as any).user.id,
    campusId: (req as any).user.campusId,
    verificationLevel: (req as any).user.verificationLevel,
    roles: (req as any).user.roles ?? [(req as any).user.role],
  });

  // ━━━ Listings CRUD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  fastify.post('/api/v1/listings', {
    preHandler: [requireAuth(), requireVerificationLevel(2)],
    schema: { tags: ['Listings'], summary: 'Create a listing', body: CreateListingSchema },
  }, async (req, reply) => {
    const data = CreateListingSchema.parse(req.body);
    const result = await service.createListing(extractUser(req), data);
    return reply.code(201).send(result);
  });

  fastify.get('/api/v1/listings', {
    preHandler: [requireAuth()],
    schema: { tags: ['Listings'], summary: 'List listings (campus scoped)' },
  }, async (req, reply) => {
    const query = ListingQuerySchema.parse(req.query);
    const result = await service.searchListings(query, extractUser(req));
    return reply.send(result);
  });

  fastify.get('/api/v1/listings/search', {
    preHandler: [requireAuth()],
    schema: { tags: ['Listings'], summary: 'Search listings with ES' },
  }, async (req, reply) => {
    const query = ListingQuerySchema.parse(req.query);
    const result = await service.searchListings(query, extractUser(req));
    return reply.send(result);
  });

  fastify.get('/api/v1/listings/me/active', {
    preHandler: [requireAuth()],
    schema: { tags: ['Listings'], summary: 'My active listings' },
  }, async (req, reply) => {
    const user = extractUser(req);
    const result = await service.getMyActiveListings(user.id);
    return reply.send({ items: result });
  });

  fastify.get('/api/v1/listings/me/sold', {
    preHandler: [requireAuth()],
    schema: { tags: ['Listings'], summary: 'My sold listings' },
  }, async (req, reply) => {
    const user = extractUser(req);
    const result = await service.getMySoldListings(user.id);
    return reply.send({ items: result });
  });

  fastify.get('/api/v1/listings/me/saved', {
    preHandler: [requireAuth()],
    schema: { tags: ['Listings'], summary: 'My saved listings' },
  }, async (req, reply) => {
    const user = extractUser(req);
    const result = await service.getMySavedListings(user.id);
    return reply.send({ items: result });
  });

  fastify.get('/api/v1/listings/:id', {
    preHandler: [requireAuth()],
    schema: { tags: ['Listings'], summary: 'Get listing detail' },
  }, async (req, reply) => {
    const { id } = ListingParamsSchema.parse(req.params);
    const user = extractUser(req);
    const result = await service.getListing(id, user.id);
    return reply.send(result);
  });

  fastify.patch('/api/v1/listings/:id', {
    preHandler: [requireAuth()],
    schema: { tags: ['Listings'], summary: 'Update listing (owner only)' },
  }, async (req, reply) => {
    const { id } = ListingParamsSchema.parse(req.params);
    const data = UpdateListingSchema.parse(req.body);
    const result = await service.updateListing(id, extractUser(req), data);
    return reply.send(result);
  });

  fastify.delete('/api/v1/listings/:id', {
    preHandler: [requireAuth()],
    schema: { tags: ['Listings'], summary: 'Delete listing (owner only)' },
  }, async (req, reply) => {
    const { id } = ListingParamsSchema.parse(req.params);
    await service.deleteListing(id, extractUser(req));
    return reply.code(204).send();
  });

  // ━━━ Saves ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  fastify.post('/api/v1/listings/:id/save', {
    preHandler: [requireAuth()],
    schema: { tags: ['Listings'], summary: 'Save a listing' },
  }, async (req, reply) => {
    const { id } = ListingParamsSchema.parse(req.params);
    await service.saveListing(id, extractUser(req).id);
    return reply.code(201).send({ saved: true });
  });

  fastify.delete('/api/v1/listings/:id/save', {
    preHandler: [requireAuth()],
    schema: { tags: ['Listings'], summary: 'Unsave a listing' },
  }, async (req, reply) => {
    const { id } = ListingParamsSchema.parse(req.params);
    await service.unsaveListing(id, extractUser(req).id);
    return reply.code(204).send();
  });

  // ━━━ Offers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  fastify.get('/api/v1/listings/:id/offers', {
    preHandler: [requireAuth()],
    schema: { tags: ['Offers'], summary: 'Get offers for listing (seller only)' },
  }, async (req, reply) => {
    const { id } = ListingParamsSchema.parse(req.params);
    const result = await service.getOffersForListing(id, extractUser(req).id);
    return reply.send({ items: result });
  });

  fastify.post('/api/v1/listings/:id/offers', {
    preHandler: [requireAuth(), requireVerificationLevel(2)],
    schema: { tags: ['Offers'], summary: 'Make an offer on a listing' },
  }, async (req, reply) => {
    const { id } = ListingParamsSchema.parse(req.params);
    const { amount, message } = OfferSchema.parse(req.body);
    const result = await service.createOffer(id, extractUser(req).id, amount, message);
    return reply.code(201).send(result);
  });

  fastify.patch('/api/v1/listings/:id/offers/:offerId', {
    preHandler: [requireAuth()],
    schema: { tags: ['Offers'], summary: 'Accept or reject an offer (seller only)' },
  }, async (req, reply) => {
    const params = req.params as { id: string; offerId: string };
    const { action } = OfferActionSchema.parse(req.body);
    await service.respondToOffer(params.id, params.offerId, extractUser(req).id, action);
    return reply.send({ status: action });
  });

  // ━━━ Transactions ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  fastify.post('/api/v1/bazaar/transactions/initiate', {
    preHandler: [requireAuth(), requireVerificationLevel(2)],
    schema: { tags: ['Transactions'], summary: 'Initiate a purchase' },
  }, async (req, reply) => {
    const { listingId, offerId } = InitiatePurchaseSchema.parse(req.body);
    const result = await service.initiatePurchase(extractUser(req).id, listingId, offerId);
    return reply.code(201).send(result);
  });

  fastify.post('/api/v1/bazaar/transactions/:id/confirm', {
    preHandler: [requireAuth()],
    schema: { tags: ['Transactions'], summary: 'Confirm delivery (buyer only)' },
  }, async (req, reply) => {
    const { id } = ListingParamsSchema.parse(req.params);
    await service.confirmDelivery(id, extractUser(req).id);
    return reply.send({ status: 'completed' });
  });

  fastify.post('/api/v1/bazaar/transactions/:id/cancel', {
    preHandler: [requireAuth()],
    schema: { tags: ['Transactions'], summary: 'Cancel transaction' },
  }, async (req, reply) => {
    const { id } = ListingParamsSchema.parse(req.params);
    const { reason } = CancelTransactionSchema.parse(req.body);
    await service.cancelTransaction(id, extractUser(req).id, reason);
    return reply.send({ status: 'refunded' });
  });

  fastify.get('/api/v1/bazaar/transactions/me', {
    preHandler: [requireAuth()],
    schema: { tags: ['Transactions'], summary: 'My purchases' },
  }, async (req, reply) => {
    const result = await service.getMyPurchases(extractUser(req).id);
    return reply.send({ items: result });
  });

  fastify.get('/api/v1/bazaar/transactions/me/sales', {
    preHandler: [requireAuth()],
    schema: { tags: ['Transactions'], summary: 'My sales' },
  }, async (req, reply) => {
    const result = await service.getMySales(extractUser(req).id);
    return reply.send({ items: result });
  });

  fastify.get('/api/v1/bazaar/transactions/:id', {
    preHandler: [requireAuth()],
    schema: { tags: ['Transactions'], summary: 'Get transaction detail' },
  }, async (req, reply) => {
    const { id } = ListingParamsSchema.parse(req.params);
    const result = await service.getTransaction(id, extractUser(req).id);
    return reply.send(result);
  });
}
