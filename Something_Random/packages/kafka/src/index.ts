/**
 * @nexus/kafka
 *
 * Shared KafkaJS client factory, producer/consumer helpers, and event publishing.
 */

import { Kafka, Producer, Consumer, CompressionTypes, logLevel } from 'kafkajs';
import { nanoid } from 'nanoid';
import { pino } from 'pino';

import type { NexusEvent, KafkaTopic } from '@nexus/types';

const logger = pino({ name: '@nexus/kafka' });

const toKafkaLogLevel = (level: logLevel): string => {
  switch (level) {
    case logLevel.ERROR:
    case logLevel.NOTHING:
      return 'error';
    case logLevel.WARN:
      return 'warn';
    case logLevel.INFO:
      return 'info';
    case logLevel.DEBUG:
      return 'debug';
    default:
      return 'info';
  }
};

const kafkaLogCreator = () => {
  return ({ level, log }: { level: logLevel; log: { message: string } }): void => {
    const pinoLevel = toKafkaLogLevel(level);
    const logFn = logger[pinoLevel as keyof typeof logger];
    if (typeof logFn === 'function') {
      (logFn as (obj: Record<string, unknown>, msg: string) => void).call(
        logger,
        {},
        log.message,
      );
    }
  };
};

/**
 * Creates a KafkaJS client instance connected to the configured brokers.
 */
export function createKafkaClient(clientId: string, brokers: string[]): Kafka {
  return new Kafka({
    clientId,
    brokers,
    logLevel: logLevel.WARN,
    logCreator: kafkaLogCreator,
    retry: {
      initialRetryTime: 100,
      retries: 8,
      maxRetryTime: 30000,
      factor: 2,
      multiplier: 1.5,
    },
  });
}

/**
 * Creates and connects a Kafka producer with idempotent writes and retry logic.
 */
export async function createKafkaProducer(clientId: string, brokers: string[]): Promise<Producer> {
  const kafka = createKafkaClient(clientId, brokers);
  const producer = kafka.producer({
    allowAutoTopicCreation: true,
    idempotent: true,
    maxInFlightRequests: 5,
    transactionTimeout: 30000,
  });

  await producer.connect();
  logger.info({ clientId }, 'Kafka producer connected');

  return producer;
}

/**
 * Creates and connects a Kafka consumer with a specific group ID.
 */
export async function createKafkaConsumer(
  groupId: string,
  brokers: string[],
): Promise<Consumer> {
  const kafka = createKafkaClient(groupId, brokers);
  const consumer = kafka.consumer({
    groupId,
    sessionTimeout: 30000,
    heartbeatInterval: 3000,
    maxWaitTimeInMs: 5000,
    retry: {
      initialRetryTime: 100,
      retries: 8,
    },
  });

  await consumer.connect();
  logger.info({ groupId }, 'Kafka consumer connected');

  return consumer;
}

/**
 * Publishes a NexusEvent to a Kafka topic with proper serialization and headers.
 */
export async function publishEvent<T>(
  producer: Producer,
  topic: KafkaTopic,
  payload: T,
  correlationId?: string,
): Promise<void> {
  const event: NexusEvent<T> = {
    type: topic,
    payload,
    timestamp: new Date().toISOString(),
    correlationId: correlationId ?? nanoid(),
  };

  await producer.send({
    topic,
    compression: CompressionTypes.GZIP,
    messages: [
      {
        key: event.correlationId,
        value: JSON.stringify(event),
        headers: {
          'event-type': topic,
          'correlation-id': event.correlationId,
          'timestamp': event.timestamp,
          'content-type': 'application/json',
        },
      },
    ],
  });

  logger.debug({ topic, correlationId: event.correlationId }, 'Event published');
}

/**
 * Gracefully disconnects a Kafka producer.
 */
export async function disconnectProducer(producer: Producer): Promise<void> {
  await producer.disconnect();
  logger.info('Kafka producer disconnected');
}

/**
 * Gracefully disconnects a Kafka consumer.
 */
export async function disconnectConsumer(consumer: Consumer): Promise<void> {
  await consumer.disconnect();
  logger.info('Kafka consumer disconnected');
}

export { KafkaTopics } from '@nexus/types';
export type { NexusEvent, KafkaTopic } from '@nexus/types';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  RIDE & GO event catalog and helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export * from './ride-events';
