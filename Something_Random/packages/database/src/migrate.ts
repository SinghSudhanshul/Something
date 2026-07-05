/**
 * @nexus/database — Migration Runner
 *
 * Applies all pending migrations to the database.
 * Usage: pnpm db:migrate
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

async function runMigrations(): Promise<void> {
  const connectionString =
    process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus_dev_secret@localhost:5432/nexus_dev';

  const sql = postgres(connectionString, { max: 1 });
  const db = drizzle(sql);

  console.info('Running migrations...');

  await migrate(db, { migrationsFolder: './drizzle' });

  console.info('Migrations complete.');

  await sql.end();
  process.exit(0);
}

runMigrations().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
