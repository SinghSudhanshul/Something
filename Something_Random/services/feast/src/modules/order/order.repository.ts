/**
 * NEXUS Feast — Order Repository
 */

import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

export interface FeastOrderRecord {
  id: string; buyer_id: string; canteen_id: string; transaction_id: string | null;
  items: unknown; subtotal: string; platform_fee: string; total: string;
  delivery_type: string; delivery_location: string | null;
  special_instructions: string | null; status: string;
  estimated_ready_at: Date | null; created_at: Date; updated_at: Date;
}

export class OrderRepository {
  constructor(private readonly fastify: FastifyInstance) {}
  private get db() { return this.fastify.db; }

  async create(data: Partial<FeastOrderRecord>): Promise<FeastOrderRecord> {
    const r = await this.db.execute(sql`
      INSERT INTO feast_orders (buyer_id, canteen_id, transaction_id, items, subtotal, platform_fee, total, delivery_type, delivery_location, special_instructions, status, estimated_ready_at)
      VALUES (${data.buyer_id}, ${data.canteen_id}, ${data.transaction_id ?? null},
              ${JSON.stringify(data.items)}::jsonb, ${data.subtotal}, ${data.platform_fee}, ${data.total},
              ${data.delivery_type ?? 'pickup'}, ${data.delivery_location ?? null},
              ${data.special_instructions ?? null}, ${data.status ?? 'pending_payment'},
              ${data.estimated_ready_at ?? null})
      RETURNING *
    `);
    return ((r as any)[0] as unknown) as FeastOrderRecord;
  }

  async findById(id: string): Promise<FeastOrderRecord | null> {
    const r = await this.db.execute(sql`SELECT * FROM feast_orders WHERE id = ${id}`);
    return (((r as any)[0] as unknown) as FeastOrderRecord) ?? null;
  }

  async findByBuyer(buyerId: string, limit: number, offset = 0): Promise<FeastOrderRecord[]> {
    const r = await this.db.execute(sql`SELECT * FROM feast_orders WHERE buyer_id = ${buyerId} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`);
    return (r as any) as unknown as FeastOrderRecord[];
  }

  async findByCanteen(canteenId: string, statuses: string[], limit: number): Promise<FeastOrderRecord[]> {
    if (statuses.length === 0) return [];
    const statusList = sql.join(statuses.map(s => sql`${s}`), sql`, `);
    const r = await this.db.execute(sql`SELECT * FROM feast_orders WHERE canteen_id = ${canteenId} AND status IN (${statusList}) ORDER BY created_at DESC LIMIT ${limit}`);
    return (r as any) as unknown as FeastOrderRecord[];
  }

  async updateStatus(id: string, status: string, estimatedReadyAt?: Date): Promise<void> {
    if (estimatedReadyAt) {
      await this.db.execute(sql`UPDATE feast_orders SET status = ${status}, estimated_ready_at = ${estimatedReadyAt}, updated_at = now() WHERE id = ${id}`);
    } else {
      await this.db.execute(sql`UPDATE feast_orders SET status = ${status}, updated_at = now() WHERE id = ${id}`);
    }
  }

  async setTransactionId(id: string, transactionId: string): Promise<void> {
    await this.db.execute(sql`UPDATE feast_orders SET transaction_id = ${transactionId} WHERE id = ${id}`);
  }

  async countActiveByCanteen(canteenId: string): Promise<number> {
    const r = await this.db.execute(sql`
      SELECT COUNT(*) as count FROM feast_orders
      WHERE canteen_id = ${canteenId} AND status IN ('payment_held', 'preparing', 'ready')
    `);
    return Number(((r as any)[0] as Record<string, unknown>).count);
  }

  // ━━━ Order Items ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async createOrderItems(orderId: string, items: { menu_item_id: string; quantity: number; unit_price: number; customizations: unknown; item_total: number }[]): Promise<void> {
    for (const item of items) {
      await this.db.execute(sql`
        INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, customizations, item_total)
        VALUES (${orderId}, ${item.menu_item_id}, ${item.quantity}, ${item.unit_price},
                ${JSON.stringify(item.customizations)}::jsonb, ${item.item_total})
      `);
    }
  }

  // ━━━ Ratings ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async createRating(orderId: string, raterId: string, canteenId: string, score: number, reviewText?: string): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO canteen_ratings (order_id, rater_id, canteen_id, score, review_text)
      VALUES (${orderId}, ${raterId}, ${canteenId}, ${score}, ${reviewText ?? null})
    `);
  }
}
