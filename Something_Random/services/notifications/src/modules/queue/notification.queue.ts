/**
 * Notification Queue — BullMQ Queue Manager
 *
 * Central queue manager that receives notification requests and dispatches
 * them to the appropriate channel workers (push, email, sms, in_app).
 *
 * Features:
 *  - User preference checking before enqueuing
 *  - Quiet hours respect (delay NORMAL, send CRITICAL immediately)
 *  - Notification log creation (status=queued)
 *  - Per-user rate limiting
 *  - Priority-based queue ordering
 *  - Template rendering before dispatch
 *
 * @module queue/notification.queue
 */

import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { createLogger } from '@nexus/utils';
import { config } from '../../config.js';

const logger = createLogger('notification-queue');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface NotificationJob {
  userId: string;
  title: string;
  body: string;
  templateType: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  actionUrl?: string;
  emailHtml?: string;
  emailSubject?: string;
  data?: Record<string, unknown>;
}

export interface EnqueueRequest {
  userId: string;
  templateType: string;
  channels: Array<'push' | 'email' | 'sms' | 'in_app'>;
  priority: 'critical' | 'high' | 'normal' | 'low';
  title: string;
  body: string;
  actionUrl?: string;
  emailHtml?: string;
  emailSubject?: string;
  data?: Record<string, unknown>;
}

interface UserPreferences {
  push_enabled: boolean;
  email_enabled: boolean;
  sms_enabled: boolean;
  in_app_enabled: boolean;
  quiet_hours_start: string | null; // "22:00" format
  quiet_hours_end: string | null;   // "07:00" format
  quiet_hours_timezone: string;
  module_preferences: Record<string, boolean>;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Rate limit: max notifications per user per minute */
const USER_RATE_LIMIT_PER_MIN = 30;

/** Rate limit: max notifications per user per hour */
const USER_RATE_LIMIT_PER_HOUR = 100;

/** Priority to BullMQ priority mapping (lower = higher priority) */
const PRIORITY_MAP: Record<string, number> = {
  critical: 1,
  high: 2,
  normal: 5,
  low: 10,
};

/** Queue names for each channel */
const QUEUE_NAMES = {
  push: 'nexus:notifications:push',
  email: 'nexus:notifications:email',
  sms: 'nexus:notifications:sms',
  in_app: 'nexus:notifications:in_app',
} as const;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Queue Manager
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class NotificationQueueManager {
  private queues: Map<string, Queue> = new Map();

  constructor(
    private readonly redis: Redis,
    private readonly db: Pool,
  ) {
    // Initialize queues for each channel
    for (const [channel, queueName] of Object.entries(QUEUE_NAMES)) {
      this.queues.set(channel, new Queue(queueName, {
        connection: redis,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
        },
      }));
    }

    logger.info({ channels: Object.keys(QUEUE_NAMES) }, 'Notification queues initialized');
  }

  /**
   * Enqueue a notification for delivery across requested channels.
   *
   * Pipeline:
   *  1. Check per-user rate limit
   *  2. Load user preferences
   *  3. Filter channels based on preferences
   *  4. Check quiet hours (delay if applicable)
   *  5. Log to notification_log (status=queued)
   *  6. Enqueue to each channel's BullMQ queue
   */
  async enqueue(request: EnqueueRequest): Promise<{ enqueuedChannels: string[]; skippedChannels: string[] }> {
    const { userId, channels, priority, templateType } = request;
    const enqueuedChannels: string[] = [];
    const skippedChannels: string[] = [];

    // Step 1: Rate limiting (skip for CRITICAL)
    if (priority !== 'critical') {
      const isRateLimited = await this.checkRateLimit(userId);
      if (isRateLimited) {
        logger.warn({ userId, templateType }, 'User notification rate limited');
        return { enqueuedChannels: [], skippedChannels: channels };
      }
    }

    // Step 2: Load user preferences
    const prefs = await this.getUserPreferences(userId);

    // Step 3-4: Process each channel
    for (const channel of channels) {
      try {
        // Check channel preference (CRITICAL overrides preferences)
        if (priority !== 'critical' && !this.isChannelEnabled(prefs, channel, templateType)) {
          skippedChannels.push(channel);
          logger.debug({ userId, channel, templateType }, 'Channel disabled by preferences');
          continue;
        }

        // Calculate delay for quiet hours
        let delay = 0;
        if (priority !== 'critical' && channel !== 'in_app') {
          delay = this.calculateQuietHoursDelay(prefs);
          if (delay > 0) {
            logger.debug({ userId, channel, delayMs: delay }, 'Notification delayed for quiet hours');
          }
        }

        // Step 5: Log to notification_log
        await this.logNotification(userId, templateType, channel, 'queued');

        // Step 6: Enqueue to BullMQ
        const queue = this.queues.get(channel);
        if (!queue) {
          skippedChannels.push(channel);
          continue;
        }

        const jobData = {
          userId: request.userId,
          title: request.title,
          body: request.body,
          templateType: request.templateType,
          priority: request.priority,
          ...(request.actionUrl !== undefined && { actionUrl: request.actionUrl }),
          ...(request.emailHtml !== undefined && { emailHtml: request.emailHtml }),
          ...(request.emailSubject !== undefined && { emailSubject: request.emailSubject }),
          ...(request.data !== undefined && { data: request.data }),
        } as NotificationJob;

        const jobOptions: JobsOptions = {
          priority: PRIORITY_MAP[priority] ?? 5,
          ...(delay > 0 ? { delay } : {}),
          jobId: `${templateType}:${userId}:${channel}:${Date.now()}`,
        };

        await queue.add(`notify-${channel}`, jobData, jobOptions);
        enqueuedChannels.push(channel);

        // Increment rate limit counter
        await this.incrementRateCounter(userId);

      } catch (err: unknown) {
        logger.error({ err, userId, channel, templateType }, 'Failed to enqueue notification');
        skippedChannels.push(channel);
      }
    }

    logger.info(
      { userId, templateType, priority, enqueuedChannels, skippedChannels },
      'Notification enqueue complete',
    );

    return { enqueuedChannels, skippedChannels };
  }

  // ── Preference Management ─────────────────

  /**
   * Load user notification preferences with Redis cache.
   */
  private async getUserPreferences(userId: string): Promise<UserPreferences> {
    const cacheKey = `notification_prefs:${userId}`;
    const defaultPrefs: UserPreferences = {
      push_enabled: true,
      email_enabled: true,
      sms_enabled: false,
      in_app_enabled: true,
      quiet_hours_start: null,
      quiet_hours_end: null,
      quiet_hours_timezone: 'Asia/Kolkata',
      module_preferences: {},
    };

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch {
      // Cache miss
    }

    try {
      const { rows } = await this.db.query(
        'SELECT * FROM notification_preferences WHERE user_id = $1',
        [userId],
      );

      if (rows.length === 0) {
        // Cache default preferences
        await this.redis.set(cacheKey, JSON.stringify(defaultPrefs), 'EX', 300).catch(() => {});
        return defaultPrefs;
      }

      const row = rows[0];
      const prefs: UserPreferences = {
        push_enabled: row.push_enabled ?? true,
        email_enabled: row.email_enabled ?? true,
        sms_enabled: row.sms_enabled ?? false,
        in_app_enabled: row.in_app_enabled ?? true,
        quiet_hours_start: row.quiet_hours_start,
        quiet_hours_end: row.quiet_hours_end,
        quiet_hours_timezone: row.quiet_hours_timezone ?? 'Asia/Kolkata',
        module_preferences: typeof row.module_preferences === 'string'
          ? JSON.parse(row.module_preferences)
          : row.module_preferences ?? {},
      };

      await this.redis.set(cacheKey, JSON.stringify(prefs), 'EX', 300).catch(() => {});
      return prefs;
    } catch (err) {
      logger.warn({ err, userId }, 'Failed to load notification preferences — using defaults');
      return defaultPrefs;
    }
  }

  /**
   * Check if a specific channel is enabled for a template type.
   */
  private isChannelEnabled(prefs: UserPreferences, channel: string, templateType: string): boolean {
    // Check channel-level preference
    const channelKey = `${channel}_enabled` as keyof UserPreferences;
    if (prefs[channelKey] === false) return false;

    // Check module-level preference
    const moduleKey = `${templateType}:${channel}`;
    if (prefs.module_preferences[moduleKey] === false) return false;

    return true;
  }

  // ── Quiet Hours ────────────────────────────

  /**
   * Calculate delay in milliseconds to respect quiet hours.
   * Returns 0 if not in quiet hours.
   */
  private calculateQuietHoursDelay(prefs: UserPreferences): number {
    if (!prefs.quiet_hours_start || !prefs.quiet_hours_end) return 0;

    try {
      const now = new Date();
      const tz = prefs.quiet_hours_timezone || 'Asia/Kolkata';

      // Get current time in user's timezone
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      });

      const parts = formatter.formatToParts(now);
      const currentHour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
      const currentMinute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
      const currentMinutes = currentHour * 60 + currentMinute;

      const [startH, startM] = prefs.quiet_hours_start.split(':').map(Number);
      const [endH, endM] = prefs.quiet_hours_end.split(':').map(Number);
      const startMinutes = (startH ?? 0) * 60 + (startM ?? 0);
      const endMinutes = (endH ?? 0) * 60 + (endM ?? 0);

      let inQuietHours = false;

      if (startMinutes <= endMinutes) {
        // Same day: e.g., 22:00 - 23:00 (unlikely but supported)
        inQuietHours = currentMinutes >= startMinutes && currentMinutes < endMinutes;
      } else {
        // Overnight: e.g., 22:00 - 07:00
        inQuietHours = currentMinutes >= startMinutes || currentMinutes < endMinutes;
      }

      if (!inQuietHours) return 0;

      // Calculate delay until quiet hours end
      let delayMinutes: number;
      if (currentMinutes < endMinutes) {
        delayMinutes = endMinutes - currentMinutes;
      } else {
        delayMinutes = (24 * 60 - currentMinutes) + endMinutes;
      }

      return delayMinutes * 60 * 1000; // Convert to milliseconds
    } catch (err) {
      logger.debug({ err }, 'Failed to calculate quiet hours delay');
      return 0;
    }
  }

  // ── Rate Limiting ──────────────────────────

  /**
   * Check if user has exceeded notification rate limits.
   */
  private async checkRateLimit(userId: string): Promise<boolean> {
    try {
      const minuteKey = `notif_rate:${userId}:min`;
      const hourKey = `notif_rate:${userId}:hr`;

      const [minuteCount, hourCount] = await Promise.all([
        this.redis.get(minuteKey),
        this.redis.get(hourKey),
      ]);

      if (parseInt(minuteCount ?? '0', 10) >= USER_RATE_LIMIT_PER_MIN) return true;
      if (parseInt(hourCount ?? '0', 10) >= USER_RATE_LIMIT_PER_HOUR) return true;

      return false;
    } catch {
      return false; // Fail open
    }
  }

  /**
   * Increment rate limit counters.
   */
  private async incrementRateCounter(userId: string): Promise<void> {
    try {
      const minuteKey = `notif_rate:${userId}:min`;
      const hourKey = `notif_rate:${userId}:hr`;

      const pipeline = this.redis.pipeline();
      pipeline.incr(minuteKey);
      pipeline.expire(minuteKey, 60);
      pipeline.incr(hourKey);
      pipeline.expire(hourKey, 3600);
      await pipeline.exec();
    } catch {
      // Non-critical
    }
  }

  // ── Logging ────────────────────────────────

  /**
   * Log notification to notification_log table.
   */
  private async logNotification(
    userId: string,
    type: string,
    channel: string,
    status: string,
  ): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO notification_log (user_id, type, channel, status, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [userId, type, channel, status],
      );
    } catch {
      // Non-critical
    }
  }

  // ── Cleanup ────────────────────────────────

  /**
   * Close all queues. Call during graceful shutdown.
   */
  async close(): Promise<void> {
    for (const [channel, queue] of this.queues) {
      try {
        await queue.close();
        logger.debug({ channel }, 'Queue closed');
      } catch (err) {
        logger.warn({ err, channel }, 'Error closing queue');
      }
    }
    logger.info('All notification queues closed');
  }
}
