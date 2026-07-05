/**
 * Notification Kafka Consumer — Full production implementation
 *
 * Consumes the nexus.notifications.trigger topic from ALL NEXUS services.
 * Each event contains the target user, notification type, channels, and template data.
 *
 * Pipeline:
 *  1. Parse and validate incoming event
 *  2. Render notification templates
 *  3. Check user preferences
 *  4. Enqueue to appropriate channel workers via NotificationQueueManager
 *  5. Idempotency via Redis SETNX (prevent duplicate processing)
 *  6. DLQ after 3 retries
 *
 * @module consumers/notification.consumer
 */

import type { Consumer, EachMessagePayload, Producer as KafkaProducer } from 'kafkajs';
import type { Redis } from 'ioredis';
import { createLogger } from '@nexus/utils';
import { NotificationQueueManager, type EnqueueRequest } from '../modules/queue/notification.queue.js';
import { renderTemplate, type TemplateResult } from '../modules/templates/templates.js';

const logger = createLogger('notification-consumer');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Incoming notification trigger event from any NEXUS service */
interface NotificationTriggerEvent {
  /** Target user ID */
  userId: string;
  /** Notification template type (e.g., 'order_status_update', 'ride_matched') */
  type: string;
  /** Delivery channels to use */
  channels: Array<'push' | 'email' | 'sms' | 'in_app'>;
  /** Priority level */
  priority: 'critical' | 'high' | 'normal' | 'low';
  /** Template variables */
  data: Record<string, unknown>;
  /** Optional action URL for deep linking */
  actionUrl?: string;
  /** Optional: override title (uses template default if not provided) */
  title?: string;
  /** Optional: override body (uses template default if not provided) */
  body?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Topics to consume */
const CONSUMED_TOPICS = [
  'nexus.notifications.trigger',
  'nexus.notifications.bulk',
];

/** Maximum retries before DLQ */
const MAX_RETRIES = 3;

/** Idempotency key TTL in seconds (24 hours) */
const IDEMPOTENCY_TTL = 86400;

/** Valid channels */
const VALID_CHANNELS = new Set(['push', 'email', 'sms', 'in_app']);

/** Valid priorities */
const VALID_PRIORITIES = new Set(['critical', 'high', 'normal', 'low']);

/** Default channels when none specified */
const DEFAULT_CHANNELS: Array<'push' | 'email' | 'sms' | 'in_app'> = ['push', 'in_app'];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Consumer Setup
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function setupNotificationConsumer(
  consumer: Consumer,
  queueManager: NotificationQueueManager,
  redis: Redis,
  dlqProducer?: KafkaProducer,
): Promise<void> {
  await consumer.subscribe({
    topics: CONSUMED_TOPICS,
    fromBeginning: false,
  });

  // Stats tracking
  let processedCount = 0;
  let errorCount = 0;
  let duplicateCount = 0;
  let invalidCount = 0;

  const statsInterval = setInterval(() => {
    if (processedCount > 0 || errorCount > 0) {
      logger.info(
        { processed: processedCount, errors: errorCount, duplicates: duplicateCount, invalid: invalidCount },
        'Notification consumer stats',
      );
    }
    processedCount = 0;
    errorCount = 0;
    duplicateCount = 0;
    invalidCount = 0;
  }, 300_000); // Every 5 minutes

  if (statsInterval.unref) statsInterval.unref();

  await consumer.run({
    eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
      const key = message.key?.toString() ?? '';
      const rawValue = message.value?.toString();
      const offset = message.offset;

      if (!rawValue) {
        logger.warn({ topic, key, offset }, 'Empty message value — skipping');
        return;
      }

      // ── Idempotency Check ─────────────────────
      const idempotencyKey = `consumer:notif:${topic}:${partition}:${offset}`;
      try {
        const isNew = await redis.set(idempotencyKey, '1', 'EX', IDEMPOTENCY_TTL, 'NX');
        if (isNew !== 'OK') {
          duplicateCount++;
          return;
        }
      } catch {
        // Redis down — proceed without idempotency
      }

      // ── Process with Retry ────────────────────
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          await processNotificationEvent(rawValue, key, topic, queueManager);
          processedCount++;
          return;
        } catch (err: unknown) {
          lastError = err instanceof Error ? err : new Error(String(err));
          errorCount++;

          if (attempt < MAX_RETRIES) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      }

      // ── DLQ ───────────────────────────────────
      if (lastError) {
        logger.error(
          { err: lastError, topic, key, partition, offset },
          `Notification event failed after ${MAX_RETRIES} retries — sending to DLQ`,
        );

        if (dlqProducer) {
          try {
            await dlqProducer.send({
              topic: 'nexus.dlq.notifications',
              messages: [{
                key,
                value: JSON.stringify({
                  originalTopic: topic,
                  originalKey: key,
                  originalValue: rawValue,
                  error: lastError.message,
                  failedAt: new Date().toISOString(),
                  retries: MAX_RETRIES,
                }),
              }],
            });
          } catch (dlqErr) {
            logger.error({ err: dlqErr }, 'Failed to send to DLQ');
          }
        }

        // Clear idempotency so it can be reprocessed
        await redis.del(idempotencyKey).catch(() => {});
      }
    },
  });

  logger.info({ topics: CONSUMED_TOPICS }, 'Notification consumer started');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Event Processing
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function processNotificationEvent(
  rawValue: string,
  key: string,
  topic: string,
  queueManager: NotificationQueueManager,
): Promise<void> {
  // Parse JSON
  let parsed: any;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    logger.warn({ key, rawValue: rawValue.slice(0, 200) }, 'Invalid JSON in notification event — discarding');
    return; // Don't retry malformed JSON
  }

  const payload: NotificationTriggerEvent = parsed.payload ?? parsed;

  // Validate required fields
  if (!payload.userId || typeof payload.userId !== 'string') {
    logger.warn({ key, payload: JSON.stringify(payload).slice(0, 200) }, 'Missing userId — discarding');
    return;
  }

  if (!payload.type || typeof payload.type !== 'string') {
    logger.warn({ key, userId: payload.userId }, 'Missing notification type — discarding');
    return;
  }

  // Sanitize channels
  const channels = (payload.channels ?? DEFAULT_CHANNELS).filter(
    (ch): ch is 'push' | 'email' | 'sms' | 'in_app' => VALID_CHANNELS.has(ch),
  );

  if (channels.length === 0) {
    logger.warn({ key, userId: payload.userId, type: payload.type }, 'No valid channels — using defaults');
    channels.push('push', 'in_app');
  }

  // Sanitize priority
  const priority = VALID_PRIORITIES.has(payload.priority) ? payload.priority : 'normal';

  // Render template
  let templateResult: TemplateResult;
  try {
    templateResult = renderTemplate(payload.type, payload.data ?? {});
  } catch (err: unknown) {
    // If template rendering fails, use raw data
    logger.warn({ err, type: payload.type }, 'Template rendering failed — using raw data');
    templateResult = {
      title: payload.title ?? payload.type.replace(/_/g, ' '),
      body: payload.body ?? 'You have a new notification',
    };
  }

  // Build enqueue request
  const enqueueRequest: EnqueueRequest = {
    userId: payload.userId,
    templateType: payload.type,
    channels,
    priority: priority as EnqueueRequest['priority'],
    title: payload.title ?? templateResult.title,
    body: payload.body ?? templateResult.body,
    ...(payload.actionUrl !== undefined && { actionUrl: payload.actionUrl }),
    ...(templateResult.emailHtml !== undefined && { emailHtml: templateResult.emailHtml }),
    ...(templateResult.emailSubject !== undefined && { emailSubject: templateResult.emailSubject }),
    ...(payload.data !== undefined && { data: payload.data }),
  };

  // Enqueue
  const result = await queueManager.enqueue(enqueueRequest);

  logger.debug(
    {
      userId: payload.userId,
      type: payload.type,
      priority,
      enqueuedChannels: result.enqueuedChannels,
      skippedChannels: result.skippedChannels,
    },
    'Notification event processed',
  );
}
