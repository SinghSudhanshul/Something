/**
 * Auth Service — OTP Service
 *
 * Generates, hashes, stores, and verifies One-Time Passwords.
 * Uses crypto.randomInt for cryptographic randomness.
 */

import { generateOtp } from '../../utils/token.js';
import { hashOtp, compareOtp } from '../../utils/password.js';

export interface OtpResult {
  otp: string;
  otpHash: string;
  expiresAt: Date;
}

export async function createOtp(ttlMinutes = 10): Promise<OtpResult> {
  const otp = generateOtp();
  const otpHash = await hashOtp(otp);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  return { otp, otpHash, expiresAt };
}

export async function verifyOtp(plainOtp: string, hashedOtp: string): Promise<boolean> {
  return compareOtp(plainOtp, hashedOtp);
}
