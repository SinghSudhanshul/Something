/**
 * Search Service Type Definitions
 *
 * @module types/index
 */

import type { SearchService } from '../modules/search/search.service.js';
import type { RecommendationEngine } from '../modules/search/recommendation.engine.js';

declare module 'fastify' {
  interface FastifyInstance {
    searchService: SearchService;
    recommendationEngine: RecommendationEngine;
    elastic: import('@elastic/elasticsearch').Client | null;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Search Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Supported content types for search */
export type SearchContentType = 'listing' | 'user' | 'skill' | 'task' | 'all';

/** Supported sort options */
export type SearchSortOption =
  | 'relevance'
  | 'price_asc'
  | 'price_desc'
  | 'newest'
  | 'oldest'
  | 'trust_score'
  | 'rating'
  | 'popularity';

/** Listing condition */
export type ListingCondition = 'new' | 'like_new' | 'good' | 'fair' | 'for_parts';

/** Listing status */
export type ListingStatus = 'active' | 'sold' | 'expired' | 'draft' | 'deleted';

/** Task status */
export type TaskStatus = 'open' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Search Filter Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ListingSearchFilters {
  campusId?: string;
  category?: string;
  priceMin?: number;
  priceMax?: number;
  condition?: ListingCondition;
  status?: ListingStatus;
  sort?: SearchSortOption;
  limit?: number;
  offset?: number;
}

export interface UserSearchFilters {
  campusId?: string;
  limit?: number;
  offset?: number;
}

export interface SkillSearchFilters {
  campusId?: string;
  category?: string;
  sort?: SearchSortOption;
  limit?: number;
  offset?: number;
}

export interface TaskSearchFilters {
  campusId?: string;
  category?: string;
  status?: TaskStatus;
  sort?: SearchSortOption;
  limit?: number;
  offset?: number;
}

export interface UnifiedSearchFilters {
  campusId?: string;
  contentType?: SearchContentType;
  sort?: SearchSortOption;
  limit?: number;
  offset?: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Search Result Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface SearchHit {
  id: string;
  type: SearchContentType;
  title: string;
  description?: string;
  highlight?: Record<string, string[]>;
  score: number;
  [key: string]: unknown;
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
  tookMs: number;
  facets?: SearchFacets;
}

export interface SearchFacets {
  categories?: Array<{ key: string; count: number }>;
  priceRanges?: Array<{ key: string; from: number; to: number; count: number }>;
  conditions?: Array<{ key: string; count: number }>;
}

export interface AutocompleteSuggestion {
  text: string;
  type: SearchContentType;
  score: number;
  id?: string;
}

export interface TrendingSearch {
  query: string;
  count: number;
  rank: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ApiResponse<T> {
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
    hasMore?: boolean;
    query?: string;
    tookMs?: number;
  };
  facets?: SearchFacets;
}
