// Deterministic simulations behind the Academy labs for all four courses. Pure functions so the
// lesson widgets, the worked examples and the tests agree exactly (test/learning-sims-courses.test.ts).

// ───────────── Course 1: money over time, risk, indices ─────────────

/** Future value with annual compounding. */
export const compound = (principal: number, ratePct: number, years: number): number => principal * Math.pow(1 + ratePct / 100, years);

/** Real (inflation-adjusted) return in percent: (1 + nominal) / (1 + inflation) − 1. */
export const realReturnPct = (nominalPct: number, inflationPct: number): number => ((1 + nominalPct / 100) / (1 + inflationPct / 100) - 1) * 100;

/** Exact years to double at a rate (the "rule of 72" approximates this). */
export const doublingYears = (ratePct: number): number => Math.log(2) / Math.log(1 + ratePct / 100);

/** Volatility of an equal-weight portfolio of n assets with equal volatility σ and average pairwise correlation ρ. */
export function equalWeightVol(sigmaPct: number, n: number, rho: number): number {
  if (!(n >= 1) || !Number.isInteger(n)) throw new Error('n must be a positive whole number');
  if (rho > 1 || (n > 1 && rho < -1 / (n - 1) - 1e-12)) throw new Error('Correlation is outside the feasible range for this many assets');
  return sigmaPct * Math.sqrt(rho + (1 - rho) / n);
}

export interface IndexStock { name: string; price0: number; price1: number; shares: number }
/** Price-index return under market-cap and equal weighting, in percent. */
export function indexReturns(stocks: IndexStock[]): { cap_weighted_pct: number; equal_weighted_pct: number; weights: { name: string; weight_pct: number }[] } {
  const cap0 = stocks.reduce((s, x) => s + x.price0 * x.shares, 0);
  const cap1 = stocks.reduce((s, x) => s + x.price1 * x.shares, 0);
  const eq = stocks.reduce((s, x) => s + (x.price1 / x.price0 - 1), 0) / stocks.length;
  return { cap_weighted_pct: (cap1 / cap0 - 1) * 100, equal_weighted_pct: eq * 100, weights: stocks.map((x) => ({ name: x.name, weight_pct: ((x.price0 * x.shares) / cap0) * 100 })) };
}

// ───────────── Course 2: statements, returns on capital, valuation ─────────────

/** Indirect-method operating cash flow (simplified): net profit + depreciation − increase in working capital. */
export function operatingCashFlow(i: { netProfit: number; depreciation: number; receivablesChange: number; inventoryChange: number; payablesChange: number }): { ocf: number; working_capital_change: number; cash_conversion_pct: number | null } {
  const wc = i.receivablesChange + i.inventoryChange - i.payablesChange;
  const ocf = i.netProfit + i.depreciation - wc;
  return { ocf, working_capital_change: wc, cash_conversion_pct: i.netProfit > 0 ? (ocf / i.netProfit) * 100 : null };
}

/** DuPont: ROE = net margin × asset turnover × equity multiplier (all on the same period's figures). */
export function dupont(i: { revenue: number; netProfit: number; assets: number; equity: number }): { net_margin_pct: number; asset_turnover: number; equity_multiplier: number; roe_pct: number; roe_direct_pct: number } {
  if (!(i.revenue > 0 && i.assets > 0 && i.equity > 0)) throw new Error('Revenue, assets and equity must be positive');
  const m = i.netProfit / i.revenue;
  const t = i.revenue / i.assets;
  const l = i.assets / i.equity;
  return { net_margin_pct: m * 100, asset_turnover: t, equity_multiplier: l, roe_pct: m * t * l * 100, roe_direct_pct: (i.netProfit / i.equity) * 100 };
}

/** ROCE = EBIT ÷ (equity + debt), percent; null when capital employed is not positive. */
export const roce = (ebit: number, equity: number, debt: number): number | null => (equity + debt > 0 ? (ebit / (equity + debt)) * 100 : null);

/** Enterprise-value bridge and multiples (₹ crore). Multiples are null when the denominator is not positive. */
export function evBridge(i: { marketCap: number; debt: number; cash: number; ebitda: number; netProfit: number }): { ev: number; ev_ebitda: number | null; pe: number | null } {
  const ev = i.marketCap + i.debt - i.cash;
  return { ev, ev_ebitda: i.ebitda > 0 ? ev / i.ebitda : null, pe: i.netProfit > 0 ? i.marketCap / i.netProfit : null };
}

// ───────────── Course 3: returns, bias and experiments ─────────────

/** Maximum drawdown (percent, positive) with the peak and trough indexes. */
export function maxDrawdown(values: number[]): { max_drawdown_pct: number; peak: number; trough: number } {
  let peak = 0;
  let best = { max_drawdown_pct: 0, peak: 0, trough: 0 };
  for (let i = 0; i < values.length; i++) {
    if (values[i]! > values[peak]!) peak = i;
    const dd = (1 - values[i]! / values[peak]!) * 100;
    if (dd > best.max_drawdown_pct) best = { max_drawdown_pct: dd, peak, trough: i };
  }
  return best;
}

/** Deterministic PRNG (mulberry32) for teaching simulations. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Overfitting demonstration: `strategies` strategies with NO edge each gain or lose 1% a period at
 * random. Choose the best on the first half (in-sample), then measure that same strategy on the second half.
 */
export function overfitDemo(strategies: number, periods: number, seed: number): { best_in_sample_pct: number; same_strategy_out_of_sample_pct: number; average_in_sample_pct: number } {
  const rnd = seededRandom(seed);
  const half = Math.floor(periods / 2);
  let best = -Infinity;
  let bestOut = 0;
  let sumIn = 0;
  for (let s = 0; s < strategies; s++) {
    let inS = 0;
    let outS = 0;
    for (let p = 0; p < periods; p++) {
      const r = rnd() < 0.5 ? 1 : -1;
      if (p < half) inS += r;
      else outS += r;
    }
    sumIn += inS;
    if (inS > best) {
      best = inS;
      bestOut = outS;
    }
  }
  return { best_in_sample_pct: best, same_strategy_out_of_sample_pct: bestOut, average_in_sample_pct: sumIn / strategies };
}

/** Annual cost drag in percent of the portfolio: turnover (value traded ÷ portfolio value per year) × cost per unit traded. */
export const costDragPct = (turnoverTimes: number, costPctOfValueTraded: number): number => turnoverTimes * costPctOfValueTraded;

// ───────────── Course 4: valuation, portfolio risk, validation ─────────────

/** Two-stage DCF: explicit free cash flows (years 1..n), then a growing perpetuity from year n+1. */
export function dcf(i: { fcf: number[]; discountPct: number; terminalGrowthPct: number }): { pv_explicit: number; pv_terminal: number; value: number; terminal_share_pct: number } {
  const r = i.discountPct / 100;
  const g = i.terminalGrowthPct / 100;
  if (!(r > g)) throw new Error('The discount rate must exceed terminal growth');
  if (!i.fcf.length) throw new Error('At least one explicit year is needed');
  const pvExplicit = i.fcf.reduce((s, f, k) => s + f / Math.pow(1 + r, k + 1), 0);
  const tv = (i.fcf[i.fcf.length - 1]! * (1 + g)) / (r - g);
  const pvTerminal = tv / Math.pow(1 + r, i.fcf.length);
  const value = pvExplicit + pvTerminal;
  return { pv_explicit: pvExplicit, pv_terminal: pvTerminal, value, terminal_share_pct: (pvTerminal / value) * 100 };
}

/** Value grid over discount rates × terminal growth rates (null where discount ≤ growth). */
export function dcfSensitivity(fcf: number[], discountPcts: number[], growthPcts: number[]): (number | null)[][] {
  return discountPcts.map((d) => growthPcts.map((g) => (d > g ? dcf({ fcf, discountPct: d, terminalGrowthPct: g }).value : null)));
}

/** Volatility of a two-asset portfolio, percent. */
export function twoAssetVol(w1: number, sigma1Pct: number, sigma2Pct: number, rho: number): number {
  if (w1 < 0 || w1 > 1) throw new Error('Weight must be between 0 and 1');
  if (rho < -1 || rho > 1) throw new Error('Correlation must be between -1 and 1');
  const w2 = 1 - w1;
  const s1 = sigma1Pct / 100;
  const s2 = sigma2Pct / 100;
  return Math.sqrt(w1 * w1 * s1 * s1 + w2 * w2 * s2 * s2 + 2 * w1 * w2 * rho * s1 * s2) * 100;
}

/** Multiple testing with independent tests: expected false positives, P(at least one), Bonferroni threshold. */
export function multipleTesting(tests: number, alpha: number): { expected_false_positives: number; p_at_least_one_pct: number; bonferroni_alpha: number } {
  return { expected_false_positives: tests * alpha, p_at_least_one_pct: (1 - Math.pow(1 - alpha, tests)) * 100, bonferroni_alpha: alpha / tests };
}
