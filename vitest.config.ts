import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load test environment variables before anything else
config({ path: resolve(process.cwd(), '.env.test'), override: true });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    hookTimeout: 60000, // 60 seconds
    testTimeout: 30000, // 30 seconds per test
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'], // run setup before tests
    // Run tests sequentially to avoid database conflicts
    // Can be changed to true once tests are fully isolated
    sequence: {
      concurrent: false,
    },
    coverage: {
      exclude: [
        "generated/**",
        "prisma/**",
        "scripts/**",
        "src/lib/prisma.ts",
        "src/seedDatabase.ts",
        "src/socket/**",
        "**/node_modules/**",
        "**/dist/**",
      ],
    },
    env: {
      NODE_ENV: 'test',
    },
  },
});
