/**
 * Trust Score Repository
 *
 * Data access for trust_score_events table.
 * This table is APPEND-ONLY: only insert and select operations.
 * No update or delete methods exist anywhere in this file.
 */

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, desc, sql } from 'drizzle-orm';
import * as schema from '@nexus/database/schema';

type DB = PostgresJsDatabase<typeof schema>;

export interface TrustEventInsert {
  userId: string;
  eventType: string;
  delta: string;
  reason: string;
  referenceId?: string | undefined;
  referenceType?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

/**
 * Insert a trust score event. APPEND ONLY.
 */
export async function insertTrustEvent(db: DB, event: TrustEventInsert): Promise<void> {
  await db.insert(schema.trustScoreEvents).values({
    userId: event.userId,
    eventType: event.eventType,
    delta: event.delta,
    reason: event.reason,
    ...(event.referenceId !== undefined && { referenceId: event.referenceId }),
    ...(event.referenceType !== undefined && { referenceType: event.referenceType }),
    ...(event.metadata !== undefined && { metadata: event.metadata }),
  });
}

/**
 * Get trust events for a user, ordered by most recent first.
 */
export async function findTrustEventsByUserId(
  db: DB,
  userId: string,
  limit = 50,
): Promise<(typeof schema.trustScoreEvents.$inferSelect)[]> {
  return db
    .select()
    .from(schema.trustScoreEvents)
    .where(eq(schema.trustScoreEvents.userId, userId))
    .orderBy(desc(schema.trustScoreEvents.createdAt))
    .limit(limit);
}

/**
 * Atomically apply delta to trust score using GREATEST/LEAST to clamp 0–5.
 * Never: read → add → write (race condition).
 * Always: single atomic UPDATE.
 */
export async function applyTrustScoreDelta(
  db: DB,
  userId: string,
  delta: number,
): Promise<void> {
  await db.execute(sql`
    UPDATE student_profiles
    SET trust_score = GREATEST(0.00, LEAST(5.00, trust_score + ${delta.toFixed(2)}::numeric)),
        updated_at = NOW()
    WHERE user_id = ${userId}
  `);
}

/**
 * Get the current trust score for a user.
 */
export async function getTrustScore(
  db: DB,
  userId: string,
): Promise<{ trustScore: string; trustTier: string } | undefined> {
  const [result] = await db
    .select({
      trustScore: schema.studentProfiles.trustScore,
      trustTier: schema.studentProfiles.trustTier,
    })
    .from(schema.studentProfiles)
    .where(eq(schema.studentProfiles.userId, userId))
    .limit(1);

  return result;
}
