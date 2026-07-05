/**
 * NEXUS Bazaar Service — Elasticsearch Plugin
 *
 * Decorates fastify.es with an Elasticsearch client.
 * Auto-creates the nexus_listings index with correct mapping on startup.
 */

import fp from 'fastify-plugin';
import { Client } from '@elastic/elasticsearch';
import type { FastifyInstance } from 'fastify';

import { createLogger } from '@nexus/utils';
import { config } from '../config.js';

const logger = createLogger('bazaar:elasticsearch');

const LISTINGS_INDEX = 'nexus_listings';

const LISTINGS_MAPPING = {
  properties: {
    id: { type: 'keyword' as const },
    campus_id: { type: 'keyword' as const },
    seller_id: { type: 'keyword' as const },
    title: {
      type: 'text' as const,
      analyzer: 'english',
      fields: {
        keyword: { type: 'keyword' as const },
        suggest: { type: 'completion' as const },
      },
    },
    description: { type: 'text' as const, analyzer: 'english' },
    category: { type: 'keyword' as const },
    condition: { type: 'keyword' as const },
    listing_type: { type: 'keyword' as const },
    status: { type: 'keyword' as const },
    price: { type: 'scaled_float' as const, scaling_factor: 100 },
    tags: { type: 'keyword' as const },
    view_count: { type: 'integer' as const },
    is_promoted: { type: 'boolean' as const },
    images: { type: 'keyword' as const, index: false },
    location: { type: 'geo_point' as const },
    created_at: { type: 'date' as const },
    expires_at: { type: 'date' as const },
    updated_at: { type: 'date' as const },
  },
};

async function ensureIndexExists(client: Client): Promise<void> {
  try {
    const exists = await client.indices.exists({ index: LISTINGS_INDEX });
    if (!exists) {
      await client.indices.create({
        index: LISTINGS_INDEX,
        body: {
          settings: {
            number_of_shards: 1,
            number_of_replicas: 0,
            analysis: {
              analyzer: {
                english: {
                  type: 'standard',
                  stopwords: '_english_',
                },
              },
            },
          },
          mappings: LISTINGS_MAPPING,
        },
      });
      logger.info({ index: LISTINGS_INDEX }, 'Elasticsearch index created');
    } else {
      logger.info({ index: LISTINGS_INDEX }, 'Elasticsearch index already exists');
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to ensure Elasticsearch index — search may be unavailable');
  }
}

export default fp(
  async function elasticsearchPlugin(fastify: FastifyInstance) {
    const client = new Client({
      node: config.ELASTICSEARCH_URL,
      requestTimeout: 10000,
      maxRetries: 3,
    });

    // Health check
    try {
      await client.ping();
      logger.info('Elasticsearch connected');
    } catch (error) {
      logger.warn({ err: error }, 'Elasticsearch ping failed — search functionality degraded');
    }

    await ensureIndexExists(client);

    fastify.decorate('es', client);

    fastify.addHook('onClose', async () => {
      await client.close();
      logger.info('Elasticsearch client closed');
    });
  },
  { name: 'elasticsearch-plugin' },
);

export { LISTINGS_INDEX, LISTINGS_MAPPING };

declare module 'fastify' {
  interface FastifyInstance {
    es: Client;
  }
}
