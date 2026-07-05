/**
 * Notification Routes — Full Fastify REST API
 *
 * Endpoints:
 *  GET    /api/v1/notifications/me          — Paginated in-app inbox
 *  GET    /api/v1/notifications/me/unread   — Unread count
 *  PATCH  /api/v1/notifications/:id/read    — Mark single as read
 *  POST   /api/v1/notifications/me/read-all — Mark all as read
 *  POST   /api/v1/notifications/tokens      — Register push token
 *  DELETE /api/v1/notifications/tokens/:token — Deregister push token
 *  GET    /api/v1/notifications/stats       — Admin notification stats
 *
 * @module routes/notification.routes
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@nexus/utils';

const logger = createLogger('notification-routes');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface NotificationParams { id: string; }
interface TokenParams { token: string; }

interface InboxQuery {
  page?: string;
  limit?: string;
  type?: string;
  unread_only?: string;
}

interface RegisterTokenBody {
  token: string;
  platform: 'ios' | 'android' | 'web';
  deviceId?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function getAuthUserId(request: FastifyRequest): string | null {
  return (request.headers['x-authenticated-userid'] as string) || null;
}

function getUserRoles(request: FastifyRequest): string[] {
  const roles = request.headers['x-user-roles'] as string;
  return roles ? roles.split(',').map(r => r.trim()) : [];
}

function isAdmin(request: FastifyRequest): boolean {
  return getUserRoles(request).some(r => ['campus_admin', 'super_admin'].includes(r));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Schemas
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const registerTokenSchema = {
  body: {
    type: 'object' as const,
    required: ['token', 'platform'],
    properties: {
      token: { type: 'string', minLength: 10, maxLength: 500 },
      platform: { type: 'string', enum: ['ios', 'android', 'web'] },
      deviceId: { type: 'string', maxLength: 255 },
    },
    additionalProperties: false,
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Route Registration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function registerNotificationRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /api/v1/notifications/me ──────────────
  // Paginated in-app notification inbox
  app.get<{ Querystring: InboxQuery }>(
    '/api/v1/notifications/me',
    async (request, reply) => {
      const userId = getAuthUserId(request);
      if (!userId) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });

      const page = Math.max(parseInt(request.query.page ?? '1', 10), 1);
      const limit = Math.min(Math.max(parseInt(request.query.limit ?? '20', 10), 1), 50);
      const offset = (page - 1) * limit;
      const unreadOnly = request.query.unread_only === 'true';
      const typeFilter = request.query.type;

      try {
        // Build query with optional filters
        let whereClause = 'WHERE user_id = $1';
        const params: any[] = [userId];
        let paramIdx = 2;

        if (unreadOnly) {
          whereClause += ' AND is_read = false';
        }

        if (typeFilter) {
          whereClause += ` AND type = $${paramIdx}`;
          params.push(typeFilter);
          paramIdx++;
        }

        // Get notifications
        const notifications = await app.sql.unsafe(
          `SELECT id, type, title, body, action_url, priority, metadata, is_read, created_at
           FROM in_app_notifications
           ${whereClause}
           ORDER BY created_at DESC
           LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
          [...params, limit, offset],
        );

        // Get total count
        const countRows = await app.sql.unsafe(
          `SELECT COUNT(*) AS total FROM in_app_notifications ${whereClause}`,
          params,
        );

        const total = parseInt(countRows[0]?.total ?? '0', 10);

        // Get unread count
        const unreadRows = await app.sql.unsafe(
          'SELECT COUNT(*) AS unread FROM in_app_notifications WHERE user_id = $1 AND is_read = false',
          [userId],
        );

        const unreadCount = parseInt(unreadRows[0]?.unread ?? '0', 10);

        return reply.send({
          data: notifications.map((n: any) => ({
            id: n.id,
            type: n.type,
            title: n.title,
            body: n.body,
            actionUrl: n.action_url,
            priority: n.priority,
            metadata: typeof n.metadata === 'string' ? JSON.parse(n.metadata) : n.metadata,
            isRead: n.is_read,
            createdAt: n.created_at,
          })),
          meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            hasMore: offset + notifications.length < total,
            unreadCount,
          },
        });
      } catch (err) {
        logger.error({ err, userId }, 'Failed to get notification inbox');
        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Failed to get notifications' });
      }
    },
  );

  // ── GET /api/v1/notifications/me/unread ───────
  app.get(
    '/api/v1/notifications/me/unread',
    async (request, reply) => {
      const userId = getAuthUserId(request);
      if (!userId) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });

      try {
        // Try Redis cache first
        const cached = await app.redis.get(`user:${userId}:unread_count`);
        if (cached !== null) {
          return reply.send({ data: { unreadCount: parseInt(cached, 10) } });
        }

        const rows = await app.sql.unsafe(
          'SELECT COUNT(*) AS c FROM in_app_notifications WHERE user_id = $1 AND is_read = false',
          [userId],
        );

        const count = parseInt(rows[0]?.c ?? '0', 10);

        // Cache for 5 minutes
        await app.redis.set(`user:${userId}:unread_count`, count.toString(), 'EX', 300).catch(() => {});

        return reply.send({ data: { unreadCount: count } });
      } catch (err) {
        logger.error({ err, userId }, 'Failed to get unread count');
        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Failed to get unread count' });
      }
    },
  );

  // ── PATCH /api/v1/notifications/:id/read ──────
  app.patch<{ Params: NotificationParams }>(
    '/api/v1/notifications/:id/read',
    async (request, reply) => {
      const userId = getAuthUserId(request);
      if (!userId) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });

      const { id } = request.params;

      try {
        const result = await app.sql.unsafe(
          `UPDATE in_app_notifications 
           SET is_read = true, read_at = NOW()
           WHERE id = $1 AND user_id = $2 AND is_read = false`,
          [id, userId],
        );

        if ((result.count ?? 0) === 0) {
          return reply.code(404).send({ code: 'NOT_FOUND', message: 'Notification not found or already read' });
        }

        // Decrement unread count
        await app.redis.decr(`user:${userId}:unread_count`).catch(() => {});

        return reply.send({ data: { status: 'read', id } });
      } catch (err) {
        logger.error({ err, userId, notificationId: id }, 'Failed to mark notification as read');
        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Failed to mark as read' });
      }
    },
  );

  // ── POST /api/v1/notifications/me/read-all ────
  app.post(
    '/api/v1/notifications/me/read-all',
    async (request, reply) => {
      const userId = getAuthUserId(request);
      if (!userId) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });

      try {
        const result = await app.sql.unsafe(
          `UPDATE in_app_notifications 
           SET is_read = true, read_at = NOW()
           WHERE user_id = $1 AND is_read = false`,
          [userId],
        );

        const markedCount = result.count ?? 0;

        // Reset unread count
        await app.redis.set(`user:${userId}:unread_count`, '0', 'EX', 300).catch(() => {});

        return reply.send({ data: { status: 'all_read', markedCount } });
      } catch (err) {
        logger.error({ err, userId }, 'Failed to mark all as read');
        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Failed to mark all as read' });
      }
    },
  );

  // ── POST /api/v1/notifications/tokens ─────────
  app.post<{ Body: RegisterTokenBody }>(
    '/api/v1/notifications/tokens',
    { schema: registerTokenSchema },
    async (request, reply) => {
      const userId = getAuthUserId(request);
      if (!userId) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });

      const { token, platform, deviceId } = request.body;

      try {
        // Upsert: insert or update existing token
        await app.sql.unsafe(
          `INSERT INTO push_tokens (user_id, token, platform, device_id, is_active, last_used_at)
           VALUES ($1, $2, $3, $4, true, NOW())
           ON CONFLICT (token) DO UPDATE SET
             user_id = EXCLUDED.user_id,
             platform = EXCLUDED.platform,
             device_id = EXCLUDED.device_id,
             is_active = true,
             last_used_at = NOW(),
             updated_at = NOW()`,
          [userId, token, platform, deviceId ?? null],
        );

        // Invalidate token cache
        await app.redis.del(`push_tokens:${userId}`).catch(() => {});

        logger.info({ userId, platform, tokenSuffix: token.slice(-8) }, 'Push token registered');

        return reply.code(201).send({ data: { status: 'registered', platform } });
      } catch (err) {
        logger.error({ err, userId, platform }, 'Failed to register push token');
        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Failed to register token' });
      }
    },
  );

  // ── DELETE /api/v1/notifications/tokens/:token ──
  app.delete<{ Params: TokenParams }>(
    '/api/v1/notifications/tokens/:token',
    async (request, reply) => {
      const userId = getAuthUserId(request);
      if (!userId) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });

      const { token } = request.params;

      try {
        const result = await app.sql.unsafe(
          'UPDATE push_tokens SET is_active = false, updated_at = NOW() WHERE token = $1 AND user_id = $2',
          [token, userId],
        );

        if ((result.count ?? 0) === 0) {
          return reply.code(404).send({ code: 'NOT_FOUND', message: 'Token not found' });
        }

        await app.redis.del(`push_tokens:${userId}`).catch(() => {});

        return reply.send({ data: { status: 'deregistered' } });
      } catch (err) {
        logger.error({ err, userId }, 'Failed to deregister push token');
        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Failed to deregister token' });
      }
    },
  );

  // ── GET /api/v1/notifications/stats ───────────
  app.get(
    '/api/v1/notifications/stats',
    async (request, reply) => {
      if (!isAdmin(request)) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Admin access required' });
      }

      try {
        // Get notification counts by channel from last 24h
        const channelStats = await app.sql.unsafe(
          `SELECT channel, status, COUNT(*) AS count
           FROM notification_log
           WHERE created_at >= NOW() - INTERVAL '24 hours'
           GROUP BY channel, status
           ORDER BY channel, status`,
        );

        // Get total active push tokens
        const tokenCount = await app.sql.unsafe(
          'SELECT COUNT(*) AS count FROM push_tokens WHERE is_active = true',
        );

        // Get unread notifications distribution
        const unreadStats = await app.sql.unsafe(
          `SELECT 
             COUNT(*) FILTER (WHERE is_read = false) AS unread_total,
             COUNT(*) FILTER (WHERE is_read = true) AS read_total,
             COUNT(*) AS total
           FROM in_app_notifications
           WHERE created_at >= NOW() - INTERVAL '24 hours'`,
        );

        // Top notification types in last 24h
        const topTypes = await app.sql.unsafe(
          `SELECT type, COUNT(*) AS count
           FROM notification_log
           WHERE created_at >= NOW() - INTERVAL '24 hours'
           GROUP BY type
           ORDER BY count DESC
           LIMIT 10`,
        );

        return reply.send({
          data: {
            last24h: {
              byChannel: channelStats.map((r: any) => ({
                channel: r.channel,
                status: r.status,
                count: parseInt(r.count, 10),
              })),
              topTypes: topTypes.map((r: any) => ({
                type: r.type,
                count: parseInt(r.count, 10),
              })),
              inApp: {
                unread: parseInt(unreadStats[0]?.unread_total ?? '0', 10),
                read: parseInt(unreadStats[0]?.read_total ?? '0', 10),
                total: parseInt(unreadStats[0]?.total ?? '0', 10),
              },
            },
            activePushTokens: parseInt(tokenCount[0]?.count ?? '0', 10),
          },
        });
      } catch (err) {
        logger.error({ err }, 'Failed to get notification stats');
        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Failed to get stats' });
      }
    },
  );

  logger.info('Notification routes registered');
}
