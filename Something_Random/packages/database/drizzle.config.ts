import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus_dev_secret@localhost:5432/nexus_dev',
  },
  verbose: true,
  strict: true,
});
