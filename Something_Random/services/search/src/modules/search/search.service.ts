/**
 * Search Service — Core Search Implementation
 *
 * Multi-index search across listings, users, skills, and tasks.
 * Elasticsearch primary with PostgreSQL fallback.
 *
 * Features:
 *  - Full-text search with highlight
 *  - Faceted search (category, price range, condition)
 *  - Autocomplete with prefix matching
 *  - Trending searches tracking
 *  - Search logging for analytics
 *  - Campus-scoped results
 *  - Redis caching
 *
 * @module search/search.service
 */

import type { Client as ElasticClient } from '@elastic/elasticsearch';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { createLogger } from '@nexus/utils';

import type {
  SearchResult, SearchHit, SearchFacets, AutocompleteSuggestion,
  TrendingSearch, ListingSearchFilters, UserSearchFilters,
  SkillSearchFilters, TaskSearchFilters, UnifiedSearchFilters,
  SearchSortOption,
} from '../../types/index.js';

const logger = createLogger('search-service');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SEARCH_CACHE_TTL = 120; // 2 minutes
const AUTOCOMPLETE_CACHE_TTL = 60; // 1 minute
const TRENDING_CACHE_TTL = 900; // 15 minutes
const SEARCH_LOG_TTL = 604800; // 7 days

/** Sort mappings for Elasticsearch */
const SORT_MAP: Record<SearchSortOption, any[]> = {
  relevance: [{ _score: 'desc' }, { created_at: 'desc' }],
  price_asc: [{ price: 'asc' }, { _score: 'desc' }],
  price_desc: [{ price: 'desc' }, { _score: 'desc' }],
  newest: [{ created_at: 'desc' }],
  oldest: [{ created_at: 'asc' }],
  trust_score: [{ seller_trust_score: 'desc' }, { _score: 'desc' }],
  rating: [{ rating: 'desc' }, { _score: 'desc' }],
  popularity: [{ view_count: 'desc' }, { _score: 'desc' }],
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Service
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class SearchService {
  private reindexFn: (() => Promise<any>) | null = null;

  constructor(
    private readonly elastic: ElasticClient | null,
    private readonly db: Pool,
    private readonly redis: Redis,
    private readonly indexPrefix: string = 'nexus',
  ) {}

  /**
   * Set the full reindex function (called from index.ts after consumer is ready).
   */
  setTriggerReindex(fn: () => Promise<any>): void {
    this.reindexFn = fn;
  }

  /**
   * Trigger a full reindex.
   */
  async triggerFullReindex(): Promise<any> {
    if (!this.reindexFn) throw new Error('Reindex function not initialized');
    return this.reindexFn();
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Unified Search
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Search across all content types.
   */
  async unifiedSearch(query: string, filters: UnifiedSearchFilters): Promise<SearchResult> {
    const start = Date.now();
    const cacheKey = `search:unified:${this.hashQuery(query, filters)}`;

    // Cache check
    const cached = await this.getCached<SearchResult>(cacheKey);
    if (cached) return cached;

    if (this.elastic) {
      try {
        const result = await this.elasticUnifiedSearch(query, filters);
        result.tookMs = Date.now() - start;
        await this.setCached(cacheKey, result, SEARCH_CACHE_TTL);
        return result;
      } catch (err) {
        logger.warn({ err }, 'Elasticsearch unified search failed — falling back to DB');
      }
    }

    const result = await this.dbUnifiedSearch(query, filters);
    result.tookMs = Date.now() - start;
    await this.setCached(cacheKey, result, SEARCH_CACHE_TTL);
    return result;
  }

  private async elasticUnifiedSearch(query: string, filters: UnifiedSearchFilters): Promise<SearchResult> {
    const indices: string[] = [];
    const ct = filters.contentType ?? 'all';

    if (ct === 'all' || ct === 'listing') indices.push(`${this.indexPrefix}_listings`);
    if (ct === 'all' || ct === 'user') indices.push(`${this.indexPrefix}_users`);
    if (ct === 'all' || ct === 'skill') indices.push(`${this.indexPrefix}_skills`);
    if (ct === 'all' || ct === 'task') indices.push(`${this.indexPrefix}_tasks`);

    const must: any[] = [];
    const should: any[] = [];

    // Main query
    must.push({
      multi_match: {
        query,
        fields: ['title^3', 'full_name^3', 'username^2', 'description', 'tags^2', 'bio', 'category'],
        type: 'best_fields',
        fuzziness: 'AUTO',
        prefix_length: 2,
      },
    });

    // Campus scoping
    if (filters.campusId) {
      should.push({ term: { campus_id: { value: filters.campusId, boost: 2.0 } } });
    }

    const response = await this.elastic!.search({
      index: indices.join(','),
      body: {
        query: { bool: { must, should, minimum_should_match: 0 } },
        sort: SORT_MAP[filters.sort ?? 'relevance'],
        size: filters.limit ?? 20,
        from: filters.offset ?? 0,
        highlight: {
          fields: {
            title: { number_of_fragments: 1 },
            description: { number_of_fragments: 2, fragment_size: 150 },
            full_name: { number_of_fragments: 1 },
          },
          pre_tags: ['<mark>'],
          post_tags: ['</mark>'],
        },
      },
    });

    return this.parseElasticResponse(response);
  }

  private async dbUnifiedSearch(query: string, filters: UnifiedSearchFilters): Promise<SearchResult> {
    const tsQuery = query.split(/\s+/).filter(Boolean).map(w => `${w}:*`).join(' & ');
    const params: any[] = [];
    let paramIdx = 1;

    // Search listings
    let campusFilter = '';
    if (filters.campusId) {
      campusFilter = `AND campus_id = $${paramIdx}`;
      params.push(filters.campusId);
      paramIdx++;
    }

    params.push(filters.limit ?? 20, filters.offset ?? 0);

    const { rows } = await this.db.query(
      `SELECT id, title, description, price, category, 'listing' AS type, created_at,
              ts_rank(to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(description, '')), to_tsquery('english', $${paramIdx})) AS rank
       FROM listings
       WHERE to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(description, '')) @@ to_tsquery('english', $${paramIdx})
         AND status = 'active' ${campusFilter}
       ORDER BY rank DESC
       LIMIT $${paramIdx - 2} OFFSET $${paramIdx - 1}`,
      [...params, tsQuery],
    );

    // Count
    const { rows: countRows } = await this.db.query(
      `SELECT COUNT(*) AS total FROM listings
       WHERE to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(description, '')) @@ to_tsquery('english', $1)
         AND status = 'active' ${campusFilter}`,
      [tsQuery, ...(filters.campusId ? [filters.campusId] : [])],
    );

    const hits: SearchHit[] = rows.map((r: any) => ({
      id: r.id,
      type: r.type ?? 'listing',
      title: r.title,
      description: r.description?.slice(0, 150),
      price: r.price,
      category: r.category,
      score: parseFloat(r.rank) || 0,
    }));

    return {
      hits,
      total: parseInt(countRows[0]?.total ?? '0', 10),
      tookMs: 0,
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Listing Search
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async searchListings(query: string, filters: ListingSearchFilters): Promise<SearchResult> {
    const start = Date.now();
    const cacheKey = `search:listings:${this.hashQuery(query, filters)}`;

    const cached = await this.getCached<SearchResult>(cacheKey);
    if (cached) return cached;

    if (this.elastic && query.trim()) {
      try {
        const result = await this.elasticListingSearch(query, filters);
        result.tookMs = Date.now() - start;
        await this.setCached(cacheKey, result, SEARCH_CACHE_TTL);
        return result;
      } catch (err) {
        logger.warn({ err }, 'ES listing search failed — falling back to DB');
      }
    }

    const result = await this.dbListingSearch(query, filters);
    result.tookMs = Date.now() - start;
    await this.setCached(cacheKey, result, SEARCH_CACHE_TTL);
    return result;
  }

  private async elasticListingSearch(query: string, filters: ListingSearchFilters): Promise<SearchResult> {
    const must: any[] = [{ term: { status: filters.status ?? 'active' } }];
    const filter: any[] = [];

    if (query.trim()) {
      must.push({
        multi_match: {
          query,
          fields: ['title^3', 'description', 'tags^2'],
          type: 'best_fields',
          fuzziness: 'AUTO',
          prefix_length: 2,
        },
      });
    }

    if (filters.campusId) filter.push({ term: { campus_id: filters.campusId } });
    if (filters.category) filter.push({ term: { category: filters.category.toLowerCase() } });
    if (filters.condition) filter.push({ term: { condition: filters.condition } });
    if (filters.priceMin !== undefined || filters.priceMax !== undefined) {
      const priceRange: any = {};
      if (filters.priceMin !== undefined) priceRange.gte = filters.priceMin;
      if (filters.priceMax !== undefined) priceRange.lte = filters.priceMax;
      filter.push({ range: { price: priceRange } });
    }

    const response = await this.elastic!.search({
      index: `${this.indexPrefix}_listings`,
      body: {
        query: { bool: { must, filter } },
        sort: SORT_MAP[filters.sort ?? 'relevance'],
        size: filters.limit ?? 20,
        from: filters.offset ?? 0,
        highlight: {
          fields: {
            title: { number_of_fragments: 1 },
            description: { number_of_fragments: 2, fragment_size: 150 },
          },
        },
        aggs: {
          categories: { terms: { field: 'category', size: 20 } },
          price_ranges: {
            range: {
              field: 'price',
              ranges: [
                { key: 'Under ₹100', to: 10000 },
                { key: '₹100-₹500', from: 10000, to: 50000 },
                { key: '₹500-₹2000', from: 50000, to: 200000 },
                { key: '₹2000-₹10000', from: 200000, to: 1000000 },
                { key: 'Above ₹10000', from: 1000000 },
              ],
            },
          },
          conditions: { terms: { field: 'condition', size: 10 } },
        },
      },
    });

    const result = this.parseElasticResponse(response);

    // Parse facets
    const aggs = (response as any).aggregations;
    if (aggs) {
      result.facets = {
        categories: aggs.categories?.buckets?.map((b: any) => ({ key: b.key, count: b.doc_count })) ?? [],
        priceRanges: aggs.price_ranges?.buckets?.map((b: any) => ({
          key: b.key,
          from: b.from ?? 0,
          to: b.to ?? Infinity,
          count: b.doc_count,
        })) ?? [],
        conditions: aggs.conditions?.buckets?.map((b: any) => ({ key: b.key, count: b.doc_count })) ?? [],
      };
    }

    return result;
  }

  private async dbListingSearch(query: string, filters: ListingSearchFilters): Promise<SearchResult> {
    const conditions: string[] = [`status = '${filters.status ?? 'active'}'`];
    const params: any[] = [];
    let paramIdx = 1;

    if (filters.campusId) {
      conditions.push(`campus_id = $${paramIdx}`);
      params.push(filters.campusId);
      paramIdx++;
    }
    if (filters.category) {
      conditions.push(`category = $${paramIdx}`);
      params.push(filters.category);
      paramIdx++;
    }
    if (filters.condition) {
      conditions.push(`condition = $${paramIdx}`);
      params.push(filters.condition);
      paramIdx++;
    }
    if (filters.priceMin !== undefined) {
      conditions.push(`price >= $${paramIdx}`);
      params.push(filters.priceMin);
      paramIdx++;
    }
    if (filters.priceMax !== undefined) {
      conditions.push(`price <= $${paramIdx}`);
      params.push(filters.priceMax);
      paramIdx++;
    }

    let rankSelect = '1 AS rank';
    if (query.trim()) {
      const tsQuery = query.split(/\s+/).filter(Boolean).map(w => `${w}:*`).join(' & ');
      conditions.push(`to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(description, '')) @@ to_tsquery('english', $${paramIdx})`);
      rankSelect = `ts_rank(to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(description, '')), to_tsquery('english', $${paramIdx})) AS rank`;
      params.push(tsQuery);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');
    const orderBy = this.getDbSortClause(filters.sort);

    params.push(filters.limit ?? 20, filters.offset ?? 0);

    const { rows } = await this.db.query(
      `SELECT id, title, description, price, category, condition, images, campus_id, created_at, ${rankSelect}
       FROM listings WHERE ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params,
    );

    const { rows: countRows } = await this.db.query(
      `SELECT COUNT(*) AS total FROM listings WHERE ${whereClause}`,
      params.slice(0, -2),
    );

    return {
      hits: rows.map((r: any) => ({
        id: r.id,
        type: 'listing' as const,
        title: r.title,
        description: r.description?.slice(0, 150),
        price: r.price,
        category: r.category,
        condition: r.condition,
        images: r.images,
        campusId: r.campus_id,
        score: parseFloat(r.rank) || 0,
      })),
      total: parseInt(countRows[0]?.total ?? '0', 10),
      tookMs: 0,
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // User Search
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async searchUsers(query: string, filters: UserSearchFilters): Promise<SearchResult> {
    const start = Date.now();

    if (this.elastic) {
      try {
        const must: any[] = [{
          multi_match: {
            query,
            fields: ['full_name^3', 'username^2', 'bio', 'tags'],
            fuzziness: 'AUTO',
          },
        }];
        const filter: any[] = [];
        if (filters.campusId) filter.push({ term: { campus_id: filters.campusId } });

        const response = await this.elastic.search({
          index: `${this.indexPrefix}_users`,
          body: {
            query: { bool: { must, filter } },
            size: filters.limit ?? 20,
            from: filters.offset ?? 0,
            _source: ['full_name', 'username', 'avatar_url', 'bio', 'trust_score', 'campus_id', 'verification_level'],
          },
        });

        const result = this.parseElasticResponse(response);
        result.tookMs = Date.now() - start;
        return result;
      } catch (err) {
        logger.warn({ err }, 'ES user search failed');
      }
    }

    // DB fallback
    const params: any[] = [`%${query}%`];
    let paramIdx = 2;
    let campusFilter = '';
    if (filters.campusId) {
      campusFilter = `AND sp.campus_id = $${paramIdx}`;
      params.push(filters.campusId);
      paramIdx++;
    }

    params.push(filters.limit ?? 20, filters.offset ?? 0);

    const { rows } = await this.db.query(
      `SELECT u.id, sp.full_name, u.username, sp.avatar_url, sp.bio, sp.trust_score, sp.campus_id
       FROM users u LEFT JOIN student_profiles sp ON sp.user_id = u.id
       WHERE (sp.full_name ILIKE $1 OR u.username ILIKE $1) AND u.status = 'active' ${campusFilter}
       ORDER BY sp.trust_score DESC NULLS LAST
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params,
    );

    return {
      hits: rows.map((r: any) => ({
        id: r.id,
        type: 'user' as const,
        title: r.full_name ?? r.username,
        description: r.bio?.slice(0, 150),
        username: r.username,
        avatarUrl: r.avatar_url,
        trustScore: r.trust_score,
        campusId: r.campus_id,
        score: 1,
      })),
      total: rows.length,
      tookMs: Date.now() - start,
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Skill Search
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async searchSkills(query: string, filters: SkillSearchFilters): Promise<SearchResult> {
    const start = Date.now();

    if (this.elastic) {
      try {
        const must: any[] = [{ term: { status: 'active' } }];
        const filter: any[] = [];

        if (query.trim()) {
          must.push({
            multi_match: { query, fields: ['title^3', 'description', 'tags^2'], fuzziness: 'AUTO' },
          });
        }
        if (filters.campusId) filter.push({ term: { campus_id: filters.campusId } });
        if (filters.category) filter.push({ term: { category: filters.category.toLowerCase() } });

        const response = await this.elastic.search({
          index: `${this.indexPrefix}_skills`,
          body: {
            query: { bool: { must, filter } },
            sort: SORT_MAP[filters.sort ?? 'relevance'],
            size: filters.limit ?? 20,
            from: filters.offset ?? 0,
          },
        });

        const result = this.parseElasticResponse(response);
        result.tookMs = Date.now() - start;
        return result;
      } catch (err) {
        logger.warn({ err }, 'ES skill search failed');
      }
    }

    // DB fallback
    const { rows } = await this.db.query(
      `SELECT id, title, description, price, category, 'skill' AS type FROM skill_listings
       WHERE status = 'active' AND (title ILIKE $1 OR description ILIKE $1)
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [`%${query}%`, filters.limit ?? 20, filters.offset ?? 0],
    );

    return {
      hits: rows.map((r: any) => ({
        id: r.id, type: 'skill' as const, title: r.title,
        description: r.description?.slice(0, 150), price: r.price,
        category: r.category, score: 1,
      })),
      total: rows.length,
      tookMs: Date.now() - start,
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Task Search
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async searchTasks(query: string, filters: TaskSearchFilters): Promise<SearchResult> {
    const start = Date.now();

    if (this.elastic) {
      try {
        const must: any[] = [];
        const filter: any[] = [];

        if (query.trim()) {
          must.push({
            multi_match: { query, fields: ['title^3', 'description'], fuzziness: 'AUTO' },
          });
        }
        if (filters.campusId) filter.push({ term: { campus_id: filters.campusId } });
        if (filters.status) filter.push({ term: { status: filters.status } });
        if (filters.category) filter.push({ term: { category: filters.category.toLowerCase() } });

        const response = await this.elastic.search({
          index: `${this.indexPrefix}_tasks`,
          body: {
            query: { bool: { must: must.length ? must : [{ match_all: {} }], filter } },
            sort: SORT_MAP[filters.sort ?? 'relevance'],
            size: filters.limit ?? 20,
            from: filters.offset ?? 0,
          },
        });

        const result = this.parseElasticResponse(response);
        result.tookMs = Date.now() - start;
        return result;
      } catch (err) {
        logger.warn({ err }, 'ES task search failed');
      }
    }

    const { rows } = await this.db.query(
      `SELECT id, title, description, budget, category, status, 'task' AS type FROM tasks
       WHERE (title ILIKE $1 OR description ILIKE $1) AND status = $2
       ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
      [`%${query}%`, filters.status ?? 'open', filters.limit ?? 20, filters.offset ?? 0],
    );

    return {
      hits: rows.map((r: any) => ({
        id: r.id, type: 'task' as const, title: r.title,
        description: r.description?.slice(0, 150), budget: r.budget,
        category: r.category, status: r.status, score: 1,
      })),
      total: rows.length,
      tookMs: Date.now() - start,
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Autocomplete
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async autocomplete(prefix: string, type: string = 'all', limit = 5): Promise<AutocompleteSuggestion[]> {
    const cacheKey = `search:autocomplete:${type}:${prefix.toLowerCase()}`;

    const cached = await this.getCached<AutocompleteSuggestion[]>(cacheKey);
    if (cached) return cached;

    const suggestions: AutocompleteSuggestion[] = [];

    if (this.elastic) {
      try {
        const indices: string[] = [];
        if (type === 'all' || type === 'listing') indices.push(`${this.indexPrefix}_listings`);
        if (type === 'all' || type === 'user') indices.push(`${this.indexPrefix}_users`);
        if (type === 'all' || type === 'skill') indices.push(`${this.indexPrefix}_skills`);

        const response = await this.elastic.search({
          index: indices.join(','),
          body: {
            query: {
              bool: {
                should: [
                  { match_phrase_prefix: { title: { query: prefix, boost: 3.0 } } },
                  { match_phrase_prefix: { full_name: { query: prefix, boost: 2.0 } } },
                  { prefix: { username: { value: prefix.toLowerCase(), boost: 1.5 } } },
                ],
              },
            },
            size: limit,
            _source: ['title', 'full_name', 'username'],
          },
        });

        for (const hit of (response.hits.hits as any[])) {
          const src = hit._source;
          suggestions.push({
            text: src.title ?? src.full_name ?? src.username ?? '',
            type: this.inferContentType(hit._index),
            score: hit._score ?? 0,
            id: hit._id as string,
          });
        }
      } catch {
        // Fallback below
      }
    }

    if (suggestions.length === 0) {
      try {
        const { rows } = await this.db.query(
          `SELECT id, title, 'listing' AS type FROM listings
           WHERE title ILIKE $1 AND status = 'active' ORDER BY created_at DESC LIMIT $2`,
          [`${prefix}%`, limit],
        );
        for (const r of rows) {
          suggestions.push({ text: r.title, type: 'listing', score: 1, id: r.id });
        }
      } catch { /* fail silently */ }
    }

    await this.setCached(cacheKey, suggestions, AUTOCOMPLETE_CACHE_TTL);
    return suggestions;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Trending
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async getTrendingSearches(campusId: string, limit = 10): Promise<TrendingSearch[]> {
    const cacheKey = `search:trending:${campusId}:${limit}`;

    const cached = await this.getCached<TrendingSearch[]>(cacheKey);
    if (cached) return cached;

    try {
      const members = await this.redis.zrevrange(
        `search:queries:${campusId}`, 0, limit - 1, 'WITHSCORES',
      );

      const trending: TrendingSearch[] = [];
      for (let i = 0; i < members.length; i += 2) {
        trending.push({
          query: members[i] || '',
          count: parseInt(members[i + 1] ?? '0', 10),
          rank: Math.floor(i / 2) + 1,
        });
      }

      await this.setCached(cacheKey, trending, TRENDING_CACHE_TTL);
      return trending;
    } catch {
      return [];
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Search Logging
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async logSearch(userId: string, query: string, resultCount: number): Promise<void> {
    try {
      // Track search frequency for trending
      const campusId = await this.getUserCampusId(userId);
      const normalizedQuery = query.toLowerCase().trim();

      await this.redis.zincrby(`search:queries:${campusId ?? 'global'}`, 1, normalizedQuery);
      await this.redis.expire(`search:queries:${campusId ?? 'global'}`, SEARCH_LOG_TTL);

      // Log to DB for analytics
      await this.db.query(
        `INSERT INTO search_logs (user_id, query, result_count, campus_id, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [userId, normalizedQuery, resultCount, campusId],
      ).catch(() => {}); // Non-critical
    } catch {
      // Non-critical
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Helpers
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private parseElasticResponse(response: any): SearchResult {
    const hits: SearchHit[] = (response.hits.hits as any[]).map((hit) => ({
      id: hit._id as string,
      type: this.inferContentType(hit._index),
      title: hit._source.title ?? hit._source.full_name ?? hit._source.username ?? '',
      description: (hit._source.description ?? hit._source.bio ?? '').slice(0, 150),
      highlight: hit.highlight,
      score: hit._score ?? 0,
      ...hit._source,
    }));

    const total = typeof response.hits.total === 'number'
      ? response.hits.total
      : (response.hits.total as any)?.value ?? 0;

    return { hits, total, tookMs: response.took ?? 0 };
  }

  private inferContentType(index: string): 'listing' | 'user' | 'skill' | 'task' | 'all' {
    if (index.includes('listing')) return 'listing';
    if (index.includes('user')) return 'user';
    if (index.includes('skill')) return 'skill';
    if (index.includes('task')) return 'task';
    return 'all';
  }

  private hashQuery(query: string, filters: Record<string, any>): string {
    const raw = `${query}|${JSON.stringify(filters)}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36);
  }

  private getDbSortClause(sort?: SearchSortOption): string {
    switch (sort) {
      case 'price_asc': return 'price ASC NULLS LAST';
      case 'price_desc': return 'price DESC NULLS LAST';
      case 'newest': return 'created_at DESC';
      case 'oldest': return 'created_at ASC';
      case 'trust_score': return 'rank DESC';
      case 'popularity': return 'view_count DESC NULLS LAST';
      default: return 'rank DESC, created_at DESC';
    }
  }

  private async getCached<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.redis.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch { return null; }
  }

  private async setCached(key: string, data: unknown, ttl: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(data), 'EX', ttl);
    } catch { /* non-critical */ }
  }

  private async getUserCampusId(userId: string): Promise<string | null> {
    try {
      const cached = await this.redis.get(`user_campus:${userId}`);
      if (cached) return cached;

      const { rows } = await this.db.query(
        'SELECT campus_id FROM student_profiles WHERE user_id = $1',
        [userId],
      );
      const campusId = rows[0]?.campus_id ?? null;
      if (campusId) {
        await this.redis.set(`user_campus:${userId}`, campusId, 'EX', 3600).catch(() => {});
      }
      return campusId;
    } catch { return null; }
  }
}
