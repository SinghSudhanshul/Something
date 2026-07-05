/**
 * @nexus/types
 *
 * Single source of truth for all shared type definitions across NEXUS services.
 * No type duplication — every service imports from this package.
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Enums
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const UserRole = {
  STUDENT: 'student',
  VENDOR: 'vendor',
  DRIVER: 'driver',
  MODERATOR: 'moderator',
  CAMPUS_ADMIN: 'campus_admin',
  SUPER_ADMIN: 'super_admin',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const VerificationLevel = {
  EMAIL: 1,
  STUDENT_ID: 2,
  FACE_MATCH: 3,
  AADHAAR: 4,
} as const;
export type VerificationLevel = (typeof VerificationLevel)[keyof typeof VerificationLevel];

export const TrustTier = {
  NEW: 'new',
  BUILDING: 'building',
  TRUSTED: 'trusted',
  VERIFIED: 'verified',
  ELITE: 'elite',
} as const;
export type TrustTier = (typeof TrustTier)[keyof typeof TrustTier];

export const Module = {
  BAZAAR: 'bazaar',
  SKILLS: 'skills',
  FEAST: 'feast',
  SWIFT: 'swift',
  RIDES: 'rides',
  PULSE: 'pulse',
} as const;
export type Module = (typeof Module)[keyof typeof Module];

export const TransactionStatus = {
  INITIATED: 'initiated',
  PAYMENT_HELD: 'payment_held',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  DISPUTED: 'disputed',
  REFUNDED: 'refunded',
} as const;
export type TransactionStatus = (typeof TransactionStatus)[keyof typeof TransactionStatus];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Kafka Topic Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const KafkaTopics = {
  // User events
  USER_CREATED: 'nexus.users.created',
  USER_UPDATED: 'nexus.users.updated',
  USER_VERIFIED: 'nexus.users.verified',
  USER_SUSPENDED: 'nexus.users.suspended',

  // Transaction events
  TRANSACTION_INITIATED: 'nexus.transactions.initiated',
  TRANSACTION_COMPLETED: 'nexus.transactions.completed',
  TRANSACTION_FAILED: 'nexus.transactions.failed',
  TRANSACTION_REFUNDED: 'nexus.transactions.refunded',
  TRANSACTION_DISPUTED: 'nexus.transactions.disputed',

  // Listing events
  LISTING_CREATED: 'nexus.listings.created',
  LISTING_UPDATED: 'nexus.listings.updated',
  LISTING_SOLD: 'nexus.listings.sold',
  LISTING_REMOVED: 'nexus.listings.removed',

  // Review events
  REVIEW_CREATED: 'nexus.reviews.created',

  // Wallet events
  WALLET_CREDITED: 'nexus.wallet.credited',
  WALLET_DEBITED: 'nexus.wallet.debited',
  WALLET_ESCROW_HELD: 'nexus.wallet.escrow.held',
  WALLET_ESCROW_RELEASED: 'nexus.wallet.escrow.released',

  // Order events
  ORDER_PLACED: 'nexus.orders.placed',
  ORDER_ACCEPTED: 'nexus.orders.accepted',
  ORDER_COMPLETED: 'nexus.orders.completed',
  ORDER_CANCELLED: 'nexus.orders.cancelled',

  // Ride events
  RIDE_REQUESTED: 'nexus.rides.requested',
  RIDE_MATCHED: 'nexus.rides.matched',
  RIDE_STARTED: 'nexus.rides.started',
  RIDE_COMPLETED: 'nexus.rides.completed',
  RIDE_CANCELLED: 'nexus.rides.cancelled',
  RIDE_DRIVER_REGISTERED: 'nexus.rides.driver_registered',
  RIDE_SOS_TRIGGERED: 'nexus.rides.sos_triggered',
  RIDE_SOS_RESOLVED: 'nexus.rides.sos_resolved',

  // Notification events
  NOTIFICATION_SEND: 'nexus.notifications.send',
  NOTIFICATION_DELIVERED: 'nexus.notifications.delivered',
  NOTIFICATION_DELIVERY_FAILED: 'nexus.notifications.delivery_failed',

  // Trust events
  TRUST_SCORE_UPDATED: 'nexus.trust.score.updated',
  TRUST_REPORT_CREATED: 'nexus.trust.report.created',
  TRUST_DISPUTE_OPENED: 'nexus.trust.dispute.opened',
  TRUST_DISPUTE_RESOLVED: 'nexus.trust.dispute.resolved',
  TRUST_FRAUD_FLAG: 'nexus.trust.fraud_flag',
  TRUST_NIGHTLY_RECOMPUTE_COMPLETE: 'nexus.trust.nightly_recompute_complete',

  // Search events
  SEARCH_INDEX_UPDATE: 'nexus.search.index.update',
  SEARCH_INDEX_DELETE: 'nexus.search.index.delete',

  // Analytics events
  ANALYTICS_EVENT: 'nexus.analytics.event',
  ANALYTICS_PAGEVIEW: 'nexus.analytics.pageview',

  // ── Phase 2 Topics ──────────────────────────────
  COLLABORATION_APPLICATION_RESPONDED: 'nexus.collaboration.application_responded',


  // Bazaar / Listing events (Phase 2A)
  LISTING_DELETED: 'nexus.listings.deleted',
  TRANSACTION_ESCROW_LOCKED: 'nexus.transactions.escrow_locked',

  // Feast Events (Phase 2F)
  FEAST_ORDER_PLACED: 'nexus.feast.order_placed',
  FEAST_ORDER_UPDATED: 'nexus.feast.order_updated',
  FEAST_ORDER_CANCELLED: 'nexus.feast.order_cancelled',
  DELIVERY_ASSIGNED: 'nexus.feast.delivery_assigned',
  FEAST_CANTEEN_ONBOARDED: 'nexus.feast.canteen_onboarded',
  FEAST_CANTEEN_SUSPENDED: 'nexus.feast.canteen_suspended',
  FEAST_FSSAI_EXPIRING: 'nexus.feast.fssai_expiring',

  // Swift / Task events (Phase 2C)
  TASK_CREATED: 'nexus.tasks.created',
  TASK_APPLICATION_RECEIVED: 'nexus.tasks.application_received',
  TASK_RUNNER_ACCEPTED: 'nexus.tasks.runner_accepted',
  TASK_COMPLETION_SUBMITTED: 'nexus.tasks.completion_submitted',
  TASK_COMPLETION_REJECTED: 'nexus.tasks.completion_rejected',
  TASK_COMPLETED: 'nexus.tasks.completed',
  TASK_DISPUTED: 'nexus.tasks.disputed',
  TASK_EXPIRED: 'nexus.tasks.expired',
  GIG_RUNNER_ACCEPTED: 'nexus.gigs.runner_accepted',
  GIG_APPLICATION_REJECTED: 'nexus.gigs.application_rejected',
  GIG_APPLICATION_RECEIVED: 'nexus.gigs.application_received',
  GIG_EXPIRED: 'nexus.gigs.expired',
  GIG_CREATED: 'nexus.gigs.created',
  GIG_UPDATED: 'nexus.gigs.updated',

  // Skills events (Phase 2E)
  SKILL_ORDER_PLACED: 'nexus.skills.order_placed',
  SKILL_DELIVERY_SUBMITTED: 'nexus.skills.delivery_submitted',
  SKILL_ORDER_COMPLETED: 'nexus.skills.order_completed',
  SKILL_REVISION_REQUESTED: 'nexus.skills.revision_requested',
  SKILL_AUTO_RELEASED: 'nexus.skills.auto_released',

  // Pulse events (Phase 2D)
  PULSE_EVENT_CREATED: 'nexus.pulse.event_created',
  PULSE_TICKETS_PURCHASED: 'nexus.pulse.tickets_purchased',

  // Trust tier upgrades
  TRUST_TIER_UPGRADED: 'nexus.users.trust_tier_upgraded',

  // Notification trigger (cross-service)
  NOTIFICATION_TRIGGER: 'nexus.notifications.trigger',

  // Dead Letter Queue
  DLQ_BAZAAR: 'nexus.dlq.bazaar',
  DLQ_FEAST: 'nexus.dlq.feast',
  DLQ_SWIFT: 'nexus.dlq.swift',
  DLQ_PULSE: 'nexus.dlq.pulse',
  DLQ_SKILLS: 'nexus.dlq.skills',
  DLQ_TRUST: 'nexus.dlq.trust',
  DLQ_NOTIFICATIONS: 'nexus.dlq.notifications',
  DLQ_SEARCH: 'nexus.dlq.search',

  // Student ID verification (Phase 3B consumer)
  USER_STUDENT_ID_VERIFIED: 'nexus.users.student_id_verified',
} as const;
export type KafkaTopic = (typeof KafkaTopics)[keyof typeof KafkaTopics];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Event Interface
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface NexusEvent<T = unknown> {
  type: KafkaTopic;
  payload: T;
  timestamp: string;
  correlationId: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// JWT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface JWTPayload {
  sub: string;
  email: string;
  roles: UserRole[];
  campus_id: string;
  verification_level: VerificationLevel;
  trust_tier: TrustTier;
  jti: string;
  iat: number;
  exp: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API Response Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  cursor: string | null;
  hasMore: boolean;
  total: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Auth Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface DeviceFingerprint {
  deviceId: string;
  userAgent: string;
  ipAddress: string;
  fingerprint: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Listing Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const ListingCategory = {
  BOOKS: 'books',
  ELECTRONICS: 'electronics',
  FURNITURE: 'furniture',
  CLOTHING: 'clothing',
  SPORTS: 'sports',
  STATIONERY: 'stationery',
  OTHER: 'other',
} as const;
export type ListingCategory = (typeof ListingCategory)[keyof typeof ListingCategory];

export const ListingCondition = {
  NEW: 'new',
  LIKE_NEW: 'like_new',
  GOOD: 'good',
  FAIR: 'fair',
  ROUGH: 'rough',
} as const;
export type ListingCondition = (typeof ListingCondition)[keyof typeof ListingCondition];

export const ListingType = {
  FIXED: 'fixed',
  NEGOTIABLE: 'negotiable',
  AUCTION: 'auction',
  RENTAL: 'rental',
} as const;
export type ListingType = (typeof ListingType)[keyof typeof ListingType];

export const OfferStatus = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  WITHDRAWN: 'withdrawn',
} as const;
export type OfferStatus = (typeof OfferStatus)[keyof typeof OfferStatus];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Feast Types (Phase 2B)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const FeastOrderStatus = {
  PENDING_PAYMENT: 'pending_payment',
  PAYMENT_HELD: 'payment_held',
  PREPARING: 'preparing',
  READY: 'ready',
  PICKED_UP: 'picked_up',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
} as const;
export type FeastOrderStatus = (typeof FeastOrderStatus)[keyof typeof FeastOrderStatus];

export const DeliveryType = {
  PICKUP: 'pickup',
  DELIVERY: 'delivery',
} as const;
export type DeliveryType = (typeof DeliveryType)[keyof typeof DeliveryType];

export const MenuCustomizationType = {
  SINGLE: 'single',
  MULTI: 'multi',
} as const;
export type MenuCustomizationType = (typeof MenuCustomizationType)[keyof typeof MenuCustomizationType];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Swift Types (Phase 2C)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const TaskStatus = {
  OPEN: 'open',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  PENDING_VERIFICATION: 'pending_verification',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  DISPUTED: 'disputed',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TaskCategory = {
  DELIVERY: 'delivery',
  PURCHASE: 'purchase',
  QUEUE: 'queue',
  MISC: 'misc',
  TECH_HELP: 'tech_help',
  OTHER: 'other',
} as const;
export type TaskCategory = (typeof TaskCategory)[keyof typeof TaskCategory];

export const TaskApplicationStatus = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  WITHDRAWN: 'withdrawn',
} as const;
export type TaskApplicationStatus = (typeof TaskApplicationStatus)[keyof typeof TaskApplicationStatus];

export const CompletionProofType = {
  PHOTO: 'photo',
  GPS_PIN: 'gps_pin',
  TEXT: 'text',
} as const;
export type CompletionProofType = (typeof CompletionProofType)[keyof typeof CompletionProofType];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Skills Types (Phase 2E)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const SkillCategory = {
  TUTORING: 'tutoring',
  DESIGN: 'design',
  CODING: 'coding',
  MUSIC: 'music',
  FITNESS: 'fitness',
  LANGUAGE: 'language',
  PHOTOGRAPHY: 'photography',
  WRITING: 'writing',
  OTHER: 'other',
} as const;
export type SkillCategory = (typeof SkillCategory)[keyof typeof SkillCategory];

export const SkillOrderStatus = {
  PENDING_PAYMENT: 'pending_payment',
  PAYMENT_HELD: 'payment_held',
  IN_PROGRESS: 'in_progress',
  PENDING_REVIEW: 'pending_review',
  REVISION_REQUESTED: 'revision_requested',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  DISPUTED: 'disputed',
} as const;
export type SkillOrderStatus = (typeof SkillOrderStatus)[keyof typeof SkillOrderStatus];

export const MilestoneStatus = {
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  REVISION_REQUESTED: 'revision_requested',
} as const;
export type MilestoneStatus = (typeof MilestoneStatus)[keyof typeof MilestoneStatus];

export const SkillListingStatus = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  REMOVED: 'removed',
} as const;
export type SkillListingStatus = (typeof SkillListingStatus)[keyof typeof SkillListingStatus];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Pulse Types (Phase 2D)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const EventType = {
  CULTURAL: 'cultural',
  TECHNICAL: 'technical',
  SPORTS: 'sports',
  SOCIAL: 'social',
  WORKSHOP: 'workshop',
  COMPETITION: 'competition',
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

export const TicketStatus = {
  RESERVED: 'reserved',
  CONFIRMED: 'confirmed',
  USED: 'used',
  REFUNDED: 'refunded',
} as const;
export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

export const ClubCategory = {
  TECHNICAL: 'technical',
  CULTURAL: 'cultural',
  SPORTS: 'sports',
  SOCIAL: 'social',
  ACADEMIC: 'academic',
} as const;
export type ClubCategory = (typeof ClubCategory)[keyof typeof ClubCategory];

export const ClubMemberRole = {
  MEMBER: 'member',
  OFFICER: 'officer',
  LEAD: 'lead',
} as const;
export type ClubMemberRole = (typeof ClubMemberRole)[keyof typeof ClubMemberRole];

export const ListingStatus = {
  ACTIVE: 'active',
  RESERVED: 'reserved',
  SOLD: 'sold',
  REMOVED: 'removed',
} as const;
export type ListingStatus = (typeof ListingStatus)[keyof typeof ListingStatus];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Food / Feast Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const FoodOrderStatus = {
  PLACED: 'placed',
  CONFIRMED: 'confirmed',
  PREPARING: 'preparing',
  READY: 'ready',
  PICKED_UP: 'picked_up',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
} as const;
export type FoodOrderStatus = (typeof FoodOrderStatus)[keyof typeof FoodOrderStatus];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Ride Types (Phase 3A)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const RideStatus = {
  REQUESTED: 'requested',
  OPEN: 'open',
  MATCHING: 'matching',
  MATCHED: 'matched',
  DRIVER_EN_ROUTE: 'driver_en_route',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
} as const;
export type RideStatus = (typeof RideStatus)[keyof typeof RideStatus];

export const RideType = {
  SOLO: 'solo',
  POOL: 'pool',
} as const;
export type RideType = (typeof RideType)[keyof typeof RideType];

export const VehicleType = {
  BICYCLE: 'bicycle',
  MOTORCYCLE: 'motorcycle',
  CAR: 'car',
} as const;
export type VehicleType = (typeof VehicleType)[keyof typeof VehicleType];

export const DriverVerificationDocType = {
  LICENSE: 'license',
  RC_BOOK: 'rc_book',
  INSURANCE: 'insurance',
} as const;
export type DriverVerificationDocType = (typeof DriverVerificationDocType)[keyof typeof DriverVerificationDocType];

export const PoolParticipantStatus = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
} as const;
export type PoolParticipantStatus = (typeof PoolParticipantStatus)[keyof typeof PoolParticipantStatus];

export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Trust Score Constants (Phase 3B)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const TRUST_DELTAS: Record<TrustEventType, number> = {
  review_received: 0.05,
  transaction_completed: 0.03,
  transaction_disputed_lost: -0.15,
  account_age_milestone: 0.02,
  verification_upgraded: 0.10,
  dispute_free_streak: 0.05,
  listing_sold: 0.01,
  gig_completed: 0.03,
  ride_completed: 0.02,
  first_transaction: 0.05,
};

export const FraudAction = {
  ALLOW: 'allow',
  ALLOW_WITH_MONITORING: 'allow_with_monitoring',
  REQUIRE_SELFIE_VERIFICATION: 'require_selfie_verification',
  BLOCK_PENDING_REVIEW: 'block_pending_review',
} as const;
export type FraudAction = (typeof FraudAction)[keyof typeof FraudAction];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Notification Types (Phase 3C)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const NotificationPriority = {
  CRITICAL: 1,
  HIGH: 2,
  NORMAL: 5,
  LOW: 10,
} as const;
export type NotificationPriority = (typeof NotificationPriority)[keyof typeof NotificationPriority];

export const PushPlatform = {
  IOS: 'ios',
  ANDROID: 'android',
  WEB: 'web',
} as const;
export type PushPlatform = (typeof PushPlatform)[keyof typeof PushPlatform];

export const NotificationTemplateType = {
  OTP: 'otp',
  ORDER_STATUS_UPDATE: 'order_status_update',
  RIDE_MATCHED: 'ride_matched',
  RIDE_COMPLETED: 'ride_completed',
  TASK_APPLICATION_RECEIVED: 'task_application_received',
  TASK_COMPLETED: 'task_completed',
  ESCROW_RELEASED: 'escrow_released',
  TRUST_TIER_UPGRADE: 'trust_tier_upgrade',
  PAYMENT_RECEIVED: 'payment_received',
  SOS_TRIGGERED: 'sos_triggered',
  ACCOUNT_SUSPENDED: 'account_suspended',
} as const;
export type NotificationTemplateType = (typeof NotificationTemplateType)[keyof typeof NotificationTemplateType];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Search Types (Phase 3E)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const SemesterContext = {
  EXAM_WEEK: 'exam_week',
  SEMESTER_START: 'semester_start',
  PLACEMENT_SEASON: 'placement_season',
  NORMAL: 'normal',
} as const;
export type SemesterContext = (typeof SemesterContext)[keyof typeof SemesterContext];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Event / Pulse Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const EventCategory = {
  FEST: 'fest',
  HACKATHON: 'hackathon',
  WORKSHOP: 'workshop',
  SPORTS: 'sports',
  SOCIAL: 'social',
  PLACEMENT: 'placement',
  OTHER: 'other',
} as const;
export type EventCategory = (typeof EventCategory)[keyof typeof EventCategory];

export const EventStatus = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
} as const;
export type EventStatus = (typeof EventStatus)[keyof typeof EventStatus];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Notification Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const NotificationChannel = {
  PUSH: 'push',
  SMS: 'sms',
  EMAIL: 'email',
  IN_APP: 'in_app',
} as const;
export type NotificationChannel =
  (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NotificationType = {
  TRANSACTION: 'transaction',
  ORDER: 'order',
  RIDE: 'ride',
  EVENT: 'event',
  SYSTEM: 'system',
  PROMOTION: 'promotion',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Utility Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type Nullable<T> = T | null;

export interface CampusConfig {
  id: string;
  name: string;
  code: string;
  emailDomains: string[];
  timezone: string;
  currency: string;
  features: Record<string, boolean>;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  timestamp: string;
  uptime: number;
}

export type TrustEventType =
  | 'review_received'
  | 'transaction_completed'
  | 'transaction_disputed_lost'
  | 'account_age_milestone'
  | 'verification_upgraded'
  | 'dispute_free_streak'
  | 'listing_sold'
  | 'gig_completed'
  | 'ride_completed'
  | 'first_transaction';

export interface PublicUserProfile {
  id: string;
  full_name: string;
  campus: { name: string; city: string };
  department: string | null;
  avatar_url: string | null;
  trust_score: number;
  trust_tier: TrustTier;
  verification_level: VerificationLevel;
  member_since: string;
  completed_transactions: number;
  avg_rating: number;
  is_blocked_by_me: boolean;
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  RIDE & GO subsystem types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export * from ./ride;

