/**
 * Notification Preference Repository — Data Access Layer
 *
 * Provides atomic CRUD operations against the notification_preferences table.
 * All methods use parameterized queries (no string interpolation) to prevent
 * SQL injection. Error handling wraps pg driver errors into application-level
 * exceptions with contextual metadata for structured logging.
 *
 * Table schema (from 0011_notifications_schema.sql):
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid()
 *   user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE
 *   push_enabled BOOLEAN NOT NULL DEFAULT true
 *   sms_enabled BOOLEAN NOT NULL DEFAULT true
 *   email_enabled BOOLEAN NOT NULL DEFAULT true
 *   quiet_hours_start TIME NOT NULL DEFAULT '23:00'
 *   quiet_hours_end TIME NOT NULL DEFAULT '07:00'
 *   per_module_preferences JSONB NOT NULL DEFAULT '{}'
 *   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *
 * @module preference.repository
 */

import type { Pool, PoolClient } from 'pg';
import { createLogger } from '@nexus/utils';
import type {
  NotificationPreferencesRow,
  UpdatePreferencesInput,
} from './preference.schema.js';

const logger = createLogger('preference-repository');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Default preferences applied when a user has no saved preferences. */
const DEFAULT_PREFERENCES: Omit<NotificationPreferencesRow, 'id' | 'user_id' | 'updated_at'> = {
  push_enabled: true,
  sms_enabled: true,
  email_enabled: true,
  quiet_hours_start: '23:00',
  quiet_hours_end: '07:00',
  per_module_preferences: {},
};

/**
 * Standard SELECT columns with explicit time casting.
 * PostgreSQL TIME columns are cast to text so they arrive as "HH:MM:SS".
 */
const SELECT_COLUMNS = `
  id, user_id, push_enabled, sms_enabled, email_enabled,
  quiet_hours_start::text, quiet_hours_end::text,
  per_module_preferences, updated_at
`.trim();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Read Operations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Retrieves notification preferences for a given user.
 *
 * If no preferences exist yet (first-time user), returns null so the
 * service layer can decide whether to create defaults or return a
 * computed default object.
 *
 * @param db - PostgreSQL connection pool or client within a transaction
 * @param userId - UUID of the authenticated user
 * @returns The preferences row or null if none exist
 */
export async function getByUserId(
  db: Pool | PoolClient,
  userId: string,
): Promise<NotificationPreferencesRow | null> {
  try {
    const result = await db.query<NotificationPreferencesRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM notification_preferences
       WHERE user_id = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return normalizeRow(result.rows[0]!);
  } catch (error: unknown) {
    logger.error({ err: error, userId }, 'Failed to fetch notification preferences');
    throw error;
  }
}

/**
 * Retrieves notification preferences for multiple users in a single query.
 * Useful for batch operations (e.g. broadcasting a notification to a list).
 *
 * @param db - PostgreSQL connection pool
 * @param userIds - Array of user UUIDs
 * @returns Map of userId → preferences (missing users are absent from the map)
 */
export async function getByUserIds(
  db: Pool,
  userIds: string[],
): Promise<Map<string, NotificationPreferencesRow>> {
  if (userIds.length === 0) {
    return new Map();
  }

  try {
    const result = await db.query<NotificationPreferencesRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM notification_preferences
       WHERE user_id = ANY($1::uuid[])`,
      [userIds],
    );

    const map = new Map<string, NotificationPreferencesRow>();
    for (const row of result.rows) {
      map.set(row.user_id, normalizeRow(row));
    }
    return map;
  } catch (error: unknown) {
    logger.error({ err: error, count: userIds.length }, 'Failed to batch-fetch preferences');
    throw error;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Write Operations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Upserts notification preferences for a user.
 *
 * Uses INSERT ... ON CONFLICT DO UPDATE to atomically create or update
 * the preferences row. Only the fields present in `data` are updated;
 * omitted fields retain their current (or default) values.
 *
 * The per_module_preferences field uses JSON merge (||) so clients can
 * update individual modules without overwriting the entire object.
 *
 * @param db - PostgreSQL connection pool or client within a transaction
 * @param userId - UUID of the authenticated user
 * @param data - Partial preference fields to set
 * @returns The full preferences row after upsert
 */
export async function upsert(
  db: Pool | PoolClient,
  userId: string,
  data: UpdatePreferencesInput,
): Promise<NotificationPreferencesRow> {
  try {
    // Build the values for the INSERT clause — merge defaults with incoming data
    const pushEnabled = data.push_enabled ?? DEFAULT_PREFERENCES.push_enabled;
    const smsEnabled = data.sms_enabled ?? DEFAULT_PREFERENCES.sms_enabled;
    const emailEnabled = data.email_enabled ?? DEFAULT_PREFERENCES.email_enabled;
    const quietStart = data.quiet_hours_start ?? DEFAULT_PREFERENCES.quiet_hours_start;
    const quietEnd = data.quiet_hours_end ?? DEFAULT_PREFERENCES.quiet_hours_end;
    const perModule = data.per_module_preferences ?? DEFAULT_PREFERENCES.per_module_preferences;

    const result = await db.query<NotificationPreferencesRow>(
      `INSERT INTO notification_preferences
         (user_id, push_enabled, sms_enabled, email_enabled,
          quiet_hours_start, quiet_hours_end, per_module_preferences, updated_at)
       VALUES ($1, $2, $3, $4, $5::time, $6::time, $7::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         push_enabled          = COALESCE($2, notification_preferences.push_enabled),
         sms_enabled           = COALESCE($3, notification_preferences.sms_enabled),
         email_enabled         = COALESCE($4, notification_preferences.email_enabled),
         quiet_hours_start     = COALESCE($5::time, notification_preferences.quiet_hours_start),
         quiet_hours_end       = COALESCE($6::time, notification_preferences.quiet_hours_end),
         per_module_preferences = CASE
           WHEN $7::jsonb IS NOT NULL
           THEN notification_preferences.per_module_preferences || $7::jsonb
           ELSE notification_preferences.per_module_preferences
         END,
         updated_at            = NOW()
       RETURNING ${SELECT_COLUMNS}`,
      [
        userId,
        pushEnabled,
        smsEnabled,
        emailEnabled,
        quietStart,
        quietEnd,
        JSON.stringify(perModule),
      ],
    );

    logger.info({ userId }, 'Notification preferences upserted');
    return normalizeRow(result.rows[0]!);
  } catch (error: unknown) {
    logger.error({ err: error, userId }, 'Failed to upsert notification preferences');
    throw error;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Quiet Hours
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Quiet hours result type with parsed start/end time strings.
 */
export interface QuietHoursResult {
  quiet_hours_start: string;
  quiet_hours_end: string;
}

/**
 * Retrieves only the quiet hours settings for a user.
 *
 * Returns null if the user has no preferences — callers should fall back
 * to the system defaults (23:00–07:00).
 *
 * @param db - PostgreSQL connection pool
 * @param userId - UUID of the user
 * @returns Quiet hours start/end or null if no preferences exist
 */
export async function getQuietHours(
  db: Pool,
  userId: string,
): Promise<QuietHoursResult | null> {
  try {
    const result = await db.query<QuietHoursResult>(
      `SELECT quiet_hours_start::text, quiet_hours_end::text
       FROM notification_preferences
       WHERE user_id = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0]!;
    return {
      quiet_hours_start: normalizeTimeString(row.quiet_hours_start),
      quiet_hours_end: normalizeTimeString(row.quiet_hours_end),
    };
  } catch (error: unknown) {
    logger.error({ err: error, userId }, 'Failed to fetch quiet hours');
    throw error;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Module Preferences
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Module-level preference result — indicates whether each channel is
 * enabled for a specific module.
 */
export interface ModulePreferenceResult {
  /** Global channel toggles */
  push_enabled: boolean;
  sms_enabled: boolean;
  email_enabled: boolean;
  /** Per-module overrides (may be empty) */
  module_overrides: {
    push_enabled?: boolean;
    sms_enabled?: boolean;
    email_enabled?: boolean;
    in_app_enabled?: boolean;
  } | null;
}

/**
 * Retrieves both global and module-specific preference overrides.
 *
 * The service layer merges global toggles with per-module overrides
 * to compute the effective channel state. Module overrides take
 * precedence over global settings.
 *
 * @param db - PostgreSQL connection pool
 * @param userId - UUID of the user
 * @param moduleName - NEXUS module key (e.g. "bazaar", "rides")
 * @returns Global toggles + module overrides, or null if no preferences
 */
export async function getModulePreferences(
  db: Pool,
  userId: string,
  moduleName: string,
): Promise<ModulePreferenceResult | null> {
  try {
    const result = await db.query<{
      push_enabled: boolean;
      sms_enabled: boolean;
      email_enabled: boolean;
      per_module_preferences: Record<
        string,
        {
          push_enabled?: boolean;
          sms_enabled?: boolean;
          email_enabled?: boolean;
          in_app_enabled?: boolean;
        }
      >;
    }>(
      `SELECT push_enabled, sms_enabled, email_enabled, per_module_preferences
       FROM notification_preferences
       WHERE user_id = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0]!;
    const moduleOverrides = row.per_module_preferences[moduleName] ?? null;

    return {
      push_enabled: row.push_enabled,
      sms_enabled: row.sms_enabled,
      email_enabled: row.email_enabled,
      module_overrides: moduleOverrides,
    };
  } catch (error: unknown) {
    logger.error({ err: error, userId, moduleName }, 'Failed to fetch module preferences');
    throw error;
  }
}

/**
 * Checks whether a specific channel is effectively enabled for a user,
 * considering both global toggles and per-module overrides.
 *
 * Resolution order:
 * 1. If per-module override exists for this channel → use it
 * 2. Otherwise, use the global toggle
 * 3. If no preferences exist at all → default to enabled (true)
 *
 * Note: in_app is always enabled (no global toggle for it).
 *
 * @param db - PostgreSQL connection pool
 * @param userId - UUID of the user
 * @param channel - Notification channel to check
 * @param moduleName - Optional NEXUS module name for per-module overrides
 * @returns true if the channel is enabled for this user (and optional module)
 */
export async function isChannelEnabled(
  db: Pool,
  userId: string,
  channel: 'push' | 'sms' | 'email' | 'in_app',
  moduleName?: string,
): Promise<boolean> {
  try {
    // in_app is always enabled — no user preference can disable it
    if (channel === 'in_app') {
      if (moduleName) {
        const modPrefs = await getModulePreferences(db, userId, moduleName);
        if (modPrefs?.module_overrides?.in_app_enabled === false) {
          return false;
        }
      }
      return true;
    }

    const result = await db.query<{
      push_enabled: boolean;
      sms_enabled: boolean;
      email_enabled: boolean;
      per_module_preferences: Record<string, Record<string, boolean | undefined>>;
    }>(
      `SELECT push_enabled, sms_enabled, email_enabled, per_module_preferences
       FROM notification_preferences
       WHERE user_id = $1`,
      [userId],
    );

    // No preferences → all channels enabled by default
    if (result.rows.length === 0) {
      return true;
    }

    const row = result.rows[0]!;

    // Check per-module override first
    if (moduleName) {
      const moduleOverride = row.per_module_preferences[moduleName];
      if (moduleOverride) {
        const channelKey = `${channel}_enabled` as const;
        if (moduleOverride[channelKey] !== undefined) {
          return moduleOverride[channelKey] as boolean;
        }
      }
    }

    // Fall back to global toggle
    const globalKey = `${channel}_enabled` as keyof Pick<
      typeof row,
      'push_enabled' | 'sms_enabled' | 'email_enabled'
    >;
    return row[globalKey];
  } catch (error: unknown) {
    logger.error(
      { err: error, userId, channel, moduleName },
      'Failed to check channel enabled state',
    );
    // On error, default to enabled (fail open for notifications)
    return true;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Default Preferences
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Creates default preferences for a user if they do not already exist.
 *
 * Uses INSERT ... ON CONFLICT DO NOTHING to avoid race conditions when
 * multiple requests arrive simultaneously for a new user.
 *
 * @param db - PostgreSQL connection pool
 * @param userId - UUID of the user
 * @returns The preferences row (newly created or existing)
 */
export async function ensureDefaults(
  db: Pool,
  userId: string,
): Promise<NotificationPreferencesRow> {
  try {
    const result = await db.query<NotificationPreferencesRow>(
      `INSERT INTO notification_preferences (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING ${SELECT_COLUMNS}`,
      [userId],
    );

    // If the row already existed, ON CONFLICT DO NOTHING returns 0 rows
    if (result.rows.length > 0) {
      return normalizeRow(result.rows[0]!);
    }

    // Fetch the existing row
    const existing = await getByUserId(db, userId);
    if (existing === null) {
      // Should never happen — defensive guard
      throw new Error(`Failed to create or retrieve preferences for user ${userId}`);
    }
    return existing;
  } catch (error: unknown) {
    logger.error({ err: error, userId }, 'Failed to ensure default preferences');
    throw error;
  }
}

/**
 * Returns the static default preferences object.
 * Used by the service layer when a user has no saved preferences.
 *
 * @returns Default preference values (not persisted)
 */
export function getDefaults(): typeof DEFAULT_PREFERENCES {
  return { ...DEFAULT_PREFERENCES };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Normalizes a preferences row from the database, ensuring time strings
 * are in HH:MM format (PostgreSQL returns "HH:MM:SS" from TIME casts).
 *
 * @param row - Raw row from pg driver
 * @returns Normalized row with HH:MM time strings
 */
function normalizeRow(row: NotificationPreferencesRow): NotificationPreferencesRow {
  return {
    ...row,
    quiet_hours_start: normalizeTimeString(row.quiet_hours_start),
    quiet_hours_end: normalizeTimeString(row.quiet_hours_end),
  };
}

/**
 * Converts a PostgreSQL TIME string (which may include seconds) to HH:MM format.
 *
 * @param time - Time string like "23:00:00" or "23:00"
 * @returns HH:MM formatted time string
 */
function normalizeTimeString(time: string): string {
  const parts = time.split(':');
  if (parts.length >= 2) {
    return `${parts[0]}:${parts[1]}`;
  }
  return time;
}
