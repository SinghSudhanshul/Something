import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../../plugins/db.js';
import { verificationAttempts, users, studentProfiles, phoneOtps } from '@nexus/database';

export class VerificationRepository {
  async createAttempt(data: {
    userId: string;
    type: string;
    documentS3Key?: string;
  }) {
    const [attempt] = await db
      .insert(verificationAttempts)
      .values({
        userId: data.userId,
        type: data.type,
        documentS3Key: data.documentS3Key ?? null,
        status: 'pending',
      })
      .returning();
    return attempt;
  }

  async getAttemptCountLast24Hours(userId: string): Promise<number> {
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(verificationAttempts)
      .where(
        and(
          eq(verificationAttempts.userId, userId),
          sql`${verificationAttempts.createdAt} >= ${twentyFourHoursAgo}`
        )
      );
    return result[0]?.count || 0;
  }

  async updateAttempt(
    id: string,
    data: {
      status: 'approved' | 'rejected' | 'manual_review';
      extractedData?: any;
      confidenceScore?: number;
      rejectionReason?: string;
    }
  ) {
    const [updated] = await db
      .update(verificationAttempts)
      .set({
        status: data.status,
        extractedData: data.extractedData,
        confidenceScore: data.confidenceScore ? String(data.confidenceScore) : null,
        rejectionReason: data.rejectionReason ?? null,
      })
      .where(eq(verificationAttempts.id, id))
      .returning();
    return updated;
  }

  async upgradeUserVerificationLevel(userId: string, level: '1' | '2' | '3' | '4', srmStudentId?: string) {
    const updateData: Record<string, string> = { verificationLevel: level };
    if (srmStudentId) {
      updateData.srmStudentId = srmStudentId;
    }

    await db
      .update(studentProfiles)
      .set(updateData)
      .where(eq(studentProfiles.userId, userId));
  }

  async createPhoneOtp(phone: string, hash: string, expiresAt: Date) {
    const [otp] = await db
      .insert(phoneOtps)
      .values({
        phone,
        otpHash: hash,
        purpose: 'phone_verification',
        expiresAt,
      })
      .returning();
    return otp;
  }

  async getLatestPhoneOtp(phone: string) {
    const [otp] = await db
      .select()
      .from(phoneOtps)
      .where(
        and(
          eq(phoneOtps.phone, phone),
          eq(phoneOtps.purpose, 'phone_verification')
        )
      )
      .orderBy(desc(phoneOtps.createdAt))
      .limit(1);
    return otp || null;
  }

  async markPhoneOtpUsed(id: string) {
    await db.update(phoneOtps).set({ usedAt: new Date() }).where(eq(phoneOtps.id, id));
  }

  async verifyUserPhone(userId: string, phone: string) {
    await db
      .update(users)
      .set({ phone, phoneVerified: true })
      .where(eq(users.id, userId));
  }

  async getUserVerificationStatus(userId: string) {
    const [user] = await db
      .select({
        isEmailVerified: users.emailVerified,
        isPhoneVerified: users.phoneVerified,
      })
      .from(users)
      .where(eq(users.id, userId));

    const [profile] = await db
      .select({ verificationLevel: studentProfiles.verificationLevel })
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, userId));

    const attempts = await db
      .select({
        type: verificationAttempts.type,
        status: verificationAttempts.status,
        createdAt: verificationAttempts.createdAt,
      })
      .from(verificationAttempts)
      .where(eq(verificationAttempts.userId, userId))
      .orderBy(desc(verificationAttempts.createdAt));

    return { user, profile, attempts };
  }
}
