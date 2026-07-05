/**
 * Auth Module — Repository
 *
 * All database queries for the auth module. No business logic here —
 * only data access. Returns raw DB results.
 */

import { eq, and, isNull, desc } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  users,
  studentProfiles,
  campuses,
  emailOtps,
  sessions,
} from '@nexus/database/schema';

// ── User Queries ───────────────────────────────────────
export function findUserByEmail(db: FastifyInstance['db'], email: string) {
  return db.select().from(users).where(eq(users.email, email)).limit(1);
}

export function findUserByPhone(db: FastifyInstance['db'], phone: string) {
  return db.select().from(users).where(eq(users.phone, phone)).limit(1);
}

export function findUserById(db: FastifyInstance['db'], id: string) {
  return db.select().from(users).where(eq(users.id, id)).limit(1);
}

export function createUser(
  db: FastifyInstance['db'],
  data: {
    email: string;
    phone: string;
    passwordHash: string;
    name: string;
    campusId: string;
    status: 'pending_verification' | 'active';
  },
) {
  return db.insert(users).values(data).returning();
}

export function updateUser(
  db: FastifyInstance['db'],
  id: string,
  data: Partial<typeof users.$inferInsert>,
) {
  return db.update(users).set({ ...data, updatedAt: new Date() }).where(eq(users.id, id));
}

// ── Campus Queries ─────────────────────────────────────
export function findCampusByEmailDomain(db: FastifyInstance['db'], _domain: string) {
  // We need to search emailDomains JSONB array for the domain
  // Drizzle doesn't have a native JSONB contains, so we use raw SQL via a broader approach
  return db.select().from(campuses).where(eq(campuses.isActive, true));
}

export function findCampusById(db: FastifyInstance['db'], id: string) {
  return db.select().from(campuses).where(eq(campuses.id, id)).limit(1);
}

// ── Student Profile Queries ────────────────────────────
export function createStudentProfile(
  db: FastifyInstance['db'],
  data: { userId: string; department?: string },
) {
  return db.insert(studentProfiles).values(data).returning();
}

// ── OTP Queries ────────────────────────────────────────
export function createEmailOtp(
  db: FastifyInstance['db'],
  data: {
    email: string;
    otpHash: string;
    purpose: 'registration' | 'password_reset' | 'email_change';
    expiresAt: Date;
  },
) {
  return db.insert(emailOtps).values(data).returning();
}

export function findLatestUnusedOtp(
  db: FastifyInstance['db'],
  email: string,
  purpose: string,
) {
  return db
    .select()
    .from(emailOtps)
    .where(
      and(
        eq(emailOtps.email, email),
        eq(emailOtps.purpose, purpose as 'registration' | 'password_reset' | 'email_change'),
        isNull(emailOtps.usedAt),
      ),
    )
    .orderBy(desc(emailOtps.createdAt))
    .limit(1);
}

export function markOtpUsed(db: FastifyInstance['db'], id: string) {
  return db
    .update(emailOtps)
    .set({ usedAt: new Date() })
    .where(eq(emailOtps.id, id));
}

export function incrementOtpAttempts(db: FastifyInstance['db'], id: string, currentAttempts: number) {
  return db
    .update(emailOtps)
    .set({ attempts: currentAttempts + 1 })
    .where(eq(emailOtps.id, id));
}

export function markAllOtpsUsed(db: FastifyInstance['db'], email: string, purpose: string) {
  return db
    .update(emailOtps)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(emailOtps.email, email),
        eq(emailOtps.purpose, purpose as 'registration' | 'password_reset' | 'email_change'),
        isNull(emailOtps.usedAt),
      ),
    );
}

// ── Session Queries ────────────────────────────────────
export function createSession(
  db: FastifyInstance['db'],
  data: {
    userId: string;
    refreshTokenHash: string;
    deviceFingerprint?: string;
    userAgent?: string;
    ipAddress?: string;
    expiresAt: Date;
  },
) {
  return db.insert(sessions).values(data).returning();
}

export function findSessionByTokenHash(db: FastifyInstance['db'], tokenHash: string) {
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.refreshTokenHash, tokenHash), eq(sessions.isActive, true)))
    .limit(1);
}

export function deactivateSession(db: FastifyInstance['db'], id: string) {
  return db
    .update(sessions)
    .set({ isActive: false })
    .where(eq(sessions.id, id));
}

export function deactivateAllUserSessions(db: FastifyInstance['db'], userId: string) {
  return db
    .update(sessions)
    .set({ isActive: false })
    .where(and(eq(sessions.userId, userId), eq(sessions.isActive, true)));
}

export function deactivateSessionByDeviceFingerprint(
  db: FastifyInstance['db'],
  userId: string,
  deviceFingerprint: string,
) {
  return db
    .update(sessions)
    .set({ isActive: false })
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.deviceFingerprint, deviceFingerprint),
        eq(sessions.isActive, true),
      ),
    );
}
