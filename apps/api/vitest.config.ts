import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/globalSetup.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    pool: 'forks',
    maxWorkers: 4,
    include: ['test/**/*.test.ts'],
  },
});
