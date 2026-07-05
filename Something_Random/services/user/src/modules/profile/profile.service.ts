/**
 * Profile Service
 *
 * Business logic for user profiles. Campus-scoped visibility.
 * Phone numbers always masked for non-self profiles.
 */

import type { FastifyInstance } from 'fastify';
import { createLogger } from '@nexus/utils';
import type { RequestUser } from '@nexus/utils';

import * as repo from './profile.repository.js';
import { getTrustTier } from '../trust/trust.constants.js';

const logger = createLogger('profile-service');

export interface PublicProfile {
  id: string;
  full_name: string;
  campus: { name: string; city: string | null };
  department: string | null;
  year_of_study: number | null;
  avatar_url: string | null;
  bio: string | null;
  interests: string[];
  trust_score: number;
  trust_tier: string;
  verification_level: string;
  member_since: string;
}

export interface FullProfile extends PublicProfile {
  email: string;
  phone: string | null;
  hostel_block: string | null;
  room_number: string | null;
  status: string;
}

function maskPhone(phone: string | null | undefined): string | null {
  if (phone === null || phone === undefined || phone.length < 4) return null;
  const lastFour = phone.slice(-4);
  return `+91XXXXXX${lastFour}`;
}

/**
 * Get the requesting user's own full profile.
 */
export async function getMyProfile(app: FastifyInstance, userId: string): Promise<FullProfile> {
  // Check Redis cache
  const cached = await app.redis.get(`user:profile:${userId}`);
  if (cached !== null) {
    return JSON.parse(cached) as FullProfile;
  }

  const result = await repo.findFullProfile(app.db as any, userId);
  if (result === null) {
    throw Object.assign(new Error('User not found'), { statusCode: 404 });
  }

  const { user, studentProfile, campus } = result;

  const profile: FullProfile = {
    id: user.id,
    email: user.email,
    phone: user.phone ?? null,
    full_name: studentProfile?.fullName ?? user.name,
    campus: {
      name: campus?.name ?? 'Unknown',
      city: campus?.city ?? null,
    },
    department: studentProfile?.department ?? null,
    year_of_study: studentProfile?.yearOfStudy ?? null,
    hostel_block: studentProfile?.hostelBlock ?? null,
    room_number: studentProfile?.roomNumber ?? null,
    avatar_url: studentProfile?.avatarUrl ?? user.avatarUrl ?? null,
    bio: studentProfile?.bio ?? null,
    interests: studentProfile?.interests ?? [],
    trust_score: studentProfile !== null ? parseFloat(studentProfile.trustScore) : 3.00,
    trust_tier: studentProfile?.trustTier ?? user.trustTier ?? 'new',
    verification_level: studentProfile?.verificationLevel ?? user.verificationLevel ?? '1',
    status: user.status ?? 'active',
    member_since: user.createdAt.toISOString(),
  };

  // Cache for 5 minutes
  await app.redis.set(`user:profile:${userId}`, JSON.stringify(profile), 'EX', 300);

  return profile;
}

/**
 * Get another user's public profile.
 * Phone is always masked. Respects blocks.
 */
export async function getPublicProfile(
  app: FastifyInstance,
  targetUserId: string,
  requestingUser: RequestUser,
): Promise<PublicProfile & { phone_masked: string | null }> {
  // Check cache
  const cached = await app.redis.get(`user:public_profile:${targetUserId}`);
  if (cached !== null) {
    return JSON.parse(cached) as PublicProfile & { phone_masked: string | null };
  }

  const result = await repo.findFullProfile(app.db as any, targetUserId);
  if (result === null) {
    throw Object.assign(new Error('User not found'), { statusCode: 404 });
  }

  const { user, studentProfile, campus } = result;

  const profile = {
    id: user.id,
    full_name: studentProfile?.fullName ?? user.name,
    phone_masked: maskPhone(user.phone),
    campus: {
      name: campus?.name ?? 'Unknown',
      city: campus?.city ?? null,
    },
    department: studentProfile?.department ?? null,
    year_of_study: studentProfile?.yearOfStudy ?? null,
    avatar_url: studentProfile?.avatarUrl ?? user.avatarUrl ?? null,
    bio: studentProfile?.bio ?? null,
    interests: studentProfile?.interests ?? [],
    trust_score: studentProfile !== null ? parseFloat(studentProfile.trustScore) : 3.00,
    trust_tier: studentProfile?.trustTier ?? user.trustTier ?? 'new',
    verification_level: studentProfile?.verificationLevel ?? user.verificationLevel ?? '1',
    member_since: user.createdAt.toISOString(),
  };

  // Cache for 5 minutes
  await app.redis.set(`user:public_profile:${targetUserId}`, JSON.stringify(profile), 'EX', 300);

  return profile;
}

/**
 * Update the requesting user's profile.
 */
export async function updateMyProfile(
  app: FastifyInstance,
  userId: string,
  data: {
    full_name?: string;
    department?: string;
    year_of_study?: number;
    hostel_block?: string;
    room_number?: string;
    bio?: string;
    interests?: string[];
  },
): Promise<FullProfile> {
  await repo.updateStudentProfile(app.db as any, userId, {
    ...(data.full_name !== undefined && { fullName: data.full_name }),
    ...(data.department !== undefined && { department: data.department }),
    ...(data.year_of_study !== undefined && { yearOfStudy: data.year_of_study }),
    ...(data.hostel_block !== undefined && { hostelBlock: data.hostel_block }),
    ...(data.room_number !== undefined && { roomNumber: data.room_number }),
    ...(data.bio !== undefined && { bio: data.bio }),
    ...(data.interests !== undefined && { interests: data.interests }),
  });

  // Invalidate cache
  await app.redis.del(`user:profile:${userId}`);
  await app.redis.del(`user:public_profile:${userId}`);

  // Publish Kafka event
  if (app.kafka) {
    try {
      await app.kafka.send({
        topic: 'nexus.users.updated',
        messages: [
          {
            key: userId,
            value: JSON.stringify({
              userId,
              updatedFields: Object.keys(data),
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      });
    } catch {
      logger.warn('Failed to publish user updated event');
    }
  }

  logger.info({ userId, fields: Object.keys(data) }, 'Profile updated');

  // Return fresh profile
  return getMyProfile(app, userId);
}

/**
 * Search users within the requesting user's campus.
 * Super admins can optionally search across all campuses.
 */
export async function searchUsers(
  app: FastifyInstance,
  requestingUser: RequestUser,
  query: string,
  cursor: string | null,
  limit: number,
  overrideCampusId?: string,
): Promise<{
  items: PublicProfile[];
  cursor: string | null;
  hasMore: boolean;
}> {
  // CRITICAL: Campus scoping — students only see their own campus
  const campusId = requestingUser.roles.includes('super_admin')
    ? (overrideCampusId ?? requestingUser.campusId)
    : requestingUser.campusId;

  // Get blocked user IDs
  const blockedIds = await getBlockedUserIds(app, requestingUser.id);

  const { users, hasMore } = await repo.searchUsers(app.db as any, {
    query,
    campusId,
    excludeUserId: requestingUser.id,
    blockedIds,
    cursor,
    limit,
  });

  const items: PublicProfile[] = users.map((user) => ({
    id: user.id,
    full_name: user.name,
    campus: { name: '', city: null },
    department: null,
    year_of_study: null,
    avatar_url: user.avatarUrl ?? null,
    bio: null,
    interests: [],
    trust_score: user.trustScore ?? 0,
    trust_tier: user.trustTier ?? 'new',
    verification_level: user.verificationLevel ?? '1',
    member_since: user.createdAt.toISOString(),
  }));

  const nextCursor = hasMore && users.length > 0
    ? users[users.length - 1]?.id ?? null
    : null;

  return {
    items,
    cursor: nextCursor,
    hasMore,
  };
}

/**
 * Get minimal profile for QR code wallet scan.
 */
export async function getQrProfile(
  app: FastifyInstance,
  userId: string,
): Promise<{ id: string; name: string; avatar_url: string | null; trust_tier: string }> {
  const profile = await repo.findMinimalProfile(app.db as any, userId);
  if (profile === null) {
    throw Object.assign(new Error('User not found'), { statusCode: 404 });
  }

  return {
    id: profile.id,
    name: profile.name,
    avatar_url: profile.avatarUrl,
    trust_tier: profile.trustTier,
  };
}

// Helper to get blocked user IDs (used by search)
async function getBlockedUserIds(app: FastifyInstance, userId: string): Promise<string[]> {
  const { eq } = await import('drizzle-orm');
  const { userBlocks } = await import('@nexus/database/schema');

  const blocks = await app.db
    .select({ blockedId: userBlocks.blockedId })
    .from(userBlocks)
    .where(eq(userBlocks.blockerId, userId));

  return blocks.map((b) => b.blockedId);
}
