/**
 * NEXUS Bazaar — Listing Service
 *
 * Business logic layer. Orchestrates repository, Elasticsearch, S3,
 * Rekognition, Redis cache, and Kafka.
 */

import { randomUUID, createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { AppError, createLogger, createWalletClient, createTrustClient } from '@nexus/utils';
import { KafkaTopics } from '@nexus/types';
import { publishEvent } from '@nexus/kafka';

import { ListingRepository, type ListingRecord, type ListingWithSeller } from './listing.repository.js';
import type { CreateListingInput, UpdateListingInput, ListingQueryInput } from './listing.schema.js';
import { LISTINGS_INDEX } from '../../plugins/elasticsearch.plugin.js';
import { config } from '../../config.js';

const logger = createLogger('bazaar:listing-service');

interface RequestUser {
  id: string;
  campusId: string;
  verificationLevel: number;
  roles: string[];
}

function buildMediaUrl(key: string): string {
  return `https://${config.AWS_CLOUDFRONT_DOMAIN}/${key}`;
}

function attachMediaUrls<T extends { images: unknown }>(listing: T): T {
  const images = listing.images as string[];
  return { ...listing, images: images.map((k: string) => k.startsWith('http') ? k : buildMediaUrl(k)) };
}

export class ListingService {
  private readonly repo: ListingRepository;
  private readonly walletClient;
  private readonly trustClient;

  constructor(private readonly fastify: FastifyInstance) {
    this.repo = new ListingRepository(fastify);
    this.walletClient = createWalletClient(config.WALLET_SERVICE_URL, config.INTERNAL_SERVICE_SECRET);
    this.trustClient = createTrustClient(config.USER_SERVICE_URL, config.INTERNAL_SERVICE_SECRET);
  }

  async createListing(user: RequestUser, data: CreateListingInput): Promise<ListingWithSeller> {
    if (data.images && data.images.length > 8) throw AppError.badRequest('Maximum 8 images allowed');
    const listing = await this.repo.create({
      seller_id: user.id, campus_id: user.campusId, title: data.title,
      description: data.description, category: data.category, condition: data.condition,
      price: data.price, listing_type: data.listing_type, images: data.images ?? [],
    });
    this.indexToES(listing).catch((e) => logger.error({ err: e }, 'ES index failed'));
    this.publishEvent(KafkaTopics.LISTING_CREATED, listing).catch(() => {});
    const full = await this.repo.findById(listing.id);
    return attachMediaUrls(full!);
  }

  async updateListing(listingId: string, user: RequestUser, data: UpdateListingInput): Promise<ListingWithSeller> {
    const isAdmin = user.roles.includes('campus_admin') || user.roles.includes('super_admin');
    if (!isAdmin && !(await this.repo.checkOwnership(listingId, user.id)))
      throw AppError.forbidden('You can only update your own listings');
    if (data.images) {
      const existing = await this.repo.findById(listingId);
      if (existing) for (const k of (existing.images as string[]) ?? [])
        if (!k.startsWith('http')) await this.fastify.redis.rpush('bazaar:s3:delete_queue', JSON.stringify({ key: k, retries: 0 }));
    }
    const updated = await this.repo.update(listingId, { ...data } as any);
    if (!updated) throw AppError.notFound('Listing not found');
    this.indexToES(updated).catch(() => {});
    await Promise.all([this.fastify.redis.del(`listing:${listingId}`), this.fastify.redis.del(`user:${updated.seller_id}:listings`)]);
    this.publishEvent(KafkaTopics.LISTING_UPDATED, updated).catch(() => {});
    return attachMediaUrls((await this.repo.findById(listingId))!);
  }

  async deleteListing(listingId: string, user: RequestUser): Promise<void> {
    const isAdmin = user.roles.includes('campus_admin') || user.roles.includes('super_admin');
    if (!isAdmin && !(await this.repo.checkOwnership(listingId, user.id)))
      throw AppError.forbidden('You can only delete your own listings');
    if (await this.repo.hasActiveTransaction(listingId))
      throw AppError.conflict('Cannot delete listing with an active transaction');
    await this.repo.softDelete(listingId);
    try { await this.fastify.es.delete({ index: LISTINGS_INDEX, id: listingId }); } catch {}
    await this.fastify.redis.del(`listing:${listingId}`);
    this.publishEvent(KafkaTopics.LISTING_DELETED, { id: listingId } as ListingRecord).catch(() => {});
  }

  async getListing(listingId: string, viewerUserId?: string): Promise<ListingWithSeller> {
    const cached = await this.fastify.redis.get(`listing:${listingId}`);
    if (cached) {
      if (viewerUserId) { this.repo.incrementViewCount(listingId).catch(() => {}); this.repo.recordView(listingId, viewerUserId, createHash('sha256').update(viewerUserId).digest('hex').slice(0,16)).catch(() => {}); }
      return attachMediaUrls(JSON.parse(cached) as ListingWithSeller);
    }
    const listing = await this.repo.findById(listingId);
    if (!listing) throw AppError.notFound('Listing not found');
    await this.fastify.redis.setex(`listing:${listingId}`, 300, JSON.stringify(listing));
    if (viewerUserId) { this.repo.incrementViewCount(listingId).catch(() => {}); }
    return attachMediaUrls(listing);
  }

  async searchListings(query: ListingQueryInput, user: RequestUser) {
    const campusId = user.roles.includes('super_admin') ? query.campus_id : user.campusId;
    try { return await this.searchES(query, campusId); }
    catch { return await this.searchPG(query, campusId); }
  }

  private async searchES(query: ListingQueryInput, campusId?: string) {
    const must: Record<string,unknown>[] = [];
    const filter: Record<string,unknown>[] = [{ term: { status: 'active' } }];
    if (query.q) must.push({ multi_match: { query: query.q, fields: ['title^3','description'], fuzziness: 'AUTO' } });
    if (campusId) filter.push({ term: { campus_id: campusId } });
    if (query.category) filter.push({ term: { category: query.category } });
    if (query.condition) filter.push({ term: { condition: query.condition } });
    if (query.min_price !== undefined || query.max_price !== undefined) {
      const r: Record<string,number> = {};
      if (query.min_price !== undefined) r.gte = query.min_price;
      if (query.max_price !== undefined) r.lte = query.max_price;
      filter.push({ range: { price: r } });
    }
    const sortMap: Record<string,unknown[]> = { relevance: query.q ? [{_score:'desc'}] : [{created_at:'desc'}], created_at: [{created_at:'desc'}], price_asc: [{price:'asc'}], price_desc: [{price:'desc'}] };
    const from = query.cursor ? parseInt(query.cursor, 10) : 0;
    const result = await this.fastify.es.search({ index: LISTINGS_INDEX, body: { query: { bool: { must: must.length ? must : [{match_all:{}}], filter } }, sort: (sortMap[query.sort] ?? sortMap.created_at) as any, from, size: query.limit } });
    const hits = result.hits.hits;
    const total = typeof result.hits.total === 'number' ? result.hits.total : (result.hits.total as {value:number}).value;
    return { items: hits.map(h => attachMediaUrls(h._source as ListingWithSeller)), total, cursor: from + hits.length < total ? String(from + hits.length) : null };
  }

  private async searchPG(query: ListingQueryInput, campusId?: string) {
    const result = await this.repo.findMany(
      { campus_id: campusId, category: query.category, condition: query.condition, listing_type: query.listing_type, min_price: query.min_price, max_price: query.max_price, status: 'active' } as any,
      { ...(query.cursor !== undefined && { cursor: query.cursor }), limit: query.limit, sort: query.sort } as any,
    );
    const items = result.items.map(i => attachMediaUrls(i as unknown as ListingWithSeller));
    const last = result.items[result.items.length - 1];
    return { items, total: result.total, cursor: result.items.length === query.limit && last ? new Date(last.created_at).toISOString() : null };
  }

  async getMyActiveListings(userId: string) { return (await this.repo.findBySellerAndStatus(userId, 'active')).map(l => attachMediaUrls(l)); }
  async getMySoldListings(userId: string) { return (await this.repo.findBySellerAndStatus(userId, 'sold')).map(l => attachMediaUrls(l)); }
  async getMySavedListings(userId: string, limit = 20, cursor?: string) { return (await this.repo.findSavedByUser(userId, limit, cursor)).map(l => attachMediaUrls(l)); }

  async saveListing(listingId: string, userId: string) { await this.repo.saveListing(listingId, userId); }
  async unsaveListing(listingId: string, userId: string) { await this.repo.unsaveListing(listingId, userId); }

  async createOffer(listingId: string, buyerId: string, amount: number, message?: string) {
    const listing = await this.repo.findById(listingId);
    if (!listing) throw AppError.notFound('Listing not found');
    if (listing.status !== 'active') throw AppError.conflict('Listing is not active');
    if (listing.seller_id === buyerId) throw AppError.badRequest('Cannot make an offer on your own listing');
    return this.repo.createOffer(listingId, buyerId, amount, message);
  }

  async getOffersForListing(listingId: string, userId: string) {
    if (!(await this.repo.checkOwnership(listingId, userId))) throw AppError.forbidden('Only the seller can view offers');
    return this.repo.findOffersByListing(listingId);
  }

  async respondToOffer(listingId: string, offerId: string, userId: string, action: string) {
    if (!(await this.repo.checkOwnership(listingId, userId))) throw AppError.forbidden('Only the seller can respond');
    const offer = await this.repo.findOfferById(offerId);
    if (!offer) throw AppError.notFound('Offer not found');
    if (offer.status !== 'pending') throw AppError.conflict('Offer is no longer pending');
    await this.repo.updateOfferStatus(offerId, action);
  }

  async initiatePurchase(buyerId: string, listingId: string, offerId?: string) {
    const listing = await this.repo.findById(listingId);
    if (!listing) throw AppError.notFound('Listing not found');
    if (listing.status !== 'active') throw AppError.conflict('Listing is not available');
    if (listing.seller_id === buyerId) throw AppError.badRequest('Cannot purchase your own listing');
    let finalPrice = Number(listing.price);
    if (offerId) {
      const offer = await this.repo.findOfferById(offerId);
      if (!offer) throw AppError.notFound('Offer not found');
      if (offer.status !== 'accepted') throw AppError.badRequest('Offer not accepted');
      finalPrice = Number(offer.amount);
    }
    const platformFee = Math.round(finalPrice * 0.05 * 100) / 100;
    const sellerAmount = Math.round((finalPrice - platformFee) * 100) / 100;
    const txn = await this.walletClient.createTransaction({ buyerId, sellerId: listing.seller_id, amount: String(finalPrice), module: 'bazaar', referenceId: listingId, referenceType: 'listing', description: `Purchase: ${listing.title}` });
    try { await this.walletClient.initiateEscrow(txn.transactionId); }
    catch (e) { logger.error({ err: e }, 'Escrow failed'); throw e; }
    await this.repo.updateStatus(listingId, 'reserved');
    await this.repo.createBazaarTransaction({ transaction_id: txn.transactionId, listing_id: listingId, buyer_id: buyerId, seller_id: listing.seller_id, final_price: finalPrice, platform_fee: platformFee, seller_amount: sellerAmount });
    await this.fastify.redis.del(`listing:${listingId}`);
    return { transactionId: txn.transactionId, message: 'Payment held. Complete the handover to release funds.' };
  }

  async confirmDelivery(transactionId: string, buyerId: string) {
    const bt = await this.repo.findBazaarTransactionByTxnId(transactionId);
    if (!bt) throw AppError.notFound('Transaction not found');
    if (bt.buyer_id !== buyerId) throw AppError.forbidden('Only the buyer can confirm delivery');
    await this.walletClient.releaseEscrow(transactionId);
    await this.repo.updateStatus(bt.listing_id as string, 'sold');
    this.trustClient.recordTrustEvents([
      { userId: buyerId, eventType: 'transaction_completed', referenceId: transactionId, referenceType: 'bazaar_transaction' },
      { userId: bt.seller_id as string, eventType: 'listing_sold', referenceId: transactionId, referenceType: 'bazaar_transaction' },
      { userId: bt.seller_id as string, eventType: 'transaction_completed', referenceId: transactionId, referenceType: 'bazaar_transaction' },
    ]).catch(() => {});
    await this.fastify.redis.del(`listing:${bt.listing_id}`);
  }

  async cancelTransaction(transactionId: string, requesterId: string, _reason: string) {
    const bt = await this.repo.findBazaarTransactionByTxnId(transactionId);
    if (!bt) throw AppError.notFound('Transaction not found');
    const isBuyer = bt.buyer_id === requesterId;
    const isSeller = bt.seller_id === requesterId;
    if (!isBuyer && !isSeller) throw AppError.forbidden('Only buyer or seller can cancel');
    if (isBuyer) {
      const created = new Date(bt.created_at as string);
      if (created < new Date(Date.now() - 3600000)) throw AppError.forbidden('Cancellation window expired (1hr)');
    }
    await this.walletClient.refundEscrow(transactionId);
    await this.repo.updateStatus(bt.listing_id as string, 'active');
    await this.fastify.redis.del(`listing:${bt.listing_id}`);
  }

  async getMyPurchases(buyerId: string, limit = 20) { return this.repo.findTransactionsByBuyer(buyerId, limit); }
  async getMySales(sellerId: string, limit = 20) { return this.repo.findTransactionsBySeller(sellerId, limit); }
  async getTransaction(txnId: string, userId: string) {
    const t = await this.repo.findBazaarTransactionByTxnId(txnId);
    if (!t) throw AppError.notFound('Transaction not found');
    if (t.buyer_id !== userId && t.seller_id !== userId) throw AppError.forbidden('Not a party');
    return t;
  }

  private async indexToES(listing: ListingRecord) {
    await this.fastify.es.index({ index: LISTINGS_INDEX, id: listing.id, body: { id: listing.id, campus_id: listing.campus_id, seller_id: listing.seller_id, title: listing.title, description: listing.description, category: listing.category, condition: listing.condition, listing_type: listing.listing_type, status: listing.status, price: Number(listing.price), images: listing.images, is_promoted: listing.is_promoted, view_count: listing.view_count, created_at: listing.created_at, expires_at: listing.expires_at, updated_at: listing.updated_at } });
  }

  private async publishEvent(topic: string, data: unknown) {
    const producer = this.fastify.kafka?.producer;
    if (producer) await publishEvent(producer, topic as import('@nexus/types').KafkaTopic, data);
  }
}
