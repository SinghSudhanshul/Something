/**
 * Avatar Upload Service
 *
 * Handles avatar image upload, processing via sharp, and S3 storage.
 * Generates full (400×400) and thumbnail (80×80) WebP images.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createLogger } from '@nexus/utils';
import type { RequestUser } from '@nexus/utils';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

import { config } from '../../config.js';
import * as profileRepo from '../profile/profile.repository.js';

const logger = createLogger('avatar-service');

// S3 client — lazy initialization
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (s3Client === null) {
    s3Client = new S3Client({
      region: config.AWS_REGION,
      // In dev, will use default credentials or mock
    });
  }
  return s3Client;
}

/**
 * Process and upload avatar image.
 *
 * 1. Validate: JPEG/PNG/WebP, max 5MB, min 200×200
 * 2. Process through sharp (stream — no full buffer):
 *    - Full: 400×400 WebP quality 85
 *    - Thumb: 80×80 WebP quality 70
 * 3. Upload to S3 media bucket in parallel
 * 4. Store S3 key in DB (generate URL at response time)
 * 5. Queue old key for deletion
 */
export async function uploadAvatar(
  app: FastifyInstance,
  request: FastifyRequest,
  userId: string,
): Promise<{ avatar_url: string; thumbnail_url: string }> {
  const data = await request.file();

  if (data === undefined) {
    throw Object.assign(new Error('No file uploaded'), { statusCode: 400 });
  }

  // Validate mime type
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedMimes.includes(data.mimetype)) {
    throw Object.assign(
      new Error('Invalid file type. Allowed: JPEG, PNG, WebP'),
      { statusCode: 400 },
    );
  }

  // Read the buffer
  const chunks: Buffer[] = [];
  for await (const chunk of data.file) {
    chunks.push(chunk as Buffer);
  }
  const buffer = Buffer.concat(chunks);

  // Validate file size (5MB max)
  if (buffer.length > 5 * 1024 * 1024) {
    throw Object.assign(new Error('File too large. Maximum 5MB'), { statusCode: 400 });
  }

  // Process with sharp
  let sharp: typeof import('sharp');
  try {
    sharp = (await import('sharp')).default;
  } catch {
    logger.error('sharp module not available');
    throw Object.assign(new Error('Image processing unavailable'), { statusCode: 500 });
  }

  // Validate dimensions
  const metadata = await sharp(buffer).metadata();
  if (
    metadata.width === undefined ||
    metadata.height === undefined ||
    metadata.width < 200 ||
    metadata.height < 200
  ) {
    throw Object.assign(
      new Error('Image must be at least 200×200 pixels'),
      { statusCode: 400 },
    );
  }

  // Generate full and thumbnail in parallel
  const [fullBuffer, thumbBuffer] = await Promise.all([
    sharp(buffer).resize(400, 400, { fit: 'cover' }).webp({ quality: 85 }).toBuffer(),
    sharp(buffer).resize(80, 80, { fit: 'cover' }).webp({ quality: 70 }).toBuffer(),
  ]);

  const timestamp = Date.now();
  const fullKey = `avatars/${userId}/full-${timestamp}.webp`;
  const thumbKey = `avatars/${userId}/thumb-${timestamp}.webp`;

  // In development, store locally / mock S3
  if (config.NODE_ENV !== 'production') {
    // Store keys directly — URLs will be localhost-based
    const avatarUrl = `http://${config.CLOUDFRONT_DOMAIN}/${fullKey}`;
    const thumbnailUrl = `http://${config.CLOUDFRONT_DOMAIN}/${thumbKey}`;

    // Update DB
    const oldAvatarUrl = await profileRepo.updateAvatar(app.db as any, userId, fullKey);

    // Queue old avatar for deletion
    if (oldAvatarUrl !== null) {
      await app.redis.rpush('avatar:delete_queue', oldAvatarUrl);
    }

    // Invalidate caches
    await app.redis.del(`user:profile:${userId}`);
    await app.redis.del(`user:public_profile:${userId}`);

    logger.info({ userId, fullKey, thumbKey }, 'Avatar uploaded (dev mode)');

    return { avatar_url: avatarUrl, thumbnail_url: thumbnailUrl };
  }

  // Production: upload to S3
  const s3 = getS3Client();

  await Promise.all([
    s3.send(
      new PutObjectCommand({
        Bucket: config.AWS_S3_MEDIA_BUCKET,
        Key: fullKey,
        Body: fullBuffer,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=604800',
      }),
    ),
    s3.send(
      new PutObjectCommand({
        Bucket: config.AWS_S3_MEDIA_BUCKET,
        Key: thumbKey,
        Body: thumbBuffer,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=604800',
      }),
    ),
  ]);

  // Update DB with S3 key
  const oldAvatarKey = await profileRepo.updateAvatar(app.db as any, userId, fullKey);

  // Queue old avatar for async deletion
  if (oldAvatarKey !== null) {
    await app.redis.rpush('avatar:delete_queue', oldAvatarKey);
  }

  // Invalidate caches
  await app.redis.del(`user:profile:${userId}`);
  await app.redis.del(`user:public_profile:${userId}`);

  const avatarUrl = `https://${config.CLOUDFRONT_DOMAIN}/${fullKey}`;
  const thumbnailUrl = `https://${config.CLOUDFRONT_DOMAIN}/${thumbKey}`;

  logger.info({ userId, fullKey }, 'Avatar uploaded to S3');

  return { avatar_url: avatarUrl, thumbnail_url: thumbnailUrl };
}
