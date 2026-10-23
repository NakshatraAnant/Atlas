import type { Obs } from '@atlas/shared';
import type { Db } from '../../db/db.js';
import { badRequest, notFound } from '../../lib/http.js';

// One way to name and load any instrument ATLAS can research, with its provenance attached:
//   crypto:<canonical_key>[@<series uuid>]   stored crypto series (venue candles or reference closes)
//   equity:<EXCHANGE>:<SYMBOL>[@<basis>]      real Indian equity reference data (equity schema)
//   upload:<dataset uuid>                      a private price file the user uploaded
// Synthetic development equities (ref/market schemas) are deliberately NOT resolvable here: they can
// never enter cross-asset research, portfolios, alerts or reports.

export type Classification = 'REAL_VERIFIED' | 'REAL_UNVERIFIED' | 'USER_IMPORTED';
export type Freshness = 'fresh' | 'stale' | 'missing';

export interface Instrument {
  key: string;
  label: string;
  asset_class: 'crypto' | 'equity' | 'index' | 'upload';
  calendar: 'continuous' | 'sessions';
  currency: string;
  classification: Classification;
  source: string;
  basis: string;
  annualisation: 365 | 252;
  observations: Obs[];
  volumes: (number | null)[];
  first: string | null;
  last: string | null;
  freshness: Freshness;
  notes: string[];
}

const KEY = /^(crypto:[a-z0-9._-]{1,120}(@[0-9a-f-]{36})?|equity:(NSE|BSE|INDEX):[A-Z0-9&_.-]{1,30}(@(raw|adjusted_split_dividend))?|upload:[0-9a-f-]{36})$/;
export const isInstrumentKey = (k: string) => KEY.test(k);

/** Freshness of a daily series relative to its calendar (crypto days are complete at 00:00 UTC; sessions allow a long weekend). */
export function dailyFreshness(last: string | null, calendar: 'continuous' | 'sessions', now: Date): Freshness {
  if (!last) return 'missing';
  const ageDays = (now.getTime() - Date.parse(last)) / 86_400_000;
  return ageDays <= (calendar === 'continuous' ? 2.5 : 5) ? 'fresh' : 'stale';
}

export async function resolveInstrument(db: Db, userId: string, key: string, now: Date, opts: { fromMs?: number } = {}): Promise<Instrument> {
  if (!isInstrumentKey(key)) throw badRequest(`Not a valid instrument key: ${key}`);
  const from = opts.fromMs === undefined ? null : new Date(opts.fromMs).toISOString();
  if (key.startsWith('crypto:')) {
    const [canon, seriesId] = key.slice(7).split('@');
    const a = await db.maybeOne<{ asset_id: string; name: string; symbol: string }>(`SELECT asset_id, name, symbol FROM crypto.assets WHERE canonical_key=$1`, [canon]);
    if (!a) throw notFound(`No crypto asset ${canon}.`);
    const s = await db.maybeOne<{ series_id: string; source_id: string; kind: string; quote_currency: string; product_id: string | null; first_open_time: string | null; last_open_time: string | null }>(
      `SELECT s.series_id, s.source_id, s.kind, s.quote_currency, p.product_id, s.first_open_time, s.last_open_time FROM crypto.price_series s LEFT JOIN crypto.market_pairs p ON p.pair_id=s.pair_id
        WHERE s.asset_id=$1 AND s.observations > 0 AND ($2::uuid IS NULL OR s.series_id=$2)
        -- Default series: one that is current (within 3 days of the asset's freshest series), then venue candles, then the longest.
        ORDER BY (s.last_open_time >= (SELECT max(last_open_time) FROM crypto.price_series x WHERE x.asset_id=$1 AND x.observations > 0) - interval '3 days') DESC, (s.kind='venue_candle') DESC, s.observations DESC LIMIT 1`, [a.asset_id, seriesId ?? null]);
    if (!s) throw notFound(`No stored daily history for ${a.name}.`);
    const rows = await db.query<{ open_time: string; close: number; volume: number | null }>(`SELECT open_time, close::float8 AS close, volume::float8 AS volume FROM crypto.ohlcv WHERE series_id=$1 AND ($2::timestamptz IS NULL OR open_time >= $2) ORDER BY open_time`, [s.series_id, from]);
    const venue = s.kind === 'venue_candle';
    return {
      key: `crypto:${canon}@${s.series_id}`, label: `${a.name} (${a.symbol})`, asset_class: 'crypto', calendar: 'continuous', currency: s.quote_currency, classification: 'REAL_UNVERIFIED',
      source: venue ? `${s.source_id === 'binance' ? 'Binance' : 'Coinbase Exchange'} ${s.product_id} daily candles` : 'CoinGecko reference price (daily)',
      basis: venue ? 'venue close (UTC day)' : 'reference price observed 00:00 UTC', annualisation: 365,
      observations: rows.map((r) => ({ t: Date.parse(r.open_time), v: r.close })), volumes: rows.map((r) => r.volume),
      first: s.first_open_time, last: s.last_open_time, freshness: dailyFreshness(s.last_open_time, 'continuous', now),
      notes: [venue ? 'Venue-specific price: other exchanges and quote currencies differ.' : 'Aggregated reference price: not executable on any venue.', 'Crypto has no dividends or splits: price return is the whole return.'],
    };
  }
  if (key.startsWith('equity:')) {
    const [rest, wanted] = key.slice(7).split('@');
    const [exchange, symbol] = rest!.split(':') as [string, string];
    const inst = await db.maybeOne<{ instrument_id: string; name: string | null; kind: string; currency: string }>(`SELECT instrument_id, name, kind, currency FROM equity.instruments WHERE exchange=$1 AND symbol=$2`, [exchange, symbol]);
    if (!inst) throw notFound(`No real data imported for ${exchange}:${symbol}. Import it from Indian equities (needs a configured provider key).`);
    const s = await db.maybeOne<{ series_id: string; provider_id: string; classification: Classification; basis: string; first_date: string | null; last_date: string | null; name: string }>(
      `SELECT s.series_id, s.provider_id, s.classification, s.basis, s.first_date, s.last_date, p.name FROM equity.price_series s JOIN equity.providers p USING (provider_id)
        WHERE s.instrument_id=$1 AND s.observations > 0 AND ($2::text IS NULL OR s.basis=$2) ORDER BY (s.basis = CASE WHEN $3 = 'index' THEN 'raw' ELSE 'adjusted_split_dividend' END) DESC, p.priority LIMIT 1`, [inst.instrument_id, wanted ?? null, inst.kind]);
    if (!s) throw notFound(`No stored prices for ${exchange}:${symbol}.`);
    const rows = await db.query<{ trade_date: string; close: number; volume: number | null }>(`SELECT trade_date, close::float8 AS close, volume::float8 AS volume FROM equity.prices WHERE series_id=$1 AND ($2::date IS NULL OR trade_date >= $2::date) ORDER BY trade_date`, [s.series_id, from ? from.slice(0, 10) : null]);
    return {
      key: `equity:${exchange}:${symbol}@${s.basis}`, label: `${inst.name ?? symbol} (${exchange}:${symbol})`, asset_class: inst.kind === 'index' ? 'index' : 'equity', calendar: 'sessions', currency: inst.currency, classification: s.classification,
      source: `${s.name} end-of-day`, basis: inst.kind === 'index' ? 'index level' : s.basis === 'raw' ? 'raw (as traded; not adjusted for splits or dividends)' : 'adjusted for splits and dividends (provider adjustment)', annualisation: 252,
      observations: rows.map((r) => ({ t: Date.parse(`${r.trade_date}T00:00:00Z`), v: r.close })), volumes: rows.map((r) => r.volume),
      first: s.first_date, last: s.last_date, freshness: dailyFreshness(s.last_date ? `${s.last_date}T00:00:00Z` : null, 'sessions', now),
      notes: inst.kind === 'index' ? ['Index level as published by the index provider (a price-return index unless its name says total return): dividends are not included.'] : s.basis === 'raw' ? ['Raw prices: returns are price returns that ignore dividends and can jump on splits or bonuses.'] : ['Provider-adjusted series: returns approximate total return (dividends reinvested).'],
    };
  }
  const datasetId = key.slice(7);
  const d = await db.maybeOne<{ name: string; instrument_label: string; currency: string; first_date: string | null; last_date: string | null }>(`SELECT name, instrument_label, currency, first_date, last_date FROM app.user_datasets WHERE dataset_id=$1 AND user_id=$2 AND deleted_at IS NULL`, [datasetId, userId]);
  // Another user's dataset is indistinguishable from a missing one (no existence leak).
  if (!d) throw notFound('No such uploaded dataset.');
  const rows = await db.query<{ trade_date: string; close: number; volume: number | null }>(`SELECT trade_date, close::float8 AS close, volume::float8 AS volume FROM app.user_dataset_prices WHERE dataset_id=$1 AND ($2::date IS NULL OR trade_date >= $2::date) ORDER BY trade_date`, [datasetId, from ? from.slice(0, 10) : null]);
  return {
    key, label: `${d.instrument_label} (your file: ${d.name})`, asset_class: 'upload', calendar: 'sessions', currency: d.currency, classification: 'USER_IMPORTED',
    source: 'Your uploaded file', basis: 'as uploaded (adjustment not known to ATLAS)', annualisation: 252,
    observations: rows.map((r) => ({ t: Date.parse(`${r.trade_date}T00:00:00Z`), v: r.close })), volumes: rows.map((r) => r.volume),
    first: d.first_date, last: d.last_date, freshness: dailyFreshness(d.last_date ? `${d.last_date}T00:00:00Z` : null, 'sessions', now),
    notes: ['User-provided data. ATLAS has not verified it.'],
  };
}

/** Instruments a user can pick from: stored crypto assets, imported Indian equities, and their own uploads. */
export async function searchInstruments(db: Db, userId: string, q: string, limit = 20) {
  const like = `%${q.toLowerCase()}%`;
  const crypto = await db.query<{ key: string; label: string; observations: number }>(
    `SELECT 'crypto:' || a.canonical_key AS key, a.name || ' (' || a.symbol || ')' AS label, max(s.observations)::int AS observations
       FROM crypto.assets a JOIN crypto.price_series s ON s.asset_id=a.asset_id AND s.observations > 0
      WHERE lower(a.name) LIKE $1 OR lower(a.symbol) LIKE $1 OR a.canonical_key LIKE $1 GROUP BY a.canonical_key, a.name, a.symbol, a.market_cap_rank ORDER BY a.market_cap_rank NULLS LAST LIMIT $2`, [like, limit]);
  const equity = await db.query<{ key: string; label: string; observations: number }>(
    `SELECT 'equity:' || i.exchange || ':' || i.symbol AS key, coalesce(i.name, i.symbol) || ' (' || i.exchange || ':' || i.symbol || ')' AS label, max(s.observations)::int AS observations
       FROM equity.instruments i JOIN equity.price_series s USING (instrument_id) WHERE s.observations > 0 AND (lower(i.symbol) LIKE $1 OR lower(coalesce(i.name,'')) LIKE $1) GROUP BY i.exchange, i.symbol, i.name LIMIT $2`, [like, limit]);
  const uploads = await db.query<{ key: string; label: string; observations: number }>(
    `SELECT 'upload:' || dataset_id AS key, instrument_label || ' (your file)' AS label, rows_valid AS observations FROM app.user_datasets WHERE user_id=$1 AND deleted_at IS NULL AND (lower(name) LIKE $2 OR lower(instrument_label) LIKE $2) ORDER BY created_at DESC LIMIT $3`, [userId, like, limit]);
  return [...crypto.map((x) => ({ ...x, asset_class: 'crypto', classification: 'REAL_UNVERIFIED' })), ...equity.map((x) => ({ ...x, asset_class: 'equity', classification: 'REAL_UNVERIFIED' })), ...uploads.map((x) => ({ ...x, asset_class: 'upload', classification: 'USER_IMPORTED' }))];
}
