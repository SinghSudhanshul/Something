/**
 * NEXUS Feast — Order Zod Schemas
 *
 * All request validation schemas for food ordering operations.
 */

import { z } from 'zod';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const DELIVERY_TYPES = ['pickup', 'delivery'] as const;

const ORDER_STATUSES = [
  'preparing', 'ready', 'picked_up', 'delivered',
] as const;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Place Order
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const OrderItemSchema = z.object({
  menuItemId: z.string().uuid('Menu item ID must be a valid UUID'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1').max(20, 'Quantity cannot exceed 20'),
  customizations: z.record(z.unknown()).optional(),
});

export const PlaceOrderSchema = z.object({
  canteenId: z.string().uuid('Canteen ID must be a valid UUID'),
  items: z.array(OrderItemSchema)
    .min(1, 'At least 1 item required')
    .max(15, 'Maximum 15 items per order'),
  deliveryType: z.enum(DELIVERY_TYPES),
  deliveryLocation: z.string().max(500).optional(),
  instructions: z.string().max(500, 'Instructions cannot exceed 500 characters').optional(),
}).refine(
  (data) => {
    if (data.deliveryType === 'delivery' && !data.deliveryLocation) return false;
    return true;
  },
  { message: 'Delivery location is required for delivery orders', path: ['deliveryLocation'] },
);
export type PlaceOrderInput = z.infer<typeof PlaceOrderSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Update Order Status (vendor)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const UpdateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES, {
    errorMap: () => ({ message: `Status must be one of: ${ORDER_STATUSES.join(', ')}` }),
  }),
});
export type UpdateOrderStatusInput = z.infer<typeof UpdateOrderStatusSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Rate Order
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const RateOrderSchema = z.object({
  score: z.number().int().min(1, 'Score must be between 1 and 5').max(5),
  review_text: z.string().max(500, 'Review cannot exceed 500 characters').optional(),
});
export type RateOrderInput = z.infer<typeof RateOrderSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Cancel Order
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const CancelOrderSchema = z.object({
  reason: z.string().min(5, 'Reason must be at least 5 characters').max(500),
});
export type CancelOrderInput = z.infer<typeof CancelOrderSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Params
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const OrderParamsSchema = z.object({
  id: z.string().uuid(),
});

export const CanteenOrdersParamsSchema = z.object({
  canteenId: z.string().uuid(),
});

export { DELIVERY_TYPES, ORDER_STATUSES };
