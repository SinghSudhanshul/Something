/**
 * @nexus/utils — Trust Service HTTP Client
 *
 * Typed HTTP client for Phase 2 → Trust service calls.
 * Implements fire-and-forget mode: if trust service is down,
 * logs error and resolves (never blocks the main transaction flow).
 *
 * Trust is important but not a blocker for payments.
 */

import axios, { type AxiosInstance } from 'axios';
import { createLogger, generateCorrelationId } from './index.js';

import type { TrustEventType } from '@nexus/types';

const logger = createLogger('trust-client');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface TrustEventRequest {
  userId: string;
  eventType: TrustEventType;
  referenceId: string;
  referenceType: string;
  metadata?: Record<string, unknown>;
}

export interface TrustClientConfig {
  baseUrl: string;
  internalSecret: string;
  timeoutMs?: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Client
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class TrustClient {
  private readonly client: AxiosInstance;
  private readonly internalSecret: string;

  constructor(config: TrustClientConfig) {
    this.internalSecret = config.internalSecret;
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeoutMs ?? 5000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Records a trust event for a user.
   *
   * This is a **fire-and-forget** operation:
   * - On success: logs the event and resolves
   * - On failure: logs the error and resolves (never throws)
   *
   * Trust events are important for score calculation but must never
   * block the primary transaction flow (payment, escrow, etc).
   */
  async recordTrustEvent(req: TrustEventRequest): Promise<void> {
    const correlationId = generateCorrelationId();

    try {
      await this.client.post(
        '/api/v1/trust/events',
        req,
        {
          headers: {
            'X-Internal-Secret': this.internalSecret,
            'X-Correlation-Id': correlationId,
          },
        },
      );

      logger.debug(
        { userId: req.userId, eventType: req.eventType, correlationId },
        'Trust event recorded',
      );
    } catch (error: unknown) {
      // Fire-and-forget: log and swallow the error
      logger.error(
        {
          err: error,
          userId: req.userId,
          eventType: req.eventType,
          correlationId,
        },
        'Failed to record trust event — trust service may be unavailable',
      );
    }
  }

  /**
   * Records multiple trust events in parallel (fire-and-forget).
   * Convenience method for transaction completion scenarios where
   * both buyer and seller need trust events.
   */
  async recordTrustEvents(events: TrustEventRequest[]): Promise<void> {
    await Promise.allSettled(
      events.map((event) => this.recordTrustEvent(event)),
    );
  }
}

/**
 * Factory function to create a TrustClient from environment variables.
 */
export function createTrustClient(
  baseUrl?: string,
  internalSecret?: string,
): TrustClient {
  const url = baseUrl ?? process.env['USER_SERVICE_URL'] ?? 'http://localhost:3013';
  const secret = internalSecret ?? process.env['INTERNAL_SERVICE_SECRET'] ?? '';

  if (!secret) {
    logger.warn('INTERNAL_SERVICE_SECRET not set — trust client will fail all requests');
  }

  return new TrustClient({ baseUrl: url, internalSecret: secret });
}
