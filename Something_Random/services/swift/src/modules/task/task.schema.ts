/**
 * NEXUS Swift — Task Zod Schemas
 *
 * All request validation schemas for campus errands/task operations.
 */

import { z } from 'zod';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const TASK_CATEGORIES = [
  'delivery', 'pickup', 'shopping', 'document', 'laundry',
  'food', 'printing', 'moving', 'errand', 'other',
] as const;

const PROOF_TYPES = ['photo', 'gps_pin', 'text'] as const;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Post Task
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const PostTaskSchema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters').max(200),
  description: z.string().min(20, 'Description must be at least 20 characters').max(2000).optional(),
  category: z.enum(TASK_CATEGORIES),
  reward: z.number().min(10, 'Reward must be at least ₹10').max(500, 'Reward cannot exceed ₹500'),
  location_from: z.string().max(200).optional(),
  location_to: z.string().max(200).optional(),
  deadline_at: z.string().datetime({ message: 'deadline_at must be a valid ISO 8601 datetime' }),
});
export type PostTaskInput = z.infer<typeof PostTaskSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Apply for Task
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const ApplyTaskSchema = z.object({
  message: z.string().max(500, 'Message cannot exceed 500 characters').optional(),
});
export type ApplyTaskInput = z.infer<typeof ApplyTaskSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Accept Runner
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const AcceptRunnerParamsSchema = z.object({
  id: z.string().uuid(),
  runnerId: z.string().uuid(),
});
export type AcceptRunnerParams = z.infer<typeof AcceptRunnerParamsSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Submit Completion
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const SubmitCompletionSchema = z.object({
  proofUrl: z.string().min(1, 'Proof URL is required'),
  proofType: z.enum(PROOF_TYPES),
  notes: z.string().max(1000).optional(),
}).refine(
  (data) => {
    if (data.proofType === 'text' && (!data.notes || data.notes.length < 20)) return false;
    return true;
  },
  { message: 'Text proof must include notes of at least 20 characters', path: ['notes'] },
);
export type SubmitCompletionInput = z.infer<typeof SubmitCompletionSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Verify Completion
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const VerifyCompletionSchema = z.object({
  approve: z.boolean({ required_error: 'approve is required' }),
});
export type VerifyCompletionInput = z.infer<typeof VerifyCompletionSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Rate Task
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const RateTaskSchema = z.object({
  score: z.number().int().min(1, 'Score must be between 1 and 5').max(5),
  review_text: z.string().max(500).optional(),
});
export type RateTaskInput = z.infer<typeof RateTaskSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Params
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const TaskParamsSchema = z.object({ id: z.string().uuid() });

export { TASK_CATEGORIES, PROOF_TYPES };
