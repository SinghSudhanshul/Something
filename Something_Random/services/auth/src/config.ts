/**
 * Auth Service — Zod-validated Environment Configuration
 *
 * All required environment variables are validated at startup.
 * Missing or invalid values cause an immediate descriptive error.
 */

import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  AUTH_PORT: z.coerce.number().int().nonnegative().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  KAFKA_BROKERS: z.string().min(1, 'KAFKA_BROKERS is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY_DAYS: z.coerce.number().default(30),

  BCRYPT_ROUNDS: z.coerce.number().default(12),
  ALLOWED_EMAIL_DOMAINS: z.string().default('srmist.edu.in,srm.edu.in,srmuniv.ac.in'),
  AUTH_CORS_ORIGIN: z.string().default('http://localhost:3000'),

  AWS_REGION: z.string().default('ap-south-1'),
  AWS_SES_FROM_EMAIL: z.string().default('no-reply@nexus.app'),
  
  AWS_S3_DOCUMENTS_BUCKET: z.string().default('nexus-documents-dev'),
  AWS_S3_MEDIA_BUCKET: z.string().default('nexus-media-dev'),
  MSG91_API_KEY: z.string().optional(),
  MSG91_SENDER_ID: z.string().default('NEXUS'),
  MSG91_OTP_TEMPLATE_ID: z.string().optional(),
  MAX_VERIFICATION_ATTEMPTS_PER_DAY: z.coerce.number().default(3),
});

export type EnvConfig = z.infer<typeof envSchema>;

function loadConfig(): EnvConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  ✗ ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    console.error(`\n╔══════════════════════════════════════════════╗`);
    console.error(`║  AUTH SERVICE — CONFIGURATION ERROR           ║`);
    console.error(`╚══════════════════════════════════════════════╝\n`);
    console.error(`Missing or invalid environment variables:\n${formatted}\n`);
    console.error(`Copy .env.example to .env and fill in the required values.\n`);
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();
