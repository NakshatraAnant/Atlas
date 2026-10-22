// Seeds the isolated e2e database with digital-asset data by running the real ingestion jobs against
// provider responses recorded on 22 Oct 2026 (apps/api/test/fixtures/crypto). No network access: the
// fetch below serves only those files, so browser tests see real, fixed data.
// Usage: npx tsx scripts/e2e-crypto-seed.mts <pglite dir>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../apps/api/src/config.js';
import { openDb } from '../apps/api/src/db/db.js';
import { migrate } from '../apps/api/src/db/migrate.js';
import { createLogger } from '../apps/api/src/lib/logger.js';
import { createCryptoModule } from '../apps/api/src/modules/crypto/index.js';
import type { FetchLike } from '../apps/api/src/modules/crypto/http.js';
import { runNamed } from '../apps/api/src/modules/crypto/scheduler.js';

const dir = process.argv[2];
if (!dir) throw new Error('Pass the e2e pglite directory');
const FX = (f: string) => readFileSync(join('apps', 'api', 'test', 'fixtures', 'crypto', f), 'utf8');
const routes: [RegExp, string][] = [
  [/coins\/markets/, 'cg-markets.json'], [/api\/v3\/global/, 'cg-global.json'], [/exchanges\/binance\/tickers/, 'cg-tickers-binance.json'],
  [/market_chart/, 'cg-chart.json'], [/exchangeInfo/, 'bn-exchangeinfo.json'], [/klines/, 'bn-klines.json'], [/api\.llama\.fi\/protocols/, 'll-protocols.json'],
  [/mempool\.space\/api\/v1\/blocks/, 'mp-blocks.json'], [/api\.github\.com/, 'gh-releases.json'], [/blog\.ethereum\.org/, 'eth-blog.xml'],
];
const fetchFixtures: FetchLike = async (url) => {
  const hit = routes.find(([re]) => re.test(url));
  const body = hit ? FX(hit[1]) : '';
  return { status: hit ? 200 : 404, ok: !!hit, headers: { get: () => null }, text: async () => body };
};
const db = await openDb({ pgliteDir: dir });
await migrate(db);
const cfg = loadConfig({ ...process.env, NODE_ENV: 'development', CRYPTO_LIVE_FEED: 'false', LOG_LEVEL: 'warn' } as NodeJS.ProcessEnv);
const mod = await createCryptoModule(db, cfg, createLogger('warn', { service: 'e2e-seed' }), { fetch: fetchFixtures });
for (const job of ['markets', 'global', 'pairs_binance', 'candles_binance', 'reference_history', 'defi_protocols', 'onchain_bitcoin', 'events_github', 'events_ethereum_blog']) {
  const r = await runNamed(mod.rt, job, 'test');
  if (r.status === 'failed') throw new Error(`e2e crypto seed: ${job} failed: ${r.error}`);
}
const n = await db.one<{ a: number; o: number }>(`SELECT (SELECT count(*)::int FROM crypto.assets) a, (SELECT count(*)::int FROM crypto.ohlcv) o`);
await db.close();
console.log(`e2e crypto data ready: ${n.a} assets, ${n.o} observations (recorded responses)`);
