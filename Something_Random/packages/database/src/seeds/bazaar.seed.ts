/**
 * NEXUS Bazaar — Database Seeder
 *
 * Populates realistic listings for testing and development.
 * Idempotent via ON CONFLICT DO NOTHING (if using unique constraints) or by truncating/checking first.
 */

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export async function seedBazaar(db: ReturnType<typeof drizzle>) {
  console.log('Seeding Bazaar listings...');

  // Get a campus and some users to attach listings to
  const campuses = await db.execute(sql`SELECT id FROM campuses LIMIT 1`);
  if (campuses.length === 0) {
    console.log('No campuses found. Skipping Bazaar seeder.');
    return;
  }
  const campusId = (campuses[0] as any).id;

  const usersResult = await db.execute(sql`SELECT id FROM users LIMIT 5`);
  if (usersResult.length < 2) {
    console.log('Not enough users found. Skipping Bazaar seeder.');
    return;
  }
  const users = usersResult.map((r: any) => r.id as string);

  // Clear existing if we want idempotent runs for dev (optional, but let's just insert if empty)
  const existing = await db.execute(sql`SELECT count(*) FROM bazaar_listings`);
  if (Number((existing[0] as any).count) > 0) {
    console.log('Bazaar listings already exist. Skipping seed.');
    return;
  }

  const listings = [
    { title: 'Casio Scientific Calculator fx-991EX', desc: 'Used for 2 semesters, perfect condition. No scratches on screen.', cat: 'stationery', cond: 'good', price: 650, sellerIdx: 0, status: 'active' },
    { title: 'Engineering Drawing Kit Mini Drafter', desc: 'Complete kit with Omega mini drafter, sheet holder, and clips.', cat: 'stationery', cond: 'like_new', price: 400, sellerIdx: 1, status: 'active' },
    { title: 'Sony WH-1000XM4 Noise Cancelling', desc: 'Great for studying in the hostel. Comes with case and aux cable.', cat: 'electronics', cond: 'good', price: 12500, sellerIdx: 2, status: 'active' },
    { title: 'Hercules Roadeo Cycle', desc: '21 gear cycle, recently serviced. Good for moving around campus.', cat: 'cycles_vehicles', cond: 'fair', price: 3500, sellerIdx: 3, status: 'active' },
    { title: 'Kettle 1.5L Pigeon', desc: 'Hostel essential. Heats water in 2 minutes.', cat: 'appliances', cond: 'rough', price: 300, sellerIdx: 4, status: 'active' },
    { title: 'First Year Engineering Textbooks Bundle', desc: 'Maths, Physics, and Chemistry books for 1st year.', cat: 'books', cond: 'good', price: 800, sellerIdx: 0, status: 'active' },
    { title: 'Logitech MX Master 3S', desc: 'Used for 6 months. Upgraded to a gaming mouse.', cat: 'electronics', cond: 'like_new', price: 5500, sellerIdx: 1, status: 'sold' },
    { title: 'Iron Box Philips', desc: 'Working perfectly. Selling because I am graduating.', cat: 'appliances', cond: 'fair', price: 450, sellerIdx: 2, status: 'expired' },
    { title: 'Arduino Uno Starter Kit', desc: 'Includes breadboard, jumper wires, LEDs, and resistors.', cat: 'lab_equipment', cond: 'like_new', price: 900, sellerIdx: 3, status: 'reserved' },
    { title: 'Yonex Badminton Racket Muscle Power', desc: 'Grip needs replacement, otherwise in great shape.', cat: 'sports_gear', cond: 'rough', price: 600, sellerIdx: 4, status: 'active' },
  ];

  for (const item of listings) {
    await db.execute(sql`
      INSERT INTO bazaar_listings (seller_id, campus_id, title, description, category, condition, price, status)
      VALUES (${users[item.sellerIdx]}, ${campusId}, ${item.title}, ${item.desc}, ${item.cat}, ${item.cond}, ${item.price}, ${item.status})
    `);
  }

  console.log(`Inserted ${listings.length} Bazaar listings.`);
}
