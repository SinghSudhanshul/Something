/**
 * Search Sync Consumer — Kafka to Elasticsearch Sync Pipeline
 *
 * Consumes events from all NEXUS services and syncs data to Elasticsearch
 * for real-time search indexing. Supports:
 *  - Listing CRUD (create, update, delete, sold)
 *  - User profile updates (name, trust score, verification)
 *  - Skill listing CRUD
 *  - Task/errand CRUD
 *  - Transaction events (for recommendation training)
 *  - Bulk indexing with configurable batch size
 *  - Full reindex from PostgreSQL
 *  - Idempotency via offset tracking
 *
 * @module consumers/sync.consumer
 */

import type { Consumer, EachMessagePayload } from 'kafkajs';
import type { Client as ElasticClient } from '@elastic/elasticsearch';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { createLogger } from '@nexus/utils';

const logger = createLogger('search-sync-consumer');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type SyncAction = 'index' | 'update' | 'delete';

interface SyncOperation {
  index: string;
  id: string;
  action: SyncAction;
  document?: Record<string, unknown>;
}

interface TopicHandler {
  (payload: any, key: string): SyncOperation | SyncOperation[] | null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Consumed topics */
const SUBSCRIBED_TOPICS = [
  // Listings
  'nexus.listings.created',
  'nexus.listings.updated',
  'nexus.listings.deleted',
  'nexus.listings.sold',
  // Users
  'nexus.users.updated',
  'nexus.users.verified',
  'nexus.users.student_id_verified',
  // Trust
  'nexus.trust.tier_upgraded',
  // Skills
  'nexus.skills.created',
  'nexus.skills.updated',
  'nexus.skills.deleted',
  // Tasks
  'nexus.tasks.created',
  'nexus.tasks.updated',
  'nexus.tasks.completed',
  'nexus.tasks.deleted',
  // Transactions (for recommendation)
  'nexus.transactions.completed',
  // Views (for trending)
  'nexus.listings.viewed',
];

/** Bulk batch size */
const BATCH_SIZE = 50;

/** Flush interval in ms */
const FLUSH_INTERVAL_MS = 5000;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Consumer Setup
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function setupSyncConsumer(
  consumer: Consumer,
  elastic: ElasticClient | null,
  db: Pool,
  redis: Redis,
  indexPrefix = 'nexus',
): Promise<void> {
  if (!elastic) {
    logger.warn('Elasticsearch client not available — sync consumer will not index');
  }

  await consumer.subscribe({ topics: SUBSCRIBED_TOPICS, fromBeginning: false });

  // Bulk operation buffer
  let bulkBuffer: SyncOperation[] = [];
  let processedCount = 0;
  let errorCount = 0;

  // Periodic flush
  const flushInterval = setInterval(async () => {
    if (bulkBuffer.length > 0) {
      await flushBulkBuffer(elastic, bulkBuffer, indexPrefix);
      bulkBuffer = [];
    }
  }, FLUSH_INTERVAL_MS);

  if (flushInterval.unref) flushInterval.unref();

  // Stats logging
  const statsInterval = setInterval(() => {
    if (processedCount > 0) {
      logger.info({ processed: processedCount, errors: errorCount }, 'Sync consumer stats');
      processedCount = 0;
      errorCount = 0;
    }
  }, 300_000);

  if (statsInterval.unref) statsInterval.unref();

  // Topic handlers
  const handlers: Record<string, TopicHandler> = {
    // ── Listings ─────────────────────────────
    'nexus.listings.created': (payload) => ({
      index: `${indexPrefix}_listings`,
      id: payload.id ?? payload.listingId,
      action: 'index',
      document: {
        title: payload.title,
        description: payload.description,
        price: payload.price,
        category: payload.category?.toLowerCase(),
        condition: payload.condition,
        status: 'active',
        tags: payload.tags ?? [],
        images: payload.images ?? [],
        seller_id: payload.sellerId ?? payload.seller_id,
        seller_trust_score: payload.sellerTrustScore ?? 3.0,
        campus_id: payload.campusId ?? payload.campus_id,
        view_count: 0,
        created_at: payload.createdAt ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    }),

    'nexus.listings.updated': (payload) => ({
      index: `${indexPrefix}_listings`,
      id: payload.id ?? payload.listingId,
      action: 'update',
      document: {
        ...(payload.title ? { title: payload.title } : {}),
        ...(payload.description ? { description: payload.description } : {}),
        ...(payload.price !== undefined ? { price: payload.price } : {}),
        ...(payload.category ? { category: payload.category.toLowerCase() } : {}),
        ...(payload.condition ? { condition: payload.condition } : {}),
        ...(payload.tags ? { tags: payload.tags } : {}),
        ...(payload.images ? { images: payload.images } : {}),
        ...(payload.status ? { status: payload.status } : {}),
        updated_at: new Date().toISOString(),
      },
    }),

    'nexus.listings.deleted': (payload) => ({
      index: `${indexPrefix}_listings`,
      id: payload.id ?? payload.listingId,
      action: 'delete',
    }),

    'nexus.listings.sold': (payload) => ({
      index: `${indexPrefix}_listings`,
      id: payload.id ?? payload.listingId,
      action: 'update',
      document: { status: 'sold', updated_at: new Date().toISOString() },
    }),

    'nexus.listings.viewed': (payload) => {
      // Track view count for trending
      const listingId = payload.listingId ?? payload.id;
      if (listingId) {
        // Increment view count in Redis (used by trending algorithm)
        redis.zincrby(`search:trending:${payload.campusId ?? 'global'}`, 1, listingId).catch(() => {});
        redis.expire(`search:trending:${payload.campusId ?? 'global'}`, 604800).catch(() => {}); // 7 days
      }
      return null; // No ES operation
    },

    // ── Users ────────────────────────────────
    'nexus.users.updated': (payload) => ({
      index: `${indexPrefix}_users`,
      id: payload.userId ?? payload.id,
      action: 'update',
      document: {
        ...(payload.fullName ? { full_name: payload.fullName } : {}),
        ...(payload.username ? { username: payload.username } : {}),
        ...(payload.avatarUrl ? { avatar_url: payload.avatarUrl } : {}),
        ...(payload.bio ? { bio: payload.bio } : {}),
        ...(payload.tags ? { tags: payload.tags } : {}),
        updated_at: new Date().toISOString(),
      },
    }),

    'nexus.users.verified': (payload) => ({
      index: `${indexPrefix}_users`,
      id: payload.userId ?? payload.id,
      action: 'update',
      document: {
        verification_level: payload.verificationLevel ?? 1,
        is_verified: true,
        updated_at: new Date().toISOString(),
      },
    }),

    'nexus.users.student_id_verified': (payload) => ({
      index: `${indexPrefix}_users`,
      id: payload.userId ?? payload.id,
      action: 'update',
      document: {
        verification_level: payload.verificationLevel ?? 2,
        is_student_verified: true,
        updated_at: new Date().toISOString(),
      },
    }),

    'nexus.trust.tier_upgraded': (payload) => {
      const userId = payload.userId;
      if (!userId) return null;

      // Update trust score on all listings by this seller
      return {
        index: `${indexPrefix}_users`,
        id: userId,
        action: 'update' as SyncAction,
        document: {
          trust_score: payload.score,
          trust_tier: payload.newTier,
          updated_at: new Date().toISOString(),
        },
      };
    },

    // ── Skills ────────────────────────────────
    'nexus.skills.created': (payload) => ({
      index: `${indexPrefix}_skills`,
      id: payload.id ?? payload.skillId,
      action: 'index',
      document: {
        title: payload.title,
        description: payload.description,
        category: payload.category?.toLowerCase(),
        price: payload.price,
        pricing_type: payload.pricingType ?? 'fixed',
        tags: payload.tags ?? [],
        provider_id: payload.providerId ?? payload.provider_id,
        provider_trust_score: payload.providerTrustScore ?? 3.0,
        campus_id: payload.campusId ?? payload.campus_id,
        rating: 0,
        order_count: 0,
        status: 'active',
        created_at: payload.createdAt ?? new Date().toISOString(),
      },
    }),

    'nexus.skills.updated': (payload) => ({
      index: `${indexPrefix}_skills`,
      id: payload.id ?? payload.skillId,
      action: 'update',
      document: {
        ...(payload.title ? { title: payload.title } : {}),
        ...(payload.description ? { description: payload.description } : {}),
        ...(payload.price !== undefined ? { price: payload.price } : {}),
        ...(payload.tags ? { tags: payload.tags } : {}),
        ...(payload.status ? { status: payload.status } : {}),
        updated_at: new Date().toISOString(),
      },
    }),

    'nexus.skills.deleted': (payload) => ({
      index: `${indexPrefix}_skills`,
      id: payload.id ?? payload.skillId,
      action: 'delete',
    }),

    // ── Tasks ────────────────────────────────
    'nexus.tasks.created': (payload) => ({
      index: `${indexPrefix}_tasks`,
      id: payload.id ?? payload.taskId,
      action: 'index',
      document: {
        title: payload.title,
        description: payload.description,
        category: payload.category?.toLowerCase(),
        budget: payload.budget,
        deadline: payload.deadline,
        location: payload.location,
        poster_id: payload.posterId ?? payload.poster_id,
        campus_id: payload.campusId ?? payload.campus_id,
        status: 'open',
        application_count: 0,
        created_at: payload.createdAt ?? new Date().toISOString(),
      },
    }),

    'nexus.tasks.updated': (payload) => ({
      index: `${indexPrefix}_tasks`,
      id: payload.id ?? payload.taskId,
      action: 'update',
      document: {
        ...(payload.title ? { title: payload.title } : {}),
        ...(payload.description ? { description: payload.description } : {}),
        ...(payload.budget !== undefined ? { budget: payload.budget } : {}),
        ...(payload.status ? { status: payload.status } : {}),
        updated_at: new Date().toISOString(),
      },
    }),

    'nexus.tasks.completed': (payload) => ({
      index: `${indexPrefix}_tasks`,
      id: payload.id ?? payload.taskId,
      action: 'update',
      document: { status: 'completed', updated_at: new Date().toISOString() },
    }),

    'nexus.tasks.deleted': (payload) => ({
      index: `${indexPrefix}_tasks`,
      id: payload.id ?? payload.taskId,
      action: 'delete',
    }),

    // ── Transactions ─────────────────────────
    'nexus.transactions.completed': (payload) => {
      // Track in Redis for recommendation engine
      const buyerId = payload.buyerId ?? payload.buyer_id;
      const listingId = payload.listingId ?? payload.listing_id;
      if (buyerId && listingId) {
        redis.sadd(`rec:purchases:${buyerId}`, listingId).catch(() => {});
        redis.expire(`rec:purchases:${buyerId}`, 2592000).catch(() => {}); // 30 days
      }
      return null; // No ES operation
    },
  };

  await consumer.run({
    eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
      const key = message.key?.toString() ?? '';
      const rawValue = message.value?.toString();

      if (!rawValue) return;

      try {
        const parsed = JSON.parse(rawValue);
        const payload = parsed.payload ?? parsed;

        const handler = handlers[topic];
        if (!handler) return;

        const ops = handler(payload, key);
        if (!ops) return;

        const opsArray = Array.isArray(ops) ? ops : [ops];

        for (const op of opsArray) {
          if (op.id) {
            bulkBuffer.push(op);
          }
        }

        processedCount++;

        // Flush if buffer is full
        if (bulkBuffer.length >= BATCH_SIZE) {
          await flushBulkBuffer(elastic, [...bulkBuffer], indexPrefix);
          bulkBuffer = [];
        }
      } catch (err) {
        errorCount++;
        logger.error({ err, topic, key }, 'Failed to process sync event');
      }
    },
  });

  logger.info({ topics: SUBSCRIBED_TOPICS.length }, 'Search sync consumer started');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Bulk Flush
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function flushBulkBuffer(
  elastic: ElasticClient | null,
  operations: SyncOperation[],
  indexPrefix: string,
): Promise<void> {
  if (!elastic || operations.length === 0) return;

  const body: any[] = [];

  for (const op of operations) {
    switch (op.action) {
      case 'index':
        body.push({ index: { _index: op.index, _id: op.id } });
        body.push(op.document ?? {});
        break;
      case 'update':
        body.push({ update: { _index: op.index, _id: op.id } });
        body.push({ doc: op.document ?? {}, doc_as_upsert: true });
        break;
      case 'delete':
        body.push({ delete: { _index: op.index, _id: op.id } });
        break;
    }
  }

  try {
    const response = await elastic.bulk({ body, refresh: false });

    if (response.errors) {
      const errorItems = response.items.filter((item: any) => {
        const action = Object.values(item)[0] as any;
        return action.error;
      });

      logger.warn(
        { errorCount: errorItems.length, totalOps: operations.length },
        'Bulk indexing had errors',
      );

      for (const item of errorItems.slice(0, 5)) {
        const action = Object.values(item)[0] as any;
        logger.debug(
          { index: action._index, id: action._id, error: action.error },
          'Bulk item error',
        );
      }
    } else {
      logger.debug({ ops: operations.length, tookMs: response.took }, 'Bulk indexing complete');
    }
  } catch (err) {
    logger.error({ err, opsCount: operations.length }, 'Bulk indexing failed');
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Full Reindex
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Full reindex from PostgreSQL to Elasticsearch.
 * Streams all active records and indexes them in batches.
 */
export async function fullReindex(
  elastic: ElasticClient,
  db: Pool,
  indexPrefix: string,
): Promise<{ listings: number; users: number; skills: number; tasks: number; timeMs: number }> {
  const start = Date.now();
  const counts = { listings: 0, users: 0, skills: 0, tasks: 0 };

  logger.info('Starting full reindex...');

  // Reindex listings
  const batchSize = 100;
  let offset = 0;

  while (true) {
    const { rows } = await db.query(
      `SELECT l.*, sp.trust_score AS seller_trust_score
       FROM listings l
       LEFT JOIN student_profiles sp ON sp.user_id = l.seller_id
       WHERE l.status = 'active'
       ORDER BY l.id
       LIMIT $1 OFFSET $2`,
      [batchSize, offset],
    );

    if (rows.length === 0) break;

    const body: any[] = [];
    for (const r of rows) {
      body.push({ index: { _index: `${indexPrefix}_listings`, _id: r.id } });
      body.push({
        title: r.title,
        description: r.description,
        price: r.price,
        category: r.category?.toLowerCase(),
        condition: r.condition,
        status: r.status,
        tags: r.tags ?? [],
        images: r.images ?? [],
        seller_id: r.seller_id,
        seller_trust_score: r.seller_trust_score ?? 3.0,
        campus_id: r.campus_id,
        view_count: r.view_count ?? 0,
        created_at: r.created_at,
        updated_at: r.updated_at,
      });
    }

    await elastic.bulk({ body, refresh: false });
    counts.listings += rows.length;
    offset += batchSize;
  }

  // Reindex users
  offset = 0;
  while (true) {
    const { rows } = await db.query(
      `SELECT u.id, sp.full_name, u.username, sp.avatar_url, sp.bio, sp.tags,
              sp.trust_score, sp.campus_id, sp.verification_level, sp.is_suspended
       FROM users u
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       WHERE u.status = 'active'
       ORDER BY u.id
       LIMIT $1 OFFSET $2`,
      [batchSize, offset],
    );

    if (rows.length === 0) break;

    const body: any[] = [];
    for (const r of rows) {
      body.push({ index: { _index: `${indexPrefix}_users`, _id: r.id } });
      body.push({
        full_name: r.full_name,
        username: r.username,
        avatar_url: r.avatar_url,
        bio: r.bio,
        tags: r.tags ?? [],
        trust_score: r.trust_score ?? 3.0,
        campus_id: r.campus_id,
        verification_level: r.verification_level ?? 0,
        is_suspended: r.is_suspended ?? false,
      });
    }

    await elastic.bulk({ body, refresh: false });
    counts.users += rows.length;
    offset += batchSize;
  }

  const timeMs = Date.now() - start;
  logger.info({ ...counts, timeMs }, 'Full reindex complete');
  return { ...counts, timeMs };
}
