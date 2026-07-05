/**
 * NEXUS Notifications Service — Kafka Plugin
 *
 * Registers a KafkaJS producer with:
 * - Connection retry logic with exponential backoff
 * - Health check via producer metadata fetch
 * - Graceful shutdown with configurable timeout
 * - Graceful degradation: service starts without Kafka if unavailable
 * - Structured logging for all lifecycle events
 *
 * Decorates the Fastify instance with:
 * - `kafka`: KafkaJS Producer instance (may be undefined if connection failed)
 * - `kafkaHealthCheck`: Async function returning Kafka connectivity status
 *
 * @module plugins/kafka
 */

import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Producer } from 'kafkajs';

import { createKafkaProducer, disconnectProducer } from '@nexus/kafka';
import { config } from '../config.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Maximum number of retry attempts for Kafka producer connection. */
const MAX_CONNECTION_RETRIES = 5;

/** Base delay in milliseconds for exponential backoff between retries. */
const BASE_RETRY_DELAY_MS = 1000;

/** Maximum delay cap in milliseconds for retry backoff. */
const MAX_RETRY_DELAY_MS = 15_000;

/** Timeout in milliseconds for the Kafka health check metadata fetch. */
const HEALTH_CHECK_TIMEOUT_MS = 5000;

/** Timeout in milliseconds for graceful producer disconnect. */
const DISCONNECT_TIMEOUT_MS = 10_000;

/** Kafka client ID for the notifications service producer. */
const KAFKA_CLIENT_ID = 'notifications-service';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Health Check Response Type
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Response from the Kafka health check.
 * Includes producer connectivity status and broker information.
 */
export interface KafkaHealthStatus {
  /** Whether the Kafka producer is currently connected. */
  connected: boolean;
  /** Health check response time in milliseconds. */
  responseTimeMs: number;
  /** List of broker addresses the producer is connected to. */
  brokers?: string[];
  /** Error message if the health check failed. */
  error?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Sleeps for the specified number of milliseconds.
 *
 * @param ms - Duration to sleep in milliseconds
 * @returns Promise that resolves after the delay
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attempts to create and connect a Kafka producer with retries.
 * Uses exponential backoff with jitter for retry delays.
 *
 * @param brokers - List of Kafka broker addresses
 * @param log - Fastify logger for structured logging
 * @returns Connected Kafka producer, or null if all retries failed
 */
async function connectProducerWithRetry(
  brokers: string[],
  log: FastifyInstance['log'],
): Promise<Producer | null> {
  for (let attempt = 1; attempt <= MAX_CONNECTION_RETRIES; attempt++) {
    try {
      log.info(
        { attempt, maxAttempts: MAX_CONNECTION_RETRIES, brokers },
        'Attempting Kafka producer connection',
      );

      const producer = await createKafkaProducer(KAFKA_CLIENT_ID, brokers);

      log.info(
        { attempt, brokers },
        'Kafka producer connected successfully',
      );

      return producer;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      if (attempt === MAX_CONNECTION_RETRIES) {
        log.error(
          { attempt, maxAttempts: MAX_CONNECTION_RETRIES, error: errorMessage },
          'Kafka producer connection failed after all retries',
        );
        return null;
      }

      // Exponential backoff with jitter
      const baseDelay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      const jitter = Math.random() * BASE_RETRY_DELAY_MS;
      const delay = Math.min(baseDelay + jitter, MAX_RETRY_DELAY_MS);

      log.warn(
        {
          attempt,
          maxAttempts: MAX_CONNECTION_RETRIES,
          retryDelayMs: Math.round(delay),
          error: errorMessage,
        },
        'Kafka producer connection failed, retrying...',
      );

      await sleep(delay);
    }
  }

  return null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Plugin
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Fastify plugin that initialises a Kafka producer with connection retries.
 *
 * If the Kafka cluster is unreachable after all retries, the service
 * continues to start in a degraded mode — notification events won't be
 * published but the HTTP API and workers remain functional. This is
 * intentional to avoid cascading failures in the campus infrastructure.
 *
 * @param fastify - The Fastify instance to decorate
 */
async function kafkaPlugin(fastify: FastifyInstance): Promise<void> {
  const brokers = config.KAFKA_BROKERS.split(',').map((b) => b.trim());
  let producer: Producer | null = null;

  producer = await connectProducerWithRetry(brokers, fastify.log);

  if (producer === null) {
    fastify.log.warn(
      { brokers },
      'Kafka producer unavailable — service running in degraded mode without event publishing',
    );

    // Decorate with a no-op health check to prevent errors from missing decorator
    const degradedHealthCheck = async (): Promise<KafkaHealthStatus> => ({
      connected: false,
      responseTimeMs: 0,
      error: 'Kafka producer not initialized (degraded mode)',
    });
    fastify.decorate('kafkaHealthCheck', degradedHealthCheck);
    return;
  }

  fastify.decorate('kafka', producer);

  /**
   * Performs a Kafka health check by attempting to fetch cluster metadata.
   * This validates that the producer can still communicate with the brokers.
   *
   * @returns Kafka health status object
   */
  const kafkaHealthCheck = async (): Promise<KafkaHealthStatus> => {
    const start = Date.now();
    try {
      // Producer events and admin API aren't directly available from the
      // abstracted @nexus/kafka helper, so we check by sending a no-op
      // message to a health topic. If the producer is disconnected,
      // this will throw.
      const checkPromise = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Kafka health check timed out')),
          HEALTH_CHECK_TIMEOUT_MS,
        );

        // Try to send to a health check topic — catches connection issues
        producer!
          .send({
            topic: 'nexus.notifications.health',
            messages: [{ value: JSON.stringify({ ts: Date.now(), service: KAFKA_CLIENT_ID }) }],
          })
          .then(() => {
            clearTimeout(timer);
            resolve();
          })
          .catch((err: Error) => {
            clearTimeout(timer);
            reject(err);
          });
      });

      await checkPromise;

      return {
        connected: true,
        responseTimeMs: Date.now() - start,
        brokers,
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        connected: false,
        responseTimeMs: Date.now() - start,
        error: errorMessage,
      };
    }
  };

  fastify.decorate('kafkaHealthCheck', kafkaHealthCheck);

  // Graceful shutdown hook with timeout
  fastify.addHook('onClose', async () => {
    fastify.log.info('Disconnecting Kafka producer...');
    try {
      const disconnectPromise = disconnectProducer(producer!);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Kafka producer disconnect timed out')),
          DISCONNECT_TIMEOUT_MS,
        ),
      );
      await Promise.race([disconnectPromise, timeoutPromise]);
      fastify.log.info('Kafka producer disconnected');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      fastify.log.error(
        { error: errorMessage },
        'Error disconnecting Kafka producer',
      );
    }
  });

  fastify.log.info({ brokers, clientId: KAFKA_CLIENT_ID }, 'Kafka plugin registered');
}

export default fp(kafkaPlugin, {
  name: 'kafka',
  fastify: '4.x',
});
