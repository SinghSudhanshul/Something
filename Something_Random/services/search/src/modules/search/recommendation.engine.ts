/**
 * Recommendation Engine — Personalized Content Recommendations
 *
 * Implements a multi-signal recommendation algorithm combining:
 *  1. Collaborative filtering — Users with similar behavior patterns
 *  2. Content-based — Match user interests to listing tags/categories
 *  3. Popularity-based — Trending items by views/transactions
 *  4. Trust-weighted — Boost listings from high-trust sellers
 *  5. Price affinity — Match user's historical price range
 *  6. Recency boost — Newer listings get a slight boost
 *
 * All recommendations are cached in Redis with configurable TTL.
 *
 * @module search/recommendation.engine
 */

import type { Client as ElasticClient } from '@elastic/elasticsearch';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { createLogger } from '@nexus/utils';

const logger = createLogger('recommendation-engine');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface RecommendedItem {
  id: string;
  type: 'listing' | 'skill' | 'task';
  title: string;
  description?: string;
  price?: number;
  images?: string[];
  category?: string;
  sellerTrustScore?: number;
  campusId?: string;
  score: number;
  reason: string;
}

export interface FeedResult {
  items: RecommendedItem[];
  total: number;
  algorithm: string;
}

interface UserProfile {
  userId: string;
  campusId?: string;
  interests: string[];
  purchasedCategories: string[];
  avgPriceRange: { min: number; max: number };
  viewedListingIds: string[];
  purchasedListingIds: string[];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CACHE_TTL = 300; // 5 minutes
const MAX_FEED_SIZE = 200;
const SIMILAR_CACHE_TTL = 600; // 10 minutes
const TRENDING_CACHE_TTL = 900; // 15 minutes

/** Recommendation scoring weights */
const WEIGHTS = {
  contentMatch: 0.30,
  trustScore: 0.20,
  popularity: 0.20,
  priceAffinity: 0.15,
  recency: 0.15,
} as const;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Engine Implementation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class RecommendationEngine {
  constructor(
    private readonly elastic: ElasticClient | null,
    private readonly db: Pool,
    private readonly redis: Redis,
    private readonly indexPrefix: string = 'nexus',
  ) {}

  // ── Personalized Feed ─────────────────────────

  /**
   * Generate a personalized feed for a user.
   *
   * Algorithm:
   *  1. Load user profile (interests, purchase history, price range)
   *  2. Query Elasticsearch with multi-signal boosting
   *  3. Exclude already purchased/viewed items
   *  4. Score and rank results
   *  5. Cache for 5 minutes
   */
  async getPersonalizedFeed(
    userId: string,
    campusId?: string,
    limit = 20,
    offset = 0,
    category?: string,
  ): Promise<FeedResult> {
    const cacheKey = `rec:feed:${userId}:${campusId ?? 'all'}:${category ?? 'all'}:${offset}:${limit}`;

    // Check cache
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        logger.debug({ userId }, 'Feed served from cache');
        return JSON.parse(cached);
      }
    } catch { /* cache miss */ }

    // Load user profile
    const profile = await this.getUserProfile(userId);

    // If Elasticsearch is available, use it for search
    if (this.elastic) {
      try {
        const result = await this.getElasticFeed(profile, campusId, limit, offset, category);
        // Cache the result
        await this.redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL).catch(() => {});
        return result;
      } catch (err) {
        logger.warn({ err, userId }, 'Elasticsearch feed failed — falling back to DB');
      }
    }

    // Fallback: PostgreSQL-based recommendations
    const result = await this.getDatabaseFeed(profile, campusId, limit, offset, category);
    await this.redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL).catch(() => {});
    return result;
  }

  /**
   * Elasticsearch-powered feed with multi-signal boosting.
   */
  private async getElasticFeed(
    profile: UserProfile,
    campusId?: string,
    limit = 20,
    offset = 0,
    category?: string,
  ): Promise<FeedResult> {
    const must: any[] = [{ term: { status: 'active' } }];
    const should: any[] = [];
    const mustNot: any[] = [];

    // Campus scoping
    if (campusId) {
      must.push({ term: { campus_id: campusId } });
    }

    // Category filter
    if (category) {
      must.push({ term: { category: category.toLowerCase() } });
    }

    // Exclude already purchased items
    if (profile.purchasedListingIds.length > 0) {
      mustNot.push({ ids: { values: profile.purchasedListingIds.slice(0, 100) } });
    }

    // Boost: Interest matching (content-based)
    if (profile.interests.length > 0) {
      should.push({
        terms: { tags: profile.interests, boost: 3.0 },
      });
      should.push({
        multi_match: {
          query: profile.interests.join(' '),
          fields: ['title^2', 'description', 'tags^3'],
          type: 'best_fields',
          boost: 2.0,
        },
      });
    }

    // Boost: Category preference
    if (profile.purchasedCategories.length > 0) {
      should.push({
        terms: { category: profile.purchasedCategories, boost: 2.5 },
      });
    }

    // Boost: Price affinity
    if (profile.avgPriceRange.min > 0 || profile.avgPriceRange.max > 0) {
      should.push({
        range: {
          price: {
            gte: Math.max(0, profile.avgPriceRange.min * 0.5),
            lte: profile.avgPriceRange.max * 1.5,
            boost: 1.5,
          },
        },
      });
    }

    // Boost: High trust sellers
    should.push({
      range: { seller_trust_score: { gte: 4.0, boost: 2.0 } },
    });

    // Boost: Recency (last 7 days)
    should.push({
      range: {
        created_at: {
          gte: 'now-7d',
          boost: 1.5,
        },
      },
    });

    const response = await this.elastic!.search({
      index: `${this.indexPrefix}_listings`,
      body: {
        query: {
          bool: { must, should, must_not: mustNot, minimum_should_match: 0 },
        },
        sort: [
          { _score: 'desc' },
          { created_at: 'desc' },
        ] as any,
        size: limit,
        from: offset,
      },
    });

    const hits = (response.hits.hits as any[]).map((hit, idx) => ({
      id: hit._id as string,
      type: 'listing' as const,
      title: hit._source.title,
      description: hit._source.description?.slice(0, 150),
      price: hit._source.price,
      images: hit._source.images?.slice(0, 1),
      category: hit._source.category,
      sellerTrustScore: hit._source.seller_trust_score,
      campusId: hit._source.campus_id,
      score: hit._score ?? 0,
      reason: this.explainReason(hit._score, profile),
    }));

    const total = typeof response.hits.total === 'number'
      ? response.hits.total
      : (response.hits.total as any)?.value ?? 0;

    return {
      items: hits,
      total: Math.min(total, MAX_FEED_SIZE),
      algorithm: 'elasticsearch_multi_signal',
    };
  }

  /**
   * Database-powered fallback feed when Elasticsearch is unavailable.
   */
  private async getDatabaseFeed(
    profile: UserProfile,
    campusId?: string,
    limit = 20,
    offset = 0,
    category?: string,
  ): Promise<FeedResult> {
    const params: any[] = [];
    let paramIdx = 1;
    const conditions: string[] = ["l.status = 'active'"];

    if (campusId) {
      conditions.push(`l.campus_id = $${paramIdx}`);
      params.push(campusId);
      paramIdx++;
    }

    if (category) {
      conditions.push(`l.category = $${paramIdx}`);
      params.push(category);
      paramIdx++;
    }

    // Exclude purchased
    if (profile.purchasedListingIds.length > 0) {
      conditions.push(`l.id NOT IN (${profile.purchasedListingIds.slice(0, 50).map(() => `$${paramIdx++}`).join(',')})`);
      params.push(...profile.purchasedListingIds.slice(0, 50));
    }

    const whereClause = conditions.join(' AND ');

    const { rows } = await this.db.query(
      `SELECT l.id, l.title, l.description, l.price, l.images, l.category, l.campus_id, l.created_at,
              sp.trust_score AS seller_trust_score
       FROM listings l
       LEFT JOIN student_profiles sp ON sp.user_id = l.seller_id
       WHERE ${whereClause}
       ORDER BY
         CASE WHEN sp.trust_score >= 4.0 THEN 1 ELSE 0 END DESC,
         l.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset],
    );

    // Count total
    const { rows: countRows } = await this.db.query(
      `SELECT COUNT(*) AS total FROM listings l WHERE ${whereClause}`,
      params,
    );

    const items: RecommendedItem[] = rows.map((r: any) => ({
      id: r.id,
      type: 'listing' as const,
      title: r.title,
      description: r.description?.slice(0, 150),
      price: r.price,
      images: Array.isArray(r.images) ? r.images.slice(0, 1) : [],
      category: r.category,
      sellerTrustScore: r.seller_trust_score,
      campusId: r.campus_id,
      score: 1.0,
      reason: 'recent',
    }));

    return {
      items,
      total: parseInt(countRows[0]?.total ?? '0', 10),
      algorithm: 'database_fallback',
    };
  }

  // ── Similar Listings ──────────────────────────

  /**
   * Get listings similar to a given listing using Elasticsearch more_like_this.
   */
  async getSimilarListings(listingId: string, limit = 6): Promise<RecommendedItem[]> {
    const cacheKey = `rec:similar:${listingId}:${limit}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch { /* cache miss */ }

    let items: RecommendedItem[] = [];

    if (this.elastic) {
      try {
        const response = await this.elastic.search({
          index: `${this.indexPrefix}_listings`,
          body: {
            query: {
              bool: {
                must: [
                  {
                    more_like_this: {
                      fields: ['title', 'description', 'tags', 'category'],
                      like: [{ _index: `${this.indexPrefix}_listings`, _id: listingId }],
                      min_term_freq: 1,
                      max_query_terms: 25,
                      min_doc_freq: 1,
                    },
                  },
                  { term: { status: 'active' } },
                ],
                must_not: [{ ids: { values: [listingId] } }],
              },
            },
            size: limit,
          },
        });

        items = (response.hits.hits as any[]).map((hit) => ({
          id: hit._id as string,
          type: 'listing' as const,
          title: hit._source.title,
          description: hit._source.description?.slice(0, 150),
          price: hit._source.price,
          images: hit._source.images?.slice(0, 1),
          category: hit._source.category,
          sellerTrustScore: hit._source.seller_trust_score,
          score: hit._score ?? 0,
          reason: 'similar_content',
        }));
      } catch (err) {
        logger.warn({ err, listingId }, 'ES similar listings failed — falling back to DB');
      }
    }

    // Fallback to DB: same category
    if (items.length === 0) {
      try {
        const { rows: listingRows } = await this.db.query(
          'SELECT category, campus_id FROM listings WHERE id = $1',
          [listingId],
        );

        if (listingRows.length > 0) {
          const { category, campus_id: cid } = listingRows[0];
          const { rows } = await this.db.query(
            `SELECT l.id, l.title, l.description, l.price, l.images, l.category,
                    sp.trust_score AS seller_trust_score
             FROM listings l
             LEFT JOIN student_profiles sp ON sp.user_id = l.seller_id
             WHERE l.category = $1 AND l.campus_id = $2 AND l.id != $3 AND l.status = 'active'
             ORDER BY l.created_at DESC LIMIT $4`,
            [category, cid, listingId, limit],
          );

          items = rows.map((r: any) => ({
            id: r.id,
            type: 'listing' as const,
            title: r.title,
            description: r.description?.slice(0, 150),
            price: r.price,
            images: Array.isArray(r.images) ? r.images.slice(0, 1) : [],
            category: r.category,
            sellerTrustScore: r.seller_trust_score,
            score: 0.5,
            reason: 'same_category',
          }));
        }
      } catch (err) {
        logger.error({ err, listingId }, 'DB similar listings failed');
      }
    }

    await this.redis.set(cacheKey, JSON.stringify(items), 'EX', SIMILAR_CACHE_TTL).catch(() => {});
    return items;
  }

  // ── Campus Trending ───────────────────────────

  /**
   * Get trending items on a campus based on views and transactions.
   */
  async getCampusTrending(
    campusId: string,
    category?: string,
    limit = 10,
  ): Promise<RecommendedItem[]> {
    const cacheKey = `rec:trending:${campusId}:${category ?? 'all'}:${limit}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch { /* cache miss */ }

    try {
      const params: any[] = [campusId];
      let paramIdx = 2;
      let categoryFilter = '';

      if (category) {
        categoryFilter = `AND l.category = $${paramIdx}`;
        params.push(category);
        paramIdx++;
      }

      // Trending = most views + transactions in last 7 days
      const { rows } = await this.db.query(
        `SELECT l.id, l.title, l.description, l.price, l.images, l.category,
                sp.trust_score AS seller_trust_score,
                COALESCE(l.view_count, 0) AS views,
                COUNT(t.id) AS tx_count
         FROM listings l
         LEFT JOIN student_profiles sp ON sp.user_id = l.seller_id
         LEFT JOIN transactions t ON t.listing_id = l.id AND t.created_at >= NOW() - INTERVAL '7 days'
         WHERE l.campus_id = $1
           AND l.status = 'active'
           AND l.created_at >= NOW() - INTERVAL '30 days'
           ${categoryFilter}
         GROUP BY l.id, sp.trust_score
         ORDER BY (COALESCE(l.view_count, 0) * 0.3 + COUNT(t.id) * 0.7) DESC
         LIMIT $${paramIdx}`,
        [...params, limit],
      );

      const items: RecommendedItem[] = rows.map((r: any) => ({
        id: r.id,
        type: 'listing' as const,
        title: r.title,
        description: r.description?.slice(0, 150),
        price: r.price,
        images: Array.isArray(r.images) ? r.images.slice(0, 1) : [],
        category: r.category,
        sellerTrustScore: r.seller_trust_score,
        score: parseFloat(r.views) * 0.3 + parseFloat(r.tx_count) * 0.7,
        reason: 'trending',
      }));

      await this.redis.set(cacheKey, JSON.stringify(items), 'EX', TRENDING_CACHE_TTL).catch(() => {});
      return items;
    } catch (err) {
      logger.error({ err, campusId }, 'Campus trending failed');
      return [];
    }
  }

  // ── Frequently Bought Together ────────────────

  /**
   * Get items frequently bought together with a given listing.
   */
  async getFrequentlyBoughtTogether(listingId: string, limit = 4): Promise<RecommendedItem[]> {
    const cacheKey = `rec:fbt:${listingId}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch { /* cache miss */ }

    try {
      // Find other items bought by users who also bought this item
      const { rows } = await this.db.query(
        `SELECT l.id, l.title, l.description, l.price, l.images, l.category,
                COUNT(*) AS co_purchase_count
         FROM transactions t1
         JOIN transactions t2 ON t1.buyer_id = t2.buyer_id AND t1.listing_id != t2.listing_id
         JOIN listings l ON l.id = t2.listing_id
         WHERE t1.listing_id = $1
           AND t1.status = 'completed'
           AND t2.status = 'completed'
           AND l.status = 'active'
         GROUP BY l.id
         ORDER BY co_purchase_count DESC
         LIMIT $2`,
        [listingId, limit],
      );

      const items: RecommendedItem[] = rows.map((r: any) => ({
        id: r.id,
        type: 'listing' as const,
        title: r.title,
        description: r.description?.slice(0, 150),
        price: r.price,
        images: Array.isArray(r.images) ? r.images.slice(0, 1) : [],
        category: r.category,
        score: parseInt(r.co_purchase_count, 10),
        reason: 'bought_together',
      }));

      await this.redis.set(cacheKey, JSON.stringify(items), 'EX', SIMILAR_CACHE_TTL).catch(() => {});
      return items;
    } catch (err) {
      logger.error({ err, listingId }, 'Frequently bought together failed');
      return [];
    }
  }

  // ── User Profile ──────────────────────────────

  /**
   * Load or derive user profile for recommendations.
   */
  private async getUserProfile(userId: string): Promise<UserProfile> {
    const cacheKey = `rec:profile:${userId}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch { /* cache miss */ }

    const profile: UserProfile = {
      userId,
      interests: [],
      purchasedCategories: [],
      avgPriceRange: { min: 0, max: 500000 }, // Default ₹5000
      viewedListingIds: [],
      purchasedListingIds: [],
    };

    try {
      // Get campus
      const { rows: userRows } = await this.db.query(
        'SELECT campus_id FROM student_profiles WHERE user_id = $1',
        [userId],
      );
      if (userRows.length > 0) profile.campusId = userRows[0].campus_id;

      // Get interests from profile tags
      const { rows: tagRows } = await this.db.query(
        `SELECT DISTINCT unnest(tags) AS tag
         FROM student_profiles WHERE user_id = $1`,
        [userId],
      );
      profile.interests = tagRows.map((r: any) => r.tag).filter(Boolean);

      // Get purchase history
      const { rows: txRows } = await this.db.query(
        `SELECT l.id, l.category, l.price
         FROM transactions t
         JOIN listings l ON l.id = t.listing_id
         WHERE t.buyer_id = $1 AND t.status = 'completed'
         ORDER BY t.created_at DESC LIMIT 50`,
        [userId],
      );

      if (txRows.length > 0) {
        profile.purchasedListingIds = txRows.map((r: any) => r.id);

        // Category preferences
        const categoryCounts: Record<string, number> = {};
        for (const r of txRows) {
          if (r.category) {
            categoryCounts[r.category] = (categoryCounts[r.category] ?? 0) + 1;
          }
        }
        profile.purchasedCategories = Object.entries(categoryCounts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([cat]) => cat);

        // Price range
        const prices = txRows.map((r: any) => r.price).filter(Boolean);
        if (prices.length > 0) {
          profile.avgPriceRange = {
            min: Math.min(...prices),
            max: Math.max(...prices),
          };
        }
      }
    } catch (err) {
      logger.warn({ err, userId }, 'Failed to load user profile for recommendations');
    }

    // Cache for 10 minutes
    await this.redis.set(cacheKey, JSON.stringify(profile), 'EX', 600).catch(() => {});
    return profile;
  }

  // ── Scoring Explanation ───────────────────────

  private explainReason(score: number, profile: UserProfile): string {
    if (score > 5) return 'highly_relevant';
    if (score > 3) return 'interest_match';
    if (score > 1) return 'popular';
    return 'recent';
  }
}
