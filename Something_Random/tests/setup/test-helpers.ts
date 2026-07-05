import jwt from 'jsonwebtoken';
import { sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/postgres-js';

export async function createTestUser(db: ReturnType<typeof drizzle>, overrides: {
  role?: string;
  campusId?: string;
  verificationLevel?: '0' | '1' | '2' | '3';
  trustScore?: number;
} = {}) {
  const campusId = overrides.campusId ?? (await ensureTestCampus(db));
  
  const userResult = await db.execute(sql`
    INSERT INTO users (email, phone, role, is_active, email_verified, campus_id)
    VALUES (
      ${'test' + Date.now() + '@example.com'},
      ${'+9198' + Math.floor(10000000 + Math.random() * 90000000)},
      ${overrides.role ?? 'student'},
      true, true, ${campusId}
    )
    RETURNING id
  `);
  
  const userId = userResult.rows[0].id as string;

  await db.execute(sql`
    INSERT INTO student_profiles (user_id, full_name, verification_level, trust_score)
    VALUES (
      ${userId},
      ${'Test User ' + userId.slice(0, 8)},
      ${overrides.verificationLevel ?? '2'},
      ${overrides.trustScore ?? 3.5}
    )
  `);

  return {
    id: userId,
    campusId,
    role: overrides.role ?? 'student',
    verificationLevel: Number(overrides.verificationLevel ?? '2'),
    trustScore: overrides.trustScore ?? 3.5
  };
}

async function ensureTestCampus(db: ReturnType<typeof drizzle>): Promise<string> {
  const existing = await db.execute(sql`SELECT id FROM campuses LIMIT 1`);
  if (existing.rows.length > 0) return existing.rows[0].id as string;
  
  const created = await db.execute(sql`
    INSERT INTO campuses (name, city, state, country)
    VALUES ('Test Campus', 'Test City', 'Test State', 'IN')
    RETURNING id
  `);
  return created.rows[0].id as string;
}

export function createTestToken(user: { id: string; campusId: string; role?: string; roles?: string[]; verificationLevel?: number }) {
  const secret = process.env.JWT_ACCESS_SECRET || 'development-secret-key-change-in-production';
  return jwt.sign({
    id: user.id,
    campusId: user.campusId,
    role: user.role ?? user.roles?.[0] ?? 'student',
    verificationLevel: user.verificationLevel ?? 2
  }, secret);
}

export function buildAuthHeaders(user: { id: string; campusId: string; role?: string; verificationLevel?: number; trustScore?: number }) {
  return {
    'x-user-id': user.id,
    'x-user-campus-id': user.campusId,
    'x-user-role': user.role ?? 'student',
    'x-user-verification-level': String(user.verificationLevel ?? 2),
    'x-user-trust-score': String(user.trustScore ?? 3.5)
  };
}

export async function fundWallet(db: ReturnType<typeof drizzle>, userId: string, amountInPaise: number) {
  // Ensure wallet exists
  const walletResult = await db.execute(sql`
    INSERT INTO wallets (user_id, balance_in_paise)
    VALUES (${userId}, ${amountInPaise})
    ON CONFLICT (user_id) DO UPDATE SET balance_in_paise = wallets.balance_in_paise + ${amountInPaise}
    RETURNING id
  `);
  return walletResult.rows[0].id as string;
}
