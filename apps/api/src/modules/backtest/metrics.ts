import type { EngineResult } from './engine.js';

// Backtest results and diagnostics (PRD BKT-07). Every metric has a published definition (bt_*).

export interface BacktestMetrics {
  total_return: number;
  cagr: number | null;
  max_drawdown: number;
  max_drawdown_duration: number;
  volatility: number;
  sharpe: number | null;
  trades: number;
  win_rate: number | null;
  avg_gain: number | null;
  avg_loss: number | null;
  exposure: number;
  turnover: number;
  total_costs: number;
  benchmark_return: number;
  excess_return: number;
  sessions: number;
  years: number;
  final_equity: number;
}

export function dailyReturns(equity: number[]): number[] {
  return equity.slice(1).map((e, i) => e / equity[i]! - 1);
}

export function maxDrawdown(equity: number[]): { dd: number; duration: number } {
  let peak = -Infinity;
  let dd = 0;
  let dur = 0;
  let cur = 0;
  for (const e of equity) {
    if (e >= peak) {
      peak = e;
      cur = 0;
    } else {
      cur++;
      dd = Math.min(dd, e / peak - 1);
    }
    dur = Math.max(dur, cur);
  }
  return { dd, duration: dur };
}

export function computeMetrics(r: EngineResult, capital: number, benchmark: number[], riskFreeDaily: number[]): BacktestMetrics {
  const eq = r.equity;
  const n = eq.length;
  const final = eq[n - 1] ?? capital;
  const rets = dailyReturns(eq);
  const mean = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length);
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length);
  const sd = Math.sqrt(variance);
  const rfMean = riskFreeDaily.length ? riskFreeDaily.slice(1).reduce((a, b) => a + b, 0) / Math.max(1, riskFreeDaily.length - 1) : 0;
  const sessions = Math.max(0, n - 1);
  const years = sessions / 252;
  const { dd, duration } = maxDrawdown(eq);
  const wins = r.roundTrips.filter((t) => t.netPnl > 0);
  const losses = r.roundTrips.filter((t) => t.netPnl <= 0);
  const bench = benchmark.length > 1 ? benchmark[benchmark.length - 1]! / benchmark[0]! - 1 : 0;
  const total = final / capital - 1;
  const avgEquity = eq.reduce((a, b) => a + b, 0) / Math.max(1, n);
  return {
    total_return: total * 100,
    cagr: sessions >= 252 ? (Math.pow(final / capital, 252 / sessions) - 1) * 100 : null,
    max_drawdown: dd * 100,
    max_drawdown_duration: duration,
    volatility: sd * Math.sqrt(252) * 100,
    sharpe: sd > 0 ? ((mean - rfMean) / sd) * Math.sqrt(252) : null,
    trades: r.roundTrips.length,
    win_rate: r.roundTrips.length ? (wins.length / r.roundTrips.length) * 100 : null,
    avg_gain: wins.length ? wins.reduce((a, b) => a + b.returnPct, 0) / wins.length : null,
    avg_loss: losses.length ? losses.reduce((a, b) => a + b.returnPct, 0) / losses.length : null,
    exposure: (r.invested.filter((x, i) => i > 0 && x > 1e-9).length / Math.max(1, n - 1)) * 100,
    turnover: years > 0 ? r.tradedValue / avgEquity / years : 0,
    total_costs: r.totalCosts,
    benchmark_return: bench * 100,
    excess_return: (total - bench) * 100,
    sessions,
    years,
    final_equity: final,
  };
}

/** Independent loop-based reference implementation (Blueprint §8.6): recomputes the same metrics without shared helpers. */
export function referenceMetrics(equity: number[], capital: number, roundTripsPnl: number[], roundTripReturns: number[], benchmark: number[], rf: number[]) {
  let sum = 0;
  const rets: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    const x = equity[i]! / equity[i - 1]! - 1;
    rets.push(x);
    sum += x;
  }
  const m = sum / rets.length;
  let ss = 0;
  for (const x of rets) ss += (x - m) * (x - m);
  const sd = Math.sqrt(ss / rets.length);
  let rfs = 0;
  for (let i = 1; i < rf.length; i++) rfs += rf[i]!;
  const rfm = rf.length > 1 ? rfs / (rf.length - 1) : 0;
  let peak = equity[0]!;
  let worst = 0;
  for (const e of equity) {
    if (e > peak) peak = e;
    const d = e / peak - 1;
    if (d < worst) worst = d;
  }
  let w = 0;
  let wsum = 0;
  let l = 0;
  let lsum = 0;
  for (let k = 0; k < roundTripsPnl.length; k++) {
    if (roundTripsPnl[k]! > 0) {
      w++;
      wsum += roundTripReturns[k]!;
    } else {
      l++;
      lsum += roundTripReturns[k]!;
    }
  }
  const final = equity[equity.length - 1]!;
  const sessions = equity.length - 1;
  return {
    total_return: (final / capital - 1) * 100,
    cagr: sessions >= 252 ? (Math.exp((Math.log(final / capital) * 252) / sessions) - 1) * 100 : null,
    max_drawdown: worst * 100,
    volatility: sd * Math.sqrt(252) * 100,
    sharpe: sd > 0 ? ((m - rfm) / sd) * Math.sqrt(252) : null,
    win_rate: roundTripsPnl.length ? (w / roundTripsPnl.length) * 100 : null,
    avg_gain: w ? wsum / w : null,
    avg_loss: l ? lsum / l : null,
    benchmark_return: (benchmark[benchmark.length - 1]! / benchmark[0]! - 1) * 100,
  };
}

export function calendarYearReturns(dates: string[], equity: number[]): { year: string; return_pct: number }[] {
  const out: { year: string; return_pct: number }[] = [];
  let startEq = equity[0]!;
  let year = dates[0]?.slice(0, 4);
  for (let i = 1; i < dates.length; i++) {
    const y = dates[i]!.slice(0, 4);
    if (y !== year) {
      out.push({ year: year!, return_pct: (equity[i - 1]! / startEq - 1) * 100 });
      startEq = equity[i - 1]!;
      year = y;
    }
  }
  if (year && dates.length) out.push({ year, return_pct: (equity[equity.length - 1]! / startEq - 1) * 100 });
  return out;
}

/** Returns compounded separately over sessions in each market regime (trend label at the prior close). */
export function regimeReturns(dates: string[], equity: number[], regimeByDate: Map<string, string>): { regime: string; sessions: number; return_pct: number }[] {
  const acc = new Map<string, { n: number; g: number }>();
  for (let i = 1; i < dates.length; i++) {
    const label = regimeByDate.get(dates[i - 1]!) ?? 'Not available';
    const a = acc.get(label) ?? { n: 0, g: 1 };
    a.n++;
    a.g *= equity[i]! / equity[i - 1]!;
    acc.set(label, a);
  }
  return [...acc].map(([regime, a]) => ({ regime, sessions: a.n, return_pct: (a.g - 1) * 100 })).sort((x, y) => x.regime.localeCompare(y.regime));
}

export function drawdownSeries(equity: number[]): number[] {
  let peak = -Infinity;
  return equity.map((e) => {
    peak = Math.max(peak, e);
    return (e / peak - 1) * 100;
  });
}
