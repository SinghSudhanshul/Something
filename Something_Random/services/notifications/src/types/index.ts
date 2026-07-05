/**
 * NEXUS Notifications Service — Type Extensions & Shared Enumerations
 *
 * Augments the Fastify request type to include the authenticated user
 * and decorators. Re-exports shared types from @nexus/types for
 * convenience within the notifications service boundary.
 *
 * @module types
 */

import type { drizzle } from 'drizzle-orm/postgres-js';
import type { Redis } from 'ioredis';
import type { Producer } from 'kafkajs';
import type { RequestUser } from '@nexus/utils';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Fastify Augmentation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

declare module 'fastify' {
  interface FastifyInstance {
    db: ReturnType<typeof drizzle>;
    sql: import('postgres').Sql;
    redis: Redis;
    kafka: Producer;
    queueManager: import('../modules/queue/notification.queue.js').NotificationQueueManager;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Notification Priority
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * BullMQ priority levels for notification jobs.
 * Lower values = higher priority. CRITICAL bypasses quiet hours.
 */
export const NotificationPriority = {
  CRITICAL: 1,
  HIGH: 2,
  NORMAL: 5,
  LOW: 10,
} as const;
export type NotificationPriority =
  (typeof NotificationPriority)[keyof typeof NotificationPriority];

/**
 * Checks whether a given priority value represents a critical notification.
 *
 * @param priority - Numeric priority (1 = CRITICAL)
 * @returns true if the notification is critical
 */
export function isCriticalPriority(priority: number): boolean {
  return priority === NotificationPriority.CRITICAL;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Notification Channel
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Delivery channel for a notification. */
export const NotificationChannel = {
  PUSH: 'push',
  SMS: 'sms',
  EMAIL: 'email',
  IN_APP: 'in_app',
} as const;
export type NotificationChannel =
  (typeof NotificationChannel)[keyof typeof NotificationChannel];

/** All valid channel values for iteration. */
export const ALL_CHANNELS: readonly NotificationChannel[] = [
  NotificationChannel.PUSH,
  NotificationChannel.SMS,
  NotificationChannel.EMAIL,
  NotificationChannel.IN_APP,
] as const;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Template Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** All 11 notification template identifiers. */
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
export type NotificationTemplateType =
  (typeof NotificationTemplateType)[keyof typeof NotificationTemplateType];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Push Platform
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Device platform for push token registration. */
export const PushPlatform = {
  IOS: 'ios',
  ANDROID: 'android',
  WEB: 'web',
} as const;
export type PushPlatform = (typeof PushPlatform)[keyof typeof PushPlatform];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Kafka Topics (Notifications-relevant subset)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Kafka topics that this service subscribes to or publishes on.
 * Re-exported from @nexus/types for within-service convenience.
 */
export { KafkaTopics } from '@nexus/types';
export type { KafkaTopic, NexusEvent } from '@nexus/types';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Notification Job
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * BullMQ job payload for all notification workers.
 * Fully serializable (no Date objects, functions, etc.).
 */
export interface NotificationJobData {
  /** UUID of the target user. */
  userId: string;
  /** Delivery channel (determines which worker processes it). */
  channel: NotificationChannel;
  /** Template identifier used to render this notification. */
  templateType: string;
  /** Template interpolation variables. */
  variables: Record<string, string | number>;
  /** Pre-rendered notification title. */
  title: string;
  /** Pre-rendered notification body. */
  body: string;
  /** Optional deep-link / action URL. */
  actionUrl?: string | undefined;
  /** BullMQ priority (1 = CRITICAL, 10 = LOW). */
  priority: number;
  /** Whether this notification is critical (bypasses quiet hours). */
  isCritical: boolean;
  /** Kafka event correlation ID for distributed tracing. */
  correlationId?: string | undefined;
  /** Idempotency key to prevent duplicate delivery. */
  idempotencyKey?: string | undefined;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Notification Log Status
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Status values for the notification_log table. */
export const NotificationLogStatus = {
  QUEUED: 'queued',
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED: 'failed',
} as const;
export type NotificationLogStatus =
  (typeof NotificationLogStatus)[keyof typeof NotificationLogStatus];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Push Token Row
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Row shape from the push_tokens table. */
export interface PushTokenRow {
  id: string;
  user_id: string;
  token: string;
  platform: PushPlatform;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// In-App Notification Row
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Row shape from the in_app_notifications table. */
export interface InAppNotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  action_url: string | null;
  is_read: boolean;
  created_at: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Notification Log Row
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Row shape from the notification_log table. */
export interface NotificationLogRow {
  id: string;
  user_id: string;
  type: string;
  channel: NotificationChannel;
  title: string;
  body: string;
  status: NotificationLogStatus;
  provider_message_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WebSocket Realtime Event
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Shape of a real-time notification event published via Redis Pub/Sub. */
export interface RealtimeNotificationEvent {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  actionUrl: string | null;
  createdAt: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Queue Context
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Queue } from 'bullmq';

/** Container for all four BullMQ queues used by the notification service. */
export interface QueueContext {
  pushQueue: Queue;
  smsQueue: Queue;
  emailQueue: Queue;
  inAppQueue: Queue;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NEXUS Module Names
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Module names used in per-module notification preferences. */
export const NexusModule = {
  BAZAAR: 'bazaar',
  SKILLS: 'skills',
  FEAST: 'feast',
  SWIFT: 'swift',
  RIDES: 'rides',
  PULSE: 'pulse',
  SYSTEM: 'system',
} as const;
export type NexusModule = (typeof NexusModule)[keyof typeof NexusModule];
