import { createContext } from '../bootstrap.js';
import { loadConfig } from '../config.js';
import { JOBS, runNamed, cryptoTick } from '../modules/crypto/scheduler.js';

// ATLAS Digital Assets data CLI. The embedded database allows one process at a time, so run this while
// the API is stopped (the local launcher does: `node scripts/atlas.mjs crypto <command>`).
// Usage:
//   npm run crypto -w @atlas/api -- status
//   npm run crypto -w @atlas/api -- run markets global pairs_binance candles_binance
//   npm run crypto -w @atlas/api -- tick [rounds]      (run whatever is due, like the scheduler)
//   npm run crypto -w @atlas/api -- jobs               (list job types)
//   add --memory to use a throwaway in-memory database (a dry run against the real providers)
const args = process.argv.slice(2).filter((a) => a !== '--memory');
const memory = process.argv.includes('--memory');
const [cmd = 'status', ...rest] = args;
const cfg = loadConfig({ ...process.env, CRYPTO_LIVE_FEED: 'false' });
const ctx = await createContext({ cfg, memory });
const rt = ctx.crypto!.rt;
// The CLI is an explicit user action: it may ingest even if the scheduler is switched off.
rt.settings.ingestion = true;

const print = (r: { job_type: string; status: string; records_persisted: number; error: string | null }) =>
  console.log(`  ${r.job_type.padEnd(22)} ${r.status.padEnd(9)} persisted ${String(r.records_persisted).padStart(6)}${r.error ? `  — ${r.error.slice(0, 240)}` : ''}`);

try {
  if (cmd === 'jobs') {
    for (const j of JOBS) console.log(`  ${j.type.padEnd(22)} ${j.source.padEnd(16)} every ${j.everyMs / 60_000} min`);
  } else if (cmd === 'run') {
    if (!rest.length) throw new Error('Name at least one job (see `jobs`).');
    for (const t of rest) print(await runNamed(rt, t, 'manual'));
  } else if (cmd === 'tick') {
    const rounds = Math.max(1, Math.min(50, Number(rest[0] ?? 1)));
    for (let i = 0; i < rounds; i++) {
      const r = await cryptoTick(rt, 20);
      if (!r.length) break;
      r.forEach(print);
    }
  } else if (cmd === 'status') {
    const s = await ctx.db.query<{ source_id: string; health: string; last_success_at: string | null; last_import_at: string | null; last_error: string | null }>(`SELECT source_id, health, last_success_at, last_import_at, last_error FROM crypto.sources ORDER BY source_id`);
    for (const r of s) console.log(`  ${r.source_id.padEnd(16)} ${r.health.padEnd(12)} last success ${r.last_success_at ?? '—'}  last import ${r.last_import_at ?? '—'}${r.last_error ? `  last error: ${r.last_error.slice(0, 120)}` : ''}`);
    const c = await ctx.db.one(`SELECT (SELECT count(*)::int FROM crypto.assets) AS assets, (SELECT count(*)::int FROM crypto.market_pairs) AS pairs, (SELECT count(*)::int FROM crypto.price_series WHERE observations>0) AS series,
      (SELECT count(*)::int FROM crypto.ohlcv) AS observations, (SELECT min(open_time) FROM crypto.ohlcv) AS earliest, (SELECT max(open_time) FROM crypto.ohlcv) AS latest, (SELECT count(*)::int FROM crypto.protocols) AS protocols,
      (SELECT count(*)::int FROM crypto.defi_metrics) AS defi_points, (SELECT count(*)::int FROM crypto.onchain_blocks) AS blocks, (SELECT count(*)::int FROM crypto.events) AS events, (SELECT count(*)::int FROM crypto.quarantine) AS quarantined`);
    console.log(c);
  } else throw new Error(`Unknown command ${cmd}`);
} finally {
  await ctx.db.close();
}
