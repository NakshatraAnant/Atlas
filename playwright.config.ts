import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Browser end-to-end tests (npm run test:e2e). Runs the real API and production web build on
// 127.0.0.1 against an isolated database prepared from the test fixture (scripts/e2e.mjs), in the
// installed Microsoft Edge (no browser download). Background jobs are off so data stays fixed.
const DATA = process.env.ATLAS_E2E_DIR ?? join(tmpdir(), 'atlas-e2e');

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  use: {
    baseURL: 'http://localhost:3000',
    channel: process.env.ATLAS_E2E_CHANNEL ?? 'msedge',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npx tsx apps/api/src/server.ts',
      url: 'http://127.0.0.1:4000/healthz',
      timeout: 120_000,
      reuseExistingServer: false,
      env: { PGLITE_DIR: join(DATA, 'pglite'), OBJECT_STORE_DIR: join(DATA, 'objects'), ATLAS_BACKGROUND_JOBS: 'false', CRYPTO_INGESTION: 'false', CRYPTO_LIVE_FEED: 'false', ALLOW_SYNTHETIC_DATA: 'true', LOG_LEVEL: 'warn', APP_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e', WEB_ORIGIN: 'http://localhost:3000', RATE_LIMIT_MULTIPLIER: '100' },
    },
    {
      command: 'npm run start -w @atlas/web',
      url: 'http://127.0.0.1:3000/login',
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
