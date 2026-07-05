/**
 * NEXUS Feast Service — Zod-validated Environment Configuration
 */

import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3004),
  SERVICE_NAME: z.string().default('feast'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  KAFKA_BROKERS: z.string().min(1),
  FOSCOS_API_URL: z.string().nullable().default(null),
  INTERNAL_SERVICE_SECRET: z.string().min(16),
  WALLET_SERVICE_URL: z.string().default('http://localhost:3003'),
  USER_SERVICE_URL: z.string().default('http://localhost:3013'),
  JWT_ACCESS_SECRET: z.string().min(32).default('development-secret-key-change-in-production'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
});

export type EnvConfig = z.infer<typeof envSchema>;

function loadConfig(): EnvConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues.map((i) => `  ✗ ${i.path.join('.')}: ${i.message}`).join('\n');
    console.error(`\n╔══════════════════════════════════════════════╗`);
    console.error(`║  FEAST SERVICE — CONFIGURATION ERROR         ║`);
    console.error(`╚══════════════════════════════════════════════╝\n`);
    console.error(`Missing or invalid environment variables:\n${formatted}\n`);
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();
