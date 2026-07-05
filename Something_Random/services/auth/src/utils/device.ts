/**
 * Auth Service — Device Fingerprint Extraction
 *
 * Generates a deterministic device fingerprint from request headers.
 * Uses SHA-256 hash of User-Agent + Accept-Language + Accept-Encoding.
 */

import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';

export function extractDeviceFingerprint(request: FastifyRequest): string {
  const userAgent = request.headers['user-agent'] ?? '';
  const acceptLanguage = request.headers['accept-language'] ?? '';
  const acceptEncoding = request.headers['accept-encoding'] ?? '';

  const raw = `${userAgent}|${acceptLanguage}|${acceptEncoding}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}
