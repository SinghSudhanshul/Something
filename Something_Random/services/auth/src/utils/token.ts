/**
 * Auth Service — JWT & Token Utilities
 *
 * Generates access tokens (JWT), refresh tokens (opaque hex),
 * and SHA-256 hashes for refresh token storage.
 */

import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  roles: string[];
  campus_id: string;
  verification_level: number;
  trust_tier: string;
  jti: string;
}

export function generateAccessToken(
  app: FastifyInstance,
  payload: Omit<AccessTokenPayload, 'jti'>,
  expiresIn = '15m',
): string {
  const jti = crypto.randomUUID();
  return app.jwt.sign(
    { ...payload, jti },
    { expiresIn },
  );
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString('hex');
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateOtp(): string {
  return String(crypto.randomInt(100000, 999999));
}

export function generateJti(): string {
  return crypto.randomUUID();
}
