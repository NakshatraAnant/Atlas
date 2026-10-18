import { describe, expect, it } from 'vitest';
import * as R from '../src/modules/calc/ratios.js';
import { realisedVol, reference, rollingExtreme, rsi, sma } from '../src/modules/calc/indicators.js';
import { METRICS, METRIC_BY_CODE } from '../src/modules/calc/definitions.js';
import { disclosedEvent, FORBIDDEN_FLAG_WORDS, otherIncomeDependence, risingLeverage, risingReceivableDays, weakCashConversion } from '../src/modules/companies/qualityFlags.js';
import { mulberry32, normal } from '../src/pipeline/synthetic/rng.js';

const v = (r: R.MetricResult) => (R.isMissing(r) ? r.missing : Number(r.value.toFixed(8)));

describe('ratio edge cases (CMP-05: at least three per ratio)', () => {
  it('operating margin', () => {
    expect(v(R.operatingMargin(25, 100))).toBe(25);
    expect(v(R.operatingMargin(25, 0))).toBe('not_meaningful');
    expect(v(R.operatingMargin(25, -10))).toBe('not_meaningful');
    expect(v(R.operatingMargin(-5, 100))).toBe(-5);
    expect(v(R.operatingMargin({ missing: 'not_reported' }, 100))).toBe('not_reported');
  });
  it('net margin', () => {
    expect(v(R.netMargin(10, 200))).toBe(5);
    expect(v(R.netMargin(10, 0))).toBe('not_meaningful');
    expect(v(R.netMargin(null, 200))).toBe('not_available');
  });
  it('growth', () => {
    expect(v(R.growth(110, 100))).toBe(10);
    expect(v(R.growth(110, 0))).toBe('not_meaningful');
    expect(v(R.growth(110, -50))).toBe('not_meaningful');
    expect(v(R.growth(undefined, 100))).toBe('not_available');
  });
  it('CAGR', () => {
    expect(v(R.cagr(133.1, 100, 3))).toBeCloseTo(10, 6);
    expect(v(R.cagr(100, 0, 3))).toBe('not_meaningful');
    expect(v(R.cagr(-1, 100, 3))).toBe('not_meaningful');
    expect(v(R.cagr(100, 100, 0))).toBe('not_meaningful');
  });
  it('ROE', () => {
    expect(v(R.roe(20, 90, 110))).toBe(20);
    expect(v(R.roe(20, undefined, 100))).toBe(20);
    expect(v(R.roe(20, -50, -10))).toBe('not_meaningful');
    expect(v(R.roe(20, 0, 0))).toBe('not_meaningful');
  });
  it('ROCE', () => {
    expect(v(R.roce(15, 5, 90, 110))).toBe(20);
    expect(v(R.roce(15, 5, -100, -20))).toBe('not_meaningful');
    expect(v(R.roce(15, null, 90, 110))).toBe('not_available');
  });
  it('ROA', () => {
    expect(v(R.roa(10, 400, 600))).toBe(2);
    expect(v(R.roa(10, 0, 0))).toBe('not_meaningful');
    expect(v(R.roa(10, undefined, 500))).toBe(2);
  });
  it('debt to equity', () => {
    expect(v(R.debtEquity(50, 100))).toBe(0.5);
    expect(v(R.debtEquity(50, 0))).toBe('not_meaningful');
    expect(v(R.debtEquity(50, -20))).toBe('not_meaningful');
    expect(v(R.debtEquity(0, 100))).toBe(0);
  });
  it('interest coverage', () => {
    expect(v(R.interestCoverage(90, 10))).toBe(10);
    expect(v(R.interestCoverage(90, 0))).toBe('not_meaningful');
    expect(v(R.interestCoverage(-30, 10))).toBe(-2);
  });
  it('working-capital days and cycle', () => {
    expect(v(R.days(50, 365))).toBe(50);
    expect(v(R.days(50, 0))).toBe('not_meaningful');
    expect(v(R.days({ missing: 'not_reported' }, 365))).toBe('not_reported');
    expect(v(R.cashConversionCycle(R.val(40), R.val(30), R.val(20)))).toBe(50);
    expect(v(R.cashConversionCycle(R.val(40), R.miss('not_reported'), R.val(20)))).toBe(20);
    expect(v(R.cashConversionCycle(R.miss('not_meaningful'), R.val(30), R.val(20)))).toBe('not_meaningful');
  });
  it('cash conversion and free cash flow', () => {
    expect(v(R.cashConversion(80, 100))).toBe(80);
    expect(v(R.cashConversion(80, -5))).toBe('not_meaningful');
    expect(v(R.cashConversion(80, 0))).toBe('not_meaningful');
    expect(v(R.freeCashFlow(100, 30))).toBe(70);
    expect(v(R.freeCashFlow(100, -30))).toBe(70);
    expect(v(R.freeCashFlow(null, 30))).toBe('not_available');
  });
  it('valuation', () => {
    expect(v(R.peRatio(1000, 50))).toBe(20);
    expect(v(R.peRatio(1000, -50))).toBe('not_meaningful');
    expect(v(R.peRatio(1000, 0))).toBe('not_meaningful');
    expect(v(R.pbRatio(1000, 250))).toBe(4);
    expect(v(R.pbRatio(1000, -1))).toBe('not_meaningful');
    expect(v(R.evEbitda(1000, 200, 100, 110))).toBe(10);
    expect(v(R.evEbitda(1000, 200, 100, -5))).toBe('not_meaningful');
    expect(v(R.dividendYield(20, 1000))).toBe(2);
    expect(v(R.dividendYield(0, 1000))).toBe(0);
    expect(v(R.dividendYield(20, 0))).toBe('not_meaningful');
    expect(v(R.earningsYield(-50, 1000))).toBe(-5);
  });
  it('other income share and cost to income', () => {
    expect(v(R.otherIncomeShare(30, 100))).toBe(30);
    expect(v(R.otherIncomeShare(30, -10))).toBe('not_meaningful');
    expect(v(R.otherIncomeShare(30, 0))).toBe('not_meaningful');
    expect(v(R.costToIncome(45, 80, 20))).toBe(45);
    expect(v(R.costToIncome(45, 0, 0))).toBe('not_meaningful');
    expect(v(R.costToIncome(45, null, 20))).toBe('not_available');
  });
  it('percentile rank and median', () => {
    expect(R.percentileRank(5, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(50);
    expect(R.median([3, 1, 2])).toBe(2);
    expect(R.median([4, 1, 2, 3])).toBe(2.5);
    expect(R.median([])).toBeNull();
  });
});

describe('indicators match reference implementations within 1e-6 (CMP-10)', () => {
  const r = mulberry32(7);
  let p = 100;
  const series = Array.from({ length: 1500 }, () => (p *= Math.exp(normal(r) * 0.015)));
  const close = (a: (number | null)[], b: (number | null)[]) => a.every((x, i) => (x === null ? b[i] === null : Math.abs(x - (b[i] as number)) < 1e-6));
  it('SMA', () => expect(close(sma(series, 50), reference.sma(series, 50))).toBe(true));
  it('realised volatility', () => expect(close(realisedVol(series, 20), reference.realisedVol(series, 20))).toBe(true));
  it('rolling max', () => expect(close(rollingExtreme(series, 252, 'max'), reference.rollingMax(series, 252))).toBe(true));
  it('RSI (Wilder)', () => expect(close(rsi(series, 14), reference.rsi(series, 14))).toBe(true));
  it('RSI of a monotonically rising series is 100', () => expect(rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14)[15]).toBe(100));
});

describe('metric definitions library (MTH-01, SCR-01)', () => {
  it('has at least 40 screener fields', () => expect(METRICS.filter((m) => m.screener).length).toBeGreaterThanOrEqual(40));
  it('every definition has a formula, description and at least one edge rule', () => {
    for (const m of METRICS) {
      expect(m.formula.length, m.code).toBeGreaterThan(5);
      expect(m.description.length, m.code).toBeGreaterThan(10);
      expect(m.edgeRules.length, m.code).toBeGreaterThan(0);
    }
  });
  it('codes are unique', () => expect(new Set(METRICS.map((m) => m.code)).size).toBe(METRICS.length));
  it('prototype versions are preserved', () => {
    expect(METRIC_BY_CODE.get('operating_margin')!.version).toBe(3);
    expect(METRIC_BY_CODE.get('roce')!.version).toBe(2);
    expect(METRIC_BY_CODE.get('cash_conversion')!.version).toBe(2);
  });
});

const s = (vals: (number | null)[]) => vals.map((value, i) => ({ period: `FY${20 + i}`, value }));

describe('financial quality flags: five positive and five negative cases each (CMP-07)', () => {
  it('weak cash conversion', () => {
    for (const x of [[10, 20, 30], [49, 49, 49], [0, 10, 5], [-20, 30, 40], [45, 45, 49.9]]) expect(weakCashConversion(s(x)).triggered).toBe(true);
    for (const x of [[60, 20, 30], [50, 49, 49], [90, 95, 99], [10, 20, 55], [80, 10, 10]]) expect(weakCashConversion(s(x)).triggered).toBe(false);
    expect(weakCashConversion(s([10, 20])).status).toBe('insufficient_data');
  });
  it('rising receivable days', () => {
    for (const x of [[40, 42, 44, 46], [10, 20, 30, 40], [44, 46, 48, 49], [30, 31, 32, 33], [60, 70, 71, 90]]) expect(risingReceivableDays(s(x)).triggered).toBe(true);
    for (const x of [[46, 44, 42, 40], [40, 42, 42, 46], [40, 45, 43, 50], [50, 50, 50, 50], [40, 39, 41, 42]]) expect(risingReceivableDays(s(x)).triggered).toBe(false);
  });
  it('rising leverage', () => {
    for (const x of [[0.5, 0.8, 1.0, 1.2], [0.9, 1.1, 1.3, 1.5], [0.2, 0.5, 0.9, 1.01], [1, 2, 3, 4], [0.3, 0.6, 0.95, 1.4]]) expect(risingLeverage(s(x)).triggered).toBe(true);
    for (const x of [[0.1, 0.2, 0.3, 0.4], [1.5, 1.3, 1.1, 0.9], [0.5, 0.8, 0.7, 1.2], [0.9, 0.95, 0.99, 1.0], [2, 2, 2, 2]]) expect(risingLeverage(s(x)).triggered).toBe(false);
  });
  it('dependence on other income', () => {
    for (const x of [26, 30, 50, 99, 25.01]) expect(otherIncomeDependence(s([x])).triggered).toBe(true);
    for (const x of [25, 10, 0, 24.9, -5]) expect(otherIncomeDependence(s([x])).triggered).toBe(false);
  });
  it('auditor change and qualified opinion', () => {
    for (const fy of [2026, 2025, 2024]) expect(disclosedEvent('auditor_change', [{ fiscal_year: fy, detail: 'x' }], 2026).triggered).toBe(true);
    for (const fy of [2026, 2025]) expect(disclosedEvent('qualified_opinion', [{ fiscal_year: fy, detail: 'x' }], 2026).triggered).toBe(true);
    for (const fy of [2023, 2020, 2015]) expect(disclosedEvent('auditor_change', [{ fiscal_year: fy, detail: 'x' }], 2026).triggered).toBe(false);
    expect(disclosedEvent('qualified_opinion', [], 2026).triggered).toBe(false);
    expect(disclosedEvent('qualified_opinion', [{ fiscal_year: 2022, detail: 'x' }], 2026).triggered).toBe(false);
  });
  it('flag text never implies wrongdoing', () => {
    const all = [weakCashConversion(s([1, 2, 3])), risingReceivableDays(s([1, 2, 3, 4])), risingLeverage(s([1, 2, 3, 4])), otherIncomeDependence(s([30])), disclosedEvent('auditor_change', [], 2026)];
    for (const f of all) expect(FORBIDDEN_FLAG_WORDS.test(`${f.name} ${f.rule} ${f.note}`)).toBe(false);
  });
});
