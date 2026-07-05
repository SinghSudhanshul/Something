/**
 * Trust Kafka Consumer — Full production implementation
 *
 * Consumes events from all NEXUS services and records trust score deltas.
 * Implements:
 *  - Idempotency via Redis SETNX (prevent duplicate processing)
 *  - Dead-letter queue (DLQ) after 3 retries
 *  - Per-topic event routing with explicit userId extraction
 *  - Structured logging with correlation fields
 *  - Graceful error handling (never crash on bad messages)
 *
 * @module consumers/trust.consumer
 */

import type { Consumer, EachMessagePayload, Producer as KafkaProducer } from 'kafkajs';
import { createLogger } from '@nexus/utils';
import type { ScoreService } from '../modules/score/score.service.js';
import type { FraudService } from '../modules/fraud/fraud.service.js';
import type { Redis } from 'ioredis';

const logger = createLogger('trust-kafka-consumer');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface TopicMapping {
  eventType: string;
  referenceType: string;
  /** Optional: extract userId from a specific field path */
  userIdField?: string;
  /** Optional: secondary userId to also record events for (e.g. both buyer and seller) */
  secondaryUserIdField?: string;
  /** Optional: secondary event type for the secondary user */
  secondaryEventType?: string;
  /** Whether to trigger fraud scoring for this event */
  triggerFraudCheck?: boolean;
}

interface ProcessedMessage {
  topic: string;
  key: string;
  userId: string;
  eventType: string;
  referenceId: string;
  processed: boolean;
  error?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Topic → Event Mapping
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const TOPIC_EVENT_MAP: Record<string, TopicMapping> = {
  // ── Transaction Events ──────────────────────
  'nexus.transactions.completed': {
    eventType: 'transaction_completed',
    referenceType: 'transaction',
    userIdField: 'buyerId',
    secondaryUserIdField: 'sellerId',
    secondaryEventType: 'transaction_completed',
  },
  'nexus.transactions.disputed': {
    eventType: 'transaction_disputed_lost',
    referenceType: 'transaction',
    userIdField: 'reportedUserId',
  },
  'nexus.transactions.escrow_locked': {
    eventType: 'transaction_completed', // We check it but might trigger fraud
    referenceType: 'transaction',
    userIdField: 'buyerId',
    triggerFraudCheck: true,
  },

  // ── User Events ──────────────────────────────
  'nexus.users.verified': {
    eventType: 'verification_upgraded',
    referenceType: 'user',
    userIdField: 'userId',
  },
  'nexus.users.student_id_verified': {
    eventType: 'verification_upgraded',
    referenceType: 'user',
    userIdField: 'userId',
  },

  // ── Listing Events ──────────────────────────
  'nexus.listings.sold': {
    eventType: 'listing_sold',
    referenceType: 'listing',
    userIdField: 'sellerId',
  },
  'nexus.listings.created': {
    eventType: 'listing_created',
    referenceType: 'listing',
    userIdField: 'sellerId',
    triggerFraudCheck: true,
  },

  // ── Ride Events ──────────────────────────────
  'nexus.rides.completed': {
    eventType: 'ride_completed',
    referenceType: 'ride',
    userIdField: 'driverId',
    secondaryUserIdField: 'passengerId',
    secondaryEventType: 'ride_completed',
  },
  'nexus.rides.sos_triggered': {
    eventType: 'ride_sos_triggered',
    referenceType: 'ride',
    userIdField: 'triggeredBy',
  },

  // ── Task/Gig Events ──────────────────────────
  'nexus.tasks.completed': {
    eventType: 'gig_completed',
    referenceType: 'task',
    userIdField: 'workerId',
  },
  'nexus.skills.order_completed': {
    eventType: 'gig_completed',
    referenceType: 'skill_order',
    userIdField: 'providerId',
  },

  // ── Food Events ──────────────────────────────
  'nexus.food.order_completed': {
    eventType: 'transaction_completed',
    referenceType: 'food_order',
    userIdField: 'vendorId',
    secondaryUserIdField: 'customerId',
    secondaryEventType: 'transaction_completed',
  },

  // ── Review Events ────────────────────────────
  'nexus.reviews.submitted': {
    eventType: 'review_submitted',
    referenceType: 'review',
    userIdField: 'reviewerId',
  },
};

const SUBSCRIBED_TOPICS = Object.keys(TOPIC_EVENT_MAP);

/** Maximum retries before sending to DLQ */
const MAX_RETRIES = 3;

/** Idempotency key TTL (24 hours) */
const IDEMPOTENCY_TTL_SECS = 86400;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Consumer Setup
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function setupTrustConsumer(
  consumer: Consumer,
  scoreService: ScoreService,
  fraudService: FraudService,
  redis: Redis,
  dlqProducer?: KafkaProducer,
): Promise<void> {
  await consumer.subscribe({
    topics: SUBSCRIBED_TOPICS,
    fromBeginning: false,
  });

  let processedCount = 0;
  let errorCount = 0;
  let duplicateCount = 0;

  // Log stats every 5 minutes
  const statsInterval = setInterval(() => {
    logger.info(
      { processed: processedCount, errors: errorCount, duplicates: duplicateCount },
      'Trust consumer stats',
    );
    processedCount = 0;
    errorCount = 0;
    duplicateCount = 0;
  }, 300_000);

  if (statsInterval.unref) {
    statsInterval.unref();
  }

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
      const idempotencyKey = `consumer:trust:${topic}:${partition}:${offset}`;
      try {
        const isNew = await redis.set(
          idempotencyKey,
          '1',
          'EX',
          IDEMPOTENCY_TTL_SECS,
          'NX',
        );
        if (isNew !== 'OK') {
          duplicateCount++;
          logger.debug({ topic, key, offset }, 'Duplicate message — skipping');
          return;
        }
      } catch (err: unknown) {
        // If Redis is down, proceed without idempotency check
        logger.warn({ err }, 'Idempotency check failed — processing anyway');
      }

      // ── Process with Retry ─────────────────────
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          await processMessage(
            topic,
            key,
            rawValue,
            partition,
            offset,
            scoreService,
            fraudService,
          );
          processedCount++;
          return;
        } catch (err: unknown) {
          lastError = err instanceof Error ? err : new Error(String(err));
          errorCount++;

          if (attempt < MAX_RETRIES) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
            logger.warn(
              { err: lastError, topic, key, attempt, maxRetries: MAX_RETRIES, delay },
              'Trust event processing failed — retrying',
            );
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      }

      // ── Send to DLQ ────────────────────────────
      if (lastError) {
        logger.error(
          { err: lastError, topic, key, partition, offset },
          `Trust event failed after ${MAX_RETRIES} retries — sending to DLQ`,
        );

        if (dlqProducer) {
          try {
            await dlqProducer.send({
              topic: 'nexus.dlq.trust',
              messages: [
                {
                  key,
                  value: JSON.stringify({
                    originalTopic: topic,
                    originalKey: key,
                    originalValue: rawValue,
                    error: lastError.message,
                    partition,
                    offset,
                    failedAt: new Date().toISOString(),
                    retries: MAX_RETRIES,
                  }),
                },
              ],
            });
          } catch (dlqErr: unknown) {
            logger.error({ err: dlqErr, topic, key }, 'Failed to send to DLQ');
          }
        }

        // Delete idempotency key so message can be reprocessed later
        try {
          await redis.del(idempotencyKey);
        } catch {
          // non-critical
        }
      }
    },
  });

  logger.info(
    { topics: SUBSCRIBED_TOPICS, topicCount: SUBSCRIBED_TOPICS.length },
    'Trust consumer started',
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Message Processing
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function processMessage(
  topic: string,
  key: string,
  rawValue: string,
  partition: number,
  offset: string,
  scoreService: ScoreService,
  fraudService: FraudService,
): Promise<void> {
  let parsed: any;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    logger.warn({ topic, key, rawValue: rawValue.slice(0, 200) }, 'Invalid JSON — discarding');
    return; // Don't retry malformed JSON
  }

  const payload = parsed.payload ?? parsed;
  const mapping = TOPIC_EVENT_MAP[topic];

  if (!mapping) {
    logger.warn({ topic }, 'No mapping for topic — discarding');
    return;
  }

  // ── Extract Primary User ID ─────────────────
  const userId = extractUserId(payload, mapping.userIdField);
  if (!userId) {
    logger.warn({ topic, key, payload: JSON.stringify(payload).slice(0, 200) }, 'No userId in payload — discarding');
    return;
  }

  const referenceId = extractReferenceId(payload, key);

  // ── Record Primary Event ────────────────────
  const result = await scoreService.recordEvent({
    userId,
    eventType: mapping.eventType as any,
    referenceId,
    referenceType: mapping.referenceType,
    metadata: { topic, partition, offset, originalPayload: payload },
  });

  logger.info(
    { topic, userId, eventType: mapping.eventType, score: result.score, tier: result.tier, tierUpgraded: result.tierUpgraded },
    'Trust event recorded',
  );

  // ── Record Secondary Event (if applicable) ──
  if (mapping.secondaryUserIdField) {
    const secondaryUserId = extractUserId(payload, mapping.secondaryUserIdField);
    if (secondaryUserId && secondaryUserId !== userId) {
      const secondaryEventType = mapping.secondaryEventType ?? mapping.eventType;
      try {
        await scoreService.recordEvent({
          userId: secondaryUserId,
          eventType: secondaryEventType as any,
          referenceId,
          referenceType: mapping.referenceType,
          metadata: { topic, partition, offset, isSecondary: true },
        });
        logger.debug(
          { topic, secondaryUserId, eventType: secondaryEventType },
          'Secondary trust event recorded',
        );
      } catch (err: unknown) {
        // Non-critical: secondary event failure should not fail the primary
        logger.warn(
          { err, secondaryUserId, eventType: secondaryEventType },
          'Failed to record secondary trust event',
        );
      }
    }
  }

  // ── Fraud Check (if applicable) ─────────────
  if (mapping.triggerFraudCheck) {
    try {
      // Build fraud scoring request from payload
      const amount = payload.amount ?? payload.price ?? 0;
      const recipientId = payload.recipientId ?? payload.recipient_id ?? payload.sellerId ?? payload.seller_id ?? '';

      await fraudService.scoreTransaction({
        userId,
        transactionId: referenceId,
        amount,
        recipientId,
        module: mapping.referenceType,
        userTrustScore: result.score,
        userAge: payload.userAge ?? 30, // Default 30 days if unknown
        transactionsLast24h: payload.transactionsLast24h ?? 0,
        transactionsLast7d: payload.transactionsLast7d ?? 0,
        uniqueRecipientsLast7d: payload.uniqueRecipientsLast7d ?? 0,
        isNewRecipient: payload.isNewRecipient ?? false,
        hourOfDay: new Date().getHours(),
      });
    } catch (err: unknown) {
      // Fraud check failure is non-critical
      logger.warn({ err, topic, userId }, 'Fraud check failed (non-critical)');
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Extract userId from payload using multiple possible field names.
 */
function extractUserId(payload: any, preferredField?: string): string | null {
  if (preferredField) {
    // Try camelCase and snake_case variants
    const camelValue = payload[preferredField];
    const snakeField = preferredField.replace(/([A-Z])/g, '_$1').toLowerCase();
    const snakeValue = payload[snakeField];

    if (camelValue) return String(camelValue);
    if (snakeValue) return String(snakeValue);
  }

  // Fallback: try common field names
  const candidates = [
    'userId', 'user_id',
    'sellerId', 'seller_id',
    'buyerId', 'buyer_id',
    'driverId', 'driver_id',
    'workerId', 'worker_id',
    'providerId', 'provider_id',
    'vendorId', 'vendor_id',
    'reviewerId', 'reviewer_id',
    'triggeredBy', 'triggered_by',
  ];

  for (const field of candidates) {
    if (payload[field]) return String(payload[field]);
  }

  return null;
}

/**
 * Extract reference ID from payload using multiple possible field names.
 */
function extractReferenceId(payload: any, fallbackKey: string): string {
  const candidates = [
    'id', 'transactionId', 'transaction_id',
    'rideId', 'ride_id',
    'listingId', 'listing_id',
    'taskId', 'task_id',
    'orderId', 'order_id',
    'reviewId', 'review_id',
  ];

  for (const field of candidates) {
    if (payload[field]) return String(payload[field]);
  }

  return fallbackKey || `unknown_${Date.now()}`;
}
