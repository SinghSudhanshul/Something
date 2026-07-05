/**
 * @nexus/database — Seed Script
 *
 * Seeds the database with initial data:
 * - SRM KTR campus
 * - 5 test users
 * - 10 sample listings
 *
 * Usage: pnpm db:seed
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { campuses, users, studentProfiles, listings, wallets } from './schema.js';

async function seed(): Promise<void> {
  const connectionString =
    process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus_dev_secret@localhost:5432/nexus_dev';

  const sql = postgres(connectionString, { max: 1 });
  const db = drizzle(sql);

  console.info('Seeding database...');

  // ── Campus: SRM KTR ─────────────────────────────
  const [srmCampus] = await db
    .insert(campuses)
    .values({
      name: 'SRM Institute of Science and Technology - Kattankulathur',
      code: 'SRM_KTR',
      emailDomains: ['srmist.edu.in'],
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      features: {
        bazaar: true,
        feast: true,
        rides: true,
        swift: true,
        skills: true,
        pulse: true,
      },
      isActive: true,
    })
    .returning();

  if (srmCampus === undefined) {
    throw new Error('Failed to create SRM campus');
  }

  console.info(`  ✓ Campus created: ${srmCampus.name}`);

  // ── 5 Test Users ─────────────────────────────────
  const testUsers = await db
    .insert(users)
    .values([
      {
        email: 'arjun.kumar@srmist.edu.in',
        passwordHash: '$2b$12$placeholder.hash.arjun.kumar.nexus.dev',
        name: 'Arjun Kumar',
        username: 'arjun_kumar',
        role: 'student',
        campusId: srmCampus.id,
        verificationLevel: '2',
        trustTier: 'trusted',
        trustScore: 85,
      },
      {
        email: 'priya.sharma@srmist.edu.in',
        passwordHash: '$2b$12$placeholder.hash.priya.sharma.nexus.dev',
        name: 'Priya Sharma',
        username: 'priya_sharma',
        role: 'student',
        campusId: srmCampus.id,
        verificationLevel: '2',
        trustTier: 'verified',
        trustScore: 92,
      },
      {
        email: 'rahul.patel@srmist.edu.in',
        passwordHash: '$2b$12$placeholder.hash.rahul.patel.nexus.dev',
        name: 'Rahul Patel',
        username: 'rahul_patel',
        role: 'student',
        campusId: srmCampus.id,
        verificationLevel: '1',
        trustTier: 'building',
        trustScore: 45,
      },
      {
        email: 'vendor.canteen@srmist.edu.in',
        passwordHash: '$2b$12$placeholder.hash.vendor.canteen.nexus.dev',
        name: 'SRM Main Canteen',
        username: 'srm_canteen',
        role: 'vendor',
        campusId: srmCampus.id,
        verificationLevel: '3',
        trustTier: 'elite',
        trustScore: 98,
      },
      {
        email: 'admin@srmist.edu.in',
        passwordHash: '$2b$12$placeholder.hash.admin.nexus.dev',
        name: 'Campus Admin',
        username: 'campus_admin',
        role: 'campus_admin',
        campusId: srmCampus.id,
        verificationLevel: '4',
        trustTier: 'elite',
        trustScore: 100,
      },
    ])
    .returning();

  console.info(`  ✓ ${testUsers.length} test users created`);

  // ── Student Profiles ─────────────────────────────
  const studentUsers = testUsers.filter((u) => u.role === 'student');
  const departments = ['Computer Science', 'Electronics', 'Mechanical'];
  const blocks = ['A', 'B', 'C'];

  for (let i = 0; i < studentUsers.length; i++) {
    const user = studentUsers[i];
    if (user !== undefined) {
      const dept = departments[i % departments.length];
      const block = blocks[i % blocks.length];
      await db.insert(studentProfiles).values({
        userId: user.id,
        registrationNumber: `RA210500${String(i + 1).padStart(4, '0')}`,
        department: dept ?? null,
        yearOfStudy: (i % 4) + 1,
        section: String.fromCharCode(65 + (i % 3)),
        hostelBlock: block ?? null,
        roomNumber: `${(i + 1) * 100 + (i + 1)}`,
        bio: `Test student at SRM KTR - ${dept}`,
        interests: ['technology', 'sports', 'music'].slice(0, i + 1),
      });
    }
  }

  console.info(`  ✓ Student profiles created`);

  // ── Wallets for all users ────────────────────────
  for (const user of testUsers) {
    await db.insert(wallets).values({
      userId: user.id,
      balanceInPaise: Math.floor(Math.random() * 500000),
      heldInPaise: 0,
      currency: 'INR',
    });
  }

  console.info(`  ✓ Wallets created`);

  // ── 10 Sample Listings ───────────────────────────
  const arjun = testUsers[0];
  const priya = testUsers[1];
  const rahul = testUsers[2];

  if (arjun === undefined || priya === undefined || rahul === undefined) {
    throw new Error('Test users not found');
  }

  const sampleListings = [
    {
      sellerId: arjun.id,
      campusId: srmCampus.id,
      title: 'Engineering Mathematics Textbook - Kreyszig 10th Ed',
      description: 'Advanced Engineering Mathematics by Erwin Kreyszig. Barely used, all pages intact. Highlighted a few chapters.',
      category: 'books',
      condition: 'good',
      priceInPaise: 35000,
      status: 'active' as const,
    },
    {
      sellerId: arjun.id,
      campusId: srmCampus.id,
      title: 'HP Scientific Calculator fx-991ES Plus',
      description: 'Used for one semester. Works perfectly. Comes with original case.',
      category: 'electronics',
      condition: 'like_new',
      priceInPaise: 80000,
      status: 'active' as const,
    },
    {
      sellerId: priya.id,
      campusId: srmCampus.id,
      title: 'Study Table with Bookshelf',
      description: 'Foldable study table with integrated bookshelf. Perfect for hostel rooms.',
      category: 'furniture',
      condition: 'good',
      priceInPaise: 150000,
      status: 'active' as const,
    },
    {
      sellerId: priya.id,
      campusId: srmCampus.id,
      title: 'Data Structures & Algorithms Notes — Complete Set',
      description: 'Handwritten notes covering all DSA topics. Got 9.5 CGPA with these.',
      category: 'books',
      condition: 'good',
      priceInPaise: 20000,
      status: 'active' as const,
    },
    {
      sellerId: rahul.id,
      campusId: srmCampus.id,
      title: 'JBL Tune 510BT Wireless Headphones',
      description: 'Black color. 6 months old. Battery life is still excellent.',
      category: 'electronics',
      condition: 'good',
      priceInPaise: 180000,
      status: 'active' as const,
    },
    {
      sellerId: rahul.id,
      campusId: srmCampus.id,
      title: 'Cricket Kit — Bat, Pads, Gloves',
      description: 'SG cricket kit. Used for college team practice. In great condition.',
      category: 'sports',
      condition: 'fair',
      priceInPaise: 250000,
      status: 'active' as const,
    },
    {
      sellerId: arjun.id,
      campusId: srmCampus.id,
      title: 'Arduino Uno R3 Starter Kit',
      description: 'Complete Arduino starter kit with breadboard, sensors, LEDs, and wires.',
      category: 'electronics',
      condition: 'like_new',
      priceInPaise: 120000,
      status: 'active' as const,
    },
    {
      sellerId: priya.id,
      campusId: srmCampus.id,
      title: 'Lab Coat — White, Medium Size',
      description: 'Chemistry lab coat. Worn twice. Clean and pressed.',
      category: 'clothing',
      condition: 'like_new',
      priceInPaise: 15000,
      status: 'active' as const,
    },
    {
      sellerId: rahul.id,
      campusId: srmCampus.id,
      title: 'Desk Lamp with USB Charging Port',
      description: 'LED desk lamp with adjustable brightness. USB-C charging port built in.',
      category: 'electronics',
      condition: 'new',
      priceInPaise: 95000,
      status: 'active' as const,
    },
    {
      sellerId: arjun.id,
      campusId: srmCampus.id,
      title: 'Python Programming Crash Course — Eric Matthes',
      description: 'Great for beginners. All exercises completed in pencil (erasable).',
      category: 'books',
      condition: 'good',
      priceInPaise: 25000,
      status: 'active' as const,
    },
  ];

  await db.insert(listings).values(sampleListings);
  console.info(`  ✓ 10 sample listings created`);

  console.info('\nSeed complete!');
  await sql.end();
  process.exit(0);
}

seed().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
