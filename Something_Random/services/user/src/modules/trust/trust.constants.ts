/**
 * Trust Score Constants
 *
 * Delta values for each trust event type. These are locked in for Phase 1.
 * All future phases extend this but never change existing values.
 */

export const TRUST_DELTAS = {
  review_received: 0.05,
  transaction_completed: 0.03,
  transaction_disputed_lost: -0.20,
  account_age_milestone: 0.05,
  verification_upgraded_l2: 0.10,
  verification_upgraded_l3: 0.15,
  verification_upgraded_l4: 0.20,
  dispute_free_streak: 0.05,
  listing_sold: 0.02,
  gig_completed: 0.03,
  ride_completed: 0.02,
  first_transaction: 0.10,
} as const;

export type TrustDeltaKey = keyof typeof TRUST_DELTAS;

/**
 * Trust tier boundaries — locked in.
 */
export function getTrustTier(score: number): 'new' | 'building' | 'trusted' | 'verified' | 'elite' {
  if (score < 2.00) return 'new';
  if (score < 3.00) return 'building';
  if (score < 3.80) return 'trusted';
  if (score < 4.50) return 'verified';
  return 'elite';
}

/**
 * Trust score formula weights — locked in.
 *
 * score = (avgRating / 5) * 0.40
 *       + completionRate * 0.25
 *       + (verificationLevel / 4) * 0.15
 *       + min(ageDays / 365, 1) * 0.10
 *       + disputeFreeScore * 0.10
 *
 * Result normalized to 0.00–5.00
 */
export function calculateTrustScore(params: {
  avgRating: number;
  completionRate: number;
  verificationLevel: number;
  ageDays: number;
  disputeFreeScore: number;
}): number {
  const score =
    (params.avgRating / 5) * 0.40 +
    params.completionRate * 0.25 +
    (params.verificationLevel / 4) * 0.15 +
    Math.min(params.ageDays / 365, 1) * 0.10 +
    params.disputeFreeScore * 0.10;

  return parseFloat((score * 5).toFixed(2));
}
