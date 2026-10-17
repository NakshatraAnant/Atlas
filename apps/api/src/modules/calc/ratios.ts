// Deterministic ratio formulas (PRD CMP-05, AIA-05). Pure functions with explicit edge rules:
// the calculation service — never the language model — produces every critical figure.

export type Missing = 'not_reported' | 'not_available' | 'not_meaningful';
export type MetricResult = { value: number } | { missing: Missing };
export type Input = number | null | undefined | { missing: Missing };

export const isMissing = (r: MetricResult): r is { missing: Missing } => 'missing' in r;
export const val = (v: number): MetricResult => ({ value: v });
export const miss = (m: Missing): MetricResult => ({ missing: m });

/** Resolve an input: absent → not_available; an explicit missing label is propagated. */
function resolve(x: Input): number | { missing: Missing } {
  if (x === null || x === undefined) return { missing: 'not_available' };
  if (typeof x === 'object') return x;
  if (!Number.isFinite(x)) return { missing: 'not_available' };
  return x;
}

/** Combine inputs; returns the first missing label (not_reported beats not_available). */
function inputs(...xs: Input[]): number[] | { missing: Missing } {
  const out: number[] = [];
  let firstMissing: Missing | null = null;
  for (const x of xs) {
    const r = resolve(x);
    if (typeof r === 'number') out.push(r);
    else if (firstMissing === null || r.missing === 'not_reported') firstMissing = r.missing;
  }
  return firstMissing ? { missing: firstMissing } : out;
}

export function ratio(numerator: Input, denominator: Input, opts: { scale?: number; denominatorMustBePositive?: boolean } = {}): MetricResult {
  const i = inputs(numerator, denominator);
  if (!Array.isArray(i)) return i;
  const [n, den] = i as [number, number];
  const mustBePositive = opts.denominatorMustBePositive ?? true;
  if (den === 0 || (mustBePositive && den < 0)) return miss('not_meaningful');
  return val((n / den) * (opts.scale ?? 1));
}

/** Percentage change; a zero or negative base is not meaningful (growth from a loss). */
export function growth(current: Input, prior: Input): MetricResult {
  const i = inputs(current, prior);
  if (!Array.isArray(i)) return i;
  const [c, p] = i as [number, number];
  if (p <= 0) return miss('not_meaningful');
  return val((c / p - 1) * 100);
}

export function cagr(end: Input, start: Input, years: number): MetricResult {
  const i = inputs(end, start);
  if (!Array.isArray(i)) return i;
  const [e, s] = i as [number, number];
  if (s <= 0 || e < 0 || years <= 0) return miss('not_meaningful');
  return val((Math.pow(e / s, 1 / years) - 1) * 100);
}

export function average(a: Input, b: Input): number | { missing: Missing } {
  const i = inputs(a, b);
  if (!Array.isArray(i)) return i;
  return ((i[0] as number) + (i[1] as number)) / 2;
}

export const operatingMargin = (operatingProfit: Input, revenue: Input) => ratio(operatingProfit, revenue, { scale: 100 });
export const netMargin = (netProfit: Input, revenue: Input) => ratio(netProfit, revenue, { scale: 100 });

export function roe(netProfit: Input, equityOpen: Input, equityClose: Input): MetricResult {
  const avg = equityOpen === undefined || equityOpen === null ? resolve(equityClose) : average(equityOpen, equityClose);
  return ratio(netProfit, avg, { scale: 100 });
}

export function roce(pbt: Input, financeCosts: Input, ceOpen: Input, ceClose: Input): MetricResult {
  const i = inputs(pbt, financeCosts);
  if (!Array.isArray(i)) return i;
  const ebit = (i[0] as number) + (i[1] as number);
  const avg = ceOpen === undefined || ceOpen === null ? resolve(ceClose) : average(ceOpen, ceClose);
  return ratio(ebit, avg, { scale: 100 });
}

export const roa = (netProfit: Input, assetsOpen: Input, assetsClose: Input) =>
  ratio(netProfit, assetsOpen === undefined || assetsOpen === null ? resolve(assetsClose) : average(assetsOpen, assetsClose), { scale: 100 });

export const debtEquity = (borrowings: Input, equity: Input) => ratio(borrowings, equity);

export function interestCoverage(pbt: Input, financeCosts: Input): MetricResult {
  const i = inputs(pbt, financeCosts);
  if (!Array.isArray(i)) return i;
  const [p, f] = i as [number, number];
  if (f <= 0) return miss('not_meaningful');
  return val((p + f) / f);
}

export const days = (balance: Input, flow: Input) => ratio(balance, flow, { scale: 365 });

export function cashConversionCycle(recDays: MetricResult, invDays: MetricResult, payDays: MetricResult): MetricResult {
  if (isMissing(recDays)) return recDays;
  if (isMissing(payDays)) return payDays;
  const inv = isMissing(invDays) ? (invDays.missing === 'not_reported' ? 0 : null) : invDays.value;
  if (inv === null) return invDays;
  return val(recDays.value + inv - payDays.value);
}

export const cashConversion = (cfo: Input, operatingProfit: Input) => ratio(cfo, operatingProfit, { scale: 100 });

export function freeCashFlow(cfo: Input, capex: Input): MetricResult {
  const i = inputs(cfo, capex);
  if (!Array.isArray(i)) return i;
  return val((i[0] as number) - Math.abs(i[1] as number));
}

/** Price ÷ earnings using market cap ÷ TTM profit; losses → n/m (PRD CMP-08). */
export const peRatio = (marketCapCr: Input, ttmProfitCr: Input) => ratio(marketCapCr, ttmProfitCr);
export const pbRatio = (marketCapCr: Input, equityCr: Input) => ratio(marketCapCr, equityCr);

export function evEbitda(marketCapCr: Input, borrowingsCr: Input, cashCr: Input, ttmEbitdaCr: Input): MetricResult {
  const i = inputs(marketCapCr, borrowingsCr, cashCr);
  if (!Array.isArray(i)) return i;
  const ev = (i[0] as number) + (i[1] as number) - (i[2] as number);
  return ratio(ev, ttmEbitdaCr);
}

export function dividendYield(dividendsCr: Input, marketCapCr: Input): MetricResult {
  const i = inputs(dividendsCr, marketCapCr);
  if (!Array.isArray(i)) return i;
  const [dv, mc] = i as [number, number];
  if (mc <= 0) return miss('not_meaningful');
  return val((Math.max(0, dv) / mc) * 100);
}

export const earningsYield = (ttmProfitCr: Input, marketCapCr: Input) => ratio(ttmProfitCr, marketCapCr, { scale: 100 });
export const otherIncomeShare = (otherIncome: Input, pbt: Input) => ratio(otherIncome, pbt, { scale: 100 });
export const costToIncome = (opex: Input, nii: Input, otherIncome: Input) => {
  const i = inputs(nii, otherIncome);
  if (!Array.isArray(i)) return i;
  return ratio(opex, (i[0] as number) + (i[1] as number), { scale: 100 });
};

/** Percentile rank (0–100) of `x` within `history` (share of values ≤ x). */
export function percentileRank(x: number, history: number[]): number {
  if (!history.length) throw new RangeError('empty history');
  const le = history.filter((h) => h <= x).length;
  return (le / history.length) * 100;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
