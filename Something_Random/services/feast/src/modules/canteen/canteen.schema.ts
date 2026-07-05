/**
 * NEXUS Feast — Canteen Zod Schemas
 *
 * All request validation schemas for canteen and menu item operations.
 */

import { z } from 'zod';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const MENU_CATEGORIES = [
  'breakfast', 'lunch', 'dinner', 'snacks', 'beverages', 'desserts', 'combos', 'specials',
] as const;

const OPERATING_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Operating Hours Schema
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const TimeSlotSchema = z.object({
  open: z.string().regex(TIME_REGEX, 'Time must be in HH:mm format'),
  close: z.string().regex(TIME_REGEX, 'Time must be in HH:mm format'),
}).refine(
  (data) => data.open < data.close,
  { message: 'Closing time must be after opening time' },
);

const OperatingHoursSchema = z.record(
  z.enum(OPERATING_DAYS),
  TimeSlotSchema,
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Create Canteen
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const CreateCanteenSchema = z.object({
  name: z.string().min(5, 'Name must be at least 5 characters').max(100),
  description: z.string().max(1000).optional(),
  location_label: z.string().max(200).optional(),
  operating_hours: OperatingHoursSchema,
  fssai_license_no: z.string().length(14, 'FSSAI license must be exactly 14 characters'),
  image_url: z.string().url().optional(),
  avg_prep_time_minutes: z.number().int().min(1).max(120).default(15),
});
export type CreateCanteenInput = z.infer<typeof CreateCanteenSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Create Menu Item
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const CreateMenuItemSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters').max(150),
  description: z.string().max(500).optional(),
  category: z.enum(MENU_CATEGORIES).default('snacks'),
  price: z.number().positive('Price must be greater than 0').max(5000, 'Price cannot exceed ₹5,000'),
  is_veg: z.boolean({ required_error: 'is_veg is required' }),
  is_available: z.boolean().default(true),
  image_url: z.string().url().optional(),
  prep_time_minutes: z.number().int().min(1).max(120).optional(),
  calories: z.number().int().min(0).max(5000).optional(),
  allergens: z.array(z.string().max(50)).max(10).default([]),
});
export type CreateMenuItemInput = z.infer<typeof CreateMenuItemSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Update Menu Item
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const UpdateMenuItemSchema = z.object({
  name: z.string().min(3).max(150).optional(),
  description: z.string().max(500).optional(),
  category: z.enum(MENU_CATEGORIES).optional(),
  price: z.number().positive().max(5000).optional(),
  is_veg: z.boolean().optional(),
  image_url: z.string().url().optional(),
  prep_time_minutes: z.number().int().min(1).max(120).optional(),
  calories: z.number().int().min(0).max(5000).optional(),
  allergens: z.array(z.string().max(50)).max(10).optional(),
});
export type UpdateMenuItemInput = z.infer<typeof UpdateMenuItemSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Menu Item Availability Toggle
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const MenuItemAvailabilitySchema = z.object({
  is_available: z.boolean({ required_error: 'is_available is required' }),
});
export type MenuItemAvailabilityInput = z.infer<typeof MenuItemAvailabilitySchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Params
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const CanteenParamsSchema = z.object({ id: z.string().uuid() });
export const MenuItemParamsSchema = z.object({ id: z.string().uuid(), itemId: z.string().uuid() });

export { MENU_CATEGORIES, OPERATING_DAYS };
