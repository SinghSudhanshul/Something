/**
 * NEXUS Bazaar — Listing Zod Schemas
 *
 * All request/response validation schemas for listing operations.
 */

import { z } from 'zod';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const LISTING_CATEGORIES = [
  'electronics', 'books', 'clothing', 'furniture', 'stationery',
  'cycles_vehicles', 'lab_equipment', 'appliances', 'sports_gear',
  'musical_instruments', 'other',
] as const;

const LISTING_CONDITIONS = ['new', 'like_new', 'good', 'fair', 'rough'] as const;
const LISTING_TYPES = ['fixed', 'negotiable', 'auction', 'rental'] as const;
const SORT_OPTIONS = ['created_at', 'price_asc', 'price_desc', 'relevance'] as const;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Create Listing
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const CreateListingSchema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters').max(200),
  description: z.string().min(20, 'Description must be at least 20 characters').max(5000),
  price: z.number().positive('Price must be greater than 0').max(100000, 'Price cannot exceed ₹1,00,000'),
  category: z.enum(LISTING_CATEGORIES),
  condition: z.enum(LISTING_CONDITIONS),
  listing_type: z.enum(LISTING_TYPES).default('fixed'),
  images: z.array(z.string()).max(8, 'Maximum 8 images allowed').default([]),
  tags: z.array(z.string().max(50)).max(10).default([]),
});
export type CreateListingInput = z.infer<typeof CreateListingSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Update Listing
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const UpdateListingSchema = z.object({
  title: z.string().min(5).max(200).optional(),
  description: z.string().min(20).max(5000).optional(),
  price: z.number().positive().max(100000).optional(),
  category: z.enum(LISTING_CATEGORIES).optional(),
  condition: z.enum(LISTING_CONDITIONS).optional(),
  listing_type: z.enum(LISTING_TYPES).optional(),
  images: z.array(z.string()).max(8).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
});
export type UpdateListingInput = z.infer<typeof UpdateListingSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Listing Query (Search/List)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const ListingQuerySchema = z.object({
  q: z.string().optional(),
  campus_id: z.string().uuid().optional(),
  category: z.enum(LISTING_CATEGORIES).optional(),
  condition: z.enum(LISTING_CONDITIONS).optional(),
  listing_type: z.enum(LISTING_TYPES).optional(),
  min_price: z.coerce.number().min(0).optional(),
  max_price: z.coerce.number().min(0).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  sort: z.enum(SORT_OPTIONS).default('created_at'),
}).refine(
  (data) => {
    if (data.min_price !== undefined && data.max_price !== undefined) {
      return data.min_price <= data.max_price;
    }
    return true;
  },
  { message: 'min_price must be less than or equal to max_price', path: ['min_price'] },
);
export type ListingQueryInput = z.infer<typeof ListingQuerySchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Offer
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const OfferSchema = z.object({
  amount: z.number().positive('Offer amount must be greater than 0'),
  message: z.string().max(500, 'Message cannot exceed 500 characters').optional(),
});
export type OfferInput = z.infer<typeof OfferSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Offer Action (accept/reject)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const OfferActionSchema = z.object({
  action: z.enum(['accepted', 'rejected']),
});
export type OfferActionInput = z.infer<typeof OfferActionSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Params
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const ListingParamsSchema = z.object({
  id: z.string().uuid(),
});

export const OfferParamsSchema = z.object({
  id: z.string().uuid(),
  offerId: z.string().uuid(),
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Initiate Purchase
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const InitiatePurchaseSchema = z.object({
  listingId: z.string().uuid(),
  offerId: z.string().uuid().optional(),
});
export type InitiatePurchaseInput = z.infer<typeof InitiatePurchaseSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Cancel Transaction
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const CancelTransactionSchema = z.object({
  reason: z.string().min(5, 'Please provide a reason for cancellation').max(500),
});
export type CancelTransactionInput = z.infer<typeof CancelTransactionSchema>;

export { LISTING_CATEGORIES, LISTING_CONDITIONS, LISTING_TYPES, SORT_OPTIONS };
