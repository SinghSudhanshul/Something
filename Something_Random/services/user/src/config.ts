import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3013),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  KAFKA_BROKERS: z.string().min(1, 'KAFKA_BROKERS is required'),

  AWS_REGION: z.string().default('ap-south-1'),
  AWS_S3_MEDIA_BUCKET: z.string().default('nexus-media-dev'),
  CLOUDFRONT_DOMAIN: z.string().default('localhost:3013'),
});

export type EnvConfig = z.infer<typeof envSchema>;

function loadConfig(): EnvConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  ✗ ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    console.error(`\n╔══════════════════════════════════════════════╗`);
    console.error(`║  USER SERVICE — CONFIGURATION ERROR           ║`);
    console.error(`╚══════════════════════════════════════════════╝\n`);
    console.error(`Missing or invalid environment variables:\n${formatted}\n`);
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();
