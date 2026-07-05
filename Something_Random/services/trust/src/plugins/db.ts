/**
 * PostgreSQL Database Plugin for Fastify
 *
 * Registers a Fastify plugin that creates and manages a PostgreSQL connection pool.
 * The pool is decorated onto the Fastify instance as `app.db`.
 *
 * Features:
 *  - Connection pool with configurable min/max connections
 *  - Health check query on startup
 *  - Automatic cleanup on app close
 *  - Connection error logging
 *  - Slow query detection (> 500ms)
 *
 * @module plugins/db
 */

import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { Pool, type PoolConfig, type PoolClient } from 'pg';
import { createLogger } from '@nexus/utils';
import { config } from '../config.js';

const logger = createLogger('trust-db-plugin');

declare module 'fastify' {
  interface FastifyInstance {
    db: Pool;
    dbQuery: <T = any>(text: string, params?: any[]) => Promise<{ rows: T[]; rowCount: number | null }>;
  }
}

async function dbPlugin(app: FastifyInstance): Promise<void> {
  const poolConfig: PoolConfig = {
    connectionString: config.DATABASE_URL,
    max: config.NODE_ENV === 'production' ? 20 : 10,
    min: config.NODE_ENV === 'production' ? 5 : 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: false,
  };

  const pool = new Pool(poolConfig);

  // Handle pool-level errors
  pool.on('error', (err: Error) => {
    logger.error({ err }, 'Unexpected PostgreSQL pool error');
  });

  pool.on('connect', (client: PoolClient) => {
    logger.debug('New PostgreSQL client connected');
  });

  pool.on('remove', () => {
    logger.debug('PostgreSQL client removed from pool');
  });

  // Verify connection on startup
  try {
    const client = await pool.connect();
    const { rows } = await client.query('SELECT NOW() AS server_time, current_database() AS db_name');
    client.release();

    logger.info(
      {
        serverTime: rows[0].server_time,
        database: rows[0].db_name,
        maxConnections: poolConfig.max,
        minConnections: poolConfig.min,
      },
      'PostgreSQL connection pool initialized',
    );
  } catch (err) {
    logger.fatal({ err }, 'Failed to connect to PostgreSQL');
    throw err;
  }

  // Convenience query function with slow query logging
  const dbQuery = async <T = any>(
    text: string,
    params?: any[],
  ): Promise<{ rows: T[]; rowCount: number | null }> => {
    const start = Date.now();
    try {
      const result = await pool.query(text, params);
      const duration = Date.now() - start;

      if (duration > 500) {
        logger.warn(
          { query: text.slice(0, 100), durationMs: duration, rowCount: result.rowCount },
          'Slow database query detected',
        );
      }

      return { rows: result.rows as T[], rowCount: result.rowCount };
    } catch (err) {
      const duration = Date.now() - start;
      logger.error(
        { err, query: text.slice(0, 100), durationMs: duration },
        'Database query failed',
      );
      throw err;
    }
  };

  app.decorate('db', pool);
  app.decorate('dbQuery', dbQuery);

  app.addHook('onClose', async () => {
    logger.info('Closing PostgreSQL connection pool');
    await pool.end();
    logger.info('PostgreSQL connection pool closed');
  });
}

export default fp(dbPlugin, {
  name: 'db',
  fastify: '4.x',
});
