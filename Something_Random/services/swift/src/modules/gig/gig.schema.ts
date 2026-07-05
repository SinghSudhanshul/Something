/**
 * NEXUS Swift — QuickGigs Zod Schemas
 */

import { z } from 'zod';

const GIG_CATEGORIES = [
  'web_development',
  'mobile_development',
  'design',
  'content_writing',
  'data_entry',
  'tutoring',
  'translation',
  'video_editing',
  'photography',
  'marketing',
  'research',
  'presentation',
  'other',
] as const;

const SORT_OPTIONS = ['created_at', 'budget_desc', 'budget_asc', 'deadline'] as const;

export const CreateGigSchema = z.object({
  title: z.string().min(10, 'Title must be at least 10 characters').max(200),
  description: z.string().min(50, 'Description must be at least 50 characters').max(5000),
  category: z.enum(GIG_CATEGORIES),
  skillsRequired: z.array(z.string().max(50)).min(1, 'At least one skill required').max(20),
  budgetInPaise: z.number().int().positive().max(10_000_000, 'Budget cannot exceed ₹1,00,000'),
  durationDays: z.number().int().positive().max(365),
  maxApplicants: z.number().int().positive().max(100).default(10),
  tags: z.array(z.string().max(50)).max(10).default([]),
  attachments: z.array(z.string().url()).max(5).default([]),
  expiresAt: z.string().datetime().optional(),
  milestones: z
    .array(
      z.object({
        title: z.string().min(3).max(200),
        description: z.string().max(2000).optional(),
        amountInPaise: z.number().int().positive(),
        dueDate: z.string().datetime().optional(),
        orderIndex: z.number().int().min(0).default(0),
      }),
    )
    .min(1)
    .max(10)
    .optional(),
});
export type CreateGigInput = z.infer<typeof CreateGigSchema>;

export const UpdateGigSchema = z.object({
  title: z.string().min(10).max(200).optional(),
  description: z.string().min(50).max(5000).optional(),
  skillsRequired: z.array(z.string().max(50)).min(1).max(20).optional(),
  budgetInPaise: z.number().int().positive().max(10_000_000).optional(),
  durationDays: z.number().int().positive().max(365).optional(),
  maxApplicants: z.number().int().positive().max(100).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
  expiresAt: z.string().datetime().optional(),
});
export type UpdateGigInput = z.infer<typeof UpdateGigSchema>;

export const GigQuerySchema = z.object({
  q: z.string().optional(),
  category: z.enum(GIG_CATEGORIES).optional(),
  skills: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined)),
  minBudget: z.coerce.number().int().min(0).optional(),
  maxBudget: z.coerce.number().int().min(0).optional(),
  status: z.enum(['open', 'in_progress', 'completed', 'cancelled', 'expired']).default('open'),
  sort: z.enum(SORT_OPTIONS).default('created_at'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type GigQueryInput = z.infer<typeof GigQuerySchema>;

export const GigParamsSchema = z.object({
  id: z.string().uuid(),
});

export const CreateApplicationSchema = z.object({
  proposal: z.string().min(50, 'Proposal must be at least 50 characters').max(3000),
  proposedRateInPaise: z.number().int().positive().optional(),
  estimatedDays: z.number().int().positive().max(365).optional(),
});
export type CreateApplicationInput = z.infer<typeof CreateApplicationSchema>;

export const RespondApplicationSchema = z.object({
  action: z.enum(['accepted', 'rejected']),
});
