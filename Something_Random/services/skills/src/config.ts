/**
 * NEXUS Skills Service — Zod-validated Environment Configuration
 */

import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  SKILLS_PORT: z.coerce.number().int().positive().default(3007),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL connection string'),
  REDIS_URL: z.string().url('REDIS_URL must be a valid Redis connection string'),
  KAFKA_BROKERS: z.string().min(1, 'KAFKA_BROKERS must be a comma-separated list of broker addresses'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  SKILLS_CORS_ORIGIN: z.string().default('http://localhost:3000'),
});

export type EnvConfig = z.infer<typeof envSchema>;

function loadConfig(): EnvConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  ✗ ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    console.error(`\n╔══════════════════════════════════════════════╗`);
    console.error(`║  SKILLS SERVICE — CONFIGURATION ERROR     ║`);
    console.error(`╚══════════════════════════════════════════════╝\n`);
    console.error(`Missing or invalid environment variables:\n${formatted}\n`);
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();
