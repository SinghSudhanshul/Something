/**
 * @nexus/utils
 *
 * Shared utility functions used across all NEXUS services.
 * Includes structured logging, currency formatting, retry logic, and error handling.
 */

import { pino, type Logger } from 'pino';
import { nanoid } from 'nanoid';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Logger Factory
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function createLogger(serviceName: string, level?: string): Logger {
  return pino({
    name: serviceName,
    level: level ?? process.env['LOG_LEVEL'] ?? 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label: string) {
        return { level: label };
      },
    },
    serializers: {
      err: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Currency Formatting
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Formats an amount in paise/minor units to a human-readable currency string.
 * @param amount - Amount in the smallest currency unit (paise for INR)
 * @param currency - ISO 4217 currency code (default: INR)
 */
export function formatCurrency(amount: number, currency = 'INR'): string {
  const majorUnits = amount / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(majorUnits);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Date Formatting (IST)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Formats a date to IST (Indian Standard Time) string.
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Correlation ID
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Generates a unique correlation ID for distributed tracing.
 */
export function generateCorrelationId(): string {
  return nanoid(21);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sleep
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Returns a promise that resolves after the specified number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Retry with Exponential Backoff
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Retries an async function with exponential backoff.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  delayMs: number,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      if (attempt < maxRetries) {
        const backoff = delayMs * Math.pow(2, attempt);
        const jitter = Math.random() * backoff * 0.1;
        await sleep(backoff + jitter);
      }
    }
  }

  throw lastError;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Pagination Helper
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface PaginationParams {
  cursor: string | null;
  limit: number;
}

export interface PaginationMeta {
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Parses cursor-based pagination parameters.
 */
export function parsePagination(
  cursor: string | undefined | null,
  limit: number | undefined | null,
  maxLimit = 100,
  defaultLimit = 20,
): PaginationParams {
  const safeLimit = Math.min(Math.max(limit ?? defaultLimit, 1), maxLimit);
  return {
    cursor: cursor ?? null,
    limit: safeLimit,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Application Error
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    isOperational = true,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, AppError.prototype);
    Error.captureStackTrace(this, this.constructor);
  }

  public static badRequest(message: string, code = 'BAD_REQUEST'): AppError {
    return new AppError(400, code, message);
  }

  public static unauthorized(message = 'Unauthorized', code = 'UNAUTHORIZED'): AppError {
    return new AppError(401, code, message);
  }

  public static forbidden(message = 'Forbidden', code = 'FORBIDDEN'): AppError {
    return new AppError(403, code, message);
  }

  public static notFound(message = 'Not found', code = 'NOT_FOUND'): AppError {
    return new AppError(404, code, message);
  }

  public static conflict(message: string, code = 'CONFLICT'): AppError {
    return new AppError(409, code, message);
  }

  public static internal(message = 'Internal server error', code = 'INTERNAL_ERROR'): AppError {
    return new AppError(500, code, message, false);
  }
}

export * from './auth-middleware.js';
export * from './wallet-client.js';
export * from './trust-client.js';
