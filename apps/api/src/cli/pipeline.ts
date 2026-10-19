import { createContext } from '../bootstrap.js';
import { schedulerTick } from '../pipeline/daily.js';

// Brings the database up to date once: runs every missed end-of-day cycle (today's only after the
// post-close window), then exits. The local launcher runs this before starting the API, because the
// embedded database computes in-process and the API cannot answer requests while a cycle runs.
// Usage: npm run pipeline -w @atlas/api
const ctx = await createContext();
const t = Date.now();
const results = await schedulerTick({ db: ctx.db, store: ctx.store, cfg: ctx.cfg, log: ctx.log, now: ctx.clock }, ctx.vendor);
for (const r of results) console.log(`  ${r.date}: ${r.skipped ? `skipped (${r.skipped})` : `briefing ${r.briefing ?? 'n/a'}`}`);
console.log(results.length ? `Caught up ${results.length} trading day(s) in ${Math.round((Date.now() - t) / 1000)} s.` : 'Data is up to date; nothing to catch up.');
await ctx.db.close();
