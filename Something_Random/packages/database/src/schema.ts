/**
 * @nexus/database — Complete Drizzle ORM Schema
 *
 * All tables, indexes, and relations for the NEXUS campus super-app.
 * This is the single source of truth for the database structure.
 */

import {
  pgTable,
  uuid,
  text,
  varchar,
  integer,
  smallint,
  bigint,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
  decimal,
  serial,
} from 'drizzle-orm/pg-core';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Enums
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const userRoleEnum = pgEnum('user_role', [
  'student',
  'vendor',
  'driver',
  'moderator',
  'campus_admin',
  'super_admin',
]);

export const verificationLevelEnum = pgEnum('verification_level', [
  '1',
  '2',
  '3',
  '4',
]);

export const trustTierEnum = pgEnum('trust_tier', [
  'new',
  'building',
  'trusted',
  'verified',
  'elite',
]);

export const listingStatusEnum = pgEnum('listing_status', [
  'active',
  'reserved',
  'sold',
  'removed',
]);

export const transactionStatusEnum = pgEnum('transaction_status', [
  'initiated',
  'payment_held',
  'in_progress',
  'completed',
  'disputed',
  'refunded',
]);

export const disputeStatusEnum = pgEnum('dispute_status', [
  'open',
  'investigating',
  'resolved_buyer',
  'resolved_seller',
  'closed',
]);

export const userStatusEnum = pgEnum('user_status', [
  'pending_verification',
  'active',
  'suspended',
  'banned',
]);

export const otpPurposeEnum = pgEnum('otp_purpose', [
  'registration',
  'password_reset',
  'email_change',
  'phone_change',
  'phone_verification',
]);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Campuses
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const campuses = pgTable('campuses', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  slug: varchar('slug', { length: 50 }).unique(),
  emailDomain: varchar('email_domain', { length: 100 }),
  emailDomains: jsonb('email_domains').$type<string[]>().notNull().default([]),
  city: varchar('city', { length: 50 }),
  state: varchar('state', { length: 50 }),
  timezone: varchar('timezone', { length: 50 }).notNull().default('Asia/Kolkata'),
  currency: varchar('currency', { length: 10 }).notNull().default('INR'),
  features: jsonb('features').$type<Record<string, boolean>>().notNull().default({}),
  status: varchar('campus_status', { length: 20 }).notNull().default('active'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Users
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    phone: varchar('phone', { length: 15 }).unique(),
    phoneVerified: boolean('phone_verified').notNull().default(false),
    emailVerified: boolean('email_verified').notNull().default(false),
    passwordHash: text('password_hash').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    username: varchar('username', { length: 100 }).unique(),
    avatarUrl: text('avatar_url'),
    role: userRoleEnum('role').notNull().default('student'),
    status: userStatusEnum('status').notNull().default('pending_verification'),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    verificationLevel: verificationLevelEnum('verification_level').notNull().default('1'),
    trustTier: trustTierEnum('trust_tier').notNull().default('new'),
    trustScore: integer('trust_score').notNull().default(0),
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    isSuspended: boolean('is_suspended').notNull().default(false),
    suspendedUntil: timestamp('suspended_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailIdx: uniqueIndex('idx_users_email').on(table.email),
    phoneIdx: uniqueIndex('idx_users_phone').on(table.phone),
    campusIdx: index('idx_users_campus').on(table.campusId),
  }),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Student Profiles
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const studentProfiles = pgTable('student_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  registrationNumber: varchar('registration_number', { length: 50 }),
  srmStudentId: varchar('srm_student_id', { length: 50 }),
  fullName: varchar('full_name', { length: 255 }),
  department: varchar('department', { length: 255 }),
  yearOfStudy: integer('year_of_study'),
  section: varchar('section', { length: 10 }),
  hostelBlock: varchar('hostel_block', { length: 50 }),
  roomNumber: varchar('room_number', { length: 20 }),
  studentIdUrl: text('student_id_url'),
  studentIdVerified: boolean('student_id_verified').notNull().default(false),
  verificationLevel: verificationLevelEnum('verification_level').notNull().default('1'),
  trustScore: decimal('trust_score', { precision: 3, scale: 2 }).notNull().default('3.00'),
  trustTier: trustTierEnum('trust_tier').notNull().default('new'),
  avatarUrl: text('avatar_url'),
  bio: text('bio'),
  interests: jsonb('interests').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Listings (Bazaar)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const listings = pgTable(
  'bazaar_listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => users.id),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description').notNull(),
    category: varchar('category', { length: 50 }).notNull(),
    condition: varchar('condition', { length: 20 }).notNull(),
    priceInPaise: bigint('price_in_paise', { mode: 'number' }).notNull(),
    images: jsonb('images').$type<string[]>().notNull().default([]),
    status: listingStatusEnum('status').notNull().default('active'),
    viewCount: integer('view_count').notNull().default(0),
    isFeatured: boolean('is_featured').notNull().default(false),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    campusIdx: index('idx_listings_campus').on(table.campusId),
    sellerIdx: index('idx_listings_seller').on(table.sellerId),
    statusIdx: index('idx_listings_status').on(table.status),
    categoryIdx: index('idx_listings_category').on(table.category),
  }),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Transactions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => users.id),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => users.id),
    listingId: uuid('listing_id').references(() => listings.id),
    module: varchar('module', { length: 20 }).notNull(),
    amountInPaise: bigint('amount_in_paise', { mode: 'number' }).notNull(),
    platformFeeInPaise: bigint('platform_fee_in_paise', { mode: 'number' }).notNull().default(0),
    status: transactionStatusEnum('status').notNull().default('initiated'),
    paymentGatewayId: varchar('payment_gateway_id', { length: 255 }),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).unique(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    buyerIdx: index('idx_transactions_buyer').on(table.buyerId),
    sellerIdx: index('idx_transactions_seller').on(table.sellerId),
    statusIdx: index('idx_transactions_status').on(table.status),
    moduleIdx: index('idx_transactions_module').on(table.module),
  }),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Wallets
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const wallets = pgTable('wallets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  balanceInPaise: bigint('balance_in_paise', { mode: 'number' }).notNull().default(0),
  heldInPaise: bigint('held_in_paise', { mode: 'number' }).notNull().default(0),
  currency: varchar('currency', { length: 10 }).notNull().default('INR'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Wallet Ledger (Double-Entry Bookkeeping)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const walletLedger = pgTable(
  'wallet_ledger',
  {
    id: serial('id').primaryKey(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    transactionId: uuid('transaction_id').references(() => transactions.id),
    entryType: varchar('entry_type', { length: 20 }).notNull(), // debit | credit
    amountInPaise: bigint('amount_in_paise', { mode: 'number' }).notNull(),
    balanceAfterInPaise: bigint('balance_after_in_paise', { mode: 'number' }).notNull(),
    description: text('description').notNull(),
    referenceType: varchar('reference_type', { length: 50 }).notNull(),
    referenceId: varchar('reference_id', { length: 255 }),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    walletIdx: index('idx_wallet_ledger_wallet').on(table.walletId),
    transactionIdx: index('idx_wallet_ledger_transaction').on(table.transactionId),
    createdAtIdx: index('idx_wallet_ledger_created_at').on(table.createdAt),
  }),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Disputes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const disputes = pgTable(
  'disputes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),
    raisedById: uuid('raised_by_id')
      .notNull()
      .references(() => users.id),
    againstId: uuid('against_id')
      .notNull()
      .references(() => users.id),
    reason: text('reason').notNull(),
    evidence: jsonb('evidence').$type<string[]>().notNull().default([]),
    status: disputeStatusEnum('status').notNull().default('open'),
    resolution: text('resolution'),
    resolvedById: uuid('resolved_by_id').references(() => users.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    transactionIdx: index('idx_disputes_transaction').on(table.transactionId),
    raisedByIdx: index('idx_disputes_raised_by').on(table.raisedById),
    statusIdx: index('idx_disputes_status').on(table.status),
  }),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Ratings
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const ratings = pgTable(
  'ratings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => users.id),
    revieweeId: uuid('reviewee_id')
      .notNull()
      .references(() => users.id),
    score: integer('score').notNull(), // 1-5
    comment: text('comment'),
    isAnonymous: boolean('is_anonymous').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    revieweeIdx: index('idx_ratings_reviewee').on(table.revieweeId),
    transactionIdx: index('idx_ratings_transaction').on(table.transactionId),
  }),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Audit Log
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const auditLog = pgTable(
  'audit_log',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id').references(() => users.id),
    action: varchar('action', { length: 100 }).notNull(),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: varchar('entity_id', { length: 255 }).notNull(),
    oldValue: jsonb('old_value').$type<Record<string, unknown>>(),
    newValue: jsonb('new_value').$type<Record<string, unknown>>(),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    correlationId: varchar('correlation_id', { length: 50 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_audit_log_user').on(table.userId),
    entityIdx: index('idx_audit_log_entity').on(table.entityType, table.entityId),
    createdAtIdx: index('idx_audit_log_created_at').on(table.createdAt),
  }),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Email OTPs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const emailOtps = pgTable(
  'email_otps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull(),
    otpHash: varchar('otp_hash', { length: 255 }).notNull(),
    purpose: otpPurposeEnum('purpose').notNull(),
    attempts: smallint('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailPurposeIdx: index('idx_email_otps_email_purpose').on(table.email, table.purpose),
  }),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phone OTPs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const phoneOtps = pgTable(
  'phone_otps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: varchar('phone', { length: 15 }).notNull(),
    otpHash: varchar('otp_hash', { length: 255 }).notNull(),
    purpose: otpPurposeEnum('purpose').notNull(),
    attempts: smallint('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    phonePurposeIdx: index('idx_phone_otps_phone_purpose').on(table.phone, table.purpose),
  }),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sessions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: varchar('refresh_token_hash', { length: 255 }).notNull(),
    deviceFingerprint: varchar('device_fingerprint', { length: 255 }),
    userAgent: text('user_agent'),
    ipAddress: varchar('ip_address', { length: 45 }),
    isActive: boolean('is_active').notNull().default(true),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userActiveIdx: index('idx_sessions_user_active').on(table.userId, table.isActive),
    refreshTokenIdx: index('idx_sessions_refresh_token').on(table.refreshTokenHash),
  }),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Verification Attempts (Week 5)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const verificationAttempts = pgTable(
  'verification_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 30 }).notNull(), // student_id | face_match | aadhaar
    status: varchar('status', { length: 20 }).notNull().default('pending'), // pending | approved | rejected | manual_review
    documentS3Key: varchar('document_s3_key', { length: 500 }),
    extractedData: jsonb('extracted_data').default('{}'),
    confidenceScore: decimal('confidence_score', { precision: 5, scale: 2 }),
    rejectionReason: text('rejection_reason'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userTypeStatusIdx: index('idx_verification_attempts_user_type_status').on(
      table.userId,
      table.type,
      table.status,
    ),
  }),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Trust Score Events (Week 6) - APPEND ONLY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const trustScoreEvents = pgTable(
  'trust_score_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 50 }).notNull(),
    delta: decimal('delta', { precision: 4, scale: 2 }).notNull(),
    reason: text('reason').notNull(),
    referenceId: uuid('reference_id'),
    referenceType: varchar('reference_type', { length: 30 }),
    metadata: jsonb('metadata').default('{}'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userCreatedIdx: index('idx_trust_score_events_user_created').on(table.userId, table.createdAt),
    typeCreatedIdx: index('idx_trust_score_events_type_created').on(
      table.eventType,
      table.createdAt,
    ),
  }),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// User Blocks (Week 6)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const userBlocks = pgTable(
  'user_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: varchar('reason', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    blockerBlockedUnique: uniqueIndex('idx_user_blocks_unique').on(table.blockerId, table.blockedId),
  }),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// User Reports (Week 6)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const userReports = pgTable('user_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  reporterId: uuid('reporter_id')
    .notNull()
    .references(() => users.id),
  reportedId: uuid('reported_id')
    .notNull()
    .references(() => users.id),
  category: varchar('category', { length: 50 }).notNull(), // spam | scam | inappropriate | harassment | fake_profile
  description: text('description'),
  referenceId: uuid('reference_id'),
  referenceType: varchar('reference_type', { length: 30 }),
  status: varchar('status', { length: 20 }).notNull().default('open'), // open | reviewed | resolved | dismissed
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  resolutionNotes: text('resolution_notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 2-6: Additional Enums
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const gigStatusEnum = pgEnum('gig_status', [
  'open',
  'in_progress',
  'completed',
  'cancelled',
  'expired',
]);

export const gigApplicationStatusEnum = pgEnum('gig_application_status', [
  'pending',
  'accepted',
  'rejected',
  'withdrawn',
]);

export const errandStatusEnum = pgEnum('errand_status', [
  'open',
  'assigned',
  'in_progress',
  'pending_verification',
  'completed',
  'disputed',
  'cancelled',
]);

export const vendorStatusEnum = pgEnum('vendor_status', [
  'pending_approval',
  'approved',
  'suspended',
  'rejected',
]);

export const foodOrderStatusEnum = pgEnum('food_order_status', [
  'pending_payment',
  'payment_held',
  'preparing',
  'ready',
  'picked_up',
  'delivered',
  'cancelled',
  'refunded',
]);

export const deliveryStatusEnum = pgEnum('delivery_status', [
  'available',
  'busy',
  'offline',
  'suspended',
]);

export const skillOrderStatusEnum = pgEnum('skill_order_status', [
  'initiated',
  'in_progress',
  'delivered',
  'revision_requested',
  'completed',
  'disputed',
  'cancelled',
  'refunded',
]);

export const eventStatusEnum = pgEnum('event_status', [
  'draft',
  'published',
  'cancelled',
  'completed',
  'sold_out',
]);

export const rsvpStatusEnum = pgEnum('rsvp_status', [
  'pending',
  'confirmed',
  'waitlisted',
  'cancelled',
  'attended',
  'no_show',
]);

export const teamMemberRoleEnum = pgEnum('team_member_role', [
  'leader',
  'member',
]);

export const groupMemberRoleEnum = pgEnum('group_member_role', [
  'admin',
  'moderator',
  'member',
]);

export const notificationChannelEnum = pgEnum('notification_channel', [
  'push',
  'email',
  'sms',
  'in_app',
]);

export const notificationStatusEnum = pgEnum('notification_status', [
  'queued',
  'sent',
  'delivered',
  'failed',
  'read',
]);

export const moderationStatusEnum = pgEnum('moderation_status', [
  'pending',
  'auto_approved',
  'auto_rejected',
  'human_review',
  'approved',
  'rejected',
]);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 3: Gigs (QuickGigs)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const gigs = pgTable(
  'gigs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    posterId: uuid('poster_id')
      .notNull()
      .references(() => users.id),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description').notNull(),
    category: varchar('category', { length: 50 }).notNull(),
    skillsRequired: jsonb('skills_required').$type<string[]>().notNull().default([]),
    budgetInPaise: bigint('budget_in_paise', { mode: 'number' }).notNull(),
    durationDays: integer('duration_days').notNull(),
    status: gigStatusEnum('status').notNull().default('open'),
    maxApplicants: integer('max_applicants').notNull().default(10),
    applicantCount: integer('applicant_count').notNull().default(0),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    attachments: jsonb('attachments').$type<string[]>().notNull().default([]),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    campusStatusIdx: index('idx_gigs_campus_status').on(table.campusId, table.status),
    posterIdx: index('idx_gigs_poster').on(table.posterId),
    categoryIdx: index('idx_gigs_category').on(table.category),
  }),
);

export const gigApplications = pgTable(
  'gig_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gigId: uuid('gig_id')
      .notNull()
      .references(() => gigs.id, { onDelete: 'cascade' }),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => users.id),
    proposal: text('proposal').notNull(),
    proposedRateInPaise: bigint('proposed_rate_in_paise', { mode: 'number' }),
    estimatedDays: integer('estimated_days'),
    status: gigApplicationStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    gigApplicantUnique: uniqueIndex('idx_gig_applications_unique').on(table.gigId, table.applicantId),
    gigIdx: index('idx_gig_applications_gig').on(table.gigId),
    applicantIdx: index('idx_gig_applications_applicant').on(table.applicantId),
  }),
);

export const gigBookmarks = pgTable(
  'gig_bookmarks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gigId: uuid('gig_id')
      .notNull()
      .references(() => gigs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    gigUserUnique: uniqueIndex('idx_gig_bookmarks_unique').on(table.gigId, table.userId),
  }),
);

export const gigMilestones = pgTable(
  'gig_milestones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gigId: uuid('gig_id')
      .notNull()
      .references(() => gigs.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    amountInPaise: bigint('amount_in_paise', { mode: 'number' }).notNull(),
    dueDate: timestamp('due_date', { withTimezone: true }),
    isCompleted: boolean('is_completed').notNull().default(false),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    orderIndex: integer('order_index').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    gigIdx: index('idx_gig_milestones_gig').on(table.gigId),
  }),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 3: Errands (RunIt) — uses existing transactions + errand_tasks
// (task schema is in swift service via migrations)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const runnerProfiles = pgTable('runner_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  campusId: uuid('campus_id')
    .notNull()
    .references(() => campuses.id),
  isAvailable: boolean('is_available').notNull().default(false),
  isVerified: boolean('is_verified').notNull().default(false),
  totalTasksCompleted: integer('total_tasks_completed').notNull().default(0),
  averageRating: decimal('average_rating', { precision: 3, scale: 2 }).notNull().default('0.00'),
  totalRatings: integer('total_ratings').notNull().default(0),
  bio: text('bio'),
  serviceCategories: jsonb('service_categories').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const runnerAvailability = pgTable(
  'runner_availability',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runnerId: uuid('runner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dayOfWeek: smallint('day_of_week').notNull(), // 0=Sunday, 6=Saturday
    startTime: varchar('start_time', { length: 5 }).notNull(), // "09:00"
    endTime: varchar('end_time', { length: 5 }).notNull(), // "17:00"
    isActive: boolean('is_active').notNull().default(true),
  },
  (table) => ({
    runnerDayUnique: uniqueIndex('idx_runner_availability_unique').on(table.runnerId, table.dayOfWeek),
  }),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 4: CampusEats — Vendors, Menus, Orders, Delivery
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const vendors = pgTable(
  'vendors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    name: varchar('name', { length: 200 }).notNull(),
    slug: varchar('slug', { length: 200 }).notNull(),
    description: text('description'),
    cuisineTypes: jsonb('cuisine_types').$type<string[]>().notNull().default([]),
    bannerUrl: text('banner_url'),
    logoUrl: text('logo_url'),
    address: text('address').notNull(),
    latitude: decimal('latitude', { precision: 10, scale: 7 }),
    longitude: decimal('longitude', { precision: 10, scale: 7 }),
    phone: varchar('phone', { length: 15 }).notNull(),
    email: varchar('email', { length: 255 }),
    fssaiLicense: varchar('fssai_license', { length: 50 }),
    gstNumber: varchar('gst_number', { length: 20 }),
    operatingHours: jsonb('operating_hours').$type<Record<string, { open: string; close: string } | null>>().notNull().default({}),
    status: vendorStatusEnum('status').notNull().default('pending_approval'),
    rating: decimal('rating', { precision: 3, scale: 2 }).notNull().default('0.00'),
    totalReviews: integer('total_reviews').notNull().default(0),
    deliveryRadiusKm: decimal('delivery_radius_km', { precision: 5, scale: 2 }).notNull().default('5.00'),
    minOrderInPaise: bigint('min_order_in_paise', { mode: 'number' }).notNull().default(0),
    avgPrepTimeMinutes: integer('avg_prep_time_minutes').notNull().default(30),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: uuid('approved_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    campusIdx: index('idx_vendors_campus').on(table.campusId),
    statusIdx: index('idx_vendors_status').on(table.status),
    ownerIdx: index('idx_vendors_owner').on(table.ownerId),
  }),
);

export const menuCategories = pgTable(
  'menu_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    displayOrder: integer('display_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    vendorIdx: index('idx_menu_categories_vendor').on(table.vendorId),
  }),
);

export const menuItems = pgTable(
  'menu_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').references(() => menuCategories.id, { onDelete: 'set null' }),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    imageUrl: text('image_url'),
    priceInPaise: bigint('price_in_paise', { mode: 'number' }).notNull(),
    discountedPriceInPaise: bigint('discounted_price_in_paise', { mode: 'number' }),
    isVeg: boolean('is_veg').notNull().default(true),
    isVegan: boolean('is_vegan').notNull().default(false),
    isGlutenFree: boolean('is_gluten_free').notNull().default(false),
    spiceLevel: smallint('spice_level').notNull().default(0), // 0-5
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    allergens: jsonb('allergens').$type<string[]>().notNull().default([]),
    isAvailable: boolean('is_available').notNull().default(true),
    isFeatured: boolean('is_featured').notNull().default(false),
    prepTimeMinutes: integer('prep_time_minutes').notNull().default(15),
    calories: integer('calories'),
    displayOrder: integer('display_order').notNull().default(0),
    rating: decimal('rating', { precision: 3, scale: 2 }).notNull().default('0.00'),
    totalReviews: integer('total_reviews').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    vendorIdx: index('idx_menu_items_vendor').on(table.vendorId),
    categoryIdx: index('idx_menu_items_category').on(table.categoryId),
    availabilityIdx: index('idx_menu_items_availability').on(table.vendorId, table.isAvailable),
  }),
);

export const foodOrders = pgTable(
  'food_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderNumber: varchar('order_number', { length: 30 }).notNull().unique(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    deliveryPartnerId: uuid('delivery_partner_id').references(() => users.id),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    items: jsonb('items').$type<Array<{ menuItemId: string; name: string; quantity: number; priceInPaise: number; specialInstructions?: string }>>().notNull(),
    subtotalInPaise: bigint('subtotal_in_paise', { mode: 'number' }).notNull(),
    deliveryFeeInPaise: bigint('delivery_fee_in_paise', { mode: 'number' }).notNull().default(0),
    taxInPaise: bigint('tax_in_paise', { mode: 'number' }).notNull().default(0),
    tipInPaise: bigint('tip_in_paise', { mode: 'number' }).notNull().default(0),
    totalInPaise: bigint('total_in_paise', { mode: 'number' }).notNull(),
    status: foodOrderStatusEnum('status').notNull().default('pending_payment'),
    deliveryAddress: text('delivery_address').notNull(),
    deliveryLatitude: decimal('delivery_latitude', { precision: 10, scale: 7 }),
    deliveryLongitude: decimal('delivery_longitude', { precision: 10, scale: 7 }),
    deliveryNotes: text('delivery_notes'),
    estimatedPrepTimeMinutes: integer('estimated_prep_time_minutes'),
    estimatedDeliveryAt: timestamp('estimated_delivery_at', { withTimezone: true }),
    preparedAt: timestamp('prepared_at', { withTimezone: true }),
    pickedUpAt: timestamp('picked_up_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    paymentTransactionId: uuid('payment_transaction_id').references(() => transactions.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    customerIdx: index('idx_food_orders_customer').on(table.customerId),
    vendorIdx: index('idx_food_orders_vendor').on(table.vendorId),
    statusIdx: index('idx_food_orders_status').on(table.status),
    campusIdx: index('idx_food_orders_campus').on(table.campusId),
    deliveryPartnerIdx: index('idx_food_orders_delivery_partner').on(table.deliveryPartnerId),
  }),
);

export const deliveryPartners = pgTable(
  'delivery_partners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    vehicleType: varchar('vehicle_type', { length: 30 }).notNull(), // bike | bicycle | walk
    vehicleNumber: varchar('vehicle_number', { length: 50 }),
    licenseNumber: varchar('license_number', { length: 50 }),
    isAvailable: boolean('is_available').notNull().default(false),
    isVerified: boolean('is_verified').notNull().default(false),
    currentLatitude: decimal('current_latitude', { precision: 10, scale: 7 }),
    currentLongitude: decimal('current_longitude', { precision: 10, scale: 7 }),
    lastLocationUpdate: timestamp('last_location_update', { withTimezone: true }),
    totalDeliveries: integer('total_deliveries').notNull().default(0),
    averageRating: decimal('average_rating', { precision: 3, scale: 2 }).notNull().default('0.00'),
    totalRatings: integer('total_ratings').notNull().default(0),
    status: deliveryStatusEnum('status').notNull().default('offline'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    campusIdx: index('idx_delivery_partners_campus').on(table.campusId),
    statusIdx: index('idx_delivery_partners_status').on(table.status),
    availableIdx: index('idx_delivery_partners_available').on(table.campusId, table.isAvailable, table.status),
  }),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 5: SkillHub — Services, Orders, Collaboration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const serviceListings = pgTable(
  'service_listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => users.id),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description').notNull(),
    category: varchar('category', { length: 50 }).notNull(),
    subcategory: varchar('subcategory', { length: 100 }),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    hourlyRateInPaise: bigint('hourly_rate_in_paise', { mode: 'number' }),
    fixedPriceInPaise: bigint('fixed_price_in_paise', { mode: 'number' }),
    pricingType: varchar('pricing_type', { length: 20 }).notNull().default('hourly'), // hourly | fixed | milestone
    images: jsonb('images').$type<string[]>().notNull().default([]),
    portfolioUrl: text('portfolio_url'),
    deliveryDays: integer('delivery_days').notNull().default(7),
    isFeatured: boolean('is_featured').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    rating: decimal('rating', { precision: 3, scale: 2 }).notNull().default('0.00'),
    totalReviews: integer('total_reviews').notNull().default(0),
    totalOrders: integer('total_orders').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    providerIdx: index('idx_service_listings_provider').on(table.providerId),
    campusCategoryIdx: index('idx_service_listings_campus_category').on(table.campusId, table.category),
  }),
);

export const skillOrders = pgTable(
  'skill_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderNumber: varchar('order_number', { length: 30 }).notNull().unique(),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => users.id),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => users.id),
    serviceListingId: uuid('service_listing_id')
      .notNull()
      .references(() => serviceListings.id),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description').notNull(),
    amountInPaise: bigint('amount_in_paise', { mode: 'number' }).notNull(),
    platformFeeInPaise: bigint('platform_fee_in_paise', { mode: 'number' }).notNull().default(0),
    totalInPaise: bigint('total_in_paise', { mode: 'number' }).notNull(),
    status: skillOrderStatusEnum('status').notNull().default('initiated'),
    paymentTransactionId: uuid('payment_transaction_id').references(() => transactions.id),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    revisionCount: integer('revision_count').notNull().default(0),
    maxRevisions: integer('max_revisions').notNull().default(2),
    autoReleaseAt: timestamp('auto_release_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    buyerIdx: index('idx_skill_orders_buyer').on(table.buyerId),
    providerIdx: index('idx_skill_orders_provider').on(table.providerId),
    statusIdx: index('idx_skill_orders_status').on(table.status),
  }),
);

export const skillDeliverables = pgTable(
  'skill_deliverables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => skillOrders.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    fileUrls: jsonb('file_urls').$type<string[]>().notNull().default([]),
    submittedBy: uuid('submitted_by')
      .notNull()
      .references(() => users.id),
    revisionRequested: boolean('revision_requested').notNull().default(false),
    revisionNotes: text('revision_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orderIdx: index('idx_skill_deliverables_order').on(table.orderId),
  }),
);

export const collaborationPosts = pgTable(
  'collaboration_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description').notNull(),
    projectType: varchar('project_type', { length: 50 }).notNull(), // hackathon | research | startup | open_source
    skillsNeeded: jsonb('skills_needed').$type<string[]>().notNull().default([]),
    teamSize: integer('team_size').notNull().default(2),
    currentMembers: integer('current_members').notNull().default(1),
    commitment: varchar('commitment', { length: 50 }), // part_time | full_time | weekend
    durationWeeks: integer('duration_weeks'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    status: varchar('status', { length: 20 }).notNull().default('open'), // open | closed | in_progress
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    campusIdx: index('idx_collab_posts_campus').on(table.campusId),
    authorIdx: index('idx_collab_posts_author').on(table.authorId),
  }),
);

export const collaborationApplications = pgTable(
  'collab_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => collaborationPosts.id, { onDelete: 'cascade' }),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => users.id),
    message: text('message').notNull(),
    relevantSkills: jsonb('relevant_skills').$type<string[]>().notNull().default([]),
    status: varchar('status', { length: 20 }).notNull().default('pending'), // pending | accepted | rejected
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    postApplicantUnique: uniqueIndex('idx_collab_applications_unique').on(table.postId, table.applicantId),
  }),
);

export const collaborationTeams = pgTable(
  'collab_teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .unique()
      .references(() => collaborationPosts.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const collaborationTeamMembers = pgTable(
  'collab_team_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => collaborationTeams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: teamMemberRoleEnum('role').notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    teamUserUnique: uniqueIndex('idx_collab_team_members_unique').on(table.teamId, table.userId),
  }),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 6: CampusConnect — Events, Tickets, Teams, Community
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const campusEvents = pgTable(
  'campus_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizerId: uuid('organizer_id')
      .notNull()
      .references(() => users.id),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description').notNull(),
    category: varchar('category', { length: 50 }).notNull(), // academic | cultural | sports | workshop | social
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    bannerUrl: text('banner_url'),
    venue: varchar('venue', { length: 200 }),
    address: text('address'),
    latitude: decimal('latitude', { precision: 10, scale: 7 }),
    longitude: decimal('longitude', { precision: 10, scale: 7 }),
    isOnline: boolean('is_online').notNull().default(false),
    onlineUrl: text('online_url'),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    timezone: varchar('timezone', { length: 50 }).notNull().default('Asia/Kolkata'),
    capacity: integer('capacity').notNull().default(100),
    registeredCount: integer('registered_count').notNull().default(0),
    waitlistCapacity: integer('waitlist_capacity').notNull().default(0),
    isFree: boolean('is_free').notNull().default(true),
    priceInPaise: bigint('price_in_paise', { mode: 'number' }).notNull().default(0),
    requiresApproval: boolean('requires_approval').notNull().default(false),
    status: eventStatusEnum('status').notNull().default('draft'),
    coverImageUrl: text('cover_image_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    campusStatusIdx: index('idx_events_campus_status').on(table.campusId, table.status),
    startAtIdx: index('idx_events_start_at').on(table.startAt),
    categoryIdx: index('idx_events_category').on(table.category),
    organizerIdx: index('idx_events_organizer').on(table.organizerId),
  }),
);

export const eventRegistrations = pgTable(
  'event_registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => campusEvents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: rsvpStatusEnum('status').notNull().default('confirmed'),
    ticketId: varchar('ticket_id', { length: 100 }).notNull().unique(),
    qrCodeData: text('qr_code_data').notNull(),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    paymentTransactionId: uuid('payment_transaction_id').references(() => transactions.id),
    attendeeCount: integer('attendee_count').notNull().default(1),
    specialRequirements: text('special_requirements'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    eventUserUnique: uniqueIndex('idx_event_registrations_unique').on(table.eventId, table.userId),
    ticketIdx: uniqueIndex('idx_event_registrations_ticket').on(table.ticketId),
    statusIdx: index('idx_event_registrations_status').on(table.status),
  }),
);

export const teamFormationPosts = pgTable(
  'team_formation_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => campusEvents.id, { onDelete: 'cascade' }),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => users.id),
    teamName: varchar('team_name', { length: 100 }).notNull(),
    description: text('description'),
    skillsNeeded: jsonb('skills_needed').$type<string[]>().notNull().default([]),
    teamSize: integer('team_size').notNull().default(4),
    currentSize: integer('current_size').notNull().default(1),
    isOpen: boolean('is_open').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    eventIdx: index('idx_team_formation_event').on(table.eventId),
    creatorIdx: index('idx_team_formation_creator').on(table.creatorId),
  }),
);

export const teamFormationJoinRequests = pgTable(
  'team_join_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamPostId: uuid('team_post_id')
      .notNull()
      .references(() => teamFormationPosts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    message: text('message'),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    teamUserUnique: uniqueIndex('idx_team_join_unique').on(table.teamPostId, table.userId),
  }),
);

export const communityGroups = pgTable(
  'community_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => users.id),
    name: varchar('name', { length: 200 }).notNull(),
    slug: varchar('slug', { length: 200 }).notNull(),
    description: text('description'),
    category: varchar('category', { length: 50 }).notNull(),
    bannerUrl: text('banner_url'),
    iconUrl: text('icon_url'),
    isPublic: boolean('is_public').notNull().default(true),
    requiresApproval: boolean('requires_approval').notNull().default(false),
    memberCount: integer('member_count').notNull().default(1),
    postCount: integer('post_count').notNull().default(0),
    rules: text('rules'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    campusSlugUnique: uniqueIndex('idx_community_groups_campus_slug').on(table.campusId, table.slug),
    categoryIdx: index('idx_community_groups_category').on(table.category),
  }),
);

export const communityGroupMembers = pgTable(
  'community_group_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => communityGroups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: groupMemberRoleEnum('role').notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
  },
  (table) => ({
    groupUserUnique: uniqueIndex('idx_group_members_unique').on(table.groupId, table.userId),
  }),
);

export const communityPosts = pgTable(
  'community_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => communityGroups.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    title: varchar('title', { length: 200 }),
    body: text('body').notNull(),
    imageUrls: jsonb('image_urls').$type<string[]>().notNull().default([]),
    likeCount: integer('like_count').notNull().default(0),
    commentCount: integer('comment_count').notNull().default(0),
    isPinned: boolean('is_pinned').notNull().default(false),
    isLocked: boolean('is_locked').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    groupIdx: index('idx_community_posts_group').on(table.groupId, table.createdAt),
    authorIdx: index('idx_community_posts_author').on(table.authorId),
  }),
);

export const communityPostComments = pgTable(
  'community_post_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => communityPosts.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    parentCommentId: uuid('parent_comment_id'),
    body: text('body').notNull(),
    likeCount: integer('like_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    postIdx: index('idx_community_comments_post').on(table.postId, table.createdAt),
  }),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Chat (Realtime Messaging) — Postgres + MongoDB hybrid
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    type: varchar('type', { length: 20 }).notNull().default('direct'), // direct | group
    title: varchar('title', { length: 200 }),
    contextType: varchar('context_type', { length: 30 }), // listing | order | event | team | group | general
    contextId: uuid('context_id'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    lastMessagePreview: text('last_message_preview'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    campusIdx: index('idx_conversations_campus').on(table.campusId, table.lastMessageAt),
    contextIdx: index('idx_conversations_context').on(table.contextType, table.contextId),
  }),
);

export const conversationParticipants = pgTable(
  'conversation_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    unreadCount: integer('unread_count').notNull().default(0),
    isMuted: boolean('is_muted').notNull().default(false),
    isArchived: boolean('is_archived').notNull().default(false),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    convoUserUnique: uniqueIndex('idx_conv_participants_unique').on(table.conversationId, table.userId),
    userIdx: index('idx_conv_participants_user').on(table.userId),
  }),
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    messageType: varchar('message_type', { length: 20 }).notNull().default('text'), // text | image | file | system | location
    attachments: jsonb('attachments').$type<Array<{ url: string; type: string; name?: string; size?: number }>>().notNull().default([]),
    replyToMessageId: uuid('reply_to_message_id'),
    isEdited: boolean('is_edited').notNull().default(false),
    isDeleted: boolean('is_deleted').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    convoCreatedIdx: index('idx_messages_convo_created').on(table.conversationId, table.createdAt),
    senderIdx: index('idx_messages_sender').on(table.senderId),
  }),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Notifications
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 50 }).notNull(),
    channel: notificationChannelEnum('channel').notNull().default('in_app'),
    title: varchar('title', { length: 200 }).notNull(),
    body: text('body').notNull(),
    imageUrl: text('image_url'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    status: notificationStatusEnum('status').notNull().default('queued'),
    priority: smallint('priority').notNull().default(5), // 1=highest, 10=lowest
    readAt: timestamp('read_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    referenceType: varchar('reference_type', { length: 30 }),
    referenceId: varchar('reference_id', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userReadIdx: index('idx_notifications_user_read').on(table.userId, table.readAt),
    userCreatedIdx: index('idx_notifications_user_created').on(table.userId, table.createdAt),
    statusIdx: index('idx_notifications_status').on(table.status),
  }),
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    pushEnabled: boolean('push_enabled').notNull().default(true),
    emailEnabled: boolean('email_enabled').notNull().default(true),
    smsEnabled: boolean('sms_enabled').notNull().default(false),
    inAppEnabled: boolean('in_app_enabled').notNull().default(true),
    marketingEnabled: boolean('marketing_enabled').notNull().default(false),
    quietHoursStart: varchar('quiet_hours_start', { length: 5 }), // "22:00"
    quietHoursEnd: varchar('quiet_hours_end', { length: 5 }), // "07:00"
    preferences: jsonb('preferences').$type<Record<string, { push: boolean; email: boolean; sms: boolean; in_app: boolean }>>().notNull().default({}),
    fcmTokens: jsonb('fcm_tokens').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Moderation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const moderationItems = pgTable(
  'moderation_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterId: uuid('reporter_id').references(() => users.id),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    contentType: varchar('content_type', { length: 30 }).notNull(), // listing | review | message | profile_image | post
    contentId: uuid('content_id').notNull(),
    contentText: text('content_text'),
    contentUrl: text('content_url'),
    flags: jsonb('flags').$type<string[]>().notNull().default([]),
    toxicityScore: decimal('toxicity_score', { precision: 5, scale: 4 }),
    nsfwScore: decimal('nsfw_score', { precision: 5, scale: 4 }),
    spamScore: decimal('spam_score', { precision: 5, scale: 4 }),
    status: moderationStatusEnum('status').notNull().default('pending'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNotes: text('review_notes'),
    action: varchar('action', { length: 30 }), // remove | warn | suspend | ban | no_action
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('idx_moderation_status').on(table.status),
    authorIdx: index('idx_moderation_author').on(table.authorId),
    contentIdx: index('idx_moderation_content').on(table.contentType, table.contentId),
  }),
);

export const fraudRules = pgTable('fraud_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  description: text('description'),
  ruleType: varchar('rule_type', { length: 50 }).notNull(), // velocity | amount | pattern | ml_score
  config: jsonb('config').$type<Record<string, unknown>>().notNull(),
  severity: varchar('severity', { length: 20 }).notNull().default('medium'), // low | medium | high | critical
  action: varchar('action', { length: 30 }).notNull().default('flag'), // flag | block | require_review
  isActive: boolean('is_active').notNull().default(true),
  hitCount: integer('hit_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const fraudAlerts = pgTable(
  'fraud_alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id),
    ruleId: uuid('rule_id').references(() => fraudRules.id),
    ruleName: varchar('rule_name', { length: 100 }).notNull(),
    severity: varchar('severity', { length: 20 }).notNull(),
    riskScore: decimal('risk_score', { precision: 5, scale: 2 }).notNull(),
    context: jsonb('context').$type<Record<string, unknown>>().notNull(),
    status: varchar('status', { length: 20 }).notNull().default('open'), // open | investigating | resolved | false_positive
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolutionNotes: text('resolution_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_fraud_alerts_user').on(table.userId),
    statusIdx: index('idx_fraud_alerts_status').on(table.status),
  }),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// KYC & Identity Verification
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const kycVerifications = pgTable(
  'kyc_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 50 }).notNull().default('idfy'), // idfy | digio | mock
    providerReferenceId: varchar('provider_reference_id', { length: 255 }),
    documentType: varchar('document_type', { length: 30 }).notNull(), // aadhaar | pan | passport | driving_license
    documentNumber: varchar('document_number', { length: 100 }),
    documentUrl: text('document_url'),
    selfieUrl: text('selfie_url'),
    status: varchar('status', { length: 20 }).notNull().default('initiated'),
    // initiated | in_progress | verified | failed | expired
    extractedData: jsonb('extracted_data').$type<Record<string, unknown>>().default({}),
    confidenceScore: decimal('confidence_score', { precision: 5, scale: 2 }),
    livenessCheckPassed: boolean('liveness_check_passed'),
    failureReason: text('failure_reason'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_kyc_user').on(table.userId),
    statusIdx: index('idx_kyc_status').on(table.status),
  }),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Campus admin & config
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const campusAdmins = pgTable(
  'campus_admins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 50 }).notNull().default('admin'), // admin | ambassador
    permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
    appointedBy: uuid('appointed_by').references(() => users.id),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    campusUserUnique: uniqueIndex('idx_campus_admins_unique').on(table.campusId, table.userId),
  }),
);

export const campusConfig = pgTable('campus_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  campusId: uuid('campus_id')
    .notNull()
    .unique()
    .references(() => campuses.id, { onDelete: 'cascade' }),
  features: jsonb('features').$type<Record<string, boolean>>().notNull().default({}),
  feeStructure: jsonb('fee_structure').$type<Record<string, number>>().notNull().default({}),
  theme: jsonb('theme').$type<Record<string, string>>().notNull().default({}),
  contactInfo: jsonb('contact_info').$type<Record<string, string>>().notNull().default({}),
  policies: jsonb('policies').$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Analytics (TimescaleDB-friendly)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id),
    campusId: uuid('campus_id').references(() => campuses.id),
    sessionId: varchar('session_id', { length: 100 }),
    eventType: varchar('event_type', { length: 50 }).notNull(),
    eventName: varchar('event_name', { length: 100 }).notNull(),
    properties: jsonb('properties').$type<Record<string, unknown>>().notNull().default({}),
    userAgent: text('user_agent'),
    ipAddress: varchar('ip_address', { length: 45 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    eventNameCreatedIdx: index('idx_analytics_event_name_created').on(table.eventName, table.createdAt),
    userCreatedIdx: index('idx_analytics_user_created').on(table.userId, table.createdAt),
    campusCreatedIdx: index('idx_analytics_campus_created').on(table.campusId, table.createdAt),
  }),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ███████╗  ██████╗  ███████╗ ███████╗ ██╗  ██╗      ██████╗  ██████╗ 
// ██╔════╝ ██╔═══██╗ ╚══███╔╝ ██╔════╝ ██║  ██║     ██╔════╝ ██╔═══██╗
// █████╗   ██║   ██║   ███╔╝  █████╗   ███████║     ██║  ███╗██║   ██║
// ██╔══╝   ██║   ██║  ███╔╝   ██╔══╝   ╚════██║     ██║   ██║██║   ██║
// ███████╗ ╚██████╔╝ ███████╗ ███████╗     ██║     ╚██████╔╝╚██████╔╝
// ╚══════╝  ╚═════╝  ╚══════╝ ╚══════╝     ╚═╝      ╚═════╝  ╚═════╝ 
//
//                 RIDE  &  GO  —  NEXUS  SUPER  APP
//          Intra-Campus Premium Mobility Platform (Go + Gin)
//
// This block defines every persistent entity required for the
// RIDE & GO subsystem: ride lifecycle, fleet, drivers, curators,
// SOS, incidents, payments, rewards, leaderboards, skins, vehicle
// 3D scans, maintenance, fleet deployment, heatmap predictions,
// cod verifications, luggage configs, biometric onboarding, etc.
//
// Every table is built on top of the existing NEXUS users / campuses
// scaffolding so referential integrity and RLS policies stay intact.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ----- Ride & Go Enums --------------------------------------------------

export const rideStatusEnum = pgEnum('ride_status', [
  'requested',
  'matching',
  'offered',
  'accepted',
  'driver_enroute',
  'arrived',
  'in_progress',
  'completed',
  'cancelled_by_rider',
  'cancelled_by_driver',
  'cancelled_by_system',
  'no_drivers',
  'expired',
  'disputed',
]);

export const rideTypeEnum = pgEnum('ride_type', [
  'solo',
  'pool',
  'women_only',
  'luggage',
  'premium',
  'accessibility',
]);

export const vehicleTypeEnum = pgEnum('vehicle_type', [
  'bicycle',
  'electric_scooter',
  'motorcycle',
  'auto',
  'mini',
  'sedan',
  'suv',
  'premium',
  'van',
]);

export const driverStatusEnum = pgEnum('driver_status', [
  'offline',
  'online',
  'on_break',
  'enroute_to_pickup',
  'arrived_at_pickup',
  'on_trip',
  'suspended',
  'banned',
]);

export const vehicleStatusEnum = pgEnum('vehicle_status', [
  'active',
  'maintenance',
  'retired',
  'impounded',
  'inspection_due',
]);

export const poolStatusEnum = pgEnum('pool_status', [
  'open',
  'filling',
  'matched',
  'dispatched',
  'completed',
  'cancelled',
  'expired',
]);

export const sosStatusEnum = pgEnum('sos_status', [
  'triggered',
  'acknowledged',
  'resolved',
  'false_alarm',
  'escalated',
]);

export const incidentStatusEnum = pgEnum('incident_status', [
  'reported',
  'investigating',
  'awaiting_evidence',
  'resolved',
  'rejected',
  'escalated_to_legal',
]);

export const incidentSeverityEnum = pgEnum('incident_severity', [
  'low',
  'medium',
  'high',
  'critical',
]);

export const paymentStatusEnum = pgEnum('ride_payment_status', [
  'pending',
  'authorized',
  'captured',
  'refunded',
  'partial_refund',
  'failed',
  'cod_pending',
  'cod_collected',
]);

export const paymentMethodEnum = pgEnum('ride_payment_method', [
  'wallet',
  'upi',
  'card',
  'netbanking',
  'cod',
  'campus_pass',
]);

export const codVerificationStatusEnum = pgEnum('cod_verification_status', [
  'pending',
  'otp_sent',
  'verified',
  'failed',
  'expired',
]);

export const curatorShiftStatusEnum = pgEnum('curator_shift_status', [
  'scheduled',
  'checked_in',
  'on_break',
  'completed',
  'missed',
  'cancelled',
]);

export const curatorTierEnum = pgEnum('curator_tier', [
  'bronze',
  'silver',
  'gold',
  'platinum',
  'elite',
]);

export const maintenanceTypeEnum = pgEnum('maintenance_type', [
  'routine',
  'repair',
  'inspection',
  'battery_swap',
  'tire_change',
  'oil_change',
  'detailing',
  'recall',
]);

export const skinRarityEnum = pgEnum('skin_rarity', [
  'common',
  'rare',
  'epic',
  'legendary',
  'mythic',
]);

export const deploymentStatusEnum = pgEnum('deployment_status', [
  'planned',
  'active',
  'paused',
  'completed',
  'rolled_back',
]);

export const tripPhaseEnum = pgEnum('trip_phase', [
  'idle',
  'matching',
  'pickup',
  'transit',
  'dropoff',
  'wrap_up',
]);

// ----- Drivers & Vehicles ---------------------------------------------

export const rideDrivers = pgTable(
  'ride_drivers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    licenseNumber: varchar('license_number', { length: 64 }).notNull(),
    licenseExpiry: timestamp('license_expiry', { withTimezone: true }),
    licenseImageUrl: text('license_image_url'),
    aadhaarLast4: varchar('aadhaar_last4', { length: 4 }),
    panNumber: varchar('pan_number', { length: 16 }),
    policeVerificationId: varchar('police_verification_id', { length: 100 }),
    policeVerifiedAt: timestamp('police_verified_at', { withTimezone: true }),
    isVerified: boolean('is_verified').notNull().default(false),
    isWomenOnly: boolean('is_women_only').notNull().default(false),
    isPremiumEligible: boolean('is_premium_eligible').notNull().default(false),
    isAccessibilityTrained: boolean('is_accessibility_trained').notNull().default(false),
    trustScore: decimal('trust_score', { precision: 5, scale: 2 }).notNull().default('5.00'),
    acceptanceRate: decimal('acceptance_rate', { precision: 5, scale: 2 }).notNull().default('1.00'),
    cancellationRate: decimal('cancellation_rate', { precision: 5, scale: 2 }).notNull().default('0.00'),
    completedTrips: integer('completed_trips').notNull().default(0),
    totalEarnings: decimal('total_earnings', { precision: 14, scale: 2 }).notNull().default('0'),
    rating: decimal('rating', { precision: 3, scale: 2 }).notNull().default('5.00'),
    ratingCount: integer('rating_count').notNull().default(0),
    currentVehicleId: uuid('current_vehicle_id'),
    preferredZoneId: uuid('preferred_zone_id'),
    status: driverStatusEnum('status').notNull().default('offline'),
    currentLat: decimal('current_lat', { precision: 10, scale: 7 }),
    currentLng: decimal('current_lng', { precision: 10, scale: 7 }),
    lastPingAt: timestamp('last_ping_at', { withTimezone: true }),
    fcmToken: text('fcm_token'),
    apnsToken: text('apns_token'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: uniqueIndex('idx_ride_drivers_user').on(table.userId),
    campusIdx: index('idx_ride_drivers_campus').on(table.campusId),
    statusIdx: index('idx_ride_drivers_status').on(table.status),
    campusStatusIdx: index('idx_ride_drivers_campus_status').on(table.campusId, table.status),
    geoIdx: index('idx_ride_drivers_geo').on(table.currentLat, table.currentLng),
  }),
);

export const rideVehicles = pgTable(
  'ride_vehicles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => rideDrivers.id, { onDelete: 'cascade' }),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    vehicleType: vehicleTypeEnum('vehicle_type').notNull(),
    make: varchar('make', { length: 64 }),
    model: varchar('model', { length: 64 }),
    year: integer('year'),
    color: varchar('color', { length: 32 }),
    licensePlate: varchar('license_plate', { length: 24 }).notNull(),
    rcImageUrl: text('rc_image_url'),
    fitnessImageUrl: text('fitness_image_url'),
    insuranceImageUrl: text('insurance_image_url'),
    insuranceExpiry: timestamp('insurance_expiry', { withTimezone: true }),
    permitNumber: varchar('permit_number', { length: 64 }),
    seatingCapacity: smallint('seating_capacity').notNull().default(4),
    luggageCapacity: smallint('luggage_capacity').notNull().default(2),
    isElectric: boolean('is_electric').notNull().default(false),
    batteryKwh: decimal('battery_kwh', { precision: 5, scale: 2 }),
    rangeKm: integer('range_km'),
    skinId: uuid('skin_id'),
    odometerKm: integer('odometer_km').notNull().default(0),
    status: vehicleStatusEnum('status').notNull().default('active'),
    lastInspectionAt: timestamp('last_inspection_at', { withTimezone: true }),
    nextInspectionDue: timestamp('next_inspection_due', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    driverIdx: index('idx_ride_vehicles_driver').on(table.driverId),
    campusStatusIdx: index('idx_ride_vehicles_campus_status').on(table.campusId, table.status),
    plateIdx: uniqueIndex('idx_ride_vehicles_plate').on(table.licensePlate),
  }),
);

export const rideDriverShifts = pgTable(
  'ride_driver_shifts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => rideDrivers.id, { onDelete: 'cascade' }),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    plannedEndAt: timestamp('planned_end_at', { withTimezone: true }),
    breaks: jsonb('breaks')
      .$type<Array<{ startedAt: string; endedAt?: string; reason?: string }>>()
      .notNull()
      .default([]),
    trips: integer('trips').notNull().default(0),
    earnings: decimal('earnings', { precision: 14, scale: 2 }).notNull().default('0'),
    onlineSeconds: integer('online_seconds').notNull().default(0),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => ({
    driverIdx: index('idx_ride_driver_shifts_driver').on(table.driverId),
    startedIdx: index('idx_ride_driver_shifts_started').on(table.startedAt),
  }),
);

// ----- Ride Lifecycle ---------------------------------------------------

export const rideRequests = pgTable(
  'ride_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    riderId: uuid('rider_id')
      .notNull()
      .references(() => users.id),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    driverId: uuid('driver_id').references(() => rideDrivers.id),
    vehicleId: uuid('vehicle_id').references(() => rideVehicles.id),
    poolId: uuid('pool_id'),
    rideType: rideTypeEnum('ride_type').notNull().default('solo'),
    status: rideStatusEnum('status').notNull().default('requested'),
    pickupLat: decimal('pickup_lat', { precision: 10, scale: 7 }).notNull(),
    pickupLng: decimal('pickup_lng', { precision: 10, scale: 7 }).notNull(),
    pickupLabel: text('pickup_label').notNull(),
    pickupBuilding: varchar('pickup_building', { length: 128 }),
    pickupFloor: varchar('pickup_floor', { length: 32 }),
    dropoffLat: decimal('dropoff_lat', { precision: 10, scale: 7 }).notNull(),
    dropoffLng: decimal('dropoff_lng', { precision: 10, scale: 7 }).notNull(),
    dropoffLabel: text('dropoff_label').notNull(),
    dropoffBuilding: varchar('dropoff_building', { length: 128 }),
    dropoffFloor: varchar('dropoff_floor', { length: 32 }),
    distanceMeters: integer('distance_meters').notNull().default(0),
    estimatedDurationSec: integer('estimated_duration_sec').notNull().default(0),
    actualDurationSec: integer('actual_duration_sec'),
    passengerCount: smallint('passenger_count').notNull().default(1),
    luggageCount: smallint('luggage_count').notNull().default(0),
    isWomenOnly: boolean('is_women_only').notNull().default(false),
    accessibilityNeeds: jsonb('accessibility_needs')
      .$type<Array<{ type: string; note?: string }>>()
      .notNull()
      .default([]),
    couponCode: varchar('coupon_code', { length: 32 }),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    arrivedAt: timestamp('arrived_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    estimatedFare: decimal('estimated_fare', { precision: 14, scale: 2 }).notNull(),
    finalFare: decimal('final_fare', { precision: 14, scale: 2 }),
    surgeMultiplier: decimal('surge_multiplier', { precision: 4, scale: 2 }).notNull().default('1.00'),
    tip: decimal('tip', { precision: 14, scale: 2 }).notNull().default('0'),
    paymentMethod: paymentMethodEnum('payment_method').notNull().default('upi'),
    promoDiscount: decimal('promo_discount', { precision: 14, scale: 2 }).notNull().default('0'),
    campusCoinDiscount: decimal('campus_coin_discount', { precision: 14, scale: 2 }).notNull().default('0'),
    waitingSec: integer('waiting_sec').notNull().default(0),
    polyline: text('polyline'),
    ratingByRider: smallint('rating_by_rider'),
    ratingByDriver: smallint('rating_by_driver'),
    notes: text('notes'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    riderIdx: index('idx_ride_requests_rider').on(table.riderId),
    driverIdx: index('idx_ride_requests_driver').on(table.driverId),
    campusIdx: index('idx_ride_requests_campus').on(table.campusId),
    statusIdx: index('idx_ride_requests_status').on(table.status),
    campusStatusIdx: index('idx_ride_requests_campus_status').on(table.campusId, table.status),
    createdIdx: index('idx_ride_requests_created').on(table.createdAt),
    pickupGeoIdx: index('idx_ride_requests_pickup_geo').on(table.pickupLat, table.pickupLng),
  }),
);

export const rideTrackingPoints = pgTable(
  'ride_tracking_points',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rideRequests.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id').references(() => rideDrivers.id),
    lat: decimal('lat', { precision: 10, scale: 7 }).notNull(),
    lng: decimal('lng', { precision: 10, scale: 7 }).notNull(),
    bearing: decimal('bearing', { precision: 5, scale: 2 }),
    speedKph: decimal('speed_kph', { precision: 6, scale: 2 }),
    accuracyM: decimal('accuracy_m', { precision: 6, scale: 2 }),
    phase: tripPhaseEnum('phase').notNull().default('transit'),
    batteryPct: smallint('battery_pct'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    rideIdx: index('idx_ride_tracking_ride').on(table.rideId, table.recordedAt),
    driverIdx: index('idx_ride_tracking_driver').on(table.driverId, table.recordedAt),
  }),
);

// ----- Pooling ----------------------------------------------------------

export const ridePools = pgTable(
  'ride_pools',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    driverId: uuid('driver_id').references(() => rideDrivers.id),
    vehicleId: uuid('vehicle_id').references(() => rideVehicles.id),
    status: poolStatusEnum('status').notNull().default('open'),
    originLat: decimal('origin_lat', { precision: 10, scale: 7 }).notNull(),
    originLng: decimal('origin_lng', { precision: 10, scale: 7 }).notNull(),
    originLabel: text('origin_label').notNull(),
    destinationLat: decimal('destination_lat', { precision: 10, scale: 7 }).notNull(),
    destinationLng: decimal('destination_lng', { precision: 10, scale: 7 }).notNull(),
    destinationLabel: text('destination_label').notNull(),
    capacity: smallint('capacity').notNull().default(4),
    seatsTaken: smallint('seats_taken').notNull().default(0),
    discountPct: decimal('discount_pct', { precision: 5, scale: 2 }).notNull().default('30.00'),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => ({
    campusStatusIdx: index('idx_ride_pools_campus_status').on(table.campusId, table.status),
    detectedIdx: index('idx_ride_pools_detected').on(table.detectedAt),
  }),
);

export const ridePoolMembers = pgTable(
  'ride_pool_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    poolId: uuid('pool_id')
      .notNull()
      .references(() => ridePools.id, { onDelete: 'cascade' }),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rideRequests.id, { onDelete: 'cascade' }),
    riderId: uuid('rider_id')
      .notNull()
      .references(() => users.id),
    joinOrder: smallint('join_order').notNull().default(1),
    fareShare: decimal('fare_share', { precision: 14, scale: 2 }).notNull(),
    pickedUpAt: timestamp('picked_up_at', { withTimezone: true }),
    droppedOffAt: timestamp('dropped_off_at', { withTimezone: true }),
  },
  (table) => ({
    poolIdx: index('idx_ride_pool_members_pool').on(table.poolId),
    rideIdx: uniqueIndex('idx_ride_pool_members_ride').on(table.rideId),
  }),
);

// ----- Fare, Promotions & Payments -------------------------------------

export const rideFareConfigs = pgTable(
  'ride_fare_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id, { onDelete: 'cascade' }),
    vehicleType: vehicleTypeEnum('vehicle_type').notNull(),
    baseFare: decimal('base_fare', { precision: 14, scale: 2 }).notNull(),
    perKmRate: decimal('per_km_rate', { precision: 14, scale: 2 }).notNull(),
    perMinRate: decimal('per_min_rate', { precision: 14, scale: 2 }).notNull(),
    minFare: decimal('min_fare', { precision: 14, scale: 2 }).notNull(),
    maxFare: decimal('max_fare', { precision: 14, scale: 2 }).notNull(),
    poolDiscount: decimal('pool_discount', { precision: 5, scale: 2 }).notNull().default('0.30'),
    nightSurcharge: decimal('night_surcharge', { precision: 5, scale: 2 }).notNull().default('1.25'),
    waitingFeePerMin: decimal('waiting_fee_per_min', { precision: 14, scale: 2 }).notNull().default('2.00'),
    platformFee: decimal('platform_fee', { precision: 14, scale: 2 }).notNull().default('5.00'),
    gstPct: decimal('gst_pct', { precision: 5, scale: 2 }).notNull().default('5.00'),
    surgeCeiling: decimal('surge_ceiling', { precision: 4, scale: 2 }).notNull().default('2.50'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    campusTypeIdx: uniqueIndex('idx_ride_fare_configs_unique').on(
      table.campusId,
      table.vehicleType,
      table.effectiveFrom,
    ),
  }),
);

export const ridePromotions = pgTable(
  'ride_promotions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campusId: uuid('campus_id').references(() => campuses.id),
    code: varchar('code', { length: 32 }).notNull().unique(),
    title: varchar('title', { length: 128 }).notNull(),
    description: text('description'),
    bannerUrl: text('banner_url'),
    discountType: varchar('discount_type', { length: 16 }).notNull(), // flat | percent
    discountValue: decimal('discount_value', { precision: 14, scale: 2 }).notNull(),
    maxDiscount: decimal('max_discount', { precision: 14, scale: 2 }),
    minRideValue: decimal('min_ride_value', { precision: 14, scale: 2 }).notNull().default('0'),
    usageLimit: integer('usage_limit'),
    usagePerUser: integer('usage_per_user').notNull().default(1),
    usageCount: integer('usage_count').notNull().default(0),
    rideTypes: jsonb('ride_types').$type<string[]>().notNull().default([]),
    applicableHours: jsonb('applicable_hours')
      .$type<{ startHour: number; endHour: number }>()
      .notNull()
      .default({ startHour: 0, endHour: 24 }),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    codeIdx: uniqueIndex('idx_ride_promotions_code').on(table.code),
    campusIdx: index('idx_ride_promotions_campus').on(table.campusId),
  }),
);

export const ridePayments = pgTable(
  'ride_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rideRequests.id, { onDelete: 'cascade' }),
    riderId: uuid('rider_id')
      .notNull()
      .references(() => users.id),
    driverId: uuid('driver_id').references(() => rideDrivers.id),
    amount: decimal('amount', { precision: 14, scale: 2 }).notNull(),
    tax: decimal('tax', { precision: 14, scale: 2 }).notNull().default('0'),
    tip: decimal('tip', { precision: 14, scale: 2 }).notNull().default('0'),
    platformFee: decimal('platform_fee', { precision: 14, scale: 2 }).notNull().default('0'),
    total: decimal('total', { precision: 14, scale: 2 }).notNull(),
    method: paymentMethodEnum('method').notNull(),
    status: paymentStatusEnum('status').notNull().default('pending'),
    gatewayOrderId: varchar('gateway_order_id', { length: 128 }),
    gatewayPaymentId: varchar('gateway_payment_id', { length: 128 }),
    gatewaySignature: text('gateway_signature'),
    codCollectedAt: timestamp('cod_collected_at', { withTimezone: true }),
    codCollectedBy: uuid('cod_collected_by'),
    refundAmount: decimal('refund_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    refundReason: text('refund_reason'),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    invoiceUrl: text('invoice_url'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    rideIdx: index('idx_ride_payments_ride').on(table.rideId),
    riderIdx: index('idx_ride_payments_rider').on(table.riderId),
    statusIdx: index('idx_ride_payments_status').on(table.status),
    gatewayIdx: index('idx_ride_payments_gateway').on(table.gatewayOrderId),
  }),
);

export const rideCodVerifications = pgTable(
  'ride_cod_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rideRequests.id, { onDelete: 'cascade' }),
    riderId: uuid('rider_id')
      .notNull()
      .references(() => users.id),
    driverId: uuid('driver_id').references(() => rideDrivers.id),
    otpHash: varchar('otp_hash', { length: 128 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: smallint('attempts').notNull().default(0),
    maxAttempts: smallint('max_attempts').notNull().default(5),
    status: codVerificationStatusEnum('status').notNull().default('pending'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    rideIdx: index('idx_ride_cod_ride').on(table.rideId),
    statusIdx: index('idx_ride_cod_status').on(table.status),
  }),
);

// ----- SOS, Incidents & Safety ----------------------------------------

export const rideSosEvents = pgTable(
  'ride_sos_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rideId: uuid('ride_id').references(() => rideRequests.id),
    triggeredBy: uuid('triggered_by')
      .notNull()
      .references(() => users.id),
    driverId: uuid('driver_id').references(() => rideDrivers.id),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    lat: decimal('lat', { precision: 10, scale: 7 }),
    lng: decimal('lng', { precision: 10, scale: 7 }),
    audioClipUrl: text('audio_clip_url'),
    videoClipUrl: text('video_clip_url'),
    note: text('note'),
    severity: incidentSeverityEnum('severity').notNull().default('high'),
    status: sosStatusEnum('status').notNull().default('triggered'),
    acknowledgedBy: uuid('acknowledged_by').references(() => users.id),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    authoritiesNotified: boolean('authorities_notified').notNull().default(false),
    authorityReferenceId: varchar('authority_reference_id', { length: 128 }),
    timeline: jsonb('timeline')
      .$type<Array<{ at: string; actor: string; action: string; note?: string }>>()
      .notNull()
      .default([]),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    rideIdx: index('idx_ride_sos_ride').on(table.rideId),
    statusIdx: index('idx_ride_sos_status').on(table.status),
    campusIdx: index('idx_ride_sos_campus').on(table.campusId),
    createdIdx: index('idx_ride_sos_created').on(table.createdAt),
  }),
);

export const rideIncidents = pgTable(
  'ride_incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rideId: uuid('ride_id').references(() => rideRequests.id),
    reportedBy: uuid('reported_by')
      .notNull()
      .references(() => users.id),
    reportedAgainst: uuid('reported_against').references(() => users.id),
    driverId: uuid('driver_id').references(() => rideDrivers.id),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    category: varchar('category', { length: 64 }).notNull(), // late | rude | unsafe | damage | overcharge | lost_item | other
    severity: incidentSeverityEnum('severity').notNull().default('medium'),
    description: text('description').notNull(),
    evidence: jsonb('evidence')
      .$type<Array<{ url: string; kind: 'image' | 'video' | 'audio' | 'log'; uploadedAt: string }>>()
      .notNull()
      .default([]),
    status: incidentStatusEnum('status').notNull().default('reported'),
    assignedTo: uuid('assigned_to').references(() => users.id),
    resolution: text('resolution'),
    refundedAmount: decimal('refunded_amount', { precision: 14, scale: 2 }),
    penaltyIssued: boolean('penalty_issued').notNull().default(false),
    penaltyAmount: decimal('penalty_amount', { precision: 14, scale: 2 }),
    timeline: jsonb('timeline')
      .$type<Array<{ at: string; actor: string; action: string; note?: string }>>()
      .notNull()
      .default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    rideIdx: index('idx_ride_incidents_ride').on(table.rideId),
    statusIdx: index('idx_ride_incidents_status').on(table.status),
    campusIdx: index('idx_ride_incidents_campus').on(table.campusId),
    categoryIdx: index('idx_ride_incidents_category').on(table.category),
  }),
);

// ----- Luggage, Skins & Vehicle Scans ----------------------------------

export const rideLuggageConfigs = pgTable(
  'ride_luggage_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rideRequests.id, { onDelete: 'cascade' }),
    riderId: uuid('rider_id')
      .notNull()
      .references(() => users.id),
    pieces: smallint('pieces').notNull().default(1),
    totalWeightKg: decimal('total_weight_kg', { precision: 6, scale: 2 }),
    sizeBreakdown: jsonb('size_breakdown')
      .$type<Array<{ size: 'cabin' | 'medium' | 'large'; count: number }>>()
      .notNull()
      .default([]),
    fragile: boolean('fragile').notNull().default(false),
    requiresBoots: boolean('requires_boots').notNull().default(true),
    assistance: boolean('assistance').notNull().default(false),
    notes: text('notes'),
    declaredAt: timestamp('declared_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    rideIdx: uniqueIndex('idx_ride_luggage_ride').on(table.rideId),
  }),
);

export const rideSkins = pgTable(
  'ride_skins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 64 }).notNull().unique(),
    name: varchar('name', { length: 128 }).notNull(),
    rarity: skinRarityEnum('rarity').notNull().default('common'),
    thumbnailUrl: text('thumbnail_url').notNull(),
    heroUrl: text('hero_url'),
    description: text('description'),
    palette: jsonb('palette')
      .$type<{ primary: string; secondary: string; accent: string; glow: string }>()
      .notNull(),
    shaderCode: text('shader_code'),
    unlockCriteria: jsonb('unlock_criteria')
      .$type<{ type: 'rides' | 'tier' | 'promo' | 'event'; threshold?: number; code?: string }>()
      .notNull(),
    isAnimated: boolean('is_animated').notNull().default(false),
    isLimited: boolean('is_limited').notNull().default(false),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    rarityIdx: index('idx_ride_skins_rarity').on(table.rarity),
  }),
);

export const rideSkinSelections = pgTable(
  'ride_skin_selections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skinId: uuid('skin_id')
      .notNull()
      .references(() => rideSkins.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    appliedToVehicleId: uuid('applied_to_vehicle_id').references(() => rideVehicles.id),
    selectedAt: timestamp('selected_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_ride_skin_sel_user').on(table.userId),
    skinIdx: index('idx_ride_skin_sel_skin').on(table.skinId),
  }),
);

export const rideVehicleScans = pgTable(
  'ride_vehicle_scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => rideVehicles.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => rideDrivers.id),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    scanType: varchar('scan_type', { length: 32 }).notNull(), // pre_trip | post_trip | diagnostic
    exteriorScore: decimal('exterior_score', { precision: 5, scale: 2 }),
    interiorScore: decimal('interior_score', { precision: 5, scale: 2 }),
    tireScore: decimal('tire_score', { precision: 5, scale: 2 }),
    lightScore: decimal('light_score', { precision: 5, scale: 2 }),
    cleanlinessScore: decimal('cleanliness_score', { precision: 5, scale: 2 }),
    modelUrl: text('model_url'),
    thumbnailUrl: text('thumbnail_url'),
    anomalies: jsonb('anomalies')
      .$type<Array<{ code: string; severity: string; note: string }>>()
      .notNull()
      .default([]),
    rawReport: jsonb('raw_report').$type<Record<string, unknown>>().notNull().default({}),
    scanStartedAt: timestamp('scan_started_at', { withTimezone: true }).notNull().defaultNow(),
    scanCompletedAt: timestamp('scan_completed_at', { withTimezone: true }),
  },
  (table) => ({
    vehicleIdx: index('idx_ride_vehicle_scans_vehicle').on(table.vehicleId),
    driverIdx: index('idx_ride_vehicle_scans_driver').on(table.driverId),
    typeIdx: index('idx_ride_vehicle_scans_type').on(table.scanType),
  }),
);

export const rideMaintenanceLogs = pgTable(
  'ride_maintenance_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => rideVehicles.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id').references(() => rideDrivers.id),
    type: maintenanceTypeEnum('type').notNull(),
    summary: varchar('summary', { length: 256 }).notNull(),
    description: text('description'),
    parts: jsonb('parts')
      .$type<Array<{ name: string; cost: number; vendor?: string }>>()
      .notNull()
      .default([]),
    labourCost: decimal('labour_cost', { precision: 14, scale: 2 }).notNull().default('0'),
    partsCost: decimal('parts_cost', { precision: 14, scale: 2 }).notNull().default('0'),
    totalCost: decimal('total_cost', { precision: 14, scale: 2 }).notNull().default('0'),
    odometerKm: integer('odometer_km'),
    vendor: varchar('vendor', { length: 128 }),
    invoiceUrl: text('invoice_url'),
    performedBy: varchar('performed_by', { length: 128 }),
    performedAt: timestamp('performed_at', { withTimezone: true }).notNull().defaultNow(),
    nextDueAt: timestamp('next_due_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => ({
    vehicleIdx: index('idx_ride_maint_vehicle').on(table.vehicleId),
    typeIdx: index('idx_ride_maint_type').on(table.type),
    performedIdx: index('idx_ride_maint_performed').on(table.performedAt),
  }),
);

// ----- Fleet Deployment & Logistics -----------------------------------

export const rideFleetDeployments = pgTable(
  'ride_fleet_deployments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 128 }).notNull(),
    description: text('description'),
    zoneIds: jsonb('zone_ids').$type<string[]>().notNull().default([]),
    driverIds: jsonb('driver_ids').$type<string[]>().notNull().default([]),
    vehicleIds: jsonb('vehicle_ids').$type<string[]>().notNull().default([]),
    status: deploymentStatusEnum('status').notNull().default('planned'),
    scheduledFrom: timestamp('scheduled_from', { withTimezone: true }).notNull(),
    scheduledTo: timestamp('scheduled_to', { withTimezone: true }).notNull(),
    surgeFactor: decimal('surge_factor', { precision: 4, scale: 2 }).notNull().default('1.00'),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    campusStatusIdx: index('idx_ride_deploy_campus_status').on(table.campusId, table.status),
    scheduledIdx: index('idx_ride_deploy_scheduled').on(table.scheduledFrom),
  }),
);

export const rideHeatmapPredictions = pgTable(
  'ride_heatmap_predictions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id, { onDelete: 'cascade' }),
    bucket: timestamp('bucket', { withTimezone: true }).notNull(),
    lat: decimal('lat', { precision: 10, scale: 7 }).notNull(),
    lng: decimal('lng', { precision: 10, scale: 7 }).notNull(),
    demandScore: decimal('demand_score', { precision: 6, scale: 2 }).notNull(),
    supplyScore: decimal('supply_score', { precision: 6, scale: 2 }).notNull(),
    recommendedDrivers: integer('recommended_drivers').notNull().default(0),
    confidence: decimal('confidence', { precision: 5, scale: 2 }).notNull().default('0.50'),
    modelVersion: varchar('model_version', { length: 32 }).notNull().default('v1'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    campusBucketIdx: index('idx_ride_heatmap_campus_bucket').on(table.campusId, table.bucket),
    geoIdx: index('idx_ride_heatmap_geo').on(table.lat, table.lng),
  }),
);

// ----- Places, Saved & Recent -----------------------------------------

export const ridePlaces = pgTable(
  'ride_places',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campusId: uuid('campus_id').references(() => campuses.id),
    kind: varchar('kind', { length: 32 }).notNull(), // saved | recent | popular | landmark
    label: varchar('label', { length: 128 }).notNull(),
    address: text('address'),
    lat: decimal('lat', { precision: 10, scale: 7 }).notNull(),
    lng: decimal('lng', { precision: 10, scale: 7 }).notNull(),
    icon: varchar('icon', { length: 64 }),
    popularity: integer('popularity').notNull().default(0),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    campusKindIdx: index('idx_ride_places_campus_kind').on(table.campusId, table.kind),
    geoIdx: index('idx_ride_places_geo').on(table.lat, table.lng),
  }),
);

export const rideUserPlaces = pgTable(
  'ride_user_places',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 128 }).notNull(), // home | work | hostel | class | custom
    customLabel: varchar('custom_label', { length: 128 }),
    address: text('address'),
    lat: decimal('lat', { precision: 10, scale: 7 }).notNull(),
    lng: decimal('lng', { precision: 10, scale: 7 }).notNull(),
    icon: varchar('icon', { length: 64 }),
    sortOrder: integer('sort_order').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_ride_user_places_user').on(table.userId),
    labelIdx: uniqueIndex('idx_ride_user_places_label').on(table.userId, table.label),
  }),
);

// ----- Ratings & Reviews -----------------------------------------------

export const rideRatings = pgTable(
  'ride_ratings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rideRequests.id, { onDelete: 'cascade' }),
    raterId: uuid('rater_id')
      .notNull()
      .references(() => users.id),
    rateeId: uuid('ratee_id')
      .notNull()
      .references(() => users.id),
    rating: smallint('rating').notNull(),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    comment: text('comment'),
    isPublic: boolean('is_public').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    rideIdx: uniqueIndex('idx_ride_ratings_ride').on(table.rideId, table.raterId),
    rateeIdx: index('idx_ride_ratings_ratee').on(table.rateeId, table.createdAt),
  }),
);

// ----- Curators & Rewards ---------------------------------------------

export const rideCurators = pgTable(
  'ride_curators',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    displayName: varchar('display_name', { length: 128 }).notNull(),
    avatarUrl: text('avatar_url'),
    tier: curatorTierEnum('tier').notNull().default('bronze'),
    curatorScore: decimal('curator_score', { precision: 6, scale: 2 }).notNull().default('0'),
    ridesCurated: integer('rides_curated').notNull().default(0),
    issuesResolved: integer('issues_resolved').notNull().default(0),
    tribesLed: integer('tribes_led').notNull().default(0),
    ritualsCompleted: integer('rituals_completed').notNull().default(0),
    biweeklyPoints: integer('biweekly_points').notNull().default(0),
    lifetimePoints: integer('lifetime_points').notNull().default(0),
    trainingCompleted: jsonb('training_completed')
      .$type<string[]>()
      .notNull()
      .default([]),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
    isActive: boolean('is_active').notNull().default(true),
  },
  (table) => ({
    userIdx: uniqueIndex('idx_ride_curators_user').on(table.userId),
    campusIdx: index('idx_ride_curators_campus').on(table.campusId),
    scoreIdx: index('idx_ride_curators_score').on(table.curatorScore),
  }),
);

export const rideCuratorShifts = pgTable(
  'ride_curator_shifts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    curatorId: uuid('curator_id')
      .notNull()
      .references(() => rideCurators.id, { onDelete: 'cascade' }),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    scheduledStart: timestamp('scheduled_start', { withTimezone: true }).notNull(),
    scheduledEnd: timestamp('scheduled_end', { withTimezone: true }).notNull(),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    checkedOutAt: timestamp('checked_out_at', { withTimezone: true }),
    breaks: jsonb('breaks')
      .$type<Array<{ startedAt: string; endedAt?: string; reason?: string }>>()
      .notNull()
      .default([]),
    status: curatorShiftStatusEnum('status').notNull().default('scheduled'),
    ridesMonitored: integer('rides_monitored').notNull().default(0),
    issuesHandled: integer('issues_handled').notNull().default(0),
    pointsEarned: integer('points_earned').notNull().default(0),
    notes: text('notes'),
  },
  (table) => ({
    curatorIdx: index('idx_ride_curator_shifts_curator').on(table.curatorId),
    scheduledIdx: index('idx_ride_curator_shifts_sched').on(table.scheduledStart),
    statusIdx: index('idx_ride_curator_shifts_status').on(table.status),
  }),
);

export const rideCuratorLeaderboard = pgTable(
  'ride_curator_leaderboard',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    period: varchar('period', { length: 16 }).notNull(), // weekly | biweekly | monthly
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    curatorId: uuid('curator_id')
      .notNull()
      .references(() => rideCurators.id, { onDelete: 'cascade' }),
    rank: integer('rank').notNull(),
    score: integer('score').notNull(),
    ridesCurated: integer('rides_curated').notNull().default(0),
    issuesResolved: integer('issues_resolved').notNull().default(0),
    bonusPoints: integer('bonus_points').notNull().default(0),
    reward: jsonb('reward')
      .$type<{ type: 'cash' | 'coin' | 'badge' | 'coupon'; value: number; label: string }>()
      .default({ type: 'coin', value: 0, label: '' }),
  },
  (table) => ({
    campusPeriodIdx: index('idx_ride_curator_lb_campus_period').on(table.campusId, table.period, table.periodStart),
    rankIdx: uniqueIndex('idx_ride_curator_lb_rank').on(table.campusId, table.period, table.periodStart, table.curatorId),
  }),
);

export const rideRewards = pgTable(
  'ride_rewards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    tier: curatorTierEnum('tier').notNull().default('bronze'),
    points: integer('points').notNull().default(0),
    lifetimePoints: integer('lifetime_points').notNull().default(0),
    streakDays: integer('streak_days').notNull().default(0),
    badges: jsonb('badges')
      .$type<Array<{ code: string; name: string; earnedAt: string }>>()
      .notNull()
      .default([]),
    milestones: jsonb('milestones')
      .$type<Array<{ code: string; reachedAt: string; points: number }>>()
      .notNull()
      .default([]),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: uniqueIndex('idx_ride_rewards_user').on(table.userId),
    campusIdx: index('idx_ride_rewards_campus').on(table.campusId),
    pointsIdx: index('idx_ride_rewards_points').on(table.points),
  }),
);

export const rideAuditLogs = pgTable(
  'ride_audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id),
    actorRole: varchar('actor_role', { length: 32 }),
    action: varchar('action', { length: 128 }).notNull(),
    entity: varchar('entity', { length: 64 }).notNull(),
    entityId: uuid('entity_id'),
    rideId: uuid('ride_id'),
    campusId: uuid('campus_id'),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    actorIdx: index('idx_ride_audit_actor').on(table.actorId),
    entityIdx: index('idx_ride_audit_entity').on(table.entity, table.entityId),
    createdIdx: index('idx_ride_audit_created').on(table.createdAt),
  }),
);
