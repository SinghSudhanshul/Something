/**
 * NEXUS Bazaar — S3 Cleanup Worker
 *
 * Background worker that processes the S3 deletion queue in Redis.
 * Runs every 60s, processes in batches of 10, max 5 retries per key.
 */

import type { FastifyInstance } from 'fastify';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createLogger } from '@nexus/utils';
import { config } from '../config.js';

const logger = createLogger('bazaar:s3-cleanup');

export function startS3CleanupWorker(fastify: FastifyInstance): NodeJS.Timeout {
  const s3 = new S3Client({ region: config.AWS_REGION });
  const QUEUE_KEY = 'bazaar:s3:delete_queue';
  const BATCH_SIZE = 10;
  const MAX_RETRIES = 5;

  const interval = setInterval(async () => {
    try {
      const batchRaw = await fastify.redis.lrange(QUEUE_KEY, 0, BATCH_SIZE - 1);
      if (batchRaw.length === 0) return;

      // Remove items from queue atomically
      await fastify.redis.ltrim(QUEUE_KEY, batchRaw.length, -1);

      for (const raw of batchRaw) {
        try {
          const item = JSON.parse(raw) as { key: string; retries: number };

          await s3.send(new DeleteObjectCommand({
            Bucket: config.AWS_S3_MEDIA_BUCKET,
            Key: item.key,
          }));

          logger.debug({ key: item.key }, 'S3 object deleted');
        } catch (error) {
          const item = JSON.parse(raw) as { key: string; retries: number };
          const nextRetry = item.retries + 1;

          if (nextRetry >= MAX_RETRIES) {
            logger.error({ key: item.key, retries: nextRetry }, 'S3 delete failed after max retries — discarding');
          } else {
            // Push back with incremented retry count
            await fastify.redis.rpush(QUEUE_KEY, JSON.stringify({ key: item.key, retries: nextRetry }));
            logger.warn({ key: item.key, retries: nextRetry, err: error }, 'S3 delete failed — requeued');
          }
        }
      }
    } catch (error) {
      // Never crash the main process
      logger.error({ err: error }, 'S3 cleanup worker iteration failed');
    }
  }, 60_000);

  logger.info('S3 cleanup worker started (60s interval)');
  return interval;
}
