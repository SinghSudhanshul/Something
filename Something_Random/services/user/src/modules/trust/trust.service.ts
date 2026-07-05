/**
 * Trust Score Service
 *
 * Event-sourced trust score engine. Every trust-affecting action records
 * an append-only event and atomically updates the score.
 */

import type { FastifyInstance } from 'fastify';
import { createLogger } from '@nexus/utils';

import * as repo from './trust.repository.js';
import { getTrustTier, TRUST_DELTAS, type TrustDeltaKey } from './trust.constants.js';

const logger = createLogger('trust-service');

export interface TrustEventParams {
  userId: string;
  eventType: TrustDeltaKey;
  delta: number;
  reason: string;
  referenceId?: string | undefined;
  referenceType?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

/**
 * Records a trust event and atomically updates the user's trust score.
 *
 * Steps:
 * 1. Insert event (append-only table)
 * 2. Atomic delta application with GREATEST/LEAST clamping
 * 3. Invalidate caches
 * 4. Update leaderboard sorted set
 * 5. Emit tier-upgrade event if tier changed
 */
export async function recordTrustEvent(
  app: FastifyInstance,
  params: TrustEventParams,
): Promise<void> {
  // Get current score before applying delta
  const currentProfile = await repo.getTrustScore(app.db as any, params.userId);
  const oldScore = currentProfile !== undefined ? parseFloat(currentProfile.trustScore) : 3.00;

  // 1. Insert trust event (append-only)
  await repo.insertTrustEvent(app.db as any, {
    userId: params.userId,
    eventType: params.eventType,
    delta: params.delta.toFixed(2),
    reason: params.reason,
    ...(params.referenceId !== undefined && { referenceId: params.referenceId }),
    ...(params.referenceType !== undefined && { referenceType: params.referenceType }),
    ...(params.metadata !== undefined && { metadata: params.metadata }),
  });

  // 2. Atomic delta — clamped between 0 and 5
  await repo.applyTrustScoreDelta(app.db as any, params.userId, params.delta);

  // 3. Invalidate caches
  await app.redis.del(`user:profile:${params.userId}`);
  await app.redis.del(`user:public_profile:${params.userId}`);

  // 4. Calculate new score for leaderboard
  const newScore = Math.max(0, Math.min(5, oldScore + params.delta));

  // Update campus leaderboard sorted set
  const updatedProfile = await repo.getTrustScore(app.db as any, params.userId);
  if (updatedProfile !== undefined) {
    // We'd need campus_id here — get it from the profile relation
    // For now, use a global leaderboard. Campus-scoped leaderboard
    // would require a join or cached campus_id.
    await app.redis.zadd('trust_scores:global', parseFloat(updatedProfile.trustScore), params.userId);
  }

  // 5. Emit tier-upgrade event if tier changed
  const oldTier = getTrustTier(oldScore);
  const newTier = getTrustTier(newScore);

  if (oldTier !== newTier) {
    logger.info(
      { userId: params.userId, oldTier, newTier, newScore: newScore.toFixed(2) },
      'Trust tier changed',
    );

    if (app.kafka) {
      try {
        await app.kafka.send({
          topic: 'nexus.users.trust_tier_upgraded',
          messages: [
            {
              key: params.userId,
              value: JSON.stringify({
                userId: params.userId,
                oldTier,
                newTier,
                score: newScore.toFixed(2),
                timestamp: new Date().toISOString(),
              }),
            },
          ],
        });
      } catch {
        logger.warn('Failed to publish trust_tier_upgraded event');
      }
    }
  }

  logger.info(
    { userId: params.userId, eventType: params.eventType, delta: params.delta },
    'Trust event recorded',
  );
}

/**
 * Get trust event history for a user.
 */
export async function getTrustHistory(
  app: FastifyInstance,
  userId: string,
  limit = 50,
): Promise<unknown[]> {
  return repo.findTrustEventsByUserId(app.db as any, userId, limit);
}

/**
 * Process a trust event from a known delta key.
 * Convenience wrapper around recordTrustEvent.
 */
export async function processTrustDelta(
  app: FastifyInstance,
  userId: string,
  eventType: TrustDeltaKey,
  reason: string,
  referenceId?: string,
  referenceType?: string,
): Promise<void> {
  const delta = TRUST_DELTAS[eventType];
  await recordTrustEvent(app, {
    userId,
    eventType,
    delta,
    reason,
    ...(referenceId !== undefined && { referenceId }),
    ...(referenceType !== undefined && { referenceType }),
  });
}
