import type { Db } from '../../db/db.js';
import type { Logger } from '../../lib/logger.js';
import { ProviderError, type ProviderClient } from './http.js';
import * as P from './providers.js';
import { PLATFORM_TO_NETWORK } from './registry.js';
import { checkCandle, checkSupply, DAY_MS, dedupeByTime, normaliseAddress, TRANSFORM_VERSION, utcDay, type Candle } from './validate.js';

// Ingestion jobs. Each job records its stages separately (started → fetched → validated → persisted →
// reconciled → finished), so "the job started" is never confused with "data was stored". Writes are
// idempotent upserts keyed on natural keys; re-running a job never duplicates records.

export interface CryptoSettings {
  coingeckoDemoKey: string;
  /** Assets tracked from the CoinGecko market list (by market cap). */
  universeSize: number;
  /** Assets that get venue candle history (Binance/Coinbase) and 365-day reference history. */
  historyAssets: number;
  /** Max requests a single backfill run may make per venue (bounded batches). */
  backfillRequestsPerRun: number;
  ethereumRpcUrl: string;
  ingestion: boolean;
  liveFeed: boolean;
}

export interface CryptoRuntime {
  db: Db;
  client: ProviderClient;
  settings: CryptoSettings;
  log: Logger;
  now: () => number;
}

/** A job cannot run yet because something it depends on is missing (not a code or provider failure). */
export class PreconditionError extends Error {}

export interface JobResult { job_id: string; job_type: string; status: string; records_persisted: number; error: string | null }

export class Job {
  requests = 0;
  fetched = 0;
  valid = 0;
  persisted = 0;
  quarantined = 0;
  partialErrors: string[] = [];
  detail: Record<string, unknown> = {};
  constructor(readonly rt: CryptoRuntime, readonly id: string, readonly sourceId: string) {}
  private async stage(col: 'fetched_at' | 'validated_at' | 'persisted_at' | 'reconciled_at') {
    await this.rt.db.query(`UPDATE crypto.ingestion_jobs SET ${col}=coalesce(${col}, $2) WHERE job_id=$1`, [this.id, new Date(this.rt.now()).toISOString()]);
  }
  markFetched() { return this.stage('fetched_at'); }
  markValidated() { return this.stage('validated_at'); }
  markPersisted() { return this.stage('persisted_at'); }
  markReconciled() { return this.stage('reconciled_at'); }
  async quarantine(dataset: string, key: string, record: unknown, reasons: string[]) {
    this.quarantined++;
    await this.rt.db.query(`INSERT INTO crypto.quarantine (source_id, job_id, dataset, record_key, record, reasons) VALUES ($1,$2,$3,$4,$5,$6)`, [this.sourceId, this.id, dataset, key, JSON.stringify(record), reasons]);
  }
}

export async function runJob(rt: CryptoRuntime, sourceId: string, jobType: string, trigger: 'schedule' | 'manual' | 'startup' | 'test', fn: (job: Job) => Promise<void>): Promise<JobResult> {
  const { job_id } = await rt.db.one<{ job_id: string }>(`INSERT INTO crypto.ingestion_jobs (source_id, job_type, trigger, status, started_at) VALUES ($1,$2,$3,'running',$4) RETURNING job_id`, [sourceId, jobType, trigger, new Date(rt.now()).toISOString()]);
  const job = new Job(rt, job_id, sourceId);
  let status: 'succeeded' | 'partial' | 'failed' = 'succeeded';
  let error: string | null = null;
  try {
    await fn(job);
    if (job.partialErrors.length) {
      status = job.persisted > 0 ? 'partial' : 'failed';
      error = job.partialErrors.slice(0, 5).join(' | ');
    }
  } catch (err) {
    status = 'failed';
    error = err instanceof Error ? err.message : String(err);
    if (!(err instanceof ProviderError) && !(err instanceof PreconditionError)) rt.log.error('crypto job failed', { job: jobType, error, stack: err instanceof Error ? err.stack : undefined });
  }
  const now = new Date(rt.now()).toISOString();
  await rt.db.query(
    `UPDATE crypto.ingestion_jobs SET status=$2, finished_at=$3, requests=$4, records_fetched=$5, records_valid=$6, records_persisted=$7, records_quarantined=$8, error=$9, detail=$10 WHERE job_id=$1`,
    [job_id, status, now, job.requests, job.fetched, job.valid, job.persisted, job.quarantined, error?.slice(0, 2000) ?? null, JSON.stringify(job.detail)],
  );
  if (status !== 'failed' && job.persisted > 0) await rt.db.query(`UPDATE crypto.sources SET last_import_at=$2 WHERE source_id=$1`, [sourceId, now]);
  return { job_id, job_type: jobType, status, records_persisted: job.persisted, error };
}

/** Jobs left 'running' by a crash or hard stop are closed honestly at start-up, not resumed blindly. */
export async function closeInterruptedJobs(db: Db, now: Date): Promise<number> {
  const r = await db.query(`UPDATE crypto.ingestion_jobs SET status='failed', finished_at=$1, error=coalesce(error, 'Interrupted: the API stopped before the job finished') WHERE status='running' RETURNING job_id`, [now.toISOString()]);
  return r.length;
}

const iso = (ms: number) => new Date(ms).toISOString();

// ───────────────────────────── Assets and snapshots (CoinGecko) ─────────────────────────────

async function assetIdFor(db: Db, canonicalKey: string): Promise<string | undefined> {
  return (await db.maybeOne<{ asset_id: string }>(`SELECT asset_id FROM crypto.assets WHERE canonical_key=$1`, [canonicalKey]))?.asset_id;
}

export async function syncMarkets(rt: CryptoRuntime, job: Job): Promise<void> {
  const { db, settings } = rt;
  const pages = Math.max(1, Math.ceil(settings.universeSize / 100));
  const rows: P.CgMarketRow[] = [];
  for (let page = 1; page <= pages; page++) {
    job.requests++;
    rows.push(...(await P.cgMarkets(rt.client, settings.coingeckoDemoKey, 'usd', page, Math.min(100, settings.universeSize))));
  }
  job.fetched = rows.length;
  await job.markFetched();
  const seen = new Set<string>();
  const valid = rows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  }).slice(0, settings.universeSize);
  job.valid = valid.length;
  await job.markValidated();
  const retrieved = iso(rt.now());
  const today = iso(utcDay(rt.now())).slice(0, 10);
  for (const r of valid) {
    const a = await db.one<{ asset_id: string }>(
      `INSERT INTO crypto.assets (canonical_key, name, symbol, image_url, market_cap_rank, metadata_source, listing_status, last_verified_at)
       VALUES ($1,$2,$3,$4,$5,'coingecko','listed',$6)
       ON CONFLICT (canonical_key) DO UPDATE SET name=EXCLUDED.name, symbol=EXCLUDED.symbol, image_url=EXCLUDED.image_url, market_cap_rank=EXCLUDED.market_cap_rank, listing_status='listed', last_verified_at=EXCLUDED.last_verified_at
       RETURNING asset_id`,
      [r.id, r.name, r.symbol, r.image, r.market_cap_rank, retrieved],
    );
    await db.query(`INSERT INTO crypto.asset_provider_ids (provider, external_id, asset_id, verified_by) VALUES ('coingecko',$1,$2,'coingecko /coins/markets') ON CONFLICT (provider, external_id) DO UPDATE SET verified_at=now()`, [r.id, a.asset_id]);
    await db.query(
      `INSERT INTO crypto.market_snapshots (asset_id, source_id, quote_currency, price, market_cap, fully_diluted_valuation, volume_24h, high_24h, low_24h, change_24h_pct, change_7d_pct, change_30d_pct, ath, ath_at, market_cap_rank, provider_updated_at, retrieved_at, job_id)
       VALUES ($1,'coingecko','usd',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (asset_id, source_id, quote_currency) DO UPDATE SET price=EXCLUDED.price, market_cap=EXCLUDED.market_cap, fully_diluted_valuation=EXCLUDED.fully_diluted_valuation, volume_24h=EXCLUDED.volume_24h,
         high_24h=EXCLUDED.high_24h, low_24h=EXCLUDED.low_24h, change_24h_pct=EXCLUDED.change_24h_pct, change_7d_pct=EXCLUDED.change_7d_pct, change_30d_pct=EXCLUDED.change_30d_pct, ath=EXCLUDED.ath, ath_at=EXCLUDED.ath_at,
         market_cap_rank=EXCLUDED.market_cap_rank, provider_updated_at=EXCLUDED.provider_updated_at, retrieved_at=EXCLUDED.retrieved_at, job_id=EXCLUDED.job_id`,
      [a.asset_id, r.price, r.market_cap, r.fdv, r.volume_24h, r.high_24h, r.low_24h, r.change_24h_pct, r.change_7d_pct, r.change_30d_pct, r.ath, r.ath_at, r.market_cap_rank, r.last_updated, retrieved, job.id],
    );
    const sc = checkSupply({ circulating: r.circulating_supply, total: r.total_supply, max: r.max_supply });
    if (r.circulating_supply !== null || r.total_supply !== null || r.max_supply !== null) {
      await db.query(
        `INSERT INTO crypto.supply_snapshots (asset_id, source_id, observed_on, circulating_supply, total_supply, max_supply, methodology, validation, validation_note, provider_updated_at, retrieved_at, job_id)
         VALUES ($1,'coingecko',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (asset_id, source_id, observed_on) DO UPDATE SET circulating_supply=EXCLUDED.circulating_supply, total_supply=EXCLUDED.total_supply, max_supply=EXCLUDED.max_supply, validation=EXCLUDED.validation,
           validation_note=EXCLUDED.validation_note, provider_updated_at=EXCLUDED.provider_updated_at, retrieved_at=EXCLUDED.retrieved_at, job_id=EXCLUDED.job_id`,
        [a.asset_id, today, r.circulating_supply, r.total_supply, r.max_supply, 'CoinGecko-reported circulating, total and maximum supply (CoinGecko methodology; not independently verified on-chain).', sc.validation, sc.note, r.last_updated, retrieved, job.id],
      );
    }
    job.persisted++;
  }
  await job.markPersisted();
  // Reconcile: assets absent from the latest snapshot keep their history but are labelled.
  const keys = valid.map((r) => r.id);
  const gone = await db.query(`UPDATE crypto.assets SET listing_status='not_in_latest_snapshot' WHERE metadata_source='coingecko' AND listing_status='listed' AND NOT (canonical_key = ANY($1)) RETURNING canonical_key`, [keys]);
  job.detail = { assets: valid.length, not_in_latest_snapshot: gone.length, pages };
  await job.markReconciled();
}

/** INR reference prices: CoinGecko's own conversion. Labelled as converted reference prices, never as an INR venue price. */
export async function syncInrSnapshot(rt: CryptoRuntime, job: Job): Promise<void> {
  job.requests++;
  const rows = await P.cgMarkets(rt.client, rt.settings.coingeckoDemoKey, 'inr', 1, Math.min(100, rt.settings.universeSize));
  job.fetched = rows.length;
  await job.markFetched();
  const retrieved = iso(rt.now());
  for (const r of rows) {
    const id = await assetIdFor(rt.db, r.id);
    if (!id || r.price === null) continue;
    job.valid++;
    await rt.db.query(
      `INSERT INTO crypto.market_snapshots (asset_id, source_id, quote_currency, price, market_cap, fully_diluted_valuation, volume_24h, high_24h, low_24h, change_24h_pct, change_7d_pct, change_30d_pct, market_cap_rank, provider_updated_at, retrieved_at, job_id)
       VALUES ($1,'coingecko','inr',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (asset_id, source_id, quote_currency) DO UPDATE SET price=EXCLUDED.price, market_cap=EXCLUDED.market_cap, fully_diluted_valuation=EXCLUDED.fully_diluted_valuation, volume_24h=EXCLUDED.volume_24h, high_24h=EXCLUDED.high_24h, low_24h=EXCLUDED.low_24h,
         change_24h_pct=EXCLUDED.change_24h_pct, change_7d_pct=EXCLUDED.change_7d_pct, change_30d_pct=EXCLUDED.change_30d_pct, market_cap_rank=EXCLUDED.market_cap_rank, provider_updated_at=EXCLUDED.provider_updated_at, retrieved_at=EXCLUDED.retrieved_at, job_id=EXCLUDED.job_id`,
      [id, r.price, r.market_cap, r.fdv, r.volume_24h, r.high_24h, r.low_24h, r.change_24h_pct, r.change_7d_pct, r.change_30d_pct, r.market_cap_rank, r.last_updated, retrieved, job.id],
    );
    job.persisted++;
  }
  await job.markValidated();
  await job.markPersisted();
}

export async function syncGlobal(rt: CryptoRuntime, job: Job): Promise<void> {
  job.requests++;
  const g = await P.cgGlobal(rt.client, rt.settings.coingeckoDemoKey);
  job.fetched = 1;
  await job.markFetched();
  if (g.total_market_cap_usd === null || g.total_market_cap_usd <= 0) {
    await job.quarantine('global', g.updated_at, g, ['total_market_cap_missing']);
    return;
  }
  job.valid = 1;
  await job.markValidated();
  await rt.db.query(
    `INSERT INTO crypto.global_snapshots (source_id, observed_at, total_market_cap_usd, total_volume_usd, market_cap_change_24h_pct, btc_dominance_pct, eth_dominance_pct, active_cryptocurrencies, markets, retrieved_at, job_id)
     VALUES ('coingecko',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (source_id, observed_at) DO NOTHING`,
    [g.updated_at, g.total_market_cap_usd, g.total_volume_usd, g.market_cap_change_24h_pct, g.btc_dominance_pct, g.eth_dominance_pct, g.active_cryptocurrencies, g.markets, iso(rt.now()), job.id],
  );
  job.persisted = 1;
  await job.markPersisted();
}

/** Metadata for the highest-ranked assets that are missing it or are older than a week (bounded per run). */
export async function syncDetails(rt: CryptoRuntime, job: Job, limit = 6, onlyKey?: string): Promise<void> {
  const { db } = rt;
  const todo = onlyKey
    ? await db.query<{ asset_id: string; canonical_key: string }>(`SELECT asset_id, canonical_key FROM crypto.assets WHERE canonical_key=$1`, [onlyKey])
    : await db.query<{ asset_id: string; canonical_key: string }>(
      `SELECT asset_id, canonical_key FROM crypto.assets WHERE listing_status='listed' AND (description IS NULL OR last_verified_at < now() - interval '7 days' OR classification='unknown')
        ORDER BY market_cap_rank NULLS LAST LIMIT $1`, [limit]);
  for (const a of todo) {
    let d: P.CgDetail;
    try {
      job.requests++;
      d = await P.cgDetail(rt.client, rt.settings.coingeckoDemoKey, a.canonical_key);
    } catch (err) {
      job.partialErrors.push(`${a.canonical_key}: ${(err as Error).message}`);
      if (err instanceof ProviderError && (err.kind === 'rate_limited' || err.kind === 'budget_exhausted' || err.kind === 'backing_off')) break;
      continue;
    }
    job.fetched++;
    // Classification: CoinGecko marks a native coin with no asset platform; a token has one.
    const classification = d.asset_platform_id ? 'token' : 'native_coin';
    const primaryNetwork = d.asset_platform_id ? PLATFORM_TO_NETWORK[d.asset_platform_id] ?? null : ({ bitcoin: 'bitcoin', ethereum: 'ethereum', solana: 'solana' } as Record<string, string>)[a.canonical_key] ?? null;
    await db.query(`UPDATE crypto.assets SET description=$2, category=$3, classification=$4, primary_network_id=$5, last_verified_at=$6 WHERE asset_id=$1`, [a.asset_id, d.description, d.categories[0] ?? null, classification, primaryNetwork, iso(rt.now())]);
    for (const p of d.platforms) {
      const network = PLATFORM_TO_NETWORK[p.platform];
      if (!network) continue;
      const fam = network === 'solana' ? 'svm' : 'evm';
      const addr = normaliseAddress(fam, p.address);
      if (!addr) {
        await job.quarantine('token_contract', `${a.canonical_key}:${p.platform}`, p, ['invalid_address_format']);
        continue;
      }
      const existing = await db.maybeOne<{ asset_id: string }>(`SELECT asset_id FROM crypto.token_contracts WHERE network_id=$1 AND address=$2`, [network, addr]);
      if (existing && existing.asset_id !== a.asset_id) {
        // Two assets claiming one contract is a mapping conflict: keep the first, flag the second.
        await job.quarantine('token_contract', `${network}:${addr}`, { claimed_by: a.canonical_key, already_mapped_to: existing.asset_id }, ['contract_address_conflict']);
        continue;
      }
      await db.query(
        `INSERT INTO crypto.token_contracts (network_id, address, asset_id, decimals, verification, source_id, verified_at) VALUES ($1,$2,$3,$4,'provider_reported','coingecko',$5)
         ON CONFLICT (network_id, address) DO UPDATE SET decimals=EXCLUDED.decimals, verified_at=EXCLUDED.verified_at`,
        [network, addr, a.asset_id, p.decimals, iso(rt.now())],
      );
    }
    job.valid++;
    job.persisted++;
  }
  await job.markFetched();
  await job.markPersisted();
}

// ───────────────────────────── Venue mapping (verified pairs) ─────────────────────────────

const PRIMARY_QUOTE: Record<string, string> = { binance: 'USDT', coinbase: 'USD' };
const KEEP_QUOTES = new Set(['USDT', 'USDC', 'USD', 'BTC', 'ETH', 'EUR']);

/**
 * Pairs are mapped to assets only when CoinGecko's exchange tickers name the asset id (coin_id) AND the
 * exchange's own product list confirms the product exists. A shared ticker symbol alone is never enough.
 */
export async function syncVenuePairs(rt: CryptoRuntime, job: Job, exchangeId: 'binance' | 'coinbase'): Promise<void> {
  const { db } = rt;
  const cgId = exchangeId === 'binance' ? 'binance' : 'gdax';
  const assets = await db.query<{ asset_id: string; canonical_key: string }>(`SELECT asset_id, canonical_key FROM crypto.assets WHERE listing_status='listed' ORDER BY market_cap_rank NULLS LAST LIMIT $1`, [rt.settings.universeSize]);
  const byKey = new Map(assets.map((a) => [a.canonical_key, a.asset_id]));
  const tickers: P.CgVenueTicker[] = [];
  for (let i = 0; i < assets.length; i += 50) {
    const ids = assets.slice(i, i + 50).map((a) => a.canonical_key);
    for (let page = 1; page <= 3; page++) {
      job.requests++;
      const t = await P.cgExchangeTickers(rt.client, rt.settings.coingeckoDemoKey, cgId, ids, page);
      tickers.push(...t);
      if (t.length < 100) break;
    }
  }
  job.fetched = tickers.length;
  await job.markFetched();
  const candidates = new Map<string, { product_id: string; base: string; quote: string; base_asset: string; quote_asset: string | null }>();
  for (const t of tickers) {
    if (!KEEP_QUOTES.has(t.target) || t.is_anomaly) continue;
    const baseAsset = byKey.get(t.coin_id);
    if (!baseAsset) continue;
    const product = exchangeId === 'binance' ? `${t.base}${t.target}` : `${t.base}-${t.target}`;
    candidates.set(product, { product_id: product, base: t.base, quote: t.target, base_asset: baseAsset, quote_asset: t.target_coin_id ? byKey.get(t.target_coin_id) ?? null : null });
  }
  job.requests++;
  const venue = exchangeId === 'binance' ? await P.binanceProducts(rt.client, [...candidates.keys()].filter((p) => /^[A-Z0-9]{2,20}$/.test(p))) : await P.coinbaseProducts(rt.client);
  const venueMap = new Map(venue.map((v) => [v.product_id, v]));
  await job.markValidated();
  let unverified = 0;
  for (const c of candidates.values()) {
    const v = venueMap.get(c.product_id);
    if (!v || v.base !== c.base || v.quote !== c.quote) {
      unverified++;
      continue;
    }
    job.valid++;
    const prior = await db.maybeOne<{ status: string; tradable: boolean }>(`SELECT status, tradable FROM crypto.market_pairs WHERE exchange_id=$1 AND product_id=$2`, [exchangeId, c.product_id]);
    await db.query(
      `INSERT INTO crypto.market_pairs (exchange_id, product_id, base_symbol, quote_symbol, base_asset_id, quote_asset_id, status, tradable, price_increment, size_increment, mapping_source, source_id, verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'coingecko exchange tickers (coin_id) + venue product list',$1,$11)
       ON CONFLICT (exchange_id, product_id) DO UPDATE SET base_asset_id=EXCLUDED.base_asset_id, quote_asset_id=EXCLUDED.quote_asset_id, status=EXCLUDED.status, tradable=EXCLUDED.tradable,
         price_increment=EXCLUDED.price_increment, size_increment=EXCLUDED.size_increment, verified_at=EXCLUDED.verified_at`,
      [exchangeId, c.product_id, c.base, c.quote, c.base_asset, c.quote_asset, v.status, v.tradable, v.price_increment, v.size_increment, iso(rt.now())],
    );
    if (prior && prior.status !== v.status) {
      await db.query(
        `INSERT INTO crypto.events (dedupe_key, category, headline, summary, source_id, source_url, published_at, event_at, retrieved_at, verification, asset_ids)
         VALUES ($1,'listing_change',$2,$3,'atlas_observed',$4,$5,NULL,$5,'observed_by_atlas',$6) ON CONFLICT (dedupe_key) DO NOTHING`,
        [`pair-status:${exchangeId}:${c.product_id}:${v.status}:${iso(utcDay(rt.now())).slice(0, 10)}`, `${exchangeId === 'binance' ? 'Binance' : 'Coinbase Exchange'} ${c.product_id} status changed from ${prior.status} to ${v.status}`,
          'Observed by ATLAS when comparing the exchange product list between refreshes. The exact time of the change is not known; it happened between the two refreshes.',
          exchangeId === 'binance' ? `https://www.binance.com/en/trade/${c.base}_${c.quote}` : `https://exchange.coinbase.com/trade/${c.product_id}`, iso(rt.now()), [c.base_asset]],
      );
    }
    job.persisted++;
  }
  job.detail = { candidates: candidates.size, verified: job.valid, unverified_skipped: unverified };
  await job.markPersisted();
}

// ───────────────────────────── Price series and candles ─────────────────────────────

async function ensureSeries(db: Db, s: { source_id: string; kind: 'venue_candle' | 'reference_close'; asset_id: string; pair_id: string | null; quote: string }): Promise<{ series_id: string; backfill_cursor: string | null; backfill_complete: boolean; last_open_time: string | null }> {
  const found = await db.maybeOne<{ series_id: string; backfill_cursor: string | null; backfill_complete: boolean; last_open_time: string | null }>(
    `SELECT series_id, backfill_cursor, backfill_complete, last_open_time FROM crypto.price_series WHERE source_id=$1 AND asset_id=$2 AND coalesce(pair_id,'00000000-0000-0000-0000-000000000000'::uuid)=coalesce($3::uuid,'00000000-0000-0000-0000-000000000000'::uuid) AND quote_currency=$4 AND interval='1d'`,
    [s.source_id, s.asset_id, s.pair_id, s.quote]);
  if (found) return found;
  return db.one(`INSERT INTO crypto.price_series (source_id, kind, asset_id, pair_id, quote_currency, interval) VALUES ($1,$2,$3,$4,$5,'1d') RETURNING series_id, backfill_cursor, backfill_complete, last_open_time`, [s.source_id, s.kind, s.asset_id, s.pair_id, s.quote]);
}

/** Validate, quarantine and upsert candles; returns the number persisted. Idempotent on (series, open_time). */
export async function storeCandles(rt: CryptoRuntime, job: Job, seriesId: string, candles: Candle[], dataset: string): Promise<number> {
  const { rows, duplicates } = dedupeByTime(candles);
  if (duplicates) job.detail.duplicates_removed = ((job.detail.duplicates_removed as number) ?? 0) + duplicates;
  const prev = await rt.db.maybeOne<{ close: number }>(`SELECT close::float8 AS close FROM crypto.ohlcv WHERE series_id=$1 AND open_time < $2 ORDER BY open_time DESC LIMIT 1`, [seriesId, rows[0] ? iso(rows[0].open_time) : iso(0)]);
  let prevClose: number | null = prev?.close ?? null;
  let n = 0;
  const now = rt.now();
  const batch: unknown[][] = [];
  for (const c of rows) {
    const chk = checkCandle(c, { now, interval: '1d', prevClose });
    if (!chk.ok) {
      await job.quarantine(dataset, `${seriesId}:${iso(c.open_time)}`, c, chk.reasons);
      continue;
    }
    job.valid++;
    prevClose = c.close;
    batch.push([seriesId, iso(c.open_time), c.open, c.high, c.low, c.close, c.volume, c.quote_volume ?? null, c.market_cap ?? null, c.trades ?? null, chk.suspect ? 'suspect' : 'valid', job.id, TRANSFORM_VERSION]);
  }
  for (let i = 0; i < batch.length; i += 200) {
    const chunk = batch.slice(i, i + 200);
    const values = chunk.map((_, k) => `(${Array.from({ length: 13 }, (_, j) => `$${k * 13 + j + 1}`).join(',')})`).join(',');
    await rt.db.query(
      `INSERT INTO crypto.ohlcv (series_id, open_time, open, high, low, close, volume, quote_volume, market_cap, trades, validation, job_id, transform_version) VALUES ${values}
       ON CONFLICT (series_id, open_time) DO UPDATE SET open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low, close=EXCLUDED.close, volume=EXCLUDED.volume, quote_volume=EXCLUDED.quote_volume,
         market_cap=EXCLUDED.market_cap, trades=EXCLUDED.trades, validation=EXCLUDED.validation, job_id=EXCLUDED.job_id, transform_version=EXCLUDED.transform_version, imported_at=now()`,
      chunk.flat(),
    );
    n += chunk.length;
  }
  await rt.db.query(
    `UPDATE crypto.price_series s SET first_open_time=x.first, last_open_time=x.last, observations=x.n, updated_at=now()
       FROM (SELECT min(open_time) AS first, max(open_time) AS last, count(*)::int AS n FROM crypto.ohlcv WHERE series_id=$1) x WHERE s.series_id=$1`, [seriesId]);
  job.persisted += n;
  return n;
}

const VENUE_START: Record<string, number> = { binance: Date.UTC(2017, 6, 1), coinbase: Date.UTC(2015, 0, 1) };

/**
 * Resumable, bounded backfill of daily venue candles for the primary pair of the top history assets.
 * Each run makes at most `backfillRequestsPerRun` requests per venue; the cursor is stored per series,
 * so an interrupted backfill continues where it stopped.
 */
export async function backfillVenueCandles(rt: CryptoRuntime, job: Job, exchangeId: 'binance' | 'coinbase'): Promise<void> {
  const { db } = rt;
  const pairs = await db.query<{ pair_id: string; product_id: string; asset_id: string; canonical_key: string }>(
    `SELECT p.pair_id, p.product_id, a.asset_id, a.canonical_key FROM crypto.market_pairs p JOIN crypto.assets a ON a.asset_id=p.base_asset_id
      WHERE p.exchange_id=$1 AND p.quote_symbol=$2 AND p.tradable AND a.listing_status='listed'
      ORDER BY a.market_cap_rank NULLS LAST LIMIT $3`, [exchangeId, PRIMARY_QUOTE[exchangeId], rt.settings.historyAssets]);
  if (!pairs.length) throw new PreconditionError(`No verified ${exchangeId} ${PRIMARY_QUOTE[exchangeId]} pairs yet: the venue mapping job (pairs_${exchangeId}) must succeed first.`);
  let budget = rt.settings.backfillRequestsPerRun;
  const now = rt.now();
  const yesterday = utcDay(now) - DAY_MS;
  const progress: Record<string, unknown> = {};
  for (const p of pairs) {
    if (budget <= 0) break;
    const s = await ensureSeries(db, { source_id: exchangeId, kind: 'venue_candle', asset_id: p.asset_id, pair_id: p.pair_id, quote: PRIMARY_QUOTE[exchangeId]! });
    let cursor = s.backfill_complete && s.last_open_time ? Date.parse(s.last_open_time) + DAY_MS : s.backfill_cursor ? Date.parse(s.backfill_cursor) : VENUE_START[exchangeId]!;
    let stored = 0;
    while (budget > 0 && cursor <= yesterday) {
      budget--;
      job.requests++;
      let candles: Candle[];
      try {
        candles = exchangeId === 'binance' ? await P.binanceDailyKlines(rt.client, p.product_id, cursor, now) : await P.coinbaseDailyCandles(rt.client, p.product_id, cursor, now);
      } catch (err) {
        job.partialErrors.push(`${p.product_id}: ${(err as Error).message}`);
        if (err instanceof ProviderError && err.kind !== 'http') budget = 0;
        break;
      }
      job.fetched += candles.length;
      if (candles.length) stored += await storeCandles(rt, job, s.series_id, candles, `${exchangeId}_daily_candles`);
      // Advance: past the last candle returned, or past the requested window when the venue had none
      // (before the listing date, or a venue outage). Gaps are measured afterwards, never filled.
      const next = candles.length ? candles[candles.length - 1]!.open_time + DAY_MS : cursor + (exchangeId === 'binance' ? 1000 : 300) * DAY_MS;
      cursor = Math.min(next, yesterday + DAY_MS);
      await db.query(`UPDATE crypto.price_series SET backfill_cursor=$2, backfill_complete=$3 WHERE series_id=$1`, [s.series_id, iso(cursor), cursor > yesterday]);
      if (exchangeId === 'binance' && candles.length < 1000 && candles.length > 0) {
        await db.query(`UPDATE crypto.price_series SET backfill_complete=true, backfill_cursor=$2 WHERE series_id=$1`, [s.series_id, iso(yesterday + DAY_MS)]);
        break;
      }
    }
    progress[p.product_id] = { stored, cursor: iso(cursor).slice(0, 10) };
  }
  job.detail = { pairs: pairs.length, progress, requests_left: budget };
  await job.markFetched();
  await job.markValidated();
  await job.markPersisted();
}

/** CoinGecko 365-day daily reference series (price, market cap, volume) for the top history assets. */
export async function syncReferenceHistory(rt: CryptoRuntime, job: Job, limit?: number): Promise<void> {
  const { db } = rt;
  const assets = await db.query<{ asset_id: string; canonical_key: string }>(
    `SELECT a.asset_id, a.canonical_key FROM crypto.assets a LEFT JOIN crypto.price_series s ON s.asset_id=a.asset_id AND s.source_id='coingecko'
      WHERE a.listing_status='listed' AND a.market_cap_rank IS NOT NULL
      ORDER BY (s.updated_at IS NULL) DESC, s.updated_at NULLS FIRST, a.market_cap_rank LIMIT $1`, [Math.min(limit ?? 6, rt.settings.historyAssets)]);
  for (const a of assets) {
    let candles: Candle[];
    try {
      job.requests++;
      candles = await P.cgChart(rt.client, rt.settings.coingeckoDemoKey, a.canonical_key, 365);
    } catch (err) {
      job.partialErrors.push(`${a.canonical_key}: ${(err as Error).message}`);
      if (err instanceof ProviderError && err.kind !== 'http') break;
      continue;
    }
    job.fetched += candles.length;
    const s = await ensureSeries(db, { source_id: 'coingecko', kind: 'reference_close', asset_id: a.asset_id, pair_id: null, quote: 'USD' });
    await storeCandles(rt, job, s.series_id, candles, 'coingecko_reference_daily');
  }
  await job.markFetched();
  await job.markValidated();
  await job.markPersisted();
}

// ───────────────────────────── DeFi (DefiLlama) ─────────────────────────────

const TOP_PROTOCOLS_STORED = 300;
const TOP_PROTOCOLS_HISTORY = 8;
export const TRACKED_CHAINS = ['Ethereum', 'Solana', 'Bitcoin', 'Arbitrum', 'Base'];

async function upsertDefi(rt: CryptoRuntime, job: Job, kind: string, subject: string, metric: string, chain: string, points: { day: number; value: number }[], unit: string) {
  const retrieved = iso(rt.now());
  for (let i = 0; i < points.length; i += 250) {
    const chunk = points.slice(i, i + 250);
    const vals = chunk.map((_, k) => `($1,$2,$3,$4,$${k * 2 + 8},$${k * 2 + 9},$5,'defillama',$6,$7)`).join(',');
    await rt.db.query(
      `INSERT INTO crypto.defi_metrics (subject_kind, subject_id, metric, chain, observed_on, value, unit, source_id, retrieved_at, job_id) VALUES ${vals}
       ON CONFLICT (subject_kind, subject_id, metric, chain, observed_on) DO UPDATE SET value=EXCLUDED.value, retrieved_at=EXCLUDED.retrieved_at, job_id=EXCLUDED.job_id`,
      [kind, subject, metric, chain, unit, retrieved, job.id, ...chunk.flatMap((p) => [iso(p.day).slice(0, 10), p.value])],
    );
  }
  job.persisted += points.length;
}

export async function syncDefi(rt: CryptoRuntime, job: Job): Promise<void> {
  const { db } = rt;
  job.requests++;
  const list = P.parseLlamaProtocols(await rt.client.request('defillama', 'https://api.llama.fi/protocols'));
  job.fetched += list.length;
  await job.markFetched();
  const ranked = list.filter((p) => p.tvl !== null && p.tvl > 0).sort((a, b) => b.tvl! - a.tvl!).slice(0, TOP_PROTOCOLS_STORED);
  job.valid += ranked.length;
  await job.markValidated();
  const retrieved = iso(rt.now());
  for (const [i, p] of ranked.entries()) {
    const asset = p.gecko_id ? await assetIdFor(db, p.gecko_id) : undefined;
    await db.query(
      `INSERT INTO crypto.protocols (protocol_id, name, category, chains, url, description, coingecko_id, asset_id, tvl_usd, change_1d_pct, change_7d_pct, tvl_rank, source_id, retrieved_at, job_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'defillama',$13,$14)
       ON CONFLICT (protocol_id) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category, chains=EXCLUDED.chains, url=EXCLUDED.url, description=EXCLUDED.description, coingecko_id=EXCLUDED.coingecko_id, asset_id=EXCLUDED.asset_id,
         tvl_usd=EXCLUDED.tvl_usd, change_1d_pct=EXCLUDED.change_1d_pct, change_7d_pct=EXCLUDED.change_7d_pct, tvl_rank=EXCLUDED.tvl_rank, retrieved_at=EXCLUDED.retrieved_at, job_id=EXCLUDED.job_id`,
      [p.slug, p.name, p.category, p.chains, p.url, p.description, p.gecko_id, asset ?? null, p.tvl, p.change_1d, p.change_7d, i + 1, retrieved, job.id],
    );
    job.persisted++;
  }
  // Protocols that dropped out of the stored ranking keep their history but lose their rank.
  await db.query(`UPDATE crypto.protocols SET tvl_rank=NULL WHERE retrieved_at < $1`, [retrieved]);
  await job.markPersisted();
  job.detail = { protocols_listed: list.length, stored: ranked.length };
}

export async function syncDefiHistories(rt: CryptoRuntime, job: Job): Promise<void> {
  const { db, client } = rt;
  const top = await db.query<{ protocol_id: string }>(`SELECT protocol_id FROM crypto.protocols WHERE tvl_rank IS NOT NULL ORDER BY tvl_rank LIMIT $1`, [TOP_PROTOCOLS_HISTORY]);
  const tryPart = async (label: string, fn: () => Promise<void>) => {
    try {
      job.requests++;
      await fn();
    } catch (err) {
      // A protocol without a fees adapter is "not available", not an error in the data.
      job.partialErrors.push(`${label}: ${(err as Error).message.slice(0, 160)}`);
    }
  };
  for (const p of top) {
    await tryPart(`${p.protocol_id} tvl`, async () => upsertDefi(rt, job, 'protocol', p.protocol_id, 'tvl', '', P.parseLlamaTvlHistory(await client.request('defillama', `https://api.llama.fi/protocol/${encodeURIComponent(p.protocol_id)}`, { timeoutMs: 60_000 })), 'USD'));
    await tryPart(`${p.protocol_id} fees`, async () => upsertDefi(rt, job, 'protocol', p.protocol_id, 'fees', '', P.parseLlamaDaily(await client.request('defillama', `https://api.llama.fi/summary/fees/${encodeURIComponent(p.protocol_id)}?dataType=dailyFees`)), 'USD/day'));
    await tryPart(`${p.protocol_id} revenue`, async () => upsertDefi(rt, job, 'protocol', p.protocol_id, 'revenue', '', P.parseLlamaDaily(await client.request('defillama', `https://api.llama.fi/summary/fees/${encodeURIComponent(p.protocol_id)}?dataType=dailyRevenue`)), 'USD/day'));
  }
  await tryPart('all-chains tvl', async () => upsertDefi(rt, job, 'all', 'defi', 'tvl', '', P.parseLlamaChainHistory(await client.request('defillama', 'https://api.llama.fi/v2/historicalChainTvl')), 'USD'));
  for (const chain of TRACKED_CHAINS) {
    await tryPart(`${chain} tvl`, async () => upsertDefi(rt, job, 'chain', chain, 'tvl', '', P.parseLlamaChainHistory(await client.request('defillama', `https://api.llama.fi/v2/historicalChainTvl/${encodeURIComponent(chain)}`)), 'USD'));
  }
  // The documented api.llama.fi path returned an empty body on 22 Oct 2026; the stablecoins host serves it.
  await tryPart('stablecoin supply', async () => upsertDefi(rt, job, 'stablecoin', 'all', 'stablecoin_supply', '', P.parseLlamaStablecoinTotal(await client.request('defillama', 'https://stablecoins.llama.fi/stablecoincharts/all')), 'USD'));
  await job.markFetched();
  await job.markPersisted();
}

// ───────────────────────────── On-chain ─────────────────────────────

const BLOCK_WINDOW = 500;

async function storeBlocks(rt: CryptoRuntime, job: Job, network: string, sourceId: string, blocks: P.ChainBlock[]) {
  const retrieved = iso(rt.now());
  for (const b of blocks) {
    if (Date.parse(b.time) > rt.now() + 2 * 3_600_000) {
      await job.quarantine('blocks', `${network}:${b.height}`, b, ['block_time_in_future']);
      continue;
    }
    job.valid++;
    await rt.db.query(
      `INSERT INTO crypto.onchain_blocks (network_id, height, block_hash, block_time, tx_count, size_bytes, gas_used, gas_limit, base_fee_gwei, total_fees_native, producer, source_id, retrieved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (network_id, height) DO UPDATE SET block_hash=EXCLUDED.block_hash, block_time=EXCLUDED.block_time, tx_count=EXCLUDED.tx_count, size_bytes=EXCLUDED.size_bytes, gas_used=EXCLUDED.gas_used,
         gas_limit=EXCLUDED.gas_limit, base_fee_gwei=EXCLUDED.base_fee_gwei, total_fees_native=EXCLUDED.total_fees_native, producer=EXCLUDED.producer, retrieved_at=EXCLUDED.retrieved_at`,
      [network, b.height, b.hash, b.time, b.tx_count, b.size_bytes, b.gas_used, b.gas_limit, b.base_fee_gwei, b.total_fees_native, b.producer, sourceId, retrieved],
    );
    job.persisted++;
  }
  // Rolling window: older blocks are removed (the public endpoints are not an archive and ATLAS is not one).
  await rt.db.query(`DELETE FROM crypto.onchain_blocks WHERE network_id=$1 AND height < (SELECT max(height) - $2 FROM crypto.onchain_blocks WHERE network_id=$1)`, [network, BLOCK_WINDOW]);
}

async function storeNetworkMetrics(rt: CryptoRuntime, network: string, sourceId: string) {
  const rows = await rt.db.query<{ height: number; block_time: string; tx_count: number | null; gas_used: number | null; gas_limit: number | null; base_fee_gwei: number | null; total_fees_native: number | null }>(
    `SELECT height, block_time, tx_count, gas_used::float8 AS gas_used, gas_limit::float8 AS gas_limit, base_fee_gwei::float8 AS base_fee_gwei, total_fees_native::float8 AS total_fees_native
       FROM crypto.onchain_blocks WHERE network_id=$1 ORDER BY height DESC LIMIT 50`, [network]);
  if (rows.length < 2) return;
  const desc = `last ${rows.length} stored blocks (heights ${rows[rows.length - 1]!.height}–${rows[0]!.height})`;
  const at = rows[0]!.block_time;
  const mean = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const span = (Date.parse(rows[0]!.block_time) - Date.parse(rows[rows.length - 1]!.block_time)) / 1000 / (rows.length - 1);
  const metrics: [string, number | null, string, string][] = [
    ['avg_block_interval', span, 'seconds', 'Mean time between consecutive stored blocks (block timestamps are set by block producers and can be imprecise).'],
    ['avg_tx_per_block', mean(rows.map((r) => r.tx_count)), 'transactions', 'Mean transaction count per block. A transaction count is not a measure of users or adoption.'],
  ];
  if (network === 'ethereum') {
    metrics.push(['avg_base_fee', mean(rows.map((r) => r.base_fee_gwei)), 'gwei', 'Mean EIP-1559 base fee per gas across the stored blocks.']);
    metrics.push(['avg_gas_utilisation', mean(rows.map((r) => (r.gas_used !== null && r.gas_limit ? r.gas_used / r.gas_limit : null))), 'ratio', 'Mean gas used ÷ gas limit per block.']);
  }
  if (network === 'bitcoin') metrics.push(['avg_fees_per_block', mean(rows.map((r) => r.total_fees_native)), 'BTC', 'Mean total transaction fees per block (excluding the block subsidy), as reported by mempool.space.']);
  for (const [metric, value, unit, methodology] of metrics) {
    if (value === null || !Number.isFinite(value)) continue;
    await rt.db.query(
      `INSERT INTO crypto.onchain_metrics (network_id, metric, observed_at, value, unit, window_desc, methodology, source_id, retrieved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (network_id, metric, observed_at) DO UPDATE SET value=EXCLUDED.value, window_desc=EXCLUDED.window_desc, retrieved_at=EXCLUDED.retrieved_at`,
      [network, metric, at, value, unit, desc, methodology, sourceId, iso(rt.now())],
    );
  }
}

export async function syncEthereum(rt: CryptoRuntime, job: Job): Promise<void> {
  const url = rt.settings.ethereumRpcUrl;
  job.requests++;
  const head = await P.ethRpc<{ result: string }>(rt.client, url, 'eth_blockNumber', []);
  const latest = Number(BigInt(head.result));
  const stored = (await rt.db.maybeOne<{ h: number | null }>(`SELECT max(height)::int AS h FROM crypto.onchain_blocks WHERE network_id='ethereum'`))?.h ?? null;
  const from = Math.max(stored === null ? latest - 9 : stored + 1, latest - 19);
  const blocks: P.ChainBlock[] = [];
  for (let h = latest; h >= from; h--) {
    job.requests++;
    try {
      blocks.push(P.parseEthBlock(await P.ethRpc(rt.client, url, 'eth_getBlockByNumber', [`0x${h.toString(16)}`, false])));
    } catch (err) {
      job.partialErrors.push(`block ${h}: ${(err as Error).message}`);
      if (err instanceof ProviderError && err.kind !== 'http') break;
    }
  }
  job.fetched = blocks.length;
  await job.markFetched();
  await storeBlocks(rt, job, 'ethereum', 'ethereum_rpc', blocks);
  await job.markPersisted();
  await storeNetworkMetrics(rt, 'ethereum', 'ethereum_rpc');
  job.detail = { latest, from };
}

export async function syncBitcoin(rt: CryptoRuntime, job: Job): Promise<void> {
  job.requests++;
  const blocks = P.parseMempoolBlocks(await rt.client.request('mempool_space', 'https://mempool.space/api/v1/blocks'));
  job.fetched = blocks.length;
  await job.markFetched();
  await storeBlocks(rt, job, 'bitcoin', 'mempool_space', blocks);
  await job.markPersisted();
  await storeNetworkMetrics(rt, 'bitcoin', 'mempool_space');
  try {
    job.requests++;
    const fees: any = await rt.client.request('mempool_space', 'https://mempool.space/api/v1/fees/recommended');
    const at = iso(rt.now());
    for (const [k, metric] of [['fastestFee', 'fee_estimate_next_block'], ['halfHourFee', 'fee_estimate_30min'], ['hourFee', 'fee_estimate_60min']] as const) {
      if (typeof fees?.[k] !== 'number' || fees[k] < 0) continue;
      await rt.db.query(
        `INSERT INTO crypto.onchain_metrics (network_id, metric, observed_at, value, unit, window_desc, methodology, source_id, retrieved_at) VALUES ('bitcoin',$1,$2,$3,'sat/vB','current mempool',$4,'mempool_space',$2) ON CONFLICT DO NOTHING`,
        [metric, at, fees[k], 'mempool.space recommended fee rate (its own estimate from the current mempool; not a protocol value).'],
      );
    }
  } catch (err) {
    job.partialErrors.push(`fees: ${(err as Error).message}`);
  }
}

// ───────────────────────────── Events ─────────────────────────────

async function storeEvents(rt: CryptoRuntime, job: Job, sourceId: string, events: P.SourceEvent[]) {
  for (const e of events) {
    job.valid++;
    const assets = await rt.db.query<{ asset_id: string }>(`SELECT asset_id FROM crypto.assets WHERE canonical_key = ANY($1)`, [e.network_ids]);
    const r = await rt.db.query(
      `INSERT INTO crypto.events (dedupe_key, category, headline, source_id, source_url, published_at, retrieved_at, verification, network_ids, asset_ids)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'published_by_source',$8,$9) ON CONFLICT (dedupe_key) DO NOTHING RETURNING event_id`,
      [e.dedupe_key, e.category, e.headline, sourceId, e.url, e.published_at, iso(rt.now()), e.network_ids, assets.map((a) => a.asset_id)],
    );
    job.persisted += r.length;
  }
}

export async function syncGithubReleases(rt: CryptoRuntime, job: Job): Promise<void> {
  for (const repo of P.TRACKED_REPOS) {
    try {
      job.requests++;
      const ev = P.parseGithubReleases(await rt.client.request('github_releases', `https://api.github.com/repos/${repo.repo}/releases?per_page=8`, { headers: { accept: 'application/vnd.github+json' } }), repo);
      job.fetched += ev.length;
      await storeEvents(rt, job, 'github_releases', ev);
    } catch (err) {
      job.partialErrors.push(`${repo.repo}: ${(err as Error).message}`);
    }
  }
  await job.markFetched();
  await job.markPersisted();
}

export async function syncEthereumBlog(rt: CryptoRuntime, job: Job): Promise<void> {
  job.requests++;
  const xml = await rt.client.request<string>('ethereum_blog', 'https://blog.ethereum.org/en/feed.xml', { text: true });
  const ev = P.parseRss(xml, 'ethblog', ['ethereum']);
  job.fetched = ev.length;
  await job.markFetched();
  await storeEvents(rt, job, 'ethereum_blog', ev);
  await job.markPersisted();
}

// ───────────────────────────── Housekeeping ─────────────────────────────

export async function prune(db: Db): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  out.quarantine = (await db.query(`DELETE FROM crypto.quarantine WHERE created_at < now() - interval '120 days' RETURNING 1`)).length;
  // Jobs that persisted records are provenance for those records and are kept; empty jobs expire.
  out.jobs = (await db.query(`DELETE FROM crypto.ingestion_jobs WHERE started_at < now() - interval '45 days' AND records_persisted = 0 AND status <> 'running' AND job_id NOT IN (SELECT job_id FROM crypto.quarantine WHERE job_id IS NOT NULL) RETURNING 1`)).length;
  out.usage = (await db.query(`DELETE FROM crypto.request_usage WHERE day < current_date - 120 RETURNING 1`)).length;
  // Global snapshots: keep every snapshot for 14 days, then one per UTC day.
  out.global = (await db.query(`DELETE FROM crypto.global_snapshots g WHERE observed_at < now() - interval '14 days' AND observed_at <> (SELECT max(observed_at) FROM crypto.global_snapshots x WHERE x.source_id=g.source_id AND date_trunc('day', x.observed_at)=date_trunc('day', g.observed_at)) RETURNING 1`)).length;
  out.onchain_metrics = (await db.query(`DELETE FROM crypto.onchain_metrics WHERE observed_at < now() - interval '30 days' RETURNING 1`)).length;
  return out;
}
