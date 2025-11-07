import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    hookTimeout: 60000, // 60 seconds
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'], // run setup before tests
  },
});
