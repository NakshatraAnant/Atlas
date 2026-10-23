import { backtestSma, DAY, drawdowns, mean, stdev, type DrawdownInfo, type Insufficient, type Obs, type Result } from './crypto-analytics.js';

// Cross-asset research calculations shared by the API (and testable in isolation): alignment across
// calendars, risk-adjusted ratios, portfolios, walk-forward evaluation, stress scenarios and the
// descriptive rules behind research discovery. Conventions match crypto-analytics.ts and are tested in
// packages/shared/test/research-analytics.test.ts against hand-calculated values.

const no = (reason: string, needed: number, available: number): Insufficient => ({ ok: false, reason, needed, available });

export type Calendar = 'continuous' | 'sessions';

/**
 * Aligns several daily series on the dates they ALL have (UTC date of each observation). When any
 * series follows exchange sessions, the intersection is a session calendar and returns are
 * session-to-session (annualise with 252); when all trade continuously, daily (annualise with 365).
 * Nothing is forward-filled.
 */
export function alignSeries(series: Obs[][]): { dates: number[]; values: number[][] } {
  if (!series.length) return { dates: [], values: [] };
  const maps = series.map((s) => new Map(s.map((o) => [Math.floor(o.t / DAY) * DAY, o.v])));
  const dates = [...maps[0]!.keys()].filter((d) => maps.every((m) => m.has(d))).sort((a, b) => a - b);
  return { dates, values: maps.map((m) => dates.map((d) => m.get(d)!)) };
}

/** Simple returns between consecutive aligned observations; an interval longer than maxGapDays breaks the chain (null). */
export function alignedReturns(dates: number[], values: number[], maxGapDays: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 1; i < dates.length; i++) out.push((dates[i]! - dates[i - 1]!) / DAY > maxGapDays ? null : values[i]! / values[i - 1]! - 1);
  return out;
}

export interface RiskRatios { mean_return: number; vol: number; sharpe: number | null; sortino: number | null; downside_dev: number; periods: number; annualisation: number; risk_free: number }

/**
 * Annualised Sharpe = (mean(r) − rf/N) / stdev(r) × √N; Sortino uses downside deviation
 * √(mean(min(0, r − rf/N)²)) instead of stdev. r are periodic simple returns, N periods per year,
 * rf the annual risk-free rate supplied by the caller (shown with the result). Needs ≥ 30 returns.
 */
export function riskRatios(returns: number[], periodsPerYear: number, riskFree = 0): Result<RiskRatios> {
  if (returns.length < 30) return no('needs at least 30 periodic returns', 30, returns.length);
  const rfp = riskFree / periodsPerYear;
  const m = mean(returns);
  const sd = stdev(returns);
  const downside = Math.sqrt(mean(returns.map((r) => Math.min(0, r - rfp) ** 2)));
  return {
    ok: true, mean_return: m * periodsPerYear, vol: sd * Math.sqrt(periodsPerYear),
    sharpe: sd > 0 ? ((m - rfp) / sd) * Math.sqrt(periodsPerYear) : null,
    sortino: downside > 0 ? ((m - rfp) / downside) * Math.sqrt(periodsPerYear) : null,
    downside_dev: downside * Math.sqrt(periodsPerYear), periods: returns.length, annualisation: periodsPerYear, risk_free: riskFree,
  };
}

export interface PortfolioResult {
  dates: number[];
  value: number[];
  weights_used: number[];
  contributions: number[];
  rebalances: number;
  total_return: number;
  drawdown: DrawdownInfo | null;
  returns: number[];
  hhi: number;
  max_weight: number;
}

/**
 * Hypothetical portfolio on aligned prices. Weights must sum to 1 (±0.001). Starts at 1.0 on the first
 * aligned date. 'monthly': back to target weights at the close of the last aligned date of each calendar month (UTC);
 * 'none': buy and hold (weights drift). No costs, cash or leverage. Contribution of holding i is the sum
 * over periods of (its weight at the start of the period × its return), so contributions add up to the
 * sum of periodic portfolio returns (an arithmetic attribution; it does not compound exactly).
 */
export function portfolio(dates: number[], prices: number[][], weights: number[], rebalance: 'none' | 'monthly'): Result<PortfolioResult> {
  const total = weights.reduce((a, b) => a + b, 0);
  if (weights.some((w) => !(w > 0))) return no('every weight must be positive', 1, 0);
  if (Math.abs(total - 1) > 0.001) return no(`weights must add up to 100% (they add up to ${(total * 100).toFixed(2)}%)`, 1, 0);
  if (dates.length < 2) return no('needs at least 2 aligned dates', 2, dates.length);
  const n = weights.length;
  let hold = weights.slice();
  const value = [1];
  const contributions = new Array(n).fill(0);
  const returns: number[] = [];
  let rebalances = 0;
  for (let t = 1; t < dates.length; t++) {
    const r = prices.map((p) => p[t]! / p[t - 1]! - 1);
    const pr = hold.reduce((a, w, i) => a + w * r[i]!, 0);
    hold.forEach((w, i) => { contributions[i] += w * r[i]!; });
    returns.push(pr);
    value.push(value[t - 1]! * (1 + pr));
    // Drift: new weights after the period's returns.
    hold = hold.map((w, i) => (w * (1 + r[i]!)) / (1 + pr));
    if (rebalance === 'monthly' && t + 1 < dates.length && new Date(dates[t + 1]!).getUTCMonth() !== new Date(dates[t]!).getUTCMonth()) {
      hold = weights.slice();
      rebalances++;
    }
  }
  const dd = drawdowns(dates.map((d, i) => ({ t: d, v: value[i]! })));
  return { ok: true, dates, value, weights_used: weights, contributions, rebalances, total_return: value[value.length - 1]! - 1, drawdown: dd.ok ? dd : null, returns, hhi: weights.reduce((a, w) => a + w * w, 0), max_weight: Math.max(...weights) };
}

/** Sample covariance matrix of aligned return columns. */
export function covariance(cols: number[][]): number[][] {
  const ms = cols.map(mean);
  const n = cols[0]?.length ?? 0;
  return cols.map((a, i) => cols.map((b, j) => {
    let s = 0;
    for (let k = 0; k < n; k++) s += (a[k]! - ms[i]!) * (b[k]! - ms[j]!);
    return n > 1 ? s / (n - 1) : NaN;
  }));
}

export interface ScenarioInput { weights: number[]; shocks: number[]; volMultiplier: number; correlationShift: number }
export interface ScenarioResult { baseline_vol: number; stressed_vol: number; shock_return: number; per_asset: { weight: number; shock: number; contribution: number }[]; stressed_correlations: number[][]; notes: string[] }

/**
 * Stress test on a covariance estimated from history:
 *   shock return   = Σ wᵢ·shockᵢ (an instantaneous user-assumed move, not a forecast)
 *   stressed vol   = √(wᵀ Σ' w) × √N, where Σ'ᵢⱼ = ρ'ᵢⱼ·σᵢσⱼ·k², ρ'ᵢⱼ = clip(ρᵢⱼ + Δρ, −1, 1) off the diagonal
 * k is the volatility multiplier and Δρ the correlation shift, both user assumptions.
 */
export function stressScenario(cov: number[][], periodsPerYear: number, s: ScenarioInput): Result<ScenarioResult> {
  const n = s.weights.length;
  if (cov.length !== n || s.shocks.length !== n) return no('weights, shocks and covariance must cover the same holdings', n, cov.length);
  if (!(s.volMultiplier > 0)) return no('volatility multiplier must be positive', 1, 0);
  const sd = cov.map((row, i) => Math.sqrt(row[i]!));
  if (sd.some((x) => !(x > 0))) return no('every holding needs non-zero historical variance', n, sd.filter((x) => x > 0).length);
  const rho = cov.map((row, i) => row.map((c, j) => (i === j ? 1 : Math.max(-1, Math.min(1, c / (sd[i]! * sd[j]!) + s.correlationShift)))));
  const q = (m: (i: number, j: number) => number) => {
    let v = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v += s.weights[i]! * s.weights[j]! * m(i, j);
    return Math.sqrt(Math.max(0, v) * periodsPerYear);
  };
  const baseline = q((i, j) => cov[i]![j]!);
  const stressed = q((i, j) => rho[i]![j]! * sd[i]! * sd[j]! * s.volMultiplier ** 2);
  const per = s.weights.map((w, i) => ({ weight: w, shock: s.shocks[i]!, contribution: w * s.shocks[i]! }));
  return {
    ok: true, baseline_vol: baseline, stressed_vol: stressed, shock_return: per.reduce((a, p) => a + p.contribution, 0), per_asset: per, stressed_correlations: rho,
    notes: ['Shocks, the volatility multiplier and the correlation shift are your assumptions, not forecasts.', 'Covariance is estimated from the aligned historical returns shown; it changes over time.', 'Shifting all correlations by the same amount can produce combinations that are not internally consistent; results are a rough sensitivity, not a full risk model.'],
  };
}

export interface WalkForwardFold { train_from: number; train_to: number; test_from: number; test_to: number; fast: number; slow: number; train_return: number; test_return: number; test_trades: number }
export interface WalkForwardResult { folds: WalkForwardFold[]; oos_curve: { t: number; v: number }[]; oos_total_return: number; buy_hold_total_return: number; in_sample_mean_return: number; out_of_sample_mean_return: number; grid_size: number; assumptions: string[] }

/**
 * Walk-forward evaluation of the SMA trend rule. For each fold: pick (fast, slow) with the best total
 * return on the training window, then run those parameters on the following test window only. The test
 * windows do not overlap and are chained into one out-of-sample curve. Each test run includes `slow`
 * days of warm-up taken from the end of the training window, so signals use only past prices.
 */
export function walkForward(obs: Obs[], grid: { fast: number; slow: number }[], trainDays: number, testDays: number, costs: { fee_bps: number; slippage_bps: number; calendar?: 'days' | 'sessions' }): Result<WalkForwardResult> {
  const valid = grid.filter((g) => g.fast >= 2 && g.slow > g.fast);
  if (!valid.length) return no('the parameter grid has no valid (fast < slow) pair', 1, 0);
  const maxSlow = Math.max(...valid.map((g) => g.slow));
  if (trainDays < maxSlow + 30) return no(`the training window must be at least ${maxSlow + 30} days for these parameters`, maxSlow + 30, trainDays);
  if (testDays < 30) return no('the test window must be at least 30 days', 30, testDays);
  if (obs.length < trainDays + testDays) return no(`needs at least ${trainDays + testDays} observations`, trainDays + testDays, obs.length);
  const folds: WalkForwardFold[] = [];
  const curve: { t: number; v: number }[] = [];
  let equity = 1;
  for (let start = 0; start + trainDays + testDays <= obs.length; start += testDays) {
    const train = obs.slice(start, start + trainDays);
    let best: { g: { fast: number; slow: number }; ret: number } | null = null;
    for (const g of valid) {
      const r = backtestSma(train, { fast: g.fast, slow: g.slow, ...costs });
      if (r.ok && (!best || r.strategy_total_return > best.ret)) best = { g, ret: r.strategy_total_return };
    }
    if (!best) break;
    const testWithWarmup = obs.slice(start + trainDays - best.g.slow, start + trainDays + testDays);
    const test = backtestSma(testWithWarmup, { fast: best.g.fast, slow: best.g.slow, ...costs });
    if (!test.ok) break;
    // The strategy curve starts at the end of warm-up, i.e. at the first test day.
    for (const p of test.strategy.slice(1)) curve.push({ t: p.t, v: equity * p.v });
    equity *= 1 + test.strategy_total_return;
    folds.push({ train_from: train[0]!.t, train_to: train[train.length - 1]!.t, test_from: obs[start + trainDays]!.t, test_to: obs[start + trainDays + testDays - 1]!.t, fast: best.g.fast, slow: best.g.slow, train_return: best.ret, test_return: test.strategy_total_return, test_trades: test.trades });
  }
  if (!folds.length) return no('no complete fold fits the data', trainDays + testDays, obs.length);
  const first = folds[0]!.test_from;
  const last = folds[folds.length - 1]!.test_to;
  const p0 = obs.find((o) => o.t === first)!.v;
  const p1 = obs.find((o) => o.t === last)!.v;
  return {
    ok: true, folds, oos_curve: curve, oos_total_return: equity - 1, buy_hold_total_return: p1 / p0 - 1,
    in_sample_mean_return: mean(folds.map((f) => f.train_return)), out_of_sample_mean_return: mean(folds.map((f) => f.test_return)), grid_size: valid.length,
    assumptions: [
      'Parameters are chosen on each training window only and evaluated on the next, unseen test window.',
      'In-sample results are optimistic by construction; compare them with the out-of-sample results.',
      `Costs: ${costs.fee_bps} bp fees + ${costs.slippage_bps} bp slippage per position change. No taxes, funding or cash interest.`,
      costs.calendar === 'sessions' ? 'Training and test windows are counted in trading sessions (stored observations), not calendar days.' : 'Training and test windows are counted in daily observations.',
      'One instrument with today’s history: survivorship bias applies, and the parameter grid itself was chosen by a person (data snooping).',
      'Past results do not predict future results.',
    ],
  };
}

export interface CorrelationShift { from: number; to: number; before: number; after: number; change: number }
/**
 * Descriptive regime changes in a rolling correlation: points where the rolling value moved by at
 * least `minChange` compared with `lag` days earlier. Overlapping detections within `lag` are merged.
 */
export function correlationShifts(rolling: { t: number; v: number }[], lag: number, minChange: number): CorrelationShift[] {
  const out: CorrelationShift[] = [];
  const byT = new Map(rolling.map((p) => [p.t, p.v]));
  for (const p of rolling) {
    const before = byT.get(p.t - lag * DAY);
    if (before === undefined || Math.abs(p.v - before) < minChange) continue;
    const last = out[out.length - 1];
    if (last && p.t - last.to <= lag * DAY) {
      if (Math.abs(p.v - last.before) > Math.abs(last.change)) Object.assign(last, { to: p.t, after: p.v, change: p.v - last.before });
      else last.to = p.t;
      continue;
    }
    out.push({ from: p.t - lag * DAY, to: p.t, before, after: p.v, change: p.v - before });
  }
  return out;
}


/** Ratio of the mean of the last `recent` values to the mean of the `baseline` values before them (null if either mean is 0 or data is short). */
export function recentVsBaseline(xs: (number | null)[], recent: number, baseline: number): { ratio: number; recent_mean: number; baseline_mean: number } | null {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  if (v.length < recent + baseline) return null;
  const r = mean(v.slice(-recent));
  const b = mean(v.slice(-(recent + baseline), -recent));
  return b > 0 ? { ratio: r / b, recent_mean: r, baseline_mean: b } : null;
}
