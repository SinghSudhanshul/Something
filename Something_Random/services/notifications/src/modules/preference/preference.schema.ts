/**
 * Notification Preference — Zod Validation Schemas
 *
 * Provides strict input validation for preference updates, push token
 * registration, notification inbox queries, and Kafka trigger events.
 *
 * Schema rules:
 * - HH:MM time format for quiet hours (24-hour, e.g. "23:00")
 * - Per-module channel toggles keyed by NEXUS module name
 * - Boolean channel toggles with explicit type coercion
 * - Cursor-based pagination for inbox queries
 * - E.164 validation pattern for SMS phone numbers
 *
 * @module preference.schema
 */

import { z } from 'zod';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Reusable Sub-schemas
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Validates HH:MM 24-hour time strings (e.g. "23:00", "07:30"). */
const timeStringSchema = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d$/,
    'Time must be in HH:MM 24-hour format (e.g. "23:00")',
  );

/** Per-module notification channel preferences (e.g. disable push for bazaar). */
const modulePreferenceSchema = z.object({
  push_enabled: z.boolean().optional(),
  sms_enabled: z.boolean().optional(),
  email_enabled: z.boolean().optional(),
  in_app_enabled: z.boolean().optional(),
});

/** Inferred type for a single module's preference overrides. */
export type ModulePreferenceOverride = z.infer<typeof modulePreferenceSchema>;

/**
 * Per-module preferences keyed by module name.
 * e.g. { "bazaar": { push_enabled: false }, "feast": { sms_enabled: false } }
 */
const perModulePreferencesSchema = z.record(
  z.enum(['bazaar', 'skills', 'feast', 'swift', 'rides', 'pulse', 'system']),
  modulePreferenceSchema,
);

/** E.164 phone number format validation (required for SMS / MSG91). */
export const e164PhoneSchema = z
  .string()
  .regex(
    /^\+[1-9]\d{6,14}$/,
    'Phone number must be in E.164 format (e.g. +919876543210)',
  );

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Preference Request Schemas
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Schema for PATCH /api/v1/notifications/preferences.
 *
 * All fields are optional — clients send only the fields they want to change.
 * At least one field must be present (enforced by the service layer, not here,
 * to provide better error messages).
 */
export const updatePreferencesSchema = z.object({
  push_enabled: z.boolean().optional(),
  sms_enabled: z.boolean().optional(),
  email_enabled: z.boolean().optional(),
  quiet_hours_start: timeStringSchema.optional(),
  quiet_hours_end: timeStringSchema.optional(),
  per_module_preferences: perModulePreferencesSchema.optional(),
});

export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Query Schemas
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Schema for GET query params (currently no params required). */
export const getPreferencesQuerySchema = z.object({}).strict();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Response Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Shape of a notification_preferences row returned from the database. */
export interface NotificationPreferencesRow {
  id: string;
  user_id: string;
  push_enabled: boolean;
  sms_enabled: boolean;
  email_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  per_module_preferences: Record<
    string,
    {
      push_enabled?: boolean;
      sms_enabled?: boolean;
      email_enabled?: boolean;
      in_app_enabled?: boolean;
    }
  >;
  updated_at: string;
}

/**
 * API response shape for GET /api/v1/notifications/preferences.
 * Includes computed effective channel states alongside raw preferences.
 */
export interface PreferencesResponse {
  preferences: NotificationPreferencesRow;
  effective: {
    push: boolean;
    sms: boolean;
    email: boolean;
    in_app: boolean;
    quiet_hours: {
      enabled: boolean;
      start: string;
      end: string;
    };
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Push Token Schemas
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Schema for POST /api/v1/notifications/tokens — register a push token. */
export const registerPushTokenSchema = z.object({
  token: z.string().min(1, 'Push token must not be empty').max(512, 'Push token too long'),
  platform: z.enum(['ios', 'android', 'web'], {
    errorMap: () => ({ message: 'Platform must be one of: ios, android, web' }),
  }),
  device_id: z
    .string()
    .max(255, 'Device ID too long')
    .optional(),
});

export type RegisterPushTokenInput = z.infer<typeof registerPushTokenSchema>;

/** Schema for DELETE /api/v1/notifications/tokens/:token param. */
export const deregisterPushTokenParamsSchema = z.object({
  token: z.string().min(1, 'Token parameter is required'),
});

export type DeregisterPushTokenParams = z.infer<typeof deregisterPushTokenParamsSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Notification Inbox Schemas
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Schema for GET /api/v1/notifications/me query params. */
export const getInboxQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unread_only: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export type GetInboxQuery = z.infer<typeof getInboxQuerySchema>;

/** Schema for PATCH /api/v1/notifications/:id/read params. */
export const markReadParamsSchema = z.object({
  id: z.string().uuid('Notification ID must be a valid UUID'),
});

export type MarkReadParams = z.infer<typeof markReadParamsSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Kafka Trigger Event Schema
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Schema for the nexus.notifications.trigger Kafka event.
 * Any NEXUS service can publish this event to trigger a notification.
 *
 * The `data` field carries template interpolation variables.
 * The `channels` array determines which queues receive the job.
 */
export const notificationTriggerEventSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  type: z.string().min(1, 'Notification template type is required'),
  channels: z
    .array(z.enum(['push', 'sms', 'email', 'in_app']))
    .min(1, 'At least one channel is required'),
  priority: z.number().int().min(1).max(10).default(5),
  data: z.record(z.union([z.string(), z.number()])).default({}),
  idempotencyKey: z.string().optional(),
});

export type NotificationTriggerEvent = z.infer<typeof notificationTriggerEventSchema>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Fastify Schema Objects (for OpenAPI docs)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** JSON Schema for the preferences response (used in Fastify route schema). */
export const preferencesResponseJsonSchema = {
  type: 'object' as const,
  properties: {
    data: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' as const },
        user_id: { type: 'string' as const },
        push_enabled: { type: 'boolean' as const },
        sms_enabled: { type: 'boolean' as const },
        email_enabled: { type: 'boolean' as const },
        quiet_hours_start: { type: 'string' as const },
        quiet_hours_end: { type: 'string' as const },
        per_module_preferences: { type: 'object' as const },
        updated_at: { type: 'string' as const, format: 'date-time' as const },
      },
    },
  },
};

/** JSON Schema for the inbox response (used in Fastify route schema). */
export const inboxResponseJsonSchema = {
  type: 'object' as const,
  properties: {
    data: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          id: { type: 'string' as const },
          user_id: { type: 'string' as const },
          type: { type: 'string' as const },
          title: { type: 'string' as const },
          body: { type: 'string' as const },
          action_url: { type: 'string' as const, nullable: true },
          is_read: { type: 'boolean' as const },
          created_at: { type: 'string' as const, format: 'date-time' as const },
        },
      },
    },
    meta: {
      type: 'object' as const,
      properties: {
        unread_count: { type: 'number' as const },
        next_cursor: { type: 'string' as const, nullable: true },
        has_more: { type: 'boolean' as const },
      },
    },
  },
};

/** JSON Schema for the push token registration response. */
export const pushTokenResponseJsonSchema = {
  type: 'object' as const,
  properties: {
    data: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' as const },
        user_id: { type: 'string' as const },
        token: { type: 'string' as const },
        platform: { type: 'string' as const, enum: ['ios', 'android', 'web'] },
        is_active: { type: 'boolean' as const },
        created_at: { type: 'string' as const, format: 'date-time' as const },
      },
    },
  },
};
