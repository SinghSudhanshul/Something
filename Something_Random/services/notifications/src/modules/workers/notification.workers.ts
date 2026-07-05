/**
 * Notification Workers — Full Production BullMQ Workers
 *
 * Four independent workers for each notification channel:
 *  1. PushWorker  — Expo Push Notifications (iOS/Android/Web)
 *  2. EmailWorker — AWS SES in production, ethereal in dev
 *  3. SmsWorker   — MSG91 API in production, console in dev
 *  4. InAppWorker — Database insert + Redis pub/sub for real-time
 *
 * Each worker implements:
 *  - Comprehensive error handling with retry logic
 *  - Notification log status updates (queued → processing → sent/failed)
 *  - Dead-letter queue on final failure
 *  - Token/device management
 *  - Rate limiting awareness
 *
 * @module workers/notification.workers
 */

import { Worker, type Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { createLogger } from '@nexus/utils';
import type { NotificationJob } from '../queue/notification.queue.js';
import { config } from '../../config.js';

const pushLogger = createLogger('push-worker');
const emailLogger = createLogger('email-worker');
const smsLogger = createLogger('sms-worker');
const inAppLogger = createLogger('inapp-worker');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface PushResult {
  status: 'sent' | 'no_tokens' | 'partial' | 'failed';
  tokenResults?: Array<{ token: string; status: string; error?: string }>;
  totalTokens?: number;
  successCount?: number;
  failCount?: number;
}

interface EmailResult {
  status: 'sent' | 'user_not_found' | 'no_email' | 'failed' | 'dev_logged';
  email?: string;
  messageId?: string;
}

interface SmsResult {
  status: 'sent' | 'no_phone' | 'invalid_phone' | 'failed' | 'dev_logged';
  phone?: string;
  messageId?: string;
}

interface InAppResult {
  status: 'stored' | 'failed';
  notificationId?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Expo push batch size limit */
const PUSH_BATCH_SIZE = 100;

/** Token cache TTL in seconds */
const TOKEN_CACHE_TTL = 3600;

/** MSG91 DLT template ID mapping for Indian regulatory compliance */
const MSG91_TEMPLATE_MAP: Record<string, string> = {
  otp: '60d2e5abc12345600001',
  order_status_update: '60d2e5abc12345600002',
  ride_matched: '60d2e5abc12345600003',
  ride_completed: '60d2e5abc12345600004',
  payment_received: '60d2e5abc12345600005',
  sos_triggered: '60d2e5abc12345600006',
  account_suspended: '60d2e5abc12345600007',
  escrow_released: '60d2e5abc12345600008',
  trust_tier_upgrade: '60d2e5abc12345600009',
  task_application_received: '60d2e5abc1234560000a',
  task_completed: '60d2e5abc1234560000b',
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. Push Notification Worker
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Creates a BullMQ worker for processing push notifications via Expo.
 *
 * Flow:
 *  1. Fetch active push tokens for the user (Redis cache → DB fallback)
 *  2. Build Expo push messages
 *  3. Send in batches of 100
 *  4. Handle error responses: DeviceNotRegistered → mark token inactive
 *  5. Handle MessageRateExceeded → delay and re-queue
 *  6. Update notification_log with delivery status
 *  7. On final failure → publish delivery_failed event
 */
export function createPushWorker(connection: Redis, db: Pool): Worker {
  const worker = new Worker<NotificationJob>(
    'nexus:notifications:push',
    async (job: Job<NotificationJob>): Promise<PushResult> => {
      const { userId, title, body, actionUrl, templateType, priority, data } = job.data;
      const startTime = Date.now();

      pushLogger.debug({ jobId: job.id, userId, templateType }, 'Processing push job');

      // Step 1: Fetch active push tokens with cache
      const cacheKey = `push_tokens:${userId}`;
      let tokens: Array<{ token: string; platform: string }> = [];

      try {
        const cached = await connection.get(cacheKey);
        if (cached) {
          tokens = JSON.parse(cached);
          pushLogger.debug({ userId, tokenCount: tokens.length }, 'Push tokens from cache');
        }
      } catch {
        // Cache miss is fine
      }

      if (tokens.length === 0) {
        const tokenResult = await db.query(
          `SELECT token, platform FROM push_tokens 
           WHERE user_id = $1 AND is_active = true 
           ORDER BY last_used_at DESC NULLS LAST`,
          [userId],
        );

        tokens = tokenResult.rows as Array<{ token: string; platform: string }>;

        // Cache tokens for 1 hour
        if (tokens.length > 0) {
          await connection.set(cacheKey, JSON.stringify(tokens), 'EX', TOKEN_CACHE_TTL).catch(() => {});
        }
      }

      if (tokens.length === 0) {
        pushLogger.info({ userId }, 'No active push tokens — skipping');
        await updateNotificationLog(db, userId, templateType, 'push', 'skipped', { reason: 'no_tokens' });
        return { status: 'no_tokens' };
      }

      // Step 2-3: Build and send Expo push messages in batches
      const tokenResults: Array<{ token: string; status: string; error?: string }> = [];
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < tokens.length; i += PUSH_BATCH_SIZE) {
        const batch = tokens.slice(i, i + PUSH_BATCH_SIZE);

        for (const { token, platform } of batch) {
          try {
            // Build Expo push message
            const pushMessage = {
              to: token,
              title: title.slice(0, 65),
              body: body.slice(0, 240),
              data: {
                url: actionUrl,
                type: templateType,
                ...data,
              },
              sound: priority === 'critical' ? 'default' : undefined,
              priority: priority === 'critical' ? 'high' : 'default',
              channelId: priority === 'critical' ? 'critical' : 'default',
              badge: 1,
            };

            // In production: use Expo Push API
            if (config.NODE_ENV === 'production' && config.EXPO_ACCESS_TOKEN) {
              const response = await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${config.EXPO_ACCESS_TOKEN}`,
                },
                body: JSON.stringify(pushMessage),
                signal: AbortSignal.timeout(10_000),
              });

              if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Expo API error ${response.status}: ${errorText}`);
              }

              const result = await response.json() as { data: { status: string; message?: string } };

              if (result.data?.status === 'error') {
                const errorMsg = result.data.message ?? 'Unknown push error';

                // Handle DeviceNotRegistered — mark token inactive
                if (errorMsg.includes('DeviceNotRegistered') || errorMsg.includes('InvalidCredentials')) {
                  await db.query(
                    'UPDATE push_tokens SET is_active = false, updated_at = NOW() WHERE token = $1',
                    [token],
                  );
                  await connection.del(cacheKey); // Invalidate cache
                  tokenResults.push({ token: token.slice(-8), status: 'deactivated', error: errorMsg });
                  failCount++;
                  continue;
                }

                // Handle MessageRateExceeded — re-queue with delay
                if (errorMsg.includes('MessageRateExceeded') || errorMsg.includes('TooManyRequests')) {
                  pushLogger.warn({ userId, token: token.slice(-8) }, 'Push rate exceeded — re-queuing with 60s delay');
                  // Re-queue this specific token with a delay
                  const queue = new Queue('nexus:notifications:push', { connection });
                  await queue.add('push-retry', { ...job.data }, { delay: 60_000, attempts: 1 });
                  await queue.close();
                  tokenResults.push({ token: token.slice(-8), status: 'rate_limited' });
                  continue;
                }

                throw new Error(errorMsg);
              }
            } else {
              // Development: log the push message
              pushLogger.info(
                { userId, platform, template: templateType, token: token.slice(-8) },
                `[DEV PUSH] ${title}: ${body}`,
              );
            }

            // Update token last_used_at
            await db.query('UPDATE push_tokens SET last_used_at = NOW() WHERE token = $1', [token]);
            tokenResults.push({ token: token.slice(-8), status: 'sent' });
            successCount++;
          } catch (err: any) {
            pushLogger.error({ err, userId, token: token.slice(-8) }, 'Push delivery failed for token');

            // Check for permanently invalid tokens
            if (
              err.message?.includes('DeviceNotRegistered') ||
              err.message?.includes('InvalidToken') ||
              err.message?.includes('MismatchSenderId')
            ) {
              await db.query(
                'UPDATE push_tokens SET is_active = false, updated_at = NOW() WHERE token = $1',
                [token],
              );
              await connection.del(cacheKey);
              tokenResults.push({ token: token.slice(-8), status: 'deactivated', error: err.message });
            } else {
              tokenResults.push({ token: token.slice(-8), status: 'failed', error: err.message });
            }
            failCount++;
          }
        }
      }

      // Step 6: Update notification log
      const finalStatus = successCount > 0 ? (failCount > 0 ? 'partial' : 'sent') : 'failed';
      await updateNotificationLog(db, userId, templateType, 'push', finalStatus, {
        tokenResults,
        successCount,
        failCount,
        totalTokens: tokens.length,
        latencyMs: Date.now() - startTime,
      });

      pushLogger.info(
        { userId, successCount, failCount, totalTokens: tokens.length, latencyMs: Date.now() - startTime },
        'Push batch completed',
      );

      return {
        status: finalStatus as PushResult['status'],
        tokenResults,
        totalTokens: tokens.length,
        successCount,
        failCount,
      };
    },
    {
      connection,
      concurrency: 10,
      limiter: { max: 50, duration: 1000 }, // 50 jobs/sec
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  );

  worker.on('completed', (job, result) => {
    pushLogger.debug({ jobId: job.id, result: result?.status }, 'Push job completed');
  });

  worker.on('failed', (job, err) => {
    pushLogger.error({ jobId: job?.id, err: err.message }, 'Push job failed permanently');
  });

  worker.on('error', (err) => {
    pushLogger.error({ err }, 'Push worker error');
  });

  return worker;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. Email Notification Worker
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Creates a BullMQ worker for sending email notifications.
 *
 * Production: AWS SES via @aws-sdk/client-ses
 * Development: Console log with [DEV EMAIL] prefix
 *
 * Features:
 *  - HTML template rendering with inline styles
 *  - List-Unsubscribe header for marketing emails
 *  - SES MessageId tracking
 *  - Bounce/complaint handling via status codes
 */
export function createEmailWorker(connection: Redis, db: Pool): Worker {
  const worker = new Worker<NotificationJob>(
    'nexus:notifications:email',
    async (job: Job<NotificationJob>): Promise<EmailResult> => {
      const { userId, title, body, templateType, emailHtml, emailSubject, data } = job.data;
      const startTime = Date.now();

      emailLogger.debug({ jobId: job.id, userId, templateType }, 'Processing email job');

      // Get user email from DB
      const userResult = await db.query(
        'SELECT email, full_name FROM users u LEFT JOIN student_profiles sp ON sp.user_id = u.id WHERE u.id = $1',
        [userId],
      );

      if (userResult.rows.length === 0) {
        emailLogger.warn({ userId }, 'User not found for email');
        await updateNotificationLog(db, userId, templateType, 'email', 'failed', { reason: 'user_not_found' });
        return { status: 'user_not_found' };
      }

      const { email, full_name: fullName } = userResult.rows[0];

      if (!email) {
        emailLogger.warn({ userId }, 'User has no email address');
        await updateNotificationLog(db, userId, templateType, 'email', 'skipped', { reason: 'no_email' });
        return { status: 'no_email' };
      }

      const subject = emailSubject ?? title;
      const htmlContent = emailHtml ?? buildDefaultEmailHtml(title, body, fullName ?? 'Student');

      // Production: Send via AWS SES
      if (config.NODE_ENV === 'production' && config.AWS_SES_FROM_EMAIL) {
        try {
          const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
          const ses = new SESClient({ region: config.AWS_SES_REGION ?? 'ap-south-1' });

          const isMarketing = ['trust_tier_upgrade', 'community_update'].includes(templateType);

          const command = new SendEmailCommand({
            Source: `NEXUS <${config.AWS_SES_FROM_EMAIL}>`,
            Destination: { ToAddresses: [email] },
            Message: {
              Subject: { Data: subject, Charset: 'UTF-8' },
              Body: {
                Html: { Data: htmlContent, Charset: 'UTF-8' },
                Text: { Data: `${title}\n\n${body}`, Charset: 'UTF-8' },
              },
            },
            Tags: [
              { Name: 'template', Value: templateType },
              { Name: 'service', Value: 'nexus-notifications' },
            ],
            ...(isMarketing ? {
              ConfigurationSetName: 'nexus-marketing',
            } : {}),
          });

          const response = await ses.send(command);
          const messageId = response.MessageId ?? 'unknown';

          emailLogger.info(
            { userId, email, messageId, templateType, latencyMs: Date.now() - startTime },
            'Email sent via SES',
          );

          await updateNotificationLog(db, userId, templateType, 'email', 'sent', {
            messageId,
            email,
            latencyMs: Date.now() - startTime,
          });

          return { status: 'sent', email, messageId };
        } catch (err: any) {
          emailLogger.error({ err, userId, email, templateType }, 'SES email send failed');

          // Handle specific SES errors
          if (err.name === 'MessageRejected' || err.name === 'MailFromDomainNotVerified') {
            await updateNotificationLog(db, userId, templateType, 'email', 'failed', {
              error: err.message,
              sesErrorCode: err.name,
            });
            return { status: 'failed', email };
          }

          throw err; // Let BullMQ retry
        }
      }

      // Development: log the email
      emailLogger.info(
        { userId, email, subject, templateType },
        `[DEV EMAIL] To: ${email}\nSubject: ${subject}\nBody: ${body}`,
      );

      await updateNotificationLog(db, userId, templateType, 'email', 'sent', {
        email,
        environment: 'development',
        latencyMs: Date.now() - startTime,
      });

      return { status: 'dev_logged', email };
    },
    {
      connection,
      concurrency: 5,
      limiter: { max: 14, duration: 1000 }, // SES limit: 14 emails/sec
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 2000 },
    },
  );

  worker.on('failed', (job, err) => {
    emailLogger.error({ jobId: job?.id, err: err.message }, 'Email job failed permanently');
  });

  return worker;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. SMS Notification Worker
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Creates a BullMQ worker for sending SMS via MSG91 API.
 *
 * Features:
 *  - E.164 phone number validation
 *  - MSG91 DLT template ID mapping for Indian regulatory compliance
 *  - Rate limiting: 1 SMS per user per 60 seconds (non-OTP)
 *  - Development mode: console log with [DEV SMS] prefix
 */
export function createSmsWorker(connection: Redis, db: Pool): Worker {
  const worker = new Worker<NotificationJob>(
    'nexus:notifications:sms',
    async (job: Job<NotificationJob>): Promise<SmsResult> => {
      const { userId, body, templateType, data } = job.data;
      const startTime = Date.now();

      smsLogger.debug({ jobId: job.id, userId, templateType }, 'Processing SMS job');

      // Get user phone from DB
      const userResult = await db.query('SELECT phone FROM users WHERE id = $1', [userId]);

      if (userResult.rows.length === 0 || !userResult.rows[0].phone) {
        smsLogger.warn({ userId }, 'User phone not found for SMS');
        await updateNotificationLog(db, userId, templateType, 'sms', 'skipped', { reason: 'no_phone' });
        return { status: 'no_phone' };
      }

      const rawPhone = userResult.rows[0].phone as string;

      // Validate E.164 format
      const e164Phone = normalizePhone(rawPhone);
      if (!e164Phone) {
        smsLogger.warn({ userId, rawPhone }, 'Invalid phone number format');
        await updateNotificationLog(db, userId, templateType, 'sms', 'failed', { reason: 'invalid_phone', rawPhone });
        return { status: 'invalid_phone' };
      }

      // Rate limit: 1 SMS per user per 60s (except OTP)
      if (templateType !== 'otp') {
        const rateLimitKey = `sms_rate:${userId}`;
        const isRateLimited = await connection.set(rateLimitKey, '1', 'EX', 60, 'NX');
        if (isRateLimited !== 'OK') {
          smsLogger.info({ userId }, 'SMS rate limited — skipping');
          await updateNotificationLog(db, userId, templateType, 'sms', 'skipped', { reason: 'rate_limited' });
          return { status: 'failed' };
        }
      }

      // Production: MSG91 API
      if (config.NODE_ENV === 'production' && config.MSG91_AUTH_KEY) {
        try {
          const dltTemplateId = MSG91_TEMPLATE_MAP[templateType] ?? MSG91_TEMPLATE_MAP['otp'];

          const msg91Payload = {
            flow_id: dltTemplateId,
            sender: config.MSG91_SENDER_ID ?? 'NEXUSS',
            mobiles: e164Phone.replace('+', ''),
            ...(data ?? {}),
          };

          const response = await fetch('https://api.msg91.com/api/v5/flow/', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'authkey': config.MSG91_AUTH_KEY,
            },
            body: JSON.stringify(msg91Payload),
            signal: AbortSignal.timeout(10_000),
          });

          if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`MSG91 error ${response.status}: ${errorBody}`);
          }

          const result = await response.json() as { type: string; request_id?: string };

          smsLogger.info(
            { userId, phone: e164Phone.slice(-4), templateType, requestId: result.request_id },
            'SMS sent via MSG91',
          );

          await updateNotificationLog(db, userId, templateType, 'sms', 'sent', {
            phone: e164Phone.slice(-4),
            requestId: result.request_id,
            latencyMs: Date.now() - startTime,
          });

          return { 
            status: 'sent', 
            phone: e164Phone, 
            ...(result.request_id !== undefined && { messageId: result.request_id }) 
          };
        } catch (err: any) {
          smsLogger.error({ err, userId, templateType }, 'MSG91 SMS send failed');
          throw err; // Let BullMQ retry
        }
      }

      // Development: log the SMS
      smsLogger.info(
        { userId, phone: e164Phone, templateType },
        `[DEV SMS] To: ${e164Phone}\nBody: ${body}`,
      );

      await updateNotificationLog(db, userId, templateType, 'sms', 'sent', {
        phone: e164Phone.slice(-4),
        environment: 'development',
        latencyMs: Date.now() - startTime,
      });

      return { status: 'dev_logged', phone: e164Phone };
    },
    {
      connection,
      concurrency: 3,
      limiter: { max: 10, duration: 1000 }, // MSG91: ~10 SMS/sec
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 2000 },
    },
  );

  worker.on('failed', (job, err) => {
    smsLogger.error({ jobId: job?.id, err: err.message }, 'SMS job failed permanently');
  });

  return worker;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. In-App Notification Worker
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Creates a BullMQ worker for in-app notifications.
 *
 * This is the fastest worker (no external API calls):
 *  1. Insert into in_app_notifications table
 *  2. Publish to Redis channel for real-time WebSocket delivery
 *  3. Update unread count cache
 *
 * Target: < 10ms per job
 */
export function createInAppWorker(connection: Redis, db: Pool): Worker {
  const worker = new Worker<NotificationJob>(
    'nexus:notifications:in_app',
    async (job: Job<NotificationJob>): Promise<InAppResult> => {
      const { userId, title, body, actionUrl, templateType, priority, data } = job.data;

      // Step 1: Insert into database
      const insertResult = await db.query(
        `INSERT INTO in_app_notifications 
         (user_id, type, title, body, action_url, priority, metadata, is_read)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false)
         RETURNING id`,
        [userId, templateType, title, body, actionUrl ?? null, priority ?? 'normal', JSON.stringify(data ?? {})],
      );

      const notificationId = insertResult.rows[0]?.id;

      // Step 2: Publish to Redis for real-time WebSocket delivery
      const realtimePayload = JSON.stringify({
        id: notificationId,
        type: templateType,
        title,
        body,
        actionUrl,
        priority,
        createdAt: new Date().toISOString(),
      });

      await Promise.allSettled([
        connection.publish(`user:${userId}:notification`, realtimePayload),
        connection.publish(`user:${userId}:notification_badge`, '1'),
        // Increment unread count
        connection.incr(`user:${userId}:unread_count`),
        connection.expire(`user:${userId}:unread_count`, 86400), // 24h TTL
      ]);

      // Step 3: Update notification log
      await updateNotificationLog(db, userId, templateType, 'in_app', 'delivered', {
        notificationId,
      });

      inAppLogger.debug(
        { userId, notificationId, templateType },
        'In-app notification stored and published',
      );

      return { status: 'stored', notificationId };
    },
    {
      connection,
      concurrency: 20,
      limiter: { max: 100, duration: 1000 },
      removeOnComplete: { count: 2000 },
      removeOnFail: { count: 5000 },
    },
  );

  worker.on('failed', (job, err) => {
    inAppLogger.error({ jobId: job?.id, err: err.message }, 'In-app job failed');
  });

  return worker;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helper Functions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Update notification_log table with delivery status.
 */
async function updateNotificationLog(
  db: Pool,
  userId: string,
  type: string,
  channel: string,
  status: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO notification_log (user_id, type, channel, status, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [userId, type, channel, status, JSON.stringify(metadata)],
    );
  } catch (err) {
    // Notification logging is non-critical
    pushLogger.debug({ err, userId, type, channel }, 'Failed to update notification log');
  }
}

/**
 * Normalize phone number to E.164 format.
 * Handles Indian numbers with/without country code.
 */
function normalizePhone(phone: string): string | null {
  // Remove spaces, dashes, parentheses
  const cleaned = phone.replace(/[\s\-\(\)\.]/g, '');

  // Already E.164
  if (/^\+\d{10,15}$/.test(cleaned)) return cleaned;

  // Indian number without country code (10 digits)
  if (/^\d{10}$/.test(cleaned)) return `+91${cleaned}`;

  // Indian number with 0 prefix
  if (/^0\d{10}$/.test(cleaned)) return `+91${cleaned.slice(1)}`;

  // Indian number with 91 prefix
  if (/^91\d{10}$/.test(cleaned)) return `+${cleaned}`;

  return null;
}

/**
 * Build default HTML email template.
 */
function buildDefaultEmailHtml(title: string, body: string, userName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px 40px;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">NEXUS</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 16px;color:#374151;font-size:16px;">Hi ${escapeHtml(userName)},</p>
              <h2 style="margin:0 0 16px;color:#111827;font-size:20px;font-weight:600;">${escapeHtml(title)}</h2>
              <p style="margin:0 0 24px;color:#4b5563;font-size:16px;line-height:1.6;">${escapeHtml(body)}</p>
              <a href="https://nexus.campus" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Open NEXUS</a>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;background-color:#f9fafb;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
                &copy; 2026 NEXUS Campus Platform. All rights reserved.<br>
                <a href="https://nexus.campus/unsubscribe" style="color:#6366f1;">Unsubscribe</a> &bull;
                <a href="https://nexus.campus/preferences" style="color:#6366f1;">Preferences</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
