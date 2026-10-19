import { compound, dcf, equalWeightVol, maxDrawdown as simMaxDrawdown, multipleTesting, operatingCashFlow, realReturnPct, twoAssetVol } from '@atlas/shared';
import { DEFAULT_COST_TABLE, tradeCosts } from '../../src/modules/backtest/costs.js';
import { maxDrawdown } from '../../src/modules/backtest/metrics.js';
import { realisedVol, rollingExtreme, rsi, sma } from '../../src/modules/calc/indicators.js';
import * as R from '../../src/modules/calc/ratios.js';

// Financial golden set (PRD numerical-accuracy target ≥ 99%, measured, not asserted).
// Every expected value is calculated by hand from the stated inputs; the derivation is written out.
// Severity: critical = a figure users act on (ratios, valuation, costs); major = indicator or
// teaching figure; edge = missing/zero/negative handling. Units: % unless stated.

export type Expected = number | { missing: R.Missing };
export interface GoldenCase { id: string; area: string; severity: 'critical' | 'major' | 'edge'; derivation: string; tol: number; actual: () => number | { missing: string } | null; expected: Expected }

const v = (r: R.MetricResult) => (R.isMissing(r) ? r : r.value);
const NM = { missing: 'not_meaningful' as const };
const NA = { missing: 'not_available' as const };

export const GOLDEN: GoldenCase[] = [
  // ── Growth and margins ──
  { id: 'G-01', area: 'growth', severity: 'critical', derivation: '(1,150 / 1,000 − 1) × 100 = 15', tol: 1e-9, actual: () => v(R.growth(1150, 1000)), expected: 15 },
  { id: 'G-02', area: 'growth', severity: 'critical', derivation: '(850 / 1,000 − 1) × 100 = −15', tol: 1e-9, actual: () => v(R.growth(850, 1000)), expected: -15 },
  { id: 'G-03', area: 'growth', severity: 'edge', derivation: 'Growth from a loss (prior −50) is not meaningful', tol: 0, actual: () => v(R.growth(20, -50)), expected: NM },
  { id: 'G-04', area: 'growth', severity: 'edge', derivation: 'Growth from zero is not meaningful', tol: 0, actual: () => v(R.growth(20, 0)), expected: NM },
  { id: 'G-05', area: 'growth', severity: 'edge', derivation: 'Missing prior period → not available', tol: 0, actual: () => v(R.growth(20, null)), expected: NA },
  { id: 'G-06', area: 'growth', severity: 'critical', derivation: 'CAGR 100 → 161.051 over 5 years: 1.61051^(1/5) = 1.10 → 10%', tol: 1e-9, actual: () => v(R.cagr(161.051, 100, 5)), expected: 10 },
  { id: 'G-07', area: 'growth', severity: 'edge', derivation: 'CAGR from a negative start is not meaningful', tol: 0, actual: () => v(R.cagr(100, -10, 3)), expected: NM },
  { id: 'M-01', area: 'margins', severity: 'critical', derivation: 'EBIT 120 / revenue 800 × 100 = 15', tol: 1e-9, actual: () => v(R.operatingMargin(120, 800)), expected: 15 },
  { id: 'M-02', area: 'margins', severity: 'critical', derivation: 'Net profit 135 / revenue 1,000 × 100 = 13.5', tol: 1e-9, actual: () => v(R.netMargin(135, 1000)), expected: 13.5 },
  { id: 'M-03', area: 'margins', severity: 'critical', derivation: 'Loss −30 / revenue 600 × 100 = −5 (negative margins are meaningful)', tol: 1e-9, actual: () => v(R.netMargin(-30, 600)), expected: -5 },
  { id: 'M-04', area: 'margins', severity: 'edge', derivation: 'Zero revenue → not meaningful', tol: 0, actual: () => v(R.netMargin(10, 0)), expected: NM },
  // ── Returns on capital and leverage ──
  { id: 'RC-01', area: 'returns', severity: 'critical', derivation: 'ROE: 50 / avg(380, 420) = 50 / 400 × 100 = 12.5', tol: 1e-9, actual: () => v(R.roe(50, 380, 420)), expected: 12.5 },
  { id: 'RC-02', area: 'returns', severity: 'critical', derivation: 'ROE with only closing equity: 50 / 400 × 100 = 12.5', tol: 1e-9, actual: () => v(R.roe(50, null, 400)), expected: 12.5 },
  { id: 'RC-03', area: 'returns', severity: 'edge', derivation: 'Negative equity → ROE not meaningful', tol: 0, actual: () => v(R.roe(50, -100, -60)), expected: NM },
  { id: 'RC-04', area: 'returns', severity: 'critical', derivation: 'ROCE: EBIT = PBT 144 + finance 36 = 180; avg CE (1,100 + 1,300)/2 = 1,200; 180/1,200 × 100 = 15', tol: 1e-9, actual: () => v(R.roce(144, 36, 1100, 1300)), expected: 15 },
  { id: 'RC-05', area: 'returns', severity: 'critical', derivation: 'ROA: 60 / avg(900, 1,100) = 60 / 1,000 × 100 = 6', tol: 1e-9, actual: () => v(R.roa(60, 900, 1100)), expected: 6 },
  { id: 'RC-06', area: 'leverage', severity: 'critical', derivation: 'Debt/equity: 400 / 800 = 0.5', tol: 1e-12, actual: () => v(R.debtEquity(400, 800)), expected: 0.5 },
  { id: 'RC-07', area: 'leverage', severity: 'critical', derivation: 'Interest cover: (PBT 144 + interest 36) / 36 = 5', tol: 1e-12, actual: () => v(R.interestCoverage(144, 36)), expected: 5 },
  { id: 'RC-08', area: 'leverage', severity: 'edge', derivation: 'No interest cost → interest cover not meaningful', tol: 0, actual: () => v(R.interestCoverage(144, 0)), expected: NM },
  // ── Working capital and cash ──
  { id: 'W-01', area: 'working_capital', severity: 'critical', derivation: 'Receivable days: 120 / 730 × 365 = 60', tol: 1e-9, actual: () => v(R.days(120, 730)), expected: 60 },
  { id: 'W-02', area: 'working_capital', severity: 'critical', derivation: 'CCC: 60 + 45 − 30 = 75', tol: 1e-9, actual: () => v(R.cashConversionCycle(R.val(60), R.val(45), R.val(30))), expected: 75 },
  { id: 'W-03', area: 'working_capital', severity: 'edge', derivation: 'Inventory not reported (service company) counts as 0: 60 + 0 − 30 = 30', tol: 1e-9, actual: () => v(R.cashConversionCycle(R.val(60), R.miss('not_reported'), R.val(30))), expected: 30 },
  { id: 'W-04', area: 'cash', severity: 'critical', derivation: 'Cash conversion: CFO 175 / operating profit 200 × 100 = 87.5', tol: 1e-9, actual: () => v(R.cashConversion(175, 200)), expected: 87.5 },
  { id: 'W-05', area: 'cash', severity: 'critical', derivation: 'FCF: CFO 175 − |capex −60| = 115 (sign of capex normalised)', tol: 1e-9, actual: () => v(R.freeCashFlow(175, -60)), expected: 115 },
  { id: 'W-06', area: 'cash', severity: 'critical', derivation: 'OCF bridge: 200 + 30 − (50 + 20 − 15) = 175', tol: 1e-9, actual: () => operatingCashFlow({ netProfit: 200, depreciation: 30, receivablesChange: 50, inventoryChange: 20, payablesChange: 15 }).ocf, expected: 175 },
  // ── Valuation multiples ──
  { id: 'V-01', area: 'valuation', severity: 'critical', derivation: 'P/E: market cap 2,400 / TTM profit 160 = 15', tol: 1e-12, actual: () => v(R.peRatio(2400, 160)), expected: 15 },
  { id: 'V-02', area: 'valuation', severity: 'edge', derivation: 'P/E with a TTM loss is not meaningful', tol: 0, actual: () => v(R.peRatio(2400, -10)), expected: NM },
  { id: 'V-03', area: 'valuation', severity: 'critical', derivation: 'P/B: 2,400 / equity 800 = 3', tol: 1e-12, actual: () => v(R.pbRatio(2400, 800)), expected: 3 },
  { id: 'V-04', area: 'valuation', severity: 'critical', derivation: 'EV/EBITDA: (1,500 + 500 − 200) / 225 = 8', tol: 1e-12, actual: () => v(R.evEbitda(1500, 500, 200, 225)), expected: 8 },
  { id: 'V-05', area: 'valuation', severity: 'edge', derivation: 'EV/EBITDA with negative EBITDA is not meaningful', tol: 0, actual: () => v(R.evEbitda(1500, 500, 200, -5)), expected: NM },
  { id: 'V-06', area: 'valuation', severity: 'critical', derivation: 'Dividend yield: 30 / 1,500 × 100 = 2', tol: 1e-12, actual: () => v(R.dividendYield(30, 1500)), expected: 2 },
  { id: 'V-07', area: 'valuation', severity: 'critical', derivation: 'Earnings yield: 160 / 2,400 × 100 = 6.6667', tol: 1e-4, actual: () => v(R.earningsYield(160, 2400)), expected: 6.6667 },
  { id: 'V-08', area: 'banks', severity: 'critical', derivation: 'Cost-to-income: opex 450 / (NII 900 + other income 100) × 100 = 45', tol: 1e-9, actual: () => v(R.costToIncome(450, 900, 100)), expected: 45 },
  { id: 'V-09', area: 'valuation', severity: 'critical', derivation: 'Median of 10, 12, 15, 30 = (12 + 15) / 2 = 13.5', tol: 1e-12, actual: () => R.median([30, 10, 15, 12]), expected: 13.5 },
  // ── DCF (shared simulation used by lessons and games) ──
  { id: 'D-01', area: 'dcf', severity: 'critical', derivation: 'PV explicit 89.2857 + 87.6913 + 86.1253 = 263.1023 (FCF 100, 110, 121 at 12%)', tol: 1e-3, actual: () => dcf({ fcf: [100, 110, 121], discountPct: 12, terminalGrowthPct: 4 }).pv_explicit, expected: 263.1023 },
  { id: 'D-02', area: 'dcf', severity: 'critical', derivation: 'TV = 121 × 1.04 / 0.08 = 1,573; PV = 1,573 / 1.404928 = 1,119.6303', tol: 1e-3, actual: () => dcf({ fcf: [100, 110, 121], discountPct: 12, terminalGrowthPct: 4 }).pv_terminal, expected: 1119.6303 },
  { id: 'D-03', area: 'dcf', severity: 'critical', derivation: 'Total 263.1023 + 1,119.6303 = 1,382.7326', tol: 1e-3, actual: () => dcf({ fcf: [100, 110, 121], discountPct: 12, terminalGrowthPct: 4 }).value, expected: 1382.7326 },
  { id: 'D-04', area: 'dcf', severity: 'critical', derivation: 'One explicit year 100, then g 4%, r 12%: 100/1.12 + (104/0.08)/1.12 = 89.2857 + 1,160.7143 = 1,250', tol: 1e-6, actual: () => dcf({ fcf: [100], discountPct: 12, terminalGrowthPct: 4 }).value, expected: 1250 },
  // ── Portfolio and teaching simulations ──
  { id: 'P-01', area: 'portfolio', severity: 'major', derivation: '60/40, σ 25%/15%, ρ 0.2: √(0.0225 + 0.0036 + 0.0036) = √0.0297 = 17.2337', tol: 1e-4, actual: () => twoAssetVol(0.6, 25, 15, 0.2), expected: 17.2337 },
  { id: 'P-02', area: 'portfolio', severity: 'major', derivation: 'Equal-weight n = 10, σ 30, ρ 0.3: 30 × √0.37 = 18.2483', tol: 1e-4, actual: () => equalWeightVol(30, 10, 0.3), expected: 18.2483 },
  { id: 'P-03', area: 'portfolio', severity: 'major', derivation: 'Compound ₹50,000 at 8% for 3 years: 50,000 × 1.259712 = 62,985.6', tol: 1e-6, actual: () => compound(50000, 8, 3), expected: 62985.6 },
  { id: 'P-04', area: 'portfolio', severity: 'major', derivation: 'Real return 9% nominal, 6% inflation: 1.09/1.06 − 1 = 2.8302%', tol: 1e-4, actual: () => realReturnPct(9, 6), expected: 2.8302 },
  { id: 'P-05', area: 'statistics', severity: 'major', derivation: '20 tests at 5%: 1 − 0.95^20 = 64.1514%', tol: 1e-4, actual: () => multipleTesting(20, 0.05).p_at_least_one_pct, expected: 64.1514 },
  // ── Indicators ──
  { id: 'I-01', area: 'indicators', severity: 'major', derivation: 'SMA(3) of 10, 11, 12, 13 at the last point = (11 + 12 + 13) / 3 = 12', tol: 1e-12, actual: () => sma([10, 11, 12, 13], 3)[3] ?? null, expected: 12 },
  { id: 'I-02', area: 'indicators', severity: 'edge', derivation: 'SMA(3) before 3 values exist is null (not available)', tol: 0, actual: () => (sma([10, 11], 3)[1] === null ? NA : 0), expected: NA },
  { id: 'I-03', area: 'indicators', severity: 'major', derivation: 'RSI(3) of a strictly rising series = 100 (no losses)', tol: 1e-9, actual: () => rsi([1, 2, 3, 4, 5, 6], 3)[5] ?? null, expected: 100 },
  { id: 'I-04', area: 'indicators', severity: 'major', derivation: 'RSI(3) of a strictly falling series = 0 (no gains)', tol: 1e-9, actual: () => rsi([6, 5, 4, 3, 2, 1], 3)[5] ?? null, expected: 0 },
  { id: 'I-05', area: 'indicators', severity: 'major', derivation: '52-week high window max of 5, 9, 7 (window 3) = 9', tol: 0, actual: () => rollingExtreme([5, 9, 7], 3, 'max')[2] ?? null, expected: 9 },
  { id: 'I-06', area: 'indicators', severity: 'major', derivation: 'Constant prices → realised volatility 0', tol: 1e-12, actual: () => realisedVol([100, 100, 100, 100, 100], 3)[4] ?? null, expected: 0 },
  { id: 'I-07', area: 'indicators', severity: 'major', derivation: 'Log returns alternating ±ln(1.1): mean 0, population sd ln(1.1) = 0.0953102; annualised × √252 = 1.5130105', tol: 1e-6, actual: () => realisedVol([100, 110, 100, 110, 100], 4)[4] ?? null, expected: Math.log(1.1) * Math.sqrt(252) },
  // ── Backtest metrics and costs ──
  { id: 'B-01', area: 'backtest', severity: 'critical', derivation: 'Engine definition (methodology bt_max_drawdown): min(equity ÷ running peak − 1) for 100, 150, 90, 120 = 90/150 − 1 = −0.4 (reports show −40%; lessons quote the magnitude, 40%)', tol: 1e-12, actual: () => maxDrawdown([100, 150, 90, 120]).dd, expected: -0.4 },
  { id: 'B-02', area: 'backtest', severity: 'critical', derivation: 'Same series via the teaching simulation: 40%', tol: 1e-12, actual: () => simMaxDrawdown([100, 150, 90, 120]).max_drawdown_pct, expected: 40 },
  { id: 'B-03', area: 'costs', severity: 'critical', derivation: 'Buy ₹1,00,000 (default draft table, zero brokerage): STT 100 + exchange 2.97 + SEBI 0.10 + stamp 15 + GST 18% × (0 + 2.97 + 0.10) = 0.5526 → 118.6226', tol: 1e-6, actual: () => tradeCosts('buy', 100000, 0, DEFAULT_COST_TABLE).total, expected: 118.6226 },
  { id: 'B-04', area: 'costs', severity: 'critical', derivation: 'Sell ₹1,00,000: STT 100 + exchange 2.97 + SEBI 0.10 + GST 0.5526 + DP 15.93 = 119.5526', tol: 1e-6, actual: () => tradeCosts('sell', 100000, 0, DEFAULT_COST_TABLE).total, expected: 119.5526 },
  { id: 'B-05', area: 'costs', severity: 'critical', derivation: 'Sell with slippage ₹50: 119.5526 + 50 = 169.5526', tol: 1e-6, actual: () => tradeCosts('sell', 100000, 50, DEFAULT_COST_TABLE).total, expected: 169.5526 },
  { id: 'B-06', area: 'costs', severity: 'critical', derivation: 'Doubled-cost sensitivity: 2 × 118.6226 = 237.2452', tol: 1e-6, actual: () => tradeCosts('buy', 100000, 0, DEFAULT_COST_TABLE, 2).total, expected: 237.2452 },
  // ── Missing-data propagation ──
  { id: 'E-01', area: 'missing', severity: 'edge', derivation: 'not_reported beats not_available when both inputs are missing', tol: 0, actual: () => v(R.ratio(null, { missing: 'not_reported' })), expected: { missing: 'not_reported' } },
  { id: 'E-02', area: 'missing', severity: 'edge', derivation: 'NaN input is treated as not available, never as zero', tol: 0, actual: () => v(R.netMargin(Number.NaN, 100)), expected: NA },
  { id: 'E-03', area: 'missing', severity: 'edge', derivation: 'Dividends never negative: max(0, −5) / 1,000 = 0', tol: 0, actual: () => v(R.dividendYield(-5, 1000)), expected: 0 },
];

export interface GoldenResult { id: string; area: string; severity: string; passed: boolean; expected: Expected; actual: unknown; tol: number; derivation: string }

export function runGolden(cases: GoldenCase[] = GOLDEN): { results: GoldenResult[]; total: number; passed: number; accuracy_pct: number } {
  const results = cases.map((c) => {
    let actual: unknown;
    try { actual = c.actual(); } catch (e) { actual = `threw: ${(e as Error).message}`; }
    const passed = typeof c.expected === 'number'
      ? typeof actual === 'number' && Math.abs(actual - c.expected) <= c.tol
      : typeof actual === 'object' && actual !== null && 'missing' in actual && (actual as { missing: string }).missing === c.expected.missing;
    return { id: c.id, area: c.area, severity: c.severity, passed, expected: c.expected, actual, tol: c.tol, derivation: c.derivation };
  });
  const passed = results.filter((r) => r.passed).length;
  return { results, total: results.length, passed, accuracy_pct: (passed / results.length) * 100 };
}
