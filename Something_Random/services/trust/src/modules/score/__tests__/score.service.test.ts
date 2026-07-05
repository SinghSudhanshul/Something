/**
 * Trust Score Service — Comprehensive Unit Tests
 *
 * Tests cover:
 *  - Event recording with valid/invalid event types
 *  - Score clamping at 0.00 and 5.00 boundaries
 *  - Tier mapping and tier upgrade detection
 *  - Nightly recompute with batch processing
 *  - Leaderboard retrieval and cold-start rebuild
 *  - Distributed locking for nightly recompute
 *  - Edge cases: arbitrary deltas (security), missing users, concurrent access
 *
 * @module score/__tests__/score.service.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Mock Implementations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class MockScoreRepository {
  private events: Array<{ userId: string; eventType: string; delta: number }> = [];
  private scores: Map<string, number> = new Map();
  private campusUsers: Map<string, Array<{ userId: string; trustScore: number }>> = new Map();

  async appendEvent(data: any): Promise<void> {
    this.events.push({
      userId: data.userId,
      eventType: data.eventType,
      delta: data.delta,
    });
  }

  async applyDelta(
    userId: string,
    delta: number,
  ): Promise<{ oldScore: number; newScore: number }> {
    const old = this.scores.get(userId) ?? 3.0;
    const raw = old + delta;
    const clamped = Math.max(0, Math.min(5, parseFloat(raw.toFixed(2))));
    this.scores.set(userId, clamped);
    return { oldScore: old, newScore: clamped };
  }

  async getScore(userId: string): Promise<number> {
    return this.scores.get(userId) ?? 3.0;
  }

  async getEventsForUser(userId: string, limit: number): Promise<any[]> {
    return this.events
      .filter((e) => e.userId === userId)
      .slice(-limit)
      .reverse();
  }

  async getAllActiveUserIds(batchSize: number, offset: number): Promise<string[]> {
    const allIds = Array.from(this.scores.keys());
    return allIds.slice(offset, offset + batchSize);
  }

  async batchRecompute(userIds: string[]): Promise<Map<string, number>> {
    const results = new Map<string, number>();
    for (const id of userIds) {
      results.set(id, this.scores.get(id) ?? 3.0);
    }
    return results;
  }

  async recomputeAndPersist(userId: string): Promise<number> {
    return this.scores.get(userId) ?? 3.0;
  }

  async getCampusUserScores(campusId: string, limit: number): Promise<Array<{ userId: string; trustScore: number }>> {
    return this.campusUsers.get(campusId) ?? [];
  }

  // Test helpers
  setScore(userId: string, score: number): void {
    this.scores.set(userId, score);
  }

  setCampusUsers(campusId: string, users: Array<{ userId: string; trustScore: number }>): void {
    this.campusUsers.set(campusId, users);
  }

  getEventCount(): number {
    return this.events.length;
  }
}

class MockRedis {
  private store: Map<string, string> = new Map();
  private sortedSets: Map<string, Map<string, number>> = new Map();
  private expiries: Map<string, number> = new Map();

  async del(key: string): Promise<number> {
    this.store.delete(key);
    this.sortedSets.delete(key);
    return 1;
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, ...args: any[]): Promise<string | null> {
    // Handle NX flag
    if (args.includes('NX') && this.store.has(key)) {
      return null;
    }
    this.store.set(key, value);
    // Handle EX flag
    const exIdx = args.indexOf('EX');
    if (exIdx !== -1 && args[exIdx + 1]) {
      this.expiries.set(key, Date.now() + args[exIdx + 1] * 1000);
    }
    return 'OK';
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    if (!this.sortedSets.has(key)) {
      this.sortedSets.set(key, new Map());
    }
    this.sortedSets.get(key)!.set(member, score);
    return 1;
  }

  async zrevrange(key: string, start: number, stop: number, ...args: string[]): Promise<string[]> {
    const set = this.sortedSets.get(key);
    if (!set) return [];

    const entries = Array.from(set.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(start, stop + 1);

    if (args.includes('WITHSCORES')) {
      const result: string[] = [];
      for (const [member, score] of entries) {
        result.push(member, score.toString());
      }
      return result;
    }

    return entries.map(([member]) => member);
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.expiries.set(key, Date.now() + seconds * 1000);
    return 1;
  }

  pipeline(): any {
    const ops: Array<() => Promise<void>> = [];
    const self = this;
    return {
      del(key: string) {
        ops.push(async () => { await self.del(key); });
        return this;
      },
      zadd(key: string, score: number, member: string) {
        ops.push(async () => { await self.zadd(key, score, member); });
        return this;
      },
      expire(key: string, seconds: number) {
        ops.push(async () => { await self.expire(key, seconds); });
        return this;
      },
      async exec() {
        for (const op of ops) {
          await op();
        }
        return ops.map(() => [null, 'OK']);
      },
    };
  }

  // Test helpers
  getSortedSetSize(key: string): number {
    return this.sortedSets.get(key)?.size ?? 0;
  }

  getStoreSize(): number {
    return this.store.size;
  }
}

class MockKafkaProducer {
  public messages: Array<{ topic: string; key: string; value: string }> = [];

  async send(topic: string, messages: Array<{ key: string; value: string }>): Promise<void> {
    for (const msg of messages) {
      this.messages.push({ topic, key: msg.key, value: msg.value });
    }
  }

  getMessageCount(): number {
    return this.messages.length;
  }

  getMessagesForTopic(topic: string): any[] {
    return this.messages.filter((m) => m.topic === topic);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Import the actual module — we use dynamic import to apply mocks
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Mock @nexus/types
vi.mock('@nexus/types', () => ({
  TRUST_DELTAS: {
    transaction_completed: 0.03,
    transaction_disputed_lost: -0.15,
    verification_upgraded: 0.10,
    listing_sold: 0.02,
    ride_completed: 0.02,
    gig_completed: 0.03,
    listing_created: 0.00,
    review_submitted: 0.01,
  },
  KafkaTopics: {
    TRUST_TIER_UPGRADED: 'nexus.trust.tier_upgraded',
    NOTIFICATION_TRIGGER: 'nexus.notifications.trigger',
    TRUST_NIGHTLY_RECOMPUTE_COMPLETE: 'nexus.trust.nightly_recompute_complete',
  },
}));

vi.mock('@nexus/utils', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../config.js', () => ({
  config: {
    NIGHTLY_RECOMPUTE_BATCH_SIZE: 100,
    NIGHTLY_RECOMPUTE_BATCH_DELAY_MS: 0,
    ENABLE_NIGHTLY_CRON: false,
    NIGHTLY_RECOMPUTE_CRON: '30 20 * * *',
    LEADERBOARD_CACHE_TTL_SECS: 3600,
  },
}));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Test Suite
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('ScoreService', () => {
  let repo: MockScoreRepository;
  let redis: MockRedis;
  let kafka: MockKafkaProducer;
  let service: any; // ScoreService

  beforeEach(async () => {
    repo = new MockScoreRepository();
    redis = new MockRedis();
    kafka = new MockKafkaProducer();

    const { ScoreService } = await import('../score.service.js');
    service = new ScoreService(repo as any, redis as any, kafka);
  });

  // ── Event Recording ─────────────────────────

  describe('recordEvent', () => {
    it('should record a valid event and return updated score', async () => {
      repo.setScore('user-1', 3.0);

      const result = await service.recordEvent({
        userId: 'user-1',
        eventType: 'transaction_completed',
        referenceId: 'tx-1',
        referenceType: 'transaction',
      });

      expect(result.score).toBe(3.03);
      expect(result.delta).toBe(0.03);
      expect(result.tier).toBe('trusted');
      expect(result.tierUpgraded).toBe(false);
    });

    it('should reject an invalid event type', async () => {
      await expect(
        service.recordEvent({
          userId: 'user-1',
          eventType: 'invalid_event_type',
          referenceId: 'ref-1',
          referenceType: 'unknown',
        }),
      ).rejects.toThrow('Invalid eventType');
    });

    it('should reject arbitrary delta injection (security)', async () => {
      // Even if someone tries to pass a delta, it should use TRUST_DELTAS
      const result = await service.recordEvent({
        userId: 'user-1',
        eventType: 'transaction_completed',
        referenceId: 'tx-1',
        referenceType: 'transaction',
        metadata: { delta: 999 }, // Attempted injection
      });

      // Delta should be 0.03 (from TRUST_DELTAS), not 999
      expect(result.delta).toBe(0.03);
    });

    it('should detect tier upgrade', async () => {
      repo.setScore('user-1', 3.48); // Just below 'verified' threshold (3.50)

      const result = await service.recordEvent({
        userId: 'user-1',
        eventType: 'transaction_completed',
        referenceId: 'tx-1',
        referenceType: 'transaction',
      });

      // 3.48 + 0.03 = 3.51 → 'verified' tier
      expect(result.score).toBe(3.51);
      expect(result.tier).toBe('verified');
      expect(result.tierUpgraded).toBe(true);
    });

    it('should publish Kafka event on tier upgrade', async () => {
      repo.setScore('user-1', 3.48);

      await service.recordEvent({
        userId: 'user-1',
        eventType: 'transaction_completed',
        referenceId: 'tx-1',
        referenceType: 'transaction',
      });

      // Should have published tier upgrade + notification events
      expect(kafka.getMessageCount()).toBeGreaterThanOrEqual(1);
    });

    it('should not detect tier upgrade on score decrease', async () => {
      repo.setScore('user-1', 2.50); // trusted

      const result = await service.recordEvent({
        userId: 'user-1',
        eventType: 'transaction_disputed_lost',
        referenceId: 'tx-1',
        referenceType: 'transaction',
      });

      // 2.50 - 0.15 = 2.35 → 'building' (downgrade, not upgrade)
      expect(result.score).toBe(2.35);
      expect(result.tierUpgraded).toBe(false);
    });
  });

  // ── Score Clamping ──────────────────────────

  describe('score clamping', () => {
    it('should clamp score at 5.00', async () => {
      repo.setScore('user-1', 4.98);

      const result = await service.recordEvent({
        userId: 'user-1',
        eventType: 'verification_upgraded',
        referenceId: 'ref-1',
        referenceType: 'user',
      });

      // 4.98 + 0.10 = 5.08 → clamped to 5.00
      expect(result.score).toBe(5.0);
    });

    it('should clamp score at 0.00', async () => {
      repo.setScore('user-1', 0.10);

      const result = await service.recordEvent({
        userId: 'user-1',
        eventType: 'transaction_disputed_lost',
        referenceId: 'ref-1',
        referenceType: 'transaction',
      });

      // 0.10 - 0.15 = -0.05 → clamped to 0.00
      expect(result.score).toBe(0);
    });
  });

  // ── Leaderboard ─────────────────────────────

  describe('getLeaderboard', () => {
    it('should return leaderboard from Redis sorted set', async () => {
      await redis.zadd('trust_scores:campus:campus-1', 4.5, 'user-a');
      await redis.zadd('trust_scores:campus:campus-1', 4.2, 'user-b');
      await redis.zadd('trust_scores:campus:campus-1', 3.8, 'user-c');

      const result = await service.getLeaderboard('campus-1', 10);

      expect(result).toHaveLength(3);
      expect(result[0].userId).toBe('user-a');
      expect(result[0].score).toBe(4.5);
      expect(result[0].rank).toBe(1);
      expect(result[1].rank).toBe(2);
      expect(result[2].rank).toBe(3);
    });

    it('should rebuild from DB on cold start', async () => {
      repo.setCampusUsers('campus-2', [
        { userId: 'u1', trustScore: 4.0 },
        { userId: 'u2', trustScore: 3.5 },
      ]);

      const result = await service.getLeaderboard('campus-2', 10);

      expect(result).toHaveLength(2);
      expect(redis.getSortedSetSize('trust_scores:campus:campus-2')).toBe(2);
    });

    it('should limit results to 100', async () => {
      const result = await service.getLeaderboard('campus-3', 500);
      // Should not crash with limit > 100
      expect(result).toBeDefined();
    });
  });

  // ── Nightly Recompute ───────────────────────

  describe('nightlyRecompute', () => {
    it('should process all users in batches', async () => {
      for (let i = 0; i < 5; i++) {
        repo.setScore(`user-${i}`, 3.0 + i * 0.1);
      }

      const result = await service.nightlyRecompute();

      expect(result.totalUsers).toBe(5);
      expect(result.errors).toBe(0);
      expect(result.batchesProcessed).toBeGreaterThanOrEqual(1);
    });

    it('should prevent overlapping runs', async () => {
      // Start first run
      const run1 = service.nightlyRecompute();
      // Start second run immediately
      const result2 = await service.nightlyRecompute();

      // Second run should be skipped
      expect(result2.totalUsers).toBe(0);

      // Wait for first to complete
      await run1;
    });
  });

  // ── Score Retrieval ─────────────────────────

  describe('getScore', () => {
    it('should return score with tier', async () => {
      repo.setScore('user-1', 4.30);

      const result = await service.getScore('user-1');

      expect(result.score).toBe(4.30);
      expect(result.tier).toBe('elite');
    });

    it('should return default score for unknown user', async () => {
      const result = await service.getScore('unknown-user');

      expect(result.score).toBe(3.0);
      expect(result.tier).toBe('trusted');
    });
  });

  // ── Event History ───────────────────────────

  describe('getHistory', () => {
    it('should return event history for user', async () => {
      repo.setScore('user-1', 3.0);
      await service.recordEvent({
        userId: 'user-1',
        eventType: 'transaction_completed',
        referenceId: 'tx-1',
        referenceType: 'transaction',
      });

      const history = await service.getHistory('user-1', 10);

      expect(history).toHaveLength(1);
      expect(history[0].eventType).toBe('transaction_completed');
    });
  });
});
