import * as A from '@atlas/shared';
import type { Db } from '../../db/db.js';
import { calendarFor, isExpectedSession, type CalendarDay } from './operations.js';

// Session-based metrics for stored Indian equity series. Inputs are provider closes only; a metric whose
// look-back is not covered by stored sessions is null with the reason, never estimated. Returns and
// indicators use the split- and dividend-adjusted series when the provider supplies one (so a split is not
// a crash), and the raw as-traded series otherwise; the basis used is returned with every result.

export const SESSIONS = { d1: 1, w1: 5, m1: 21, m3: 63, m6: 126, y1: 252 } as const;
const DAY = 86_400_000;
const MAX_GAP = 5 * DAY;

export interface Bars { basis: 'raw' | 'adjusted_split_dividend'; dates: string[]; open: number[]; high: number[]; low: number[]; close: number[]; volume: (number | null)[]; suspect: number }

export async function loadBars(db: Db, instrumentId: string, basis?: 'raw' | 'adjusted_split_dividend'): Promise<Bars | null> {
  // Shares: the provider-adjusted series first (a split is not a crash). Indices: the published level (raw);
  // a provider "adjusted close" for an index is the same number and must not be read as total return.
  const series = await db.query<{ series_id: string; basis: 'raw' | 'adjusted_split_dividend' }>(`SELECT s.series_id, s.basis FROM equity.price_series s JOIN equity.instruments i USING (instrument_id) WHERE s.instrument_id=$1 AND s.observations > 0
    ORDER BY CASE WHEN s.basis = CASE WHEN i.kind = 'index' THEN 'raw' ELSE 'adjusted_split_dividend' END THEN 0 ELSE 1 END`, [instrumentId]);
  const s = basis ? series.find((x) => x.basis === basis) : series[0];
  if (!s) return null;
  const rows = await db.query<{ d: string; open: number; high: number; low: number; close: number; volume: number | null; validation: string }>(
    `SELECT to_char(trade_date, 'YYYY-MM-DD') AS d, open::float8 AS open, high::float8 AS high, low::float8 AS low, close::float8 AS close, volume::float8 AS volume, validation FROM equity.prices WHERE series_id=$1 ORDER BY trade_date`, [s.series_id]);
  return { basis: s.basis, dates: rows.map((r) => r.d), open: rows.map((r) => r.open), high: rows.map((r) => r.high), low: rows.map((r) => r.low), close: rows.map((r) => r.close), volume: rows.map((r) => r.volume), suspect: rows.filter((r) => r.validation === 'suspect').length };
}

const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const toObs = (b: Bars): A.Obs[] => b.dates.map((d, i) => ({ t: t(d), v: b.close[i]! }));

/** Session returns between consecutive stored sessions; a gap longer than 5 calendar days is missing data and breaks the chain. */
export function sessionLogReturns(b: Bars): number[] {
  const out: number[] = [];
  for (let i = 1; i < b.close.length; i++) if (t(b.dates[i]!) - t(b.dates[i - 1]!) <= MAX_GAP) out.push(Math.log(b.close[i]! / b.close[i - 1]!));
  return out;
}

const back = (b: Bars, n: number) => (b.close.length > n ? b.close[b.close.length - 1]! / b.close[b.close.length - 1 - n]! - 1 : null);

export interface InstrumentMetrics {
  basis: string; last_date: string | null; last_close: number | null; observations: number;
  returns: Record<keyof typeof SESSIONS, number | null>;
  vol_3m: number | null; vol_1y: number | null; max_drawdown: number | null; current_drawdown: number | null;
  rsi14: number | null; macd_hist: number | null; momentum_3m: number | null;
  range_52w: { high: number; low: number; from_high: number; from_low: number; sessions: number } | null;
  avg_volume_1m: number | null; suspect_rows: number;
}

export function metricsOf(b: Bars): InstrumentMetrics {
  const n = b.close.length;
  const lr = sessionLogReturns(b);
  const vol = (k: number) => (lr.length >= Math.min(k, 20) ? A.stdev(lr.slice(-k)) * Math.sqrt(252) : null);
  const dd = A.drawdowns(toObs(b));
  const r = A.rsi(b.close, 14);
  const m = A.macd(b.close);
  const range = A.rangeHighLow(toObs(b), 252);
  const vols = b.volume.slice(-21).filter((v): v is number => v !== null);
  return {
    basis: b.basis, last_date: b.dates[n - 1] ?? null, last_close: b.close[n - 1] ?? null, observations: n,
    returns: { d1: back(b, 1), w1: back(b, 5), m1: back(b, 21), m3: back(b, 63), m6: back(b, 126), y1: back(b, 252) },
    vol_3m: vol(63), vol_1y: lr.length >= 200 ? A.stdev(lr.slice(-252)) * Math.sqrt(252) : null,
    max_drawdown: dd.ok ? dd.max_drawdown : null, current_drawdown: dd.ok ? dd.current_drawdown : null,
    rsi14: r[n - 1] ?? null, macd_hist: m.histogram[n - 1] ?? null, momentum_3m: back(b, 63),
    range_52w: range.ok ? { high: range.high, low: range.low, from_high: range.from_high, from_low: range.from_low, sessions: range.observations } : null,
    avg_volume_1m: vols.length >= 15 ? vols.reduce((s, x) => s + x, 0) / vols.length : null, suspect_rows: b.suspect,
  };
}

/** Expected sessions (weekdays minus evidenced holidays) between the first and last stored date that have no row. */
export function missingSessions(dates: string[], cal: CalendarDay[]): string[] {
  if (dates.length < 2) return [];
  const have = new Set(dates);
  const out: string[] = [];
  for (let d = t(dates[0]!); d <= t(dates[dates.length - 1]!); d += DAY) {
    const iso = new Date(d).toISOString().slice(0, 10);
    if (!have.has(iso) && isExpectedSession(iso, cal)) out.push(iso);
  }
  return out;
}

export async function missingSessionsFor(db: Db, b: Bars): Promise<string[]> {
  if (b.dates.length < 2) return [];
  return missingSessions(b.dates, await calendarFor(db, 'NSE', b.dates[0]!, b.dates[b.dates.length - 1]!));
}

/** Sessions the series is behind the expected latest session (0 = current). */
export function sessionsBehind(lastDate: string | null, expected: string, cal: CalendarDay[]): number | null {
  if (!lastDate) return null;
  let n = 0;
  for (let d = t(lastDate) + DAY; d <= t(expected); d += DAY) if (isExpectedSession(new Date(d).toISOString().slice(0, 10), cal)) n++;
  return n;
}
