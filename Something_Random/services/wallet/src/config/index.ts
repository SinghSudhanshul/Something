import { z } from 'zod';

const configSchema = z.object({
  port: z.coerce.number().default(3003),
  nodeEnv: z.string().default('development'),
  databaseUrl: z.string(),
  redisUrl: z.string(),
  kafkaBrokers: z.string().transform((val) => val.split(',').map((b) => b.trim())),
  razorpayKeyId: z.string(),
  razorpayKeySecret: z.string(),
  razorpayWebhookSecret: z.string(),
  awsRegion: z.string().default('ap-south-1'),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.format());
  process.exit(1);
}

export const config = {
  port: parsed.data.port,
  nodeEnv: parsed.data.nodeEnv,
  databaseUrl: parsed.data.databaseUrl,
  redisUrl: parsed.data.redisUrl,
  kafkaBrokers: parsed.data.kafkaBrokers,
  corsOrigins: parsed.data.nodeEnv === 'production'
    ? ['https://campusly.in']
    : ['http://localhost:3000', 'http://localhost:19006'],
  razorpayKeyId: parsed.data.razorpayKeyId,
  razorpayKeySecret: parsed.data.razorpayKeySecret,
  razorpayWebhookSecret: parsed.data.razorpayWebhookSecret,
  awsRegion: parsed.data.awsRegion,
};
