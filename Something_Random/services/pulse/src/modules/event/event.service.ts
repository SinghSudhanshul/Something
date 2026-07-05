/**
 * NEXUS Pulse — Event Service
 *
 * Events + tickets with concurrent-safe purchase via MongoDB atomic $inc.
 */

import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError, createLogger, createWalletClient } from '@nexus/utils';
import { KafkaTopics } from '@nexus/types';
import { publishEvent } from '@nexus/kafka';
import { EventModel, type IEvent } from '../../models/event.model.js';
import { ClubModel, type IClub } from '../../models/club.model.js';

const logger = createLogger('pulse:event-service');

export class EventService {
  private readonly walletClient;
  constructor(private readonly fastify: FastifyInstance) {
    const secret = process.env['INTERNAL_SERVICE_SECRET'] ?? '';
    this.walletClient = createWalletClient(process.env['WALLET_SERVICE_URL'], secret);
  }

  async createEvent(organizerId: string, campusId: string, data: {
    title: string; description: string; eventType: string; venue: string;
    startAt: string; endAt: string; coverImageUrl?: string;
    ticketTypes?: { id: string; name: string; price: number; totalCount: number; description?: string }[];
    tags?: string[]; isWomenOnly?: boolean;
  }, trustScore: number): Promise<IEvent> {
    if (trustScore < 3.00) throw AppError.forbidden('Trust score must be at least 3.00 to create events');
    const startAt = new Date(data.startAt);
    const endAt = new Date(data.endAt);
    if (endAt <= startAt) throw new AppError(422, 'INVALID_DATES', 'endAt must be after startAt');
    if (startAt.getTime() - Date.now() < 3600_000) throw new AppError(422, 'TOO_SOON', 'Event must start at least 1 hour from now');

    const event = await EventModel.create({
      campusId, organizerId, title: data.title, description: data.description,
      eventType: data.eventType, venue: data.venue, startAt, endAt,
      coverImageUrl: data.coverImageUrl,
      ticketTypes: (data.ticketTypes ?? []).map(t => ({ ...t, soldCount: 0 })),
      tags: data.tags ?? [], isWomenOnly: data.isWomenOnly ?? false,
    });

    const producer = this.fastify.kafka?.producer;
    if (producer) publishEvent(producer, KafkaTopics.PULSE_EVENT_CREATED, event.toObject()).catch(() => {});
    return event;
  }

  async publishEvent(eventId: string, organizerId: string): Promise<IEvent> {
    const event = await EventModel.findById(eventId);
    if (!event) throw AppError.notFound('Event not found');
    if (event.organizerId !== organizerId) throw AppError.forbidden('Only the organizer can publish');
    if (!event.coverImageUrl) throw AppError.badRequest('Cover image required before publishing');
    if (event.ticketTypes.length === 0) throw AppError.badRequest('At least one ticket type required');
    event.status = 'published';
    await event.save();
    return event;
  }

  async purchaseTickets(eventId: string, ticketTypeId: string, quantity: number, buyerId: string): Promise<{ ticketId: string; qrCodeHash: string }> {
    const event = await EventModel.findById(eventId);
    if (!event) throw AppError.notFound('Event not found');
    if (event.status !== 'published') throw AppError.conflict('Event is not published');
    if (new Date(event.startAt) < new Date()) throw AppError.conflict('Event has already started');

    // Atomic findOneAndUpdate with $inc to prevent overselling
    const updated = await EventModel.findOneAndUpdate(
      { _id: eventId, 'ticketTypes.id': ticketTypeId, $expr: { $lte: [{ $add: [{ $arrayElemAt: ['$ticketTypes.soldCount', { $indexOfArray: ['$ticketTypes.id', ticketTypeId] }] }, quantity] }, { $arrayElemAt: ['$ticketTypes.totalCount', { $indexOfArray: ['$ticketTypes.id', ticketTypeId] }] }] } },
      { $inc: { 'ticketTypes.$.soldCount': quantity } },
      { new: true },
    );

    if (!updated) throw AppError.conflict('Tickets sold out or insufficient availability');

    const ticketType = updated.ticketTypes.find(t => t.id === ticketTypeId);
    if (!ticketType) throw AppError.notFound('Ticket type not found');

    // Generate QR hash
    const qrCodeHash = createHash('sha256').update(`${eventId}:${buyerId}:${ticketTypeId}:${Date.now()}:${randomBytes(8).toString('hex')}`).digest('hex').slice(0, 64);

    const totalPaid = ticketType.price * quantity;
    let transactionId: string | null = null;

    // Paid events: escrow (released immediately for events)
    if (totalPaid > 0) {
      const txn = await this.walletClient.createTransaction({ buyerId, sellerId: event.organizerId, amount: String(totalPaid), module: 'pulse', referenceId: eventId, referenceType: 'event_ticket', description: `Tickets: ${event.title}` });
      await this.walletClient.initiateEscrow(txn.transactionId);
      await this.walletClient.releaseEscrow(txn.transactionId); // Immediate release for events
      transactionId = txn.transactionId;
    }

    // Insert PostgreSQL ticket record (financial source of truth)
    const ticketResult = await this.fastify.db.execute(sql`
      INSERT INTO event_tickets (event_id, buyer_id, transaction_id, ticket_type_id, quantity, total_paid, status, qr_code_hash)
      VALUES (${eventId}, ${buyerId}, ${transactionId}, ${ticketTypeId}, ${quantity}, ${totalPaid}, 'confirmed', ${qrCodeHash})
      RETURNING id
    `);

    const ticketId = (ticketResult as any)?.[0]?.id;

    const producer = this.fastify.kafka?.producer;
    if (producer) publishEvent(producer, KafkaTopics.PULSE_TICKETS_PURCHASED, { eventId, ticketId, buyerId, quantity }).catch(() => {});

    return { ticketId, qrCodeHash };
  }

  async checkInTicket(ticketId: string, qrCodeHash: string, scannerId: string): Promise<{ valid: boolean; holderName?: string; ticketType?: string }> {
    const ticketResult = await this.fastify.db.execute(sql`
      SELECT et.*, u.name as holder_name FROM event_tickets et JOIN users u ON u.id = et.buyer_id WHERE et.id = ${ticketId}
    `);
    const ticket = (ticketResult as unknown as Array<Record<string, unknown>>)[0] as Record<string, unknown> | undefined;
    if (!ticket) throw AppError.notFound('Ticket not found');
    if (ticket.qr_code_hash !== qrCodeHash) throw new AppError(401, 'INVALID_QR', 'QR code does not match');
    if (ticket.status === 'used') throw AppError.conflict('Ticket has already been used');
    if (ticket.status === 'refunded') throw AppError.conflict('Ticket has been refunded');

    await this.fastify.db.execute(sql`UPDATE event_tickets SET status = 'used', checked_in_at = now() WHERE id = ${ticketId}`);

    return { valid: true, holderName: ticket.holder_name as string, ticketType: ticket.ticket_type_id as string };
  }

  async getEvents(campusId: string): Promise<IEvent[]> {
    return EventModel.find({ campusId, status: 'published', startAt: { $gte: new Date() } }).sort({ startAt: 1 }).limit(50);
  }

  async getEvent(id: string): Promise<IEvent> {
    const event = await EventModel.findById(id);
    if (!event) throw AppError.notFound('Event not found');
    return event;
  }

  async getMyTickets(buyerId: string) {
    const r = await this.fastify.db.execute(sql`SELECT * FROM event_tickets WHERE buyer_id = ${buyerId} ORDER BY created_at DESC`);
    return r as unknown as Array<Record<string, unknown>>;
  }

  // ━━━ Clubs ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async getClubs(campusId: string): Promise<IClub[]> { return ClubModel.find({ campusId }).sort({ name: 1 }); }
  async getClub(id: string): Promise<IClub> { const c = await ClubModel.findById(id); if (!c) throw AppError.notFound('Club not found'); return c; }

  async createClub(campusId: string, data: { name: string; description: string; category: string; leaderId: string }): Promise<IClub> {
    return ClubModel.create({ campusId, ...data });
  }

  async joinClub(clubId: string, userId: string): Promise<void> {
    await this.fastify.db.execute(sql`INSERT INTO club_memberships (club_id, user_id) VALUES (${clubId}, ${userId}) ON CONFLICT (club_id, user_id) DO NOTHING`);
    await ClubModel.findByIdAndUpdate(clubId, { $inc: { memberCount: 1 } });
  }
}
