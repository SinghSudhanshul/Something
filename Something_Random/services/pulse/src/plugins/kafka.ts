/**
 * NEXUS Pulse Service — Kafka Plugin
 */

import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Producer } from 'kafkajs';

import { createKafkaProducer, disconnectProducer } from '@nexus/kafka';
import { config } from '../config.js';

async function kafkaPlugin(fastify: FastifyInstance): Promise<void> {
  const brokers = config.KAFKA_BROKERS.split(',').map((b) => b.trim());
  let producer: Producer;

  try {
    producer = await createKafkaProducer('pulse-service', brokers);
  } catch (error: unknown) {
    fastify.log.warn({ err: error }, 'Kafka producer connection failed — running without Kafka');
    return;
  }

  fastify.decorate('kafka', { producer });

  fastify.addHook('onClose', async () => {
    fastify.log.info('Disconnecting Kafka producer...');
    await disconnectProducer(producer);
  });

  fastify.log.info('Kafka plugin registered');
}

export default fp(kafkaPlugin, { name: 'kafka', fastify: '4.x' });
