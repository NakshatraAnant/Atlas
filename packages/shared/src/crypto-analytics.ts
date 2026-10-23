// Deterministic quantitative analytics for daily price series (crypto and, where valid, equities).
// Every function is pure and documented with its formula, inputs and missing-data rule, and is tested
// against hand-calculated values in packages/shared/test/crypto-analytics.test.ts. Nothing here
// forecasts anything; results describe the stored history only.
//
// Conventions (all functions):
// - An observation is { t, v }: t = epoch milliseconds (UTC), v = a positive price.
// - Input series must be sorted by t and contain at most one observation per t.
// - Daily returns are computed only between observations exactly one interval apart. A gap breaks the
//   chain: the return across a gap is NOT computed (it would mix several days into one "daily" return).
// - Log returns ln(p_t / p_{t-1}) are used for volatility and correlation; simple returns p_t/p_s − 1 for
//   period performance.
// - Annualisation: crypto trades every calendar day, so √365 by default. Indian equities use √252
//   (trading days). The convention is always returned with the result.

export const DAY = 86_400_000;

export interface Obs { t: number; v: number }
export interface Ret { t: number; r: number }

export interface Insufficient { ok: false; reason: string; needed: number; available: number }
export type Result<T> = ({ ok: true } & T) | Insufficient;

const insufficient = (reason: string, needed: number, available: number): Insufficient => ({ ok: false, reason, needed, available });

export function isSortedUnique(obs: Obs[]): boolean {
  for (let i = 1; i < obs.length; i++) if (!(obs[i]!.t > obs[i - 1]!.t)) return false;
  return true;
}

/** Log returns between observations exactly `step` ms apart; gaps are skipped, not bridged. */
export function logReturns(obs: Obs[], step = DAY): Ret[] {
  const out: Ret[] = [];
  for (let i = 1; i < obs.length; i++) {
    const a = obs[i - 1]!;
    const b = obs[i]!;
    if (b.t - a.t !== step || !(a.v > 0) || !(b.v > 0)) continue;
    out.push({ t: b.t, r: Math.log(b.v / a.v) });
  }
  return out;
}

/** Simple returns between consecutive observations exactly `step` apart. */
export function simpleReturns(obs: Obs[], step = DAY): Ret[] {
  return logReturns(obs, step).map((x) => ({ t: x.t, r: Math.expm1(x.r) }));
}

/**
 * Period return: p_end / p_start − 1, where end is the last observation at or before `endT` and start is
 * the observation at end − days. If that exact day is missing, the nearest earlier observation within
 * `toleranceDays` is used and its actual date is returned; otherwise the history is insufficient.
 */
export function periodReturn(obs: Obs[], days: number, endT?: number, toleranceDays = 3): Result<{ value: number; start: Obs; end: Obs; days_actual: number }> {
  if (!obs.length) return insufficient('no observations', 2, 0);
  const endIdx = endT === undefined ? obs.length - 1 : lastAtOrBefore(obs, endT);
  if (endIdx < 0) return insufficient('no observation at or before the end date', 1, 0);
  const end = obs[endIdx]!;
  const target = end.t - days * DAY;
  const si = lastAtOrBefore(obs, target);
  if (si < 0 || target - obs[si]!.t > toleranceDays * DAY) return insufficient(`needs an observation within ${toleranceDays} days before ${new Date(target).toISOString().slice(0, 10)}`, days + 1, endIdx + 1);
  const start = obs[si]!;
  return { ok: true, value: end.v / start.v - 1, start, end, days_actual: Math.round((end.t - start.t) / DAY) };
}

function lastAtOrBefore(obs: Obs[], t: number): number {
  let lo = 0;
  let hi = obs.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (obs[mid]!.t <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation (n − 1). */
export function stdev(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

export interface VolOptions { window: number; annualisation?: number; minCoverage?: number }

/**
 * Realised volatility: sample standard deviation of daily log returns over the last `window` days,
 * multiplied by √annualisation. Requires at least `minCoverage` (default 90%) of the window's returns to
 * exist (gaps reduce the count; they are never filled).
 */
export function realisedVol(obs: Obs[], opts: VolOptions): Result<{ value: number; returns_used: number; window: number; annualisation: number; from: number; to: number }> {
  const ann = opts.annualisation ?? 365;
  const cov = opts.minCoverage ?? 0.9;
  if (!obs.length) return insufficient('no observations', opts.window + 1, 0);
  const last = obs[obs.length - 1]!.t;
  const rets = logReturns(obs).filter((x) => x.t > last - opts.window * DAY);
  const need = Math.ceil(opts.window * cov);
  if (rets.length < Math.max(2, need)) return insufficient(`needs at least ${need} daily returns in the last ${opts.window} days`, need, rets.length);
  return { ok: true, value: stdev(rets.map((x) => x.r)) * Math.sqrt(ann), returns_used: rets.length, window: opts.window, annualisation: ann, from: rets[0]!.t, to: rets[rets.length - 1]!.t };
}

/** Rolling realised volatility, one point per observation with a full-enough trailing window. */
export function rollingVol(obs: Obs[], opts: VolOptions): { t: number; v: number }[] {
  const ann = opts.annualisation ?? 365;
  const need = Math.ceil(opts.window * (opts.minCoverage ?? 0.9));
  const rets = logReturns(obs);
  const out: { t: number; v: number }[] = [];
  let lo = 0;
  for (let i = 0; i < rets.length; i++) {
    while (rets[lo]!.t <= rets[i]!.t - opts.window * DAY) lo++;
    const w = rets.slice(lo, i + 1);
    if (w.length >= Math.max(2, need)) out.push({ t: rets[i]!.t, v: stdev(w.map((x) => x.r)) * Math.sqrt(ann) });
  }
  return out;
}

export interface DrawdownInfo {
  peak: Obs;
  current_drawdown: number;
  max_drawdown: number;
  max_dd_peak: Obs;
  max_dd_trough: Obs;
  /** First observation after the trough at or above the prior peak; null if not yet recovered. */
  max_dd_recovery: Obs | null;
  recovery_days: number | null;
  /** Days since the running peak (0 at a new high). */
  days_since_peak: number;
  series: { t: number; dd: number }[];
}

/** Drawdown d_t = p_t / max(p_0..p_t) − 1. Max drawdown is the minimum d_t. */
export function drawdowns(obs: Obs[]): Result<DrawdownInfo> {
  if (obs.length < 2) return insufficient('needs at least 2 observations', 2, obs.length);
  let peak = obs[0]!;
  let maxDd = 0;
  let mPeak = obs[0]!;
  let mTrough = obs[0]!;
  const series: { t: number; dd: number }[] = [];
  for (const o of obs) {
    if (o.v >= peak.v) peak = o;
    const dd = o.v / peak.v - 1;
    series.push({ t: o.t, dd });
    if (dd < maxDd) {
      maxDd = dd;
      mPeak = peak;
      mTrough = o;
    }
  }
  let recovery: Obs | null = null;
  if (maxDd < 0) recovery = obs.find((o) => o.t > mTrough.t && o.v >= mPeak.v) ?? null;
  const last = obs[obs.length - 1]!;
  return {
    ok: true, peak, current_drawdown: last.v / peak.v - 1, max_drawdown: maxDd, max_dd_peak: mPeak, max_dd_trough: mTrough, max_dd_recovery: recovery,
    recovery_days: recovery ? Math.round((recovery.t - mPeak.t) / DAY) : null, days_since_peak: Math.round((last.t - peak.t) / DAY), series,
  };
}

/** Pairs of daily log returns on days where BOTH series have a return (aligned on UTC day). */
export function alignReturns(a: Obs[], b: Obs[]): { t: number; a: number; b: number }[] {
  const rb = new Map(logReturns(b).map((x) => [x.t, x.r]));
  const out: { t: number; a: number; b: number }[] = [];
  for (const x of logReturns(a)) {
    const y = rb.get(x.t);
    if (y !== undefined) out.push({ t: x.t, a: x.r, b: y });
  }
  return out;
}

/** Pearson correlation of two equal-length arrays. */
export function pearson(xs: number[], ys: number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? NaN : sxy / Math.sqrt(sxx * syy);
}

/** Correlation of aligned daily log returns over the trailing `window` days (all history if omitted). */
export function correlation(a: Obs[], b: Obs[], opts: { window?: number; minObs?: number } = {}): Result<{ value: number; n: number; from: number; to: number }> {
  let pairs = alignReturns(a, b);
  if (opts.window && pairs.length) {
    const last = pairs[pairs.length - 1]!.t;
    pairs = pairs.filter((p) => p.t > last - opts.window! * DAY);
  }
  const min = opts.minObs ?? 30;
  if (pairs.length < min) return insufficient(`needs at least ${min} days on which both series have a daily return`, min, pairs.length);
  const v = pearson(pairs.map((p) => p.a), pairs.map((p) => p.b));
  if (!Number.isFinite(v)) return insufficient('one series has no variation in the window', min, pairs.length);
  return { ok: true, value: v, n: pairs.length, from: pairs[0]!.t, to: pairs[pairs.length - 1]!.t };
}

export function rollingCorrelation(a: Obs[], b: Obs[], window: number, minObs = Math.ceil(window * 0.8)): { t: number; v: number }[] {
  const pairs = alignReturns(a, b);
  const out: { t: number; v: number }[] = [];
  let lo = 0;
  for (let i = 0; i < pairs.length; i++) {
    while (pairs[lo]!.t <= pairs[i]!.t - window * DAY) lo++;
    const w = pairs.slice(lo, i + 1);
    if (w.length >= minObs) {
      const v = pearson(w.map((p) => p.a), w.map((p) => p.b));
      if (Number.isFinite(v)) out.push({ t: pairs[i]!.t, v });
    }
  }
  return out;
}

/** Beta of a against benchmark b: cov(a, b) / var(b) on aligned daily log returns. */
export function beta(a: Obs[], b: Obs[], opts: { window?: number; minObs?: number } = {}): Result<{ value: number; n: number }> {
  let pairs = alignReturns(a, b);
  if (opts.window && pairs.length) {
    const last = pairs[pairs.length - 1]!.t;
    pairs = pairs.filter((p) => p.t > last - opts.window! * DAY);
  }
  const min = opts.minObs ?? 30;
  if (pairs.length < min) return insufficient(`needs at least ${min} aligned daily returns`, min, pairs.length);
  const ma = mean(pairs.map((p) => p.a));
  const mb = mean(pairs.map((p) => p.b));
  let cov = 0;
  let vb = 0;
  for (const p of pairs) {
    cov += (p.a - ma) * (p.b - mb);
    vb += (p.b - mb) ** 2;
  }
  if (vb === 0) return insufficient('benchmark has no variation', min, pairs.length);
  return { ok: true, value: cov / vb, n: pairs.length };
}

export interface DistributionInfo { n: number; mean: number; stdev: number; skew: number; excess_kurtosis: number; p01: number; p05: number; p50: number; p95: number; p99: number; worst: Ret; best: Ret; histogram: { from: number; to: number; count: number }[] }

/** Distribution of daily simple returns: moments (sample skewness and excess kurtosis), percentiles (linear interpolation) and a histogram. */
export function distribution(obs: Obs[], bins = 30): Result<DistributionInfo> {
  const rets = simpleReturns(obs);
  if (rets.length < 30) return insufficient('needs at least 30 daily returns', 30, rets.length);
  const xs = rets.map((r) => r.r);
  const n = xs.length;
  const m = mean(xs);
  const sd = stdev(xs);
  const m2 = xs.reduce((a, x) => a + (x - m) ** 2, 0) / n;
  const m3 = xs.reduce((a, x) => a + (x - m) ** 3, 0) / n;
  const m4 = xs.reduce((a, x) => a + (x - m) ** 4, 0) / n;
  const sorted = [...xs].sort((a, b) => a - b);
  const q = (p: number) => {
    const i = p * (n - 1);
    const lo = Math.floor(i);
    return sorted[lo]! + (sorted[Math.min(n - 1, lo + 1)]! - sorted[lo]!) * (i - lo);
  };
  const lo = sorted[0]!;
  const hi = sorted[n - 1]!;
  const w = (hi - lo) / bins || 1;
  const hist = Array.from({ length: bins }, (_, i) => ({ from: lo + i * w, to: lo + (i + 1) * w, count: 0 }));
  for (const x of xs) hist[Math.min(bins - 1, Math.floor((x - lo) / w))]!.count++;
  const byR = [...rets].sort((a, b) => a.r - b.r);
  return { ok: true, n, mean: m, stdev: sd, skew: m3 / m2 ** 1.5, excess_kurtosis: m4 / m2 ** 2 - 3, p01: q(0.01), p05: q(0.05), p50: q(0.5), p95: q(0.95), p99: q(0.99), worst: byR[0]!, best: byR[n - 1]!, histogram: hist };
}

/** Simple moving average of the last n observations ending at index i (inclusive); null if fewer than n. */
export function sma(obs: Obs[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < obs.length; i++) {
    sum += obs[i]!.v;
    if (i >= n) sum -= obs[i - n]!.v;
    out.push(i >= n - 1 ? sum / n : null);
  }
  return out;
}

export type Regime = 'uptrend_calm' | 'uptrend_volatile' | 'downtrend_calm' | 'downtrend_volatile';

/**
 * Historical regime classification (descriptive, not predictive):
 *   trend      = price above (up) or below (down) its 200-observation simple moving average
 *   volatility = 30-day realised vol above (volatile) or at/below (calm) the median of that 30-day vol
 *                over the whole available history
 * Days without a 200-observation SMA or a 30-day vol are unclassified.
 */
export function regimes(obs: Obs[]): Result<{ current: Regime; median_vol: number; segments: { from: number; to: number; regime: Regime }[]; share: Record<Regime, number> }> {
  if (obs.length < 230) return insufficient('needs at least 230 daily observations (200-day average plus a 30-day volatility window)', 230, obs.length);
  const s200 = sma(obs, 200);
  const vols = new Map(rollingVol(obs, { window: 30 }).map((x) => [x.t, x.v]));
  const allV = [...vols.values()].sort((a, b) => a - b);
  const median = allV[Math.floor(allV.length / 2)]!;
  const days: { t: number; regime: Regime }[] = [];
  obs.forEach((o, i) => {
    const s = s200[i];
    const v = vols.get(o.t);
    if (s === null || s === undefined || v === undefined) return;
    const up = o.v > s;
    const volatile = v > median;
    days.push({ t: o.t, regime: `${up ? 'uptrend' : 'downtrend'}_${volatile ? 'volatile' : 'calm'}` as Regime });
  });
  if (!days.length) return insufficient('no day has both a 200-day average and a 30-day volatility', 230, obs.length);
  const segments: { from: number; to: number; regime: Regime }[] = [];
  for (const d of days) {
    const last = segments[segments.length - 1];
    if (last && last.regime === d.regime && d.t - last.to <= DAY) last.to = d.t;
    else segments.push({ from: d.t, to: d.t, regime: d.regime });
  }
  const share = { uptrend_calm: 0, uptrend_volatile: 0, downtrend_calm: 0, downtrend_volatile: 0 } as Record<Regime, number>;
  for (const d of days) share[d.regime] += 1 / days.length;
  return { ok: true, current: days[days.length - 1]!.regime, median_vol: median, segments, share };
}

/** Compound annual growth rate over the observed span: (end/start)^(365.25/days) − 1. Only for spans of at least one year. */
export function cagr(obs: Obs[]): Result<{ value: number; years: number }> {
  if (obs.length < 2) return insufficient('needs at least 2 observations', 2, obs.length);
  const days = (obs[obs.length - 1]!.t - obs[0]!.t) / DAY;
  if (days < 365) return insufficient('CAGR is shown only for spans of at least one year', 365, Math.round(days));
  return { ok: true, value: (obs[obs.length - 1]!.v / obs[0]!.v) ** (365.25 / days) - 1, years: days / 365.25 };
}

/**
 * calendar 'days' (default): crypto, one observation per calendar day; a return needs consecutive days.
 * calendar 'sessions': exchange sessions; consecutive observations are consecutive sessions unless more
 * than MAX_SESSION_GAP apart (weekends and holidays are shorter than that; a longer gap is missing data).
 */
export interface BacktestParams { fast: number; slow: number; fee_bps: number; slippage_bps: number; calendar?: 'days' | 'sessions' }
export const MAX_SESSION_GAP = 5 * DAY;
export interface BacktestResult {
  params: BacktestParams;
  strategy: { t: number; v: number }[];
  buy_hold: { t: number; v: number }[];
  trades: number;
  exposure: number;
  strategy_total_return: number;
  buy_hold_total_return: number;
  strategy_max_drawdown: number;
  buy_hold_max_drawdown: number;
  strategy_vol: number;
  buy_hold_vol: number;
  costs_paid: number;
  assumptions: string[];
}

/**
 * Moving-average trend rule, long or in cash, versus buy and hold on the same series.
 * - Signal on day t uses closes up to and including t: long when SMA(fast) > SMA(slow).
 * - The position changes at the close of day t+1 (one-day execution lag), so the rule never uses a
 *   price it could not have known (no look-ahead).
 * - Each change of position costs fee_bps + slippage_bps of the equity at that moment.
 * - Cash earns nothing. Only days with a return (no gap) move equity; a gap leaves equity unchanged.
 */
export function backtestSma(obs: Obs[], p: BacktestParams): Result<BacktestResult> {
  if (!(p.fast >= 2 && p.slow > p.fast)) return insufficient('fast must be at least 2 and smaller than slow', p.slow + 30, obs.length);
  if (obs.length < p.slow + 30) return insufficient(`needs at least ${p.slow + 30} observations`, p.slow + 30, obs.length);
  const f = sma(obs, p.fast);
  const s = sma(obs, p.slow);
  const cost = (p.fee_bps + p.slippage_bps) / 10_000;
  const sessions = p.calendar === 'sessions';
  let pos = 0;
  let pending: number | null = null;
  let eq = 1;
  let bh = 1;
  let trades = 0;
  let longDays = 0;
  let costs = 0;
  const start = p.slow - 1;
  const strategy: { t: number; v: number }[] = [{ t: obs[start]!.t, v: 1 }];
  const buyHold: { t: number; v: number }[] = [{ t: obs[start]!.t, v: 1 }];
  for (let i = start + 1; i < obs.length; i++) {
    const dt = obs[i]!.t - obs[i - 1]!.t;
    const r = (sessions ? dt > 0 && dt <= MAX_SESSION_GAP : dt === DAY) ? obs[i]!.v / obs[i - 1]!.v - 1 : 0;
    eq *= 1 + pos * r;
    bh *= 1 + r;
    if (pos) longDays++;
    // Execute yesterday's signal at today's close.
    if (pending !== null && pending !== pos) {
      costs += eq * cost;
      eq *= 1 - cost;
      pos = pending;
      trades++;
    }
    const fi = f[i];
    const si = s[i];
    pending = fi !== null && si !== null && fi !== undefined && si !== undefined ? (fi > si ? 1 : 0) : pos;
    strategy.push({ t: obs[i]!.t, v: eq });
    buyHold.push({ t: obs[i]!.t, v: bh });
  }
  const dd = (xs: { t: number; v: number }[]) => (drawdowns(xs) as { ok: true } & DrawdownInfo).max_drawdown;
  const vol = (xs: { t: number; v: number }[]) => stdev(sessions ? xs.slice(1).map((x, i) => Math.log(x.v / xs[i]!.v)) : logReturns(xs).map((x) => x.r)) * Math.sqrt(sessions ? 252 : 365);
  return {
    ok: true, params: p, strategy, buy_hold: buyHold, trades, exposure: longDays / (obs.length - start - 1), costs_paid: costs,
    strategy_total_return: eq - 1, buy_hold_total_return: bh - 1, strategy_max_drawdown: dd(strategy), buy_hold_max_drawdown: dd(buyHold), strategy_vol: vol(strategy), buy_hold_vol: vol(buyHold),
    assumptions: [
      sessions
        ? 'Session calendar: one observation per trading session; returns run session to session, a gap of more than 5 calendar days (missing data) earns nothing, and volatility is annualised with √252.'
        : 'Calendar days: returns only between consecutive days; volatility is annualised with √365.',
      'Signals use closing prices up to the signal day; trades execute at the next day\'s close (no look-ahead).',
      `Each position change costs ${p.fee_bps} bp in fees plus ${p.slippage_bps} bp in slippage; real costs vary by venue, size and liquidity.`,
      'Cash earns no interest; no taxes, funding rates or borrowing are modelled.',
      'One asset on one venue: survivorship bias applies (the asset still exists and is listed today).',
      'Parameters chosen after looking at the data are data-snooped: a good result here is weak evidence.',
      'Past results do not predict future results.',
    ],
  };
}

/** Mean volume over the last `short` vs last `long` observations (ratio > 1 means recent volume is above its longer average). */
export function volumeTrend(vols: (number | null)[], short = 30, long = 90): Result<{ short_avg: number; long_avg: number; ratio: number }> {
  const v = vols.filter((x): x is number => x !== null && Number.isFinite(x) && x >= 0);
  if (v.length < long) return insufficient(`needs ${long} volume observations`, long, v.length);
  const s = mean(v.slice(-short));
  const l = mean(v.slice(-long));
  return l > 0 ? { ok: true, short_avg: s, long_avg: l, ratio: s / l } : insufficient('long average volume is zero', long, v.length);
}

/**
 * Align a continuously traded (crypto) daily series to an exchange-session (equity) calendar:
 * for each equity session date D, take the crypto observation stamped D (UTC). Crypto days missing from
 * the session calendar (weekends, holidays) are dropped, so returns then span the same session-to-session
 * interval for both series. Returns per-session pairs of prices.
 */
export function alignToSessions(sessions: Obs[], crypto: Obs[]): { t: number; equity: number; crypto: number }[] {
  const c = new Map(crypto.map((o) => [Math.floor(o.t / DAY) * DAY, o.v]));
  const out: { t: number; equity: number; crypto: number }[] = [];
  for (const s of sessions) {
    const d = Math.floor(s.t / DAY) * DAY;
    const v = c.get(d);
    if (v !== undefined) out.push({ t: d, equity: s.v, crypto: v });
  }
  return out;
}

/** Correlation of session-to-session log returns for series aligned with alignToSessions. */
export function sessionCorrelation(aligned: { t: number; equity: number; crypto: number }[], minObs = 30): Result<{ value: number; n: number }> {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 1; i < aligned.length; i++) {
    const a = aligned[i - 1]!;
    const b = aligned[i]!;
    if (b.t - a.t > 5 * DAY) continue; // a long break (e.g. data gap) is not a session-to-session return
    xs.push(Math.log(b.equity / a.equity));
    ys.push(Math.log(b.crypto / a.crypto));
  }
  if (xs.length < minObs) return insufficient(`needs at least ${minObs} aligned session returns`, minObs, xs.length);
  const v = pearson(xs, ys);
  return Number.isFinite(v) ? { ok: true, value: v, n: xs.length } : insufficient('a series has no variation', minObs, xs.length);
}
