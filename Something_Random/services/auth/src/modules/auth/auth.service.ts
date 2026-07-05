/**
 * Auth Module — Service
 *
 * All business logic for authentication. Delegates DB access to
 * auth.repository.ts. NEVER logs passwords, OTPs, or tokens.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createLogger } from '@nexus/utils';

import { hashPassword, comparePassword } from '../../utils/password.js';
import { generateAccessToken, generateRefreshToken, hashRefreshToken } from '../../utils/token.js';
import { extractDeviceFingerprint } from '../../utils/device.js';
import { createOtp, verifyOtp } from '../otp/otp.service.js';
import { sendOtpEmail } from '../otp/email.service.js';
import { config } from '../../config.js';

import * as repo from './auth.repository.js';
import type {
  RegisterInput,
  VerifyEmailInput,
  LoginInput,
  RefreshInput,
  ResetPasswordInput,
  AuthResult,
  TokenPair,
  UserProfile,
} from './auth.types.js';

const logger = createLogger('auth-service', config.LOG_LEVEL);

// ── Helpers ────────────────────────────────────────────
function getAllowedDomains(): string[] {
  return config.ALLOWED_EMAIL_DOMAINS.split(',').map((d) => d.trim());
}

function getEmailDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() ?? '';
}

function isAllowedDomain(email: string): boolean {
  return getAllowedDomains().includes(getEmailDomain(email));
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (local === undefined || domain === undefined) {return '***';}
  const visible = local.slice(0, 2);
  return `${visible}***@${domain}`;
}

function buildUserProfile(user: Record<string, unknown>, campusName?: string): UserProfile {
  return {
    id: user['id'] as string,
    email: user['email'] as string,
    phone: (user['phone'] as string) ?? null,
    full_name: user['name'] as string,
    campus_id: user['campusId'] as string,
    campus_name: campusName ?? '',
    verification_level: Number(user['verificationLevel'] ?? 1),
    trust_score: (user['trustScore'] as number) ?? 0,
    trust_tier: (user['trustTier'] as string) ?? 'new',
    status: (user['status'] as string) ?? 'active',
    created_at: (user['createdAt'] as Date)?.toISOString() ?? new Date().toISOString(),
  };
}

async function buildTokenPair(
  app: FastifyInstance,
  user: Record<string, unknown>,
): Promise<{ tokens: TokenPair; refreshTokenRaw: string }> {
  const accessToken = generateAccessToken(app, {
    sub: user['id'] as string,
    email: user['email'] as string,
    roles: [(user['role'] as string) ?? 'student'],
    campus_id: user['campusId'] as string,
    verification_level: Number(user['verificationLevel'] ?? 1),
    trust_tier: (user['trustTier'] as string) ?? 'new',
  });

  const refreshTokenRaw = generateRefreshToken();

  return {
    tokens: {
      access_token: accessToken,
      refresh_token: refreshTokenRaw,
      token_type: 'Bearer',
      expires_in: 900,
    },
    refreshTokenRaw,
  };
}

async function createAndStoreSession(
  app: FastifyInstance,
  userId: string,
  refreshTokenRaw: string,
  request: FastifyRequest,
  deviceFingerprint?: string,
): Promise<void> {
  const refreshHash = hashRefreshToken(refreshTokenRaw);
  const fp = deviceFingerprint ?? extractDeviceFingerprint(request);
  const expiresAt = new Date(Date.now() + config.JWT_REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await repo.createSession(app.db, {
    userId,
    refreshTokenHash: refreshHash,
    deviceFingerprint: fp,
    userAgent: request.headers['user-agent'] ?? 'unknown',
    ipAddress: request.ip,
    expiresAt,
  });

  // Store in Redis for fast lookup
  await app.redis.set(
    `session:${userId}:${fp}`,
    refreshHash,
    'EX',
    config.JWT_REFRESH_EXPIRY_DAYS * 24 * 60 * 60,
  );
}

// ── Registration ───────────────────────────────────────
export async function register(
  app: FastifyInstance,
  request: FastifyRequest,
  input: RegisterInput,
): Promise<{ message: string; email: string; expires_in: number }> {
  if (!isAllowedDomain(input.email)) {
    throw Object.assign(new Error('Must use a university email address'), { statusCode: 400 });
  }

  // Check existing — generic error to prevent enumeration
  const [existingEmail] = await repo.findUserByEmail(app.db, input.email);
  if (existingEmail !== undefined) {
    throw Object.assign(new Error('Account already exists'), { statusCode: 409 });
  }

  const [existingPhone] = await repo.findUserByPhone(app.db, input.phone);
  if (existingPhone !== undefined) {
    throw Object.assign(new Error('Account already exists'), { statusCode: 409 });
  }

  // Find campus by email domain
  const domain = getEmailDomain(input.email);
  const allCampuses = await repo.findCampusByEmailDomain(app.db, domain);
  const campus = allCampuses.find((c) => {
    const domains = c.emailDomains as string[];
    return domains.includes(domain) || c.emailDomain === domain;
  });

  if (campus === undefined) {
    throw Object.assign(new Error('University not supported yet'), { statusCode: 400 });
  }

  // Hash password
  const passwordHash = await hashPassword(input.password, config.BCRYPT_ROUNDS);

  // Create user
  const [newUser] = await repo.createUser(app.db, {
    email: input.email,
    phone: input.phone,
    passwordHash,
    name: input.full_name,
    campusId: campus.id,
    status: 'pending_verification',
  });

  if (newUser === undefined) {
    throw new Error('Failed to create user');
  }

  // Create student profile
  await repo.createStudentProfile(app.db, { userId: newUser.id });

  // Generate + store OTP
  const { otp, otpHash, expiresAt } = await createOtp(10);
  await repo.createEmailOtp(app.db, {
    email: input.email,
    otpHash,
    purpose: 'registration',
    expiresAt,
  });

  // Rate limit key
  await app.redis.set(`otp:email:${input.email}`, '1', 'EX', 600);

  // Send email
  await sendOtpEmail(input.email, otp);

  // Kafka event
  if (app.kafka) {
    try {
      await app.kafka.send({
        topic: 'nexus.users.registration_initiated',
        messages: [
          {
            key: newUser.id,
            value: JSON.stringify({
              userId: newUser.id,
              email: input.email,
              campusId: campus.id,
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      });
    } catch {
      logger.warn('Failed to publish registration event');
    }
  }

  logger.info({ userId: newUser.id, campus: campus.code }, 'User registration initiated');

  return {
    message: 'OTP sent to your university email',
    email: maskEmail(input.email),
    expires_in: 600,
  };
}

// ── Email Verification ─────────────────────────────────
export async function verifyEmail(
  app: FastifyInstance,
  request: FastifyRequest,
  input: VerifyEmailInput,
): Promise<AuthResult> {
  const [otpRecord] = await repo.findLatestUnusedOtp(app.db, input.email, 'registration');

  if (otpRecord === undefined) {
    throw Object.assign(new Error('OTP not found or already used'), { statusCode: 400 });
  }

  if (otpRecord.expiresAt < new Date()) {
    await repo.markOtpUsed(app.db, otpRecord.id);
    throw Object.assign(new Error('OTP expired'), { statusCode: 400 });
  }

  if (otpRecord.attempts >= 3) {
    await repo.markOtpUsed(app.db, otpRecord.id);
    throw Object.assign(new Error('Too many attempts, request a new OTP'), { statusCode: 400 });
  }

  const isValid = await verifyOtp(input.otp, otpRecord.otpHash);
  if (!isValid) {
    await repo.incrementOtpAttempts(app.db, otpRecord.id, otpRecord.attempts);
    throw Object.assign(new Error('Invalid OTP'), { statusCode: 400 });
  }

  // Mark OTP used
  await repo.markOtpUsed(app.db, otpRecord.id);

  // Update user status
  const [user] = await repo.findUserByEmail(app.db, input.email);
  if (user === undefined) {
    throw Object.assign(new Error('User not found'), { statusCode: 404 });
  }

  await repo.updateUser(app.db, user.id, {
    emailVerified: true,
    status: 'active',
    verificationLevel: '1',
  });

  // Build tokens
  const updatedUser = { ...user, status: 'active', verificationLevel: '1', emailVerified: true };
  const { tokens, refreshTokenRaw } = await buildTokenPair(app, updatedUser);

  // Store session
  await createAndStoreSession(app, user.id, refreshTokenRaw, request);

  // Kafka event
  if (app.kafka) {
    try {
      await app.kafka.send({
        topic: 'nexus.users.email_verified',
        messages: [
          {
            key: user.id,
            value: JSON.stringify({
              userId: user.id,
              campusId: user.campusId,
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      });
    } catch {
      logger.warn('Failed to publish email_verified event');
    }
  }

  logger.info({ userId: user.id }, 'Email verified successfully');

  return {
    tokens,
    user: buildUserProfile(updatedUser),
  };
}

// ── Login ──────────────────────────────────────────────
export async function login(
  app: FastifyInstance,
  request: FastifyRequest,
  input: LoginInput,
): Promise<AuthResult> {
  const [user] = await repo.findUserByEmail(app.db, input.email);

  // Timing attack prevention: always delay if user not found
  if (user === undefined) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
  }

  // Check account status
  if (user.status === 'suspended' || user.isSuspended) {
    throw Object.assign(new Error('Account suspended. Contact support.'), { statusCode: 403 });
  }
  if (user.status === 'banned') {
    throw Object.assign(new Error('Account permanently banned.'), { statusCode: 403 });
  }

  // Check account lock
  if (user.lockedUntil !== null && user.lockedUntil > new Date()) {
    throw Object.assign(
      new Error(`Account locked. Try again later.`),
      { statusCode: 429 },
    );
  }

  // Check email verification
  if (!user.emailVerified) {
    throw Object.assign(new Error('Please verify your email first.'), { statusCode: 403 });
  }

  // Compare password
  const passwordValid = await comparePassword(input.password, user.passwordHash);
  if (!passwordValid) {
    const newAttempts = user.failedLoginAttempts + 1;

    if (newAttempts >= 5) {
      const lockUntil = new Date(Date.now() + 15 * 60 * 1000);
      await repo.updateUser(app.db, user.id, {
        failedLoginAttempts: 0,
        lockedUntil: lockUntil,
      });
      throw Object.assign(new Error('Account locked for 15 minutes'), { statusCode: 429 });
    }

    await repo.updateUser(app.db, user.id, { failedLoginAttempts: newAttempts });

    if (newAttempts >= 3) {
      throw Object.assign(
        new Error(`Invalid credentials. ${5 - newAttempts} attempts remaining.`),
        { statusCode: 401 },
      );
    }

    throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
  }

  // Success — reset counters
  await repo.updateUser(app.db, user.id, {
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: new Date(),
  });

  // Revoke existing session for this device
  const fp = input.device_fingerprint ?? extractDeviceFingerprint(request);
  await repo.deactivateSessionByDeviceFingerprint(app.db, user.id, fp);

  // Build tokens
  const { tokens, refreshTokenRaw } = await buildTokenPair(app, user);

  // Store session
  await createAndStoreSession(app, user.id, refreshTokenRaw, request, fp);

  // Kafka event
  if (app.kafka) {
    try {
      await app.kafka.send({
        topic: 'nexus.users.login',
        messages: [
          {
            key: user.id,
            value: JSON.stringify({
              userId: user.id,
              ip: request.ip,
              device_fingerprint: fp,
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      });
    } catch {
      logger.warn('Failed to publish login event');
    }
  }

  logger.info({ userId: user.id }, 'User logged in');

  return {
    tokens,
    user: buildUserProfile(user),
  };
}

// ── Refresh Token ──────────────────────────────────────
export async function refreshTokens(
  app: FastifyInstance,
  request: FastifyRequest,
  input: RefreshInput,
): Promise<TokenPair> {
  const incomingHash = hashRefreshToken(input.refresh_token);

  // Check for recently-rotated token (grace period)
  const recentlyRotated = await app.redis.get(`rotated:${incomingHash}`);
  if (recentlyRotated !== null) {
    // Return cached new tokens from the grace period
    const cachedTokens = JSON.parse(recentlyRotated) as TokenPair;
    return cachedTokens;
  }

  const [session] = await repo.findSessionByTokenHash(app.db, incomingHash);

  if (session === undefined) {
    throw Object.assign(new Error('Invalid or expired session'), { statusCode: 401 });
  }

  if (session.expiresAt < new Date()) {
    await repo.deactivateSession(app.db, session.id);
    throw Object.assign(new Error('Session expired'), { statusCode: 401 });
  }

  // Verify user is still active
  const [user] = await repo.findUserById(app.db, session.userId);
  if (user === undefined || user.status === 'suspended' || user.status === 'banned') {
    await repo.deactivateSession(app.db, session.id);
    throw Object.assign(new Error('Account not active'), { statusCode: 401 });
  }

  // ROTATE — invalidate old, create new
  await repo.deactivateSession(app.db, session.id);

  const { tokens, refreshTokenRaw } = await buildTokenPair(app, user);
  await createAndStoreSession(app, user.id, refreshTokenRaw, request, session.deviceFingerprint ?? undefined);

  // Grace period: cache old → new mapping for 30s (handles parallel requests)
  await app.redis.set(`rotated:${incomingHash}`, JSON.stringify(tokens), 'EX', 30);

  return tokens;
}

// ── Logout ─────────────────────────────────────────────
export async function logout(
  app: FastifyInstance,
  userId: string,
  jti: string,
  refreshToken?: string,
): Promise<void> {
  if (refreshToken !== undefined) {
    const tokenHash = hashRefreshToken(refreshToken);
    const [session] = await repo.findSessionByTokenHash(app.db, tokenHash);
    if (session !== undefined) {
      await repo.deactivateSession(app.db, session.id);
    }
  }

  // Blocklist the access token JTI for remaining lifetime (max 15 min)
  await app.redis.set(`token:blocklist:${jti}`, '1', 'EX', 900);

  if (app.kafka) {
    try {
      await app.kafka.send({
        topic: 'nexus.users.logout',
        messages: [
          {
            key: userId,
            value: JSON.stringify({ userId, timestamp: new Date().toISOString() }),
          },
        ],
      });
    } catch {
      logger.warn('Failed to publish logout event');
    }
  }
}

// ── Logout All Devices ─────────────────────────────────
export async function logoutAll(app: FastifyInstance, userId: string): Promise<void> {
  await repo.deactivateAllUserSessions(app.db, userId);

  // Scan and delete Redis session keys
  let cursor = '0';
  do {
    const [nextCursor, keys] = await app.redis.scan(
      cursor,
      'MATCH',
      `session:${userId}:*`,
      'COUNT',
      100,
    );
    cursor = nextCursor;
    if (keys.length > 0) {
      await app.redis.del(...keys);
    }
  } while (cursor !== '0');
}

// ── Resend OTP ─────────────────────────────────────────
export async function resendOtp(
  app: FastifyInstance,
  email: string,
  purpose: 'registration' | 'password_reset',
): Promise<{ message: string; expires_in: number }> {
  // Rate limit check
  const count = await app.redis.incr(`otp_resend:${email}`);
  if (count === 1) {
    await app.redis.expire(`otp_resend:${email}`, 3600);
  }
  if (count > 3) {
    throw Object.assign(new Error('Too many OTP requests. Try again in 1 hour.'), { statusCode: 429 });
  }

  const [user] = await repo.findUserByEmail(app.db, email);
  if (user === undefined) {
    // Still return 200 to prevent enumeration
    return { message: 'If the email is registered, a new OTP has been sent', expires_in: 600 };
  }

  // Mark previous OTPs as used
  await repo.markAllOtpsUsed(app.db, email, purpose);

  // Generate + store new OTP
  const { otp, otpHash, expiresAt } = await createOtp(10);
  await repo.createEmailOtp(app.db, { email, otpHash, purpose, expiresAt });

  await sendOtpEmail(email, otp);

  return { message: 'New OTP sent', expires_in: 600 };
}

// ── Forgot Password ────────────────────────────────────
export async function forgotPassword(
  app: FastifyInstance,
  email: string,
): Promise<{ message: string }> {
  // Always return 200 regardless of email existence (prevents enumeration)
  const [user] = await repo.findUserByEmail(app.db, email);

  if (user !== undefined) {
    await repo.markAllOtpsUsed(app.db, email, 'password_reset');
    const { otp, otpHash, expiresAt } = await createOtp(10);
    await repo.createEmailOtp(app.db, { email, otpHash, purpose: 'password_reset', expiresAt });
    await sendOtpEmail(email, otp);

    if (app.kafka) {
      try {
        await app.kafka.send({
          topic: 'nexus.users.password_reset_requested',
          messages: [
            {
              key: user.id,
              value: JSON.stringify({ userId: user.id, timestamp: new Date().toISOString() }),
            },
          ],
        });
      } catch {
        logger.warn('Failed to publish password_reset_requested event');
      }
    }
  }

  return { message: 'If the email is registered, a reset code has been sent' };
}

// ── Reset Password ─────────────────────────────────────
export async function resetPassword(
  app: FastifyInstance,
  input: ResetPasswordInput,
): Promise<{ message: string }> {
  // Verify OTP
  const [otpRecord] = await repo.findLatestUnusedOtp(app.db, input.email, 'password_reset');

  if (otpRecord === undefined) {
    throw Object.assign(new Error('OTP not found or already used'), { statusCode: 400 });
  }

  if (otpRecord.expiresAt < new Date()) {
    await repo.markOtpUsed(app.db, otpRecord.id);
    throw Object.assign(new Error('OTP expired'), { statusCode: 400 });
  }

  if (otpRecord.attempts >= 3) {
    await repo.markOtpUsed(app.db, otpRecord.id);
    throw Object.assign(new Error('Too many attempts, request a new OTP'), { statusCode: 400 });
  }

  const isValid = await verifyOtp(input.otp, otpRecord.otpHash);
  if (!isValid) {
    await repo.incrementOtpAttempts(app.db, otpRecord.id, otpRecord.attempts);
    throw Object.assign(new Error('Invalid OTP'), { statusCode: 400 });
  }

  await repo.markOtpUsed(app.db, otpRecord.id);

  // Verify user exists
  const [user] = await repo.findUserByEmail(app.db, input.email);
  if (user === undefined) {
    throw Object.assign(new Error('User not found'), { statusCode: 404 });
  }

  // Check new password != current password
  const isSamePassword = await comparePassword(input.new_password, user.passwordHash);
  if (isSamePassword) {
    throw Object.assign(new Error('New password must be different from current password'), { statusCode: 400 });
  }

  // Update password
  const newHash = await hashPassword(input.new_password, config.BCRYPT_ROUNDS);
  await repo.updateUser(app.db, user.id, { passwordHash: newHash });

  // Invalidate all sessions
  await repo.deactivateAllUserSessions(app.db, user.id);

  if (app.kafka) {
    try {
      await app.kafka.send({
        topic: 'nexus.users.password_reset_completed',
        messages: [
          {
            key: user.id,
            value: JSON.stringify({ userId: user.id, timestamp: new Date().toISOString() }),
          },
        ],
      });
    } catch {
      logger.warn('Failed to publish password_reset_completed event');
    }
  }

  logger.info({ userId: user.id }, 'Password reset completed');

  return { message: 'Password reset successful. Please login again.' };
}

// ── Get Current User Profile ───────────────────────────
export async function getMe(
  app: FastifyInstance,
  userId: string,
): Promise<UserProfile> {
  // Check Redis cache first
  const cached = await app.redis.get(`user:profile:${userId}`);
  if (cached !== null) {
    return JSON.parse(cached) as UserProfile;
  }

  const [user] = await repo.findUserById(app.db, userId);
  if (user === undefined) {
    throw Object.assign(new Error('User not found'), { statusCode: 404 });
  }

  // Fetch campus name
  const [campus] = await repo.findCampusById(app.db, user.campusId);
  const profile = buildUserProfile(user, campus?.name);

  // Cache for 5 minutes
  await app.redis.set(`user:profile:${userId}`, JSON.stringify(profile), 'EX', 300);

  return profile;
}
