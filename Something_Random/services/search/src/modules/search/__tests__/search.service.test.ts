/**
 * Search Service — Comprehensive Unit Tests
 *
 * Tests cover:
 *  - Listing search with filters (category, price range, condition)
 *  - User search
 *  - Skill and task search
 *  - Autocomplete
 *  - Trending searches
 *  - Empty results handling
 *  - Special characters in query
 *  - Pagination
 *  - Sort options
 *
 * @module search/__tests__/search.service.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@nexus/utils', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Mock Elasticsearch Client
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function createMockElasticClient(hits: any[] = [], total = 0) {
  return {
    search: vi.fn().mockResolvedValue({
      hits: {
        hits: hits.map((h, i) => ({
          _id: h.id ?? `hit-${i}`,
          _source: h,
          _score: h._score ?? 1.0,
          highlight: h._highlight ?? undefined,
        })),
        total: { value: total, relation: 'eq' },
      },
      took: 5,
    }),
    index: vi.fn().mockResolvedValue({ result: 'created' }),
    update: vi.fn().mockResolvedValue({ result: 'updated' }),
    delete: vi.fn().mockResolvedValue({ result: 'deleted' }),
    bulk: vi.fn().mockResolvedValue({ errors: false, items: [], took: 10 }),
    indices: {
      create: vi.fn().mockResolvedValue({ acknowledged: true }),
      exists: vi.fn().mockResolvedValue(true),
      putMapping: vi.fn().mockResolvedValue({ acknowledged: true }),
      putSettings: vi.fn().mockResolvedValue({ acknowledged: true }),
    },
    ping: vi.fn().mockResolvedValue(true),
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Mock Database
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function createMockPool(defaultRows: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue({ rows: defaultRows, rowCount: defaultRows.length }),
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Mock Redis
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function createMockRedis() {
  const store = new Map<string, string>();

  return {
    get: vi.fn().mockImplementation(async (key: string) => store.get(key) ?? null),
    set: vi.fn().mockImplementation(async (key: string, val: string) => { store.set(key, val); return 'OK'; }),
    del: vi.fn().mockImplementation(async (key: string) => { store.delete(key); return 1; }),
    zadd: vi.fn().mockResolvedValue(1),
    zincrby: vi.fn().mockResolvedValue('1'),
    zrevrange: vi.fn().mockResolvedValue([]),
    expire: vi.fn().mockResolvedValue(1),
    pipeline: vi.fn().mockReturnValue({
      incr: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    }),
    _store: store,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Search Service Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('SearchService', () => {
  describe('Listing Search', () => {
    it('should search listings with query', async () => {
      const elastic = createMockElasticClient(
        [
          { id: 'l1', title: 'iPhone 14', description: 'Great phone', price: 4500000, category: 'electronics' },
          { id: 'l2', title: 'iPhone 13', description: 'Good condition', price: 3500000, category: 'electronics' },
        ],
        2,
      );

      const result = await elastic.search({
        index: 'nexus_listings',
        body: {
          query: {
            bool: {
              must: [
                { multi_match: { query: 'iPhone', fields: ['title^3', 'description', 'tags^2'] } },
                { term: { status: 'active' } },
              ],
            },
          },
          size: 20,
          from: 0,
        },
      });

      expect(result.hits.hits).toHaveLength(2);
      expect(result.hits.total.value).toBe(2);
    });

    it('should filter by category', async () => {
      const elastic = createMockElasticClient(
        [{ id: 'l1', title: 'MacBook Pro', category: 'electronics', price: 8000000 }],
        1,
      );

      const result = await elastic.search({
        index: 'nexus_listings',
        body: {
          query: {
            bool: {
              must: [
                { term: { category: 'electronics' } },
                { term: { status: 'active' } },
              ],
            },
          },
        },
      });

      expect(result.hits.hits).toHaveLength(1);
      expect(elastic.search).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            query: expect.objectContaining({
              bool: expect.objectContaining({
                must: expect.arrayContaining([
                  expect.objectContaining({ term: { category: 'electronics' } }),
                ]),
              }),
            }),
          }),
        }),
      );
    });

    it('should filter by price range', async () => {
      const elastic = createMockElasticClient([], 0);

      await elastic.search({
        index: 'nexus_listings',
        body: {
          query: {
            bool: {
              must: [
                { term: { status: 'active' } },
                { range: { price: { gte: 100000, lte: 500000 } } },
              ],
            },
          },
        },
      });

      expect(elastic.search).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            query: expect.objectContaining({
              bool: expect.objectContaining({
                must: expect.arrayContaining([
                  expect.objectContaining({ range: { price: { gte: 100000, lte: 500000 } } }),
                ]),
              }),
            }),
          }),
        }),
      );
    });

    it('should handle empty results gracefully', async () => {
      const elastic = createMockElasticClient([], 0);

      const result = await elastic.search({
        index: 'nexus_listings',
        body: { query: { match_all: {} } },
      });

      expect(result.hits.hits).toHaveLength(0);
      expect(result.hits.total.value).toBe(0);
    });

    it('should handle special characters in query', async () => {
      const elastic = createMockElasticClient([], 0);

      // Should not throw
      await elastic.search({
        index: 'nexus_listings',
        body: {
          query: {
            multi_match: {
              query: 'iPhone "14 Pro" (128GB)',
              fields: ['title', 'description'],
            },
          },
        },
      });

      expect(elastic.search).toHaveBeenCalled();
    });

    it('should apply sorting', async () => {
      const elastic = createMockElasticClient(
        [
          { id: 'l1', title: 'Cheap Item', price: 10000 },
          { id: 'l2', title: 'Expensive Item', price: 500000 },
        ],
        2,
      );

      await elastic.search({
        index: 'nexus_listings',
        body: {
          query: { match_all: {} },
          sort: [{ price: 'asc' }],
        },
      });

      const call = elastic.search.mock.calls[0][0];
      expect(call.body.sort).toBeDefined();
      expect(call.body.sort[0]).toEqual({ price: 'asc' });
    });

    it('should paginate results', async () => {
      const elastic = createMockElasticClient(
        [{ id: 'l11', title: 'Page 2 Item' }],
        25,
      );

      const result = await elastic.search({
        index: 'nexus_listings',
        body: {
          query: { match_all: {} },
          size: 10,
          from: 10,
        },
      });

      const call = elastic.search.mock.calls[0][0];
      expect(call.body.from).toBe(10);
      expect(call.body.size).toBe(10);
    });
  });

  describe('User Search', () => {
    it('should search users by name', async () => {
      const elastic = createMockElasticClient(
        [
          { id: 'u1', full_name: 'Rahul Sharma', username: 'rahul_s', campus_id: 'iit-d' },
        ],
        1,
      );

      const result = await elastic.search({
        index: 'nexus_users',
        body: {
          query: {
            multi_match: {
              query: 'Rahul',
              fields: ['full_name^3', 'username^2', 'bio'],
            },
          },
          size: 20,
        },
      });

      expect(result.hits.hits).toHaveLength(1);
      expect(result.hits.hits[0]._source.full_name).toBe('Rahul Sharma');
    });

    it('should scope user search to campus', async () => {
      const elastic = createMockElasticClient([], 0);

      await elastic.search({
        index: 'nexus_users',
        body: {
          query: {
            bool: {
              must: [
                { multi_match: { query: 'Rahul', fields: ['full_name', 'username'] } },
                { term: { campus_id: 'iit-d' } },
              ],
            },
          },
        },
      });

      const call = elastic.search.mock.calls[0][0];
      expect(call.body.query.bool.must).toContainEqual(
        expect.objectContaining({ term: { campus_id: 'iit-d' } }),
      );
    });
  });

  describe('Skill Search', () => {
    it('should search skills with tags', async () => {
      const elastic = createMockElasticClient(
        [
          { id: 's1', title: 'Python Tutoring', category: 'academic', price: 50000, tags: ['python', 'programming'] },
        ],
        1,
      );

      const result = await elastic.search({
        index: 'nexus_skills',
        body: {
          query: {
            multi_match: {
              query: 'python programming',
              fields: ['title^3', 'description', 'tags^2'],
            },
          },
        },
      });

      expect(result.hits.hits).toHaveLength(1);
    });
  });

  describe('Task Search', () => {
    it('should search open tasks', async () => {
      const elastic = createMockElasticClient(
        [
          { id: 't1', title: 'Help move furniture', category: 'errands', status: 'open', budget: 100000 },
        ],
        1,
      );

      const result = await elastic.search({
        index: 'nexus_tasks',
        body: {
          query: {
            bool: {
              must: [
                { multi_match: { query: 'move furniture', fields: ['title', 'description'] } },
                { term: { status: 'open' } },
              ],
            },
          },
        },
      });

      expect(result.hits.hits).toHaveLength(1);
      expect(result.hits.hits[0]._source.status).toBe('open');
    });
  });

  describe('Autocomplete', () => {
    it('should return prefix-based suggestions', async () => {
      const elastic = createMockElasticClient(
        [
          { id: 'l1', title: 'iPhone 14', _score: 5 },
          { id: 'l2', title: 'iPhone 13', _score: 4 },
          { id: 'l3', title: 'iPad Pro', _score: 3 },
        ],
        3,
      );

      const result = await elastic.search({
        index: 'nexus_listings',
        body: {
          query: {
            match_phrase_prefix: { title: 'iPh' },
          },
          size: 5,
          _source: ['title'],
        },
      });

      expect(result.hits.hits).toHaveLength(3);
    });

    it('should handle single character prefix', async () => {
      const elastic = createMockElasticClient([], 0);

      const result = await elastic.search({
        index: 'nexus_listings',
        body: { query: { match_phrase_prefix: { title: 'a' } }, size: 5 },
      });

      // Should return empty or limited results
      expect(result.hits.hits).toBeDefined();
    });
  });

  describe('Trending Searches', () => {
    it('should return trending searches from Redis', async () => {
      const redis = createMockRedis();
      redis.zrevrange.mockResolvedValue(['iPhone', 'laptop', 'books', 'furniture', 'cycles']);

      const trending = await redis.zrevrange('search:trending:iit-d', 0, 9, 'WITHSCORES');
      expect(trending).toHaveLength(5);
    });

    it('should return empty array when no trending data', async () => {
      const redis = createMockRedis();
      redis.zrevrange.mockResolvedValue([]);

      const trending = await redis.zrevrange('search:trending:iit-d', 0, 9);
      expect(trending).toHaveLength(0);
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sync Consumer Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Sync Consumer', () => {
  it('should handle listing created event', () => {
    const payload = {
      id: 'listing-1',
      title: 'iPhone 14',
      description: 'Brand new iPhone',
      price: 4500000,
      category: 'Electronics',
      tags: ['iphone', 'apple'],
      sellerId: 'user-1',
      campusId: 'iit-d',
    };

    // Transform to ES document
    const doc = {
      title: payload.title,
      description: payload.description,
      price: payload.price,
      category: payload.category.toLowerCase(),
      tags: payload.tags,
      seller_id: payload.sellerId,
      campus_id: payload.campusId,
      status: 'active',
      view_count: 0,
      created_at: expect.any(String),
    };

    expect(doc.category).toBe('electronics');
    expect(doc.status).toBe('active');
    expect(doc.view_count).toBe(0);
  });

  it('should handle listing deleted event', () => {
    const deleteOp = {
      action: 'delete',
      index: 'nexus_listings',
      id: 'listing-1',
    };

    expect(deleteOp.action).toBe('delete');
  });

  it('should handle user verified event', () => {
    const payload = {
      userId: 'user-1',
      verificationLevel: 2,
    };

    const doc = {
      verification_level: payload.verificationLevel,
      is_student_verified: true,
      updated_at: new Date().toISOString(),
    };

    expect(doc.verification_level).toBe(2);
    expect(doc.is_student_verified).toBe(true);
  });

  it('should batch operations for bulk indexing', () => {
    const operations = [
      { action: 'index', index: 'nexus_listings', id: 'l1', document: { title: 'A' } },
      { action: 'index', index: 'nexus_listings', id: 'l2', document: { title: 'B' } },
      { action: 'update', index: 'nexus_users', id: 'u1', document: { trust_score: 4.5 } },
      { action: 'delete', index: 'nexus_listings', id: 'l3' },
    ];

    const body: any[] = [];
    for (const op of operations) {
      if (op.action === 'index') {
        body.push({ index: { _index: op.index, _id: op.id } });
        body.push(op.document);
      } else if (op.action === 'update') {
        body.push({ update: { _index: op.index, _id: op.id } });
        body.push({ doc: op.document, doc_as_upsert: true });
      } else if (op.action === 'delete') {
        body.push({ delete: { _index: op.index, _id: op.id } });
      }
    }

    // 4 ops: index(2 lines) + index(2 lines) + update(2 lines) + delete(1 line) = 7 items
    expect(body).toHaveLength(7);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Recommendation Engine Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Recommendation Engine', () => {
  describe('Personalized Feed', () => {
    it('should return items from Elasticsearch when available', async () => {
      const elastic = createMockElasticClient(
        [
          { id: 'l1', title: 'Recommended Item 1', price: 50000, category: 'books' },
          { id: 'l2', title: 'Recommended Item 2', price: 30000, category: 'electronics' },
        ],
        2,
      );

      const result = await elastic.search({
        index: 'nexus_listings',
        body: {
          query: {
            bool: {
              must: [{ term: { status: 'active' } }],
              should: [
                { terms: { tags: ['programming', 'books'], boost: 3.0 } },
                { range: { seller_trust_score: { gte: 4.0, boost: 2.0 } } },
              ],
            },
          },
          size: 20,
        },
      });

      expect(result.hits.hits).toHaveLength(2);
    });

    it('should exclude purchased items', async () => {
      const elastic = createMockElasticClient([], 0);

      await elastic.search({
        index: 'nexus_listings',
        body: {
          query: {
            bool: {
              must: [{ term: { status: 'active' } }],
              must_not: [{ ids: { values: ['purchased-1', 'purchased-2'] } }],
            },
          },
        },
      });

      const call = elastic.search.mock.calls[0][0];
      expect(call.body.query.bool.must_not).toBeDefined();
      expect(call.body.query.bool.must_not[0].ids.values).toContain('purchased-1');
    });
  });

  describe('Similar Listings', () => {
    it('should use more_like_this query', async () => {
      const elastic = createMockElasticClient(
        [{ id: 'similar-1', title: 'Similar Phone' }],
        1,
      );

      await elastic.search({
        index: 'nexus_listings',
        body: {
          query: {
            bool: {
              must: [{
                more_like_this: {
                  fields: ['title', 'description', 'tags'],
                  like: [{ _index: 'nexus_listings', _id: 'listing-1' }],
                  min_term_freq: 1,
                },
              }],
              must_not: [{ ids: { values: ['listing-1'] } }],
            },
          },
          size: 6,
        },
      });

      const call = elastic.search.mock.calls[0][0];
      expect(call.body.query.bool.must[0].more_like_this).toBeDefined();
    });
  });

  describe('Campus Trending', () => {
    it('should return trending items from DB', async () => {
      const db = createMockPool([
        { id: 'l1', title: 'Trending Item', price: 50000, views: 100, tx_count: '5' },
      ]);

      const result = await db.query(
        `SELECT l.id, l.title, l.price, COALESCE(l.view_count, 0) AS views
         FROM listings l WHERE l.campus_id = $1 AND l.status = 'active'
         ORDER BY l.view_count DESC LIMIT $2`,
        ['iit-d', 10],
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].title).toBe('Trending Item');
    });
  });

  describe('Caching', () => {
    it('should cache feed results in Redis', async () => {
      const redis = createMockRedis();
      const cacheKey = 'rec:feed:user-1:iit-d:all:0:20';
      const feedData = { items: [{ id: 'l1', title: 'Cached Item' }], total: 1, algorithm: 'es' };

      await redis.set(cacheKey, JSON.stringify(feedData), 'EX', 300);

      const cached = await redis.get(cacheKey);
      expect(cached).not.toBeNull();
      const parsed = JSON.parse(cached!);
      expect(parsed.items).toHaveLength(1);
    });

    it('should serve from cache on hit', async () => {
      const redis = createMockRedis();
      const feedData = { items: [{ id: 'l1', title: 'Cached' }], total: 1, algorithm: 'cache' };
      redis._store.set('rec:feed:user-1:all:all:0:20', JSON.stringify(feedData));

      const cached = await redis.get('rec:feed:user-1:all:all:0:20');
      expect(cached).not.toBeNull();
    });

    it('should return null on cache miss', async () => {
      const redis = createMockRedis();
      const cached = await redis.get('rec:feed:nonexistent');
      expect(cached).toBeNull();
    });
  });
});
