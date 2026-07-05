/**
 * NEXUS Feast — FSSAI License Expiry Cron
 *
 * Runs periodically to:
 * 1. Notify canteens expiring within 30 days via Kafka
 * 2. Auto-suspend canteens expired > 7 days
 */
import type { FastifyInstance } from 'fastify';
import { createLogger } from '@nexus/utils';
import { KafkaTopics } from '@nexus/types';
import { publishEvent } from '@nexus/kafka';
import { CanteenRepository } from './canteen.repository.js';
import { CanteenService } from './canteen.service.js';

const logger = createLogger('feast:fssai-cron');

export function startFSSAICron(fastify: FastifyInstance): NodeJS.Timeout {
  const repo = new CanteenRepository(fastify);
  const service = new CanteenService(fastify);

  // Run every 6 hours
  const interval = setInterval(async () => {
    try {
      // 1. Find canteens expiring within 30 days — send warning
      const expiringSoon = await repo.findExpiredFSSAI(30);
      const now = new Date();
      let notified = 0;
      let suspended = 0;

      for (const canteen of expiringSoon) {
        const expiresAt = canteen.fssai_expires_at ? new Date(canteen.fssai_expires_at) : null;
        if (!expiresAt) continue;

        const daysUntilExpiry = Math.ceil((expiresAt.getTime() - now.getTime()) / 86400_000);

        if (daysUntilExpiry <= 0 && daysUntilExpiry >= -7) {
          // Expired but within grace period — notify only
          const producer = fastify.kafka?.producer;
          if (producer) {
            await publishEvent(producer, KafkaTopics.FEAST_FSSAI_EXPIRING, {
              canteenId: canteen.id, ownerUserId: canteen.owner_user_id,
              fssaiLicenseNo: canteen.fssai_license_no, daysUntilExpiry,
              message: 'FSSAI license has expired. Renew within 7 days to avoid suspension.',
            });
          }
          notified++;
        } else if (daysUntilExpiry < -7) {
          // Expired > 7 days — suspend
          await service.suspend(canteen.id);
          suspended++;
          logger.warn({ canteenId: canteen.id, expiredDaysAgo: Math.abs(daysUntilExpiry) },
            'Canteen suspended due to expired FSSAI license');
        } else if (daysUntilExpiry > 0 && daysUntilExpiry <= 30) {
          // Expiring soon — warning
          const producer = fastify.kafka?.producer;
          if (producer) {
            await publishEvent(producer, KafkaTopics.FEAST_FSSAI_EXPIRING, {
              canteenId: canteen.id, ownerUserId: canteen.owner_user_id,
              fssaiLicenseNo: canteen.fssai_license_no, daysUntilExpiry,
              message: `FSSAI license expires in ${daysUntilExpiry} days. Please renew.`,
            });
          }
          notified++;
        }
      }

      if (notified > 0 || suspended > 0) {
        logger.info({ notified, suspended }, 'FSSAI cron completed');
      }
    } catch (err) {
      logger.error({ err }, 'FSSAI cron failed');
    }
  }, 6 * 60 * 60_000); // 6 hours

  logger.info('FSSAI expiry cron started (every 6 hours)');
  return interval;
}
