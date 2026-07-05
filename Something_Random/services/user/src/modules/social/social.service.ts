/**
 * Social Service
 *
 * User blocking and reporting functionality.
 */

import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { createLogger } from '@nexus/utils';
import * as schema from '@nexus/database/schema';

const logger = createLogger('social-service');

/**
 * Block a user.
 */
export async function blockUser(
  app: FastifyInstance,
  blockerId: string,
  blockedId: string,
  reason?: string,
): Promise<void> {
  if (blockerId === blockedId) {
    throw Object.assign(new Error('Cannot block yourself'), { statusCode: 400 });
  }

  // Check if already blocked
  const [existing] = await app.db
    .select()
    .from(schema.userBlocks)
    .where(
      and(
        eq(schema.userBlocks.blockerId, blockerId),
        eq(schema.userBlocks.blockedId, blockedId),
      ),
    )
    .limit(1);

  if (existing !== undefined) {
    throw Object.assign(new Error('User already blocked'), { statusCode: 409 });
  }

  await app.db.insert(schema.userBlocks).values({
    blockerId,
    blockedId,
    reason: reason ?? null,
  });

  logger.info({ blockerId, blockedId }, 'User blocked');
}

/**
 * Unblock a user.
 */
export async function unblockUser(
  app: FastifyInstance,
  blockerId: string,
  blockedId: string,
): Promise<void> {
  const result = await app.db
    .delete(schema.userBlocks)
    .where(
      and(
        eq(schema.userBlocks.blockerId, blockerId),
        eq(schema.userBlocks.blockedId, blockedId),
      ),
    );

  logger.info({ blockerId, blockedId }, 'User unblocked');
}

/**
 * Report a user with duplicate check.
 * Same reporter+reported+category within 24h is rejected.
 */
export async function reportUser(
  app: FastifyInstance,
  reporterId: string,
  reportedId: string,
  category: string,
  description?: string,
  referenceId?: string,
  referenceType?: string,
): Promise<{ id: string }> {
  if (reporterId === reportedId) {
    throw Object.assign(new Error('Cannot report yourself'), { statusCode: 400 });
  }

  // Duplicate check: same reporter + reported + category within 24 hours
  const [duplicate] = await app.db
    .select()
    .from(schema.userReports)
    .where(
      and(
        eq(schema.userReports.reporterId, reporterId),
        eq(schema.userReports.reportedId, reportedId),
        eq(schema.userReports.category, category),
        sql`${schema.userReports.createdAt} > NOW() - INTERVAL '24 hours'`,
      ),
    )
    .limit(1);

  if (duplicate !== undefined) {
    throw Object.assign(
      new Error('You have already reported this user for this reason recently'),
      { statusCode: 409 },
    );
  }

  const [report] = await app.db
    .insert(schema.userReports)
    .values({
      reporterId,
      reportedId,
      category,
      ...(description !== undefined && { description }),
      ...(referenceId !== undefined && { referenceId }),
      ...(referenceType !== undefined && { referenceType }),
      status: 'open',
    } as any)
    .returning({ id: schema.userReports.id });

  if (report === undefined) {
    throw new Error('Failed to create report');
  }

  // Publish Kafka event
  if (app.kafka) {
    try {
      await app.kafka.send({
        topic: 'nexus.trust.report.created',
        messages: [
          {
            key: reportedId,
            value: JSON.stringify({
              reportId: report.id,
              reporterId,
              reportedId,
              category,
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      });
    } catch {
      logger.warn('Failed to publish report created event');
    }
  }

  logger.info({ reportId: report.id, reporterId, reportedId, category }, 'User reported');

  return { id: report.id };
}

/**
 * Get blocked user IDs for a user.
 */
export async function getBlockedUsers(
  app: FastifyInstance,
  userId: string,
): Promise<string[]> {
  const blocks = await app.db
    .select({ blockedId: schema.userBlocks.blockedId })
    .from(schema.userBlocks)
    .where(eq(schema.userBlocks.blockerId, userId));

  return blocks.map((b: { blockedId: string }) => b.blockedId);
}
