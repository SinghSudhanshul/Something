/**
 * User Service — Kafka Plugin
 *
 * Registers KafkaJS producer + consumer as a Fastify plugin.
 * Producer: publishes user profile events.
 * Consumer: listens for trust-related events from other services.
 */

import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Producer, Consumer } from 'kafkajs';

import { createKafkaProducer, disconnectProducer } from '@nexus/kafka';
import { config } from '../config.js';

let producer: Producer | null = null;
let consumer: Consumer | null = null;

async function kafkaPlugin(fastify: FastifyInstance): Promise<void> {
  const brokers = config.KAFKA_BROKERS.split(',').map((b) => b.trim());

  try {
    producer = await createKafkaProducer('user-service', brokers);
  } catch (error: unknown) {
    fastify.log.warn({ err: error }, 'Kafka producer connection failed — running without Kafka');
    return;
  }

  fastify.decorate('kafka', producer);

  fastify.addHook('onClose', async () => {
    fastify.log.info('Disconnecting Kafka...');
    if (producer) {
      await disconnectProducer(producer);
    }
    if (consumer) {
      await consumer.disconnect();
    }
  });

  fastify.log.info('Kafka plugin registered');
}

export default fp(kafkaPlugin, {
  name: 'kafka',
});

export function getKafkaProducer(): Producer {
  if (producer === null) {
    throw new Error('Kafka producer not initialized');
  }
  return producer;
}

export function getKafkaConsumer(): Consumer | null {
  return consumer;
}
