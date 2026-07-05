/**
 * Trust Score Repository — Single writer for trust_score_events and student_profiles.trust_score
 *
 * This repository owns all database operations related to trust scores.
 * It implements the following patterns:
 *
 *  1. **Append-only event log**: All trust mutations are recorded as immutable events
 *     in `trust_score_events` before scores are updated. This provides a full audit trail.
 *
 *  2. **Atomic delta application**: Score updates use `GREATEST(0.00, LEAST(5.00, trust_score + delta))`
 *     to clamp values in a single SQL statement. No read-modify-write race conditions.
 *
 *  3. **Canonical recompute**: The nightly cron recalculates scores from source-of-truth data
 *     (ratings, completion rate, verification, account age, dispute history) using a weighted
 *     formula. This corrects any drift from incremental deltas.
 *
 *  4. **Redis cache**: Read-through cache for trust scores with configurable TTL (default 5min).
 *     Cache is invalidated on every write and populated on every read miss.
 *
 * All queries use parameterised statements to prevent SQL injection.
 *
 * @module score/score.repository
 */

import { type Pool, type PoolClient } from 'pg';
import type { Redis } from 'ioredis';
import { createLogger } from '@nexus/utils';
import { config } from '../../config.js';

const logger = createLogger('trust-score-repository');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Represents a single trust score event stored in the append-only log */
export interface TrustScoreEvent {
  /** UUID primary key */
  id: string;
  /** User ID this event belongs to */
  userId: string;
  /** Event type (e.g. 'transaction_completed', 'verification_upgraded') */
  eventType: string;
  /** Score delta applied (stored as text for exact decimal representation) */
  delta: string;
  /** Human-readable reason for the score change */
  reason: string;
  /** External entity ID that triggered this event (e.g. transaction ID) */
  referenceId?: string;
  /** Type of the external entity (e.g. 'transaction', 'ride') */
  referenceType?: string;
  /** Arbitrary metadata associated with the event */
  metadata?: Record<string, unknown>;
  /** ISO 8601 timestamp of event creation */
  createdAt: string;
}

/** Data required to create a new trust score event */
export interface AppendEventData {
  /** User ID to record the event for */
  userId: string;
  /** Trust event type identifier */
  eventType: string;
  /** Score delta to apply (positive = improvement, negative = penalty) */
  delta: number;
  /** Human-readable reason for the score change */
  reason: string;
  /** External entity ID that triggered this event */
  referenceId?: string;
  /** Type of the external entity */
  referenceType?: string;
  /** Arbitrary metadata to store with the event */
  metadata?: Record<string, unknown>;
}

/** Result of an atomic delta application */
export interface DeltaResult {
  /** Score before the delta was applied */
  oldScore: number;
  /** Score after the delta was applied (clamped to [0.00, 5.00]) */
  newScore: number;
}

/** Result of a campus user query for leaderboard building */
export interface CampusUserScore {
  /** User ID */
  userId: string;
  /** Current trust score */
  trustScore: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Default trust score for new users without a profile */
const DEFAULT_TRUST_SCORE = 3.0;

/** Minimum allowed trust score */
const MIN_SCORE = 0.0;

/** Maximum allowed trust score */
const MAX_SCORE = 5.0;

/** Redis key prefix for cached trust scores */
const SCORE_CACHE_PREFIX = 'trust:score:';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SQL Queries
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SQL = {
  /** Insert a new trust score event into the append-only log */
  INSERT_EVENT: `
    INSERT INTO trust_score_events (user_id, event_type, delta, reason, reference_id, reference_type, metadata)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, user_id, event_type, delta::text, reason, reference_id, reference_type, metadata, created_at
  `,

  /** Atomically apply a delta to the user's trust score. Never read-modify-write. */
  APPLY_DELTA: `
    UPDATE student_profiles
    SET trust_score = GREATEST(0.00, LEAST(5.00, trust_score + $1)),
        updated_at = NOW()
    WHERE user_id = $2
    RETURNING trust_score::float AS new_score,
              (trust_score - $1)::float AS old_score
  `,

  /** Upsert profile with initial score + delta when profile doesn't exist yet */
  UPSERT_PROFILE_WITH_DELTA: `
    INSERT INTO student_profiles (user_id, trust_score, updated_at)
    VALUES ($1, GREATEST(0.00, LEAST(5.00, 3.00 + $2)), NOW())
    ON CONFLICT (user_id) DO UPDATE
      SET trust_score = GREATEST(0.00, LEAST(5.00, student_profiles.trust_score + $2)),
          updated_at = NOW()
    RETURNING trust_score::float AS new_score
  `,

  /** Get events for a user, ordered newest first with limit */
  GET_USER_EVENTS: `
    SELECT id, user_id, event_type, delta::text, reason, reference_id, reference_type, metadata, created_at
    FROM trust_score_events
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `,

  /** Get events for a user with cursor-based pagination */
  GET_USER_EVENTS_PAGINATED: `
    SELECT id, user_id, event_type, delta::text, reason, reference_id, reference_type, metadata, created_at
    FROM trust_score_events
    WHERE user_id = $1 AND created_at < $2
    ORDER BY created_at DESC
    LIMIT $3
  `,

  /**
   * Full recompute from canonical formula.
   * Weighted scoring:
   *  - avgRating/5 * 0.40
   *  - completionRate * 0.25
   *  - verificationLevel/4 * 0.15
   *  - min(ageDays/365, 1) * 0.10
   *  - disputeFreeScore * 0.10
   */
  RECOMPUTE_SCORE: `
    WITH user_stats AS (
      SELECT
        COALESCE(AVG(r.score), 3.0) AS avg_rating,
        COALESCE(
          CAST(COUNT(CASE WHEN t.status = 'completed' THEN 1 END) AS float) /
          NULLIF(COUNT(t.id), 0), 1.0
        ) AS completion_rate,
        COALESCE(sp.verification_level::int, 1) AS verification_level,
        EXTRACT(DAY FROM NOW() - u.created_at) AS age_days,
        COALESCE(
          1.0 - CAST(COUNT(CASE WHEN d.status IN ('resolved_buyer') AND d.against_id = $1 THEN 1 END) AS float) /
          NULLIF(COUNT(CASE WHEN d.raised_by_id = $1 OR d.against_id = $1 THEN 1 END), 0), 1.0
        ) AS dispute_free_score
      FROM users u
      LEFT JOIN student_profiles sp ON sp.user_id = u.id
      LEFT JOIN ratings r ON r.reviewee_id = u.id
      LEFT JOIN transactions t ON t.buyer_id = u.id OR t.seller_id = u.id
      LEFT JOIN disputes d ON d.raised_by_id = u.id OR d.against_id = u.id
      WHERE u.id = $1
      GROUP BY sp.verification_level, u.created_at
    )
    SELECT
      (COALESCE(avg_rating, 3.0) / 5.0 * 0.40) +
      (COALESCE(completion_rate, 1.0) * 0.25) +
      (COALESCE(verification_level, 1)::float / 4.0 * 0.15) +
      (LEAST(COALESCE(age_days, 0) / 365.0, 1.0) * 0.10) +
      (COALESCE(dispute_free_score, 1.0) * 0.10) AS raw_score
    FROM user_stats
  `,

  /** Update the persisted trust score after recompute */
  UPDATE_SCORE: `
    UPDATE student_profiles
    SET trust_score = $1, updated_at = NOW()
    WHERE user_id = $2
  `,

  /** Get current trust score for a user from the database */
  GET_SCORE: `
    SELECT trust_score::float FROM student_profiles WHERE user_id = $1
  `,

  /** Get all active, non-suspended user IDs in batches for nightly cron */
  GET_ACTIVE_USER_IDS: `
    SELECT id FROM users
    WHERE is_active = true AND is_suspended = false
    ORDER BY id
    LIMIT $1 OFFSET $2
  `,

  /** Get users by campus ID with their trust scores for leaderboard building */
  GET_CAMPUS_USER_SCORES: `
    SELECT sp.user_id, sp.trust_score::float
    FROM student_profiles sp
    INNER JOIN users u ON u.id = sp.user_id
    WHERE u.campus_id = $1
      AND u.is_active = true
      AND u.is_suspended = false
    ORDER BY sp.trust_score DESC
    LIMIT $2
  `,

  /** Get count of fraud flags for a user within a time window */
  GET_FRAUD_FLAG_COUNT: `
    SELECT COUNT(*) as flag_count
    FROM fraud_flags
    WHERE user_id = $1
      AND created_at >= NOW() - ($2 || ' days')::interval
  `,

  /** Insert a fraud flag record */
  INSERT_FRAUD_FLAG: `
    INSERT INTO fraud_flags (user_id, reason, score, action, metadata, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    RETURNING id, user_id, reason, score, action, metadata, created_at
  `,

  /** Get fraud flags for admin review, with pagination */
  GET_FRAUD_FLAGS: `
    SELECT ff.id, ff.user_id, ff.reason, ff.score, ff.action, ff.metadata, ff.created_at,
           u.full_name, u.email, sp.trust_score::float
    FROM fraud_flags ff
    INNER JOIN users u ON u.id = ff.user_id
    LEFT JOIN student_profiles sp ON sp.user_id = ff.user_id
    ORDER BY ff.created_at DESC
    LIMIT $1 OFFSET $2
  `,

  /** Get fraud flags filtered by campus for campus_admin */
  GET_FRAUD_FLAGS_BY_CAMPUS: `
    SELECT ff.id, ff.user_id, ff.reason, ff.score, ff.action, ff.metadata, ff.created_at,
           u.full_name, u.email, sp.trust_score::float
    FROM fraud_flags ff
    INNER JOIN users u ON u.id = ff.user_id
    LEFT JOIN student_profiles sp ON sp.user_id = ff.user_id
    WHERE u.campus_id = $1
    ORDER BY ff.created_at DESC
    LIMIT $2 OFFSET $3
  `,

  /** Suspend a user by setting is_suspended flag */
  SUSPEND_USER: `
    UPDATE users
    SET is_suspended = true, updated_at = NOW()
    WHERE id = $1
  `,

  /** Get user listing count for new user fraud checks */
  GET_USER_LISTING_COUNT: `
    SELECT COUNT(*) as listing_count
    FROM listings
    WHERE seller_id = $1
  `,

  /** Get user account age in days */
  GET_USER_AGE_DAYS: `
    SELECT EXTRACT(DAY FROM NOW() - created_at) as age_days
    FROM users
    WHERE id = $1
  `,
} as const;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Repository Implementation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class ScoreRepository {
  constructor(
    private readonly db: Pool,
    private readonly redis?: Redis,
  ) {}

  // ── Event Log ─────────────────────────────────────────

  /**
   * Append a trust score event to the immutable event log.
   *
   * Events are stored before score deltas are applied, ensuring that
   * the audit trail is always complete even if the delta application fails.
   *
   * @param data - Event data to insert
   * @returns The created event with server-generated ID and timestamp
   * @throws If the database insert fails (e.g. connection error)
   */
  async appendEvent(data: AppendEventData): Promise<TrustScoreEvent> {
    const result = await this.db.query(SQL.INSERT_EVENT, [
      data.userId,
      data.eventType,
      data.delta,
      data.reason,
      data.referenceId ?? null,
      data.referenceType ?? null,
      JSON.stringify(data.metadata ?? {}),
    ]);

    const event = this.mapEvent(result.rows[0]);

    logger.debug(
      { userId: data.userId, eventType: data.eventType, delta: data.delta },
      'Trust event appended',
    );

    return event;
  }

  // ── Event Retrieval ───────────────────────────────────

  /**
   * Retrieve trust events for a user, ordered newest first.
   *
   * @param userId - User ID to query events for
   * @param limit - Maximum number of events to return (default: 50, max: 200)
   * @returns Array of trust score events, newest first
   */
  async getEventsForUser(userId: string, limit = 50): Promise<TrustScoreEvent[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const result = await this.db.query(SQL.GET_USER_EVENTS, [userId, safeLimit]);
    return result.rows.map((row: Record<string, unknown>) => this.mapEvent(row));
  }

  /**
   * Retrieve trust events for a user with cursor-based pagination.
   *
   * @param userId - User ID to query events for
   * @param cursor - ISO 8601 timestamp cursor (events before this timestamp)
   * @param limit - Maximum number of events to return
   * @returns Array of trust score events, newest first
   */
  async getEventsForUserPaginated(
    userId: string,
    cursor: string,
    limit = 50,
  ): Promise<TrustScoreEvent[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const result = await this.db.query(SQL.GET_USER_EVENTS_PAGINATED, [
      userId,
      cursor,
      safeLimit,
    ]);
    return result.rows.map((row: Record<string, unknown>) => this.mapEvent(row));
  }

  // ── Atomic Score Updates ──────────────────────────────

  /**
   * Atomically apply a delta to the user's trust score.
   *
   * This uses a single UPDATE statement with GREATEST/LEAST clamping to
   * prevent the score from going below 0.00 or above 5.00. There is no
   * read-modify-write cycle, so concurrent deltas are safe.
   *
   * If the user has no student_profiles row yet (e.g. brand new user),
   * an upsert is performed with the default score (3.00) + delta.
   *
   * After the update, the Redis cache for this user's score is invalidated.
   *
   * @param userId - User ID to update
   * @param delta - Score delta to apply (can be negative)
   * @returns Old and new scores after clamping
   */
  async applyDelta(userId: string, delta: number): Promise<DeltaResult> {
    const result = await this.db.query(SQL.APPLY_DELTA, [delta, userId]);

    if (result.rows.length === 0) {
      // User has no student_profiles row — upsert with default + delta
      logger.info(
        { userId, delta },
        'No student_profiles row found, creating via upsert',
      );

      const upsertResult = await this.db.query(SQL.UPSERT_PROFILE_WITH_DELTA, [
        userId,
        delta,
      ]);

      const newScore = upsertResult.rows[0]?.new_score ??
        Math.max(MIN_SCORE, Math.min(MAX_SCORE, DEFAULT_TRUST_SCORE + delta));

      // Invalidate cache
      await this.invalidateScoreCache(userId);

      return {
        oldScore: DEFAULT_TRUST_SCORE,
        newScore,
      };
    }

    const oldScore = result.rows[0].old_score;
    const newScore = result.rows[0].new_score;

    // Invalidate cache
    await this.invalidateScoreCache(userId);

    logger.debug(
      { userId, delta, oldScore, newScore },
      'Trust score delta applied',
    );

    return { oldScore, newScore };
  }

  // ── Full Recompute ────────────────────────────────────

  /**
   * Full recompute of a user's trust score from canonical data sources.
   *
   * Formula:
   *   score = (avgRating/5 * 0.40) +
   *           (completionRate * 0.25) +
   *           (verificationLevel/4 * 0.15) +
   *           (min(ageDays/365, 1) * 0.10) +
   *           (disputeFreeScore * 0.10)
   *
   *   normalized = parseFloat((score * 5).toFixed(2))
   *
   * The resulting score is clamped to [0.00, 5.00] and persisted to
   * the student_profiles table.
   *
   * @param userId - User ID to recompute
   * @returns The new normalised trust score
   */
  async recomputeAndPersist(userId: string): Promise<number> {
    const result = await this.db.query(SQL.RECOMPUTE_SCORE, [userId]);

    const rawScore = result.rows[0]?.raw_score ?? 0.6;
    const normalized = parseFloat((rawScore * 5).toFixed(2));
    const clamped = Math.max(MIN_SCORE, Math.min(MAX_SCORE, normalized));

    await this.db.query(SQL.UPDATE_SCORE, [clamped, userId]);

    // Invalidate cache
    await this.invalidateScoreCache(userId);

    logger.debug(
      { userId, rawScore, normalized, clamped },
      'Trust score recomputed and persisted',
    );

    return clamped;
  }

  /**
   * Batch recompute trust scores for multiple users.
   *
   * Each user is recomputed independently. Failures for individual users
   * are logged and skipped — they do not abort the entire batch.
   *
   * @param userIds - Array of user IDs to recompute
   * @returns Map of userId → new trust score for successfully recomputed users
   */
  async batchRecompute(userIds: string[]): Promise<Map<string, number>> {
    const results = new Map<string, number>();

    for (const userId of userIds) {
      try {
        const score = await this.recomputeAndPersist(userId);
        results.set(userId, score);
      } catch (err) {
        logger.error(
          { err, userId },
          'Failed to recompute trust score for user in batch',
        );
      }
    }

    return results;
  }

  // ── Score Retrieval ───────────────────────────────────

  /**
   * Get the current trust score for a user, with Redis cache.
   *
   * Cache strategy: read-through with configurable TTL (default 5 minutes).
   * On cache miss, the score is loaded from PostgreSQL and cached.
   * On cache hit, the cached value is returned without a DB query.
   *
   * If Redis is unavailable, falls through to the database directly.
   *
   * @param userId - User ID to get the score for
   * @returns Current trust score (0.00 - 5.00), defaults to 3.00 for users without a profile
   */
  async getScore(userId: string): Promise<number> {
    // Try Redis cache first
    if (this.redis) {
      try {
        const cached = await this.redis.get(`${SCORE_CACHE_PREFIX}${userId}`);
        if (cached !== null) {
          const parsed = parseFloat(cached);
          if (!isNaN(parsed)) {
            logger.debug({ userId, score: parsed }, 'Trust score cache hit');
            return parsed;
          }
        }
      } catch (err) {
        logger.warn(
          { err, userId },
          'Redis cache read failed — falling through to DB',
        );
      }
    }

    // Cache miss — query database
    const result = await this.db.query(SQL.GET_SCORE, [userId]);
    const score: number = result.rows[0]?.trust_score ?? DEFAULT_TRUST_SCORE;

    // Populate cache
    if (this.redis) {
      try {
        await this.redis.setex(
          `${SCORE_CACHE_PREFIX}${userId}`,
          config.TRUST_SCORE_CACHE_TTL_SECS,
          score.toString(),
        );
        logger.debug({ userId, score }, 'Trust score cached');
      } catch (err) {
        logger.warn({ err, userId }, 'Redis cache write failed');
      }
    }

    return score;
  }

  // ── User Batch Retrieval ──────────────────────────────

  /**
   * Get all active, non-suspended user IDs in batches.
   * Used by the nightly cron to iterate through users.
   *
   * @param batchSize - Number of user IDs per batch
   * @param offset - Offset for pagination
   * @returns Array of user ID strings
   */
  async getAllActiveUserIds(batchSize: number, offset: number): Promise<string[]> {
    const result = await this.db.query(SQL.GET_ACTIVE_USER_IDS, [
      batchSize,
      offset,
    ]);
    return result.rows.map((r: { id: string }) => r.id);
  }

  // ── Campus Leaderboard ────────────────────────────────

  /**
   * Get trust scores for all active users in a campus.
   * Used to rebuild the Redis leaderboard sorted set on cold start.
   *
   * @param campusId - Campus ID to query
   * @param limit - Maximum number of users to return (default: 500)
   * @returns Array of user IDs and their trust scores
   */
  async getCampusUserScores(
    campusId: string,
    limit = 500,
  ): Promise<CampusUserScore[]> {
    const result = await this.db.query(SQL.GET_CAMPUS_USER_SCORES, [
      campusId,
      limit,
    ]);
    return result.rows.map((row: { user_id: string; trust_score: number }) => ({
      userId: row.user_id,
      trustScore: row.trust_score,
    }));
  }

  // ── Fraud Flags ───────────────────────────────────────

  /**
   * Count the number of fraud flags for a user within a rolling time window.
   *
   * @param userId - User ID to check
   * @param windowDays - Number of days to look back
   * @returns Number of fraud flags in the window
   */
  async getFraudFlagCount(userId: string, windowDays: number): Promise<number> {
    const result = await this.db.query(SQL.GET_FRAUD_FLAG_COUNT, [
      userId,
      windowDays.toString(),
    ]);
    return parseInt(result.rows[0]?.flag_count ?? '0', 10);
  }

  /**
   * Insert a fraud flag record for a user.
   *
   * @param userId - User ID to flag
   * @param reason - Human-readable reason for the flag
   * @param score - Fraud score (0-100)
   * @param action - Action taken (allow, monitor, selfie, block)
   * @param metadata - Additional context
   * @returns The created fraud flag record
   */
  async insertFraudFlag(
    userId: string,
    reason: string,
    score: number,
    action: string,
    metadata: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const result = await this.db.query(SQL.INSERT_FRAUD_FLAG, [
      userId,
      reason,
      score,
      action,
      JSON.stringify(metadata),
    ]);
    return result.rows[0];
  }

  /**
   * Get fraud flags for admin review.
   *
   * @param limit - Maximum number of flags to return
   * @param offset - Offset for pagination
   * @param campusId - Optional campus ID filter (for campus_admin)
   * @returns Array of fraud flag records with user details
   */
  async getFraudFlags(
    limit: number,
    offset: number,
    campusId?: string,
  ): Promise<Array<Record<string, unknown>>> {
    if (campusId) {
      const result = await this.db.query(SQL.GET_FRAUD_FLAGS_BY_CAMPUS, [
        campusId,
        limit,
        offset,
      ]);
      return result.rows;
    }

    const result = await this.db.query(SQL.GET_FRAUD_FLAGS, [limit, offset]);
    return result.rows;
  }

  /**
   * Suspend a user account. Called when fraud flag count exceeds threshold.
   *
   * @param userId - User ID to suspend
   */
  async suspendUser(userId: string): Promise<void> {
    await this.db.query(SQL.SUSPEND_USER, [userId]);
    logger.warn({ userId }, 'User account suspended due to fraud flags');
  }

  /**
   * Get the number of listings created by a user.
   * Used for new user fraud checks on their first N listings.
   *
   * @param userId - User ID to check
   * @returns Number of listings created by the user
   */
  async getUserListingCount(userId: string): Promise<number> {
    const result = await this.db.query(SQL.GET_USER_LISTING_COUNT, [userId]);
    return parseInt(result.rows[0]?.listing_count ?? '0', 10);
  }

  /**
   * Get the account age in days for a user.
   *
   * @param userId - User ID to check
   * @returns Account age in days, or 0 if user not found
   */
  async getUserAgeDays(userId: string): Promise<number> {
    const result = await this.db.query(SQL.GET_USER_AGE_DAYS, [userId]);
    return parseFloat(result.rows[0]?.age_days ?? '0');
  }

  // ── Private Helpers ───────────────────────────────────

  /**
   * Invalidate the Redis cache entry for a user's trust score.
   * Silently swallows errors — cache invalidation failures are non-critical.
   *
   * @param userId - User ID whose cache should be invalidated
   */
  private async invalidateScoreCache(userId: string): Promise<void> {
    if (!this.redis) return;

    try {
      await Promise.allSettled([
        this.redis.del(`${SCORE_CACHE_PREFIX}${userId}`),
        this.redis.del(`user:profile:${userId}`),
        this.redis.del(`user:public_profile:${userId}`),
      ]);
    } catch (err) {
      logger.warn(
        { err, userId },
        'Failed to invalidate trust score cache',
      );
    }
  }

  /**
   * Maps a raw database row to a typed TrustScoreEvent.
   * Handles null coalescing and type conversion.
   *
   * @param row - Raw database row
   * @returns Typed TrustScoreEvent
   */
  private mapEvent(row: Record<string, unknown>): TrustScoreEvent {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      eventType: row.event_type as string,
      delta: row.delta as string,
      reason: row.reason as string,
      referenceId: (row.reference_id as string) ?? undefined,
      referenceType: (row.reference_type as string) ?? undefined,
      metadata: (row.metadata as Record<string, unknown>) ?? undefined,
      createdAt: row.created_at instanceof Date
        ? (row.created_at as Date).toISOString()
        : String(row.created_at),
    };
  }
}
