// Prepares an isolated database for browser end-to-end tests from the deterministic test fixture
// (apps/api/test/fixture.ts): fast, reproducible, and never touches the development database.
// Usage: npx tsx scripts/e2e-prepare.mts <dir>
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../apps/api/src/db/db.js';
import { LocalObjectStore, MemoryObjectStore } from '../apps/api/src/lib/objectStore.js';
import { buildFixture, FIXTURE_DUMP, FIXTURE_OBJECTS } from '../apps/api/test/fixture.js';

const dir = process.argv[2];
if (!dir) throw new Error('Pass the e2e data directory');
await buildFixture();
rmSync(dir, { recursive: true, force: true });
const db = await openDb({ pgliteDir: join(dir, 'pglite'), loadDataDir: new Blob([readFileSync(FIXTURE_DUMP)], { type: 'application/x-gzip' }) });
const n = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM ref.companies WHERE coverage='full'`);
await db.close();
const mem = MemoryObjectStore.deserialize(readFileSync(FIXTURE_OBJECTS, 'utf8'));
const store = new LocalObjectStore(join(dir, 'objects'));
for (const [key, body] of mem.entries()) await store.put(key, body);
console.log(`e2e database ready: ${n.n} covered companies in ${dir} (${existsSync(join(dir, 'pglite', 'PG_VERSION')) ? 'ok' : 'missing'})`);
