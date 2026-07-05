/**
 * NEXUS Pulse — Event Zod Schemas
 */
import { z } from 'zod';

const EVENT_TYPES = ['workshop','seminar','cultural','sports','hackathon','fest','meetup','concert','exhibition','other'] as const;
const CLUB_CATEGORIES = ['technical','cultural','sports','literary','social','entrepreneurship','media','nss_ncc','other'] as const;

const TicketTypeSchema = z.object({
  id: z.string().min(1), name: z.string().min(1).max(100),
  price: z.number().min(0).max(10000), totalCount: z.number().int().min(1).max(10000),
  description: z.string().max(500).optional(),
});

export const CreateEventSchema = z.object({
  title: z.string().min(5).max(200), description: z.string().min(50).max(5000),
  eventType: z.enum(EVENT_TYPES), venue: z.string().min(3).max(200),
  startAt: z.string().datetime(), endAt: z.string().datetime(),
  coverImageUrl: z.string().url().optional(),
  ticketTypes: z.array(TicketTypeSchema).max(10).default([]),
  tags: z.array(z.string().max(50)).max(10).default([]),
  isWomenOnly: z.boolean().default(false),
}).refine(d => new Date(d.endAt) > new Date(d.startAt), { message: 'endAt must be after startAt', path: ['endAt'] });
export type CreateEventInput = z.infer<typeof CreateEventSchema>;

export const PurchaseTicketsSchema = z.object({
  ticketTypeId: z.string().min(1), quantity: z.number().int().min(1).max(10),
});
export type PurchaseTicketsInput = z.infer<typeof PurchaseTicketsSchema>;

export const CheckInSchema = z.object({ qrCodeHash: z.string().length(64) });
export type CheckInInput = z.infer<typeof CheckInSchema>;

export const CreateClubSchema = z.object({
  name: z.string().min(3).max(100), description: z.string().min(20).max(2000),
  category: z.enum(CLUB_CATEGORIES),
});
export type CreateClubInput = z.infer<typeof CreateClubSchema>;

export const EventParamsSchema = z.object({ id: z.string() });
export const TicketParamsSchema = z.object({ id: z.string() });
export const ClubParamsSchema = z.object({ id: z.string() });

export { EVENT_TYPES, CLUB_CATEGORIES };
