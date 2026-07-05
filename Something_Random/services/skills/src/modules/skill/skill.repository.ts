/**
 * NEXUS Skills — Skill Repository
 */

import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

export interface SkillListingRecord {
  id: string; provider_id: string; campus_id: string; title: string; description: string;
  category: string; packages: { id: string; name: string; description: string; price: number; deliverable: string; delivery_days: number }[];
  portfolio_urls: string[]; tags: string[]; status: string; total_orders: number;
  avg_rating: string; created_at: Date; updated_at: Date;
}

export interface SkillOrderRecord {
  id: string; listing_id: string; buyer_id: string; provider_id: string;
  transaction_id: string | null; package_snapshot: unknown; requirements: string;
  status: string; milestone_count: number; deadline_at: Date | null;
  delivery_proof_url: string | null; revision_count: number; max_revisions: number;
  created_at: Date; updated_at: Date;
}

export class SkillRepository {
  constructor(private readonly fastify: FastifyInstance) {}
  private get db() { return this.fastify.db; }

  async createListing(data: Partial<SkillListingRecord>): Promise<SkillListingRecord> {
    const r = await this.db.execute(sql`
      INSERT INTO skill_listings (provider_id, campus_id, title, description, category, packages, portfolio_urls, tags)
      VALUES (${data.provider_id}, ${data.campus_id}, ${data.title}, ${data.description}, ${data.category},
              ${JSON.stringify(data.packages)}::jsonb, ${JSON.stringify(data.portfolio_urls ?? [])}::jsonb, ${`{${(data.tags ?? []).join(',')}}`})
      RETURNING *
    `);
    return (r as any)[0] as unknown as SkillListingRecord;
  }

  async findListingById(id: string): Promise<SkillListingRecord | null> {
    const r = await this.db.execute(sql`SELECT * FROM skill_listings WHERE id = ${id}`);
    return ((r as any)[0] as unknown as SkillListingRecord) ?? null;
  }

  async findListingsByCampus(campusId: string, limit = 20): Promise<SkillListingRecord[]> {
    const r = await this.db.execute(sql`SELECT * FROM skill_listings WHERE campus_id = ${campusId} AND status = 'active' ORDER BY total_orders DESC LIMIT ${limit}`);
    return (r as any) as unknown as SkillListingRecord[];
  }

  async findListingsByProvider(providerId: string): Promise<SkillListingRecord[]> {
    const r = await this.db.execute(sql`SELECT * FROM skill_listings WHERE provider_id = ${providerId} ORDER BY created_at DESC`);
    return (r as any) as unknown as SkillListingRecord[];
  }

  async updateListing(id: string, data: Partial<SkillListingRecord>): Promise<SkillListingRecord | null> {
    const sets: string[] = ['updated_at = now()'];
    if (data.title) sets.push(`title = '${data.title}'`);
    if (data.description) sets.push(`description = '${data.description}'`);
    if (data.packages) sets.push(`packages = '${JSON.stringify(data.packages)}'::jsonb`);
    if (data.status) sets.push(`status = '${data.status}'`);
    const r = await this.db.execute(sql.raw(`UPDATE skill_listings SET ${sets.join(', ')} WHERE id = '${id}' RETURNING *`));
    return ((r as any)[0] as unknown as SkillListingRecord) ?? null;
  }

  async incrementTotalOrders(id: string): Promise<void> {
    await this.db.execute(sql`UPDATE skill_listings SET total_orders = total_orders + 1 WHERE id = ${id}`);
  }

  // ━━━ Orders ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async createOrder(data: Partial<SkillOrderRecord>): Promise<SkillOrderRecord> {
    const r = await this.db.execute(sql`
      INSERT INTO skill_orders (listing_id, buyer_id, provider_id, transaction_id, package_snapshot, requirements, deadline_at)
      VALUES (${data.listing_id}, ${data.buyer_id}, ${data.provider_id}, ${data.transaction_id ?? null},
              ${JSON.stringify(data.package_snapshot)}::jsonb, ${data.requirements}, ${data.deadline_at ?? null})
      RETURNING *
    `);
    return (r as any)[0] as unknown as SkillOrderRecord;
  }

  async findOrderById(id: string): Promise<SkillOrderRecord | null> {
    const r = await this.db.execute(sql`SELECT * FROM skill_orders WHERE id = ${id}`);
    return ((r as any)[0] as unknown as SkillOrderRecord) ?? null;
  }

  async findOrdersByBuyer(buyerId: string): Promise<SkillOrderRecord[]> {
    const r = await this.db.execute(sql`SELECT * FROM skill_orders WHERE buyer_id = ${buyerId} ORDER BY created_at DESC`);
    return (r as any) as unknown as SkillOrderRecord[];
  }

  async findOrdersByProvider(providerId: string): Promise<SkillOrderRecord[]> {
    const r = await this.db.execute(sql`SELECT * FROM skill_orders WHERE provider_id = ${providerId} ORDER BY created_at DESC`);
    return (r as any) as unknown as SkillOrderRecord[];
  }

  async updateOrder(id: string, data: Partial<SkillOrderRecord>): Promise<void> {
    const sets: string[] = ['updated_at = now()'];
    if (data.status) sets.push(`status = '${data.status}'`);
    if (data.delivery_proof_url) sets.push(`delivery_proof_url = '${data.delivery_proof_url}'`);
    if (data.revision_count !== undefined) sets.push(`revision_count = ${data.revision_count}`);
    if (data.transaction_id) sets.push(`transaction_id = '${data.transaction_id}'`);
    await this.db.execute(sql.raw(`UPDATE skill_orders SET ${sets.join(', ')} WHERE id = '${id}'`));
  }

  async findPendingAutoRelease(): Promise<SkillOrderRecord[]> {
    const r = await this.db.execute(sql`
      SELECT * FROM skill_orders WHERE status = 'pending_review' AND updated_at < NOW() - INTERVAL '72 hours'
    `);
    return (r as any) as unknown as SkillOrderRecord[];
  }

  // ━━━ Milestones ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async createMilestone(orderId: string, title: string, description?: string, dueAt?: Date): Promise<void> {
    await this.db.execute(sql`INSERT INTO skill_milestones (order_id, title, description, due_at) VALUES (${orderId}, ${title}, ${description ?? null}, ${dueAt ?? null})`);
  }

  // ━━━ Ratings ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async createRating(orderId: string, raterId: string, providerId: string, score: number, reviewText?: string): Promise<void> {
    await this.db.execute(sql`INSERT INTO skill_ratings (order_id, rater_id, provider_id, score, review_text) VALUES (${orderId}, ${raterId}, ${providerId}, ${score}, ${reviewText ?? null})`);
  }
}
