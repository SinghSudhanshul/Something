/**
 * Trust Score Service — Event recording, nightly recomputation, leaderboards
 *
 * This service is the primary business-logic layer for trust score management.
 * It orchestrates:
 *
 *  1. **Event recording**: Validates event types against TRUST_DELTAS, appends
 *     to the event log, applies atomic deltas, invalidates caches, and checks
 *     for tier upgrades. Tier upgrades trigger Kafka events for downstream
 *     services (notifications, search re-indexing).
 *
 *  2. **Nightly recompute**: A cron-scheduled job (02:00 IST / 20:30 UTC) that
 *     iterates all active users in batches, recomputes trust scores from the
 *     canonical formula, and rebuilds campus leaderboard sorted sets.
 *
 *  3. **Campus leaderboards**: Redis sorted sets (ZADD) for per-campus rankings.
 *     Includes cold-start rebuild from PostgreSQL when the sorted set is empty.
 *
 *  4. **Score retrieval**: Read-through cached trust scores with tier mapping.
 *
 * All operations include structured logging with correlation-friendly fields.
 *
 * @module score/score.service
 */

import type { TrustEventType } from '@nexus/types';
import { TRUST_DELTAS, KafkaTopics } from '@nexus/types';
import { createLogger, sleep } from '@nexus/utils';
import type { Redis } from 'ioredis';
import { ScoreRepository, type AppendEventData, type TrustScoreEvent } from './score.repository.js';
import { config } from '../../config.js';

const logger = createLogger('trust-score-service');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Trust Tier Mapping
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Trust tier boundary definitions, ordered from lowest to highest */
const TIER_BOUNDARIES = [
  { min: 0, max: 1.49, tier: 'new' as const },
  { min: 1.50, max: 2.49, tier: 'building' as const },
  { min: 2.50, max: 3.49, tier: 'trusted' as const },
  { min: 3.50, max: 4.24, tier: 'verified' as const },
  { min: 4.25, max: 5.00, tier: 'elite' as const },
] as const;

/**
 * Maps a numeric trust score to its tier name.
 *
 * @param score - Trust score (0.00 - 5.00)
 * @returns Tier name ('new' | 'building' | 'trusted' | 'verified' | 'elite')
 */
function getTier(score: number): string {
  for (const b of TIER_BOUNDARIES) {
    if (score >= b.min && score <= b.max) return b.tier;
  }
  return 'new';
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Parameters for recording a trust event */
export interface TrustEventParams {
  /** User ID to record the event for */
  userId: string;
  /** Trust event type (must exist in TRUST_DELTAS) */
  eventType: TrustEventType;
  /** External entity ID that triggered this event */
  referenceId: string;
  /** Type of the external entity (e.g. 'transaction', 'ride') */
  referenceType: string;
  /** Arbitrary metadata (campusId, topic, etc.) */
  metadata?: Record<string, unknown>;
}

/** Result of recording a trust event */
export interface TrustEventResult {
  /** Updated trust score after applying the delta */
  score: number;
  /** Trust tier after the score change */
  tier: string;
  /** The delta that was applied */
  delta: number;
  /** Whether a tier upgrade occurred */
  tierUpgraded: boolean;
}

/** Result of the nightly recompute job */
export interface NightlyRecomputeResult {
  /** Total number of users processed */
  totalUsers: number;
  /** Wall-clock time for the entire job (ms) */
  timeMs: number;
  /** Number of individual user recompute failures */
  errors: number;
  /** Number of batches processed */
  batchesProcessed: number;
}

/** Leaderboard entry with rank */
export interface LeaderboardEntry {
  /** User ID */
  userId: string;
  /** Trust score */
  score: number;
  /** Rank position (1-indexed) */
  rank: number;
}

/** Score with tier information */
export interface ScoreWithTier {
  /** Trust score (0.00 - 5.00) */
  score: number;
  /** Trust tier name */
  tier: string;
}

/** Kafka producer wrapper interface */
export interface KafkaProducerSend {
  /** Send messages to a topic */
  send: (topic: string, messages: Array<{ key: string; value: string }>) => Promise<void>;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Redis sorted set key prefix for campus leaderboards */
const LEADERBOARD_PREFIX = 'trust_scores:campus:';

/** Maximum leaderboard entries to return */
const MAX_LEADERBOARD_LIMIT = 100;

/** Default leaderboard entries to return */
const DEFAULT_LEADERBOARD_LIMIT = 10;

/** Maximum entries when rebuilding a leaderboard from DB */
const LEADERBOARD_REBUILD_LIMIT = 500;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Service Implementation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class ScoreService {
  /** Handle to a scheduled cron interval (cleared on shutdown) */
  private cronInterval: ReturnType<typeof setInterval> | null = null;

  /** Whether a nightly recompute is currently in progress (prevents overlap) */
  private isRecomputeRunning = false;

  constructor(
    private readonly repo: ScoreRepository,
    private readonly redis: Redis,
    private readonly kafkaProducer: KafkaProducerSend | null,
  ) {}

  // ── Event Recording ───────────────────────────────────

  /**
   * Record a trust event and apply the canonical delta atomically.
   *
   * The process:
   *  1. Validate the event type against TRUST_DELTAS (reject unknown types)
   *  2. Look up the canonical delta for this event type
   *  3. Append the event to the audit log
   *  4. Apply the atomic delta (no read-modify-write)
   *  5. Invalidate profile caches
   *  6. Update campus leaderboard sorted set
   *  7. Check for tier upgrade and publish Kafka event if applicable
   *
   * @param params - Event parameters including userId, eventType, and references
   * @returns Updated score, tier, delta applied, and whether tier upgraded
   * @throws If the event type is invalid or not configured in TRUST_DELTAS
   */
  async recordEvent(params: TrustEventParams): Promise<TrustEventResult> {
    // Step 1: Validate event type
    const validTypes = Object.keys(TRUST_DELTAS) as TrustEventType[];
    if (!validTypes.includes(params.eventType)) {
      throw new Error(`Invalid eventType: ${params.eventType}`);
    }

    // Step 2: Get canonical delta — external callers cannot pass arbitrary deltas
    const delta = TRUST_DELTAS[params.eventType];
    if (delta === undefined) {
      throw new Error(`No delta configured for eventType: ${params.eventType}`);
    }

    // Step 3: Append event to audit log
    await this.repo.appendEvent({
      userId: params.userId,
      eventType: params.eventType,
      delta,
      reason: `${params.eventType} on ${params.referenceType}:${params.referenceId}`,
      referenceId: params.referenceId,
      referenceType: params.referenceType,
      metadata: params.metadata ?? {},
    });

    // Step 4: Apply atomic delta
    const { oldScore, newScore } = await this.repo.applyDelta(params.userId, delta);

    // Step 5: Invalidate Redis profile caches (non-critical)
    await Promise.allSettled([
      this.redis.del(`user:profile:${params.userId}`),
      this.redis.del(`user:public_profile:${params.userId}`),
    ]);

    // Step 6: Update campus leaderboard sorted set
    const campusId = params.metadata?.campusId as string | undefined;
    if (campusId) {
      try {
        await this.redis.zadd(
          `${LEADERBOARD_PREFIX}${campusId}`,
          newScore,
          params.userId,
        );
      } catch (err) {
        logger.warn(
          { err, campusId, userId: params.userId },
          'Failed to update leaderboard sorted set',
        );
      }
    }

    // Step 7: Check for tier upgrade
    const oldTier = getTier(oldScore);
    const newTier = getTier(newScore);
    const tierUpgraded = oldTier !== newTier && newScore > oldScore;

    if (tierUpgraded) {
      logger.info(
        { userId: params.userId, oldTier, newTier, score: newScore },
        'Trust tier upgraded',
      );
      await this.publishTierUpgrade(params.userId, oldTier, newTier, newScore);
    }

    logger.debug(
      {
        userId: params.userId,
        eventType: params.eventType,
        delta,
        oldScore,
        newScore,
        oldTier,
        newTier,
      },
      'Trust event recorded',
    );

    return { score: newScore, tier: newTier, delta, tierUpgraded };
  }

  // ── Full Recompute ────────────────────────────────────

  /**
   * Trigger a full recompute of a single user's trust score.
   *
   * @param userId - User ID to recompute
   * @returns The new normalised trust score
   */
  async fullRecompute(userId: string): Promise<number> {
    return this.repo.recomputeAndPersist(userId);
  }

  // ── Nightly Recompute ─────────────────────────────────

  /**
   * Nightly recompute for all active users.
   *
   * This is the canonical truth reconciliation job. It:
   *  1. Iterates all active, non-suspended users in configurable batches
   *  2. Recomputes each user's trust score from the canonical formula
   *  3. Rebuilds Redis campus leaderboard sorted sets
   *  4. Waits between batches to avoid DB load spikes
   *  5. Publishes a completion event to Kafka for monitoring
   *
   * The job is guarded by `isRecomputeRunning` to prevent overlapping runs
   * (e.g. if the previous run hasn't finished before the next cron tick).
   *
   * @returns Job metrics: totalUsers, timeMs, errors, batchesProcessed
   */
  async nightlyRecompute(): Promise<NightlyRecomputeResult> {
    if (this.isRecomputeRunning) {
      logger.warn('Nightly recompute already in progress — skipping this run');
      return { totalUsers: 0, timeMs: 0, errors: 0, batchesProcessed: 0 };
    }

    this.isRecomputeRunning = true;
    const startTime = Date.now();
    let totalUsers = 0;
    let errors = 0;
    let batchesProcessed = 0;
    let offset = 0;

    const batchSize = config.NIGHTLY_RECOMPUTE_BATCH_SIZE;
    const batchDelay = config.NIGHTLY_RECOMPUTE_BATCH_DELAY_MS;

    logger.info(
      { batchSize, batchDelay },
      'Starting nightly trust score recompute',
    );

    try {
      // Acquire a distributed lock to prevent multiple instances running simultaneously
      const lockKey = 'trust:nightly_recompute:lock';
      const lockAcquired = await this.acquireDistributedLock(lockKey, 3600);

      if (!lockAcquired) {
        logger.warn(
          'Failed to acquire nightly recompute lock — another instance may be running',
        );
        return { totalUsers: 0, timeMs: 0, errors: 0, batchesProcessed: 0 };
      }

      try {
        while (true) {
          const userIds = await this.repo.getAllActiveUserIds(batchSize, offset);
          if (userIds.length === 0) break;

          const results = await this.repo.batchRecompute(userIds);
          totalUsers += results.size;
          errors += userIds.length - results.size;
          batchesProcessed++;

          // Rebuild Redis sorted sets per campus from fresh scores
          for (const [userId, score] of results) {
            try {
              const campusResult = await this.redis.get(`user:campus:${userId}`);
              if (campusResult) {
                await this.redis.zadd(
                  `${LEADERBOARD_PREFIX}${campusResult}`,
                  score,
                  userId,
                );
              }
            } catch {
              // Non-critical: leaderboard rebuild failure doesn't affect scores
            }
          }

          offset += batchSize;

          // Delay between batches to avoid DB spike
          if (batchDelay > 0) {
            await sleep(batchDelay);
          }

          logger.debug(
            { batchesProcessed, totalUsers, offset },
            'Nightly recompute batch complete',
          );
        }
      } finally {
        // Release the distributed lock
        await this.releaseDistributedLock(lockKey);
      }
    } finally {
      this.isRecomputeRunning = false;
    }

    const timeMs = Date.now() - startTime;

    logger.info(
      { totalUsers, timeMs, errors, batchesProcessed },
      `Nightly recompute complete: ${totalUsers} users in ${timeMs}ms`,
    );

    // Publish completion event for monitoring
    await this.publishNightlyRecomputeComplete(totalUsers, timeMs, errors);

    return { totalUsers, timeMs, errors, batchesProcessed };
  }

  // ── Cron Scheduling ───────────────────────────────────

  /**
   * Start the nightly recompute cron job.
   *
   * This schedules the nightly recompute using the configured cron expression.
   * The default is '30 20 * * *' (20:30 UTC = 02:00 IST).
   *
   * We use a simple setInterval approach with a check against the target time.
   * The interval checks every 60 seconds whether the current time matches
   * the configured schedule (hour and minute match).
   *
   * For production clusters with multiple instances, the distributed lock in
   * `nightlyRecompute()` ensures only one instance runs the job.
   */
  startCron(): void {
    if (!config.ENABLE_NIGHTLY_CRON) {
      logger.info('Nightly cron disabled via ENABLE_NIGHTLY_CRON=false');
      return;
    }

    const cronExpression = config.NIGHTLY_RECOMPUTE_CRON;
    const parts = cronExpression.split(' ');
    if (parts.length !== 5) {
      logger.error(
        { cronExpression },
        'Invalid cron expression — nightly cron not started',
      );
      return;
    }

    const targetMinute = parseInt(parts[0]!, 10);
    const targetHour = parseInt(parts[1]!, 10);

    if (isNaN(targetMinute) || isNaN(targetHour)) {
      logger.error(
        { cronExpression },
        'Non-numeric hour/minute in cron expression — nightly cron not started',
      );
      return;
    }

    logger.info(
      { cronExpression, targetHour, targetMinute },
      'Starting nightly recompute cron',
    );

    // Check every 60 seconds if we've hit the target time
    this.cronInterval = setInterval(() => {
      const now = new Date();
      const utcHour = now.getUTCHours();
      const utcMinute = now.getUTCMinutes();

      if (utcHour === targetHour && utcMinute === targetMinute) {
        logger.info('Nightly cron triggered');
        void this.nightlyRecompute().catch((err) => {
          logger.error({ err }, 'Nightly recompute cron failed');
        });
      }
    }, 60_000);

    // Prevent the interval from keeping the process alive
    if (this.cronInterval.unref) {
      this.cronInterval.unref();
    }
  }

  /**
   * Stop the nightly recompute cron job.
   * Called during graceful shutdown.
   */
  stopCron(): void {
    if (this.cronInterval) {
      clearInterval(this.cronInterval);
      this.cronInterval = null;
      logger.info('Nightly recompute cron stopped');
    }
  }

  // ── Leaderboard ───────────────────────────────────────

  /**
   * Get campus leaderboard from Redis sorted set.
   *
   * On cold start (empty sorted set), the leaderboard is rebuilt from
   * PostgreSQL. The rebuild populates the Redis sorted set for subsequent
   * requests.
   *
   * @param campusId - Campus ID to get leaderboard for
   * @param limit - Maximum entries to return (default: 10, max: 100)
   * @returns Array of leaderboard entries with userId, score, and rank
   */
  async getLeaderboard(
    campusId: string,
    limit = DEFAULT_LEADERBOARD_LIMIT,
  ): Promise<LeaderboardEntry[]> {
    const safeLimit = Math.min(
      Math.max(limit, 1),
      MAX_LEADERBOARD_LIMIT,
    );

    const leaderboardKey = `${LEADERBOARD_PREFIX}${campusId}`;

    let results = await this.redis.zrevrange(
      leaderboardKey,
      0,
      safeLimit - 1,
      'WITHSCORES',
    );

    // Cold start: rebuild from DB if sorted set is empty
    if (results.length === 0) {
      logger.info({ campusId }, 'Leaderboard cold start — rebuilding from DB');
      await this.rebuildCampusLeaderboard(campusId);
      results = await this.redis.zrevrange(
        leaderboardKey,
        0,
        safeLimit - 1,
        'WITHSCORES',
      );
    }

    // Parse ZREVRANGE WITHSCORES result: [userId1, score1, userId2, score2, ...]
    const leaderboard: LeaderboardEntry[] = [];
    for (let i = 0; i < results.length; i += 2) {
      const uid = results[i] as string;
      const sc = results[i + 1] as string;
      leaderboard.push({
        userId: uid,
        score: parseFloat(sc),
        rank: Math.floor(i / 2) + 1,
      });
    }

    return leaderboard;
  }

  /**
   * Rebuild the campus leaderboard Redis sorted set from PostgreSQL.
   *
   * Queries all active users in the campus with their trust scores and
   * populates the Redis sorted set. Sets a TTL on the sorted set to
   * ensure periodic refresh.
   *
   * @param campusId - Campus ID to rebuild the leaderboard for
   */
  async rebuildCampusLeaderboard(campusId: string): Promise<void> {
    logger.info({ campusId }, 'Rebuilding campus leaderboard from DB');

    try {
      const users = await this.repo.getCampusUserScores(
        campusId,
        LEADERBOARD_REBUILD_LIMIT,
      );

      if (users.length === 0) {
        logger.info({ campusId }, 'No users found for campus leaderboard');
        return;
      }

      const leaderboardKey = `${LEADERBOARD_PREFIX}${campusId}`;

      // Use a pipeline for atomic batch insert
      const pipeline = this.redis.pipeline();

      // Clear existing sorted set before rebuilding
      pipeline.del(leaderboardKey);

      for (const user of users) {
        pipeline.zadd(leaderboardKey, user.trustScore, user.userId);
      }

      // Set TTL on the sorted set for periodic refresh
      pipeline.expire(leaderboardKey, config.LEADERBOARD_CACHE_TTL_SECS);

      await pipeline.exec();

      logger.info(
        { campusId, userCount: users.length },
        'Campus leaderboard rebuilt',
      );
    } catch (err) {
      logger.error(
        { err, campusId },
        'Failed to rebuild campus leaderboard',
      );
    }
  }

  // ── Score Retrieval ───────────────────────────────────

  /**
   * Get the current trust score and tier for a user.
   *
   * @param userId - User ID to get score for
   * @returns Score and tier
   */
  async getScore(userId: string): Promise<ScoreWithTier> {
    const score = await this.repo.getScore(userId);
    return { score, tier: getTier(score) };
  }

  // ── Event History ─────────────────────────────────────

  /**
   * Get trust event history for a user.
   *
   * @param userId - User ID to get history for
   * @param limit - Maximum events to return (default: 50)
   * @returns Array of trust score events, newest first
   */
  async getHistory(userId: string, limit = 50): Promise<TrustScoreEvent[]> {
    return this.repo.getEventsForUser(userId, limit);
  }

  // ── Kafka Event Publishing (Private) ──────────────────

  /**
   * Publish a tier upgrade event to Kafka.
   * Non-critical: failures are logged and swallowed.
   *
   * @param userId - User whose tier changed
   * @param oldTier - Previous tier name
   * @param newTier - New tier name
   * @param score - Current trust score
   */
  private async publishTierUpgrade(
    userId: string,
    oldTier: string,
    newTier: string,
    score: number,
  ): Promise<void> {
    if (!this.kafkaProducer) return;

    try {
      await this.kafkaProducer.send(KafkaTopics.TRUST_TIER_UPGRADED, [
        {
          key: userId,
          value: JSON.stringify({
            type: KafkaTopics.TRUST_TIER_UPGRADED,
            payload: {
              userId,
              oldTier,
              newTier,
              score,
            },
            timestamp: new Date().toISOString(),
          }),
        },
      ]);

      // Also trigger a notification
      await this.kafkaProducer.send(KafkaTopics.NOTIFICATION_TRIGGER, [
        {
          key: userId,
          value: JSON.stringify({
            type: KafkaTopics.NOTIFICATION_TRIGGER,
            payload: {
              userId,
              template: 'trust_tier_upgrade',
              data: { oldTier, newTier, score },
            },
            timestamp: new Date().toISOString(),
          }),
        },
      ]);
    } catch (err) {
      logger.warn(
        { err, userId, oldTier, newTier },
        'Failed to publish tier upgrade event',
      );
    }
  }

  /**
   * Publish a nightly recompute completion event to Kafka.
   * Used for monitoring dashboards and alerting.
   *
   * @param totalUsers - Total users processed
   * @param timeMs - Wall-clock time for the job
   * @param errors - Number of individual failures
   */
  private async publishNightlyRecomputeComplete(
    totalUsers: number,
    timeMs: number,
    errors: number,
  ): Promise<void> {
    if (!this.kafkaProducer) return;

    try {
      await this.kafkaProducer.send(
        KafkaTopics.TRUST_NIGHTLY_RECOMPUTE_COMPLETE,
        [
          {
            key: 'nightly',
            value: JSON.stringify({
              type: KafkaTopics.TRUST_NIGHTLY_RECOMPUTE_COMPLETE,
              payload: { totalUsers, timeMs, errors },
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      );
    } catch (err) {
      logger.warn(
        { err },
        'Failed to publish nightly recompute completion event',
      );
    }
  }

  // ── Distributed Locking ───────────────────────────────

  /**
   * Acquire a distributed lock using Redis SETNX.
   * Used to ensure only one instance runs the nightly recompute.
   *
   * @param key - Lock key
   * @param ttlSecs - Time-to-live for the lock in seconds
   * @returns true if lock was acquired, false otherwise
   */
  private async acquireDistributedLock(
    key: string,
    ttlSecs: number,
  ): Promise<boolean> {
    try {
      const result = await this.redis.set(key, Date.now().toString(), 'EX', ttlSecs, 'NX');
      return result === 'OK';
    } catch (err) {
      logger.warn({ err, key }, 'Failed to acquire distributed lock');
      // If Redis is down, allow the recompute to proceed (single-instance fallback)
      return true;
    }
  }

  /**
   * Release a distributed lock.
   *
   * @param key - Lock key to release
   */
  private async releaseDistributedLock(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (err) {
      logger.warn({ err, key }, 'Failed to release distributed lock');
    }
  }
}
