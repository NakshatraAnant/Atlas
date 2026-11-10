import * as A from '@atlas/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/db.js';
import { badRequest, notFound, parse, unavailable } from '../../lib/http.js';
import { requireRole, requireUser, isOperator } from '../auth/service.js';
import { runNamed, JOBS, lastRuns } from './scheduler.js';
import { freshness } from './validate.js';
import { syncDetails, runJob } from './ingest.js';

// ATLAS Digital Assets API. Reads stored, source-attributed records only; nothing here calls a provider
// except the explicit admin "run job" action and the on-demand metadata fill for one asset. Every
// response states the data kind (reference, venue-specific, derived, on-chain, provider-estimated) and
// the source and timestamp of each value. Missing values are null with a reason, never zero.

const DAY = 86_400_000;
const keyParam = z.object({ key: z.string().min(1).max(120).regex(/^[a-z0-9._-]+$/) });

export const DATA_KINDS = {
  reference: 'Global reference price aggregated by the provider across venues. Not an executable price on any exchange.',
  venue: 'Exchange-specific price for one market pair on one venue. Other venues and quote currencies differ.',
  derived: 'Calculated by ATLAS from stored observations with the documented formula.',
  provider_estimate: 'Provider-estimated figure (for example circulating supply). Not independently verified.',
  onchain: 'Read from a public blockchain endpoint for a recent window of blocks.',
  converted: 'Provider-converted reference price in INR. Not a price on any INR market.',
} as const;

export const FORMULAS = [
  { code: 'return_period', name: 'Period return', formula: 'p_end / p_start − 1', inputs: 'Daily closes from one series', period: 'End = latest observation; start = observation N days earlier (nearest earlier within 3 days, actual span reported)', missing: 'Insufficient history → not shown' },
  { code: 'volatility', name: 'Realised volatility (annualised)', formula: 'stdev(ln(p_t / p_{t−1})) × √365 (sample stdev, n − 1)', inputs: 'Daily closes from one series', period: 'Trailing 30 or 90 calendar days', missing: 'Returns across gaps are not computed; needs ≥ 90% of the window' },
  { code: 'drawdown', name: 'Drawdown', formula: 'p_t / max(p_0..p_t) − 1; maximum drawdown = min over the series', inputs: 'Daily closes from one series', period: 'Whole stored history of the series', missing: 'Gaps are not filled; the peak is the highest stored close' },
  { code: 'correlation', name: 'Correlation', formula: 'Pearson correlation of aligned daily log returns', inputs: 'Two series from the same source', period: 'Trailing window (default 90 days)', missing: 'Only days on which both series have a daily return; needs ≥ 30 such days' },
  { code: 'beta', name: 'Beta', formula: 'cov(r_asset, r_benchmark) / var(r_benchmark)', inputs: 'Aligned daily log returns', period: 'Trailing 365 days', missing: 'As correlation' },
  { code: 'regime', name: 'Historical regime', formula: 'Trend: close vs 200-day SMA; volatility: 30-day realised vol vs its full-history median', inputs: 'Daily closes', period: 'Whole series', missing: 'Needs ≥ 230 observations' },
  { code: 'fdv', name: 'Fully diluted valuation', formula: 'price × maximum supply (or total supply where no maximum is defined), as reported by the provider', inputs: 'CoinGecko snapshot', period: 'Snapshot time', missing: 'Not shown when the provider gives none' },
] as const;

interface SeriesRow { series_id: string; source_id: string; kind: string; quote_currency: string; product_id: string | null; exchange_id: string | null; first_open_time: string | null; last_open_time: string | null; observations: number; backfill_complete: boolean }

async function assetByKey(db: Db, key: string) {
  const a = await db.maybeOne<{ asset_id: string; canonical_key: string; name: string; symbol: string; classification: string; category: string | null; description: string | null; image_url: string | null; primary_network_id: string | null; listing_status: string; market_cap_rank: number | null; metadata_source: string; first_seen_at: string; last_verified_at: string }>(
    `SELECT asset_id, canonical_key, name, symbol, classification, category, description, image_url, primary_network_id, listing_status, market_cap_rank, metadata_source, first_seen_at, last_verified_at FROM crypto.assets WHERE canonical_key=$1`, [key]);
  if (!a) throw notFound('No such digital asset in ATLAS. Assets appear after the CoinGecko market import.');
  return a;
}

async function seriesFor(db: Db, assetId: string): Promise<SeriesRow[]> {
  return db.query<SeriesRow>(
    `SELECT s.series_id, s.source_id, s.kind, s.quote_currency, p.product_id, p.exchange_id, s.first_open_time, s.last_open_time, s.observations, s.backfill_complete
       FROM crypto.price_series s LEFT JOIN crypto.market_pairs p ON p.pair_id=s.pair_id WHERE s.asset_id=$1 AND s.observations > 0
      ORDER BY CASE s.source_id WHEN 'coingecko' THEN 0 WHEN 'binance' THEN 1 ELSE 2 END, s.observations DESC`, [assetId]);
}

async function observations(db: Db, seriesId: string, fromMs?: number): Promise<{ t: number; open: number | null; high: number | null; low: number | null; close: number; volume: number | null; market_cap: number | null; validation: string }[]> {
  const rows = await db.query<{ open_time: string; open: number | null; high: number | null; low: number | null; close: number; volume: number | null; market_cap: number | null; validation: string }>(
    `SELECT open_time, open::float8 AS open, high::float8 AS high, low::float8 AS low, close::float8 AS close, volume::float8 AS volume, market_cap::float8 AS market_cap, validation
       FROM crypto.ohlcv WHERE series_id=$1 AND ($2::timestamptz IS NULL OR open_time >= $2) ORDER BY open_time`, [seriesId, fromMs === undefined ? null : new Date(fromMs).toISOString()]);
  return rows.map((r) => ({ ...r, t: Date.parse(r.open_time) }));
}

function seriesLabel(s: SeriesRow): string {
  if (s.kind === 'reference_close') return `CoinGecko reference price (${s.quote_currency}, daily, observed 00:00 UTC)`;
  return `${s.exchange_id === 'binance' ? 'Binance' : 'Coinbase Exchange'} ${s.product_id} daily candles (UTC day, venue-specific)`;
}

const ok = <T>(r: A.Result<T>) => (r.ok ? r : null);
const why = (r: A.Result<unknown>) => (r.ok ? null : (r as A.Insufficient).reason);

/** Pick the series to analyse: an explicit id (must belong to the asset), else the longest venue series, else the reference series. */
async function pickSeries(db: Db, assetId: string, seriesId?: string, preferSource?: string): Promise<SeriesRow | null> {
  const all = await seriesFor(db, assetId);
  if (seriesId) {
    const s = all.find((x) => x.series_id === seriesId);
    if (!s) throw badRequest('That price series does not belong to this asset.');
    return s;
  }
  if (preferSource) return all.find((x) => x.source_id === preferSource) ?? null;
  return [...all].sort((a, b) => b.observations - a.observations)[0] ?? null;
}

async function benchmarkObs(db: Db, canonicalKey: string, sourceId: string, fromMs?: number): Promise<A.Obs[] | null> {
  const s = await db.maybeOne<{ series_id: string }>(
    `SELECT s.series_id FROM crypto.price_series s JOIN crypto.assets a ON a.asset_id=s.asset_id WHERE a.canonical_key=$1 AND s.source_id=$2 ORDER BY s.observations DESC LIMIT 1`, [canonicalKey, sourceId]);
  if (!s) return null;
  return (await observations(db, s.series_id, fromMs)).map((o) => ({ t: o.t, v: o.close }));
}

export async function cryptoRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const db = ctx.db;
  const now = () => ctx.clock().getTime();
  const mod = () => {
    if (!ctx.crypto) throw unavailable('The digital-assets module is not configured in this environment.');
    return ctx.crypto;
  };

  // ───────────── Overview ─────────────
  app.get('/v1/crypto/overview', async (req) => {
    requireUser(req);
    const g = await db.maybeOne<Record<string, unknown> & { observed_at: string; retrieved_at: string }>(
      `SELECT observed_at, retrieved_at, total_market_cap_usd::float8 AS total_market_cap_usd, total_volume_usd::float8 AS total_volume_usd, market_cap_change_24h_pct::float8 AS market_cap_change_24h_pct,
              btc_dominance_pct::float8 AS btc_dominance_pct, eth_dominance_pct::float8 AS eth_dominance_pct, active_cryptocurrencies, markets FROM crypto.global_snapshots ORDER BY observed_at DESC LIMIT 1`);
    const gHist = await db.query<{ observed_at: string; total_market_cap_usd: number }>(`SELECT observed_at, total_market_cap_usd::float8 AS total_market_cap_usd FROM crypto.global_snapshots WHERE observed_at > $1 ORDER BY observed_at`, [new Date(now() - 7 * DAY).toISOString()]);
    const snap = await db.query<{ canonical_key: string; name: string; symbol: string; image_url: string | null; price: number | null; market_cap: number | null; volume_24h: number | null; change_24h_pct: number | null; change_7d_pct: number | null; market_cap_rank: number | null; provider_updated_at: string | null; retrieved_at: string }>(
      `SELECT a.canonical_key, a.name, a.symbol, a.image_url, m.price::float8 AS price, m.market_cap::float8 AS market_cap, m.volume_24h::float8 AS volume_24h, m.change_24h_pct::float8 AS change_24h_pct,
              m.change_7d_pct::float8 AS change_7d_pct, m.market_cap_rank, m.provider_updated_at, m.retrieved_at
         FROM crypto.market_snapshots m JOIN crypto.assets a USING (asset_id) WHERE m.quote_currency='usd' AND m.source_id='coingecko' AND a.listing_status='listed' ORDER BY m.market_cap_rank NULLS LAST LIMIT 100`);
    const lastRetrieved = snap.reduce<string | null>((a, r) => (!a || r.retrieved_at > a ? r.retrieved_at : a), null);
    // Movers only among assets with meaningful volume, so illiquid outliers do not dominate.
    const liquid = snap.filter((s) => s.change_24h_pct !== null && (s.volume_24h ?? 0) >= 1e6);
    const byChange = [...liquid].sort((a, b) => b.change_24h_pct! - a.change_24h_pct!);
    const defi = await db.maybeOne<{ value: number; observed_on: string }>(`SELECT value::float8 AS value, observed_on FROM crypto.defi_metrics WHERE subject_kind='all' AND metric='tvl' ORDER BY observed_on DESC LIMIT 1`);
    const stable = await db.maybeOne<{ value: number; observed_on: string }>(`SELECT value::float8 AS value, observed_on FROM crypto.defi_metrics WHERE subject_kind='stablecoin' AND metric='stablecoin_supply' ORDER BY observed_on DESC LIMIT 1`);
    const events = await db.query(`SELECT event_id, category, headline, source_id, source_url, published_at, verification FROM crypto.events ORDER BY published_at DESC LIMIT 8`);
    const health = await db.query(`SELECT source_id, provider, health, last_success_at, last_error_at, enabled FROM crypto.sources ORDER BY source_id`);
    const vol = await db.query<{ canonical_key: string; symbol: string; v30: number | null }>(
      `SELECT a.canonical_key, a.symbol, NULL::float8 AS v30 FROM crypto.assets a WHERE a.canonical_key IN ('bitcoin','ethereum')`);
    const volatility = [];
    for (const v of vol) {
      // A 30-day volatility needs about a month of closes; read ~400 days rather than history since 2015.
      const since = now() - 400 * DAY;
      const b = await benchmarkObs(db, v.canonical_key, 'binance', since) ?? await benchmarkObs(db, v.canonical_key, 'coingecko', since);
      const r = b ? A.realisedVol(b, { window: 30 }) : null;
      volatility.push({ key: v.canonical_key, symbol: v.symbol, vol_30d: r && r.ok ? r.value : null, reason: r ? why(r) : 'No stored daily history yet' });
    }
    return {
      data_kinds: DATA_KINDS,
      attribution: 'Market data: Powered by CoinGecko. Venue prices: Binance, Coinbase Exchange. DeFi: DefiLlama.',
      global: g ? { ...g, source_id: 'coingecko', freshness: freshness(g.retrieved_at, 30, now()), note: 'Provider-defined totals across all assets CoinGecko tracks; not computed by ATLAS from a sample.' } : null,
      global_history_7d: gHist,
      snapshot: { retrieved_at: lastRetrieved, freshness: freshness(lastRetrieved, 30, now()), count: snap.length, source_id: 'coingecko' },
      majors: snap.filter((s) => ['bitcoin', 'ethereum'].includes(s.canonical_key)),
      gainers: byChange.slice(0, 8),
      losers: byChange.slice(-8).reverse(),
      heatmap: snap.slice(0, 50),
      volatility,
      defi: { tvl: defi ?? null, stablecoin_supply: stable ?? null, source_id: 'defillama' },
      events,
      sources: health,
      live: ctx.crypto?.live?.snapshot() ?? { state: 'disabled', tickers: [] },
    };
  });

  // ───────────── Asset explorer ─────────────
  const SORTS: Record<string, string> = { rank: 'a.market_cap_rank', name: 'lower(a.name)', price: 'm.price', change_24h: 'm.change_24h_pct', change_7d: 'm.change_7d_pct', market_cap: 'm.market_cap', volume: 'm.volume_24h' };
  app.get('/v1/crypto/assets', async (req) => {
    requireUser(req);
    const q = parse(z.object({
      q: z.string().max(60).optional(), sort: z.enum(Object.keys(SORTS) as [string, ...string[]]).default('rank'), dir: z.enum(['asc', 'desc']).optional(),
      page: z.coerce.number().int().min(1).max(1000).default(1), per: z.coerce.number().int().min(10).max(100).default(50),
      classification: z.enum(['native_coin', 'token', 'unknown']).optional(), status: z.enum(['listed', 'all']).default('listed'), watchlist: z.enum(['true', 'false']).optional(),
    }), req.query);
    const dir = q.dir ?? (q.sort === 'rank' || q.sort === 'name' ? 'asc' : 'desc');
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.q) {
      params.push(`%${q.q.toLowerCase()}%`, q.q.toLowerCase());
      where.push(`(lower(a.name) LIKE $${params.length - 1} OR lower(a.symbol) = $${params.length} OR a.canonical_key LIKE $${params.length - 1})`);
    }
    if (q.classification) { params.push(q.classification); where.push(`a.classification = $${params.length}`); }
    if (q.status === 'listed') where.push(`a.listing_status='listed'`);
    if (q.watchlist === 'true') { params.push(req.user!.userId); where.push(`EXISTS (SELECT 1 FROM crypto.watchlist_items w WHERE w.asset_id=a.asset_id AND w.user_id=$${params.length})`); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM crypto.assets a ${w}`, params)).n;
    const rows = await db.query(
      `SELECT a.canonical_key, a.name, a.symbol, a.image_url, a.classification, a.category, a.primary_network_id, a.listing_status, a.market_cap_rank,
              m.price::float8 AS price, m.change_24h_pct::float8 AS change_24h_pct, m.change_7d_pct::float8 AS change_7d_pct, m.market_cap::float8 AS market_cap, m.volume_24h::float8 AS volume_24h,
              m.fully_diluted_valuation::float8 AS fdv, m.provider_updated_at, m.retrieved_at,
              s.circulating_supply::float8 AS circulating_supply, s.max_supply::float8 AS max_supply,
              (SELECT count(*)::int FROM crypto.price_series ps WHERE ps.asset_id=a.asset_id AND ps.observations > 0) AS history_series,
              (SELECT array_agg(DISTINCT tc.network_id) FROM crypto.token_contracts tc WHERE tc.asset_id=a.asset_id) AS networks
         FROM crypto.assets a
         LEFT JOIN crypto.market_snapshots m ON m.asset_id=a.asset_id AND m.source_id='coingecko' AND m.quote_currency='usd'
         LEFT JOIN LATERAL (SELECT circulating_supply, max_supply FROM crypto.supply_snapshots x WHERE x.asset_id=a.asset_id ORDER BY observed_on DESC LIMIT 1) s ON true
         ${w} ORDER BY ${SORTS[q.sort]} ${dir} NULLS LAST, a.canonical_key LIMIT ${q.per} OFFSET ${(q.page - 1) * q.per}`, params);
    return { total, page: q.page, per: q.per, sort: q.sort, dir, rows, source_id: 'coingecko', data_kind: 'reference', note: 'Listing in a provider database does not make an asset legitimate, safe or liquid.' };
  });

  // ───────────── Asset detail ─────────────
  app.get('/v1/crypto/assets/:key', async (req) => {
    const user = requireUser(req);
    const { key } = parse(keyParam, req.params);
    let a = await assetByKey(db, key);
    // On-demand metadata for an asset nobody has opened yet (one bounded request; failures are reported, not hidden).
    let metadataError: string | null = null;
    const budget = ctx.crypto?.rt.client.budgetState('coingecko');
    if (!a.description && ctx.crypto?.rt.settings.ingestion && budget && (budget.remaining < 2 || budget.backoff_ms > 0)) {
      // Never make a page wait for a provider slot; the scheduler fills metadata in the background.
      metadataError = 'Description not loaded yet: the CoinGecko request budget is reserved for scheduled refreshes. It will be filled automatically.';
    } else if (!a.description && ctx.crypto?.rt.settings.ingestion) {
      const r = await runJob(ctx.crypto.rt, 'coingecko', 'asset_details', 'manual', (job) => syncDetails(ctx.crypto!.rt, job, 1, key)).catch((e) => ({ error: (e as Error).message, status: 'failed' }));
      if (r.status === 'failed') metadataError = r.error ?? 'metadata request failed';
      a = await assetByKey(db, key);
    }
    const snaps = await db.query(`SELECT quote_currency, price::float8 AS price, market_cap::float8 AS market_cap, fully_diluted_valuation::float8 AS fdv, volume_24h::float8 AS volume_24h, high_24h::float8 AS high_24h, low_24h::float8 AS low_24h,
        change_24h_pct::float8 AS change_24h_pct, change_7d_pct::float8 AS change_7d_pct, change_30d_pct::float8 AS change_30d_pct, ath::float8 AS ath, ath_at, market_cap_rank, provider_updated_at, retrieved_at, source_id
        FROM crypto.market_snapshots WHERE asset_id=$1`, [a.asset_id]);
    const supply = await db.query(`SELECT observed_on, circulating_supply::float8 AS circulating_supply, total_supply::float8 AS total_supply, max_supply::float8 AS max_supply, methodology, validation, validation_note, provider_updated_at, retrieved_at, source_id
        FROM crypto.supply_snapshots WHERE asset_id=$1 ORDER BY observed_on DESC LIMIT 400`, [a.asset_id]);
    const contracts = await db.query(`SELECT c.network_id, n.name AS network, n.explorer_url, c.address, c.decimals, c.verification, c.source_id, c.verified_at FROM crypto.token_contracts c JOIN crypto.networks n USING (network_id) WHERE c.asset_id=$1 ORDER BY c.network_id`, [a.asset_id]);
    const providerIds = await db.query(`SELECT provider, external_id, verified_by, verified_at FROM crypto.asset_provider_ids WHERE asset_id=$1`, [a.asset_id]);
    const pairs = await db.query(`SELECT p.exchange_id, e.name AS exchange, p.product_id, p.base_symbol, p.quote_symbol, p.status, p.tradable, p.price_increment, p.mapping_source, p.verified_at
        FROM crypto.market_pairs p JOIN crypto.exchanges e USING (exchange_id) WHERE p.base_asset_id=$1 ORDER BY p.exchange_id, p.quote_symbol`, [a.asset_id]);
    const series = (await seriesFor(db, a.asset_id)).map((s) => ({ ...s, label: seriesLabel(s) }));
    const events = await db.query(`SELECT event_id, category, headline, source_id, source_url, published_at, event_at, verification FROM crypto.events WHERE $1 = ANY(asset_ids) OR $2 = ANY(network_ids) ORDER BY published_at DESC LIMIT 20`, [a.asset_id, a.canonical_key]);
    const protocols = await db.query(`SELECT protocol_id, name, category, tvl_usd::float8 AS tvl_usd, retrieved_at FROM crypto.protocols WHERE asset_id=$1`, [a.asset_id]);
    const network = a.primary_network_id ? await db.maybeOne(`SELECT network_id, name, family, chain_id, capabilities FROM crypto.networks WHERE network_id=$1`, [a.primary_network_id]) : null;
    const watch = await db.maybeOne(`SELECT added_at FROM crypto.watchlist_items WHERE user_id=$1 AND asset_id=$2`, [user.userId, a.asset_id]);
    const usd = snaps.find((s) => s.quote_currency === 'usd') as { retrieved_at?: string } | undefined;
    return {
      asset: a, network, snapshots: snaps, snapshot_freshness: freshness(usd?.retrieved_at ?? null, 30, now()), supply_latest: supply[0] ?? null, supply_history: supply.slice().reverse(), contracts, provider_ids: providerIds, pairs, series, events, protocols,
      watchlisted: !!watch, metadata_error: metadataError, data_kinds: DATA_KINDS, attribution: 'Powered by CoinGecko',
      panels: { tokenomics: supply.length > 0, onchain: !!network && ['bitcoin', 'ethereum'].includes(network.network_id as string), defi: protocols.length > 0, pairs: pairs.length > 0, history: series.length > 0 },
    };
  });

  app.get('/v1/crypto/assets/:key/history', async (req) => {
    requireUser(req);
    const { key } = parse(keyParam, req.params);
    const q = parse(z.object({ series: z.string().uuid().optional(), range: z.enum(['30', '90', '365', '1095', 'max']).default('365') }), req.query);
    const a = await assetByKey(db, key);
    const s = await pickSeries(db, a.asset_id, q.series);
    if (!s) return { asset: a.canonical_key, series: null, observations: [], gaps: [], note: 'No stored daily history for this asset yet. History is imported for the highest-ranked assets first.' };
    const all = await observations(db, s.series_id);
    const last = all[all.length - 1]?.t ?? now();
    const from = q.range === 'max' ? -Infinity : last - (Number(q.range) - 1) * DAY;
    const obs = all.filter((o) => o.t >= from);
    const gaps = obs.length > 1 ? (await import('./validate.js')).findGaps(obs.map((o) => o.t), DAY) : [];
    return {
      asset: a.canonical_key, series: { ...s, label: seriesLabel(s), data_kind: s.kind === 'reference_close' ? 'reference' : 'venue' }, range: q.range,
      observations: obs.map((o) => ({ t: new Date(o.t).toISOString(), open: o.open, high: o.high, low: o.low, close: o.close, volume: o.volume, market_cap: o.market_cap, validation: o.validation })),
      gaps: gaps.map((g) => ({ from: new Date(g.from).toISOString().slice(0, 10), to: new Date(g.to).toISOString().slice(0, 10), missing_days: g.missing })),
      coverage: { first: s.first_open_time, last: s.last_open_time, observations: s.observations, backfill_complete: s.backfill_complete },
      suspect: obs.filter((o) => o.validation === 'suspect').length,
    };
  });

  app.get('/v1/crypto/assets/:key/analytics', async (req) => {
    requireUser(req);
    const { key } = parse(keyParam, req.params);
    const q = parse(z.object({ series: z.string().uuid().optional() }), req.query);
    const a = await assetByKey(db, key);
    const s = await pickSeries(db, a.asset_id, q.series);
    if (!s) return { asset: a.canonical_key, series: null, note: 'No stored daily history for this asset yet.', formulas: FORMULAS };
    const raw = await observations(db, s.series_id);
    const obs: A.Obs[] = raw.map((o) => ({ t: o.t, v: o.close }));
    const returns = Object.fromEntries([1, 7, 30, 90, 365].map((d) => {
      const r = A.periodReturn(obs, d);
      return [`${d}d`, r.ok ? { value: r.value, from: new Date(r.start.t).toISOString().slice(0, 10), to: new Date(r.end.t).toISOString().slice(0, 10), days_actual: r.days_actual } : { value: null, reason: why(r) }];
    }));
    const v30 = A.realisedVol(obs, { window: 30 });
    const v90 = A.realisedVol(obs, { window: 90 });
    const dd = A.drawdowns(obs);
    const dist = A.distribution(obs);
    const reg = A.regimes(obs);
    const vt = A.volumeTrend(raw.map((o) => o.volume));
    const corr: Record<string, unknown> = {};
    for (const bench of ['bitcoin', 'ethereum']) {
      if (bench === a.canonical_key) continue;
      const b = await benchmarkObs(db, bench, s.source_id);
      if (!b) { corr[bench] = { value: null, reason: `No ${bench} series from ${s.source_id} to align with` }; continue; }
      const c = A.correlation(obs, b, { window: 90 });
      const be = A.beta(obs, b, { window: 365 });
      corr[bench] = { value: c.ok ? c.value : null, n: c.ok ? c.n : null, reason: why(c), beta_365d: be.ok ? be.value : null, beta_reason: why(be), rolling_90d: A.rollingCorrelation(obs, b, 90).filter((_, i, arr) => i % 3 === 0 || i === arr.length - 1).map((x) => ({ t: new Date(x.t).toISOString().slice(0, 10), v: x.v })) };
    }
    const thin = <T extends { t: number }>(xs: T[], n = 400) => xs.filter((_, i) => i % Math.max(1, Math.ceil(xs.length / n)) === 0 || i === xs.length - 1);
    const ann = (r: A.Result<{ value: number; returns_used: number; window: number; annualisation: number }>) => (r.ok ? { value: r.value, returns_used: r.returns_used, window: r.window, annualisation: `√${r.annualisation}` } : { value: null, reason: why(r) });
    return {
      asset: a.canonical_key, series: { ...s, label: seriesLabel(s) }, calculated_at: new Date(now()).toISOString(), last_observation: s.last_open_time, data_kind: 'derived',
      returns, volatility: { '30d': ann(v30), '90d': ann(v90), rolling_30d: thin(A.rollingVol(obs, { window: 30 })).map((x) => ({ t: new Date(x.t).toISOString().slice(0, 10), v: x.v })) },
      drawdown: dd.ok ? { current: dd.current_drawdown, max: dd.max_drawdown, peak: { t: new Date(dd.peak.t).toISOString().slice(0, 10), v: dd.peak.v }, max_peak: new Date(dd.max_dd_peak.t).toISOString().slice(0, 10), max_trough: new Date(dd.max_dd_trough.t).toISOString().slice(0, 10), recovery: dd.max_dd_recovery ? new Date(dd.max_dd_recovery.t).toISOString().slice(0, 10) : null, recovery_days: dd.recovery_days, days_since_peak: dd.days_since_peak, series: thin(dd.series).map((x) => ({ t: new Date(x.t).toISOString().slice(0, 10), v: x.dd })) } : { reason: why(dd) },
      distribution: dist.ok ? { ...dist, worst: { t: new Date(dist.worst.t).toISOString().slice(0, 10), r: dist.worst.r }, best: { t: new Date(dist.best.t).toISOString().slice(0, 10), r: dist.best.r } } : { reason: why(dist) },
      regime: reg.ok ? { current: reg.current, share: reg.share, median_vol: reg.median_vol, recent_segments: reg.segments.slice(-12).map((x) => ({ from: new Date(x.from).toISOString().slice(0, 10), to: new Date(x.to).toISOString().slice(0, 10), regime: x.regime })) } : { reason: why(reg) },
      volume_trend: vt.ok ? vt : { reason: why(vt) },
      correlation: corr,
      formulas: FORMULAS,
      caveats: ['Results describe stored history only and do not predict future prices.', 'Correlation does not establish causation.', s.kind === 'venue_candle' ? 'Venue-specific series: another exchange or quote currency can differ.' : 'Reference series: CoinGecko aggregate across venues; 365 days available on the free tier.'],
    };
  });

  // ───────────── Research: correlation matrix, backtest, cross-asset ─────────────
  app.get('/v1/crypto/research/correlation', async (req) => {
    requireUser(req);
    const q = parse(z.object({ keys: z.string().max(600), window: z.coerce.number().int().refine((n) => [30, 90, 180, 365].includes(n)).default(90), source: z.enum(['coingecko', 'binance', 'coinbase']).default('coingecko') }), req.query);
    const keys = [...new Set(q.keys.split(',').map((k) => k.trim()).filter(Boolean))].slice(0, 12);
    if (keys.length < 2) throw badRequest('Choose at least two assets.');
    const series: { key: string; obs: A.Obs[] | null }[] = [];
    for (const k of keys) series.push({ key: k, obs: await benchmarkObs(db, k, q.source) });
    const matrix = series.map((a) => series.map((b) => {
      if (!a.obs || !b.obs) return { value: null, n: 0, reason: 'No stored series from this source' };
      if (a.key === b.key) return { value: 1, n: null, reason: null };
      const c = A.correlation(a.obs, b.obs, { window: q.window });
      return c.ok ? { value: c.value, n: c.n, reason: null } : { value: null, n: (c as A.Insufficient).available, reason: why(c) };
    }));
    return { keys, source: q.source, window_days: q.window, matrix, missing: series.filter((s) => !s.obs).map((s) => s.key), method: FORMULAS.find((f) => f.code === 'correlation'), caveat: 'All series come from the same source so that observation times align. Correlation does not establish causation.' };
  });

  app.post('/v1/crypto/research/backtest', async (req) => {
    requireUser(req);
    const b = parse(z.object({ key: z.string().regex(/^[a-z0-9._-]+$/), series: z.string().uuid().optional(), fast: z.number().int().min(2).max(100), slow: z.number().int().min(3).max(400), fee_bps: z.number().min(0).max(200), slippage_bps: z.number().min(0).max(200) }), req.body);
    const a = await assetByKey(db, b.key);
    const s = await pickSeries(db, a.asset_id, b.series);
    if (!s) throw badRequest('No stored daily history for this asset.');
    const obs = (await observations(db, s.series_id)).map((o) => ({ t: o.t, v: o.close }));
    const r = A.backtestSma(obs, { fast: b.fast, slow: b.slow, fee_bps: b.fee_bps, slippage_bps: b.slippage_bps });
    if (!r.ok) throw badRequest(r.reason);
    const thin = (xs: { t: number; v: number }[]) => xs.filter((_, i) => i % Math.max(1, Math.ceil(xs.length / 500)) === 0 || i === xs.length - 1).map((x) => ({ t: new Date(x.t).toISOString().slice(0, 10), v: x.v }));
    return { asset: a.canonical_key, series: { ...s, label: seriesLabel(s) }, ...r, strategy: thin(r.strategy), buy_hold: thin(r.buy_hold), data_kind: 'derived', disclaimer: 'Educational backtest on stored history. Not a recommendation, and historical performance does not predict future results.' };
  });

  app.get('/v1/crypto/research/cross-asset', async (req) => {
    const user = requireUser(req);
    const q = parse(z.object({ key: z.string().regex(/^[a-z0-9._-]+$/), dataset: z.string().uuid().optional() }), req.query);
    const datasets = await db.query<{ dataset_id: string; name: string; instrument_label: string; currency: string; first_date: string | null; last_date: string | null; rows_valid: number }>(
      `SELECT dataset_id, name, instrument_label, currency, first_date, last_date, rows_valid FROM app.user_datasets WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC`, [user.userId]);
    const base = { datasets, synthetic_equities_excluded: true, policy: 'ATLAS equity data in this environment is synthetic, so it is never compared with real crypto prices. Cross-asset analysis uses a price file you uploaded and are entitled to use (Research → Datasets).' };
    if (!q.dataset) return { ...base, result: null };
    const d = datasets.find((x) => x.dataset_id === q.dataset);
    if (!d) throw notFound('No such dataset.');
    const a = await assetByKey(db, q.key);
    const s = await pickSeries(db, a.asset_id);
    if (!s) return { ...base, result: null, reason: 'No stored crypto history for this asset.' };
    const crypto = (await observations(db, s.series_id)).map((o) => ({ t: o.t, v: o.close }));
    const eq = (await db.query<{ trade_date: string; close: number }>(`SELECT trade_date, close::float8 AS close FROM app.user_dataset_prices WHERE dataset_id=$1 ORDER BY trade_date`, [d.dataset_id])).map((r) => ({ t: Date.parse(`${r.trade_date}T00:00:00Z`), v: r.close }));
    const aligned = A.alignToSessions(eq, crypto);
    const c = A.sessionCorrelation(aligned);
    const eqVol = A.realisedVol(eq.filter((o) => aligned.some((x) => x.t === Math.floor(o.t / DAY) * DAY)), { window: 365, annualisation: 252, minCoverage: 0.5 });
    return {
      ...base,
      result: {
        crypto_series: seriesLabel(s), dataset: d, aligned_sessions: aligned.length, from: aligned[0] ? new Date(aligned[0].t).toISOString().slice(0, 10) : null, to: aligned.length ? new Date(aligned[aligned.length - 1]!.t).toISOString().slice(0, 10) : null,
        correlation: c.ok ? c.value : null, n: c.ok ? c.n : null, reason: why(c), equity_note: eqVol.ok ? null : why(eqVol),
        method: 'For each session date in your file, the crypto daily observation stamped with the same UTC date is used; crypto days with no session (weekends, holidays) are dropped, so both return series cover the same session-to-session intervals. Crypto daily observations are stamped in UTC while Indian sessions close at 15:30 IST (10:00 UTC), so the two closes are about 14 hours apart. Quote currencies differ (crypto in USD/USDT, your file in ' + d.currency + '); no FX conversion is applied, so currency moves are part of the measured relationship.',
      },
    };
  });

  // ───────────── DeFi ─────────────
  app.get('/v1/crypto/defi', async (req) => {
    requireUser(req);
    const q = parse(z.object({ page: z.coerce.number().int().min(1).max(30).default(1), category: z.string().max(60).optional(), q: z.string().max(60).optional() }), req.query);
    const params: unknown[] = [];
    const where = ['tvl_rank IS NOT NULL'];
    if (q.category) { params.push(q.category); where.push(`category = $${params.length}`); }
    if (q.q) { params.push(`%${q.q.toLowerCase()}%`); where.push(`lower(name) LIKE $${params.length}`); }
    const total = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM crypto.protocols WHERE ${where.join(' AND ')}`, params)).n;
    const rows = await db.query(`SELECT protocol_id, name, category, chains, tvl_usd::float8 AS tvl_usd, change_1d_pct::float8 AS change_1d_pct, change_7d_pct::float8 AS change_7d_pct, tvl_rank, retrieved_at,
        (SELECT count(*)::int FROM crypto.defi_metrics m WHERE m.subject_kind='protocol' AND m.subject_id=p.protocol_id) AS history_points
        FROM crypto.protocols p WHERE ${where.join(' AND ')} ORDER BY tvl_rank LIMIT 50 OFFSET ${(q.page - 1) * 50}`, params);
    const categories = await db.query(`SELECT category, count(*)::int AS n, sum(tvl_usd)::float8 AS tvl FROM crypto.protocols WHERE tvl_rank IS NOT NULL AND category IS NOT NULL GROUP BY category ORDER BY tvl DESC LIMIT 20`);
    const series = async (kind: string, id: string, metric: string) => db.query(`SELECT observed_on AS t, value::float8 AS v FROM crypto.defi_metrics WHERE subject_kind=$1 AND subject_id=$2 AND metric=$3 AND observed_on > current_date - 730 ORDER BY observed_on`, [kind, id, metric]);
    const chains = [];
    for (const c of ['Ethereum', 'Solana', 'Bitcoin', 'Arbitrum', 'Base']) {
      const s = await series('chain', c, 'tvl');
      chains.push({ chain: c, latest: s[s.length - 1] ?? null, points: s.length });
    }
    const last = rows[0] as { retrieved_at?: string } | undefined;
    return {
      total, page: q.page, rows, categories, chains, all_tvl: await series('all', 'defi', 'tvl'), stablecoin_supply: await series('stablecoin', 'all', 'stablecoin_supply'),
      freshness: freshness(last?.retrieved_at ?? null, 12 * 60, now()), source_id: 'defillama', attribution: 'DefiLlama',
      methodology: 'TVL, fees and revenue are DefiLlama definitions computed by its open-source adapters. Chain and all-DeFi TVL exclude liquid staking and double-counted TVL (DefiLlama defaults). These figures are not comparable with other providers\' numbers and should not be summed across protocols that deposit into each other.',
    };
  });

  app.get('/v1/crypto/defi/:id', async (req) => {
    requireUser(req);
    const { id } = parse(z.object({ id: z.string().min(1).max(120).regex(/^[a-z0-9._-]+$/) }), req.params);
    const p = await db.maybeOne(`SELECT p.*, p.tvl_usd::float8 AS tvl_usd, p.change_1d_pct::float8 AS change_1d_pct, p.change_7d_pct::float8 AS change_7d_pct, a.canonical_key AS asset_key, a.symbol AS asset_symbol FROM crypto.protocols p LEFT JOIN crypto.assets a USING (asset_id) WHERE protocol_id=$1`, [id]);
    if (!p) throw notFound('No such protocol in the stored DefiLlama list.');
    const m = async (metric: string) => db.query(`SELECT observed_on AS t, value::float8 AS v FROM crypto.defi_metrics WHERE subject_kind='protocol' AND subject_id=$1 AND metric=$2 ORDER BY observed_on`, [id, metric]);
    const [tvl, fees, revenue] = [await m('tvl'), await m('fees'), await m('revenue')];
    return {
      protocol: p, tvl, fees, revenue,
      availability: { tvl: tvl.length ? 'stored' : 'not imported (history is imported for the top protocols by TVL)', fees: fees.length ? 'stored' : 'not available from DefiLlama for this protocol, or not imported', revenue: revenue.length ? 'stored' : 'not available from DefiLlama for this protocol, or not imported' },
      definitions: { tvl: 'Total value locked: value of assets deposited in the protocol\'s contracts, priced by DefiLlama (USD).', fees: 'Fees: total fees paid by users of the protocol per day (DefiLlama dimension "dailyFees").', revenue: 'Revenue: the part of fees kept by the protocol or its token holders per day (DefiLlama "dailyRevenue"). Definitions vary by protocol adapter.' },
      source_id: 'defillama', source_url: `https://defillama.com/protocol/${encodeURIComponent(id)}`,
    };
  });

  // ───────────── On-chain ─────────────
  app.get('/v1/crypto/onchain', async (req) => {
    requireUser(req);
    const nets = await db.query<{ network_id: string; name: string; family: string; chain_id: number | null; source_id: string | null; explorer_url: string | null; capabilities: string[] }>(`SELECT network_id, name, family, chain_id, source_id, explorer_url, capabilities FROM crypto.networks ORDER BY network_id`);
    const out = [];
    for (const n of nets) {
      const blocks = await db.query(`SELECT height, block_hash, block_time, tx_count, size_bytes, gas_used::float8 AS gas_used, gas_limit::float8 AS gas_limit, base_fee_gwei::float8 AS base_fee_gwei, total_fees_native::float8 AS total_fees_native, producer, retrieved_at
          FROM crypto.onchain_blocks WHERE network_id=$1 ORDER BY height DESC LIMIT 25`, [n.network_id]);
      const coverage = await db.maybeOne<{ n: number; lo: number | null; hi: number | null; oldest: string | null }>(`SELECT count(*)::int AS n, min(height)::float8 AS lo, max(height)::float8 AS hi, min(block_time) AS oldest FROM crypto.onchain_blocks WHERE network_id=$1`, [n.network_id]);
      const metrics = await db.query(`SELECT DISTINCT ON (metric) metric, value::float8 AS value, unit, window_desc, methodology, observed_at, source_id FROM crypto.onchain_metrics WHERE network_id=$1 ORDER BY metric, observed_at DESC`, [n.network_id]);
      const latest = blocks[0] as { block_time?: string } | undefined;
      out.push({ ...n, blocks, coverage, metrics, freshness: freshness(latest?.block_time ?? null, n.network_id === 'bitcoin' ? 60 : 10, now()), supported: n.capabilities.length > 0 });
    }
    return { networks: out, scope: 'Recent blocks only, from free public endpoints. This is not a full explorer or an archive: ATLAS keeps a rolling window of about 500 blocks per network and does not index token transfers or addresses. Solana is not covered yet.' };
  });

  app.get('/v1/crypto/onchain/:network/blocks/:height', async (req) => {
    requireUser(req);
    const p = parse(z.object({ network: z.enum(['bitcoin', 'ethereum']), height: z.coerce.number().int().min(0) }), req.params);
    const b = await db.maybeOne(`SELECT b.*, gas_used::float8 AS gas_used, gas_limit::float8 AS gas_limit, base_fee_gwei::float8 AS base_fee_gwei, total_fees_native::float8 AS total_fees_native, n.explorer_url FROM crypto.onchain_blocks b JOIN crypto.networks n USING (network_id) WHERE network_id=$1 AND height=$2`, [p.network, p.height]);
    if (!b) throw notFound('That block is not in ATLAS\'s stored window. Use the network\'s public explorer for older blocks.');
    return { block: b };
  });

  // ───────────── Events, live feed, sources ─────────────
  app.get('/v1/crypto/events', async (req) => {
    requireUser(req);
    const q = parse(z.object({ category: z.string().max(40).optional(), page: z.coerce.number().int().min(1).max(100).default(1) }), req.query);
    const params: unknown[] = [];
    let w = '';
    if (q.category) { params.push(q.category); w = `WHERE e.category=$1`; }
    const rows = await db.query(`SELECT e.event_id, e.category, e.headline, e.summary, e.source_id, s.provider, e.source_url, e.published_at, e.event_at, e.retrieved_at, e.verification, e.network_ids,
        (SELECT array_agg(a.canonical_key) FROM crypto.assets a WHERE a.asset_id = ANY(e.asset_ids)) AS assets
        FROM crypto.events e JOIN crypto.sources s USING (source_id) ${w} ORDER BY e.published_at DESC LIMIT 50 OFFSET ${(q.page - 1) * 50}`, params);
    return { rows, scope: 'Official client releases (GitHub: Bitcoin Core, Geth, Agave), Ethereum Foundation blog posts, and exchange pair status changes observed by ATLAS. This is not a general crypto news feed. Times are the source\'s publication times; "observed by ATLAS" events are dated when ATLAS noticed them.' };
  });

  app.get('/v1/crypto/live', async (req) => {
    requireUser(req);
    const live = ctx.crypto?.live;
    if (!live) return { state: 'disabled', tickers: [], note: 'The live feed is turned off (CRYPTO_LIVE_FEED=false) or not available in this environment.' };
    const snap = live.snapshot();
    const pairs = await db.query<{ product_id: string; canonical_key: string; name: string }>(`SELECT p.product_id, a.canonical_key, a.name FROM crypto.market_pairs p JOIN crypto.assets a ON a.asset_id=p.base_asset_id WHERE p.exchange_id='binance' AND p.product_id = ANY($1)`, [snap.symbols]);
    const map = new Map(pairs.map((p) => [p.product_id, p]));
    return { ...snap, tickers: snap.tickers.map((t) => ({ ...t, asset: map.get(t.product_id) ?? null })), data_kind: 'venue', note: 'Binance spot prices for these pairs only (quoted in USDT). Shown as live only while messages arrive; otherwise marked stale.' };
  });

  app.get('/v1/crypto/sources', async (req) => {
    const viewer = requireUser(req);
    const ops = isOperator(viewer);
    const sources = await db.query(`SELECT s.*, u.requests AS requests_today, u.errors AS errors_today, u.rate_limited AS rate_limited_today, u.cache_hits AS cache_hits_today, u.refused_budget AS refused_today
        FROM crypto.sources s LEFT JOIN crypto.request_usage u ON u.source_id=s.source_id AND u.day=$1 ORDER BY s.category, s.source_id`, [new Date(now()).toISOString().slice(0, 10)]);
    const last = await lastRuns(db);
    const jobs = JOBS.map((j) => {
      const l = last.get(j.type);
      return { type: j.type, source: j.source, every_minutes: j.everyMs / 60_000, freshness_minutes: j.freshnessMinutes, last_started: l?.started_at ?? null, last_status: l?.status ?? null, last_success: l?.last_success ?? null, freshness: freshness(l?.last_success ?? null, j.freshnessMinutes, now()) };
    });
    const coverage = await db.one(`SELECT (SELECT count(*)::int FROM crypto.assets WHERE listing_status='listed') AS assets_listed, (SELECT count(*)::int FROM crypto.assets) AS assets_total,
        (SELECT count(*)::int FROM crypto.market_pairs) AS pairs, (SELECT count(*)::int FROM crypto.price_series WHERE observations > 0) AS series, (SELECT count(*)::int FROM crypto.ohlcv) AS observations,
        (SELECT count(*)::int FROM crypto.ohlcv WHERE validation='suspect') AS suspect_observations, (SELECT min(open_time) FROM crypto.ohlcv) AS earliest_observation,
        (SELECT count(*)::int FROM crypto.supply_snapshots) AS supply_snapshots, (SELECT count(*)::int FROM crypto.protocols) AS protocols, (SELECT count(*)::int FROM crypto.defi_metrics) AS defi_points,
        (SELECT count(*)::int FROM crypto.onchain_blocks) AS blocks, (SELECT count(*)::int FROM crypto.events) AS events, (SELECT count(*)::int FROM crypto.quarantine) AS quarantined,
        (SELECT count(*)::int FROM crypto.token_contracts) AS contracts`);
    const seriesCoverage = await db.query(`SELECT s.source_id, s.quote_currency, count(*)::int AS series, sum(s.observations)::int AS observations, min(s.first_open_time) AS earliest, max(s.last_open_time) AS latest, count(*) FILTER (WHERE s.backfill_complete)::int AS complete
        FROM crypto.price_series s WHERE s.observations > 0 GROUP BY s.source_id, s.quote_currency ORDER BY s.source_id`);
    const failures = await db.query(`SELECT job_id, job_type, source_id, started_at, finished_at, error FROM crypto.ingestion_jobs WHERE status='failed' ORDER BY started_at DESC LIMIT 10`);
    const quarantine = await db.query(`SELECT dataset, record_key, reasons, created_at, source_id FROM crypto.quarantine ORDER BY created_at DESC LIMIT 15`);
    const budgets = Object.fromEntries((sources as { source_id: string }[]).map((s) => [s.source_id, ctx.crypto?.rt.client.budgetState(s.source_id) ?? null]));
    // Customers see sources, attribution, freshness and coverage; request counts, error text, quarantine
    // and budgets are operator diagnostics.
    const publicSources = ops ? sources : (sources as Record<string, unknown>[]).map(({ requests_today, errors_today, rate_limited_today, cache_hits_today, refused_today, last_error, last_error_at, consecutive_failures, budget_per_minute, ...rest }) => rest);
    return { sources: publicSources, jobs, coverage, series_coverage: seriesCoverage, recent_failures: ops ? failures : [], quarantine: ops ? quarantine : [], budgets: ops ? budgets : {}, diagnostics_visible: ops, live: ctx.crypto?.live?.snapshot() ?? null, ingestion_enabled: !!ctx.crypto?.rt.settings.ingestion, coingecko_key_configured: !!ctx.crypto?.rt.settings.coingeckoDemoKey };
  });

  // ───────────── Watchlist and notes (private to the user) ─────────────
  app.get('/v1/crypto/watchlist', async (req) => {
    const u = requireUser(req);
    return { rows: await db.query(`SELECT a.canonical_key, a.name, a.symbol, w.added_at, m.price::float8 AS price, m.change_24h_pct::float8 AS change_24h_pct, m.retrieved_at FROM crypto.watchlist_items w JOIN crypto.assets a USING (asset_id)
        LEFT JOIN crypto.market_snapshots m ON m.asset_id=a.asset_id AND m.quote_currency='usd' AND m.source_id='coingecko' WHERE w.user_id=$1 ORDER BY w.added_at`, [u.userId]) };
  });
  app.post('/v1/crypto/watchlist', async (req) => {
    const u = requireUser(req);
    const b = parse(z.object({ key: z.string().regex(/^[a-z0-9._-]+$/).max(120) }), req.body);
    const a = await assetByKey(db, b.key);
    const n = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM crypto.watchlist_items WHERE user_id=$1`, [u.userId])).n;
    if (n >= 200) throw badRequest('A watchlist can hold up to 200 assets.');
    await db.query(`INSERT INTO crypto.watchlist_items (user_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [u.userId, a.asset_id]);
    return { ok: true };
  });
  app.delete('/v1/crypto/watchlist/:key', async (req) => {
    const u = requireUser(req);
    const { key } = parse(keyParam, req.params);
    const a = await assetByKey(db, key);
    await db.query(`DELETE FROM crypto.watchlist_items WHERE user_id=$1 AND asset_id=$2`, [u.userId, a.asset_id]);
    return { ok: true };
  });
  app.get('/v1/crypto/assets/:key/notes', async (req) => {
    const u = requireUser(req);
    const { key } = parse(keyParam, req.params);
    const a = await assetByKey(db, key);
    return { rows: await db.query(`SELECT note_id, body, created_at, updated_at FROM crypto.research_notes WHERE user_id=$1 AND asset_id=$2 ORDER BY created_at DESC LIMIT 100`, [u.userId, a.asset_id]) };
  });
  app.post('/v1/crypto/assets/:key/notes', async (req) => {
    const u = requireUser(req);
    const { key } = parse(keyParam, req.params);
    const b = parse(z.object({ body: z.string().trim().min(1).max(10000) }), req.body);
    const a = await assetByKey(db, key);
    return db.one(`INSERT INTO crypto.research_notes (user_id, asset_id, body) VALUES ($1,$2,$3) RETURNING note_id, body, created_at`, [u.userId, a.asset_id, b.body]);
  });
  app.delete('/v1/crypto/notes/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const r = await db.query(`DELETE FROM crypto.research_notes WHERE note_id=$1 AND user_id=$2 RETURNING note_id`, [id, u.userId]);
    if (!r.length) throw notFound('No such note.');
    return { ok: true };
  });

  // ───────────── Admin: manual runs and source control (admin or data_ops with two-step verification) ─────────────
  app.post('/admin/v1/crypto/jobs/:type/run', { config: { rateLimit: { limit: 20, windowMs: 60_000, key: 'user' } } }, async (req) => {
    requireRole(req, ['admin', 'data_ops']);
    const { type } = parse(z.object({ type: z.string().regex(/^[a-z_]+$/) }), req.params);
    if (!JOBS.some((j) => j.type === type)) throw notFound('No such job.');
    return runNamed(mod().rt, type, 'manual');
  });
  app.get('/admin/v1/crypto/jobs', async (req) => {
    requireRole(req, ['admin', 'data_ops', 'support']);
    return { rows: await db.query(`SELECT job_id, source_id, job_type, trigger, status, started_at, fetched_at, validated_at, persisted_at, reconciled_at, finished_at, requests, records_fetched, records_valid, records_persisted, records_quarantined, error, detail FROM crypto.ingestion_jobs ORDER BY started_at DESC LIMIT 100`) };
  });
  app.post('/admin/v1/crypto/sources/:id/:action', async (req) => {
    requireRole(req, ['admin', 'data_ops']);
    const p = parse(z.object({ id: z.string().regex(/^[a-z0-9_]+$/), action: z.enum(['enable', 'disable']) }), req.params);
    const r = await db.query(`UPDATE crypto.sources SET enabled=$2, health=CASE WHEN $2 THEN 'unknown' ELSE 'disabled' END, updated_at=now() WHERE source_id=$1 RETURNING source_id, enabled, health`, [p.id, p.action === 'enable']);
    if (!r.length) throw notFound('No such source.');
    return r[0];
  });
}
