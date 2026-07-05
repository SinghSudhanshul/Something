/**
 * Search & Recommendations Routes — Full Fastify REST API
 *
 * Endpoints:
 *  GET  /api/v1/search                          — Unified search
 *  GET  /api/v1/search/listings                  — Listing-specific search with facets
 *  GET  /api/v1/search/users                     — User search
 *  GET  /api/v1/search/skills                    — Skill search
 *  GET  /api/v1/search/tasks                     — Task search
 *  GET  /api/v1/search/autocomplete              — Prefix autocomplete
 *  GET  /api/v1/search/trending                  — Trending searches
 *  GET  /api/v1/recommendations/feed             — Personalized feed
 *  GET  /api/v1/recommendations/similar/:id      — Similar listings
 *  GET  /api/v1/recommendations/trending         — Campus trending items
 *  POST /api/v1/search/reindex                   — Admin: trigger reindex
 *
 * @module search/search.routes
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@nexus/utils';
import type { SearchService } from './search.service.js';
import type { RecommendationEngine } from './recommendation.engine.js';

const logger = createLogger('search-routes');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface SearchQuery {
  q?: string;
  page?: string;
  limit?: string;
  sort?: string;
  campus_id?: string;
  category?: string;
  price_min?: string;
  price_max?: string;
  condition?: string;
  status?: string;
  type?: string;
}

interface AutocompleteQuery {
  q: string;
  type?: string;
  limit?: string;
}

interface TrendingQuery {
  campus_id?: string;
  limit?: string;
  period?: string;
}

interface FeedQuery {
  page?: string;
  limit?: string;
  category?: string;
}

interface SimilarParams {
  id: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function getAuthUserId(request: FastifyRequest): string | null {
  return (request.headers['x-authenticated-userid'] as string) || null;
}

function getUserCampusId(request: FastifyRequest): string | null {
  return (request.headers['x-user-campus-id'] as string) || null;
}

function isAdmin(request: FastifyRequest): boolean {
  const roles = (request.headers['x-user-roles'] as string) ?? '';
  return roles.split(',').some(r => ['super_admin', 'campus_admin'].includes(r.trim()));
}

function validateInternalSecret(request: FastifyRequest, secret: string): boolean {
  return (request.headers['x-internal-secret'] as string) === secret;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Route Registration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function registerSearchRoutes(
  app: FastifyInstance,
  searchService: SearchService,
  recommendationEngine: RecommendationEngine,
  internalSecret: string,
): Promise<void> {

  // ── GET /api/v1/search ────────────────────────
  // Unified search across all content types
  app.get<{ Querystring: SearchQuery }>(
    '/api/v1/search',
    async (request, reply) => {
      const userId = getAuthUserId(request);
      if (!userId) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });

      const {
        q: query = '',
        page = '1',
        limit = '20',
        sort = 'relevance',
        campus_id: campusId,
        type: contentType,
      } = request.query;

      if (!query || query.trim().length < 2) {
        return reply.code(400).send({ code: 'BAD_REQUEST', message: 'Query must be at least 2 characters' });
      }

      const safePage = Math.max(parseInt(page, 10), 1);
      const safeLimit = Math.min(Math.max(parseInt(limit, 10), 1), 50);
      const offset = (safePage - 1) * safeLimit;

      try {
        const effectiveCampusId = campusId || getUserCampusId(request);

        const results = await searchService.unifiedSearch(query.trim(), {
          campusId: effectiveCampusId ?? undefined,
          contentType: contentType as any,
          sort: sort as any,
          limit: safeLimit,
          offset,
        } as any);

        // Log search for analytics
        await searchService.logSearch(userId, query.trim(), results.total).catch(() => {});

        return reply.send({
          data: results.hits,
          meta: {
            query: query.trim(),
            page: safePage,
            limit: safeLimit,
            total: results.total,
            totalPages: Math.ceil(results.total / safeLimit),
            hasMore: offset + results.hits.length < results.total,
            tookMs: results.tookMs,
          },
        });
      } catch (err) {
        logger.error({ err, query }, 'Unified search failed');
        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Search failed' });
      }
    },
  );

  // ── GET /api/v1/search/listings ───────────────
  app.get<{ Querystring: SearchQuery }>(
    '/api/v1/search/listings',
    async (request, reply) => {
      const userId = getAuthUserId(request);
      if (!userId) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });

      const {
        q: query = '',
        page = '1',
        limit = '20',
        sort = 'relevance',
        campus_id: campusId,
        category,
        price_min: priceMin,
        price_max: priceMax,
        condition,
        status = 'active',
      } = request.query;

      const safePage = Math.max(parseInt(page, 10), 1);
      const safeLimit = Math.min(Math.max(parseInt(limit, 10), 1), 50);
      const offset = (safePage - 1) * safeLimit;

      try {
        const results = await searchService.searchListings(query.trim(), {
          campusId: campusId || getUserCampusId(request) || undefined,
          category,
          priceMin: priceMin ? parseInt(priceMin, 10) : undefined,
          priceMax: priceMax ? parseInt(priceMax, 10) : undefined,
          condition: condition as any,
          status: status as any,
          sort: sort as any,
          limit: safeLimit,
          offset,
        } as any);

        if (query.trim()) {
          await searchService.logSearch(userId, query.trim(), results.total).catch(() => {});
        }

        return reply.send({
          data: results.hits,
          facets: results.facets,
          meta: {
            query: query.trim() || undefined,
            page: safePage,
            limit: safeLimit,
            total: results.total,
            totalPages: Math.ceil(results.total / safeLimit),
            hasMore: offset + results.hits.length < results.total,
            tookMs: results.tookMs,
          },
        });
      } catch (err) {
        logger.error({ err, query }, 'Listing search failed');
        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Search failed' });
      }
    },
  );

  // ── GET /api/v1/search/users ──────────────────
  app.get<{ Querystring: SearchQuery }>(
    '/api/v1/search/users',
    async (request, reply) => {
      const userId = getAuthUserId(request);
      if (!userId) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });

      const { q: query = '', page = '1', limit = '20', campus_id: campusId } = request.query;

      if (!query || query.trim().length < 2) {
        return reply.code(400).send({ code: 'BAD_REQUEST', message: 'Query must be at least 2 characters' });
      }

      const safePage = Math.max(parseInt(page, 10), 1);
      const safeLimit = Math.min(Math.max(parseInt(limit, 10), 1), 30);
      const offset = (safePage - 1) * safeLimit;

      try {
        const results = await searchService.searchUsers(query.trim(), {
          campusId: campusId || getUserCampusId(request) || undefined,
          limit: safeLimit,
          offset,
        } as any);

        return reply.send({
          data: results.hits,
          meta: { query: query.trim(), page: safePage, limit: safeLimit, total: results.total },
        });
      } catch (err) {
        logger.error({ err, query }, 'User search failed');
        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Search failed' });
      }
    },
  );

  // ── GET /api/v1/search/skills ─────────────────
  app.get<{ Querystring: SearchQuery }>(
    '/api/v1/search/skills',
    async (request, reply) => {
      const userId = getAuthUserId(request);
      if (!userId) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });

      const { q: query = '', page = '1', limit = '20', campus_id: campusId, category, sort = 'relevance' } = request.query;
      const safePage = Math.max(parseInt(page, 10), 1);
      const safeLimit = Math.min(Math.max(parseInt(limit, 10), 1), 50);
      const offset = (safePage - 1) * safeLimit;

      try {
        const results = await searchService.searchSkills(query.trim(), {
          campusId: campusId || getUserCampusId(request) || undefined,
          category,
          sort: sort as any,
          limit: safeLimit,
          offset,
        } as any);

        return reply.send({
          data: results.hits,
          meta: { query: query.trim() || undefined, page: safePage, limit: safeLimit, total: results.total },
        });
      } catch (err) {
        logger.error({ err, query }, 'Skill search failed');
        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Search failed' });
      }
    },
  );

  // ── GET /api/v1/search/tasks ──────────────────
  app.get<{ Querystring: SearchQuery }>(
    '/api/v1/search/tasks',
    async (request, reply) => {
      const userId = getAuthUserId(request);
      if (!userId) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });

      const { q: query = '', page = '1', limit = '20', campus_id: campusId, category, status, sort = 'relevance' } = request.query;
      const safePage = Math.max(parseInt(page, 10), 1);
      const safeLimit = Math.min(Math.max(parseInt(limit, 10), 1), 50);
      const offset = (safePage - 1) * safeLimit;

      try {
        const results = await searchService.searchTasks(query.trim(), {
          campusId: campusId || getUserCampusId(request) || undefined,
          category,
          status: status as any,
          sort: sort as any,
          limit: safeLimit,
          offset,
        } as any);

        return reply.send({
          data: results.hits,
          meta: { query: query.trim() || undefined, page: safePage, limit: safeLimit, total: results.total },
        });
      } catch (err) {
        logger.error({ err, query }, 'Task search failed');
        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Search failed' });
      }
    },
  );

  // ── GET /api/v1/search/autocomplete ───────────
  app.get<{ Querystring: AutocompleteQuery }>(
    '/api/v1/search/autocomplete',
    async (request, reply) => {
      const userId = getAuthUserId(request);
      if (!userId) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });

      const { q: prefix, type = 'all', limit = '5' } = request.query;

      if (!prefix || prefix.trim().length < 1) {
        return reply.send({ data: [] });
      }

      const safeLimit = Math.min(Math.max(parseInt(limit, 10), 1), 10);

      try {
        const suggestions = await searchService.autocomplete(prefix.trim(), type as any, safeLimit);
        return reply.send({ data: suggestions });
      } catch (err) {
        logger.error({ err, prefix }, 'Autocomplete failed');
        return reply.send({ data: [] }); // Graceful degradation
      }
    },
  );

  // ── GET /api/v1/search/trending ───────────────
  app.get<{ Querystring: TrendingQuery }>(
    '/api/v1/search/trending',
    async (request, reply) => {
      const userId = getAuthUserId(request);
      if (!userId) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });

      const campusId = request.query.campus_id || getUserCampusId(request);
      const limit = Math.min(Math.max(parseInt(request.query.limit ?? '10', 10), 1), 20);

      try {
        const trending = await searchService.getTrendingSearches(campusId ?? 'global', limit);
        return reply.send({ data: trending });
      } catch (err) {
        logger.error({ err }, 'Trending searches failed');
        return reply.send({ data: [] });
      }
    },
  );

  // ── GET /api/v1/recommendations/feed ──────────
  app.get<{ Querystring: FeedQuery }>(
    '/api/v1/recommendations/feed',
    async (request, reply) => {
      const userId = getAuthUserId(request);
      if (!userId) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });

      const campusId = getUserCampusId(request);
      const page = Math.max(parseInt(request.query.page ?? '1', 10), 1);
      const limit = Math.min(Math.max(parseInt(request.query.limit ?? '20', 10), 1), 50);
      const offset = (page - 1) * limit;

      try {
        const feed = await recommendationEngine.getPersonalizedFeed(
          userId,
          campusId ?? undefined,
          limit,
          offset,
          request.query.category,
        );

        return reply.send({
          data: feed.items,
          meta: {
            page,
            limit,
            total: feed.total,
            hasMore: offset + feed.items.length < feed.total,
            algorithm: feed.algorithm,
          },
        });
      } catch (err) {
        logger.error({ err, userId }, 'Personalized feed failed');
        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Feed generation failed' });
      }
    },
  );

  // ── GET /api/v1/recommendations/similar/:id ───
  app.get<{ Params: SimilarParams; Querystring: { limit?: string } }>(
    '/api/v1/recommendations/similar/:id',
    async (request, reply) => {
      const userId = getAuthUserId(request);
      if (!userId) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });

      const { id: listingId } = request.params;
      const limit = Math.min(Math.max(parseInt(request.query.limit ?? '6', 10), 1), 20);

      try {
        const similar = await recommendationEngine.getSimilarListings(listingId, limit);
        return reply.send({ data: similar });
      } catch (err) {
        logger.error({ err, listingId }, 'Similar listings failed');
        return reply.send({ data: [] });
      }
    },
  );

  // ── GET /api/v1/recommendations/trending ──────
  app.get<{ Querystring: TrendingQuery }>(
    '/api/v1/recommendations/trending',
    async (request, reply) => {
      const userId = getAuthUserId(request);
      if (!userId) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });

      const campusId = request.query.campus_id || getUserCampusId(request);
      const limit = Math.min(Math.max(parseInt(request.query.limit ?? '10', 10), 1), 30);

      try {
        const trending = await recommendationEngine.getCampusTrending(
          campusId ?? 'global',
          undefined,
          limit,
        );
        return reply.send({ data: trending });
      } catch (err) {
        logger.error({ err }, 'Trending recommendations failed');
        return reply.send({ data: [] });
      }
    },
  );

  // ── POST /api/v1/search/reindex ───────────────
  app.post(
    '/api/v1/search/reindex',
    async (request, reply) => {
      if (!isAdmin(request) && !validateInternalSecret(request, internalSecret)) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Admin access required' });
      }

      try {
        // Trigger async reindex
        searchService.triggerFullReindex().catch((err: unknown) => {
          logger.error({ err }, 'Background reindex failed');
        });

        return reply.code(202).send({ data: { status: 'reindex_started', message: 'Full reindex initiated' } });
      } catch (err) {
        logger.error({ err }, 'Failed to start reindex');
        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Failed to start reindex' });
      }
    },
  );

  logger.info('Search routes registered');
}
