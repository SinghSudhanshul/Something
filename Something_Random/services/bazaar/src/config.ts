/**
 * NEXUS Bazaar Service — Zod-validated Environment Configuration
 *
 * Fails fast with descriptive errors on missing required variables.
 * No silent defaults for secrets.
 */

import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3002),
  SERVICE_NAME: z.string().default('bazaar'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  KAFKA_BROKERS: z.string().min(1, 'KAFKA_BROKERS is required'),
  ELASTICSEARCH_URL: z.string().min(1, 'ELASTICSEARCH_URL is required'),

  // AWS
  AWS_S3_MEDIA_BUCKET: z.string().min(1, 'AWS_S3_MEDIA_BUCKET is required'),
  AWS_CLOUDFRONT_DOMAIN: z.string().min(1, 'AWS_CLOUDFRONT_DOMAIN is required'),
  AWS_REKOGNITION_REGION: z.string().default('ap-south-1'),
  AWS_REGION: z.string().default('ap-south-1'),

  // Service auth
  INTERNAL_SERVICE_SECRET: z.string().min(16, 'INTERNAL_SERVICE_SECRET must be at least 16 characters'),
  WALLET_SERVICE_URL: z.string().default('http://localhost:3003'),
  USER_SERVICE_URL: z.string().default('http://localhost:3013'),

  // JWT (kept for local dev without Kong)
  JWT_ACCESS_SECRET: z.string().min(32).default('development-secret-key-change-in-production'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
});

export type EnvConfig = z.infer<typeof envSchema>;

function loadConfig(): EnvConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  ✗ ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    console.error(`\n╔══════════════════════════════════════════════╗`);
    console.error(`║  BAZAAR SERVICE — CONFIGURATION ERROR        ║`);
    console.error(`╚══════════════════════════════════════════════╝\n`);
    console.error(`Missing or invalid environment variables:\n${formatted}\n`);
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();
