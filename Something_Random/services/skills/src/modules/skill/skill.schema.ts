/**
 * NEXUS Skills — Skill Zod Schemas
 */
import { z } from 'zod';

const SKILL_CATEGORIES = ['design','writing','programming','tutoring','video_editing','photography','music','marketing','data_entry','translation','other'] as const;

const PackageSchema = z.object({
  id: z.string().min(1), name: z.string().min(1).max(100),
  description: z.string().min(10).max(500), price: z.number().positive().max(50000),
  deliverable: z.string().min(5).max(500), delivery_days: z.number().int().min(1).max(90),
});

export const CreateSkillListingSchema = z.object({
  title: z.string().min(5).max(200), description: z.string().min(100).max(5000),
  category: z.enum(SKILL_CATEGORIES),
  packages: z.array(PackageSchema).min(1, 'At least 1 package required').max(3, 'Maximum 3 packages'),
  portfolio_urls: z.array(z.string().url()).max(5).default([]),
  tags: z.array(z.string().max(50)).max(10).default([]),
});
export type CreateSkillListingInput = z.infer<typeof CreateSkillListingSchema>;

export const PlaceSkillOrderSchema = z.object({
  packageId: z.string().min(1), requirements: z.string().min(20, 'Requirements must be at least 20 characters').max(5000),
});
export type PlaceSkillOrderInput = z.infer<typeof PlaceSkillOrderSchema>;

export const SubmitDeliverySchema = z.object({ proofUrl: z.string().min(1, 'Proof URL is required') });
export type SubmitDeliveryInput = z.infer<typeof SubmitDeliverySchema>;

export const RevisionRequestSchema = z.object({
  feedback: z.string().min(20, 'Feedback must be at least 20 characters').max(1000),
});
export type RevisionRequestInput = z.infer<typeof RevisionRequestSchema>;

export const RateSkillOrderSchema = z.object({
  score: z.number().int().min(1).max(5), review_text: z.string().max(500).optional(),
});
export type RateSkillOrderInput = z.infer<typeof RateSkillOrderSchema>;

export const SkillListingParamsSchema = z.object({ id: z.string().uuid() });
export const SkillOrderParamsSchema = z.object({ id: z.string().uuid() });

export { SKILL_CATEGORIES };
