/**
 * Notification Templates — Complete Template Library
 *
 * Each template is a pure function returning { title, body, emailHtml?, emailSubject? }.
 * Templates are designed for the NEXUS campus commerce platform.
 *
 * RULES:
 *  - title ≤ 65 chars
 *  - body ≤ 240 chars
 *  - emailHtml is full HTML for email delivery
 *  - emailSubject is the email subject line
 *
 * @module templates/templates
 */

import { createLogger } from '@nexus/utils';

const logger = createLogger('notification-templates');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface TemplateResult {
  title: string;
  body: string;
  emailHtml?: string;
  emailSubject?: string;
}

type TemplateFunction = (data: Record<string, unknown>) => TemplateResult;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function str(val: unknown, fallback = ''): string {
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return val.toString();
  return fallback;
}

function formatAmount(paise: unknown): string {
  const amount = typeof paise === 'number' ? paise : parseInt(str(paise, '0'), 10);
  return `₹${(amount / 100).toLocaleString('en-IN')}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

function wrapEmailHtml(title: string, body: string, actionUrl?: string, actionText?: string): string {
  const actionButton = actionUrl && actionText
    ? `<a href="${actionUrl}" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;border-radius:8px;font-weight:600;margin-top:16px;">${actionText}</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #f4f4f7; }
  .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; margin-top: 24px; margin-bottom: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
  .header { background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 32px; text-align: center; }
  .header h1 { color: #ffffff; font-size: 24px; margin: 0; font-weight: 700; }
  .header p { color: rgba(255,255,255,0.85); font-size: 14px; margin: 4px 0 0; }
  .body { padding: 32px; }
  .body h2 { color: #1a1a2e; font-size: 20px; margin: 0 0 12px; }
  .body p { color: #4a4a6a; font-size: 16px; line-height: 1.6; margin: 0 0 16px; }
  .footer { padding: 24px 32px; background: #f8f8fc; text-align: center; border-top: 1px solid #eee; }
  .footer p { color: #999; font-size: 12px; margin: 0; }
  .action { text-align: center; margin: 24px 0; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>NEXUS</h1>
    <p>Campus Commerce Platform</p>
  </div>
  <div class="body">
    <h2>${title}</h2>
    <p>${body}</p>
    ${actionButton ? `<div class="action">${actionButton}</div>` : ''}
  </div>
  <div class="footer">
    <p>You received this because you have a NEXUS account. <a href="{{unsubscribe_url}}" style="color:#6366f1;">Manage preferences</a></p>
  </div>
</div>
</body>
</html>`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Template Registry
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const templates: Record<string, TemplateFunction> = {
  // ── OTP ────────────────────────────────────
  otp: (data) => {
    const code = str(data.code, '------');
    const purpose = str(data.purpose, 'verification');
    return {
      title: `Your NEXUS ${purpose} code`,
      body: `Your one-time code is ${code}. It expires in 10 minutes. Never share this code with anyone.`,
      emailSubject: `${code} — Your NEXUS verification code`,
      emailHtml: wrapEmailHtml(
        `Your ${purpose} code`,
        `<div style="text-align:center;padding:24px;background:#f0f0ff;border-radius:12px;margin:16px 0;">
          <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#6366f1;">${code}</span>
        </div>
        <p>This code expires in <strong>10 minutes</strong>. If you didn't request this, please ignore this email.</p>`,
      ),
    };
  },

  // ── Order Status Update ────────────────────
  order_status_update: (data) => {
    const orderId = str(data.orderId, '').slice(-8).toUpperCase();
    const status = str(data.status, 'updated');
    const itemTitle = truncate(str(data.itemTitle, 'Your order'), 40);

    const statusMessages: Record<string, string> = {
      confirmed: `Your order #${orderId} for "${itemTitle}" has been confirmed by the seller.`,
      shipped: `Your order #${orderId} is on its way! Track your delivery in the app.`,
      delivered: `Your order #${orderId} has been delivered. Please confirm receipt.`,
      cancelled: `Your order #${orderId} has been cancelled. Refund will be processed within 24h.`,
      refunded: `Refund for order #${orderId} has been processed to your wallet.`,
    };

    return {
      title: `Order #${orderId} ${status}`,
      body: statusMessages[status] ?? `Your order #${orderId} status has been updated to: ${status}.`,
      emailSubject: `Order #${orderId} — ${status.charAt(0).toUpperCase() + status.slice(1)}`,
      emailHtml: wrapEmailHtml(
        `Order ${status.charAt(0).toUpperCase() + status.slice(1)}`,
        statusMessages[status] ?? `Your order status has changed to: <strong>${status}</strong>.`,
        str(data.actionUrl) || undefined,
        'View Order',
      ),
    };
  },

  // ── Ride Matched ───────────────────────────
  ride_matched: (data) => {
    const driverName = str(data.driverName, 'A driver');
    const pickup = truncate(str(data.pickup, 'pickup'), 30);
    const vehicleInfo = str(data.vehicleInfo, '');
    const eta = str(data.etaMinutes, '5');

    return {
      title: `🚗 Ride matched — ${driverName} is coming`,
      body: `${driverName} accepted your ride from ${pickup}. ${vehicleInfo ? `Vehicle: ${vehicleInfo}. ` : ''}ETA: ${eta} min.`,
      emailSubject: `Ride Matched — ${driverName} is on the way`,
      emailHtml: wrapEmailHtml(
        'Your Ride is Matched! 🚗',
        `<p><strong>${driverName}</strong> has accepted your ride.</p>
         <p>📍 Pickup: ${pickup}</p>
         ${vehicleInfo ? `<p>🚙 Vehicle: ${vehicleInfo}</p>` : ''}
         <p>⏱ ETA: ${eta} minutes</p>`,
        str(data.actionUrl) || undefined,
        'Track Ride',
      ),
    };
  },

  // ── Ride Completed ─────────────────────────
  ride_completed: (data) => {
    const fare = formatAmount(data.fare);
    const from = truncate(str(data.from, 'pickup'), 25);
    const to = truncate(str(data.to, 'destination'), 25);

    return {
      title: `Ride completed — ${fare}`,
      body: `Your ride from ${from} to ${to} is complete. Fare: ${fare}. Rate your experience!`,
      emailSubject: `Ride Complete — ${fare}`,
      emailHtml: wrapEmailHtml(
        'Ride Complete! 🎉',
        `<p>Your ride from <strong>${from}</strong> to <strong>${to}</strong> is complete.</p>
         <div style="text-align:center;padding:16px;background:#f0fdf4;border-radius:8px;margin:16px 0;">
           <span style="font-size:28px;font-weight:700;color:#059669;">${fare}</span>
         </div>`,
        str(data.actionUrl) || undefined,
        'Rate Your Ride',
      ),
    };
  },

  // ── Task Application Received ──────────────
  task_application_received: (data) => {
    const taskTitle = truncate(str(data.taskTitle, 'your task'), 35);
    const applicantName = str(data.applicantName, 'Someone');
    const bidAmount = data.bidAmount ? formatAmount(data.bidAmount) : '';

    return {
      title: `New application for "${taskTitle}"`,
      body: `${applicantName} applied for your task "${taskTitle}"${bidAmount ? ` with a bid of ${bidAmount}` : ''}. Review their profile!`,
      emailSubject: `New Application — ${taskTitle}`,
      emailHtml: wrapEmailHtml(
        'New Task Application',
        `<p><strong>${applicantName}</strong> has applied for your task "<strong>${taskTitle}</strong>".</p>
         ${bidAmount ? `<p>💰 Bid: ${bidAmount}</p>` : ''}`,
        str(data.actionUrl) || undefined,
        'Review Application',
      ),
    };
  },

  // ── Task Completed ─────────────────────────
  task_completed: (data) => {
    const taskTitle = truncate(str(data.taskTitle, 'your task'), 35);
    const amount = data.amount ? formatAmount(data.amount) : '';

    return {
      title: `Task "${taskTitle}" completed`,
      body: `The task "${taskTitle}" has been marked as completed. ${amount ? `Payment of ${amount} will be released.` : 'Review and confirm completion.'}`,
      emailSubject: `Task Complete — ${taskTitle}`,
      emailHtml: wrapEmailHtml(
        'Task Completed! ✅',
        `<p>Your task "<strong>${taskTitle}</strong>" has been completed.</p>
         ${amount ? `<p>💰 Payment of <strong>${amount}</strong> will be released.</p>` : ''}`,
        str(data.actionUrl) || undefined,
        'Review Task',
      ),
    };
  },

  // ── Escrow Released ────────────────────────
  escrow_released: (data) => {
    const amount = formatAmount(data.amount);
    const reason = str(data.reason, 'transaction completed');

    return {
      title: `${amount} released to your wallet`,
      body: `${amount} has been released from escrow to your NEXUS wallet. Reason: ${reason}.`,
      emailSubject: `Escrow Released — ${amount}`,
      emailHtml: wrapEmailHtml(
        `${amount} Released to Your Wallet 💰`,
        `<p>Your escrowed funds of <strong>${amount}</strong> have been released.</p>
         <p>Reason: ${reason}</p>
         <p>The amount is now available in your NEXUS wallet.</p>`,
        str(data.actionUrl) || undefined,
        'View Wallet',
      ),
    };
  },

  // ── Trust Tier Upgrade ─────────────────────
  trust_tier_upgrade: (data) => {
    const oldTier = str(data.oldTier, 'previous');
    const newTier = str(data.newTier, 'upgraded');
    const score = str(data.score, '');

    const tierEmoji: Record<string, string> = {
      building: '🌱',
      trusted: '⭐',
      verified: '🏆',
      elite: '👑',
    };

    const emoji = tierEmoji[newTier] ?? '⬆️';

    return {
      title: `${emoji} Trust upgraded to ${newTier}!`,
      body: `Congratulations! Your trust tier upgraded from ${oldTier} to ${newTier}${score ? ` (score: ${score})` : ''}. You've unlocked new privileges.`,
      emailSubject: `Trust Tier Upgrade — ${newTier}`,
      emailHtml: wrapEmailHtml(
        `${emoji} Trust Level Up!`,
        `<div style="text-align:center;padding:24px;">
           <span style="font-size:48px;">${emoji}</span>
           <h3 style="color:#6366f1;margin:12px 0 4px;">${newTier.toUpperCase()}</h3>
           ${score ? `<p style="color:#888;">Score: ${score}/5.00</p>` : ''}
         </div>
         <p>Your trust tier has been upgraded from <strong>${oldTier}</strong> to <strong>${newTier}</strong>.</p>
         <p>This unlocks higher transaction limits, priority support, and more!</p>`,
        str(data.actionUrl) || undefined,
        'View Your Profile',
      ),
    };
  },

  // ── Payment Received ───────────────────────
  payment_received: (data) => {
    const amount = formatAmount(data.amount);
    const from = str(data.from, 'a buyer');
    const module = str(data.module, 'transaction');

    return {
      title: `${amount} received from ${from}`,
      body: `You received ${amount} from ${from} via ${module}. The funds are now in your NEXUS wallet.`,
      emailSubject: `Payment Received — ${amount}`,
      emailHtml: wrapEmailHtml(
        `Payment Received 💵`,
        `<div style="text-align:center;padding:20px;background:#f0fdf4;border-radius:12px;margin:16px 0;">
           <span style="font-size:32px;font-weight:700;color:#059669;">${amount}</span>
           <p style="color:#888;margin:4px 0 0;">from ${from}</p>
         </div>
         <p>Module: ${module}</p>`,
        str(data.actionUrl) || undefined,
        'View Wallet',
      ),
    };
  },

  // ── SOS Triggered ──────────────────────────
  sos_triggered: (data) => {
    const userName = str(data.userName, 'A user');
    const location = str(data.location, 'unknown location');
    const rideId = str(data.rideId, '');

    return {
      title: `🆘 EMERGENCY — ${userName} triggered SOS`,
      body: `${userName} has triggered an SOS alert${rideId ? ` for ride ${rideId}` : ''} near ${location}. Immediate attention required.`,
      emailSubject: `🆘 EMERGENCY SOS Alert — ${userName}`,
      emailHtml: wrapEmailHtml(
        '🆘 EMERGENCY SOS ALERT',
        `<div style="text-align:center;padding:24px;background:#fef2f2;border-radius:12px;border:2px solid #ef4444;margin:16px 0;">
           <span style="font-size:48px;">🆘</span>
           <h3 style="color:#ef4444;margin:12px 0 4px;">EMERGENCY ALERT</h3>
         </div>
         <p><strong>${userName}</strong> has triggered an SOS alert.</p>
         <p>📍 Location: ${location}</p>
         ${rideId ? `<p>🚗 Ride: ${rideId}</p>` : ''}
         <p style="color:#ef4444;font-weight:600;">This requires immediate attention.</p>`,
        str(data.actionUrl) || undefined,
        'View Emergency Details',
      ),
    };
  },

  // ── Account Suspended ──────────────────────
  account_suspended: (data) => {
    const reason = str(data.reason, 'policy violation');
    const duration = str(data.duration, 'until further notice');

    return {
      title: '⚠️ Your NEXUS account has been suspended',
      body: `Your account has been suspended for: ${reason}. Duration: ${duration}. You can appeal this decision within 7 days.`,
      emailSubject: '⚠️ Account Suspended — NEXUS',
      emailHtml: wrapEmailHtml(
        '⚠️ Account Suspended',
        `<p>Your NEXUS account has been <strong>suspended</strong>.</p>
         <p><strong>Reason:</strong> ${reason}</p>
         <p><strong>Duration:</strong> ${duration}</p>
         <div style="padding:16px;background:#fffbeb;border-radius:8px;border:1px solid #f59e0b;margin:16px 0;">
           <p style="color:#92400e;margin:0;">You can appeal this decision within <strong>7 days</strong> by contacting our support team.</p>
         </div>`,
        str(data.actionUrl) || undefined,
        'Appeal Suspension',
      ),
    };
  },

  // ── Listing Sold ───────────────────────────
  listing_sold: (data) => {
    const itemTitle = truncate(str(data.itemTitle, 'Your item'), 35);
    const amount = formatAmount(data.amount);
    const buyerName = str(data.buyerName, 'a buyer');

    return {
      title: `🎉 "${itemTitle}" sold for ${amount}`,
      body: `Your listing "${itemTitle}" was purchased by ${buyerName} for ${amount}. Funds will be held in escrow until delivery is confirmed.`,
      emailSubject: `Item Sold — ${itemTitle}`,
      emailHtml: wrapEmailHtml(
        `🎉 Your Item Sold!`,
        `<p>Your listing "<strong>${itemTitle}</strong>" was purchased by <strong>${buyerName}</strong>.</p>
         <div style="text-align:center;padding:20px;background:#f0fdf4;border-radius:12px;margin:16px 0;">
           <span style="font-size:28px;font-weight:700;color:#059669;">${amount}</span>
         </div>
         <p>Funds are held in escrow until delivery confirmation.</p>`,
        str(data.actionUrl) || undefined,
        'Manage Order',
      ),
    };
  },

  // ── New Message ────────────────────────────
  new_message: (data) => {
    const senderName = str(data.senderName, 'Someone');
    const preview = truncate(str(data.preview, 'sent you a message'), 100);

    return {
      title: `💬 ${senderName} sent you a message`,
      body: `${senderName}: "${preview}"`,
    };
  },

  // ── Review Received ────────────────────────
  review_received: (data) => {
    const reviewerName = str(data.reviewerName, 'A user');
    const rating = str(data.rating, '5');
    const stars = '⭐'.repeat(Math.min(parseInt(rating, 10), 5));

    return {
      title: `${stars} New ${rating}-star review`,
      body: `${reviewerName} left you a ${rating}-star review. ${data.comment ? `"${truncate(str(data.comment), 100)}"` : 'Check it out!'}`,
      emailSubject: `New Review — ${rating} Stars`,
      emailHtml: wrapEmailHtml(
        `New Review! ${stars}`,
        `<p><strong>${reviewerName}</strong> left you a review.</p>
         <div style="text-align:center;padding:16px;font-size:24px;">${stars}</div>
         ${data.comment ? `<blockquote style="border-left:3px solid #6366f1;padding-left:16px;color:#555;font-style:italic;">"${str(data.comment)}"</blockquote>` : ''}`,
      ),
    };
  },

  // ── Welcome ────────────────────────────────
  welcome: (data) => {
    const name = str(data.name, 'there');
    const campus = str(data.campus, 'your campus');

    return {
      title: `Welcome to NEXUS, ${name}! 🎉`,
      body: `Welcome to the ${campus} community on NEXUS! Start by completing your profile and browsing listings near you.`,
      emailSubject: `Welcome to NEXUS, ${name}!`,
      emailHtml: wrapEmailHtml(
        `Welcome to NEXUS! 🎉`,
        `<p>Hi <strong>${name}</strong>,</p>
         <p>Welcome to the <strong>${campus}</strong> community on NEXUS!</p>
         <p>Here's what you can do:</p>
         <ul style="color:#4a4a6a;line-height:2;">
           <li>🛍 Buy and sell items on Bazaar</li>
           <li>🚗 Share rides with campus mates</li>
           <li>💼 Offer your skills as services</li>
           <li>📝 Post and complete tasks</li>
         </ul>`,
        str(data.actionUrl) || undefined,
        'Complete Your Profile',
      ),
    };
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Public API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Render a notification template by type.
 *
 * @throws Error if template type is not found
 */
export function renderTemplate(type: string, data: Record<string, unknown>): TemplateResult {
  const template = templates[type];
  if (!template) {
    logger.warn({ type }, 'Unknown notification template type');
    throw new Error(`Unknown notification template type: ${type}`);
  }

  const result = template(data);

  // Enforce constraints
  if (result.title.length > 65) {
    result.title = truncate(result.title, 65);
  }
  if (result.body.length > 240) {
    result.body = truncate(result.body, 240);
  }

  return result;
}

/**
 * Get all registered template types.
 */
export function getRegisteredTemplateTypes(): string[] {
  return Object.keys(templates);
}

/**
 * Check if a template type is registered.
 */
export function isTemplateRegistered(type: string): boolean {
  return type in templates;
}
