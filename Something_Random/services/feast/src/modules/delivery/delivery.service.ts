/**
 * NEXUS Feast — Delivery Partner Service
 *
 * Delivery partner onboarding, location tracking, and assignment.
 */

import { and, desc, eq, sql, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError, createLogger } from '@nexus/utils';
import { KafkaTopics } from '@nexus/types';
import { publishEvent } from '@nexus/kafka';

import * as schema from '@nexus/database/schema';

const logger = createLogger('feast:delivery-service');

const DELIVERY_FEE_PER_KM_PAISE = 500; // ₹5/km
const BASE_DELIVERY_FEE_PAISE = 1500; // ₹15 base
const ASSIGNMENT_RADIUS_KM = 5;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class DeliveryService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get db() {
    return this.fastify.db;
  }

  private async publish(topic: string, data: unknown) {
    const producer = this.fastify.kafka?.producer;
    if (producer) await publishEvent(producer, topic as any, data);
  }

  // ━━━ Partner Onboarding ━━━━━━━━━━━━━━━━━━━━━

  async registerPartner(
    userId: string,
    campusId: string,
    data: { vehicleType: string; vehicleNumber?: string | undefined; licenseNumber?: string | undefined },
  ) {
    const existing = await this.db
      .select()
      .from(schema.deliveryPartners)
      .where(eq(schema.deliveryPartners.userId, userId))
      .limit(1);
    if (existing.length > 0) throw AppError.conflict('Already registered as delivery partner');

    const [partner] = await this.db
      .insert(schema.deliveryPartners)
      .values({
        userId,
        campusId,
        vehicleType: data.vehicleType,
        ...(data.vehicleNumber !== undefined && { vehicleNumber: data.vehicleNumber }),
        ...(data.licenseNumber !== undefined && { licenseNumber: data.licenseNumber }),
        isAvailable: false,
        isVerified: false,
        status: 'offline',
      })
      .returning();
    return partner!;
  }

  async verifyPartner(partnerId: string, adminId: string, approved: boolean, notes?: string) {
    const [partner] = await this.db
      .select()
      .from(schema.deliveryPartners)
      .where(eq(schema.deliveryPartners.id, partnerId))
      .limit(1);
    if (!partner) throw AppError.notFound('Delivery partner not found');

    await this.db
      .update(schema.deliveryPartners)
      .set({
        isVerified: approved,
        status: approved ? 'offline' : 'suspended',
        updatedAt: new Date(),
      })
      .where(eq(schema.deliveryPartners.id, partnerId));
    return { verified: approved, notes };
  }

  async getMyPartnerProfile(userId: string) {
    const [partner] = await this.db
      .select()
      .from(schema.deliveryPartners)
      .where(eq(schema.deliveryPartners.userId, userId))
      .limit(1);
    if (!partner) throw AppError.notFound('Not registered as delivery partner');
    return partner;
  }

  async updateAvailability(userId: string, isAvailable: boolean, lat?: number, lng?: number) {
    const updates: any = { isAvailable, status: isAvailable ? 'available' : 'offline', updatedAt: new Date() };
    if (lat !== undefined && lng !== undefined) {
      updates.currentLatitude = String(lat);
      updates.currentLongitude = String(lng);
      updates.lastLocationUpdate = new Date();
    }
    await this.db
      .update(schema.deliveryPartners)
      .set(updates)
      .where(eq(schema.deliveryPartners.userId, userId));
  }

  async updateLocation(userId: string, lat: number, lng: number) {
    await this.db
      .update(schema.deliveryPartners)
      .set({
        currentLatitude: String(lat),
        currentLongitude: String(lng),
        lastLocationUpdate: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.deliveryPartners.userId, userId));

    // Also publish to redis for real-time tracking
    await this.fastify.redisPub?.publish(
      `feast:partner:${userId}:location`,
      JSON.stringify({ lat, lng, ts: Date.now() }),
    );
  }

  // ━━━ Order Assignment ━━━━━━━━━━━━━━━━━━━━━━━

  async findAndAssignDeliveryPartner(orderId: string): Promise<{ assigned: boolean; partnerId?: string }> {
    const [order] = await this.db
      .select()
      .from(schema.foodOrders)
      .where(eq(schema.foodOrders.id, orderId))
      .limit(1);
    if (!order) throw AppError.notFound('Order not found');
    if (order.deliveryPartnerId) {
      return { assigned: true, partnerId: order.deliveryPartnerId };
    }
    if (!order.deliveryLatitude || !order.deliveryLongitude) {
      return { assigned: false };
    }

    const deliveryLat = Number(order.deliveryLatitude);
    const deliveryLng = Number(order.deliveryLongitude);

    // Find available partners on campus
    const candidates = await this.db
      .select()
      .from(schema.deliveryPartners)
      .where(
        and(
          eq(schema.deliveryPartners.campusId, order.campusId),
          eq(schema.deliveryPartners.status, 'available'),
          eq(schema.deliveryPartners.isVerified, true),
          isNull(schema.deliveryPartners.currentLatitude), // we filter by lat/lng in JS
        ),
      );

    const candidatesWithLocation = await this.db
      .select()
      .from(schema.deliveryPartners)
      .where(
        and(
          eq(schema.deliveryPartners.campusId, order.campusId),
          eq(schema.deliveryPartners.status, 'available'),
          eq(schema.deliveryPartners.isVerified, true),
          sql`${schema.deliveryPartners.currentLatitude} IS NOT NULL`,
          sql`${schema.deliveryPartners.currentLongitude} IS NOT NULL`,
        ),
      );

    if (candidatesWithLocation.length === 0) return { assigned: false };

    // Score: distance + rating
    const scored = candidatesWithLocation
      .map((c) => ({
        partner: c,
        distanceKm: haversineKm(
          Number(c.currentLatitude),
          Number(c.currentLongitude),
          deliveryLat,
          deliveryLng,
        ),
        rating: Number(c.averageRating),
        completedJobs: c.totalDeliveries,
      }))
      .filter((c) => c.distanceKm <= ASSIGNMENT_RADIUS_KM)
      .sort((a, b) => {
        // Lower distance is better, higher rating is better
        const scoreA = a.distanceKm * 2 - a.rating;
        const scoreB = b.distanceKm * 2 - b.rating;
        return scoreA - scoreB;
      });

    if (scored.length === 0) return { assigned: false };

    const chosen = scored[0]!.partner;

    // Atomic update: only assign if still unassigned
    const result = await this.db
      .update(schema.foodOrders)
      .set({
        deliveryPartnerId: chosen.userId,
        status: 'preparing', // move from payment_held to preparing
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.foodOrders.id, orderId),
          sql`${schema.foodOrders.deliveryPartnerId} IS NULL`,
        ),
      )
      .returning();

    if (result.length === 0) return { assigned: false };

    // Mark partner as busy
    await this.db
      .update(schema.deliveryPartners)
      .set({ status: 'busy', updatedAt: new Date() })
      .where(eq(schema.deliveryPartners.id, chosen.id));

    // Notify partner via Kafka + Redis
    await this.publish(KafkaTopics.DELIVERY_ASSIGNED, {
      orderId,
      partnerId: chosen.userId,
      deliveryLat,
      deliveryLng,
    });
    await this.fastify.redisPub?.publish(
      `feast:partner:${chosen.userId}:assigned`,
      JSON.stringify({ orderId, vendorId: order.vendorId }),
    );

    return { assigned: true, partnerId: chosen.userId };
  }

  async pickUpOrder(orderId: string, partnerUserId: string) {
    const [order] = await this.db
      .select()
      .from(schema.foodOrders)
      .where(
        and(
          eq(schema.foodOrders.id, orderId),
          eq(schema.foodOrders.deliveryPartnerId, partnerUserId),
        ),
      )
      .limit(1);
    if (!order) throw AppError.forbidden('Not assigned to this order');
    if (order.status !== 'ready') throw AppError.conflict('Order is not ready for pickup');

    await this.db
      .update(schema.foodOrders)
      .set({
        status: 'picked_up',
        pickedUpAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.foodOrders.id, orderId));
  }

  async markDelivered(orderId: string, partnerUserId: string) {
    const [order] = await this.db
      .select()
      .from(schema.foodOrders)
      .where(
        and(
          eq(schema.foodOrders.id, orderId),
          eq(schema.foodOrders.deliveryPartnerId, partnerUserId),
        ),
      )
      .limit(1);
    if (!order) throw AppError.forbidden('Not assigned to this order');
    if (!['picked_up', 'ready'].includes(order.status)) {
      throw AppError.conflict('Order cannot be marked delivered in current state');
    }

    await this.db
      .update(schema.foodOrders)
      .set({
        status: 'delivered',
        deliveredAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.foodOrders.id, orderId));

    // Mark partner as available again
    await this.db
      .update(schema.deliveryPartners)
      .set({ status: 'available', updatedAt: new Date() })
      .where(eq(schema.deliveryPartners.userId, partnerUserId));

    // Increment partner stats
    await this.db
      .update(schema.deliveryPartners)
      .set({ totalDeliveries: sql`${schema.deliveryPartners.totalDeliveries} + 1` })
      .where(eq(schema.deliveryPartners.userId, partnerUserId));
  }

  // ━━━ Queries ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async getAvailablePartners(campusId: string) {
    return this.db
      .select()
      .from(schema.deliveryPartners)
      .where(
        and(
          eq(schema.deliveryPartners.campusId, campusId),
          eq(schema.deliveryPartners.status, 'available'),
          eq(schema.deliveryPartners.isVerified, true),
        ),
      );
  }

  async getMyDeliveries(partnerUserId: string, status?: string) {
    const conditions = [eq(schema.foodOrders.deliveryPartnerId, partnerUserId)];
    if (status) conditions.push(eq(schema.foodOrders.status, status as any));
    return this.db
      .select()
      .from(schema.foodOrders)
      .where(and(...conditions))
      .orderBy(desc(schema.foodOrders.createdAt));
  }

  async calculateDeliveryFee(distanceKm: number): Promise<number> {
    return Math.round(BASE_DELIVERY_FEE_PAISE + distanceKm * DELIVERY_FEE_PER_KM_PAISE);
  }
}
