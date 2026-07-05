/**
 * NEXUS Bazaar — Image Upload Controller
 *
 * Handles S3 pre-signed URL generation for listing images.
 * Uses pre-signed PUT URLs for direct browser/mobile upload.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { AppError, createLogger, requireAuth } from '@nexus/utils';
import { config } from '../../config.js';

const logger = createLogger('bazaar:upload');

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const PresignedUrlSchema = z.object({
  contentType: z.string().refine((v) => ALLOWED_MIME_TYPES.has(v), {
    message: 'Invalid content type. Allowed: JPEG, PNG, WebP, HEIC',
  }),
  contentLength: z.number().int().positive().max(MAX_FILE_SIZE).optional(),
  listingId: z.string().uuid().optional(), // optional - for editing existing listings
});

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: config.AWS_REGION,
      credentials: {
        accessKeyId: (config as any).AWS_ACCESS_KEY_ID,
        secretAccessKey: (config as any).AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return s3Client;
}

function buildS3Key(userId: string, listingId: string | undefined, contentType: string): string {
  const ext = contentType.split('/')[1] ?? 'jpg';
  const id = listingId ?? uuid();
  const imageId = uuid();
  return `bazaar/${userId}/${id}/${imageId}.${ext}`;
}

export default async function uploadRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/uploads/presigned
   * Get a pre-signed URL to upload a listing image
   */
  fastify.post(
    '/api/v1/uploads/presigned',
    {
      preHandler: [requireAuth()],
      schema: {
        tags: ['Uploads'],
        summary: 'Get pre-signed URL for image upload',
        body: PresignedUrlSchema,
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = (req as any).user;
      if (!user) throw AppError.unauthorized('Authentication required');

      const data = PresignedUrlSchema.parse(req.body);
      const key = buildS3Key(user.id, data.listingId, data.contentType);

      const command = new PutObjectCommand({
        Bucket: config.AWS_S3_MEDIA_BUCKET,
        Key: key,
        ContentType: data.contentType,
        ContentLength: data.contentLength,
        Metadata: {
          userId: user.id,
          uploadedAt: new Date().toISOString(),
        },
      });

      const presignedUrl = await getSignedUrl(getS3Client(), command, {
        expiresIn: 300, // 5 minutes
      });

      return reply.send({
        presignedUrl,
        key,
        publicUrl: `https://${config.AWS_CLOUDFRONT_DOMAIN}/${key}`,
        expiresIn: 300,
      });
    },
  );

  /**
   * DELETE /api/v1/uploads/:key
   * Delete an uploaded image (S3 + CloudFront invalidation)
   */
  fastify.delete(
    '/api/v1/uploads/:key',
    {
      preHandler: [requireAuth()],
      schema: {
        tags: ['Uploads'],
        summary: 'Delete an uploaded image',
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = (req as any).user;
      if (!user) throw AppError.unauthorized('Authentication required');

      const params = req.params as { key: string };
      const decodedKey = decodeURIComponent(params.key);

      // Verify ownership: key must start with "bazaar/{userId}/"
      if (!decodedKey.startsWith(`bazaar/${user.id}/`)) {
        throw AppError.forbidden('You can only delete your own uploads');
      }

      try {
        await getS3Client().send(
          new DeleteObjectCommand({
            Bucket: config.AWS_S3_MEDIA_BUCKET,
            Key: decodedKey,
          }),
        );
      } catch (err) {
        logger.error({ err, key: decodedKey }, 'S3 delete failed');
        // Don't fail the request - just log and queue for retry
        await fastify.redis.rpush(
          'bazaar:s3:delete_queue',
          JSON.stringify({ key: decodedKey, retries: 0 }),
        );
      }

      return reply.code(204).send();
    },
  );

  /**
   * POST /api/v1/uploads/batch-presigned
   * Get multiple pre-signed URLs at once (for multi-image upload)
   */
  fastify.post(
    '/api/v1/uploads/batch-presigned',
    {
      preHandler: [requireAuth()],
      schema: {
        tags: ['Uploads'],
        summary: 'Get multiple pre-signed URLs (max 8)',
        body: z.object({
          files: z
            .array(
              z.object({
                contentType: z.string().refine((v) => ALLOWED_MIME_TYPES.has(v)),
                contentLength: z.number().int().positive().max(MAX_FILE_SIZE).optional(),
              }),
            )
            .min(1)
            .max(8),
          listingId: z.string().uuid().optional(),
        }),
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = (req as any).user;
      if (!user) throw AppError.unauthorized('Authentication required');

      const { files, listingId } = req.body as {
        files: Array<{ contentType: string; contentLength?: number }>;
        listingId?: string;
      };

      const urls = await Promise.all(
        files.map(async (file) => {
          const key = buildS3Key(user.id, listingId, file.contentType);
          const command = new PutObjectCommand({
            Bucket: config.AWS_S3_MEDIA_BUCKET,
            Key: key,
            ContentType: file.contentType,
            ContentLength: file.contentLength,
            Metadata: {
              userId: user.id,
              uploadedAt: new Date().toISOString(),
            },
          });
          const presignedUrl = await getSignedUrl(getS3Client(), command, { expiresIn: 300 });
          return {
            presignedUrl,
            key,
            publicUrl: `https://${config.AWS_CLOUDFRONT_DOMAIN}/${key}`,
          };
        }),
      );

      return reply.send({ items: urls, expiresIn: 300 });
    },
  );
}
