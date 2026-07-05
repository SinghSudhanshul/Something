/**
 * Trust Score Routes — Full Fastify route handlers for trust management
 *
 * Routes:
 *  POST /api/v1/trust/events         — Record a trust event (internal only)
 *  GET  /api/v1/trust/leaderboard/:campusId — Campus leaderboard
 *  GET  /api/v1/trust/users/:userId/score   — Get user score + tier
 *  GET  /api/v1/trust/users/:userId/history — Trust event history
 *  POST /api/v1/trust/score/transaction     — Score transaction for fraud
 *  GET  /api/v1/trust/fraud/flags           — Active fraud flags (admin)
 *  POST /api/v1/trust/fraud/flags/:id/resolve — Resolve a fraud flag (admin)
 *  POST /api/v1/trust/recompute/:userId     — Force recompute (admin)
 *  POST /api/v1/trust/nightly-recompute     — Trigger nightly recompute (admin)
 *  GET  /api/v1/trust/stats                 — Trust stats dashboard (admin)
 *
 * @module score/score.routes
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@nexus/utils';
import type { ScoreService } from './score.service.js';
import type { FraudService } from '../fraud/fraud.service.js';
import { config } from '../../config.js';

const logger = createLogger('trust-routes');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Request Schema Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface RecordEventBody {
  userId: string;
  eventType: string;
  referenceId: string;
  referenceType: string;
  metadata?: Record<string, unknown>;
}

interface ScoreTransactionBody {
  userId: string;
  transactionId: string;
  amount: number;
  recipientId: string;
  module: string;
  userTrustScore?: number;
  userAge?: number;
  transactionsLast24h?: number;
  transactionsLast7d?: number;
  uniqueRecipientsLast7d?: number;
  isNewRecipient?: boolean;
}

interface LeaderboardParams {
  campusId: string;
}

interface UserParams {
  userId: string;
}

interface FlagParams {
  id: string;
}

interface LeaderboardQuery {
  limit?: string;
}

interface HistoryQuery {
  limit?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// JSON Schema Definitions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const recordEventSchema = {
  body: {
    type: 'object' as const,
    required: ['userId', 'eventType', 'referenceId', 'referenceType'],
    properties: {
      userId: { type: 'string', format: 'uuid' },
      eventType: { type: 'string', minLength: 1, maxLength: 100 },
      referenceId: { type: 'string', minLength: 1, maxLength: 255 },
      referenceType: { type: 'string', minLength: 1, maxLength: 50 },
      metadata: { type: 'object', additionalProperties: true },
    },
    additionalProperties: false,
  },
};

const scoreTransactionSchema = {
  body: {
    type: 'object' as const,
    required: ['userId', 'transactionId', 'amount', 'recipientId', 'module'],
    properties: {
      userId: { type: 'string', format: 'uuid' },
      transactionId: { type: 'string', format: 'uuid' },
      amount: { type: 'number', minimum: 0 },
      recipientId: { type: 'string', format: 'uuid' },
      module: { type: 'string', enum: ['bazaar', 'wallet', 'skills', 'rides', 'food'] },
      userTrustScore: { type: 'number', minimum: 0, maximum: 5 },
      userAge: { type: 'number', minimum: 0 },
      transactionsLast24h: { type: 'number', minimum: 0 },
      transactionsLast7d: { type: 'number', minimum: 0 },
      uniqueRecipientsLast7d: { type: 'number', minimum: 0 },
      isNewRecipient: { type: 'boolean' },
    },
    additionalProperties: false,
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Middleware Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Extract user info from Kong-injected headers */
function getAuthUser(request: FastifyRequest): { id: string; campusId?: string; roles?: string[] } | null {
  const userId = request.headers['x-authenticated-userid'] as string;
  if (!userId) return null;

  const campusId = request.headers['x-user-campus-id'] as string;
  const rolesHeader = request.headers['x-user-roles'] as string;
  const roles = rolesHeader ? rolesHeader.split(',').map((r) => r.trim()) : [];

  return { id: userId, campusId, roles };
}

/** Check if user has one of the required roles */
function hasRole(user: { roles?: string[] }, ...requiredRoles: string[]): boolean {
  if (!user.roles) return false;
  return user.roles.some((r) => requiredRoles.includes(r));
}

/** Validate internal service secret */
function validateInternalSecret(request: FastifyRequest): boolean {
  const secret = request.headers['x-internal-secret'] as string;
  return secret === config.INTERNAL_SERVICE_SECRET;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Route Registration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function registerScoreRoutes(
  app: FastifyInstance,
  scoreService: ScoreService,
  fraudService: FraudService,
): Promise<void> {
  // ── POST /api/v1/trust/events ───────────────
  // Internal only: records a trust event for a user
  app.post<{ Body: RecordEventBody }>(
    '/api/v1/trust/events',
    { schema: recordEventSchema },
    async (request, reply) => {
      if (!validateInternalSecret(request)) {
        return reply.code(401).send({
          code: 'UNAUTHORIZED',
          message: 'Invalid internal service secret',
        });
      }

      const { userId, eventType, referenceId, referenceType, metadata } = request.body;

      try {
        const result = await scoreService.recordEvent({
          userId,
          eventType: eventType as any,
          referenceId,
          referenceType,
          ...(metadata !== undefined && { metadata }),
        });

        logger.info(
          { userId, eventType, score: result.score, tier: result.tier, tierUpgraded: result.tierUpgraded },
          'Trust event recorded via API',
        );

        return reply.code(201).send({
          data: {
            score: result.score,
            tier: result.tier,
            delta: result.delta,
            tierUpgraded: result.tierUpgraded,
          },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        logger.error({ err, userId, eventType }, 'Failed to record trust event');

        if (message.includes('Invalid eventType') || message.includes('No delta configured')) {
          return reply.code(400).send({ code: 'BAD_REQUEST', message });
        }

        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Failed to record event' });
      }
    },
  );

  // ── GET /api/v1/trust/leaderboard/:campusId ──
  app.get<{ Params: LeaderboardParams; Querystring: LeaderboardQuery }>(
    '/api/v1/trust/leaderboard/:campusId',
    async (request, reply) => {
      const user = getAuthUser(request);
      if (!user) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });
      }

      const { campusId } = request.params;
      const limit = Math.min(parseInt(request.query.limit ?? '10', 10) || 10, 100);

      // UUID format validation
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(campusId)) {
        return reply.code(400).send({ code: 'BAD_REQUEST', message: 'Invalid campusId format' });
      }

      try {
        const leaderboard = await scoreService.getLeaderboard(campusId, limit);
        return reply.send({ data: leaderboard, count: leaderboard.length });
      } catch (err: unknown) {
        logger.error({ err, campusId }, 'Failed to get leaderboard');
        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Failed to get leaderboard' });
      }
    },
  );

  // ── GET /api/v1/trust/users/:userId/score ─────
  app.get<{ Params: UserParams }>(
    '/api/v1/trust/users/:userId/score',
    async (request, reply) => {
      const user = getAuthUser(request);
      if (!user) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });
      }

      const { userId } = request.params;

      try {
        const scoreInfo = await scoreService.getScore(userId);
        return reply.send({ data: scoreInfo });
      } catch (err: unknown) {
        logger.error({ err, userId }, 'Failed to get trust score');
        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Failed to get score' });
      }
    },
  );

  // ── GET /api/v1/trust/users/:userId/history ───
  app.get<{ Params: UserParams; Querystring: HistoryQuery }>(
    '/api/v1/trust/users/:userId/history',
    async (request, reply) => {
      const user = getAuthUser(request);
      if (!user) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });
      }

      const { userId } = request.params;

      // Only own history or admin
      if (userId !== user.id && !hasRole(user, 'campus_admin', 'super_admin')) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Can only view own trust history' });
      }

      const limit = Math.min(parseInt(request.query.limit ?? '50', 10) || 50, 200);

      try {
        const history = await scoreService.getHistory(userId, limit);
        return reply.send({ data: history, count: history.length });
      } catch (err: unknown) {
        logger.error({ err, userId }, 'Failed to get trust history');
        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Failed to get history' });
      }
    },
  );

  // ── POST /api/v1/trust/score/transaction ──────
  // Internal: score a transaction for fraud
  app.post<{ Body: ScoreTransactionBody }>(
    '/api/v1/trust/score/transaction',
    { schema: scoreTransactionSchema },
    async (request, reply) => {
      if (!validateInternalSecret(request)) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Invalid internal service secret' });
      }

      const body = request.body;

      try {
        const result = await fraudService.scoreTransaction({
          userId: body.userId,
          transactionId: body.transactionId,
          amount: body.amount,
          recipientId: body.recipientId,
          module: body.module,
          userTrustScore: body.userTrustScore ?? 3.0,
          userAge: body.userAge ?? 30,
          transactionsLast24h: body.transactionsLast24h ?? 0,
          transactionsLast7d: body.transactionsLast7d ?? 0,
          uniqueRecipientsLast7d: body.uniqueRecipientsLast7d ?? 0,
          isNewRecipient: body.isNewRecipient ?? false,
          hourOfDay: new Date().getHours(),
        });

        return reply.send({ data: result });
      } catch (err: unknown) {
        logger.error({ err, userId: body.userId }, 'Fraud scoring failed');
        // FAIL OPEN
        return reply.send({
          data: {
            score: 0,
            action: 'allow',
            modelAvailable: false,
            features: { failOpen: true },
            scoringId: `fallback_${Date.now()}`,
            latencyMs: 0,
          },
        });
      }
    },
  );

  // ── GET /api/v1/trust/fraud/flags ─────────────
  // Admin: view active fraud flags
  app.get(
    '/api/v1/trust/fraud/flags',
    async (request, reply) => {
      const user = getAuthUser(request);
      if (!user || !hasRole(user, 'campus_admin', 'super_admin')) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Admin access required' });
      }

      try {
        const flags = await fraudService.getAllActiveFlags(50, 0);
        return reply.send({ data: flags, count: flags.length });
      } catch (err: unknown) {
        logger.error({ err }, 'Failed to get fraud flags');
        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Failed to get flags' });
      }
    },
  );

  // ── POST /api/v1/trust/fraud/flags/:id/resolve ──
  app.post<{ Params: FlagParams }>(
    '/api/v1/trust/fraud/flags/:id/resolve',
    async (request, reply) => {
      const user = getAuthUser(request);
      if (!user || !hasRole(user, 'campus_admin', 'super_admin')) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Admin access required' });
      }

      const { id } = request.params;

      try {
        const resolved = await fraudService.resolveFlag(id, user.id);
        if (!resolved) {
          return reply.code(404).send({ code: 'NOT_FOUND', message: 'Flag not found or already resolved' });
        }
        return reply.send({ data: { status: 'resolved' } });
      } catch (err: unknown) {
        logger.error({ err, flagId: id }, 'Failed to resolve fraud flag');
        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Failed to resolve flag' });
      }
    },
  );

  // ── POST /api/v1/trust/recompute/:userId ──────
  // Admin: force full recompute for a user
  app.post<{ Params: UserParams }>(
    '/api/v1/trust/recompute/:userId',
    async (request, reply) => {
      const user = getAuthUser(request);
      if (!user || !hasRole(user, 'super_admin')) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Super admin access required' });
      }

      const { userId } = request.params;

      try {
        const newScore = await scoreService.fullRecompute(userId);
        return reply.send({ data: { userId, newScore, recomputedAt: new Date().toISOString() } });
      } catch (err: unknown) {
        logger.error({ err, userId }, 'Failed to recompute trust score');
        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Recompute failed' });
      }
    },
  );

  // ── POST /api/v1/trust/nightly-recompute ──────
  // Admin: trigger nightly recompute manually
  app.post(
    '/api/v1/trust/nightly-recompute',
    async (request, reply) => {
      const user = getAuthUser(request);
      if (!user || !hasRole(user, 'super_admin')) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Super admin access required' });
      }

      try {
        // Non-blocking: start the recompute and return immediately
        const resultPromise = scoreService.nightlyRecompute();
        resultPromise
          .then((result) => {
            logger.info({ result }, 'Manual nightly recompute completed');
          })
          .catch((err: unknown) => {
            logger.error({ err }, 'Manual nightly recompute failed');
          });

        return reply.code(202).send({
          data: { status: 'started', message: 'Nightly recompute initiated' },
        });
      } catch (err: unknown) {
        logger.error({ err }, 'Failed to start nightly recompute');
        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Failed to start recompute' });
      }
    },
  );

  // ── GET /api/v1/trust/stats ───────────────────
  // Admin: trust system stats dashboard
  app.get(
    '/api/v1/trust/stats',
    async (request, reply) => {
      const user = getAuthUser(request);
      if (!user || !hasRole(user, 'campus_admin', 'super_admin')) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Admin access required' });
      }

      try {
        const modelHealth = await fraudService.checkModelHealth();
        return reply.send({
          data: {
            fraudModel: {
              available: fraudService.isModelAvailable,
              healthCheck: modelHealth,
              failureCount: fraudService.modelFailureCount,
            },
            system: {
              uptime: process.uptime(),
              memoryUsage: process.memoryUsage(),
            },
          },
        });
      } catch (err: unknown) {
        logger.error({ err }, 'Failed to get trust stats');
        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Failed to get stats' });
      }
    },
  );

  logger.info('Trust score routes registered');
}
