/**
 * Elasticsearch Plugin — Fastify Plugin
 *
 * Connects to Elasticsearch and decorates the Fastify instance.
 * Creates indices with mappings if they don't exist.
 * Gracefully degrades if Elasticsearch is unavailable.
 *
 * @module plugins/elasticsearch.plugin
 */

import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Client as ElasticClient } from '@elastic/elasticsearch';
import { createLogger } from '@nexus/utils';
import { config } from '../config.js';

const logger = createLogger('elasticsearch-plugin');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Index Mappings
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const INDEX_MAPPINGS: Record<string, any> = {
  listings: {
    properties: {
      title: { type: 'text', analyzer: 'standard', fields: { keyword: { type: 'keyword' } } },
      description: { type: 'text', analyzer: 'standard' },
      price: { type: 'long' },
      category: { type: 'keyword' },
      condition: { type: 'keyword' },
      status: { type: 'keyword' },
      tags: { type: 'keyword' },
      images: { type: 'keyword', index: false },
      seller_id: { type: 'keyword' },
      seller_trust_score: { type: 'float' },
      campus_id: { type: 'keyword' },
      view_count: { type: 'integer' },
      created_at: { type: 'date' },
      updated_at: { type: 'date' },
    },
  },
  users: {
    properties: {
      full_name: { type: 'text', analyzer: 'standard', fields: { keyword: { type: 'keyword' } } },
      username: { type: 'text', fields: { keyword: { type: 'keyword' } } },
      avatar_url: { type: 'keyword', index: false },
      bio: { type: 'text' },
      tags: { type: 'keyword' },
      trust_score: { type: 'float' },
      trust_tier: { type: 'keyword' },
      campus_id: { type: 'keyword' },
      verification_level: { type: 'integer' },
      is_verified: { type: 'boolean' },
      is_student_verified: { type: 'boolean' },
      is_suspended: { type: 'boolean' },
      updated_at: { type: 'date' },
    },
  },
  skills: {
    properties: {
      title: { type: 'text', analyzer: 'standard', fields: { keyword: { type: 'keyword' } } },
      description: { type: 'text', analyzer: 'standard' },
      category: { type: 'keyword' },
      price: { type: 'long' },
      pricing_type: { type: 'keyword' },
      tags: { type: 'keyword' },
      provider_id: { type: 'keyword' },
      provider_trust_score: { type: 'float' },
      campus_id: { type: 'keyword' },
      rating: { type: 'float' },
      order_count: { type: 'integer' },
      status: { type: 'keyword' },
      created_at: { type: 'date' },
    },
  },
  tasks: {
    properties: {
      title: { type: 'text', analyzer: 'standard', fields: { keyword: { type: 'keyword' } } },
      description: { type: 'text', analyzer: 'standard' },
      category: { type: 'keyword' },
      budget: { type: 'long' },
      deadline: { type: 'date' },
      location: { type: 'text' },
      poster_id: { type: 'keyword' },
      campus_id: { type: 'keyword' },
      status: { type: 'keyword' },
      application_count: { type: 'integer' },
      created_at: { type: 'date' },
    },
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Plugin
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function elasticPlugin(app: FastifyInstance): Promise<void> {
  let client: ElasticClient | null = null;

  try {
    const clientConfig: any = {
      node: config.ELASTICSEARCH_URL,
      requestTimeout: 10000,
      maxRetries: 3,
      sniffOnStart: false,
    };

    if (config.ELASTICSEARCH_USERNAME && config.ELASTICSEARCH_PASSWORD) {
      clientConfig.auth = {
        username: config.ELASTICSEARCH_USERNAME,
        password: config.ELASTICSEARCH_PASSWORD,
      };
    }

    client = new ElasticClient(clientConfig);

    // Ping to verify connection
    const pingResult = await client.ping();
    if (!pingResult) throw new Error('Elasticsearch ping failed');

    logger.info({ url: config.ELASTICSEARCH_URL }, 'Elasticsearch connected');

    // Ensure indices exist
    const prefix = config.ELASTICSEARCH_INDEX_PREFIX;
    for (const [name, mapping] of Object.entries(INDEX_MAPPINGS)) {
      const indexName = `${prefix}_${name}`;
      try {
        const exists = await client.indices.exists({ index: indexName });
        if (!exists) {
          await client.indices.create({
            index: indexName,
            body: {
              settings: {
                number_of_shards: 1,
                number_of_replicas: 0,
                'index.mapping.total_fields.limit': 500,
                analysis: {
                  analyzer: {
                    autocomplete: {
                      type: 'custom',
                      tokenizer: 'standard',
                      filter: ['lowercase', 'edge_ngram_filter'],
                    },
                  },
                  filter: {
                    edge_ngram_filter: {
                      type: 'edge_ngram',
                      min_gram: 2,
                      max_gram: 15,
                    },
                  },
                },
              },
              mappings: mapping,
            },
          });
          logger.info({ index: indexName }, 'Elasticsearch index created');
        }
      } catch (err) {
        logger.warn({ err, index: indexName }, 'Failed to create/check index');
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Elasticsearch unavailable — search will use PostgreSQL fallback');
    client = null;
  }

  app.decorate('elastic', client);

  app.addHook('onClose', async () => {
    if (client) {
      await client.close().catch(() => {});
      logger.info('Elasticsearch client closed');
    }
  });
}

export default fp(elasticPlugin, { name: 'elasticsearch' });
