import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createContext } from '../bootstrap.js';
import { loadConfig } from '../config.js';
import { dumpPglite, openDb } from '../db/db.js';
import { LocalObjectStore, MemoryObjectStore } from '../lib/objectStore.js';
import { DEV_USERS, seedAll } from '../seed.js';

// Seeds the development dataset. With the embedded database the whole seed runs in memory and the
// finished database is written to disk once: the file-backed engine pays a fixed cost per
// statement, which made a direct on-disk seed of the full history take hours.

const t = Date.now();
const cfg = loadConfig();
const dailyDays = Number(process.env.SEED_DAILY_DAYS ?? 3);

if (cfg.DATABASE_URL) {
  const ctx = await createContext({ cfg });
  const r = await seedAll(ctx, { dailyDays });
  console.log(`Seeded ATLAS development data as of ${r.asOf} in ${Math.round((Date.now() - t) / 1000)} s.`);
  await ctx.db.close();
} else {
  if (existsSync(join(cfg.PGLITE_DIR, 'PG_VERSION'))) {
    console.error(`A database already exists at ${cfg.PGLITE_DIR}. Seeding only runs on an empty database; nothing was changed.`);
    process.exit(1);
  }
  const memDb = await openDb({});
  const memStore = new MemoryObjectStore();
  const ctx = await createContext({ cfg, db: memDb, store: memStore });
  const r = await seedAll(ctx, { dailyDays });
  console.log(`Seeded in memory as of ${r.asOf} in ${Math.round((Date.now() - t) / 1000)} s; writing to disk…`);
  const blob = await dumpPglite(memDb);
  await memDb.close();
  const disk = await openDb({ pgliteDir: cfg.PGLITE_DIR, loadDataDir: blob });
  const check = await disk.one<{ n: number }>(`SELECT count(*)::int AS n FROM ref.companies`);
  await disk.close();
  const store = new LocalObjectStore(cfg.OBJECT_STORE_DIR);
  let objects = 0;
  for (const [key, body] of memStore.entries()) {
    await store.put(key, body);
    objects++;
  }
  console.log(`Wrote database (${(blob.size / 1e6).toFixed(1)} MB compressed, ${check.n} companies) and ${objects} stored objects in ${Math.round((Date.now() - t) / 1000)} s total.`);
}
console.log(`Development accounts: ${DEV_USERS.map((u) => u.email).join(', ')} (password and admin TOTP secret are in apps/api/src/seed.ts).`);
