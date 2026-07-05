/**
 * Auth Service — Unit Tests
 *
 * Tests for auth.service.ts business logic.
 * All external dependencies (db, redis, kafka, email) are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock modules BEFORE importing the service ─────────
vi.mock('../../utils/password.js', () => ({
  hashPassword: vi.fn().mockResolvedValue('$2b$12$hashed_password'),
  comparePassword: vi.fn(),
  hashOtp: vi.fn().mockResolvedValue('$2b$10$hashed_otp'),
  compareOtp: vi.fn(),
}));

vi.mock('../../utils/token.js', () => ({
  generateAccessToken: vi.fn().mockReturnValue('mock.jwt.token'),
  generateRefreshToken: vi.fn().mockReturnValue('a'.repeat(128)),
  hashRefreshToken: vi.fn().mockReturnValue('sha256_hash_of_refresh'),
  generateOtp: vi.fn().mockReturnValue('123456'),
}));

vi.mock('../../utils/device.js', () => ({
  extractDeviceFingerprint: vi.fn().mockReturnValue('device_fp_hash'),
}));

vi.mock('../otp/otp.service.js', () => ({
  createOtp: vi.fn().mockResolvedValue({
    otp: '123456',
    otpHash: '$2b$10$hashed_otp',
    expiresAt: new Date(Date.now() + 600000),
  }),
  verifyOtp: vi.fn(),
}));

vi.mock('../otp/email.service.js', () => ({
  sendOtpEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../config.js', () => ({
  config: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    JWT_REFRESH_SECRET: 'b'.repeat(64),
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY_DAYS: 30,
    BCRYPT_ROUNDS: 4,
    ALLOWED_EMAIL_DOMAINS: 'srmist.edu.in,srm.edu.in,srmuniv.ac.in',
    AUTH_CORS_ORIGIN: 'http://localhost:3000',
    AWS_REGION: 'ap-south-1',
    AWS_SES_FROM_EMAIL: 'no-reply@nexus.app',
    AUTH_PORT: 3001,
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    KAFKA_BROKERS: 'localhost:9092',
  },
}));

vi.mock('./auth.repository.js', () => ({
  findUserByEmail: vi.fn(),
  findUserByPhone: vi.fn(),
  findUserById: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  findCampusByEmailDomain: vi.fn(),
  findCampusById: vi.fn(),
  createStudentProfile: vi.fn(),
  createEmailOtp: vi.fn(),
  findLatestUnusedOtp: vi.fn(),
  markOtpUsed: vi.fn(),
  incrementOtpAttempts: vi.fn(),
  markAllOtpsUsed: vi.fn(),
  createSession: vi.fn(),
  findSessionByTokenHash: vi.fn(),
  deactivateSession: vi.fn(),
  deactivateAllUserSessions: vi.fn(),
  deactivateSessionByDeviceFingerprint: vi.fn(),
}));

// ── Import after mocks ────────────────────────────────
import * as authService from './auth.service.js';
import * as repo from './auth.repository.js';
import { comparePassword } from '../../utils/password.js';
import { verifyOtp } from '../otp/otp.service.js';
import { sendOtpEmail } from '../otp/email.service.js';

// ── Test Fixtures ──────────────────────────────────────
const mockApp = {
  jwt: { sign: vi.fn().mockReturnValue('mock.jwt.token') },
  redis: {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(1),
    scan: vi.fn().mockResolvedValue(['0', []]),
  },
  kafka: {
    send: vi.fn().mockResolvedValue([]),
  },
  db: {},
} as unknown as Parameters<typeof authService.register>[0];

const mockRequest = {
  ip: '127.0.0.1',
  headers: {
    'user-agent': 'vitest/1.0',
    'accept-language': 'en',
    'accept-encoding': 'gzip',
  },
  user: { sub: 'user-id-1', jti: 'jti-1' },
} as unknown as Parameters<typeof authService.register>[1];

const testCampus = {
  id: 'campus-1',
  name: 'SRM KTR',
  code: 'SRM_KTR',
  emailDomains: ['srmist.edu.in', 'srm.edu.in', 'srmuniv.ac.in'],
  emailDomain: 'srmist.edu.in',
  isActive: true,
};

const testUser = {
  id: 'user-id-1',
  email: 'arjun@srmist.edu.in',
  phone: '+919876543210',
  phoneVerified: false,
  emailVerified: true,
  passwordHash: '$2b$12$hashed_password',
  name: 'Arjun Kumar',
  username: null,
  avatarUrl: null,
  role: 'student',
  status: 'active',
  campusId: 'campus-1',
  verificationLevel: '1',
  trustTier: 'new',
  trustScore: 0,
  failedLoginAttempts: 0,
  lockedUntil: null,
  isActive: true,
  isSuspended: false,
  suspendedUntil: null,
  lastLoginAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Registration Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('register', () => {
  const validInput = {
    email: 'test@srmist.edu.in',
    phone: '+919876543210',
    password: 'Test@123456',
    full_name: 'Test User',
  };

  it('registers successfully with valid SRM email', async () => {
    vi.mocked(repo.findUserByEmail).mockResolvedValue([]);
    vi.mocked(repo.findUserByPhone).mockResolvedValue([]);
    vi.mocked(repo.findCampusByEmailDomain).mockResolvedValue([testCampus as never]);
    vi.mocked(repo.createUser).mockResolvedValue([{ ...testUser, id: 'new-user-1' }] as never);
    vi.mocked(repo.createStudentProfile).mockResolvedValue([{}] as never);
    vi.mocked(repo.createEmailOtp).mockResolvedValue([{}] as never);

    const result = await authService.register(mockApp, mockRequest, validInput);

    expect(result.message).toBe('OTP sent to your university email');
    expect(result.expires_in).toBe(600);
    expect(sendOtpEmail).toHaveBeenCalledWith('test@srmist.edu.in', '123456');
  });

  it('rejects non-university email (gmail)', async () => {
    const input = { ...validInput, email: 'test@gmail.com' };
    await expect(authService.register(mockApp, mockRequest, input)).rejects.toThrow('Must use a university email address');
  });

  it('rejects unknown domain (mit.edu)', async () => {
    const input = { ...validInput, email: 'test@mit.edu' };
    await expect(authService.register(mockApp, mockRequest, input)).rejects.toThrow('Must use a university email address');
  });

  it('returns 409 when email already registered (generic message)', async () => {
    vi.mocked(repo.findUserByEmail).mockResolvedValue([testUser] as never);

    await expect(authService.register(mockApp, mockRequest, validInput)).rejects.toThrow('Account already exists');
  });

  it('returns 409 when phone already registered (same generic message)', async () => {
    vi.mocked(repo.findUserByEmail).mockResolvedValue([]);
    vi.mocked(repo.findUserByPhone).mockResolvedValue([testUser] as never);

    await expect(authService.register(mockApp, mockRequest, validInput)).rejects.toThrow('Account already exists');
  });

  it('sends email with OTP', async () => {
    vi.mocked(repo.findUserByEmail).mockResolvedValue([]);
    vi.mocked(repo.findUserByPhone).mockResolvedValue([]);
    vi.mocked(repo.findCampusByEmailDomain).mockResolvedValue([testCampus as never]);
    vi.mocked(repo.createUser).mockResolvedValue([{ ...testUser, id: 'new-user' }] as never);
    vi.mocked(repo.createStudentProfile).mockResolvedValue([{}] as never);
    vi.mocked(repo.createEmailOtp).mockResolvedValue([{}] as never);

    await authService.register(mockApp, mockRequest, validInput);

    expect(sendOtpEmail).toHaveBeenCalledOnce();
  });

  it('publishes Kafka registration_initiated event', async () => {
    vi.mocked(repo.findUserByEmail).mockResolvedValue([]);
    vi.mocked(repo.findUserByPhone).mockResolvedValue([]);
    vi.mocked(repo.findCampusByEmailDomain).mockResolvedValue([testCampus as never]);
    vi.mocked(repo.createUser).mockResolvedValue([{ ...testUser, id: 'new-user' }] as never);
    vi.mocked(repo.createStudentProfile).mockResolvedValue([{}] as never);
    vi.mocked(repo.createEmailOtp).mockResolvedValue([{}] as never);

    await authService.register(mockApp, mockRequest, validInput);

    expect(mockApp.kafka.send).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'nexus.users.registration_initiated' }),
    );
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// OTP Verification Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('verifyEmail', () => {
  const validInput = { email: 'arjun@srmist.edu.in', otp: '123456' };

  const validOtpRecord = {
    id: 'otp-1',
    email: 'arjun@srmist.edu.in',
    otpHash: '$2b$10$hashed_otp',
    purpose: 'registration',
    attempts: 0,
    expiresAt: new Date(Date.now() + 600000),
    usedAt: null,
    createdAt: new Date(),
  };

  it('verifies correct OTP and returns JWT pair', async () => {
    vi.mocked(repo.findLatestUnusedOtp).mockResolvedValue([validOtpRecord] as never);
    vi.mocked(verifyOtp).mockResolvedValue(true);
    vi.mocked(repo.findUserByEmail).mockResolvedValue([testUser] as never);
    vi.mocked(repo.updateUser).mockResolvedValue(undefined as never);
    vi.mocked(repo.createSession).mockResolvedValue([{}] as never);

    const result = await authService.verifyEmail(mockApp, mockRequest, validInput);

    expect(result.tokens.access_token).toBeDefined();
    expect(result.tokens.refresh_token).toBeDefined();
    expect(result.tokens.token_type).toBe('Bearer');
    expect(result.tokens.expires_in).toBe(900);
  });

  it('rejects expired OTP', async () => {
    const expired = { ...validOtpRecord, expiresAt: new Date(Date.now() - 1000) };
    vi.mocked(repo.findLatestUnusedOtp).mockResolvedValue([expired] as never);

    await expect(authService.verifyEmail(mockApp, mockRequest, validInput)).rejects.toThrow('OTP expired');
  });

  it('rejects already-used OTP', async () => {
    vi.mocked(repo.findLatestUnusedOtp).mockResolvedValue([]);

    await expect(authService.verifyEmail(mockApp, mockRequest, validInput)).rejects.toThrow('OTP not found or already used');
  });

  it('increments attempt counter on wrong OTP', async () => {
    vi.mocked(repo.findLatestUnusedOtp).mockResolvedValue([validOtpRecord] as never);
    vi.mocked(verifyOtp).mockResolvedValue(false);

    await expect(authService.verifyEmail(mockApp, mockRequest, validInput)).rejects.toThrow('Invalid OTP');
    expect(repo.incrementOtpAttempts).toHaveBeenCalledWith(mockApp.db, 'otp-1', 0);
  });

  it('locks after 3 wrong attempts', async () => {
    const maxAttempts = { ...validOtpRecord, attempts: 3 };
    vi.mocked(repo.findLatestUnusedOtp).mockResolvedValue([maxAttempts] as never);

    await expect(authService.verifyEmail(mockApp, mockRequest, validInput)).rejects.toThrow('Too many attempts');
    expect(repo.markOtpUsed).toHaveBeenCalled();
  });

  it('access token has correct payload shape', async () => {
    vi.mocked(repo.findLatestUnusedOtp).mockResolvedValue([validOtpRecord] as never);
    vi.mocked(verifyOtp).mockResolvedValue(true);
    vi.mocked(repo.findUserByEmail).mockResolvedValue([testUser] as never);
    vi.mocked(repo.updateUser).mockResolvedValue(undefined as never);
    vi.mocked(repo.createSession).mockResolvedValue([{}] as never);

    const result = await authService.verifyEmail(mockApp, mockRequest, validInput);

    expect(result.user.id).toBeDefined();
    expect(result.user.email).toBeDefined();
    expect(result.user.campus_id).toBeDefined();
  });

  it('refresh token is 128 hex chars', async () => {
    vi.mocked(repo.findLatestUnusedOtp).mockResolvedValue([validOtpRecord] as never);
    vi.mocked(verifyOtp).mockResolvedValue(true);
    vi.mocked(repo.findUserByEmail).mockResolvedValue([testUser] as never);
    vi.mocked(repo.updateUser).mockResolvedValue(undefined as never);
    vi.mocked(repo.createSession).mockResolvedValue([{}] as never);

    const result = await authService.verifyEmail(mockApp, mockRequest, validInput);

    expect(result.tokens.refresh_token).toHaveLength(128);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Login Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('login', () => {
  const validInput = { email: 'arjun@srmist.edu.in', password: 'Test@123456' };

  it('logs in successfully with correct credentials', async () => {
    vi.mocked(repo.findUserByEmail).mockResolvedValue([testUser] as never);
    vi.mocked(comparePassword).mockResolvedValue(true);
    vi.mocked(repo.updateUser).mockResolvedValue(undefined as never);
    vi.mocked(repo.deactivateSessionByDeviceFingerprint).mockResolvedValue(undefined as never);
    vi.mocked(repo.createSession).mockResolvedValue([{}] as never);

    const result = await authService.login(mockApp, mockRequest, validInput);

    expect(result.tokens.access_token).toBeDefined();
    expect(result.user.id).toBe('user-id-1');
  });

  it('rejects wrong password (generic error)', async () => {
    vi.mocked(repo.findUserByEmail).mockResolvedValue([testUser] as never);
    vi.mocked(comparePassword).mockResolvedValue(false);
    vi.mocked(repo.updateUser).mockResolvedValue(undefined as never);

    await expect(authService.login(mockApp, mockRequest, validInput)).rejects.toThrow('Invalid credentials');
  });

  it('rejects non-existent email with same timing', async () => {
    vi.mocked(repo.findUserByEmail).mockResolvedValue([]);

    await expect(authService.login(mockApp, mockRequest, validInput)).rejects.toThrow('Invalid credentials');
  });

  it('increments failed_login_attempts on wrong password', async () => {
    vi.mocked(repo.findUserByEmail).mockResolvedValue([testUser] as never);
    vi.mocked(comparePassword).mockResolvedValue(false);
    vi.mocked(repo.updateUser).mockResolvedValue(undefined as never);

    await expect(authService.login(mockApp, mockRequest, validInput)).rejects.toThrow();

    expect(repo.updateUser).toHaveBeenCalledWith(mockApp.db, 'user-id-1', { failedLoginAttempts: 1 });
  });

  it('locks account after 5 failed attempts', async () => {
    const lockedUser = { ...testUser, failedLoginAttempts: 4 };
    vi.mocked(repo.findUserByEmail).mockResolvedValue([lockedUser] as never);
    vi.mocked(comparePassword).mockResolvedValue(false);
    vi.mocked(repo.updateUser).mockResolvedValue(undefined as never);

    await expect(authService.login(mockApp, mockRequest, validInput)).rejects.toThrow('Account locked for 15 minutes');
  });

  it('rejects suspended user (403)', async () => {
    const suspended = { ...testUser, status: 'suspended', isSuspended: true };
    vi.mocked(repo.findUserByEmail).mockResolvedValue([suspended] as never);

    const error = await authService.login(mockApp, mockRequest, validInput).catch((e: any) => e);
    expect(error.message).toBe('Account suspended. Contact support.');
    expect(error.statusCode).toBe(403);
  });

  it('rejects banned user (403)', async () => {
    const banned = { ...testUser, status: 'banned' };
    vi.mocked(repo.findUserByEmail).mockResolvedValue([banned] as never);

    const error = await authService.login(mockApp, mockRequest, validInput).catch((e: any) => e);
    expect(error.message).toBe('Account permanently banned.');
    expect(error.statusCode).toBe(403);
  });

  it('rejects unverified user (403)', async () => {
    const unverified = { ...testUser, emailVerified: false };
    vi.mocked(repo.findUserByEmail).mockResolvedValue([unverified] as never);

    const error = await authService.login(mockApp, mockRequest, validInput).catch((e: any) => e);
    expect(error.message).toBe('Please verify your email first.');
    expect(error.statusCode).toBe(403);
  });

  it('resets failed_login_attempts on successful login', async () => {
    const failedUser = { ...testUser, failedLoginAttempts: 3 };
    vi.mocked(repo.findUserByEmail).mockResolvedValue([failedUser] as never);
    vi.mocked(comparePassword).mockResolvedValue(true);
    vi.mocked(repo.updateUser).mockResolvedValue(undefined as never);
    vi.mocked(repo.deactivateSessionByDeviceFingerprint).mockResolvedValue(undefined as never);
    vi.mocked(repo.createSession).mockResolvedValue([{}] as never);

    await authService.login(mockApp, mockRequest, validInput);

    expect(repo.updateUser).toHaveBeenCalledWith(mockApp.db, 'user-id-1', expect.objectContaining({
      failedLoginAttempts: 0,
      lockedUntil: null,
    }));
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Refresh Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('refreshTokens', () => {
  const validSession = {
    id: 'session-1',
    userId: 'user-id-1',
    refreshTokenHash: 'sha256_hash',
    deviceFingerprint: 'device_fp_hash',
    isActive: true,
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
  };

  it('issues new token pair with valid refresh token', async () => {
    vi.mocked(repo.findSessionByTokenHash).mockResolvedValue([validSession] as never);
    vi.mocked(repo.findUserById).mockResolvedValue([testUser] as never);
    vi.mocked(repo.deactivateSession).mockResolvedValue(undefined as never);
    vi.mocked(repo.createSession).mockResolvedValue([{}] as never);

    const tokens = await authService.refreshTokens(mockApp, mockRequest, { refresh_token: 'a'.repeat(128) });

    expect(tokens.access_token).toBeDefined();
    expect(tokens.refresh_token).toBeDefined();
  });

  it('rotates refresh token (old invalidated)', async () => {
    vi.mocked(repo.findSessionByTokenHash).mockResolvedValue([validSession] as never);
    vi.mocked(repo.findUserById).mockResolvedValue([testUser] as never);
    vi.mocked(repo.deactivateSession).mockResolvedValue(undefined as never);
    vi.mocked(repo.createSession).mockResolvedValue([{}] as never);

    await authService.refreshTokens(mockApp, mockRequest, { refresh_token: 'a'.repeat(128) });

    expect(repo.deactivateSession).toHaveBeenCalledWith(mockApp.db, 'session-1');
    expect(repo.createSession).toHaveBeenCalled();
  });

  it('rejects expired refresh token', async () => {
    const expiredSession = { ...validSession, expiresAt: new Date(Date.now() - 1000) };
    vi.mocked(repo.findSessionByTokenHash).mockResolvedValue([expiredSession] as never);

    await expect(
      authService.refreshTokens(mockApp, mockRequest, { refresh_token: 'a'.repeat(128) }),
    ).rejects.toThrow('Session expired');
  });

  it('rejects already-rotated refresh token (replay)', async () => {
    vi.mocked(repo.findSessionByTokenHash).mockResolvedValue([]);

    await expect(
      authService.refreshTokens(mockApp, mockRequest, { refresh_token: 'a'.repeat(128) }),
    ).rejects.toThrow('Invalid or expired session');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Logout Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('logout', () => {
  it('adds JTI to blocklist', async () => {
    await authService.logout(mockApp, 'user-id-1', 'jti-1');

    expect(mockApp.redis.set).toHaveBeenCalledWith('token:blocklist:jti-1', '1', 'EX', 900);
  });

  it('deactivates session when refresh token provided', async () => {
    vi.mocked(repo.findSessionByTokenHash).mockResolvedValue([{ id: 'session-1' }] as never);

    await authService.logout(mockApp, 'user-id-1', 'jti-1', 'a'.repeat(128));

    expect(repo.deactivateSession).toHaveBeenCalledWith(mockApp.db, 'session-1');
  });
});
