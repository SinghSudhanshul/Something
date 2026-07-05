/**
 * Auth Service — Password Utilities
 *
 * bcrypt helpers for hashing and comparing passwords.
 * NEVER log passwords, even in debug mode.
 */

import { hash, compare } from 'bcrypt';

const DEFAULT_ROUNDS = 12;

export async function hashPassword(password: string, rounds: number = DEFAULT_ROUNDS): Promise<string> {
  return hash(password, rounds);
}

export async function comparePassword(password: string, hashedPassword: string): Promise<boolean> {
  return compare(password, hashedPassword);
}

export async function hashOtp(otp: string): Promise<string> {
  return hash(otp, 10);
}

export async function compareOtp(otp: string, hashedOtp: string): Promise<boolean> {
  return compare(otp, hashedOtp);
}
