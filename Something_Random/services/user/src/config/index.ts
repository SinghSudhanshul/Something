import { z } from 'zod';

const configSchema = z.object({
  port: z.coerce.number().default(3002),
  nodeEnv: z.string().default('development'),
  databaseUrl: z.string(),
  redisUrl: z.string(),
  kafkaBrokers: z.string().transform((val) => val.split(',').map((b) => b.trim())),
  awsRegion: z.string().default('ap-south-1'),
  s3Bucket: z.string().default('campusly-dev'),
  awsAccessKey: z.string().optional(),
  awsSecretKey: z.string().optional(),
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
  awsRegion: parsed.data.awsRegion,
  s3Bucket: parsed.data.s3Bucket,
  awsAccessKey: parsed.data.awsAccessKey,
  awsSecretKey: parsed.data.awsSecretKey,
};
