/**
 * NEXUS Swift — QuickGigs Repository
 */

import { and, asc, count, desc, eq, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import * as schema from '@nexus/database/schema';
import { config } from '../../config.js';

export type GigRecord = typeof schema.gigs.$inferSelect;
export type GigApplicationRecord = typeof schema.gigApplications.$inferSelect;
export type GigMilestoneRecord = typeof schema.gigMilestones.$inferSelect;
export type GigBookmarkRecord = typeof schema.gigBookmarks.$inferSelect;

export class GigRepository {
  constructor(private readonly fastify: FastifyInstance) {}

  private get db() {
    return this.fastify.db;
  }

  async create(data: typeof schema.gigs.$inferInsert, milestones?: Array<{ title: string; description?: string; amountInPaise: number; dueDate?: Date; orderIndex: number }>): Promise<GigRecord> {
    return this.db.transaction(async (tx) => {
      const [gig] = await tx.insert(schema.gigs).values(data).returning();
      if (milestones && milestones.length > 0) {
        await tx.insert(schema.gigMilestones).values(
          milestones.map((m) => ({
            gigId: gig!.id,
            title: m.title,
            amountInPaise: m.amountInPaise,
            orderIndex: m.orderIndex,
            ...(m.description !== undefined && { description: m.description }),
            ...(m.dueDate !== undefined && { dueDate: m.dueDate }),
          })),
        );
      }
      return gig!;
    });
  }

  async findById(id: string): Promise<GigRecord | null> {
    const [gig] = await this.db.select().from(schema.gigs).where(eq(schema.gigs.id, id)).limit(1);
    return gig ?? null;
  }

  async findByIdWithDetails(id: string): Promise<{ gig: GigRecord; milestones: GigMilestoneRecord[] } | null> {
    const gig = await this.findById(id);
    if (!gig) return null;
    const milestones = await this.db
      .select()
      .from(schema.gigMilestones)
      .where(eq(schema.gigMilestones.gigId, id))
      .orderBy(asc(schema.gigMilestones.orderIndex));
    return { gig, milestones };
  }

  async findMany(
    filters: {
      campusId?: string;
      category?: string;
      skills?: string[];
      minBudget?: number;
      maxBudget?: number;
      status?: string;
      q?: string;
    },
    pagination: { cursor?: string; limit: number; sort: string },
  ): Promise<{ items: GigRecord[]; total: number }> {
    const conditions = [];
    if (filters.campusId) conditions.push(eq(schema.gigs.campusId, filters.campusId));
    if (filters.category) conditions.push(eq(schema.gigs.category, filters.category));
    if (filters.status) conditions.push(eq(schema.gigs.status, filters.status as any));
    if (filters.minBudget !== undefined) conditions.push(sql`${schema.gigs.budgetInPaise} >= ${filters.minBudget}`);
    if (filters.maxBudget !== undefined) conditions.push(sql`${schema.gigs.budgetInPaise} <= ${filters.maxBudget}`);
    if (filters.q) {
      conditions.push(
        or(
          ilike(schema.gigs.title, `%${filters.q}%`),
          ilike(schema.gigs.description, `%${filters.q}%`),
        )!,
      );
    }
    if (filters.skills && filters.skills.length > 0) {
      // skills stored as JSONB; use overlap operator
      conditions.push(
        sql`${schema.gigs.skillsRequired} && ${JSON.stringify(filters.skills)}::jsonb`,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const sortMap: Record<string, any> = {
      created_at: desc(schema.gigs.createdAt),
      budget_desc: desc(schema.gigs.budgetInPaise),
      budget_asc: asc(schema.gigs.budgetInPaise),
      deadline: asc(schema.gigs.expiresAt),
    };
    const orderBy = sortMap[pagination.sort] ?? sortMap.created_at;

    const [items, totalResult] = await Promise.all([
      this.db
        .select()
        .from(schema.gigs)
        .where(whereClause!)
        .orderBy(orderBy)
        .limit(pagination.limit)
        .offset(pagination.cursor ? parseInt(pagination.cursor, 10) : 0),
      this.db.select({ count: count() }).from(schema.gigs).where(whereClause!),
    ]);

    return { items, total: Number(totalResult[0]?.count ?? 0) };
  }

  async findByPoster(posterId: string, status?: string): Promise<GigRecord[]> {
    const conditions = [eq(schema.gigs.posterId, posterId)];
    if (status) conditions.push(eq(schema.gigs.status, status as any));
    return this.db
      .select()
      .from(schema.gigs)
      .where(and(...conditions))
      .orderBy(desc(schema.gigs.createdAt));
  }

  async findByApplicant(applicantId: string): Promise<GigApplicationRecord[]> {
    return this.db
      .select()
      .from(schema.gigApplications)
      .where(eq(schema.gigApplications.applicantId, applicantId))
      .orderBy(desc(schema.gigApplications.createdAt));
  }

  async findApplicationsByGig(gigId: string): Promise<GigApplicationRecord[]> {
    return this.db
      .select()
      .from(schema.gigApplications)
      .where(eq(schema.gigApplications.gigId, gigId))
      .orderBy(desc(schema.gigApplications.createdAt));
  }

  async findApplicationById(id: string): Promise<GigApplicationRecord | null> {
    const [app] = await this.db
      .select()
      .from(schema.gigApplications)
      .where(eq(schema.gigApplications.id, id))
      .limit(1);
    return app ?? null;
  }

  async findApplicationByGigAndApplicant(gigId: string, applicantId: string): Promise<GigApplicationRecord | null> {
    const [app] = await this.db
      .select()
      .from(schema.gigApplications)
      .where(
        and(
          eq(schema.gigApplications.gigId, gigId),
          eq(schema.gigApplications.applicantId, applicantId),
        ),
      )
      .limit(1);
    return app ?? null;
  }

  async createApplication(data: typeof schema.gigApplications.$inferInsert): Promise<GigApplicationRecord> {
    return this.db.transaction(async (tx) => {
      const [app] = await tx.insert(schema.gigApplications).values(data).returning();
      // increment applicant count
      await tx
        .update(schema.gigs)
        .set({ applicantCount: sql`${schema.gigs.applicantCount} + 1` })
        .where(eq(schema.gigs.id, data.gigId!));
      return app!;
    });
  }

  async updateApplicationStatus(id: string, status: 'pending' | 'accepted' | 'rejected' | 'withdrawn'): Promise<void> {
    await this.db
      .update(schema.gigApplications)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.gigApplications.id, id));
  }

  async rejectAllPendingApplications(gigId: string, exceptApplicationId?: string): Promise<void> {
    const conditions = [
      eq(schema.gigApplications.gigId, gigId),
      eq(schema.gigApplications.status, 'pending'),
    ];
    if (exceptApplicationId) {
      conditions.push(sql`${schema.gigApplications.id} != ${exceptApplicationId}`);
    }
    await this.db
      .update(schema.gigApplications)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(and(...conditions));
  }

  async update(id: string, data: Partial<typeof schema.gigs.$inferInsert>): Promise<GigRecord | null> {
    const [gig] = await this.db
      .update(schema.gigs)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.gigs.id, id))
      .returning();
    return gig ?? null;
  }

  async findBookmarksByUser(userId: string, limit = 20, cursor?: string): Promise<GigRecord[]> {
    const bookmarks = await this.db
      .select({ gig: schema.gigs })
      .from(schema.gigBookmarks)
      .innerJoin(schema.gigs, eq(schema.gigs.id, schema.gigBookmarks.gigId))
      .where(eq(schema.gigBookmarks.userId, userId))
      .orderBy(desc(schema.gigBookmarks.createdAt))
      .limit(limit)
      .offset(cursor ? parseInt(cursor, 10) : 0);
    return bookmarks.map((b) => b.gig);
  }

  async isBookmarked(gigId: string, userId: string): Promise<boolean> {
    const [bm] = await this.db
      .select()
      .from(schema.gigBookmarks)
      .where(
        and(eq(schema.gigBookmarks.gigId, gigId), eq(schema.gigBookmarks.userId, userId)),
      )
      .limit(1);
    return !!bm;
  }

  async addBookmark(gigId: string, userId: string): Promise<void> {
    await this.db
      .insert(schema.gigBookmarks)
      .values({ gigId, userId })
      .onConflictDoNothing();
  }

  async removeBookmark(gigId: string, userId: string): Promise<void> {
    await this.db
      .delete(schema.gigBookmarks)
      .where(
        and(eq(schema.gigBookmarks.gigId, gigId), eq(schema.gigBookmarks.userId, userId)),
      );
  }

  async findExpiredOpenGigs(): Promise<GigRecord[]> {
    const now = new Date();
    return this.db
      .select()
      .from(schema.gigs)
      .where(
        and(
          eq(schema.gigs.status, 'open'),
          lt(schema.gigs.expiresAt, now),
        ),
      );
  }

  async findOpenGigsForUser(campusId: string, skills: string[], limit = 20): Promise<GigRecord[]> {
    if (skills.length === 0) {
      return this.db
        .select()
        .from(schema.gigs)
        .where(
          and(eq(schema.gigs.campusId, campusId), eq(schema.gigs.status, 'open')),
        )
        .orderBy(desc(schema.gigs.createdAt))
        .limit(limit);
    }
    return this.db
      .select()
      .from(schema.gigs)
      .where(
        and(
          eq(schema.gigs.campusId, campusId),
          eq(schema.gigs.status, 'open'),
          sql`${schema.gigs.skillsRequired} && ${JSON.stringify(skills)}::jsonb`,
        ),
      )
      .orderBy(desc(schema.gigs.createdAt))
      .limit(limit);
  }
}
