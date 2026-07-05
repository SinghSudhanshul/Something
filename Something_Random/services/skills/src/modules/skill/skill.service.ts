/**
 * NEXUS Skills — Skill Service
 *
 * Gig economy: list skills, order, deliver, review, auto-release.
 */

import type { FastifyInstance } from 'fastify';
import { AppError, createLogger, createWalletClient, createTrustClient } from '@nexus/utils';
import { KafkaTopics } from '@nexus/types';
import { publishEvent } from '@nexus/kafka';
import { SkillRepository, type SkillListingRecord, type SkillOrderRecord } from './skill.repository.js';

const logger = createLogger('skills:skill-service');

export class SkillService {
  private readonly repo: SkillRepository;
  private readonly walletClient;
  private readonly trustClient;

  constructor(private readonly fastify: FastifyInstance) {
    this.repo = new SkillRepository(fastify);
    const secret = process.env['INTERNAL_SERVICE_SECRET'] ?? '';
    this.walletClient = createWalletClient(process.env['WALLET_SERVICE_URL'], secret);
    this.trustClient = createTrustClient(process.env['USER_SERVICE_URL'], secret);
  }

  async createListing(providerId: string, campusId: string, data: {
    title: string; description: string; category: string;
    packages: { id: string; name: string; description: string; price: number; deliverable: string; delivery_days: number }[];
    portfolio_urls?: string[]; tags?: string[];
  }): Promise<SkillListingRecord> {
    if (!data.packages || data.packages.length === 0) throw AppError.badRequest('At least 1 package required');
    if (data.packages.length > 3) throw AppError.badRequest('Maximum 3 packages allowed');
    for (const pkg of data.packages) { if (pkg.price <= 0) throw AppError.badRequest('Package price must be greater than 0'); }
    if (data.portfolio_urls && data.portfolio_urls.length > 5) throw AppError.badRequest('Maximum 5 portfolio URLs');

    return this.repo.createListing({ 
      provider_id: providerId, 
      campus_id: campusId, 
      title: data.title, 
      description: data.description, 
      category: data.category, 
      packages: data.packages, 
      ...(data.portfolio_urls !== undefined && { portfolio_urls: data.portfolio_urls }), 
      ...(data.tags !== undefined && { tags: data.tags }) 
    });
  }

  async placeOrder(buyerId: string, listingId: string, packageId: string, requirements: string): Promise<SkillOrderRecord> {
    const listing = await this.repo.findListingById(listingId);
    if (!listing) throw AppError.notFound('Listing not found');
    if (listing.status !== 'active') throw AppError.conflict('Listing is not active');
    if (listing.provider_id === buyerId) throw AppError.badRequest('Cannot order your own service');

    const pkg = listing.packages.find(p => p.id === packageId);
    if (!pkg) throw AppError.notFound('Package not found');

    // Snapshot at order time
    const packageSnapshot = { ...pkg };
    const deadlineAt = new Date(Date.now() + pkg.delivery_days * 86400_000);

    // Escrow
    const txn = await this.walletClient.createTransaction({ buyerId, sellerId: listing.provider_id, amount: String(pkg.price), module: 'skills', referenceId: listingId, referenceType: 'skill_order', description: `Skill order: ${listing.title} - ${pkg.name}` });
    await this.walletClient.initiateEscrow(txn.transactionId);

    const order = await this.repo.createOrder({ listing_id: listingId, buyer_id: buyerId, provider_id: listing.provider_id, transaction_id: txn.transactionId, package_snapshot: packageSnapshot, requirements, deadline_at: deadlineAt });
    await this.repo.updateOrder(order.id, { status: 'payment_held' });
    await this.repo.incrementTotalOrders(listingId);

    const producer = this.fastify.kafka?.producer;
    if (producer) publishEvent(producer, KafkaTopics.SKILL_ORDER_PLACED, { orderId: order.id, listingId, buyerId }).catch(() => {});

    return order;
  }

  async submitDelivery(orderId: string, providerId: string, proofUrl: string): Promise<void> {
    const order = await this.repo.findOrderById(orderId);
    if (!order) throw AppError.notFound('Order not found');
    if (order.provider_id !== providerId) throw AppError.forbidden('Only the provider can submit delivery');
    if (order.status !== 'in_progress' && order.status !== 'payment_held') throw AppError.conflict('Order cannot accept delivery in current state');

    await this.repo.updateOrder(orderId, { status: 'pending_review', delivery_proof_url: proofUrl });

    const producer = this.fastify.kafka?.producer;
    if (producer) publishEvent(producer, KafkaTopics.SKILL_DELIVERY_SUBMITTED, { orderId, providerId }).catch(() => {});
  }

  async approveDelivery(orderId: string, buyerId: string): Promise<void> {
    const order = await this.repo.findOrderById(orderId);
    if (!order) throw AppError.notFound('Order not found');
    if (order.buyer_id !== buyerId) throw AppError.forbidden('Only the buyer can approve');
    if (order.status !== 'pending_review') throw AppError.conflict('Order is not pending review');

    if (order.transaction_id) await this.walletClient.releaseEscrow(order.transaction_id);
    await this.repo.updateOrder(orderId, { status: 'completed' });

    this.trustClient.recordTrustEvents([
      { userId: order.provider_id, eventType: 'gig_completed', referenceId: orderId, referenceType: 'skill_order' },
      { userId: buyerId, eventType: 'transaction_completed', referenceId: orderId, referenceType: 'skill_order' },
    ]).catch(() => {});

    const producer = this.fastify.kafka?.producer;
    if (producer) publishEvent(producer, KafkaTopics.SKILL_ORDER_COMPLETED, { orderId }).catch(() => {});
  }

  async requestRevision(orderId: string, buyerId: string, feedback: string): Promise<void> {
    const order = await this.repo.findOrderById(orderId);
    if (!order) throw AppError.notFound('Order not found');
    if (order.buyer_id !== buyerId) throw AppError.forbidden('Only the buyer can request revision');
    if (order.status !== 'pending_review') throw AppError.conflict('Order is not pending review');
    if (order.revision_count >= order.max_revisions) throw new AppError(422, 'MAX_REVISIONS', 'Maximum revisions reached. Approve or raise a dispute.');

    await this.repo.updateOrder(orderId, { status: 'revision_requested', revision_count: order.revision_count + 1 });

    const producer = this.fastify.kafka?.producer;
    if (producer) publishEvent(producer, KafkaTopics.SKILL_REVISION_REQUESTED, { orderId, feedback }).catch(() => {});
  }

  async autoReleaseEscrow(): Promise<number> {
    const orders = await this.repo.findPendingAutoRelease();
    let count = 0;
    for (const order of orders) {
      try {
        if (order.transaction_id) await this.walletClient.releaseEscrow(order.transaction_id);
        await this.repo.updateOrder(order.id, { status: 'completed' });
        this.trustClient.recordTrustEvents([
          { userId: order.provider_id, eventType: 'gig_completed', referenceId: order.id, referenceType: 'skill_order' },
        ]).catch(() => {});
        logger.info({ orderId: order.id }, 'Auto-released escrow after 72hr buyer inactivity');
        count++;
      } catch (err) { logger.error({ err, orderId: order.id }, 'Auto-release failed'); }
    }
    return count;
  }

  async getListings(campusId: string) { return this.repo.findListingsByCampus(campusId); }
  async getListing(id: string) { const l = await this.repo.findListingById(id); if (!l) throw AppError.notFound('Listing not found'); return l; }
  async getMyBuyingOrders(buyerId: string) { return this.repo.findOrdersByBuyer(buyerId); }
  async getMyProvidingOrders(providerId: string) { return this.repo.findOrdersByProvider(providerId); }
  async getOrder(orderId: string, userId: string) {
    const o = await this.repo.findOrderById(orderId);
    if (!o) throw AppError.notFound('Order not found');
    if (o.buyer_id !== userId && o.provider_id !== userId) throw AppError.forbidden('Not authorized');
    return o;
  }
  async rateOrder(orderId: string, raterId: string, score: number, reviewText?: string) {
    const o = await this.repo.findOrderById(orderId);
    if (!o) throw AppError.notFound('Order not found');
    if (o.buyer_id !== raterId) throw AppError.forbidden('Only the buyer can rate');
    if (o.status !== 'completed') throw AppError.badRequest('Order must be completed');
    await this.repo.createRating(orderId, raterId, o.provider_id, score, reviewText);
  }
}
