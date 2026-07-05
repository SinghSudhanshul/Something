/**
 * NEXUS Bazaar — Transaction Consumer
 *
 * Consumes nexus.transactions.completed and nexus.transactions.refunded.
 * Idempotent via Redis SETNX lock. DLQ after 3 failures.
 */

import type { FastifyInstance } from 'fastify';
import { createLogger, createTrustClient } from '@nexus/utils';
import { KafkaTopics } from '@nexus/types';
import { publishEvent } from '@nexus/kafka';
import { config } from '../config.js';

const logger = createLogger('bazaar:transaction-consumer');

export async function startTransactionConsumer(fastify: FastifyInstance): Promise<void> {
  const consumer = fastify.kafka?.consumer;
  const producer = fastify.kafka?.producer;
  if (!consumer || !producer) {
    logger.warn('Kafka not available — transaction consumer not started');
    return;
  }

  const trustClient = createTrustClient(config.USER_SERVICE_URL, config.INTERNAL_SERVICE_SECRET);

  await consumer.subscribe({
    topics: [KafkaTopics.TRANSACTION_COMPLETED, KafkaTopics.TRANSACTION_REFUNDED],
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const eventId = message.headers?.['event-id']?.toString() ?? message.offset;
      const lockKey = `consumer:bazaar:txn:${eventId}`;

      // Idempotency: Redis SETNX
      const acquired = await fastify.redis.set(lockKey, '1', 'EX', 86400, 'NX');
      if (!acquired) {
        logger.debug({ eventId }, 'Duplicate event — skipping');
        return;
      }

      const value = message.value?.toString();
      if (!value) return;

      let retries = 0;
      const maxRetries = 3;

      while (retries < maxRetries) {
        try {
          const data = JSON.parse(value) as Record<string, unknown>;

          if (topic === KafkaTopics.TRANSACTION_COMPLETED) {
            const buyerId = data.buyerId as string;
            const sellerId = data.sellerId as string;
            const transactionId = data.transactionId as string;

            // Trust deltas: buyer +0.03, seller +0.02 (listing_sold) + +0.03 (transaction_completed)
            await trustClient.recordTrustEvents([
              { userId: buyerId, eventType: 'transaction_completed', referenceId: transactionId, referenceType: 'bazaar_transaction' },
              { userId: sellerId, eventType: 'listing_sold', referenceId: transactionId, referenceType: 'bazaar_transaction' },
              { userId: sellerId, eventType: 'transaction_completed', referenceId: transactionId, referenceType: 'bazaar_transaction' },
            ]);

            logger.info({ transactionId, buyerId, sellerId }, 'Trust events recorded for completed transaction');
          }
          // On refunded: no trust delta (per spec)

          return; // Success — exit retry loop
        } catch (error) {
          retries++;
          logger.error({ err: error, eventId, attempt: retries }, 'Failed to process transaction event');

          if (retries >= maxRetries) {
            // Dead letter queue
            logger.error({ eventId }, 'Max retries exceeded — publishing to DLQ');
            await publishEvent(producer, KafkaTopics.DLQ_BAZAAR, {
              originalTopic: topic,
              eventId,
              data: value,
              error: (error as Error).message,
              failedAt: new Date().toISOString(),
            });
          } else {
            await new Promise((r) => setTimeout(r, 200 * retries));
          }
        }
      }
    },
  });

  logger.info('Transaction consumer started');
}
