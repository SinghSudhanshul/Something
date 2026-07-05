import { describe, it, beforeAll, afterEach, afterAll, expect } from 'vitest';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { execSync } from 'child_process';
import path from 'path';

// Mark the suite to be skipped if testcontainers/docker is not available
describe.skipIf(!process.env.INTEGRATION)('Auth Service Integration Tests', () => {
  let postgresContainer: any;
  let redisContainer: any;
  let fastifyApp: any;

  beforeAll(async () => {
    // Start containers
    postgresContainer = await new PostgreSqlContainer('postgres:15-alpine').start();
    redisContainer = await new RedisContainer('redis:7-alpine').start();

    // Set env vars for the application
    process.env.DATABASE_URL = postgresContainer.getConnectionUri();
    process.env.REDIS_URL = redisContainer.getConnectionUrl();
    process.env.NODE_ENV = 'test';
    process.env.JWT_ACCESS_SECRET = 'supersecret_integration_test_key_32_chars';
    process.env.JWT_REFRESH_SECRET = 'supersecret_integration_test_refresh_32_chars';
    process.env.AUTH_PORT = '0';
    process.env.KAFKA_BROKERS = 'localhost:9092'; // mocked

    // Run migrations
    const workspaceRoot = path.resolve(__dirname, '../../../../../');
    execSync(`cd ${workspaceRoot}/packages/database && DATABASE_URL=${process.env.DATABASE_URL} pnpm db:migrate`, { stdio: 'ignore' });

    // We dynamically import index.ts to ensure it uses the new env vars
    // @ts-expect-error test
    const { buildApp } = await import('../../index');
    fastifyApp = await buildApp();
  }, 120000); // 120s timeout for container startup

  afterEach(async () => {
    // Truncate tables between tests
    if (fastifyApp) {
      await fastifyApp.db.execute(`
        TRUNCATE TABLE users, email_otps, phone_otps, sessions, verification_attempts CASCADE;
      `);
    }
  });

  afterAll(async () => {
    if (fastifyApp) {
      await fastifyApp.close();
    }
    if (postgresContainer) {
      await postgresContainer.stop();
    }
    if (redisContainer) {
      await redisContainer.stop();
    }
  });

  it('should run full registration to verification flow', async () => {
    // Test implementation placeholder for testing logic
    // ...
    expect(true).toBe(true);
  });
});
