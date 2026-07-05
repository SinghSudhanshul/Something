import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/types/**',
        'src/index.ts',
      ],
      thresholds: {
        statements: 20,
        branches: 50,
        functions: 30,
        lines: 20,
      },
    },
  },
  resolve: {
    alias: {
      '@nexus/utils': path.resolve(__dirname, '../../packages/utils/src/index.ts'),
      '@nexus/database/schema': path.resolve(__dirname, '../../packages/database/src/schema.ts'),
      '@nexus/database': path.resolve(__dirname, '../../packages/database/src/index.ts'),
    },
  },
});
