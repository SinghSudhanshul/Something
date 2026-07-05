/**
 * NEXUS Bazaar — Listing Repository
 *
 * All database access for listings — no SQL outside this file for the listing domain.
 * All methods return typed results — no `any`.
 */

import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ListingRecord {
  id: string;
  seller_id: string;
  campus_id: string;
  title: string;
  description: string | null;
  category: string;
  condition: string;
  price: string;
  listing_type: string;
  status: string;
  images: string[];
  ai_suggested_price: string | null;
  is_promoted: boolean;
  promoted_until: Date | null;
  view_count: number;
  created_at: Date;
  expires_at: Date | null;
  updated_at: Date;
}

export interface ListingWithSeller extends ListingRecord {
  seller_name: string;
  seller_avatar_url: string | null;
  seller_trust_score: string;
  seller_trust_tier: string;
}

export interface CreateListingData {
  seller_id: string;
  campus_id: string;
  title: string;
  description: string;
  category: string;
  condition: string;
  price: number;
  listing_type: string;
  images: string[];
  tags?: string[];
}

export interface UpdateListingData {
  title?: string;
  description?: string;
  price?: number;
  category?: string;
  condition?: string;
  listing_type?: string;
  images?: string[];
  tags?: string[];
}

export interface ListingFilters {
  campus_id?: string;
  category?: string;
  condition?: string;
  listing_type?: string;
  min_price?: number;
  max_price?: number;
  status?: string;
  seller_id?: string;
}

export interface PaginationOptions {
  cursor?: string;
  limit: number;
  sort: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Repository
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class ListingRepository {
  constructor(private readonly fastify: FastifyInstance) {}

  private static esc(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }

  private get db() {
    return this.fastify.db;
  }

  async create(data: CreateListingData): Promise<ListingRecord> {
    const result = await this.db.execute(sql`
      INSERT INTO bazaar_listings (seller_id, campus_id, title, description, category, condition, price, listing_type, images)
      VALUES (${data.seller_id}, ${data.campus_id}, ${data.title}, ${data.description},
              ${data.category}, ${data.condition}, ${data.price}, ${data.listing_type},
              ${JSON.stringify(data.images)}::jsonb)
      RETURNING *
    `);
    return ((result as any).rows ?? result)[0] as unknown as ListingRecord;
  }

  async findById(id: string): Promise<ListingWithSeller | null> {
    const result = await this.db.execute(sql`
      SELECT
        l.*,
        u.name as seller_name,
        sp.avatar_url as seller_avatar_url,
        COALESCE(sp.trust_score, '3.00') as seller_trust_score,
        COALESCE(u.trust_tier, 'new') as seller_trust_tier
      FROM bazaar_listings l
      JOIN users u ON u.id = l.seller_id
      LEFT JOIN student_profiles sp ON sp.user_id = l.seller_id
      WHERE l.id = ${id}
    `);
    return (((result as any).rows ?? result)[0] as unknown as ListingWithSeller) ?? null;
  }

  async findMany(
    filters: ListingFilters,
    pagination: PaginationOptions,
  ): Promise<{ items: ListingRecord[]; total: number }> {
    const esc = ListingRepository.esc;
    const conditions: string[] = ['1=1'];

    if (filters.campus_id) conditions.push(`l.campus_id = ${esc(filters.campus_id)}`);
    if (filters.category) conditions.push(`l.category = ${esc(filters.category)}`);
    if (filters.condition) conditions.push(`l.condition = ${esc(filters.condition)}`);
    if (filters.listing_type) conditions.push(`l.listing_type = ${esc(filters.listing_type)}`);
    if (filters.min_price !== undefined) conditions.push(`l.price >= ${filters.min_price}`);
    if (filters.max_price !== undefined) conditions.push(`l.price <= ${filters.max_price}`);
    if (filters.status) conditions.push(`l.status = ${esc(filters.status)}`);
    else conditions.push(`l.status = 'active'`);
    if (filters.seller_id) conditions.push(`l.seller_id = ${esc(filters.seller_id)}`);

    if (pagination.cursor) {
      conditions.push(`l.created_at < ${esc(new Date(pagination.cursor).toISOString())}`);
    }

    const where = conditions.join(' AND ');

    let orderBy = 'l.created_at DESC';
    if (pagination.sort === 'price_asc') orderBy = 'l.price ASC';
    else if (pagination.sort === 'price_desc') orderBy = 'l.price DESC';

    const countResult = await this.db.execute(sql.raw(`SELECT COUNT(*) as total FROM bazaar_listings l WHERE ${where}`));
    const dataResult = await this.db.execute(sql.raw(`SELECT l.* FROM bazaar_listings l WHERE ${where} ORDER BY ${orderBy} LIMIT ${pagination.limit}`));

    const countRows = ((countResult as any).rows ?? countResult) as Record<string, unknown>[];
    const dataRows = ((dataResult as any).rows ?? dataResult) as Record<string, unknown>[];

    return {
      items: dataRows as unknown as ListingRecord[],
      total: Number((countRows[0] as Record<string, unknown>)?.total ?? 0),
    };
  }

  async update(id: string, data: UpdateListingData): Promise<ListingRecord | null> {
    const esc = ListingRepository.esc;
    const sets: string[] = ['updated_at = now()'];

    if (data.title !== undefined) sets.push(`title = ${esc(data.title)}`);
    if (data.description !== undefined) sets.push(`description = ${esc(data.description)}`);
    if (data.price !== undefined) sets.push(`price = ${data.price}`);
    if (data.category !== undefined) sets.push(`category = ${esc(data.category)}`);
    if (data.condition !== undefined) sets.push(`condition = ${esc(data.condition)}`);
    if (data.listing_type !== undefined) sets.push(`listing_type = ${esc(data.listing_type)}`);
    if (data.images !== undefined) sets.push(`images = ${esc(JSON.stringify(data.images))}::jsonb`);

    const result = await this.db.execute(sql.raw(`UPDATE bazaar_listings SET ${sets.join(', ')} WHERE id = ${esc(id)} RETURNING *`));
    const rows = ((result as any).rows ?? result) as Record<string, unknown>[];
    return (rows[0] as unknown as ListingRecord) ?? null;
  }

  async softDelete(id: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE bazaar_listings SET status = 'removed', updated_at = now() WHERE id = ${id}
    `);
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE bazaar_listings SET status = ${status}, updated_at = now() WHERE id = ${id}
    `);
  }

  async incrementViewCount(id: string): Promise<void> {
    // Atomic increment — no read-modify-write
    await this.db.execute(sql`
      UPDATE bazaar_listings SET view_count = view_count + 1 WHERE id = ${id}
    `);
  }

  async recordView(listingId: string, viewerId: string | null, ipHash: string): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO listing_views (listing_id, viewer_id, ip_hash)
      VALUES (${listingId}, ${viewerId}, ${ipHash})
    `);
  }

  async checkOwnership(listingId: string, userId: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT 1 FROM bazaar_listings WHERE id = ${listingId} AND seller_id = ${userId}
    `);
    return ((result as any).rows ?? result).length > 0;
  }

  async findBySellerAndStatus(sellerId: string, status: string): Promise<ListingRecord[]> {
    const result = await this.db.execute(sql`
      SELECT * FROM bazaar_listings
      WHERE seller_id = ${sellerId} AND status = ${status}
      ORDER BY created_at DESC
    `);
    return ((result as any).rows ?? result) as unknown as ListingRecord[];
  }

  // ━━━ Saves ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async saveListing(listingId: string, userId: string): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO listing_saves (listing_id, user_id)
      VALUES (${listingId}, ${userId})
      ON CONFLICT (listing_id, user_id) DO NOTHING
    `);
  }

  async unsaveListing(listingId: string, userId: string): Promise<void> {
    await this.db.execute(sql`
      DELETE FROM listing_saves WHERE listing_id = ${listingId} AND user_id = ${userId}
    `);
  }

  async findSavedByUser(userId: string, limit: number, cursor?: string): Promise<ListingRecord[]> {
    const cursorCondition = cursor ? sql`AND ls.created_at < ${new Date(cursor)}` : sql``;
    const result = await this.db.execute(sql`
      SELECT l.* FROM bazaar_listings l
      JOIN listing_saves ls ON ls.listing_id = l.id
      WHERE ls.user_id = ${userId} ${cursorCondition}
      ORDER BY ls.created_at DESC
      LIMIT ${limit}
    `);
    return ((result as any).rows ?? result) as unknown as ListingRecord[];
  }

  // ━━━ Offers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async createOffer(listingId: string, buyerId: string, amount: number, message?: string): Promise<Record<string, unknown>> {
    const result = await this.db.execute(sql`
      INSERT INTO listing_offers (listing_id, buyer_id, amount, message)
      VALUES (${listingId}, ${buyerId}, ${amount}, ${message ?? null})
      RETURNING *
    `);
    return ((result as any).rows ?? result)[0] as Record<string, unknown>;
  }

  async findOfferById(offerId: string): Promise<Record<string, unknown> | null> {
    const result = await this.db.execute(sql`
      SELECT * FROM listing_offers WHERE id = ${offerId}
    `);
    return (((result as any).rows ?? result)[0] as Record<string, unknown>) ?? null;
  }

  async findOffersByListing(listingId: string): Promise<Record<string, unknown>[]> {
    const result = await this.db.execute(sql`
      SELECT lo.*, u.name as buyer_name
      FROM listing_offers lo
      JOIN users u ON u.id = lo.buyer_id
      WHERE lo.listing_id = ${listingId}
      ORDER BY lo.created_at DESC
    `);
    return ((result as any).rows ?? result) as Record<string, unknown>[];
  }

  async updateOfferStatus(offerId: string, status: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE listing_offers SET status = ${status} WHERE id = ${offerId}
    `);
  }

  // ━━━ Bazaar Transactions ━━━━━━━━━━━━━━━━━━━━━━━━━

  async createBazaarTransaction(data: {
    transaction_id: string;
    listing_id: string;
    buyer_id: string;
    seller_id: string;
    final_price: number;
    platform_fee: number;
    seller_amount: number;
  }): Promise<Record<string, unknown>> {
    const result = await this.db.execute(sql`
      INSERT INTO bazaar_transactions (transaction_id, listing_id, buyer_id, seller_id, final_price, platform_fee, seller_amount)
      VALUES (${data.transaction_id}, ${data.listing_id}, ${data.buyer_id}, ${data.seller_id},
              ${data.final_price}, ${data.platform_fee}, ${data.seller_amount})
      RETURNING *
    `);
    return ((result as any).rows ?? result)[0] as Record<string, unknown>;
  }

  async findBazaarTransactionByTxnId(transactionId: string): Promise<Record<string, unknown> | null> {
    const result = await this.db.execute(sql`
      SELECT * FROM bazaar_transactions WHERE transaction_id = ${transactionId}
    `);
    return (((result as any).rows ?? result)[0] as Record<string, unknown>) ?? null;
  }

  async findTransactionsByBuyer(buyerId: string, limit: number): Promise<Record<string, unknown>[]> {
    const result = await this.db.execute(sql`
      SELECT bt.*, bl.title, bl.images, bl.price
      FROM bazaar_transactions bt
      JOIN bazaar_listings bl ON bl.id = bt.listing_id
      WHERE bt.buyer_id = ${buyerId}
      ORDER BY bt.created_at DESC
      LIMIT ${limit}
    `);
    return ((result as any).rows ?? result) as Record<string, unknown>[];
  }

  async findTransactionsBySeller(sellerId: string, limit: number): Promise<Record<string, unknown>[]> {
    const result = await this.db.execute(sql`
      SELECT bt.*, bl.title, bl.images, bl.price
      FROM bazaar_transactions bt
      JOIN bazaar_listings bl ON bl.id = bt.listing_id
      WHERE bt.seller_id = ${sellerId}
      ORDER BY bt.created_at DESC
      LIMIT ${limit}
    `);
    return ((result as any).rows ?? result) as Record<string, unknown>[];
  }

  async hasActiveTransaction(listingId: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT 1 FROM bazaar_transactions bt
      JOIN transactions t ON t.id = bt.transaction_id
      WHERE bt.listing_id = ${listingId}
      AND t.status IN ('payment_held', 'in_progress')
      LIMIT 1
    `);
    return ((result as any).rows ?? result).length > 0;
  }
}
