import { describe, expect, it } from 'vitest';
import { DAY } from '../src/crypto-analytics.js';
import { alignedReturns, alignSeries, correlationShifts, covariance, portfolio, recentVsBaseline, riskRatios, stressScenario, walkForward } from '../src/research-analytics.js';

// Hand-calculated expectations; the arithmetic is in each test name or comment.
const D = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

describe('alignment across calendars', () => {
  it('keeps only dates present in every series and never fills', () => {
    const crypto = [D('2026-01-02'), D('2026-01-03'), D('2026-01-04'), D('2026-01-05')].map((t, i) => ({ t, v: 100 + i }));
    const equity = [D('2026-01-02'), D('2026-01-05')].map((t, i) => ({ t, v: 50 + i }));
    const a = alignSeries([crypto, equity]);
    expect(a.dates).toEqual([D('2026-01-02'), D('2026-01-05')]);
    expect(a.values).toEqual([[100, 103], [50, 51]]);
    // a 3-day session gap (Friday → Monday) is a valid session return; a longer one breaks the chain
    expect(alignedReturns(a.dates, a.values[0]!, 5)[0]).toBeCloseTo(0.03, 12);
    expect(alignedReturns(a.dates, a.values[0]!, 2)).toEqual([null]);
  });
});

describe('risk-adjusted ratios', () => {
  const rets = Array.from({ length: 30 }, (_, i) => (i % 2 ? 0 : 0.02));
  it('Sharpe = mean/stdev × √N: 0.01 / 0.0101710 × √252 = 15.607 (rf 0)', () => {
    const r = riskRatios(rets, 252);
    expect(r.ok && r.sharpe).toBeCloseTo(15.607, 2);
    expect(r.ok && r.sortino).toBeNull(); // no return below the target: downside deviation is 0
  });
  it('a risk-free rate lowers Sharpe: rf 2.52% → (0.01 − 0.0001)/0.010171 × √252 = 15.451', () => {
    const r = riskRatios(rets, 252, 0.0252);
    expect(r.ok && r.sharpe).toBeCloseTo(15.451, 2);
  });
  it('refuses fewer than 30 returns', () => expect(riskRatios([0.01, 0.02], 252).ok).toBe(false));
});

describe('portfolio', () => {
  const dates = [D('2026-01-30'), D('2026-01-31'), D('2026-02-01'), D('2026-02-02')];
  const prices = [[1, 2, 4, 8], [1, 1, 1, 1]];
  it('buy and hold: 0.5 × 8 + 0.5 × 1 = 4.5', () => {
    const r = portfolio(dates, prices, [0.5, 0.5], 'none');
    expect(r.ok && r.value[3]).toBeCloseTo(4.5, 12);
    expect(r.ok && r.rebalances).toBe(0);
  });
  it('monthly rebalance at the January close: 1 → 1.5 → 2.25 → 3.75', () => {
    const r = portfolio(dates, prices, [0.5, 0.5], 'monthly');
    if (!r.ok) throw new Error('expected ok');
    expect(r.value.map((v) => +v.toFixed(6))).toEqual([1, 1.5, 2.25, 3.75]);
    expect(r.rebalances).toBe(1);
    // contributions add up to the sum of periodic returns: 0.5 + 0.5 + 0.6667
    expect(r.contributions[0]! + r.contributions[1]!).toBeCloseTo(r.returns.reduce((a, b) => a + b, 0), 12);
    expect(r.hhi).toBeCloseTo(0.5, 12);
  });
  it('rejects weights that do not add up to 100%', () => expect(portfolio(dates, prices, [0.5, 0.4], 'none').ok).toBe(false));
});

describe('stress scenario', () => {
  const cov = [[0.0004, 0], [0, 0.0001]];
  it('baseline √(.25·.0004 + .25·.0001) = 0.01118; ρ shifted to 1 → √(.000125 + 2·.25·.02·.01) = 0.015; shock −0.15', () => {
    const r = stressScenario(cov, 1, { weights: [0.5, 0.5], shocks: [-0.2, -0.1], volMultiplier: 1, correlationShift: 1 });
    if (!r.ok) throw new Error('expected ok');
    expect(r.baseline_vol).toBeCloseTo(0.0111803, 6);
    expect(r.stressed_vol).toBeCloseTo(0.015, 6);
    expect(r.shock_return).toBeCloseTo(-0.15, 12);
  });
  it('a 2× volatility multiplier doubles volatility at unchanged correlation', () => {
    const r = stressScenario(cov, 1, { weights: [0.5, 0.5], shocks: [0, 0], volMultiplier: 2, correlationShift: 0 });
    expect(r.ok && r.stressed_vol).toBeCloseTo(2 * 0.0111803, 6);
  });
  it('covariance of perfectly co-moving columns', () => expect(covariance([[1, 2, 3], [2, 4, 6]])[0]![1]).toBeCloseTo(2, 12));
});

describe('walk-forward', () => {
  const obs = Array.from({ length: 400 }, (_, i) => ({ t: D('2024-01-01') + i * DAY, v: 100 * Math.exp(0.001 * i + 0.05 * Math.sin(i / 9)) }));
  it('folds use non-overlapping test windows after their training windows', () => {
    const r = walkForward(obs, [{ fast: 10, slow: 50 }, { fast: 20, slow: 100 }], 260, 60, { fee_bps: 10, slippage_bps: 5 });
    if (!r.ok) throw new Error(r.reason);
    expect(r.folds.length).toBe(2); // starts 0 and 60; a third would need 440 observations
    for (const f of r.folds) expect(f.test_from).toBeGreaterThan(f.train_to);
    expect(r.folds[1]!.test_from).toBeGreaterThan(r.folds[0]!.test_to);
    expect(r.oos_curve.length).toBe(120);
    expect(r.oos_curve[0]!.t).toBe(r.folds[0]!.test_from);
  });
  it('refuses a training window shorter than the slow average plus 30 days', () => {
    expect(walkForward(obs, [{ fast: 10, slow: 200 }], 200, 60, { fee_bps: 0, slippage_bps: 0 }).ok).toBe(false);
  });
});

describe('discovery helpers', () => {
  it('detects one correlation regime change from 0.2 to 0.8', () => {
    const rolling = Array.from({ length: 30 }, (_, i) => ({ t: i * DAY, v: i < 10 ? 0.2 : 0.8 }));
    const s = correlationShifts(rolling, 5, 0.4);
    expect(s.length).toBe(1);
    expect(s[0]!.change).toBeCloseTo(0.6, 12);
  });
  it('recent vs baseline: mean(20,20) ÷ mean(10,10,10,10) = 2', () => {
    expect(recentVsBaseline([10, 10, 10, 10, 20, 20], 2, 4)?.ratio).toBe(2);
    expect(recentVsBaseline([0, 0, 1], 1, 2)).toBeNull();
  });
});
