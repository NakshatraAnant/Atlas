import { openDb } from '../db/db.js';
import { migrate } from '../db/migrate.js';

// Integrity check of a restored ATLAS database copy (used by `node scripts/atlas.mjs verify-backup`).
// Opens the copy, applies pending migrations to the COPY only, and runs representative queries.
// Usage: tsx src/cli/verify-backup.ts <pglite dir>
const dir = process.argv[2];
if (!dir) throw new Error('Pass the restored pglite directory');
const db = await openDb({ pgliteDir: dir });
const fail: string[] = [];
try {
  const before = await db.query<{ version: string }>(`SELECT version FROM ops.schema_migrations ORDER BY version`);
  const m = await migrate(db);
  const counts = await db.one<Record<string, number>>(`SELECT
      (SELECT count(*)::int FROM app.users) AS users,
      (SELECT count(*)::int FROM ref.companies) AS companies,
      (SELECT count(*)::int FROM market.price_eod) AS equity_prices_synthetic,
      (SELECT count(*)::int FROM acad.courses) AS courses,
      (SELECT count(*)::int FROM crypto.assets) AS crypto_assets,
      (SELECT count(*)::int FROM crypto.ohlcv) AS crypto_observations,
      (SELECT count(*)::int FROM crypto.ingestion_jobs) AS crypto_jobs,
      (SELECT count(*)::int FROM app.notes) AS notes`);
  const research = await db.maybeOne<Record<string, number>>(`SELECT (SELECT count(*)::int FROM research.notebook_entries) AS notebook, (SELECT count(*)::int FROM research.portfolios) AS portfolios, (SELECT count(*)::int FROM equity.prices) AS equity_prices_real`).catch(() => null);
  // Structural checks: OHLC integrity and no duplicate observations survive in the copy.
  const badOhlc = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM crypto.ohlcv WHERE open IS NOT NULL AND (high < low OR close <= 0)`);
  const dup = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM (SELECT series_id, open_time FROM crypto.ohlcv GROUP BY 1,2 HAVING count(*) > 1) x`);
  if (badOhlc.n) fail.push(`${badOhlc.n} invalid OHLC rows`);
  if (dup.n) fail.push(`${dup.n} duplicate observations`);
  if (!counts.users) fail.push('no users');
  if (!counts.courses) fail.push('no Academy courses');
  console.log(JSON.stringify({ migrations_in_backup: before.length, migrations_applied_to_copy: m.applied, counts, research, invalid_ohlc: badOhlc.n, duplicate_observations: dup.n, ok: fail.length === 0, problems: fail }, null, 2));
} finally {
  await db.close();
}
process.exit(fail.length ? 1 : 0);
