/**
 * Profile Repository
 *
 * Data access for user profiles, student profiles, and campus information.
 */

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, sql, and, ilike, ne, notInArray } from 'drizzle-orm';
import * as schema from '@nexus/database/schema';

type DB = PostgresJsDatabase<typeof schema>;

/**
 * Get full user profile with student profile data.
 */
export async function findFullProfile(
  db: DB,
  userId: string,
): Promise<{
  user: typeof schema.users.$inferSelect;
  studentProfile: typeof schema.studentProfiles.$inferSelect | null;
  campus: typeof schema.campuses.$inferSelect | null;
} | null> {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (user === undefined) return null;

  const [studentProfile] = await db
    .select()
    .from(schema.studentProfiles)
    .where(eq(schema.studentProfiles.userId, userId))
    .limit(1);

  const [campus] = await db
    .select()
    .from(schema.campuses)
    .where(eq(schema.campuses.id, user.campusId))
    .limit(1);

  return {
    user,
    studentProfile: studentProfile ?? null,
    campus: campus ?? null,
  };
}

/**
 * Update student profile fields.
 */
export async function updateStudentProfile(
  db: DB,
  userId: string,
  data: Partial<{
    fullName: string;
    department: string;
    yearOfStudy: number;
    hostelBlock: string;
    roomNumber: string;
    bio: string;
    interests: string[];
  }>,
): Promise<void> {
  const updateData: Record<string, unknown> = { updatedAt: new Date() };

  if (data.fullName !== undefined) updateData['fullName'] = data.fullName;
  if (data.department !== undefined) updateData['department'] = data.department;
  if (data.yearOfStudy !== undefined) updateData['yearOfStudy'] = data.yearOfStudy;
  if (data.hostelBlock !== undefined) updateData['hostelBlock'] = data.hostelBlock;
  if (data.roomNumber !== undefined) updateData['roomNumber'] = data.roomNumber;
  if (data.bio !== undefined) updateData['bio'] = data.bio;
  if (data.interests !== undefined) updateData['interests'] = data.interests;

  await db
    .update(schema.studentProfiles)
    .set(updateData)
    .where(eq(schema.studentProfiles.userId, userId));
}

/**
 * Update avatar URL in student profile.
 */
export async function updateAvatar(
  db: DB,
  userId: string,
  avatarUrl: string | null,
): Promise<string | null> {
  // Get old avatar URL for cleanup
  const [existing] = await db
    .select({ avatarUrl: schema.studentProfiles.avatarUrl })
    .from(schema.studentProfiles)
    .where(eq(schema.studentProfiles.userId, userId))
    .limit(1);

  const oldAvatarUrl = existing?.avatarUrl ?? null;

  await db
    .update(schema.studentProfiles)
    .set({ avatarUrl, updatedAt: new Date() })
    .where(eq(schema.studentProfiles.userId, userId));

  return oldAvatarUrl;
}

/**
 * Search users by name within a campus scope.
 * Excludes blocked users.
 */
export async function searchUsers(
  db: DB,
  params: {
    query: string;
    campusId: string;
    excludeUserId: string;
    blockedIds: string[];
    cursor: string | null;
    limit: number;
  },
): Promise<{
  users: (typeof schema.users.$inferSelect)[];
  hasMore: boolean;
}> {
  const conditions = [
    eq(schema.users.campusId, params.campusId),
    ne(schema.users.id, params.excludeUserId),
    eq(schema.users.status, 'active'),
  ];

  if (params.query.length > 0) {
    conditions.push(ilike(schema.users.name, `%${params.query}%`));
  }

  if (params.blockedIds.length > 0) {
    conditions.push(notInArray(schema.users.id, params.blockedIds));
  }

  // Fetch limit + 1 to determine hasMore
  const fetchLimit = params.limit + 1;

  let query = db
    .select()
    .from(schema.users)
    .where(and(...conditions))
    .limit(fetchLimit);

  if (params.cursor !== null) {
    query = db
      .select()
      .from(schema.users)
      .where(and(...conditions, sql`${schema.users.id} > ${params.cursor}`))
      .limit(fetchLimit);
  }

  const results = await query;
  const hasMore = results.length > params.limit;
  const users = hasMore ? results.slice(0, params.limit) : results;

  return { users, hasMore };
}

/**
 * Get minimal profile for QR code wallet scan.
 */
export async function findMinimalProfile(
  db: DB,
  userId: string,
): Promise<{ id: string; name: string; avatarUrl: string | null; trustTier: string } | null> {
  const [user] = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
      trustTier: schema.users.trustTier,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  return user ?? null;
}
