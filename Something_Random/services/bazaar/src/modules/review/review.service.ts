/**
 * NEXUS Bazaar — Review Service
 *
 * Handles review creation, retrieval, and score event emission.
 * Reviews can only be left after a confirmed transaction.
 */

import type { FastifyInstance } from 'fastify';
import { AppError, createLogger, createTrustClient } from '@nexus/utils';
import { KafkaTopics } from '@nexus/types';
import { publishEvent } from '@nexus/kafka';

import { ReviewRepository, type ReviewWithReviewer, type ReviewAggregate } from './review.repository.js';
import type { CreateReviewInput, ReviewQueryInput } from './review.schema.js';
import { REVIEW_AGGREGATE_TTL_SECONDS } from './review.schema.js';
import { config } from '../../config.js';

const logger = createLogger('bazaar:review-service');

interface RequestUser {
  id: string;
  campusId: string;
  verificationLevel: number;
  roles: string[];
}

export class ReviewService {
  private readonly repo: ReviewRepository;
  private readonly trustClient;

  constructor(private readonly fastify: FastifyInstance) {
    this.repo = new ReviewRepository(fastify);
    this.trustClient = createTrustClient(config.USER_SERVICE_URL ?? 'http://localhost:3002', config.INTERNAL_SERVICE_SECRET);
  }

  async createReview(user: RequestUser, data: CreateReviewInput) {
    // Verify the transaction exists and is completed
    const txn = await this.repo.findBazaarTransaction(data.transactionId);
    if (!txn) throw AppError.notFound('Transaction not found');
    if (txn.status !== 'completed') {
      throw AppError.badRequest('Reviews can only be left after a completed transaction');
    }

    // Only buyer or seller can leave a review
    if (txn.buyer_id !== user.id && txn.seller_id !== user.id) {
      throw AppError.forbidden('Only transaction parties can leave a review');
    }

    // The reviewee must be the other party
    const expectedReviewee = txn.buyer_id === user.id ? txn.seller_id : txn.buyer_id;
    if (data.revieweeId !== expectedReviewee) {
      throw AppError.badRequest('You can only review the other party in the transaction');
    }

    // Prevent duplicate reviews
    const existing = await this.repo.findByTransactionAndReviewer(data.transactionId, user.id);
    if (existing) {
      throw AppError.conflict('You have already reviewed this transaction');
    }

    const review = await this.repo.create({
      transaction_id: data.transactionId,
      listing_id: txn.listing_id,
      reviewer_id: user.id,
      reviewee_id: data.revieweeId,
      campus_id: user.campusId,
      rating: data.rating,
      title: data.title,
      comment: data.comment,
      tags: data.tags,
      is_anonymous: data.is_anonymous,
    } as any);

    // Invalidate aggregate cache
    await this.fastify.redis.del(`reviews:aggregate:${data.revieweeId}`);

    // Emit score event to trust service
    this.trustClient
      .recordTrustEvents([
        {
          userId: data.revieweeId,
          eventType: 'review_received',
          referenceId: review.id,
          referenceType: 'review',
          metadata: { rating: data.rating, module: 'bazaar' },
        },
      ])
      .catch((e) => logger.error({ err: e }, 'Failed to record trust event'));

    // Publish Kafka event
    this.publishEvent(KafkaTopics.REVIEW_CREATED, {
      id: review.id,
      transaction_id: review.transaction_id,
      listing_id: review.listing_id,
      reviewer_id: review.reviewer_id,
      reviewee_id: review.reviewee_id,
      rating: review.rating,
      is_anonymous: review.is_anonymous,
      created_at: review.created_at,
    }).catch(() => {});

    logger.info(
      { reviewId: review.id, transactionId: data.transactionId, rating: data.rating },
      'Review created',
    );
    return review;
  }

  async getUserReviews(query: ReviewQueryInput): Promise<{
    items: ReviewWithReviewer[];
    next_cursor: string | null;
  }> {
    if (!query.reviewee_id && !query.listing_id) {
      throw AppError.badRequest('Either reviewee_id or listing_id is required');
    }
    const cursor = query.cursor ? parseInt(query.cursor, 10) : 0;
    const items = query.listing_id
      ? await this.repo.findByListing(query.listing_id, query.limit, query.cursor)
      : await this.repo.findByReviewee(query.reviewee_id!, query.limit, query.cursor);
    const next_cursor = items.length === query.limit ? String(cursor + items.length) : null;
    return { items, next_cursor };
  }

  async getAggregate(userId: string): Promise<ReviewAggregate> {
    const cacheKey = `reviews:aggregate:${userId}`;
    const cached = await this.fastify.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as ReviewAggregate;
      } catch {
        // fall through to DB
      }
    }
    const aggregate = await this.repo.getAggregate(userId);
    const result = aggregate ?? {
      user_id: userId,
      total_reviews: 0,
      average_rating: '0.00',
      rating_1_count: 0,
      rating_2_count: 0,
      rating_3_count: 0,
      rating_4_count: 0,
      rating_5_count: 0,
      updated_at: new Date(),
    };
    await this.fastify.redis.setex(
      cacheKey,
      REVIEW_AGGREGATE_TTL_SECONDS,
      JSON.stringify(result),
    );
    return result;
  }

  private async publishEvent(topic: string, data: unknown) {
    const producer = this.fastify.kafka?.producer;
    if (producer) await publishEvent(producer, topic as import('@nexus/types').KafkaTopic, data);
  }
}
