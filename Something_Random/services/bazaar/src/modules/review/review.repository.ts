/**
 * NEXUS Bazaar — Review Repository
 *
 * All database access for reviews and rating aggregations.
 */

import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

export interface ReviewRecord {
  id: string;
  transaction_id: string;
  listing_id: string | null;
  reviewer_id: string;
  reviewee_id: string;
  campus_id: string;
  rating: number;
  title: string | null;
  comment: string | null;
  tags: string[];
  is_anonymous: boolean;
  created_at: Date;
}

export interface ReviewWithReviewer extends ReviewRecord {
  reviewer_name: string;
  reviewer_avatar_url: string | null;
}

export interface ReviewAggregate {
  user_id: string;
  total_reviews: number;
  average_rating: string;
  rating_1_count: number;
  rating_2_count: number;
  rating_3_count: number;
  rating_4_count: number;
  rating_5_count: number;
  updated_at: Date;
}

export interface CreateReviewData {
  transaction_id: string;
  listing_id: string | null;
  reviewer_id: string;
  reviewee_id: string;
  campus_id: string;
  rating: number;
  title?: string;
  comment?: string;
  tags: string[];
  is_anonymous: boolean;
}

export class ReviewRepository {
  constructor(private readonly fastify: FastifyInstance) {}

  async create(data: CreateReviewData): Promise<ReviewRecord> {
    const result = await this.fastify.db.execute(sql`
      INSERT INTO ratings (
        transaction_id, reviewer_id, reviewee_id,
        rating, review_text, tags, is_anonymous, created_at
      ) VALUES (
        ${data.transaction_id}, ${data.reviewer_id}, ${data.reviewee_id},
        ${data.rating}, ${data.comment ?? null}, ${data.tags}::text[], ${data.is_anonymous}, NOW()
      )
      RETURNING id, transaction_id, reviewer_id, reviewee_id, rating, review_text,
                tags, is_anonymous, created_at
    `);
    const row = (result as any).rows?.[0] ?? (Array.isArray(result) ? result[0] : result);
    return {
      id: row.id,
      transaction_id: row.transaction_id,
      listing_id: data.listing_id,
      reviewer_id: row.reviewer_id,
      reviewee_id: row.reviewee_id,
      campus_id: data.campus_id,
      rating: row.rating,
      title: data.title ?? null,
      comment: row.review_text,
      tags: row.tags ?? [],
      is_anonymous: row.is_anonymous,
      created_at: row.created_at,
    };
  }

  async findByTransactionAndReviewer(transactionId: string, reviewerId: string): Promise<ReviewRecord | null> {
    const result = await this.fastify.db.execute(sql`
      SELECT id, transaction_id, reviewer_id, reviewee_id, rating, review_text,
             tags, is_anonymous, created_at
      FROM ratings
      WHERE transaction_id = ${transactionId} AND reviewer_id = ${reviewerId}
      LIMIT 1
    `);
    const rows = (result as any).rows ?? result;
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      transaction_id: r.transaction_id,
      listing_id: null,
      reviewer_id: r.reviewer_id,
      reviewee_id: r.reviewee_id,
      campus_id: '',
      rating: r.rating,
      title: null,
      comment: r.review_text,
      tags: r.tags ?? [],
      is_anonymous: r.is_anonymous,
      created_at: r.created_at,
    };
  }

  async findByReviewee(revieweeId: string, limit: number, cursor?: string): Promise<ReviewWithReviewer[]> {
    const offset = cursor ? parseInt(cursor, 10) : 0;
    const result = await this.fastify.db.execute(sql`
      SELECT r.id, r.transaction_id, r.reviewer_id, r.reviewee_id, r.rating,
             r.review_text, r.tags, r.is_anonymous, r.created_at,
             u.full_name as reviewer_name, u.avatar_url as reviewer_avatar_url
      FROM ratings r
      JOIN users u ON u.id = r.reviewer_id
      WHERE r.reviewee_id = ${revieweeId}
      ORDER BY r.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    const rows = (result as any).rows ?? result;
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      transaction_id: r.transaction_id,
      listing_id: null,
      reviewer_id: r.reviewer_id,
      reviewee_id: r.reviewee_id,
      campus_id: '',
      rating: r.rating,
      title: null,
      comment: r.review_text,
      tags: r.tags ?? [],
      is_anonymous: r.is_anonymous,
      created_at: r.created_at,
      reviewer_name: r.is_anonymous ? 'Anonymous' : r.reviewer_name,
      reviewer_avatar_url: r.is_anonymous ? null : r.reviewer_avatar_url,
    }));
  }

  async findByListing(listingId: string, limit: number, cursor?: string): Promise<ReviewWithReviewer[]> {
    const offset = cursor ? parseInt(cursor, 10) : 0;
    const result = await this.fastify.db.execute(sql`
      SELECT r.id, r.transaction_id, r.reviewer_id, r.reviewee_id, r.rating,
             r.review_text, r.tags, r.is_anonymous, r.created_at,
             u.full_name as reviewer_name, u.avatar_url as reviewer_avatar_url
      FROM ratings r
      JOIN users u ON u.id = r.reviewer_id
      JOIN transactions t ON t.id = r.transaction_id
      WHERE t.listing_id = ${listingId}
      ORDER BY r.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    const rows = (result as any).rows ?? result;
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      transaction_id: r.transaction_id,
      listing_id: listingId,
      reviewer_id: r.reviewer_id,
      reviewee_id: r.reviewee_id,
      campus_id: '',
      rating: r.rating,
      title: null,
      comment: r.review_text,
      tags: r.tags ?? [],
      is_anonymous: r.is_anonymous,
      created_at: r.created_at,
      reviewer_name: r.is_anonymous ? 'Anonymous' : r.reviewer_name,
      reviewer_avatar_url: r.is_anonymous ? null : r.reviewer_avatar_url,
    }));
  }

  async getAggregate(revieweeId: string): Promise<ReviewAggregate | null> {
    const result = await this.fastify.db.execute(sql`
      SELECT
        ${revieweeId}::uuid as user_id,
        COUNT(*)::int as total_reviews,
        COALESCE(AVG(rating), 0)::numeric(3,2) as average_rating,
        COUNT(*) FILTER (WHERE rating = 1)::int as rating_1_count,
        COUNT(*) FILTER (WHERE rating = 2)::int as rating_2_count,
        COUNT(*) FILTER (WHERE rating = 3)::int as rating_3_count,
        COUNT(*) FILTER (WHERE rating = 4)::int as rating_4_count,
        COUNT(*) FILTER (WHERE rating = 5)::int as rating_5_count,
        NOW() as updated_at
      FROM ratings
      WHERE reviewee_id = ${revieweeId}
    `);
    const rows = (result as any).rows ?? result;
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    return {
      user_id: r.user_id,
      total_reviews: Number(r.total_reviews),
      average_rating: r.average_rating,
      rating_1_count: Number(r.rating_1_count),
      rating_2_count: Number(r.rating_2_count),
      rating_3_count: Number(r.rating_3_count),
      rating_4_count: Number(r.rating_4_count),
      rating_5_count: Number(r.rating_5_count),
      updated_at: r.updated_at,
    };
  }

  async findBazaarTransaction(transactionId: string): Promise<any> {
    const result = await this.fastify.db.execute(sql`
      SELECT bt.id, bt.transaction_id, bt.listing_id, bt.buyer_id, bt.seller_id,
             bt.final_price, bt.platform_fee, bt.seller_amount, t.status, t.completed_at
      FROM bazaar_transactions bt
      JOIN transactions t ON t.id = bt.transaction_id
      WHERE bt.transaction_id = ${transactionId}
      LIMIT 1
    `);
    const rows = (result as any).rows ?? result;
    return rows && rows.length > 0 ? rows[0] : null;
  }
}
