// Commodity analytics on stored source series (pure; tested in packages/shared/test/commodity-analytics.test.ts
// against hand calculations). Series have their own frequency (daily spot assessments, weekly, monthly
// averages); calculations respect it and never mix frequencies silently. Missing observations are gaps.
// Prices can be zero or negative (WTI spot, 20 Apr 2020): returns across a non-positive price are undefined
// and are counted as skipped, never computed.

import { DAY, mean, stdev, type Obs } from './crypto-analytics.js';

export type Frequency = 'daily' | 'weekly' | 'monthly';

/** Periods per year: daily spot assessments are published on business days (≈252), weekly 52, monthly 12. */
export const PERIODS_PER_YEAR: Record<Frequency, number> = { daily: 252, weekly: 52, monthly: 12 };
/** Longest gap between consecutive observations that still counts as one period (longer = missing data). */
export const MAX_GAP_DAYS: Record<Frequency, number> = { daily: 5, weekly: 10, monthly: 35 };

export interface PeriodicReturns { returns: { t: number; r: number }[]; skipped_gap: number; skipped_non_positive: number }

export function periodicReturns(obs: Obs[], frequency: Frequency): PeriodicReturns {
  const out: PeriodicReturns = { returns: [], skipped_gap: 0, skipped_non_positive: 0 };
  for (let i = 1; i < obs.length; i++) {
    const a = obs[i - 1]!;
    const b = obs[i]!;
    if ((b.t - a.t) / DAY > MAX_GAP_DAYS[frequency]) { out.skipped_gap++; continue; }
    if (!(a.v > 0) || !(b.v > 0)) { out.skipped_non_positive++; continue; }
    out.returns.push({ t: b.t, r: b.v / a.v - 1 });
  }
  return out;
}

/** Last observation in each calendar month (UTC): turns daily or weekly series into month-end values. */
export function monthEnd(obs: Obs[]): Obs[] {
  const out: Obs[] = [];
  for (const o of obs) {
    const d = new Date(o.t);
    const key = d.getUTCFullYear() * 12 + d.getUTCMonth();
    const last = out[out.length - 1];
    if (last && (() => { const l = new Date(last.t); return l.getUTCFullYear() * 12 + l.getUTCMonth() === key; })()) out[out.length - 1] = o;
    else out.push(o);
  }
  return out;
}

export interface SeasonalityRow { month: number; mean: number | null; median: number | null; positive_share: number | null; years: number }
export interface Seasonality { ok: true; rows: SeasonalityRow[]; years_covered: number; basis: string; warning: string | null }

/**
 * Average month-on-month change by calendar month. Daily and weekly series are reduced to month-end values
 * first; monthly series (IMF averages) use their own monthly values, so the change is between monthly
 * averages. A month needs two consecutive monthly values; fewer than 5 years per month earns a warning.
 */
export function seasonality(obs: Obs[], frequency: Frequency): Seasonality | { ok: false; reason: string } {
  const m = frequency === 'monthly' ? obs : monthEnd(obs);
  const by: number[][] = Array.from({ length: 12 }, () => []);
  for (let i = 1; i < m.length; i++) {
    const a = new Date(m[i - 1]!.t);
    const b = new Date(m[i]!.t);
    const consecutive = b.getUTCFullYear() * 12 + b.getUTCMonth() - (a.getUTCFullYear() * 12 + a.getUTCMonth()) === 1;
    if (!consecutive || !(m[i - 1]!.v > 0) || !(m[i]!.v > 0)) continue;
    by[b.getUTCMonth()]!.push(m[i]!.v / m[i - 1]!.v - 1);
  }
  const counts = by.map((x) => x.length);
  if (Math.max(...counts) < 2) return { ok: false, reason: 'needs at least two years of monthly changes' };
  const med = (xs: number[]) => { const s = [...xs].sort((p, q) => p - q); const k = s.length >> 1; return s.length % 2 ? s[k]! : (s[k - 1]! + s[k]!) / 2; };
  const rows = by.map((xs, month) => ({ month: month + 1, mean: xs.length ? mean(xs) : null, median: xs.length ? med(xs) : null, positive_share: xs.length ? xs.filter((x) => x > 0).length / xs.length : null, years: xs.length }));
  return {
    ok: true, rows, years_covered: Math.min(...counts.filter((c) => c > 0)),
    basis: frequency === 'monthly' ? 'change between monthly average prices' : 'change between month-end observations',
    warning: Math.min(...counts) < 5 ? 'Fewer than 5 years for some months: these averages are noisy and describe the past only.' : null,
  };
}

/** a·fa − b·fb on the dates both have (units converted by the caller's multipliers, which are returned). */
export function seriesSpread(a: Obs[], b: Obs[], fa = 1, fb = 1): { t: number; v: number }[] {
  const bm = new Map(b.map((o) => [o.t, o.v]));
  return a.filter((o) => bm.has(o.t)).map((o) => ({ t: o.t, v: o.v * fa - bm.get(o.t)! * fb }));
}

export interface TermStructure { state: 'contango' | 'backwardation' | 'flat'; front: number; back: number; slope: number; slope_pct: number; positions: { position: number; value: number }[]; roll_yield_annualised: number | null }

/**
 * Shape of a futures strip on one date, from contract positions (1 = nearest). Contango: later contracts
 * above the nearest (slope > +0.25%); backwardation: below (< −0.25%); otherwise flat. The roll-yield proxy
 * (C1 / C2 − 1) × 12 assumes monthly-spaced expiries (true for NYMEX WTI positions 1 and 2) and is
 * undefined when either price is not positive.
 */
export function termStructure(points: { position: number; value: number }[]): TermStructure | null {
  const p = [...points].sort((a, b) => a.position - b.position);
  if (p.length < 2) return null;
  const front = p[0]!.value;
  const back = p[p.length - 1]!.value;
  const slope = back - front;
  const slopePct = front > 0 ? slope / front : NaN;
  const c2 = p.find((x) => x.position === 2);
  return {
    state: !(front > 0) ? 'flat' : slopePct > 0.0025 ? 'contango' : slopePct < -0.0025 ? 'backwardation' : 'flat',
    front, back, slope, slope_pct: slopePct, positions: p,
    roll_yield_annualised: p[0]!.position === 1 && c2 && front > 0 && c2.value > 0 ? (front / c2.value - 1) * 12 : null,
  };
}

export interface SeasonalZ { ok: true; latest: number; latest_t: number; mean: number; stdev: number; z: number | null; comparisons: number; years: number[] }

/**
 * Latest weekly value against the same week of earlier years (±3 days of the same calendar date), e.g.
 * crude inventories against the prior five years. z = (latest − mean) / stdev; null when stdev is 0.
 */
export function seasonalZ(obs: Obs[], years = 5): SeasonalZ | { ok: false; reason: string } {
  if (!obs.length) return { ok: false, reason: 'no observations' };
  const last = obs[obs.length - 1]!;
  const ld = new Date(last.t);
  const comps: { year: number; v: number }[] = [];
  for (let k = 1; k <= years; k++) {
    const target = Date.UTC(ld.getUTCFullYear() - k, ld.getUTCMonth(), ld.getUTCDate());
    const near = obs.filter((o) => Math.abs(o.t - target) <= 3 * DAY).sort((a, b) => Math.abs(a.t - target) - Math.abs(b.t - target))[0];
    if (near) comps.push({ year: ld.getUTCFullYear() - k, v: near.v });
  }
  if (comps.length < 3) return { ok: false, reason: `needs the same week in at least 3 earlier years (found ${comps.length})` };
  const vs = comps.map((c) => c.v);
  const m = mean(vs);
  const s = stdev(vs);
  return { ok: true, latest: last.v, latest_t: last.t, mean: m, stdev: s, z: s > 0 ? (last.v - m) / s : null, comparisons: comps.length, years: comps.map((c) => c.year) };
}
