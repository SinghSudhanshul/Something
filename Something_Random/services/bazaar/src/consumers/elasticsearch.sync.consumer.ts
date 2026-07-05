/**
 * NEXUS Bazaar — Elasticsearch Sync Consumer
 *
 * Consumes listing events and keeps Elasticsearch in sync with PostgreSQL.
 * Offset not committed until sync confirmed.
 */

import type { FastifyInstance } from 'fastify';
import { createLogger } from '@nexus/utils';
import { KafkaTopics } from '@nexus/types';
import { LISTINGS_INDEX } from '../plugins/elasticsearch.plugin.js';
import { ListingRepository } from '../modules/listing/listing.repository.js';

const logger = createLogger('bazaar:es-sync-consumer');

export async function startElasticsearchSyncConsumer(fastify: FastifyInstance): Promise<void> {
  const consumer = fastify.kafka?.consumer;
  if (!consumer) {
    logger.warn('Kafka not available — ES sync consumer not started');
    return;
  }

  const repo = new ListingRepository(fastify);

  await consumer.subscribe({
    topics: [KafkaTopics.LISTING_CREATED, KafkaTopics.LISTING_UPDATED, KafkaTopics.LISTING_DELETED],
    fromBeginning: false,
  });

  await consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, message, partition, heartbeat }) => {
      const value = message.value?.toString();
      if (!value) return;

      try {
        const data = JSON.parse(value) as Record<string, unknown>;
        const listingId = data.id as string;

        if (topic === KafkaTopics.LISTING_DELETED) {
          try {
            await fastify.es.delete({ index: LISTINGS_INDEX, id: listingId });
            logger.debug({ listingId }, 'Listing removed from ES');
          } catch (err) {
            const esErr = err as { statusCode?: number };
            if (esErr.statusCode !== 404) throw err;
          }
        } else {
          // create or update: fetch fresh from PostgreSQL (source of truth)
          const listing = await repo.findById(listingId);
          if (listing) {
            await fastify.es.index({
              index: LISTINGS_INDEX,
              id: listingId,
              body: {
                id: listing.id,
                campus_id: listing.campus_id,
                seller_id: listing.seller_id,
                title: listing.title,
                description: listing.description,
                category: listing.category,
                condition: listing.condition,
                listing_type: ((listing as unknown as Record<string, unknown>).listing_type),
                status: listing.status,
                price: Number(listing.price),
                images: listing.images,
                is_promoted: listing.is_promoted,
                view_count: listing.view_count,
                created_at: listing.created_at,
                expires_at: listing.expires_at,
                updated_at: listing.updated_at,
              },
            });
            logger.debug({ listingId }, 'Listing synced to ES');
          }
        }

        // Commit only after successful sync
        await consumer.commitOffsets([{
          topic,
          partition,
          offset: String(Number(message.offset) + 1),
        }]);

        await heartbeat();
      } catch (error) {
        logger.error({ err: error, topic }, 'ES sync failed — offset not committed, will retry');
        // Don't commit — Kafka will redeliver
      }
    },
  });

  logger.info('Elasticsearch sync consumer started');
}
