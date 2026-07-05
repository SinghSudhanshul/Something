/**
 * NEXUS Search Service — Database Plugin
 *
 * Registers a drizzle-orm client backed by the `postgres` driver on the
 * Fastify instance.  The plugin handles:
 *
 * - Connection pool configuration (max connections, timeouts)
 * - Health-check helper for readiness probes
 * - Graceful shutdown (drains the connection pool on `onClose`)
 * - Reconnection logging and error surfacing
 *
 * @module plugins/db
 */

import fp from 'fastify-plugin';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { FastifyInstance } from 'fastify';

import * as schema from '@nexus/database/schema';
import { config } from '../config.js';

/**
 * Fastify plugin that creates and registers a drizzle-orm database client.
 *
 * The client is available on every request via `fastify.db` (see the
 * type augmentation in `src/types/index.ts`).
 *
 * @param fastify - Fastify application instance.
 */
async function dbPlugin(fastify: FastifyInstance): Promise<void> {
  const sql = postgres(config.DATABASE_URL, {
    max: config.DATABASE_POOL_MAX,
    idle_timeout: config.DATABASE_IDLE_TIMEOUT_SECS,
    connect_timeout: config.DATABASE_CONNECT_TIMEOUT_SECS,
    onnotice: (notice) => {
      fastify.log.debug({ notice }, 'PostgreSQL notice received');
    },
    onparameter: (key, value) => {
      fastify.log.trace({ key, value }, 'PostgreSQL runtime parameter changed');
    },
  });

  /* Verify connectivity at startup ─────────────────────────────────────── */
  try {
    const result = await sql`SELECT NOW() AS now`;
    const now = result[0]?.now;
    fastify.log.info(
      { serverTime: now },
      'Database connection established successfully',
    );
  } catch (err: unknown) {
    fastify.log.error(
      { err },
      'Database connection failed — the service will start but queries will fail',
    );
    throw err;
  }

  /* Register drizzle on the Fastify instance ───────────────────────────── */
  const db = drizzle(sql, { schema });
  fastify.decorate('db', db);

  /**
   * Health-check helper — executes a lightweight `SELECT 1` and returns
   * the round-trip latency.  Called by the `/health` route to report
   * database status.
   *
   * @returns Object with `ok` flag and `latencyMs`.
   */
  fastify.decorate('dbHealthCheck', async (): Promise<{
    ok: boolean;
    latencyMs: number;
  }> => {
    const start = Date.now();
    try {
      await sql`SELECT 1`;
      return { ok: true, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  });

  /* Graceful shutdown ──────────────────────────────────────────────────── */
  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing database connection pool…');
    await sql.end({ timeout: 5 });
    fastify.log.info('Database connection pool closed');
  });

  fastify.log.info(
    {
      poolMax: config.DATABASE_POOL_MAX,
      idleTimeout: config.DATABASE_IDLE_TIMEOUT_SECS,
      connectTimeout: config.DATABASE_CONNECT_TIMEOUT_SECS,
    },
    'Database plugin registered',
  );
}

export default fp(dbPlugin, {
  name: 'db',
  fastify: '4.x',
});
