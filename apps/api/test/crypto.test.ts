import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { totpCode } from '../src/lib/crypto.js';
import { ProviderClient, ProviderError, type FetchLike } from '../src/modules/crypto/http.js';
import { LiveFeed, parseMiniTicker, type WsLike } from '../src/modules/crypto/live.js';
import * as P from '../src/modules/crypto/providers.js';
import { runNamed } from '../src/modules/crypto/scheduler.js';
import { checkCandle, checkSupply, findGaps, normaliseAddress } from '../src/modules/crypto/validate.js';
import { DEV_ADMIN_TOTP_SECRET, DEV_PASSWORD } from '../src/seed.js';
import { Client } from './http.js';
import { fixtureContext } from './fixture.js';

// ATLAS Digital Assets. Provider responses are real responses recorded on 22 Oct 2026 and trimmed
// (test/fixtures/crypto). No test reaches the network: the fake fetch below serves only those files.

const FX = (f: string) => readFileSync(new URL(`./fixtures/crypto/${f}`, import.meta.url), 'utf8');
const json = (f: string) => JSON.parse(FX(f));
const DAY = 86_400_000;

type Route = { status?: number; body?: string; throws?: boolean };
function fakeFetch(overrides: { match: RegExp; route: Route | (() => Route) }[] = [], calls: string[] = []): FetchLike {
  const base: [RegExp, () => Route][] = [
    [/coins\/markets\?vs_currency=usd/, () => ({ body: FX('cg-markets.json') })],
    [/coins\/markets\?vs_currency=inr/, () => ({ body: FX('cg-markets.json') })],
    [/api\/v3\/global/, () => ({ body: FX('cg-global.json') })],
    [/exchanges\/binance\/tickers/, () => ({ body: FX('cg-tickers-binance.json') })],
    [/market_chart/, () => ({ body: FX('cg-chart.json') })],
    [/exchangeInfo/, () => ({ body: FX('bn-exchangeinfo.json') })],
    [/klines/, () => ({ body: FX('bn-klines.json') })],
    [/api\.llama\.fi\/protocols(\?|$)/, () => ({ body: FX('ll-protocols.json') })],
    [/mempool\.space\/api\/v1\/blocks/, () => ({ body: FX('mp-blocks.json') })],
    [/fees\/recommended/, () => ({ body: '{"fastestFee":3,"halfHourFee":2,"hourFee":1,"economyFee":1,"minimumFee":1}' })],
    [/api\.github\.com/, () => ({ body: FX('gh-releases.json') })],
    [/blog\.ethereum\.org/, () => ({ body: FX('eth-blog.xml') })],
  ];
  return async (url) => {
    calls.push(url);
    const o = overrides.find((x) => x.match.test(url));
    const r = o ? (typeof o.route === 'function' ? o.route() : o.route) : base.find(([m]) => m.test(url))?.[1]();
    if (!r) return { status: 404, ok: false, headers: { get: () => null }, text: async () => 'not in fixtures' };
    if (r.throws) throw new Error('connect ECONNREFUSED');
    const status = r.status ?? 200;
    return { status, ok: status < 400, headers: { get: (h: string) => (h === 'retry-after' && status === 429 ? '30' : null) }, text: async () => r.body ?? '' };
  };
}

let clockMs = Date.parse('2026-10-23T06:00:00Z');
let outage = false;
let ctx: AppContext;
let app: FastifyInstance;
let c: Client;
const calls: string[] = [];

beforeAll(async () => {
  const fetch = fakeFetch([{ match: /coingecko\.com/, route: () => (outage ? { status: 500, body: 'upstream down' } : (null as unknown as Route)) }], calls);
  // The override returns null when there is no outage, so fall through to the base routes.
  const wrapped: FetchLike = async (url, init) => (outage || !/coingecko/.test(url) ? fetch(url, init) : fakeFetch([], calls)(url, init));
  ctx = await fixtureContext({ clock: () => new Date(clockMs), crypto: { fetch: wrapped, now: () => clockMs } });
  ctx.crypto!.rt.settings.ingestion = true;
  app = await buildApp(ctx);
  c = new Client(app);
  expect((await c.login('pro@atlas.test', DEV_PASSWORD)).status).toBe(200);
});
afterAll(async () => {
  await app?.close();
  await ctx?.db.close();
});

describe('provider transforms (recorded real responses)', () => {
  it('CoinGecko markets: identity, numbers and nulls; 0 market cap is not a market cap', () => {
    const rows = P.parseCgMarkets(json('cg-markets.json'));
    expect(rows[0]!.id).toBe('bitcoin');
    expect(rows[0]!.symbol).toBe('BTC');
    expect(rows[0]!.price).toBeGreaterThan(0);
    expect(rows[0]!.max_supply).toBe(21_000_000);
    const eth = rows.find((r) => r.id === 'ethereum')!;
    expect(eth.max_supply).toBeNull(); // Ethereum has no maximum supply: stays null, never 0
    const zero = P.parseCgMarkets([{ ...json('cg-markets.json')[0], market_cap: 0, max_supply: 0, total_volume: null }]);
    expect(zero[0]!.market_cap).toBeNull();
    expect(zero[0]!.max_supply).toBeNull();
    expect(zero[0]!.volume_24h).toBeNull();
  });
  it('CoinGecko daily chart keeps completed 00:00 UTC points and drops the intraday "now" point', () => {
    const raw = json('cg-chart.json');
    const pts = P.parseCgChart(raw, Date.parse('2026-10-22T20:00:00Z'));
    expect(raw.prices.length).toBe(6);
    expect(pts.length).toBe(5);
    expect(pts.every((p) => p.open_time % DAY === 0 && p.open === null && p.market_cap! > 0)).toBe(true);
  });
  it('Binance klines map fields by position; Coinbase candles are [time, low, high, open, close, volume]', () => {
    const k = P.parseBinanceKlines(json('bn-klines.json'));
    expect(k[0]).toMatchObject({ open_time: 1502928000000, open: 4261.48, high: 4485.39, low: 4200.74, close: 4285.08 });
    const cb = P.parseCoinbaseCandles(json('cb-candles.json'));
    expect(cb[0]!.open_time).toBeLessThan(cb[cb.length - 1]!.open_time); // sorted oldest first
    for (const x of cb) expect(x.high!).toBeGreaterThanOrEqual(Math.max(x.open!, x.close));
  });
  it('venue products: status and tradability from the venue itself', () => {
    const bn = P.parseBinanceExchangeInfo(json('bn-exchangeinfo.json'));
    expect(bn.map((p) => p.product_id).sort()).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(bn[0]!.tradable).toBe(bn[0]!.status === 'TRADING');
    const cb = P.parseCoinbaseProducts(json('cb-products.json'));
    expect(cb.find((p) => p.product_id === 'BTC-USD')).toMatchObject({ base: 'BTC', quote: 'USD' });
  });
  it('venue mapping uses coin_id, not the symbol (WBTC/BTC belongs to wrapped-bitcoin)', () => {
    const t = P.parseCgTickers(json('cg-tickers-binance.json'));
    expect(t.find((x) => x.base === 'WBTC')?.coin_id).toBe('wrapped-bitcoin');
    expect(t.find((x) => x.base === 'BTC' && x.target === 'USDT')?.coin_id).toBe('bitcoin');
  });
  it('on-chain blocks: Ethereum hex fields and Bitcoin fees in BTC', () => {
    const e = P.parseEthBlock(json('eth-block.json'));
    expect(e.height).toBeGreaterThan(20_000_000);
    expect(e.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(e.base_fee_gwei).toBeGreaterThanOrEqual(0);
    expect(e.total_fees_native).toBeNull(); // needs every receipt: not available, not zero
    const b = P.parseMempoolBlocks(json('mp-blocks.json'));
    expect(b[0]!.total_fees_native).toBeLessThan(10);
    expect(b[0]!.tx_count).toBeGreaterThan(0);
  });
  it('events keep the source link and the source publication time', () => {
    const gh = P.parseGithubReleases(json('gh-releases.json'), P.TRACKED_REPOS[0]!);
    expect(gh[0]!.url).toMatch(/^https:\/\/github\.com\/bitcoin\/bitcoin\/releases\//);
    expect(gh[0]!.published_at).toBe(new Date(json('gh-releases.json')[0].published_at).toISOString());
    const rss = P.parseRss(FX('eth-blog.xml'), 'ethblog', ['ethereum']);
    expect(rss.length).toBe(2);
    expect(rss[0]!.url).toMatch(/^https:\/\/blog\.ethereum\.org\//);
    expect(() => P.parseRss('<html></html>', 'x', [])).toThrow();
  });
});

describe('validation', () => {
  const now = Date.parse('2026-10-23T00:00:00Z');
  const ok = { open_time: Date.UTC(2026, 9, 1), open: 10, high: 12, low: 9, close: 11, volume: 5 };
  it('rejects impossible candles and keeps extreme-but-possible ones as suspect', () => {
    expect(checkCandle(ok, { now, interval: '1d' }).ok).toBe(true);
    expect(checkCandle({ ...ok, high: 8 }, { now, interval: '1d' }).reasons).toContain('high_below_low');
    expect(checkCandle({ ...ok, open_time: now + DAY }, { now, interval: '1d' }).reasons).toContain('timestamp_in_future');
    expect(checkCandle({ ...ok, open_time: ok.open_time + 3_600_000 }, { now, interval: '1d' }).reasons).toContain('timestamp_not_aligned_to_interval');
    expect(checkCandle({ ...ok, volume: -1 }, { now, interval: '1d' }).ok).toBe(false);
    const jump = checkCandle({ ...ok, open: 20, high: 22, low: 19, close: 21 }, { now, interval: '1d', prevClose: 10 });
    expect(jump.ok).toBe(true);
    expect(jump.suspect).toBe(true);
  });
  it('normalises addresses per network family', () => {
    expect(normaliseAddress('evm', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
    expect(normaliseAddress('evm', '0x123')).toBeNull();
    expect(normaliseAddress('svm', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(normaliseAddress('svm', '0OIl')).toBeNull();
  });
  it('flags supply combinations that cannot all be true, and accepts undefined maximums', () => {
    expect(checkSupply({ circulating: 10, total: 9, max: null }).validation).toBe('inconsistent');
    expect(checkSupply({ circulating: 9, total: 10, max: null }).validation).toBe('valid');
  });
  it('finds missing days', () => {
    expect(findGaps([0, DAY, 4 * DAY], DAY)).toEqual([{ from: 2 * DAY, to: 3 * DAY, missing: 2 }]);
  });
});

describe('request budgeting, caching and back-off', () => {
  const mk = (fetch: FetchLike) => {
    let t = Date.parse('2026-10-23T00:00:00Z');
    const sleeps: number[] = [];
    const cl = new ProviderClient(ctx.db, fetch, () => t, async (ms) => { sleeps.push(ms); t += ms; });
    return { cl, sleeps, advance: (ms: number) => { t += ms; } };
  };
  it('throttles to the per-minute budget instead of exceeding it', async () => {
    const { cl, sleeps } = mk(fakeFetch());
    cl.setBudget('defillama', 2);
    for (let i = 0; i < 3; i++) await cl.request('defillama', `https://api.llama.fi/protocols?i=${i}`, { critical: true });
    expect(sleeps.length).toBe(1);
    expect(sleeps[0]).toBeGreaterThan(55_000);
  });
  it('serves repeated requests from cache and de-duplicates concurrent ones', async () => {
    const seen: string[] = [];
    const { cl } = mk(fakeFetch([], seen));
    await cl.request('defillama', 'https://api.llama.fi/protocols', { ttlMs: 60_000 });
    await cl.request('defillama', 'https://api.llama.fi/protocols', { ttlMs: 60_000 });
    await Promise.all([cl.request('mempool_space', 'https://mempool.space/api/v1/blocks'), cl.request('mempool_space', 'https://mempool.space/api/v1/blocks')]);
    expect(seen.filter((u) => u.endsWith('/protocols')).length).toBe(1);
    expect(seen.filter((u) => u.endsWith('/v1/blocks')).length).toBe(1);
  });
  it('backs off after HTTP 429 without sending more requests, and marks the source rate limited', async () => {
    const seen: string[] = [];
    const { cl, advance } = mk(fakeFetch([{ match: /github/, route: { status: 429 } }], seen));
    await expect(cl.request('github_releases', 'https://api.github.com/x')).rejects.toMatchObject({ kind: 'rate_limited' });
    await expect(cl.request('github_releases', 'https://api.github.com/y')).rejects.toMatchObject({ kind: 'backing_off' });
    expect(seen.filter((u) => u.includes('github')).length).toBe(1);
    expect((await ctx.db.one<{ health: string }>(`SELECT health FROM crypto.sources WHERE source_id='github_releases'`)).health).toBe('rate_limited');
    advance(31_000);
    await expect(cl.request('github_releases', 'https://api.github.com/z')).rejects.toBeInstanceOf(ProviderError);
    expect(seen.filter((u) => u.includes('github')).length).toBe(2);
  });
  it('reports malformed responses and network failures as errors, never as data', async () => {
    const { cl } = mk(fakeFetch([{ match: /fees\/recommended/, route: { body: '<html>oops' } }, { match: /blocks\/tip/, route: { throws: true } }]));
    await expect(cl.request('mempool_space', 'https://mempool.space/api/v1/fees/recommended')).rejects.toMatchObject({ kind: 'malformed' });
    await expect(cl.request('mempool_space', 'https://mempool.space/api/blocks/tip/height')).rejects.toMatchObject({ kind: 'network' });
    const s = await ctx.db.one<{ health: string; consecutive_failures: number }>(`SELECT health, consecutive_failures FROM crypto.sources WHERE source_id='mempool_space'`);
    expect(s.consecutive_failures).toBeGreaterThanOrEqual(2);
    expect(['degraded', 'failing']).toContain(s.health);
  });
});

describe('ingestion (recorded responses → validated, persisted, idempotent)', () => {
  const rt = () => ctx.crypto!.rt;
  it('imports the asset registry, snapshots and supply, and re-running does not duplicate', async () => {
    expect((await runNamed(rt(), 'markets', 'test')).status).toBe('succeeded');
    const r1 = await ctx.db.one<{ a: number; s: number; m: number }>(`SELECT (SELECT count(*)::int FROM crypto.assets) a, (SELECT count(*)::int FROM crypto.supply_snapshots) s, (SELECT count(*)::int FROM crypto.market_snapshots) m`);
    expect(r1.a).toBe(5);
    await runNamed(rt(), 'markets', 'test');
    const r2 = await ctx.db.one<{ a: number; s: number; m: number }>(`SELECT (SELECT count(*)::int FROM crypto.assets) a, (SELECT count(*)::int FROM crypto.supply_snapshots) s, (SELECT count(*)::int FROM crypto.market_snapshots) m`);
    expect(r2).toEqual(r1);
    const btc = await ctx.db.one<{ price: number; max_supply: number; methodology: string }>(`SELECT m.price::float8 AS price, s.max_supply::float8 AS max_supply, s.methodology FROM crypto.assets a JOIN crypto.market_snapshots m USING (asset_id) JOIN crypto.supply_snapshots s USING (asset_id) WHERE a.canonical_key='bitcoin'`);
    expect(btc.price).toBe(json('cg-markets.json')[0].current_price);
    expect(btc.max_supply).toBe(21_000_000);
    expect(btc.methodology).toMatch(/not independently verified/);
  });
  it('records each job stage separately', async () => {
    const j = await ctx.db.one<Record<string, unknown>>(`SELECT * FROM crypto.ingestion_jobs WHERE job_type='markets' ORDER BY started_at DESC LIMIT 1`);
    for (const k of ['fetched_at', 'validated_at', 'persisted_at', 'reconciled_at', 'finished_at']) expect(j[k]).not.toBeNull();
    expect(j.records_persisted).toBe(5);
  });
  it('maps venue pairs only when the venue confirms them', async () => {
    expect((await runNamed(rt(), 'pairs_binance', 'test')).status).toBe('succeeded');
    const pairs = await ctx.db.query<{ product_id: string; key: string }>(`SELECT p.product_id, a.canonical_key AS key FROM crypto.market_pairs p JOIN crypto.assets a ON a.asset_id=p.base_asset_id ORDER BY 1`);
    // BTCFDUSD is in CoinGecko's ticker list but not in the recorded venue product list → not mapped.
    expect(pairs).toEqual([{ product_id: 'BTCUSDT', key: 'bitcoin' }, { product_id: 'ETHUSDT', key: 'ethereum' }]);
  });
  it('backfills venue candles idempotently and records coverage', async () => {
    expect((await runNamed(rt(), 'candles_binance', 'test')).status).toBe('succeeded');
    const n1 = (await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM crypto.ohlcv`)).n;
    expect(n1).toBe(10); // 5 recorded klines × 2 pairs
    await ctx.db.query(`UPDATE crypto.price_series SET backfill_complete=false, backfill_cursor=NULL`);
    await runNamed(rt(), 'candles_binance', 'test');
    expect((await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM crypto.ohlcv`)).n).toBe(n1);
    const s = await ctx.db.one<{ observations: number; first_open_time: string }>(`SELECT observations, first_open_time FROM crypto.price_series s JOIN crypto.market_pairs p USING (pair_id) WHERE p.product_id='BTCUSDT'`);
    expect(s.observations).toBe(5);
    expect(s.first_open_time).toBe('2017-08-17T00:00:00.000Z');
  });
  it('quarantines invalid candles instead of storing them', async () => {
    const bad = json('bn-klines.json');
    bad[0][2] = '1.00'; // high below low
    const local = fakeFetch([{ match: /klines/, route: { body: JSON.stringify(bad) } }]);
    const cl = new ProviderClient(ctx.db, local);
    const before = (await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM crypto.quarantine`)).n;
    const { runJob, storeCandles } = await import('../src/modules/crypto/ingest.js');
    const series = (await ctx.db.one<{ series_id: string }>(`SELECT series_id FROM crypto.price_series LIMIT 1`)).series_id;
    await runJob({ ...rt(), client: cl }, 'binance', 'quarantine_test', 'test', async (job) => {
      await storeCandles({ ...rt(), client: cl }, job, series, P.parseBinanceKlines(bad), 'binance_daily_candles');
    });
    const q = await ctx.db.query<{ reasons: string[] }>(`SELECT reasons FROM crypto.quarantine ORDER BY quarantine_id DESC LIMIT 1`);
    expect((await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM crypto.quarantine`)).n).toBe(before + 1);
    expect(q[0]!.reasons).toContain('high_below_low');
  });
  it('imports global metrics, DeFi, on-chain blocks and events with sources', async () => {
    for (const j of ['global', 'defi_protocols', 'onchain_bitcoin', 'events_github', 'events_ethereum_blog']) expect((await runNamed(rt(), j, 'test')).status, j).not.toBe('failed');
    const e = await ctx.db.query<{ source_url: string; source_id: string }>(`SELECT source_url, source_id FROM crypto.events`);
    expect(e.length).toBeGreaterThan(0);
    expect(e.every((x) => x.source_url.startsWith('https://'))).toBe(true);
    expect((await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM crypto.onchain_blocks WHERE network_id='bitcoin'`)).n).toBe(2);
    expect((await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM crypto.protocols`)).n).toBe(3);
  });
  it('a job that cannot run yet fails with the reason, not a silent success', async () => {
    const r = await runNamed(rt(), 'candles_coinbase', 'test');
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/pairs_coinbase/);
  });
});

describe('API', () => {
  it('requires sign-in', async () => {
    for (const u of ['/v1/crypto/overview', '/v1/crypto/assets', '/v1/crypto/sources', '/v1/crypto/live']) expect((await new Client(app).get(u)).status, u).toBe(401);
  });
  it('overview shows provider totals with source and freshness', async () => {
    const o = (await c.get('/v1/crypto/overview')).json;
    expect(o.global.source_id).toBe('coingecko');
    expect(o.global.total_market_cap_usd).toBe(json('cg-global.json').data.total_market_cap.usd);
    expect(o.global.freshness.state).toBe('fresh');
    expect(o.attribution).toMatch(/Powered by CoinGecko/);
  });
  it('explorer searches, sorts and paginates on the server', async () => {
    const r = (await c.get('/v1/crypto/assets?q=eth&per=10')).json;
    expect(r.rows.map((x: { canonical_key: string }) => x.canonical_key)).toContain('ethereum');
    const sorted = (await c.get('/v1/crypto/assets?sort=market_cap&dir=asc&per=10')).json.rows.map((x: { market_cap: number }) => x.market_cap);
    expect(sorted).toEqual([...sorted].sort((a, b) => a - b));
    expect((await c.get('/v1/crypto/assets?per=1000')).status).toBe(400);
  });
  it('asset detail lists verified pairs and labelled series', async () => {
    const d = (await c.get('/v1/crypto/assets/bitcoin')).json;
    expect(d.asset.symbol).toBe('BTC');
    expect(d.pairs.map((p: { product_id: string }) => p.product_id)).toEqual(['BTCUSDT']);
    expect(d.series[0].label).toMatch(/Binance BTCUSDT daily candles/);
    expect(d.supply_latest.max_supply).toBe(21_000_000);
    expect((await c.get('/v1/crypto/assets/not-a-real-asset')).status).toBe(404);
  });
  it('history returns exactly the stored observations', async () => {
    const h = (await c.get('/v1/crypto/assets/bitcoin/history?range=max')).json;
    const stored = await ctx.db.query<{ close: number }>(`SELECT o.close::float8 AS close FROM crypto.ohlcv o JOIN crypto.price_series s USING (series_id) JOIN crypto.market_pairs p USING (pair_id) WHERE p.product_id='BTCUSDT' ORDER BY open_time`);
    expect(h.observations.map((o: { close: number }) => o.close)).toEqual(stored.map((s) => s.close));
    expect(h.series.data_kind).toBe('venue');
  });
  it('analytics match an independent calculation from the stored rows', async () => {
    const a = (await c.get('/v1/crypto/assets/bitcoin/analytics')).json;
    const k = P.parseBinanceKlines(json('bn-klines.json'));
    const last = k[k.length - 1]!.close;
    expect(a.returns['1d'].value).toBeCloseTo(last / k[k.length - 2]!.close - 1, 12);
    expect(a.returns['30d'].value).toBeNull(); // only 5 days stored: insufficient, not invented
    let peak = 0;
    let maxDd = 0;
    for (const x of k) {
      peak = Math.max(peak, x.close);
      maxDd = Math.min(maxDd, x.close / peak - 1);
    }
    expect(a.drawdown.max).toBeCloseTo(maxDd, 12);
    expect(a.volatility['30d'].value).toBeNull();
    expect(a.formulas.length).toBeGreaterThan(3);
  });
  it('correlation matrix refuses to compare too little data', async () => {
    const m = (await c.get('/v1/crypto/research/correlation?keys=bitcoin,ethereum&source=binance&window=90')).json;
    expect(m.matrix[0][1].value).toBeNull();
    expect(m.matrix[0][1].reason).toMatch(/at least 30/);
  });
  it('cross-asset research never uses synthetic equity data', async () => {
    const r = (await c.get('/v1/crypto/research/cross-asset?key=bitcoin')).json;
    expect(r.synthetic_equities_excluded).toBe(true);
    expect(r.policy).toMatch(/synthetic/);
  });
  it('a provider outage leaves the last values in place, marks them stale and never invents new ones', async () => {
    const before = (await c.get('/v1/crypto/assets/bitcoin')).json.snapshots.find((s: { quote_currency: string }) => s.quote_currency === 'usd');
    outage = true;
    clockMs += 3 * 3_600_000;
    const r = await runNamed(ctx.crypto!.rt, 'markets', 'test');
    expect(r.status).toBe('failed');
    const after = (await c.get('/v1/crypto/assets/bitcoin')).json;
    const usd = after.snapshots.find((s: { quote_currency: string }) => s.quote_currency === 'usd');
    expect(usd.price).toBe(before.price);
    expect(usd.retrieved_at).toBe(before.retrieved_at);
    expect(after.snapshot_freshness.state).toBe('stale');
    const src = (await c.get('/v1/crypto/sources')).json.sources.find((s: { source_id: string }) => s.source_id === 'coingecko');
    expect(['degraded', 'failing']).toContain(src.health);
    expect(src.last_error).toMatch(/500/);
    outage = false;
  });
  it('watchlist and notes are private to each user', async () => {
    expect((await c.post('/v1/crypto/watchlist', { key: 'bitcoin' })).status).toBe(200);
    expect((await c.post('/v1/crypto/assets/bitcoin/notes', { body: 'Halving schedule to read.' })).status).toBe(200);
    expect((await c.get('/v1/crypto/watchlist')).json.rows.map((r: { canonical_key: string }) => r.canonical_key)).toEqual(['bitcoin']);
    const other = new Client(app);
    await other.login('plus@atlas.test', DEV_PASSWORD);
    expect((await other.get('/v1/crypto/watchlist')).json.rows).toEqual([]);
    expect((await other.get('/v1/crypto/assets/bitcoin/notes')).json.rows).toEqual([]);
    const note = (await c.get('/v1/crypto/assets/bitcoin/notes')).json.rows[0];
    expect((await other.del(`/v1/crypto/notes/${note.note_id}`)).status).toBe(404);
  });
  it('manual job runs need an admin with two-step verification', async () => {
    expect((await c.post('/admin/v1/crypto/jobs/global/run')).status).toBe(403);
    const admin = new Client(app);
    expect((await admin.login('admin@atlas.test', DEV_PASSWORD, totpCode(DEV_ADMIN_TOTP_SECRET, clockMs))).status).toBe(200);
    const r = await admin.post('/admin/v1/crypto/jobs/events_ethereum_blog/run');
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('succeeded');
    expect((await admin.post('/admin/v1/crypto/jobs/drop_tables/run')).status).toBe(404);
  });
});

describe('live feed (Binance WebSocket)', () => {
  const msg = (s: string, c: string, E: number) => JSON.stringify({ stream: `${s.toLowerCase()}@miniTicker`, data: { e: '24hrMiniTicker', E, s, c, o: '100', h: '120', l: '90', v: '5', q: '500' } });
  it('parses mini tickers and rejects malformed ones', () => {
    expect(parseMiniTicker(msg('BTCUSDT', '110', 1), 2)?.last).toBe(110);
    expect(parseMiniTicker('{"data":{"e":"trade"}}', 2)).toBeNull();
    expect(parseMiniTicker('not json', 2)).toBeNull();
  });
  it('is live only while valid messages arrive; silence makes it stale and replaces the connection', () => {
    let t = 1_000_000;
    const sockets: WsLike[] = [];
    const feed = new LiveFeed(['BTCUSDT'], () => {
      const ws: WsLike = { onopen: null, onmessage: null, onclose: null, onerror: null, close() { this.onclose?.({}); } };
      sockets.push(ws);
      return ws;
    }, () => t);
    feed.start();
    expect(feed.snapshot().state).toBe('connecting');
    sockets[0]!.onmessage!({ data: msg('BTCUSDT', '110', t) });
    expect(feed.snapshot().state).toBe('live');
    expect(feed.snapshot().tickers[0]!.last).toBe(110);
    // An older event arriving late does not overwrite a newer price.
    sockets[0]!.onmessage!({ data: msg('BTCUSDT', '105', t - 5000) });
    expect(feed.snapshot().tickers[0]!.last).toBe(110);
    t += 20_000;
    const s = feed.snapshot();
    expect(s.state).toBe('stale');
    expect(s.tickers[0]!.stale).toBe(true);
    feed.stop();
    expect(feed.snapshot().state).toBe('disabled');
  });
  it('the API reports the live feed as disabled when it is not running (tests)', async () => {
    const r = (await c.get('/v1/crypto/live')).json;
    expect(r.state).toBe('disabled');
  });
});
