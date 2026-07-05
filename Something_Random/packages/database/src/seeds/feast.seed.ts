/**
 * NEXUS Feast — Database Seeder
 *
 * Populates realistic canteens and menu items.
 */

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';

export async function seedFeast(db: ReturnType<typeof drizzle>) {
  console.log('Seeding Feast canteens and menus...');

  const campuses = await db.execute(sql`SELECT id FROM campuses LIMIT 1`);
  if (campuses.length === 0) return;
  const campusId = (campuses[0] as any).id;

  const usersResult = await db.execute(sql`SELECT id FROM users LIMIT 2`);
  if (usersResult.length < 1) return;
  const vendorId = (usersResult[0] as any).id;

  const existing = await db.execute(sql`SELECT count(*) FROM canteens`);
  if (Number((existing[0] as any).count) > 0) {
    console.log('Canteens already exist. Skipping seed.');
    return;
  }

  // Insert Main Canteen
  const canteen1Result = await db.execute(sql`
    INSERT INTO canteens (campus_id, name, description, location_label, operating_hours, avg_prep_time_minutes, owner_user_id, fssai_license_no, fssai_verified, is_active)
    VALUES (
      ${campusId}, 'University Main Canteen', 'The central hub for all meals and snacks.', 'Tech Park Ground Floor',
      '{"mon": {"open": "08:00", "close": "20:00"}, "tue": {"open": "08:00", "close": "20:00"}, "wed": {"open": "08:00", "close": "20:00"}, "thu": {"open": "08:00", "close": "20:00"}, "fri": {"open": "08:00", "close": "20:00"}, "sat": {"open": "09:00", "close": "18:00"}, "sun": {"open": "09:00", "close": "15:00"}}'::jsonb,
      15, ${vendorId}, '12421000000001', true, true
    )
    RETURNING id
  `);
  const canteen1Id = (canteen1Result[0] as any).id;

  // Insert Night Canteen
  const canteen2Result = await db.execute(sql`
    INSERT INTO canteens (campus_id, name, description, location_label, operating_hours, avg_prep_time_minutes, owner_user_id, fssai_license_no, fssai_verified, is_active)
    VALUES (
      ${campusId}, 'Hostel Night Canteen', 'Late night cravings sorted.', 'Block M',
      '{"mon": {"open": "21:00", "close": "03:00"}, "tue": {"open": "21:00", "close": "03:00"}, "wed": {"open": "21:00", "close": "03:00"}, "thu": {"open": "21:00", "close": "03:00"}, "fri": {"open": "21:00", "close": "03:00"}, "sat": {"open": "21:00", "close": "04:00"}, "sun": {"open": "21:00", "close": "02:00"}}'::jsonb,
      10, ${vendorId}, '12421000000002', true, true
    )
    RETURNING id
  `);
  const canteen2Id = (canteen2Result[0] as any).id;

  const menuItems = [
    { canteen: canteen1Id, name: 'Masala Dosa', cat: 'breakfast', price: 50, veg: true, avail: true, prep: 5 },
    { canteen: canteen1Id, name: 'Veg Meals', cat: 'lunch', price: 80, veg: true, avail: true, prep: 2 },
    { canteen: canteen1Id, name: 'Chicken Biryani', cat: 'lunch', price: 120, veg: false, avail: true, prep: 2 },
    { canteen: canteen1Id, name: 'Filter Coffee', cat: 'beverages', price: 15, veg: true, avail: true, prep: 2 },
    { canteen: canteen1Id, name: 'Samosa (2 pcs)', cat: 'snacks', price: 30, veg: true, avail: true, prep: 2 },
    { canteen: canteen1Id, name: 'Paneer Butter Masala Combo', cat: 'combos', price: 110, veg: true, avail: false, prep: 10 },

    { canteen: canteen2Id, name: 'Maggi Noodles', cat: 'snacks', price: 40, veg: true, avail: true, prep: 5 },
    { canteen: canteen2Id, name: 'Egg Fried Rice', cat: 'dinner', price: 70, veg: false, avail: true, prep: 8 },
    { canteen: canteen2Id, name: 'Cold Coffee', cat: 'beverages', price: 50, veg: true, avail: true, prep: 4 },
    { canteen: canteen2Id, name: 'Cheese Sandwich', cat: 'snacks', price: 45, veg: true, avail: true, prep: 5 },
  ];

  for (const item of menuItems) {
    await db.execute(sql`
      INSERT INTO menu_items (canteen_id, name, category, price, is_veg, is_available, prep_time_minutes)
      VALUES (${item.canteen}, ${item.name}, ${item.cat}, ${item.price}, ${item.veg}, ${item.avail}, ${item.prep})
    `);
  }

  console.log(`Inserted 2 canteens and ${menuItems.length} menu items.`);
}
