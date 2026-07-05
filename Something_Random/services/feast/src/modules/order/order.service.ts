/**
 * NEXUS Feast — Order Service
 *
 * Food ordering with escrow, queue depth control, and real-time updates.
 */

import type { FastifyInstance } from 'fastify';
import { AppError, createLogger, createWalletClient, createTrustClient } from '@nexus/utils';
import { KafkaTopics } from '@nexus/types';
import { publishEvent } from '@nexus/kafka';
import { OrderRepository, type FeastOrderRecord } from './order.repository.js';
import { CanteenRepository, type CanteenRecord } from '../canteen/canteen.repository.js';
import { config } from '../../config.js';

const logger = createLogger('feast:order-service');
const MAX_QUEUE_DEPTH = 50;
const PLATFORM_FEE_RATE = 0.05;

export class OrderService {
  private readonly orderRepo: OrderRepository;
  private readonly canteenRepo: CanteenRepository;
  private readonly walletClient;
  private readonly trustClient;

  constructor(private readonly fastify: FastifyInstance) {
    this.orderRepo = new OrderRepository(fastify);
    this.canteenRepo = new CanteenRepository(fastify);
    this.walletClient = createWalletClient(config.WALLET_SERVICE_URL, config.INTERNAL_SERVICE_SECRET);
    this.trustClient = createTrustClient(config.USER_SERVICE_URL, config.INTERNAL_SERVICE_SECRET);
  }

  async placeOrder(buyerId: string, canteenId: string, items: { menuItemId: string; quantity: number; customizations?: unknown }[], deliveryType: string, deliveryLocation?: string, instructions?: string): Promise<FeastOrderRecord> {
    const canteen = await this.canteenRepo.findById(canteenId);
    if (!canteen) throw AppError.notFound('Canteen not found');
    if (!canteen.is_active) throw new AppError(503, 'CANTEEN_INACTIVE', 'Canteen is not currently active');

    // Check operating hours
    const now = new Date();
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const today = dayNames[now.getDay()] as string;
    const hours = canteen.operating_hours[today];
    if (hours) {
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      if (currentTime < hours.open || currentTime > hours.close) {
        throw new AppError(422, 'OUTSIDE_HOURS', `Canteen opens at ${hours.open} and closes at ${hours.close}`);
      }
    }

    // Check queue depth
    const activeCount = await this.orderRepo.countActiveByCanteen(canteenId);
    if (activeCount >= MAX_QUEUE_DEPTH) throw new AppError(503, 'QUEUE_FULL', 'Canteen is too busy, please try later');

    // Fetch and validate menu items
    const menuItemIds = items.map(i => i.menuItemId);
    const menuItems = await this.canteenRepo.findMenuItemsByIds(menuItemIds);
    const menuMap = new Map(menuItems.map(m => [m.id, m]));

    for (const item of items) {
      const mi = menuMap.get(item.menuItemId);
      if (!mi) throw AppError.badRequest(`Menu item ${item.menuItemId} not found`);
      if (!mi.is_available) throw AppError.badRequest(`${mi.name} is currently unavailable`);
      if (mi.canteen_id !== canteenId) throw AppError.badRequest(`${mi.name} does not belong to this canteen`);
    }

    // Snapshot prices at order time
    const orderItems = items.map(item => {
      const mi = menuMap.get(item.menuItemId)!;
      const unitPrice = Number(mi.price);
      return { menu_item_id: item.menuItemId, quantity: item.quantity, unit_price: unitPrice, customizations: item.customizations ?? {}, item_total: Math.round(unitPrice * item.quantity * 100) / 100 };
    });

    const subtotal = Math.round(orderItems.reduce((sum, i) => sum + i.item_total, 0) * 100) / 100;
    const platformFee = Math.round(subtotal * PLATFORM_FEE_RATE * 100) / 100;
    const total = Math.round((subtotal + platformFee) * 100) / 100;

    // Escrow buyer's funds
    const txn = await this.walletClient.createTransaction({ buyerId, sellerId: canteen.owner_user_id, amount: String(total), module: 'feast', referenceId: canteenId, referenceType: 'canteen_order', description: `Food order at ${canteen.name}` });
    await this.walletClient.initiateEscrow(txn.transactionId);

    // Create order
    const estimatedReady = new Date(Date.now() + canteen.avg_prep_time_minutes * 60_000);
    const order = await this.orderRepo.create({
      buyer_id: buyerId, canteen_id: canteenId, transaction_id: txn.transactionId,
      items: orderItems, subtotal: String(subtotal), platform_fee: String(platformFee),
      total: String(total), delivery_type: deliveryType, delivery_location: deliveryLocation,
      special_instructions: instructions, status: 'payment_held', estimated_ready_at: estimatedReady,
    } as Partial<FeastOrderRecord>);

    await this.orderRepo.createOrderItems(order.id, orderItems);

    // Real-time: notify canteen via Redis pub/sub
    await this.fastify.redisPub.publish(`feast:canteen:${canteenId}:new_order`, JSON.stringify({ orderId: order.id, buyerId, items: orderItems, total }));

    const producer = this.fastify.kafka?.producer;
    if (producer) publishEvent(producer, KafkaTopics.FEAST_ORDER_PLACED, { orderId: order.id, canteenId, buyerId, total }).catch(() => {});

    return order;
  }

  async updateOrderStatus(orderId: string, newStatus: string, vendorUserId: string): Promise<void> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) throw AppError.notFound('Order not found');
    const canteen = await this.canteenRepo.findById(order.canteen_id);
    if (!canteen || canteen.owner_user_id !== vendorUserId) throw AppError.forbidden('Not the canteen owner');

    // Validate transitions
    const validTransitions: Record<string, string[]> = {
      payment_held: ['preparing'], preparing: ['ready'], ready: ['picked_up', 'delivered'],
    };
    const allowed = validTransitions[order.status] ?? [];
    if (!allowed.includes(newStatus)) throw new AppError(422, 'INVALID_TRANSITION', `Cannot transition from ${order.status} to ${newStatus}`);

    await this.orderRepo.updateStatus(orderId, newStatus);

    // Real-time: notify buyer
    await this.fastify.redisPub.publish(`feast:order:${orderId}:status`, JSON.stringify({ orderId, status: newStatus }));

    // On delivery completion: release escrow
    if (newStatus === 'picked_up' || newStatus === 'delivered') {
      if (order.transaction_id) await this.walletClient.releaseEscrow(order.transaction_id);
      this.trustClient.recordTrustEvent({ userId: canteen.owner_user_id, eventType: 'gig_completed', referenceId: orderId, referenceType: 'feast_order' }).catch(() => {});
    }

    const producer = this.fastify.kafka?.producer;
    if (producer) publishEvent(producer, KafkaTopics.FEAST_ORDER_UPDATED, { orderId, status: newStatus }).catch(() => {});
  }

  async cancelOrder(orderId: string, buyerId: string, _reason: string): Promise<void> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) throw AppError.notFound('Order not found');
    if (order.buyer_id !== buyerId) throw AppError.forbidden('Only the buyer can cancel');
    if (order.status !== 'payment_held') throw AppError.forbidden('Cannot cancel after preparation has started');
    if (order.transaction_id) await this.walletClient.refundEscrow(order.transaction_id);
    await this.orderRepo.updateStatus(orderId, 'cancelled');
    await this.fastify.redisPub.publish(`feast:canteen:${order.canteen_id}:order_cancelled`, JSON.stringify({ orderId }));
  }

  async rateOrder(orderId: string, raterId: string, score: number, reviewText?: string): Promise<void> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) throw AppError.notFound('Order not found');
    if (order.buyer_id !== raterId) throw AppError.forbidden('Only the buyer can rate');
    if (!['picked_up', 'delivered'].includes(order.status)) throw AppError.badRequest('Order must be completed to rate');
    await this.orderRepo.createRating(orderId, raterId, order.canteen_id, score, reviewText);
  }

  async getOrder(orderId: string, userId: string): Promise<FeastOrderRecord> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) throw AppError.notFound('Order not found');
    if (order.buyer_id !== userId) {
      const canteen = await this.canteenRepo.findById(order.canteen_id);
      if (!canteen || canteen.owner_user_id !== userId) throw AppError.forbidden('Not authorized');
    }
    return order;
  }

  async getMyOrders(buyerId: string, limit = 20): Promise<FeastOrderRecord[]> {
    return this.orderRepo.findByBuyer(buyerId, limit);
  }

  async getCanteenOrders(canteenId: string, vendorId: string): Promise<FeastOrderRecord[]> {
    const canteen = await this.canteenRepo.findById(canteenId);
    if (!canteen || canteen.owner_user_id !== vendorId) throw AppError.forbidden('Not the canteen owner');
    return this.orderRepo.findByCanteen(canteenId, ['payment_held', 'preparing', 'ready'], 50);
  }
}
