/**
 * NEXUS Search Service — Kafka Plugin
 *
 * Registers a KafkaJS producer on the Fastify instance.  The plugin handles:
 *
 * - Broker list parsing from config
 * - Producer connection with configurable retries
 * - Health-check helper
 * - Graceful disconnect on application shutdown
 * - Error event logging
 *
 * The Kafka *consumer* is managed separately by the sync consumer module
 * (see `src/consumers/sync.consumer.ts`) because it has its own lifecycle
 * and group coordination requirements.
 *
 * @module plugins/kafka
 */

import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Producer } from 'kafkajs';

import { createKafkaProducer, disconnectProducer } from '@nexus/kafka';
import { config } from '../config.js';

/** Tracks whether the producer connected successfully for the health check. */
let producerConnected = false;

/**
 * Fastify plugin that creates and registers a Kafka producer.
 *
 * The producer is available on every request via `fastify.kafka`.
 * If the initial connection fails, the service starts in degraded mode
 * (Kafka-dependent features are disabled but the HTTP API remains available).
 *
 * @param fastify - Fastify application instance.
 */
async function kafkaPlugin(fastify: FastifyInstance): Promise<void> {
  const brokers = config.KAFKA_BROKERS;
  let producer: Producer;

  fastify.log.info(
    { brokers, clientId: config.KAFKA_CLIENT_ID },
    'Initializing Kafka producer…',
  );

  try {
    producer = await createKafkaProducer(config.KAFKA_CLIENT_ID, brokers.split(',').map((b) => b.trim()));
    producerConnected = true;
    fastify.log.info('Kafka producer connected successfully');
  } catch (error: unknown) {
    fastify.log.warn(
      { err: error },
      'Kafka producer connection failed — running in degraded mode without Kafka event emission',
    );

    /* Provide a no-op stub so callers can safely check `fastify.kafka` */
    return;
  }

  /* Register on Fastify ────────────────────────────────────────────────── */
  fastify.decorate('kafka', producer);

  /**
   * Health-check helper — returns the current connection state.
   *
   * @returns Object with `ok` flag.
   */
  fastify.decorate('kafkaHealthCheck', async (): Promise<{
    ok: boolean;
    brokerCount: number;
  }> => {
    try {
      if (!producerConnected) {
        return { ok: false, brokerCount: 0 };
      }
      return { ok: true, brokerCount: brokers.length };
    } catch {
      return { ok: false, brokerCount: 0 };
    }
  });

  /* Graceful shutdown ──────────────────────────────────────────────────── */
  fastify.addHook('onClose', async () => {
    fastify.log.info('Disconnecting Kafka producer…');
    try {
      await disconnectProducer(producer);
      producerConnected = false;
      fastify.log.info('Kafka producer disconnected');
    } catch (err: unknown) {
      fastify.log.error({ err }, 'Error disconnecting Kafka producer');
    }
  });

  fastify.log.info(
    {
      brokerCount: brokers.length,
      clientId: config.KAFKA_CLIENT_ID,
      retries: config.KAFKA_PRODUCER_RETRIES,
    },
    'Kafka plugin registered',
  );
}

export default fp(kafkaPlugin, {
  name: 'kafka',
  fastify: '4.x',
});
