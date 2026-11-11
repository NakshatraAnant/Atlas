import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/db.js';
import { notFound, parse } from '../../lib/http.js';
import { requireUser } from '../auth/service.js';
import { loadObs } from '../commodity/routes.js';
import { loadBars } from '../equity/analytics.js';

// Data for the Academy's 3D chart analyses. Every surface is calculated by ATLAS from observations already
// stored from a named source; nothing is simulated. Missing cells stay null (drawn as gaps), never zero.
// The pure functions are exported for known-answer tests.

export interface Grid3D {
  id: string;
  title: string;
  /** Column axis (left to right). */
  x: { title: string; labels: string[] };
  /** Row axis (front to back). */
  z: { title: string; labels: string[] };
  /** Height axis. */
  y: { title: string; unit: string };
  /** rows (z) × columns (x); null = no data. */
  values: (number | null)[][];
  /** Optional second grid on the same axes (for example out-of-sample results). */
  compare?: { title: string; values: (number | null)[][] };
  /** Diverging colour around zero (returns, slopes), or a sequential scale (levels). */
  colour: 'diverging' | 'sequential';
  facts: { label: string; value: string }[];
  method: string;
  source: { name: string; series: string[]; first: string | null; last: string | null; note: string };
}

const pct = (v: number, d = 1) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`;

// ───────── 1. Holding-period returns (Market Decoder) ─────────

/** Return from each start session over each horizon (in sessions). Rows: start dates (every `step` sessions). */
export function horizonSurface(dates: string[], close: number[], horizons: number[], step: number): { starts: string[]; values: (number | null)[][] } {
  const maxH = Math.max(...horizons);
  const starts: string[] = [];
  const values: (number | null)[][] = [];
  for (let i = 0; i + maxH < close.length; i += step) {
    starts.push(dates[i]!);
    values.push(horizons.map((h) => (close[i]! > 0 && close[i + h]! > 0 ? close[i + h]! / close[i]! - 1 : null)));
  }
  return { starts, values };
}

// ───────── 2. Parameter sweep, in-sample vs out-of-sample (Signal Engineer) ─────────

export function sma(v: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(v.length).fill(null);
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i]!;
    if (i >= n) s -= v[i - n]!;
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

/**
 * Long-or-flat moving-average crossover. The position for day t+1 is decided at the close of day t
 * (no look-ahead); each change of position costs `costPerSwitch` (a fraction of value).
 * Returns the daily strategy returns from index `from` (inclusive) to `to` (exclusive).
 */
export function crossoverReturns(close: number[], fast: number, slow: number, from: number, to: number, costPerSwitch: number): number[] {
  const f = sma(close, fast);
  const s = sma(close, slow);
  const out: number[] = [];
  let pos = 0;
  for (let t = Math.max(from, 1); t < to; t++) {
    const fa = f[t - 1];
    const sl = s[t - 1];
    const want = fa !== null && sl !== null && fa! > sl! ? 1 : 0;
    const r = close[t]! / close[t - 1]! - 1;
    out.push(want * r - (want !== pos ? costPerSwitch : 0));
    pos = want;
  }
  return out;
}

/** Annualised Sharpe ratio (risk-free 0) of daily returns; null with fewer than 60 returns or zero variance. */
export function sharpe(r: number[], periods = 252): number | null {
  if (r.length < 60) return null;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1);
  // Constant returns leave only floating-point noise in the variance; that is "no variation", not a Sharpe of 10^16.
  const sd = Math.sqrt(v);
  return sd > 1e-12 * Math.max(1, Math.abs(m)) ? (m / sd) * Math.sqrt(periods) : null;
}

/** Spearman rank correlation of paired values (nulls dropped); null with fewer than 4 pairs. */
export function spearman(a: (number | null)[], b: (number | null)[]): number | null {
  const pairs = a.map((x, i) => [x, b[i]] as const).filter((p): p is readonly [number, number] => p[0] !== null && p[1] !== null);
  if (pairs.length < 4) return null;
  const rank = (xs: number[]) => { const o = xs.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]); const r = new Array(xs.length); for (let k = 0; k < o.length;) { let j = k; while (j + 1 < o.length && o[j + 1]![0] === o[k]![0]) j++; for (let q = k; q <= j; q++) r[o[q]![1]] = (k + j) / 2; k = j + 1; } return r as number[]; };
  const ra = rank(pairs.map((p) => p[0]));
  const rb = rank(pairs.map((p) => p[1]));
  const n = ra.length;
  const ma = ra.reduce((x, y) => x + y, 0) / n;
  const mb = rb.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i]! - ma) * (rb[i]! - mb); da += (ra[i]! - ma) ** 2; db += (rb[i]! - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : null;
}

// ───────── 3. Futures curve through time (Commodity Markets Decoder) ─────────

/** Last observation in each calendar month, per contract; months where any contract is missing keep nulls. */
export function monthlyCurves(contracts: { t: number; v: number }[][]): { months: string[]; values: (number | null)[][] } {
  const byMonth = new Map<string, (number | null)[]>();
  contracts.forEach((obs, c) => {
    for (const o of obs) {
      const m = new Date(o.t).toISOString().slice(0, 7);
      const row = byMonth.get(m) ?? new Array(contracts.length).fill(null);
      row[c] = o.v; // observations are in date order, so the last one in the month wins
      byMonth.set(m, row);
    }
  });
  const months = [...byMonth.keys()].sort();
  return { months, values: months.map((m) => byMonth.get(m)!) };
}

// ───────── 4. Inventory seasonality (Commodity Markets Decoder) ─────────

/** Week-of-year (1–52) by year; week = floor(day-of-year / 7) + 1, capped at 52 (a 53rd week joins week 52). */
export function weekByYear(obs: { t: number; v: number }[], years: number[]): (number | null)[][] {
  const grid = years.map(() => new Array<number | null>(52).fill(null));
  for (const o of obs) {
    const d = new Date(o.t);
    const yi = years.indexOf(d.getUTCFullYear());
    if (yi < 0) continue;
    const doy = Math.floor((o.t - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000);
    grid[yi]![Math.min(51, Math.floor(doy / 7))] = o.v;
  }
  return grid;
}

// ───────── builders (read stored data) ─────────

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

async function horizonDataset(db: Db): Promise<Grid3D | null> {
  const inst = await db.maybeOne<{ instrument_id: string; name: string | null }>(`SELECT instrument_id, name FROM equity.instruments WHERE exchange='INDEX' AND symbol='NIFTY50'`);
  if (!inst) return null;
  const bars = await loadBars(db, inst.instrument_id, 'raw') ?? await loadBars(db, inst.instrument_id);
  if (!bars || bars.close.length < 80) return null;
  const horizons = [1, 5, 10, 20, 40, 60];
  const s = horizonSurface(bars.dates, bars.close, horizons, 5);
  const col = (h: number) => s.values.map((r) => r[horizons.indexOf(h)]).filter((v): v is number => v !== null);
  const range = (h: number) => { const c = col(h); return `${pct(Math.min(...c))} to ${pct(Math.max(...c))}`; };
  const pos = (h: number) => { const c = col(h); return `${Math.round((c.filter((v) => v > 0).length / c.length) * 100)}%`; };
  return {
    id: 'horizon_surface', title: 'NIFTY 50: return over different holding periods',
    x: { title: 'Holding period (sessions)', labels: horizons.map(String) },
    z: { title: 'Start date', labels: s.starts },
    y: { title: 'Return', unit: '%' },
    values: s.values, colour: 'diverging',
    facts: [
      { label: '1-session returns ranged', value: range(1) },
      { label: '60-session returns ranged', value: range(60) },
      { label: 'Positive over 1 session', value: pos(1) },
      { label: 'Positive over 60 sessions', value: pos(60) },
    ],
    method: 'For a start session every week, the percentage change in the closing level after 1, 5, 10, 20, 40 and 60 trading sessions. Index levels are as published (not total return).',
    source: { name: 'EODHD end-of-day index levels, stored by ATLAS', series: ['NIFTY 50'], first: bars.dates[0] ?? null, last: bars.dates[bars.dates.length - 1] ?? null, note: 'About one year of history (free plan), so these are recent conditions, not long-run behaviour.' },
  };
}

async function paramDataset(db: Db, now: Date): Promise<Grid3D | null> {
  const from = iso(now.getTime() - 10 * 365.25 * 86_400_000);
  const obs = (await loadObs(db, 'fred:DCOILBRENTEU', from)).filter((o) => o.v > 0);
  if (obs.length < 800) return null;
  const close = obs.map((o) => o.v);
  const split = Math.floor(close.length * 0.7);
  const fasts = [5, 10, 20, 30, 50];
  const slows = [60, 90, 120, 150, 200];
  const cost = 0.001;
  const grid = (a: number, b: number) => slows.map((sl) => fasts.map((fa) => sharpe(crossoverReturns(close, fa, sl, a, b, cost))));
  // In-sample starts after the longest moving average has data, so every cell is measured on the same days.
  const isGrid = grid(Math.max(...slows), split);
  const oosGrid = grid(split, close.length);
  let best: [number, number] = [0, 0];
  isGrid.forEach((row, i) => row.forEach((v, j) => { if (v !== null && (isGrid[best[0]]![best[1]] ?? -Infinity) < v) best = [i, j]; }));
  const bh = (a: number, b: number) => sharpe(close.slice(a, b).map((c, i, arr) => (i ? c / arr[i - 1]! - 1 : 0)).slice(1));
  const rho = spearman(isGrid.flat(), oosGrid.flat());
  const f2 = (v: number | null | undefined) => (v === null || v === undefined ? 'n/a' : v.toFixed(2));
  return {
    id: 'param_surface', title: 'Brent crude: moving-average rule, 25 parameter pairs',
    x: { title: 'Fast average (days)', labels: fasts.map(String) },
    z: { title: 'Slow average (days)', labels: slows.map(String) },
    y: { title: 'Sharpe ratio (annualised)', unit: '' },
    values: isGrid, compare: { title: 'Out-of-sample (last 30% of days)', values: oosGrid }, colour: 'diverging',
    facts: [
      { label: `Best in-sample pair (${fasts[best[1]]}/${slows[best[0]]})`, value: `Sharpe ${f2(isGrid[best[0]]![best[1]])} in-sample, ${f2(oosGrid[best[0]]![best[1]])} out-of-sample` },
      { label: 'Buy and hold', value: `${f2(bh(Math.max(...slows), split))} in-sample, ${f2(bh(split, close.length))} out-of-sample` },
      { label: 'Rank agreement, in- vs out-of-sample (Spearman)', value: f2(rho) },
      { label: 'Split date', value: iso(obs[split]!.t) },
    ],
    method: 'Long when the fast average of daily closes is above the slow average at the previous close, otherwise in cash (0% return). 0.10% cost each time the position changes. Sharpe = mean daily return ÷ standard deviation × √252, risk-free rate 0. In-sample: the first 70% of the last ten years; out-of-sample: the remaining 30%, never used to choose parameters.',
    source: { name: 'FRED: Brent crude spot price (EIA), stored by ATLAS', series: ['DCOILBRENTEU'], first: iso(obs[0]!.t), last: iso(obs[obs.length - 1]!.t), note: 'Educational backtest on historical prices: not a forecast or a recommendation.' },
  };
}

async function termDataset(db: Db): Promise<Grid3D | null> {
  const ids = ['eia:RCLC1', 'eia:RCLC2', 'eia:RCLC3', 'eia:RCLC4'];
  const series = await Promise.all(ids.map((id) => loadObs(db, id)));
  if (series.some((s) => s.length < 50)) return null;
  const m = monthlyCurves(series);
  const slopes = m.values.map((r) => (r[0] && r[3] ? r[3] / r[0] - 1 : null)).filter((v): v is number => v !== null);
  const contangoShare = slopes.filter((s) => s > 0).length / slopes.length;
  let steep = 0;
  m.values.forEach((r, i) => { if (r[0] && r[3] && Math.abs(r[3] / r[0] - 1) > Math.abs((m.values[steep]![3] ?? 0) / (m.values[steep]![0] || 1) - 1)) steep = i; });
  const sr = m.values[steep]!;
  return {
    id: 'term_structure', title: 'WTI crude futures: the curve, month by month',
    x: { title: 'Contract (1 = nearest)', labels: ['1', '2', '3', '4'] },
    z: { title: 'Month', labels: m.months },
    y: { title: 'Settlement price', unit: 'USD/bbl' },
    values: m.values, colour: 'sequential',
    facts: [
      { label: 'Months in contango (contract 4 above contract 1)', value: `${Math.round(contangoShare * 100)}% of ${slopes.length}` },
      { label: 'Steepest month', value: `${m.months[steep]}: contract 1 ${sr[0]?.toFixed(2)}, contract 4 ${sr[3]?.toFixed(2)} (${pct((sr[3] ?? 0) / (sr[0] || 1) - 1)})` },
    ],
    method: 'The last settlement price of each month for the four nearest NYMEX WTI contracts. Contango: later contracts priced above nearer ones; backwardation: the reverse.',
    source: { name: 'U.S. Energy Information Administration, stored by ATLAS', series: ids.map((i) => i.replace('eia:', '')), first: m.months[0] ?? null, last: m.months[m.months.length - 1] ?? null, note: 'EIA stopped publishing these series in April 2024, so the curve ends there.' },
  };
}

async function seasonalityDataset(db: Db): Promise<Grid3D | null> {
  const obs = await loadObs(db, 'eia:WCESTUS1');
  if (obs.length < 200) return null;
  const lastYear = new Date(obs[obs.length - 1]!.t).getUTCFullYear();
  const years = Array.from({ length: 10 }, (_, i) => lastYear - 9 + i);
  const grid = weekByYear(obs.map((o) => ({ t: o.t, v: o.v / 1000 })), years);
  const avg = Array.from({ length: 52 }, (_, w) => { const vs = grid.slice(0, -1).map((r) => r[w]).filter((v): v is number => v !== null); return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null; });
  const low = avg.reduce<number>((b, v, i) => (v !== null && (avg[b] ?? Infinity) > v ? i : b), 0);
  const high = avg.reduce<number>((b, v, i) => (v !== null && (avg[b] ?? -Infinity) < v ? i : b), 0);
  return {
    id: 'seasonality', title: 'US commercial crude oil stocks by week and year',
    x: { title: 'Week of the year', labels: Array.from({ length: 52 }, (_, i) => String(i + 1)) },
    z: { title: 'Year', labels: years.map(String) },
    y: { title: 'Stocks', unit: 'million bbl' },
    values: grid, colour: 'sequential',
    facts: [
      { label: `Average high week (${years[0]}–${years[years.length - 2]})`, value: `week ${high + 1}: ${avg[high]?.toFixed(0)} million bbl` },
      { label: 'Average low week', value: `week ${low + 1}: ${avg[low]?.toFixed(0)} million bbl` },
      { label: 'Latest', value: `${iso(obs[obs.length - 1]!.t)}: ${(obs[obs.length - 1]!.v / 1000).toFixed(1)} million bbl` },
    ],
    method: 'Weekly US commercial crude oil inventories excluding the Strategic Petroleum Reserve, placed by week of the year (week 1 = 1–7 January). Averages exclude the current, incomplete year.',
    source: { name: 'U.S. Energy Information Administration (Weekly Petroleum Status Report), stored by ATLAS', series: ['WCESTUS1'], first: iso(obs[0]!.t), last: iso(obs[obs.length - 1]!.t), note: 'Weekly, published on Wednesdays for the week ending the previous Friday.' },
  };
}

export const CHART_IDS = ['horizon_surface', 'param_surface', 'term_structure', 'seasonality'] as const;

export async function academyChartRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // Recalculated at most every 30 minutes per chart: the inputs change daily at most.
  const cache = new Map<string, { at: number; data: Grid3D | null }>();
  app.get('/v1/academy/charts/:id', async (req) => {
    requireUser(req);
    const { id } = parse(z.object({ id: z.enum(CHART_IDS) }), req.params);
    const now = ctx.clock();
    const hit = cache.get(id);
    if (hit && now.getTime() - hit.at < 30 * 60_000) { if (!hit.data) throw notFound('The data for this chart is not stored yet.'); return hit.data; }
    const data = id === 'horizon_surface' ? await horizonDataset(ctx.db) : id === 'param_surface' ? await paramDataset(ctx.db, now) : id === 'term_structure' ? await termDataset(ctx.db) : await seasonalityDataset(ctx.db);
    cache.set(id, { at: now.getTime(), data });
    if (!data) throw notFound('The data for this chart is not stored yet.');
    return data;
  });
}
