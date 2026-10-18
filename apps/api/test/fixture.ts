import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { dumpPglite, openDb } from '../src/db/db.js';
import { MemoryObjectStore } from '../src/lib/objectStore.js';
import { SyntheticVendor } from '../src/pipeline/vendor.js';
import { seedAll } from '../src/seed.js';

// One seeded database for all integration tests: built once (globalSetup), dumped, then loaded
// into a fresh in-memory PGlite per test file so tests are isolated and fast.

export const FIXTURE = { version: 'fx-11', companies: 16, start: '2020-01-01', asOf: '2026-10-14', dailyDays: 2 };
export const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '.fixture');
export const FIXTURE_DUMP = join(FIXTURE_DIR, `atlas-${FIXTURE.version}.tar.gz`);
export const FIXTURE_OBJECTS = join(FIXTURE_DIR, `objects-${FIXTURE.version}.json`);
/** 22:00 IST on the fixture date: the data window is closed, so data is fresh. */
export const FIXTURE_CLOCK = new Date('2026-10-14T16:30:00.000Z');

export const testConfig = () => loadConfig({ NODE_ENV: 'test', APP_SECRET: 'test-secret-test-secret-test-secret-test', LOG_LEVEL: 'silent', RATE_LIMIT_MULTIPLIER: '1000', WEB_ORIGIN: 'http://localhost:3000' } as NodeJS.ProcessEnv);
export const testVendor = () => new SyntheticVendor({ companies: FIXTURE.companies, start: FIXTURE.start });

export async function buildFixture(): Promise<void> {
  if (existsSync(FIXTURE_DUMP)) return;
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const db = await openDb({});
  const store = new MemoryObjectStore();
  const ctx = await createContext({ cfg: testConfig(), db, store, vendor: testVendor(), clock: () => FIXTURE_CLOCK });
  await seedAll(ctx, { asOf: FIXTURE.asOf, dailyDays: FIXTURE.dailyDays });
  const blob = await dumpPglite(db);
  writeFileSync(FIXTURE_OBJECTS, store.serialize());
  writeFileSync(FIXTURE_DUMP, Buffer.from(await blob.arrayBuffer()));
  await db.close();
}

export async function fixtureContext(overrides: Partial<Parameters<typeof createContext>[0]> = {}): Promise<AppContext> {
  const buf = readFileSync(FIXTURE_DUMP);
  const db = await openDb({ loadDataDir: new Blob([buf], { type: 'application/x-gzip' }) });
  return createContext({ cfg: testConfig(), db, store: MemoryObjectStore.deserialize(readFileSync(FIXTURE_OBJECTS, 'utf8')), vendor: testVendor(), clock: () => FIXTURE_CLOCK, ...overrides });
}
