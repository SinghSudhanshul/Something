/**
 * Auth Module — Routes
 *
 * All auth endpoints with Zod validation schemas, rate limiting overrides,
 * and full Swagger/OpenAPI documentation.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as controller from './auth.controller.js';

// ── Zod Schemas ────────────────────────────────────────
const registerSchema = z.object({
  email: z.string().email(),
  phone: z.string().regex(/^\+91[6-9]\d{9}$/, 'Must be valid Indian mobile (+91...)'),
  password: z
    .string()
    .min(8)
    .regex(
      /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&])/,
      'Must contain uppercase, lowercase, digit, and special character',
    ),
  full_name: z.string().min(2).max(100),
});

const verifyEmailSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6).regex(/^\d{6}$/),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  device_fingerprint: z.string().optional(),
});

const refreshSchema = z.object({
  refresh_token: z.string().min(128).max(128),
});

const resendOtpSchema = z.object({
  email: z.string().email(),
  purpose: z.enum(['registration', 'password_reset']),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6).regex(/^\d{6}$/),
  new_password: z
    .string()
    .min(8)
    .regex(
      /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&])/,
      'Must contain uppercase, lowercase, digit, and special character',
    ),
});

// ── Validation Middleware ──────────────────────────────
function zodValidate<T>(schema: z.ZodSchema<T>) {
  return async (request: { body: unknown }): Promise<void> => {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      const errors = result.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      throw Object.assign(new Error('Validation failed'), {
        statusCode: 400,
        validation: errors,
      });
    }
    request.body = result.data;
  };
}

// ── Route Registration ─────────────────────────────────
async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /register
  app.post('/api/v1/auth/register', {
    preHandler: zodValidate(registerSchema),
    config: { rateLimit: { max: 3, timeWindow: 3600000, keyGenerator: (req: { ip: string }) => req.ip } },
    schema: {
      tags: ['Auth'],
      summary: 'Register a new user',
      description: 'Create a new user account with university email. Sends OTP for verification.',
      body: {
        type: 'object',
        required: ['email', 'phone', 'password', 'full_name'],
        properties: {
          email: { type: 'string', format: 'email' },
          phone: { type: 'string', pattern: '^\\+91[6-9]\\d{9}$' },
          password: { type: 'string', minLength: 8 },
          full_name: { type: 'string', minLength: 2, maxLength: 100 },
        },
      },
      response: { 201: { type: 'object', properties: { message: { type: 'string' }, email: { type: 'string' }, expires_in: { type: 'number' } } } },
    },
    handler: controller.registerHandler,
  });

  // POST /verify-email
  app.post('/api/v1/auth/verify-email', {
    preHandler: zodValidate(verifyEmailSchema),
    schema: {
      tags: ['Auth'],
      summary: 'Verify email with OTP',
      description: 'Verify university email address using the 6-digit OTP sent during registration.',
    },
    handler: controller.verifyEmailHandler,
  });

  // POST /login
  app.post('/api/v1/auth/login', {
    preHandler: zodValidate(loginSchema),
    config: { rateLimit: { max: 10, timeWindow: 900000, keyGenerator: (req: { ip: string }) => req.ip } },
    schema: {
      tags: ['Auth'],
      summary: 'Login with credentials',
      description: 'Authenticate with email and password. Returns JWT access + refresh token pair.',
    },
    handler: controller.loginHandler,
  });

  // POST /refresh
  app.post('/api/v1/auth/refresh', {
    preHandler: zodValidate(refreshSchema),
    config: { rateLimit: { max: 20, timeWindow: 60000, keyGenerator: (req: { ip: string }) => req.ip } },
    schema: {
      tags: ['Auth'],
      summary: 'Refresh access token',
      description: 'Exchange a valid refresh token for a new JWT access + refresh token pair. Old refresh token is rotated.',
    },
    handler: controller.refreshHandler,
  });

  // POST /logout (requires auth)
  app.post('/api/v1/auth/logout', {
    onRequest: [app.authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'Logout current device',
      description: 'Deactivates the current session and blocklists the access token.',
    },
    handler: controller.logoutHandler,
  });

  // POST /logout-all (requires auth)
  app.post('/api/v1/auth/logout-all', {
    onRequest: [app.authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'Logout all devices',
      description: 'Deactivates all sessions for the current user across all devices.',
    },
    handler: controller.logoutAllHandler,
  });

  // POST /resend-otp
  app.post('/api/v1/auth/resend-otp', {
    preHandler: zodValidate(resendOtpSchema),
    config: { rateLimit: { max: 3, timeWindow: 3600000, keyGenerator: (req: any) => req.body?.email || req.ip } },
    schema: {
      tags: ['Auth'],
      summary: 'Resend OTP',
      description: 'Request a new OTP code. Rate limited to 3 per email per hour.',
    },
    handler: controller.resendOtpHandler,
  });

  // POST /forgot-password
  app.post('/api/v1/auth/forgot-password', {
    preHandler: zodValidate(forgotPasswordSchema),
    config: { rateLimit: { max: 3, timeWindow: 3600000, keyGenerator: (req: any) => req.body?.email || req.ip } },
    schema: {
      tags: ['Auth'],
      summary: 'Request password reset',
      description: 'Sends a password reset OTP to the registered email. Always returns 200 to prevent email enumeration.',
    },
    handler: controller.forgotPasswordHandler,
  });

  // POST /reset-password
  app.post('/api/v1/auth/reset-password', {
    preHandler: zodValidate(resetPasswordSchema),
    schema: {
      tags: ['Auth'],
      summary: 'Reset password with OTP',
      description: 'Reset password using the OTP sent via forgot-password endpoint. Invalidates all active sessions.',
    },
    handler: controller.resetPasswordHandler,
  });

  // GET /me (requires auth)
  app.get('/api/v1/auth/me', {
    onRequest: [app.authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'Get current user profile',
      description: 'Returns the profile of the currently authenticated user. Cached in Redis for 5 minutes.',
    },
    handler: controller.getMeHandler,
  });
}

export default authRoutes;
