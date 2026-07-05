/**
 * Trust Service Type Definitions
 *
 * Shared types used across the trust service modules.
 * Extends the global Fastify types with trust-specific decorations.
 *
 * @module types/index
 */

import type { ScoreService } from '../modules/score/score.service.js';
import type { FraudService } from '../modules/fraud/fraud.service.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Fastify Type Augmentations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

declare module 'fastify' {
  interface FastifyInstance {
    scoreService: ScoreService;
    fraudService: FraudService;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Trust Event Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** All possible trust event types */
export type TrustEventType =
  | 'transaction_completed'
  | 'transaction_disputed_lost'
  | 'verification_upgraded'
  | 'listing_sold'
  | 'listing_created'
  | 'ride_completed'
  | 'ride_sos_triggered'
  | 'gig_completed'
  | 'review_submitted'
  | 'food_order_completed'
  | 'profile_completed'
  | 'referral_successful'
  | 'community_contribution';

/** Trust tier names in ascending order */
export type TrustTier = 'new' | 'building' | 'trusted' | 'verified' | 'elite';

/** Fraud action recommendations */
export type FraudActionType =
  | 'allow'
  | 'allow_with_monitoring'
  | 'require_selfie_verification'
  | 'block_pending_review';

/** Fraud flag severity levels */
export type FraudFlagSeverity = 'low' | 'medium' | 'high' | 'critical';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Trust Score Event
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** A single trust score event in the audit log */
export interface TrustScoreEvent {
  id: string;
  userId: string;
  eventType: TrustEventType;
  delta: number;
  reason: string;
  referenceId: string;
  referenceType: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/** Parameters for recording a trust event */
export interface RecordEventParams {
  userId: string;
  eventType: TrustEventType;
  referenceId: string;
  referenceType: string;
  metadata?: Record<string, unknown>;
}

/** Result of recording a trust event */
export interface RecordEventResult {
  score: number;
  tier: TrustTier;
  delta: number;
  tierUpgraded: boolean;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Leaderboard Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** A single leaderboard entry */
export interface LeaderboardEntry {
  userId: string;
  score: number;
  rank: number;
  displayName?: string;
  avatarUrl?: string;
}

/** Leaderboard response with pagination */
export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  campusId: string;
  totalCount: number;
  updatedAt: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Fraud Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Input for fraud scoring request */
export interface FraudScoringInput {
  userId: string;
  transactionId: string;
  amount: number;
  recipientId: string;
  module: string;
  userTrustScore?: number;
  userAge?: number;
  transactionsLast24h?: number;
  transactionsLast7d?: number;
  uniqueRecipientsLast7d?: number;
  isNewRecipient?: boolean;
}

/** Fraud scoring result */
export interface FraudScoringResult {
  score: number;
  action: FraudActionType;
  modelAvailable: boolean;
  features: Record<string, unknown>;
  scoringId: string;
  latencyMs: number;
}

/** A fraud flag record */
export interface FraudFlag {
  id: string;
  userId: string;
  flagType: string;
  severity: FraudFlagSeverity;
  description: string;
  metadata: Record<string, unknown>;
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: Date;
  createdAt: Date;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API Response Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Standard API response wrapper */
export interface ApiResponse<T> {
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    hasMore?: boolean;
  };
}

/** Error response */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Kafka Event Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Standard Kafka event envelope */
export interface KafkaEvent<T = Record<string, unknown>> {
  type: string;
  payload: T;
  timestamp: string;
  source?: string;
  correlationId?: string;
}

/** Trust tier upgrade event payload */
export interface TierUpgradePayload {
  userId: string;
  oldTier: TrustTier;
  newTier: TrustTier;
  score: number;
}

/** Nightly recompute completion payload */
export interface NightlyRecomputePayload {
  totalUsers: number;
  timeMs: number;
  errors: number;
  batchesProcessed: number;
}
