/**
 * NEXUS Feast — Canteen Service
 */

import type { FastifyInstance } from 'fastify';
import { AppError, createLogger } from '@nexus/utils';
import { KafkaTopics } from '@nexus/types';
import { publishEvent } from '@nexus/kafka';
import { CanteenRepository, type CanteenRecord, type MenuItemRecord } from './canteen.repository.js';
import { validateFSSAI, type FSSAIResult } from './fssai.service.js';
import { config } from '../../config.js';

const logger = createLogger('feast:canteen-service');

export class CanteenService {
  private readonly repo: CanteenRepository;
  constructor(private readonly fastify: FastifyInstance) {
    this.repo = new CanteenRepository(fastify);
  }

  async onboardCanteen(ownerUserId: string, campusId: string, data: {
    name: string; description?: string; location_label?: string;
    operating_hours: Record<string, { open: string; close: string }>;
    fssai_license_no: string; image_url?: string;
  }, userRole: string): Promise<CanteenRecord> {
    if (userRole !== 'vendor' && userRole !== 'campus_admin')
      throw AppError.forbidden('Only vendors can onboard canteens');

    const fssaiResult = await validateFSSAI(data.fssai_license_no, config.NODE_ENV, config.FOSCOS_API_URL);
    if (!fssaiResult.isValid) throw new AppError(422, 'INVALID_FSSAI', 'FSSAI license is invalid or expired');
    if (fssaiResult.expiryDate && new Date(fssaiResult.expiryDate) < new Date())
      throw new AppError(422, 'FSSAI_EXPIRED', 'FSSAI license has expired');

    const canteen = await this.repo.create({
      campus_id: campusId, name: data.name, description: data.description,
      location_label: data.location_label, operating_hours: data.operating_hours,
      owner_user_id: ownerUserId, fssai_license_no: data.fssai_license_no,
      fssai_verified: !fssaiResult.requiresManualVerification,
      fssai_expires_at: fssaiResult.expiryDate,
      image_url: data.image_url,
    } as Partial<CanteenRecord>);

    const producer = this.fastify.kafka?.producer;
    if (producer) publishEvent(producer, KafkaTopics.FEAST_CANTEEN_ONBOARDED, canteen).catch(() => {});

    return canteen;
  }

  async getCanteenMenu(canteenId: string): Promise<{ items: MenuItemRecord[]; grouped: Record<string, MenuItemRecord[]> }> {
    const cached = await this.fastify.redis.get(`feast:menu:${canteenId}`);
    if (cached) return JSON.parse(cached);

    const items = await this.repo.findMenuByCanteen(canteenId, true);
    const grouped: Record<string, MenuItemRecord[]> = {};
    for (const item of items) {
      const cat = item.category ?? 'uncategorized';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(item);
    }

    const result = { items, grouped };
    await this.fastify.redis.setex(`feast:menu:${canteenId}`, 120, JSON.stringify(result));
    return result;
  }

  async addMenuItem(canteenId: string, ownerId: string, data: Partial<MenuItemRecord>): Promise<MenuItemRecord> {
    const canteen = await this.repo.findById(canteenId);
    if (!canteen) throw AppError.notFound('Canteen not found');
    if (canteen.owner_user_id !== ownerId) throw AppError.forbidden('Not the canteen owner');
    const item = await this.repo.createMenuItem({ ...data, canteen_id: canteenId });
    await this.fastify.redis.del(`feast:menu:${canteenId}`);
    return item;
  }

  async updateItemAvailability(canteenId: string, itemId: string, ownerId: string, isAvailable: boolean): Promise<void> {
    const canteen = await this.repo.findById(canteenId);
    if (!canteen) throw AppError.notFound('Canteen not found');
    if (canteen.owner_user_id !== ownerId) throw AppError.forbidden('Not the canteen owner');
    await this.repo.updateMenuItemAvailability(itemId, isAvailable);
    await this.fastify.redis.del(`feast:menu:${canteenId}`);
    // Publish Redis for vendor tablet WebSocket
    await this.fastify.redisPub.publish(`feast:canteen:${canteenId}:menu_update`, JSON.stringify({ itemId, isAvailable }));
  }

  async getCanteensByCAmpus(campusId: string): Promise<CanteenRecord[]> {
    return this.repo.findByCampus(campusId);
  }

  async getCanteen(id: string): Promise<CanteenRecord> {
    const canteen = await this.repo.findById(id);
    if (!canteen) throw AppError.notFound('Canteen not found');
    return canteen;
  }

  async suspend(id: string): Promise<void> {
    await this.repo.suspend(id);
    const producer = this.fastify.kafka?.producer;
    if (producer) publishEvent(producer, KafkaTopics.FEAST_CANTEEN_SUSPENDED, { canteenId: id }).catch(() => {});
  }
}
