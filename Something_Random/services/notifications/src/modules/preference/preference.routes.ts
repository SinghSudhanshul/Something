/**
 * Notification Preferences Routes
 *
 * @module preference/preference.routes
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@nexus/utils';

const logger = createLogger('preference-routes');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface UpdatePreferencesBody {
  push_enabled?: boolean;
  email_enabled?: boolean;
  sms_enabled?: boolean;
  in_app_enabled?: boolean;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  quiet_hours_timezone?: string;
  module_preferences?: Record<string, boolean>;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function getAuthUserId(request: FastifyRequest): string | null {
  return (request.headers['x-authenticated-userid'] as string) || null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Schemas
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const updateSchema = {
  body: {
    type: 'object' as const,
    properties: {
      push_enabled: { type: 'boolean' },
      email_enabled: { type: 'boolean' },
      sms_enabled: { type: 'boolean' },
      in_app_enabled: { type: 'boolean' },
      quiet_hours_start: { type: ['string', 'null'], pattern: '^\\d{2}:\\d{2}$' },
      quiet_hours_end: { type: ['string', 'null'], pattern: '^\\d{2}:\\d{2}$' },
      quiet_hours_timezone: { type: 'string', maxLength: 50 },
      module_preferences: { type: 'object', additionalProperties: { type: 'boolean' } },
    },
    additionalProperties: false,
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Route Registration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function registerPreferenceRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /api/v1/notifications/preferences ─────
  app.get(
    '/api/v1/notifications/preferences',
    async (request, reply) => {
      const userId = getAuthUserId(request);
      if (!userId) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });

      try {
        // Check Redis cache
        const cached = await app.redis.get(`notification_prefs:${userId}`);
        if (cached) {
          return reply.send({ data: JSON.parse(cached) });
        }

        const rows = await app.sql.unsafe(
          `SELECT push_enabled, email_enabled, sms_enabled, in_app_enabled,
                  quiet_hours_start, quiet_hours_end, quiet_hours_timezone,
                  module_preferences, updated_at
           FROM notification_preferences WHERE user_id = $1`,
          [userId],
        );

        if (rows.length === 0) {
          // Return defaults
          const defaults = {
            push_enabled: true,
            email_enabled: true,
            sms_enabled: false,
            in_app_enabled: true,
            quiet_hours_start: null,
            quiet_hours_end: null,
            quiet_hours_timezone: 'Asia/Kolkata',
            module_preferences: {},
          };
          return reply.send({ data: defaults });
        }

        const row = rows[0] as any;
        const prefs = {
          push_enabled: row.push_enabled,
          email_enabled: row.email_enabled,
          sms_enabled: row.sms_enabled,
          in_app_enabled: row.in_app_enabled,
          quiet_hours_start: row.quiet_hours_start,
          quiet_hours_end: row.quiet_hours_end,
          quiet_hours_timezone: row.quiet_hours_timezone ?? 'Asia/Kolkata',
          module_preferences: typeof row.module_preferences === 'string'
            ? JSON.parse(row.module_preferences)
            : row.module_preferences ?? {},
          updated_at: row.updated_at,
        };

        // Cache for 5 minutes
        await app.redis.set(`notification_prefs:${userId}`, JSON.stringify(prefs), 'EX', 300).catch(() => {});

        return reply.send({ data: prefs });
      } catch (err) {
        logger.error({ err, userId }, 'Failed to get notification preferences');
        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Failed to get preferences' });
      }
    },
  );

  // ── PATCH /api/v1/notifications/preferences ───
  app.patch<{ Body: UpdatePreferencesBody }>(
    '/api/v1/notifications/preferences',
    { schema: updateSchema },
    async (request, reply) => {
      const userId = getAuthUserId(request);
      if (!userId) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });

      const body = request.body;

      try {
        // Build SET clause dynamically
        const sets: string[] = [];
        const params: any[] = [userId];
        let paramIdx = 2;

        const fieldMap: Record<string, keyof UpdatePreferencesBody> = {
          push_enabled: 'push_enabled',
          email_enabled: 'email_enabled',
          sms_enabled: 'sms_enabled',
          in_app_enabled: 'in_app_enabled',
          quiet_hours_start: 'quiet_hours_start',
          quiet_hours_end: 'quiet_hours_end',
          quiet_hours_timezone: 'quiet_hours_timezone',
        };

        for (const [col, key] of Object.entries(fieldMap)) {
          if (body[key] !== undefined) {
            sets.push(`${col} = $${paramIdx}`);
            params.push(body[key]);
            paramIdx++;
          }
        }

        if (body.module_preferences !== undefined) {
          sets.push(`module_preferences = $${paramIdx}`);
          params.push(JSON.stringify(body.module_preferences));
          paramIdx++;
        }

        if (sets.length === 0) {
          return reply.code(400).send({ code: 'BAD_REQUEST', message: 'No fields to update' });
        }

        sets.push('updated_at = NOW()');

        // Upsert
        await app.sql.unsafe(
          `INSERT INTO notification_preferences (user_id, ${sets.map(s => s.split(' = ')[0]).join(', ')})
           VALUES ($1, ${sets.map((_, i) => `$${i + 2}`).join(', ')})
           ON CONFLICT (user_id) DO UPDATE SET ${sets.join(', ')}`,
          params,
        );

        // Invalidate cache
        await app.redis.del(`notification_prefs:${userId}`).catch(() => {});

        logger.info({ userId, updatedFields: Object.keys(body) }, 'Notification preferences updated');

        return reply.send({ data: { status: 'updated', updatedFields: Object.keys(body) } });
      } catch (err) {
        logger.error({ err, userId }, 'Failed to update notification preferences');
        return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Failed to update preferences' });
      }
    },
  );

  logger.info('Preference routes registered');
}
