import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/globalSetup.ts'],
    testTimeout: 180_000,
    hookTimeout: 300_000,
    pool: 'forks',
    poolOptions: { forks: { minForks: 1, maxForks: 4 } },
    include: ['test/**/*.test.ts'],
  },
});
