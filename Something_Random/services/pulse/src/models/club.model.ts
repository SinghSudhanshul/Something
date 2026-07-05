/**
 * NEXUS Pulse — Club Mongoose Model
 */

import mongoose, { Schema, type Document } from 'mongoose';

export interface IClub extends Document {
  campusId: string; name: string; description: string;
  category: string; logoUrl?: string; coverUrl?: string;
  leaderId: string; socialLinks: Record<string, string>;
  memberCount: number; isVerified: boolean; createdAt: Date;
}

const ClubSchema = new Schema<IClub>({
  campusId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  description: { type: String, required: true },
  category: { type: String, enum: ['technical', 'cultural', 'sports', 'social', 'academic'], required: true },
  logoUrl: String,
  coverUrl: String,
  leaderId: { type: String, required: true },
  socialLinks: { type: Schema.Types.Mixed, default: {} },
  memberCount: { type: Number, default: 0 },
  isVerified: { type: Boolean, default: false },
}, { timestamps: true });

ClubSchema.index({ campusId: 1, name: 1 }, { unique: true });

export const ClubModel = mongoose.model<IClub>('Club', ClubSchema);
