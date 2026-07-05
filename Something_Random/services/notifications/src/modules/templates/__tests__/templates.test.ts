/**
 * Notification Template Tests
 *
 * Ensures:
 *  - All templates render without errors
 *  - Title ≤ 65 chars
 *  - Body ≤ 240 chars
 *  - Missing data produces descriptive defaults (not crashes)
 *  - Email HTML is valid
 *  - Unknown template type throws
 *
 * @module templates/__tests__/templates.test
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@nexus/utils', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { renderTemplate, getRegisteredTemplateTypes, isTemplateRegistered } from '../templates.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Template Rendering Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Template Rendering', () => {
  const allTypes = getRegisteredTemplateTypes();

  it('should have at least 11 templates registered', () => {
    expect(allTypes.length).toBeGreaterThanOrEqual(11);
  });

  describe.each(allTypes)('Template: %s', (type) => {
    it('should render without error with empty data', () => {
      const result = renderTemplate(type, {});
      expect(result).toBeDefined();
      expect(typeof result.title).toBe('string');
      expect(typeof result.body).toBe('string');
      expect(result.title.length).toBeGreaterThan(0);
      expect(result.body.length).toBeGreaterThan(0);
    });

    it('should enforce title ≤ 65 chars', () => {
      const result = renderTemplate(type, {});
      expect(result.title.length).toBeLessThanOrEqual(65);
    });

    it('should enforce body ≤ 240 chars', () => {
      const result = renderTemplate(type, {});
      expect(result.body.length).toBeLessThanOrEqual(240);
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// OTP Template
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('OTP Template', () => {
  it('should include the code in title and body', () => {
    const result = renderTemplate('otp', { code: '123456', purpose: 'login' });
    expect(result.title).toContain('login');
    expect(result.body).toContain('123456');
  });

  it('should include code in email subject', () => {
    const result = renderTemplate('otp', { code: '999999' });
    expect(result.emailSubject).toContain('999999');
  });

  it('should have email HTML', () => {
    const result = renderTemplate('otp', { code: '123456' });
    expect(result.emailHtml).toBeDefined();
    expect(result.emailHtml).toContain('123456');
    expect(result.emailHtml).toContain('<!DOCTYPE html>');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Order Status Template
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Order Status Template', () => {
  it('should handle confirmed status', () => {
    const result = renderTemplate('order_status_update', {
      orderId: 'abcd1234efgh',
      status: 'confirmed',
      itemTitle: 'MacBook Air',
    });
    expect(result.body).toContain('confirmed');
    expect(result.title).toContain('confirmed');
  });

  it('should handle shipped status', () => {
    const result = renderTemplate('order_status_update', { orderId: 'xyz', status: 'shipped' });
    expect(result.body).toContain('on its way');
  });

  it('should handle cancelled status', () => {
    const result = renderTemplate('order_status_update', { orderId: 'xyz', status: 'cancelled' });
    expect(result.body).toContain('cancelled');
    expect(result.body).toContain('Refund');
  });

  it('should handle unknown status gracefully', () => {
    const result = renderTemplate('order_status_update', { orderId: 'xyz', status: 'processing' });
    expect(result.body).toContain('processing');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Ride Templates
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Ride Templates', () => {
  it('ride_matched should include driver name', () => {
    const result = renderTemplate('ride_matched', {
      driverName: 'Arun Kumar',
      pickup: 'Gate 4, IIT Delhi',
      etaMinutes: '3',
    });
    expect(result.body).toContain('Arun Kumar');
    expect(result.body).toContain('Gate 4');
  });

  it('ride_completed should include fare', () => {
    const result = renderTemplate('ride_completed', {
      fare: 15000, // ₹150
      from: 'Hostel 3',
      to: 'Library',
    });
    expect(result.body).toContain('₹');
    expect(result.body).toContain('Hostel 3');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Task Templates
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Task Templates', () => {
  it('task_application_received should include applicant', () => {
    const result = renderTemplate('task_application_received', {
      taskTitle: 'Help with DSA Assignment',
      applicantName: 'Priya Sharma',
      bidAmount: 30000,
    });
    expect(result.body).toContain('Priya Sharma');
    expect(result.body).toContain('₹');
  });

  it('task_completed should include task title', () => {
    const result = renderTemplate('task_completed', {
      taskTitle: 'Move boxes from Room 204',
      amount: 50000,
    });
    expect(result.body).toContain('completed');
    expect(result.body).toContain('₹');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Financial Templates
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Financial Templates', () => {
  it('escrow_released should show amount', () => {
    const result = renderTemplate('escrow_released', { amount: 250000, reason: 'delivery confirmed' });
    expect(result.title).toContain('₹');
    expect(result.body).toContain('delivery confirmed');
  });

  it('payment_received should show amount and sender', () => {
    const result = renderTemplate('payment_received', {
      amount: 100000,
      from: 'Rahul',
      module: 'bazaar',
    });
    expect(result.title).toContain('₹');
    expect(result.body).toContain('Rahul');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Trust & Safety Templates
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Trust & Safety Templates', () => {
  it('trust_tier_upgrade should show old and new tier', () => {
    const result = renderTemplate('trust_tier_upgrade', {
      oldTier: 'building',
      newTier: 'trusted',
      score: '3.50',
    });
    expect(result.body).toContain('building');
    expect(result.body).toContain('trusted');
  });

  it('sos_triggered should be marked as emergency', () => {
    const result = renderTemplate('sos_triggered', {
      userName: 'Emergency User',
      location: 'Near Gate 5',
      rideId: 'ride-123',
    });
    expect(result.title).toContain('EMERGENCY');
    expect(result.body).toContain('Emergency User');
    expect(result.body).toContain('Gate 5');
  });

  it('account_suspended should include reason', () => {
    const result = renderTemplate('account_suspended', {
      reason: 'repeated fraud flags',
      duration: '30 days',
    });
    expect(result.body).toContain('repeated fraud flags');
    expect(result.body).toContain('30 days');
    expect(result.body).toContain('appeal');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Edge Cases
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Edge Cases', () => {
  it('should throw for unknown template type', () => {
    expect(() => renderTemplate('nonexistent_template', {})).toThrow('Unknown notification template type');
  });

  it('should handle very long input gracefully', () => {
    const longTitle = 'A'.repeat(200);
    const result = renderTemplate('order_status_update', {
      orderId: longTitle,
      status: 'confirmed',
      itemTitle: longTitle,
    });
    expect(result.title.length).toBeLessThanOrEqual(65);
    expect(result.body.length).toBeLessThanOrEqual(240);
  });

  it('should handle numeric data as strings', () => {
    const result = renderTemplate('payment_received', {
      amount: '150000',
      from: 'Seller',
    });
    expect(result.title).toContain('₹');
  });

  it('should handle null/undefined data', () => {
    const result = renderTemplate('otp', { code: null, purpose: undefined });
    expect(result.title).toBeDefined();
    expect(result.body).toBeDefined();
  });

  it('isTemplateRegistered should return true for valid types', () => {
    expect(isTemplateRegistered('otp')).toBe(true);
    expect(isTemplateRegistered('ride_matched')).toBe(true);
    expect(isTemplateRegistered('fake_template')).toBe(false);
  });
});
