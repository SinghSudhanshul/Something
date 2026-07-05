/**
 * NEXUS Swift Service — Database Plugin
 */

import fp from 'fastify-plugin';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { FastifyInstance } from 'fastify';

import * as schema from '@nexus/database/schema';
import { config } from '../config.js';

async function dbPlugin(fastify: FastifyInstance): Promise<void> {
  const sql = postgres(config.DATABASE_URL, {
    max: 20,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  const db = drizzle(sql, { schema });
  fastify.decorate('db', db);

  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing database connection...');
    await sql.end();
  });

  fastify.log.info('Database plugin registered');
}

export default fp(dbPlugin, { name: 'db', fastify: '4.x' });
