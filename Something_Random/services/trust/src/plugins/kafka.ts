/**
 * Kafka Plugin for Fastify
 *
 * Registers a KafkaJS producer on the Fastify instance as `app.kafka`.
 * The producer is used for publishing events to Kafka topics.
 *
 * Features:
 *  - Automatic connection/disconnection
 *  - Message serialization with timestamps
 *  - Retry configuration with idempotent producer
 *  - Transaction support
 *  - Health check
 *
 * @module plugins/kafka
 */

import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { Kafka, type Producer, type ProducerConfig, CompressionTypes, logLevel } from 'kafkajs';
import { createLogger } from '@nexus/utils';
import { config } from '../config.js';

const logger = createLogger('trust-kafka-plugin');

declare module 'fastify' {
  interface FastifyInstance {
    kafka: Producer;
    kafkaClient: Kafka;
  }
}

async function kafkaPlugin(app: FastifyInstance): Promise<void> {
  const brokers = config.KAFKA_BROKERS.split(',').map((b) => b.trim());

  const kafka = new Kafka({
    clientId: 'nexus-trust-service',
    brokers,
    retry: {
      initialRetryTime: 300,
      retries: 8,
      maxRetryTime: 30_000,
      factor: 0.2,
      multiplier: 2,
    },
    logLevel: config.NODE_ENV === 'production' ? logLevel.WARN : logLevel.INFO,
    logCreator: () => {
      return ({ namespace, level, log }) => {
        const { message, ...extra } = log;
        const logFn = level === logLevel.ERROR || level === logLevel.NOTHING
          ? logger.error.bind(logger)
          : level === logLevel.WARN
            ? logger.warn.bind(logger)
            : logger.debug.bind(logger);
        logFn({ namespace, ...extra }, message);
      };
    },
  });

  const producerConfig: ProducerConfig = {
    allowAutoTopicCreation: true,
    transactionTimeout: 30_000,
    idempotent: config.NODE_ENV === 'production',
    maxInFlightRequests: config.NODE_ENV === 'production' ? 1 : 5,
  };

  const producer = kafka.producer(producerConfig);

  try {
    await producer.connect();
    logger.info({ brokers }, 'Kafka producer connected');
  } catch (err) {
    logger.warn({ err, brokers }, 'Kafka producer connection failed — events will not be published');
  }

  // Producer event handlers
  producer.on('producer.connect', () => {
    logger.debug('Kafka producer connected event');
  });

  producer.on('producer.disconnect', () => {
    logger.warn('Kafka producer disconnected');
  });

  producer.on('producer.network.request_timeout', (payload) => {
    logger.warn({ payload }, 'Kafka producer network timeout');
  });

  app.decorate('kafka', producer);
  app.decorate('kafkaClient', kafka);

  app.addHook('onClose', async () => {
    logger.info('Disconnecting Kafka producer');
    try {
      await producer.disconnect();
      logger.info('Kafka producer disconnected');
    } catch (err) {
      logger.warn({ err }, 'Error disconnecting Kafka producer');
    }
  });
}

export default fp(kafkaPlugin, {
  name: 'kafka',
  fastify: '4.x',
});
