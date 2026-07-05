/**
 * NEXUS Pulse — Event Mongoose Model
 */

import mongoose, { Schema, type Document } from 'mongoose';

export interface ITicketType {
  id: string; name: string; price: number; totalCount: number; soldCount: number; description?: string;
}

export interface IEvent extends Document {
  campusId: string; organizerId: string; title: string; description: string;
  eventType: string; venue: string; startAt: Date; endAt: Date;
  coverImageUrl?: string; ticketTypes: ITicketType[];
  status: string; tags: string[]; isWomenOnly: boolean;
  createdAt: Date; updatedAt: Date;
}

const TicketTypeSchema = new Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true, min: 0 },
  totalCount: { type: Number, required: true, min: 1 },
  soldCount: { type: Number, default: 0 },
  description: String,
}, { _id: false });

const EventSchema = new Schema<IEvent>({
  campusId: { type: String, required: true, index: true },
  organizerId: { type: String, required: true },
  title: { type: String, required: true, minlength: 5 },
  description: { type: String, required: true, minlength: 50 },
  eventType: { type: String, enum: ['cultural', 'technical', 'sports', 'social', 'workshop', 'competition'], required: true },
  venue: { type: String, required: true },
  startAt: { type: Date, required: true },
  endAt: { type: Date, required: true },
  coverImageUrl: String,
  ticketTypes: { type: [TicketTypeSchema], default: [] },
  status: { type: String, enum: ['draft', 'published', 'cancelled', 'completed'], default: 'draft' },
  tags: { type: [String], default: [] },
  isWomenOnly: { type: Boolean, default: false },
}, { timestamps: true });

EventSchema.index({ campusId: 1, status: 1, startAt: 1 });

export const EventModel = mongoose.model<IEvent>('Event', EventSchema);
