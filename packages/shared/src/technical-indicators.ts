// Price-based indicators for session-traded series (Indian equities) and daily series. All functions are
// pure, work on observations in index order (one observation = one session), and return null where the
// look-back is not yet available. Nothing is filled or extrapolated. Tested against hand-calculated values
// in packages/shared/test/technical-indicators.test.ts. These describe history; they are not signals.

import type { Obs } from './crypto-analytics.js';

/**
 * Exponential moving average with smoothing k = 2 / (n + 1), seeded with the simple average of the
 * first n values (the usual convention). Index i is null until n values are available.
 */
export function ema(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (n < 1 || values.length < n) return out;
  const k = 2 / (n + 1);
  let prev = values.slice(0, n).reduce((s, x) => s + x, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * Relative Strength Index with Wilder's smoothing.
 * d_i = c_i − c_{i−1}; first average gain/loss = simple mean of the first n changes; then
 * avg = (avg_prev × (n − 1) + current) / n. RSI = 100 − 100 / (1 + avgGain / avgLoss); 100 when avgLoss = 0
 * (and 50 when the price did not move at all). Index i is null for i < n.
 */
export function rsi(closes: number[], n = 14): (number | null)[] {
  const out: (number | null)[] = closes.map(() => null);
  if (n < 1 || closes.length <= n) return out;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d > 0) g += d; else l -= d;
  }
  g /= n;
  l /= n;
  const value = () => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));
  out[n] = value();
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = value();
  }
  return out;
}

export interface Macd { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[]; params: { fast: number; slow: number; signal: number } }

/** MACD = EMA(fast) − EMA(slow); signal = EMA(signal) of MACD (from the first MACD value); histogram = MACD − signal. */
export function macd(closes: number[], fast = 12, slow = 26, signal = 9): Macd {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const line = closes.map((_, i) => (f[i] !== null && s[i] !== null ? f[i]! - s[i]! : null));
  const start = line.findIndex((x) => x !== null);
  const sig: (number | null)[] = closes.map(() => null);
  if (start >= 0) {
    const e = ema(line.slice(start) as number[], signal);
    e.forEach((v, j) => { sig[start + j] = v; });
  }
  return { macd: line, signal: sig, histogram: line.map((m, i) => (m !== null && sig[i] !== null ? m - sig[i]! : null)), params: { fast, slow, signal } };
}

/** n-session momentum (rate of change): c_i / c_{i−n} − 1. */
export function momentum(closes: number[], n: number): (number | null)[] {
  return closes.map((c, i) => (i >= n && n > 0 ? c / closes[i - n]! - 1 : null));
}

/** Rolling n-session return; same formula as momentum, returned as {t, v} points where defined. */
export function rollingReturns(obs: Obs[], n: number): { t: number; v: number }[] {
  const out: { t: number; v: number }[] = [];
  for (let i = n; i < obs.length; i++) out.push({ t: obs[i]!.t, v: obs[i]!.v / obs[i - n]!.v - 1 });
  return out;
}

/**
 * Relative strength of A against a benchmark B on the dates both have: RS_t = (A_t / A_0) / (B_t / B_0),
 * so 1.10 means A has done 10% better than B since the first shared date. Dates present in only one
 * series are dropped, never filled.
 */
export function relativeStrength(a: Obs[], b: Obs[]): { t: number; v: number }[] {
  const bm = new Map(b.map((o) => [o.t, o.v]));
  const shared = a.filter((o) => bm.has(o.t));
  if (!shared.length) return [];
  const a0 = shared[0]!.v;
  const b0 = bm.get(shared[0]!.t)!;
  return shared.map((o) => ({ t: o.t, v: o.v / a0 / (bm.get(o.t)! / b0) }));
}

export interface Bar { t: number; open: number; high: number; low: number; close: number }
export interface Gap { t: number; gap: number; previous_close: number; open: number; filled: boolean }

/**
 * Opening gaps: gap = open_t / close_{t−1} − 1, listed when |gap| ≥ minAbs. "Filled" means the same
 * session traded back to the previous close (low ≤ prev close for a gap up; high ≥ prev close for a gap down).
 * Consecutive bars are consecutive sessions; a missing session in the data makes that gap span it (callers
 * should check coverage).
 */
export function gaps(bars: Bar[], minAbs = 0.02): Gap[] {
  const out: Gap[] = [];
  for (let i = 1; i < bars.length; i++) {
    const p = bars[i - 1]!.close;
    const b = bars[i]!;
    const g = b.open / p - 1;
    if (Math.abs(g) < minAbs) continue;
    out.push({ t: b.t, gap: g, previous_close: p, open: b.open, filled: g > 0 ? b.low <= p : b.high >= p });
  }
  return out;
}

/** Highest and lowest close over the last `window` observations (default 252 sessions ≈ one year). */
export function rangeHighLow(obs: Obs[], window = 252): { ok: true; high: number; low: number; high_t: number; low_t: number; from_high: number; from_low: number; observations: number } | { ok: false; reason: string; needed: number; available: number } {
  if (obs.length < Math.min(window, 20)) return { ok: false, reason: 'not enough history', needed: Math.min(window, 20), available: obs.length };
  const w = obs.slice(-window);
  let hi = w[0]!;
  let lo = w[0]!;
  for (const o of w) {
    if (o.v > hi.v) hi = o;
    if (o.v < lo.v) lo = o;
  }
  const last = w[w.length - 1]!.v;
  return { ok: true, high: hi.v, low: lo.v, high_t: hi.t, low_t: lo.t, from_high: last / hi.v - 1, from_low: last / lo.v - 1, observations: w.length };
}

export const INDICATOR_DEFINITIONS = {
  rsi: 'RSI(14), Wilder smoothing: 100 − 100 / (1 + average gain / average loss) over 14 sessions.',
  macd: 'MACD(12, 26, 9): EMA(12) − EMA(26) of closes; signal = EMA(9) of MACD; histogram = MACD − signal.',
  momentum: 'Momentum(n): close today ÷ close n sessions ago − 1.',
  relative_strength: 'Relative strength vs a benchmark: (instrument ÷ its first value) ÷ (benchmark ÷ its first value), on shared dates only.',
  gaps: 'Opening gap: open ÷ previous close − 1; “filled” if the session traded back to the previous close.',
  range: '52-week range: highest and lowest close over the last 252 sessions.',
} as const;
