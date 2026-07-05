/**
 * Notification Preference Service — Business Logic Layer
 *
 * Orchestrates preference lookups, updates, and channel-availability checks.
 * The service layer is responsible for:
 * - Ensuring default preferences exist before returning them
 * - Computing effective channel states from global + per-module toggles
 * - Validating input constraints the schema layer cannot express
 * - Structured logging with user context
 *
 * @module preference.service
 */

import type { Pool } from 'pg';
import { createLogger, AppError } from '@nexus/utils';
import * as preferenceRepo from './preference.repository.js';
import type {
  NotificationPreferencesRow,
  UpdatePreferencesInput,
  PreferencesResponse,
} from './preference.schema.js';

const logger = createLogger('preference-service');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Read Operations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Retrieves the full notification preferences for a user.
 *
 * If the user has no saved preferences, creates defaults atomically
 * (INSERT ON CONFLICT DO NOTHING) so subsequent calls are fast.
 *
 * Returns both the raw preferences and computed "effective" channel
 * states that clients can use directly without re-computing.
 *
 * @param db - PostgreSQL connection pool
 * @param userId - UUID of the authenticated user
 * @returns Full preferences with computed effective states
 */
export async function getPreferences(
  db: Pool,
  userId: string,
): Promise<PreferencesResponse> {
  let preferences = await preferenceRepo.getByUserId(db, userId);

  if (preferences === null) {
    logger.info({ userId }, 'No preferences found, creating defaults');
    preferences = await preferenceRepo.ensureDefaults(db, userId);
  }

  return buildPreferencesResponse(preferences);
}

/**
 * Retrieves only the raw preferences row for a user.
 * Does NOT create defaults — returns null if none exist.
 *
 * Useful for internal lookups where you don't want the side-effect
 * of creating a preferences row.
 *
 * @param db - PostgreSQL connection pool
 * @param userId - UUID of the user
 * @returns The preferences row or null
 */
export async function getRawPreferences(
  db: Pool,
  userId: string,
): Promise<NotificationPreferencesRow | null> {
  return preferenceRepo.getByUserId(db, userId);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Write Operations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Updates notification preferences for a user.
 *
 * Validates that at least one field is being updated, then performs
 * an atomic upsert. Returns the full updated preferences with
 * computed effective states.
 *
 * Business rules:
 * - Cannot set quiet_hours_start without quiet_hours_end and vice versa
 *   (both must be provided together, or neither)
 * - Per-module preferences are merged (not replaced) with existing ones
 *
 * @param db - PostgreSQL connection pool
 * @param userId - UUID of the authenticated user
 * @param data - Partial preference fields to update
 * @returns Updated preferences with computed effective states
 * @throws AppError if no valid fields are provided or validation fails
 */
export async function updatePreferences(
  db: Pool,
  userId: string,
  data: UpdatePreferencesInput,
): Promise<PreferencesResponse> {
  // Validate that at least one field is being updated
  const hasUpdates =
    data.push_enabled !== undefined ||
    data.sms_enabled !== undefined ||
    data.email_enabled !== undefined ||
    data.quiet_hours_start !== undefined ||
    data.quiet_hours_end !== undefined ||
    (data.per_module_preferences !== undefined &&
      Object.keys(data.per_module_preferences).length > 0);

  if (!hasUpdates) {
    throw AppError.badRequest(
      'At least one preference field must be provided',
      'NO_FIELDS_TO_UPDATE',
    );
  }

  // Validate quiet hours pair consistency
  const hasStart = data.quiet_hours_start !== undefined;
  const hasEnd = data.quiet_hours_end !== undefined;
  if (hasStart !== hasEnd) {
    throw AppError.badRequest(
      'Both quiet_hours_start and quiet_hours_end must be provided together',
      'QUIET_HOURS_INCOMPLETE',
    );
  }

  // Validate quiet hours are not the same time
  if (hasStart && hasEnd && data.quiet_hours_start === data.quiet_hours_end) {
    throw AppError.badRequest(
      'quiet_hours_start and quiet_hours_end cannot be the same time',
      'QUIET_HOURS_INVALID',
    );
  }

  const updated = await preferenceRepo.upsert(db, userId, data);
  logger.info(
    { userId, fields: Object.keys(data).filter((k) => (data as Record<string, unknown>)[k] !== undefined) },
    'Preferences updated',
  );

  return buildPreferencesResponse(updated);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Channel Availability
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Checks whether a specific notification channel is enabled for a user.
 *
 * This is the primary check used by the queue module before enqueuing
 * a notification job. It considers:
 * 1. Global channel toggles (push_enabled, sms_enabled, email_enabled)
 * 2. Per-module overrides (e.g. disable push for bazaar only)
 *
 * Note: in_app is always enabled by default unless explicitly disabled
 * at the per-module level.
 *
 * @param db - PostgreSQL connection pool
 * @param userId - UUID of the user
 * @param channel - Channel to check ('push' | 'sms' | 'email' | 'in_app')
 * @param moduleName - Optional NEXUS module name for per-module overrides
 * @returns true if the channel is enabled
 */
export async function isChannelEnabled(
  db: Pool,
  userId: string,
  channel: 'push' | 'sms' | 'email' | 'in_app',
  moduleName?: string,
): Promise<boolean> {
  return preferenceRepo.isChannelEnabled(db, userId, channel, moduleName);
}

/**
 * Checks all channels at once for a user+module combination.
 * Returns a map of channel → enabled status.
 *
 * @param db - PostgreSQL connection pool
 * @param userId - UUID of the user
 * @param moduleName - Optional NEXUS module name
 * @returns Record of channel → boolean
 */
export async function getEnabledChannels(
  db: Pool,
  userId: string,
  moduleName?: string,
): Promise<Record<'push' | 'sms' | 'email' | 'in_app', boolean>> {
  const [push, sms, email, inApp] = await Promise.all([
    preferenceRepo.isChannelEnabled(db, userId, 'push', moduleName),
    preferenceRepo.isChannelEnabled(db, userId, 'sms', moduleName),
    preferenceRepo.isChannelEnabled(db, userId, 'email', moduleName),
    preferenceRepo.isChannelEnabled(db, userId, 'in_app', moduleName),
  ]);

  return {
    push,
    sms,
    email,
    in_app: inApp,
  };
}

/**
 * Retrieves quiet hours for a user, falling back to system defaults
 * if the user has no preferences.
 *
 * @param db - PostgreSQL connection pool
 * @param userId - UUID of the user
 * @returns Quiet hours start and end times in HH:MM format
 */
export async function getQuietHours(
  db: Pool,
  userId: string,
): Promise<{ start: string; end: string }> {
  const result = await preferenceRepo.getQuietHours(db, userId);

  if (result === null) {
    const defaults = preferenceRepo.getDefaults();
    return {
      start: defaults.quiet_hours_start,
      end: defaults.quiet_hours_end,
    };
  }

  return {
    start: result.quiet_hours_start,
    end: result.quiet_hours_end,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Builds the full preferences response including computed effective states.
 *
 * @param preferences - Raw preferences row from the database
 * @returns Response with both raw and effective preference states
 */
function buildPreferencesResponse(
  preferences: NotificationPreferencesRow,
): PreferencesResponse {
  const hasQuietHours =
    preferences.quiet_hours_start !== '00:00' ||
    preferences.quiet_hours_end !== '00:00';

  return {
    preferences,
    effective: {
      push: preferences.push_enabled,
      sms: preferences.sms_enabled,
      email: preferences.email_enabled,
      in_app: true, // in_app is always enabled at the global level
      quiet_hours: {
        enabled: hasQuietHours,
        start: preferences.quiet_hours_start,
        end: preferences.quiet_hours_end,
      },
    },
  };
}
