/**
 * NEXUS Bazaar — Review Service Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppError } from '@nexus/utils';
import { ReviewService } from '../review.service.js';
import { ReviewRepository } from '../review.repository.js';

vi.mock('../review.repository.js', () => {
  return {
    ReviewRepository: vi.fn().mockImplementation(() => ({
      findBazaarTransaction: vi.fn(),
      findByTransactionAndReviewer: vi.fn(),
      create: vi.fn(),
      getAggregate: vi.fn(),
      findByReviewee: vi.fn(),
      findByListing: vi.fn(),
    })),
  };
});

const buildFastify = (overrides: Record<string, any> = {}) => {
  return {
    redis: {
      get: vi.fn().mockResolvedValue(null),
      setex: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    },
    kafka: undefined,
    ...overrides,
  } as any;
};

const user = { id: 'user-1', campusId: 'campus-1', verificationLevel: 2, roles: ['student'] };

describe('ReviewService', () => {
  let service: ReviewService;
  let fastify: any;
  let repo: any;

  beforeEach(() => {
    fastify = buildFastify();
    service = new ReviewService(fastify);
    repo = (service as any).repo;
  });

  describe('createReview', () => {
    it('creates a review when transaction is completed and reviewee is the other party', async () => {
      const txn = {
        transaction_id: 't-1',
        listing_id: 'l-1',
        buyer_id: 'user-1',
        seller_id: 'user-2',
        status: 'completed',
      };
      repo.findBazaarTransaction.mockResolvedValue(txn);
      repo.findByTransactionAndReviewer.mockResolvedValue(null);
      repo.create.mockResolvedValue({
        id: 'r-1',
        transaction_id: 't-1',
        reviewee_id: 'user-2',
        rating: 5,
      });

      const result = await service.createReview(user, {
        transactionId: 't-1',
        revieweeId: 'user-2',
        rating: 5,
        tags: ['as_described'],
        is_anonymous: false,
      });
      expect(result.id).toBe('r-1');
      expect(repo.create).toHaveBeenCalled();
    });

    it('rejects when transaction is not completed', async () => {
      repo.findBazaarTransaction.mockResolvedValue({
        transaction_id: 't-1',
        buyer_id: 'user-1',
        seller_id: 'user-2',
        status: 'in_progress',
      });
      await expect(
        service.createReview(user, {
          transactionId: 't-1',
          revieweeId: 'user-2',
          rating: 5,
          tags: [],
          is_anonymous: false,
        }),
      ).rejects.toBeInstanceOf(AppError);
    });

    it('rejects when user is not a party to the transaction', async () => {
      repo.findBazaarTransaction.mockResolvedValue({
        transaction_id: 't-1',
        buyer_id: 'user-99',
        seller_id: 'user-2',
        status: 'completed',
      });
      await expect(
        service.createReview(user, {
          transactionId: 't-1',
          revieweeId: 'user-2',
          rating: 5,
          tags: [],
          is_anonymous: false,
        }),
      ).rejects.toBeInstanceOf(AppError);
    });

    it('rejects when reviewee is not the other party', async () => {
      repo.findBazaarTransaction.mockResolvedValue({
        transaction_id: 't-1',
        buyer_id: 'user-1',
        seller_id: 'user-2',
        status: 'completed',
      });
      await expect(
        service.createReview(user, {
          transactionId: 't-1',
          revieweeId: 'user-3',
          rating: 5,
          tags: [],
          is_anonymous: false,
        }),
      ).rejects.toBeInstanceOf(AppError);
    });

    it('rejects when review already exists', async () => {
      repo.findBazaarTransaction.mockResolvedValue({
        transaction_id: 't-1',
        buyer_id: 'user-1',
        seller_id: 'user-2',
        status: 'completed',
      });
      repo.findByTransactionAndReviewer.mockResolvedValue({ id: 'r-existing' });
      await expect(
        service.createReview(user, {
          transactionId: 't-1',
          revieweeId: 'user-2',
          rating: 5,
          tags: [],
          is_anonymous: false,
        }),
      ).rejects.toBeInstanceOf(AppError);
    });
  });

  describe('getAggregate', () => {
    it('returns empty aggregate when no reviews exist', async () => {
      repo.getAggregate.mockResolvedValue(null);
      const result = await service.getAggregate('user-2');
      expect(result.total_reviews).toBe(0);
      expect(result.average_rating).toBe('0.00');
    });

    it('returns aggregate from DB and caches it', async () => {
      repo.getAggregate.mockResolvedValue({
        user_id: 'user-2',
        total_reviews: 10,
        average_rating: '4.5',
        rating_1_count: 0,
        rating_2_count: 0,
        rating_3_count: 1,
        rating_4_count: 3,
        rating_5_count: 6,
        updated_at: new Date(),
      });
      const result = await service.getAggregate('user-2');
      expect(result.total_reviews).toBe(10);
      expect(fastify.redis.setex).toHaveBeenCalled();
    });

    it('returns cached value if present', async () => {
      const cached = {
        user_id: 'user-2',
        total_reviews: 5,
        average_rating: '4.0',
        rating_1_count: 0,
        rating_2_count: 0,
        rating_3_count: 1,
        rating_4_count: 2,
        rating_5_count: 2,
        updated_at: new Date().toISOString(),
      };
      fastify = buildFastify({
        redis: {
          get: vi.fn().mockResolvedValue(JSON.stringify(cached)),
          setex: vi.fn(),
          del: vi.fn(),
        },
      });
      service = new ReviewService(fastify);
      const result = await service.getAggregate('user-2');
      expect(result.total_reviews).toBe(5);
    });
  });
});
