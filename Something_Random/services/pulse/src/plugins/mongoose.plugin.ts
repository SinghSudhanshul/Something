/**
 * NEXUS Pulse — Mongoose Plugin (MongoDB)
 *
 * Connects to MongoDB for flexible event/club metadata.
 * Financial data (tickets, payments) stays in PostgreSQL.
 */

import fp from 'fastify-plugin';
import mongoose from 'mongoose';
import type { FastifyInstance } from 'fastify';
import { createLogger } from '@nexus/utils';

const logger = createLogger('pulse:mongoose');

export default fp(
  async function mongoosePlugin(fastify: FastifyInstance) {
    const mongoUrl = process.env['MONGODB_URL'] ?? 'mongodb://localhost:27017/nexus_pulse';

    try {
      await mongoose.connect(mongoUrl, { maxPoolSize: 10, serverSelectionTimeoutMS: 5000 });
      logger.info('MongoDB connected');
    } catch (error) {
      logger.warn({ err: error }, 'MongoDB connection failed — Pulse will use PostgreSQL JSONB fallback');
    }

    fastify.decorate('mongoose', mongoose);

    fastify.addHook('onClose', async () => {
      await mongoose.disconnect();
      logger.info('MongoDB disconnected');
    });
  },
  { name: 'mongoose-plugin' },
);

declare module 'fastify' {
  interface FastifyInstance {
    mongoose: typeof mongoose;
  }
}
