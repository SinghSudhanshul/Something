/**
 * NEXUS Feast — Canteen Repository
 */

import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

export interface CanteenRecord {
  id: string; campus_id: string; name: string; description: string | null;
  location_label: string | null; operating_hours: Record<string, { open: string; close: string }>;
  avg_prep_time_minutes: number; is_active: boolean; image_url: string | null;
  owner_user_id: string; fssai_license_no: string | null; fssai_verified: boolean;
  fssai_expires_at: string | null; created_at: Date;
}

export interface MenuItemRecord {
  id: string; canteen_id: string; name: string; description: string | null;
  category: string | null; price: string; is_available: boolean; is_veg: boolean;
  image_url: string | null; prep_time_minutes: number | null; calories: number | null;
  allergens: string[]; created_at: Date; updated_at: Date;
}

export class CanteenRepository {
  constructor(private readonly fastify: FastifyInstance) {}
  private get db() { return this.fastify.db; }

  async create(data: Partial<CanteenRecord>): Promise<CanteenRecord> {
    const result = await this.db.execute(sql`
      INSERT INTO canteens (campus_id, name, description, location_label, operating_hours, avg_prep_time_minutes, owner_user_id, fssai_license_no, fssai_verified, fssai_expires_at)
      VALUES (${data.campus_id}, ${data.name}, ${data.description ?? null}, ${data.location_label ?? null},
              ${JSON.stringify(data.operating_hours ?? {})}::jsonb, ${data.avg_prep_time_minutes ?? 15},
              ${data.owner_user_id}, ${data.fssai_license_no ?? null}, ${data.fssai_verified ?? false}, ${data.fssai_expires_at ?? null})
      RETURNING *
    `);
    return ((result as any)[0] as unknown) as CanteenRecord;
  }

  async findById(id: string): Promise<CanteenRecord | null> {
    const r = await this.db.execute(sql`SELECT * FROM canteens WHERE id = ${id}`);
    return (((r as any)[0] as unknown) as CanteenRecord) ?? null;
  }

  async findByCampus(campusId: string): Promise<CanteenRecord[]> {
    const r = await this.db.execute(sql`SELECT * FROM canteens WHERE campus_id = ${campusId} AND is_active = true ORDER BY name`);
    return (r as any) as unknown as CanteenRecord[];
  }

  async update(id: string, data: Partial<CanteenRecord>): Promise<CanteenRecord | null> {
    const sets: string[] = [];
    if (data.name) sets.push(`name = '${data.name}'`);
    if (data.description !== undefined) sets.push(`description = '${data.description}'`);
    if (data.is_active !== undefined) sets.push(`is_active = ${data.is_active}`);
    if (sets.length === 0) return this.findById(id);
    const r = await this.db.execute(sql.raw(`UPDATE canteens SET ${sets.join(', ')} WHERE id = '${id}' RETURNING *`));
    return (((r as any)[0] as unknown) as CanteenRecord) ?? null;
  }

  async updateFSSAI(id: string, verified: boolean, expiresAt: string | null): Promise<void> {
    await this.db.execute(sql`UPDATE canteens SET fssai_verified = ${verified}, fssai_expires_at = ${expiresAt} WHERE id = ${id}`);
  }

  async findExpiredFSSAI(daysAhead: number): Promise<CanteenRecord[]> {
    const r = await this.db.execute(sql`
      SELECT * FROM canteens WHERE is_active = true AND fssai_expires_at IS NOT NULL
      AND fssai_expires_at < (NOW() + ${daysAhead + ' days'}::interval)
    `);
    return (r as any) as unknown as CanteenRecord[];
  }

  async suspend(id: string): Promise<void> {
    await this.db.execute(sql`UPDATE canteens SET is_active = false WHERE id = ${id}`);
  }

  // ━━━ Menu Items ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async createMenuItem(data: Partial<MenuItemRecord>): Promise<MenuItemRecord> {
    const r = await this.db.execute(sql`
      INSERT INTO menu_items (canteen_id, name, description, category, price, is_available, is_veg, image_url, prep_time_minutes, calories, allergens)
      VALUES (${data.canteen_id}, ${data.name}, ${data.description ?? null}, ${data.category ?? null},
              ${data.price}, ${data.is_available ?? true}, ${data.is_veg}, ${data.image_url ?? null},
              ${data.prep_time_minutes ?? null}, ${data.calories ?? null}, ${JSON.stringify(data.allergens ?? [])}::jsonb)
      RETURNING *
    `);
    return ((r as any)[0] as unknown) as MenuItemRecord;
  }

  async findMenuByCanteen(canteenId: string, availableOnly = true): Promise<MenuItemRecord[]> {
    const condition = availableOnly ? sql`AND is_available = true` : sql``;
    const r = await this.db.execute(sql`SELECT * FROM menu_items WHERE canteen_id = ${canteenId} ${condition} ORDER BY category, name`);
    return (r as any) as unknown as MenuItemRecord[];
  }

  async findMenuItemById(id: string): Promise<MenuItemRecord | null> {
    const r = await this.db.execute(sql`SELECT * FROM menu_items WHERE id = ${id}`);
    return (((r as any)[0] as unknown) as MenuItemRecord) ?? null;
  }

  async updateMenuItemAvailability(itemId: string, isAvailable: boolean): Promise<void> {
    await this.db.execute(sql`UPDATE menu_items SET is_available = ${isAvailable}, updated_at = now() WHERE id = ${itemId}`);
  }

  async findMenuItemsByIds(ids: string[]): Promise<MenuItemRecord[]> {
    if (ids.length === 0) return [];
    const idList = sql.join(ids.map(id => sql`${id}`), sql`, `);
    const r = await this.db.execute(sql`SELECT * FROM menu_items WHERE id IN (${idList})`);
    return (r as any) as unknown as MenuItemRecord[];
  }
}
