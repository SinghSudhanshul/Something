/**
 * Trust Fraud Detection Service
 * 
 * This module provides comprehensive fraud detection for the NEXUS platform.
 * It combines:
 *  1. Rule-based heuristic scoring for obvious fraud patterns
 *  2. ML model scoring via HTTP call to the Analytics service
 *  3. Fraud flag management with auto-suspension after threshold violations
 *  4. Velocity tracking and rate limiting per user
 *  5. Audit logging for compliance and review
 *
 * Design principle: FAIL OPEN. If the ML model is unavailable, transactions
 * are allowed with the rule-based score. We never block legitimate users due
 * to infrastructure failures.
 *
 * @module fraud/fraud.service
 */

import { createLogger } from '@nexus/utils';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';

const logger = createLogger('trust-fraud-service');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface FraudScoreRequest {
  userId: string;
  transactionId: string;
  amount: number; // in paise
  recipientId: string;
  module: string; // 'bazaar' | 'wallet' | 'skills' | 'rides'
  userTrustScore: number;
  userAge: number; // days since registration
  transactionsLast24h: number;
  transactionsLast7d: number;
  uniqueRecipientsLast7d: number;
  isNewRecipient: boolean;
  hourOfDay: number;
  dayOfWeek?: number;
  ipAddress?: string;
  deviceFingerprint?: string;
}

export interface FraudScoreResponse {
  /** Fraud risk score 0-100 (0 = clean, 100 = definite fraud) */
  score: number;
  /** Action to take based on score */
  action: FraudAction;
  /** Whether the ML model was available */
  modelAvailable: boolean;
  /** Feature values used for scoring */
  features: Record<string, unknown>;
  /** Unique scoring session ID for audit */
  scoringId: string;
  /** Time taken for scoring in ms */
  latencyMs: number;
}

export type FraudAction =
  | 'allow'
  | 'allow_with_monitoring'
  | 'require_selfie_verification'
  | 'block_pending_review';

export interface FraudFlag {
  id: string;
  userId: string;
  flagType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  metadata: Record<string, unknown>;
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: Date;
  createdAt: Date;
}

export interface FraudFlagInput {
  userId: string;
  flagType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  metadata?: Record<string, unknown>;
}

export interface VelocityCheckResult {
  withinLimits: boolean;
  transactions24h: number;
  transactions7d: number;
  uniqueRecipients7d: number;
  violatedRule?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Score thresholds for action determination */
const THRESHOLDS = {
  allow: 20,         // 0-20: clean
  monitor: 50,       // 21-50: suspicious, allow with monitoring
  selfie: 75,        // 51-75: high risk, require selfie
  block: 100,        // 76-100: block pending review
} as const;

/** Auto-suspension: N flags in M days triggers account suspension */
const AUTO_SUSPEND = {
  flagCount: 3,
  windowDays: 7,
} as const;

/** Velocity limits per tier */
const VELOCITY_LIMITS: Record<string, { max24h: number; max7d: number; maxRecipients7d: number }> = {
  new:      { max24h: 5,  max7d: 15, maxRecipients7d: 5 },
  building: { max24h: 10, max7d: 30, maxRecipients7d: 10 },
  trusted:  { max24h: 20, max7d: 60, maxRecipients7d: 20 },
  verified: { max24h: 30, max7d: 100, maxRecipients7d: 30 },
  elite:    { max24h: 50, max7d: 200, maxRecipients7d: 50 },
};

/** Model call timeout in milliseconds */
const MODEL_TIMEOUT_MS = 3000;

/** Cache duration for model availability status */
const MODEL_STATUS_CACHE_MS = 30_000;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Service Implementation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class FraudService {
  private modelUrl: string;
  private _modelAvailable = true;
  private lastModelCheck = 0;
  private modelFailCount = 0;
  private db: Pool | null;
  private redis: Redis | null;

  constructor(modelUrl: string, db?: Pool, redis?: Redis) {
    this.modelUrl = modelUrl;
    this.db = db ?? null;
    this.redis = redis ?? null;
  }

  // ── Transaction Scoring ─────────────────────────

  /**
   * Score a transaction for fraud risk.
   * 
   * Pipeline:
   *  1. Rule-based quick checks (bypass model for obvious cases)
   *  2. Velocity check against tier-based limits
   *  3. ML model scoring (with 3s timeout)
   *  4. Combine rule and model scores (take maximum)
   *  5. Log scoring result for audit
   *  6. Return action recommendation
   */
  async scoreTransaction(req: FraudScoreRequest): Promise<FraudScoreResponse> {
    const startTime = Date.now();
    const scoringId = `fraud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
      // Step 1: Rule-based quick-checks
      const ruleResult = this.ruleBasedScore(req);
      if (ruleResult !== null && ruleResult.score >= THRESHOLDS.selfie) {
        // High-confidence rule match — skip model
        const response: FraudScoreResponse = {
          score: ruleResult.score,
          action: ruleResult.action as FraudAction,
          modelAvailable: false,
          features: { method: 'rule_based', ...ruleResult.features },
          scoringId,
          latencyMs: Date.now() - startTime,
        };
        await this.logScoringResult(req, response);
        return response;
      }

      // Step 2: Velocity checks
      const velocityResult = await this.checkVelocity(req);
      let velocityScore = 0;
      if (!velocityResult.withinLimits) {
        velocityScore = 60; // Velocity violation = moderate risk
      }

      // Step 3: ML model scoring
      let modelScore = 0;
      let modelAvailable = false;
      let modelFeatures: Record<string, unknown> = {};

      if (this.shouldCallModel()) {
        try {
          const modelResult = await this.callModel(req);
          modelScore = modelResult.score;
          modelAvailable = true;
          modelFeatures = modelResult.features;
          this._modelAvailable = true;
          this.modelFailCount = 0;
        } catch (err: unknown) {
          this._modelAvailable = false;
          this.lastModelCheck = Date.now();
          this.modelFailCount++;
          logger.warn(
            { err, userId: req.userId, transactionId: req.transactionId, failCount: this.modelFailCount },
            'Fraud model unreachable — failing open',
          );
        }
      }

      // Step 4: Combine scores (take maximum risk signal)
      const ruleScore = ruleResult?.score ?? 0;
      const finalScore = Math.max(ruleScore, modelScore, velocityScore);
      const action = this.scoreToAction(finalScore);

      const response: FraudScoreResponse = {
        score: finalScore,
        action,
        modelAvailable,
        features: {
          ruleScore,
          modelScore,
          velocityScore,
          velocity: velocityResult,
          ...modelFeatures,
          ...(ruleResult?.features ?? {}),
        },
        scoringId,
        latencyMs: Date.now() - startTime,
      };

      // Step 5: Log for audit
      await this.logScoringResult(req, response);

      // Step 6: Auto-flag high-risk transactions
      if (finalScore >= THRESHOLDS.monitor) {
        await this.createFlag({
          userId: req.userId,
          flagType: 'high_risk_transaction',
          severity: finalScore >= THRESHOLDS.selfie ? 'high' : 'medium',
          description: `Transaction ${req.transactionId} scored ${finalScore}/100`,
          metadata: {
            transactionId: req.transactionId,
            amount: req.amount,
            score: finalScore,
            action,
          },
        });
      }

      return response;
    } catch (err: unknown) {
      // FAIL OPEN — never block on scoring errors
      logger.error({ err, userId: req.userId }, 'Fraud scoring error — failing open');
      return {
        score: 0,
        action: 'allow',
        modelAvailable: false,
        features: { failOpen: true, error: String(err) },
        scoringId,
        latencyMs: Date.now() - startTime,
      };
    }
  }

  // ── Rule-Based Scoring ─────────────────────────

  /**
   * Rule-based heuristic scoring for obvious fraud patterns.
   * Returns null if no rule matches (defer to ML model).
   */
  private ruleBasedScore(
    req: FraudScoreRequest,
  ): { score: number; action: string; features: Record<string, unknown> } | null {
    const triggers: string[] = [];
    let maxScore = 0;

    // Rule 1: Very high velocity (>20 txns in 24h)
    if (req.transactionsLast24h > 20) {
      triggers.push('high_velocity_24h');
      maxScore = Math.max(maxScore, 85);
    }

    // Rule 2: New user (<3 days) sending large amount (>₹5000)
    if (req.userAge < 3 && req.amount > 500000) {
      triggers.push('new_user_large_amount');
      maxScore = Math.max(maxScore, 70);
    }

    // Rule 3: Many unique recipients (>15 in 7 days)
    if (req.uniqueRecipientsLast7d > 15) {
      triggers.push('many_recipients');
      maxScore = Math.max(maxScore, 65);
    }

    // Rule 4: Night-time large transaction for low-trust users
    if (
      (req.hourOfDay >= 23 || req.hourOfDay < 5) &&
      req.amount > 200000 &&
      req.userTrustScore < 2.0
    ) {
      triggers.push('night_low_trust_large');
      maxScore = Math.max(maxScore, 60);
    }

    // Rule 5: Self-transaction (same user = sender and recipient)
    if (req.userId === req.recipientId) {
      triggers.push('self_transaction');
      maxScore = Math.max(maxScore, 90);
    }

    // Rule 6: Rapid new-recipient transactions
    if (req.isNewRecipient && req.transactionsLast24h > 10) {
      triggers.push('rapid_new_recipients');
      maxScore = Math.max(maxScore, 55);
    }

    // Rule 7: Very new user with high velocity
    if (req.userAge < 1 && req.transactionsLast24h > 5) {
      triggers.push('day_one_velocity');
      maxScore = Math.max(maxScore, 75);
    }

    // Rule 8: Low trust score with large cross-module transaction
    if (req.userTrustScore < 1.5 && req.amount > 100000 && req.module !== 'wallet') {
      triggers.push('low_trust_cross_module');
      maxScore = Math.max(maxScore, 55);
    }

    if (triggers.length === 0) return null;

    return {
      score: maxScore,
      action: this.scoreToAction(maxScore),
      features: { triggers, method: 'rule_based' },
    };
  }

  // ── ML Model Call ──────────────────────────────

  /**
   * Check if we should call the model (skip if recently failed).
   */
  private shouldCallModel(): boolean {
    if (this._modelAvailable) return true;
    // Retry after MODEL_STATUS_CACHE_MS
    return Date.now() - this.lastModelCheck > MODEL_STATUS_CACHE_MS;
  }

  /**
   * Call the ML fraud model with timeout.
   */
  private async callModel(req: FraudScoreRequest): Promise<{ score: number; features: Record<string, unknown> }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);

    try {
      const response = await fetch(this.modelUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Model returned ${response.status}: ${response.statusText}`);
      }

      const result = (await response.json()) as { score: number; features: Record<string, unknown> };

      if (typeof result.score !== 'number' || result.score < 0 || result.score > 100) {
        throw new Error(`Invalid model score: ${result.score}`);
      }

      return {
        score: result.score,
        features: result.features ?? {},
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Velocity Check ─────────────────────────────

  /**
   * Check transaction velocity against tier-based limits.
   */
  async checkVelocity(req: FraudScoreRequest): Promise<VelocityCheckResult> {
    const tier = this.scoreToTier(req.userTrustScore);
    const limits = VELOCITY_LIMITS[tier] ?? VELOCITY_LIMITS['new']!;

    const result: VelocityCheckResult = {
      withinLimits: true,
      transactions24h: req.transactionsLast24h,
      transactions7d: req.transactionsLast7d,
      uniqueRecipients7d: req.uniqueRecipientsLast7d,
    };

    if (req.transactionsLast24h >= limits.max24h) {
      result.withinLimits = false;
      result.violatedRule = `24h_limit_exceeded: ${req.transactionsLast24h}/${limits.max24h}`;
    } else if (req.transactionsLast7d >= limits.max7d) {
      result.withinLimits = false;
      result.violatedRule = `7d_limit_exceeded: ${req.transactionsLast7d}/${limits.max7d}`;
    } else if (req.uniqueRecipientsLast7d >= limits.maxRecipients7d) {
      result.withinLimits = false;
      result.violatedRule = `recipients_7d_exceeded: ${req.uniqueRecipientsLast7d}/${limits.maxRecipients7d}`;
    }

    return result;
  }

  private scoreToTier(score: number): string {
    if (score >= 4.25) return 'elite';
    if (score >= 3.50) return 'verified';
    if (score >= 2.50) return 'trusted';
    if (score >= 1.50) return 'building';
    return 'new';
  }

  // ── Score-to-Action Mapping ────────────────────

  private scoreToAction(score: number): FraudAction {
    if (score < THRESHOLDS.allow) return 'allow';
    if (score < THRESHOLDS.monitor) return 'allow_with_monitoring';
    if (score < THRESHOLDS.selfie) return 'require_selfie_verification';
    return 'block_pending_review';
  }

  // ── Fraud Flag Management ─────────────────────

  /**
   * Create a fraud flag and check for auto-suspension threshold.
   * 3 flags in 7 days triggers automatic account suspension.
   */
  async createFlag(input: FraudFlagInput): Promise<void> {
    if (!this.db) {
      logger.warn({ input }, 'No DB connection — skipping flag creation');
      return;
    }

    try {
      // Insert flag
      await this.db.query(
        `INSERT INTO fraud_flags (user_id, flag_type, severity, description, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.userId, input.flagType, input.severity, input.description, JSON.stringify(input.metadata ?? {})],
      );

      // Check auto-suspension threshold
      const { rows } = await this.db.query(
        `SELECT COUNT(*) AS flag_count
         FROM fraud_flags
         WHERE user_id = $1
           AND resolved = false
           AND created_at >= NOW() - INTERVAL '${AUTO_SUSPEND.windowDays} days'`,
        [input.userId],
      );

      const flagCount = parseInt(rows[0]?.flag_count ?? '0', 10);

      if (flagCount >= AUTO_SUSPEND.flagCount) {
        logger.error(
          { userId: input.userId, flagCount, windowDays: AUTO_SUSPEND.windowDays },
          '🚨 Auto-suspension threshold reached',
        );

        // Suspend account
        await this.db.query(
          `UPDATE users SET status = 'suspended', updated_at = NOW() WHERE id = $1`,
          [input.userId],
        );

        // Also update student_profiles
        await this.db.query(
          `UPDATE student_profiles SET is_suspended = true, updated_at = NOW() WHERE user_id = $1`,
          [input.userId],
        );

        logger.info({ userId: input.userId }, 'Account auto-suspended due to fraud flags');
      }
    } catch (err: unknown) {
      logger.error({ err, input }, 'Failed to create fraud flag');
    }
  }

  /**
   * Get fraud flags for a user, optionally filtered by resolved status.
   */
  async getFlags(userId: string, includeResolved = false): Promise<FraudFlag[]> {
    if (!this.db) return [];

    try {
      const query = includeResolved
        ? `SELECT * FROM fraud_flags WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`
        : `SELECT * FROM fraud_flags WHERE user_id = $1 AND resolved = false ORDER BY created_at DESC LIMIT 50`;

      const { rows } = await this.db.query(query, [userId]);

      return rows.map((r: any) => ({
        id: r.id,
        userId: r.user_id,
        flagType: r.flag_type,
        severity: r.severity,
        description: r.description,
        metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
        resolved: r.resolved,
        resolvedBy: r.resolved_by,
        resolvedAt: r.resolved_at,
        createdAt: r.created_at,
      }));
    } catch (err: unknown) {
      logger.error({ err, userId }, 'Failed to get fraud flags');
      return [];
    }
  }

  /**
   * Get all unresolved fraud flags across all users (admin view).
   */
  async getAllActiveFlags(limit = 50, offset = 0): Promise<FraudFlag[]> {
    if (!this.db) return [];

    try {
      const { rows } = await this.db.query(
        `SELECT ff.*, sp.full_name AS user_name
         FROM fraud_flags ff
         LEFT JOIN student_profiles sp ON sp.user_id = ff.user_id
         WHERE ff.resolved = false
         ORDER BY ff.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      );

      return rows.map((r: any) => ({
        id: r.id,
        userId: r.user_id,
        flagType: r.flag_type,
        severity: r.severity,
        description: r.description,
        metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
        resolved: r.resolved,
        resolvedBy: r.resolved_by,
        resolvedAt: r.resolved_at,
        createdAt: r.created_at,
      }));
    } catch (err: unknown) {
      logger.error({ err }, 'Failed to get all active flags');
      return [];
    }
  }

  /**
   * Resolve a fraud flag (admin action).
   */
  async resolveFlag(flagId: string, resolvedBy: string): Promise<boolean> {
    if (!this.db) return false;

    try {
      const result = await this.db.query(
        `UPDATE fraud_flags 
         SET resolved = true, resolved_by = $1, resolved_at = NOW()
         WHERE id = $2 AND resolved = false`,
        [resolvedBy, flagId],
      );
      return (result.rowCount ?? 0) > 0;
    } catch (err: unknown) {
      logger.error({ err, flagId }, 'Failed to resolve fraud flag');
      return false;
    }
  }

  // ── Audit Logging ─────────────────────────────

  /**
   * Log scoring result for compliance audit trail.
   */
  private async logScoringResult(req: FraudScoreRequest, response: FraudScoreResponse): Promise<void> {
    if (!this.redis) return;

    try {
      const auditEntry = {
        scoringId: response.scoringId,
        userId: req.userId,
        transactionId: req.transactionId,
        amount: req.amount,
        score: response.score,
        action: response.action,
        modelAvailable: response.modelAvailable,
        latencyMs: response.latencyMs,
        timestamp: new Date().toISOString(),
      };

      // Store in Redis sorted set by timestamp (auto-cleanup after 30 days)
      const key = `fraud:audit:${req.userId}`;
      await this.redis.zadd(key, Date.now(), JSON.stringify(auditEntry));
      await this.redis.expire(key, 30 * 24 * 60 * 60); // 30 day TTL

      // Also store in a global audit stream
      await this.redis.xadd(
        'fraud:audit:stream',
        'MAXLEN', '~', '10000', // Keep last ~10000 entries
        '*',
        'data', JSON.stringify(auditEntry),
      );
    } catch (err: unknown) {
      // Audit logging is non-critical
      logger.debug({ err }, 'Failed to log fraud scoring result');
    }
  }

  // ── Model Health ──────────────────────────────

  get isModelAvailable(): boolean {
    return this._modelAvailable;
  }

  get modelFailureCount(): number {
    return this.modelFailCount;
  }

  /**
   * Health check for the fraud model endpoint.
   */
  async checkModelHealth(): Promise<{ available: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.modelUrl.replace('/predict', '/health')}`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      return { available: response.ok, latencyMs: Date.now() - start };
    } catch {
      return { available: false, latencyMs: Date.now() - start };
    }
  }
}
