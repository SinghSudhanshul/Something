/**
 * NEXUS Bazaar — Review Zod Schemas
 */

import { z } from 'zod';

export const CreateReviewSchema = z.object({
  transactionId: z.string().uuid(),
  revieweeId: z.string().uuid(),
  rating: z.number().int().min(1, 'Rating must be at least 1').max(5, 'Rating cannot exceed 5'),
  title: z.string().max(120, 'Title cannot exceed 120 characters').optional(),
  comment: z.string().max(2000, 'Comment cannot exceed 2000 characters').optional(),
  tags: z.array(z.string().max(40)).max(5, 'Maximum 5 tags allowed').default([]),
  is_anonymous: z.boolean().default(false),
});
export type CreateReviewInput = z.infer<typeof CreateReviewSchema>;

export const ReviewQuerySchema = z.object({
  reviewee_id: z.string().uuid().optional(),
  listing_id: z.string().uuid().optional(),
  min_rating: z.coerce.number().int().min(1).max(5).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ReviewQueryInput = z.infer<typeof ReviewQuerySchema>;

export const ReviewParamsSchema = z.object({
  id: z.string().uuid(),
});

export const REVIEW_TAGS = [
  'as_described',
  'fast_response',
  'polite',
  'reliable',
  'good_quality',
  'fair_price',
  'smooth_handover',
  'recommended',
] as const;

export const REVIEW_AGGREGATE_TTL_SECONDS = 60 * 30; // 30 min
