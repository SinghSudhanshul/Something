import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts', 'services/**/__tests__/**/*.test.ts'],
    testTimeout: 60000, // 60s timeout for testcontainers
    hookTimeout: 120000, // 120s for downloading images
    globalSetup: [], // We can optionally add a global setup here
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'tests/setup/']
    }
  }
});
