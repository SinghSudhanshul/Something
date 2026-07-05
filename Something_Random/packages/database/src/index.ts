/**
 * @nexus/database — Main Export
 *
 * Re-exports schema and provides database connection factory.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema.js';

export * from './schema.js';

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(connectionString: string): ReturnType<typeof drizzle> {
  const sql = postgres(connectionString, {
    max: 20,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return drizzle(sql, { schema });
}
