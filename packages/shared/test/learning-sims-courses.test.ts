import { describe, expect, it } from 'vitest';
import {
  compound, costDragPct, dcf, dcfSensitivity, doublingYears, dupont, equalWeightVol, evBridge, indexReturns, maxDrawdown, multipleTesting, operatingCashFlow, overfitDemo, realReturnPct, roce, twoAssetVol,
} from '../src/learning-sims-courses.js';

// Golden values are hand-calculated (shown in comments) and are the same numbers the lessons print.

describe('money over time (MARKET DECODER module 3)', () => {
  it('compounding: ₹10,000 at 10% for 2 years = ₹12,100; 20 years ≈ ₹67,275', () => {
    expect(compound(10_000, 10, 2)).toBeCloseTo(12_100, 8);
    expect(compound(10_000, 10, 20)).toBeCloseTo(67_275.0, 0);
  });
  it('real return: 7% nominal with 5% inflation = 1.905%, not 2%', () => {
    expect(realReturnPct(7, 5)).toBeCloseTo(1.9048, 4); // 1.07/1.05 − 1
    expect(realReturnPct(4, 6)).toBeCloseTo(-1.8868, 4);
  });
  it('doubling time at 8% ≈ 9.01 years (rule of 72 says 9)', () => expect(doublingYears(8)).toBeCloseTo(9.006, 3));
});

describe('risk and indices (MARKET DECODER modules 2 and 4)', () => {
  it('diversification: 30% stocks, ρ = 0.3 → 1 stock 30%, 10 stocks ≈ 18.6%, floor √0.3 × 30 ≈ 16.4%', () => {
    expect(equalWeightVol(30, 1, 0.3)).toBeCloseTo(30, 10);
    expect(equalWeightVol(30, 10, 0.3)).toBeCloseTo(30 * Math.sqrt(0.3 + 0.7 / 10), 10); // 18.574
    expect(equalWeightVol(30, 10_000, 0.3)).toBeCloseTo(16.43, 1);
    expect(() => equalWeightVol(30, 3, -0.9)).toThrow();
  });
  it('index weighting: a big stock rising 10% moves a cap-weighted index far more than an equal-weighted one', () => {
    const r = indexReturns([
      { name: 'Big', price0: 100, price1: 110, shares: 90 },
      { name: 'Small', price0: 100, price1: 90, shares: 10 },
    ]);
    expect(r.cap_weighted_pct).toBeCloseTo(8, 10); // (9900+900)/(9000+1000) − 1
    expect(r.equal_weighted_pct).toBeCloseTo(0, 10);
    expect(r.weights[0]!.weight_pct).toBeCloseTo(90, 10);
  });
});

describe('statements and returns on capital (EQUITY DETECTIVE)', () => {
  it('cash flow: profit 100, D&A 20, receivables +60, inventory +30, payables +10 → OCF 40, conversion 40%', () => {
    expect(operatingCashFlow({ netProfit: 100, depreciation: 20, receivablesChange: 60, inventoryChange: 30, payablesChange: 10 })).toEqual({ ocf: 40, working_capital_change: 80, cash_conversion_pct: 40 });
    expect(operatingCashFlow({ netProfit: -10, depreciation: 5, receivablesChange: 0, inventoryChange: 0, payablesChange: 0 }).cash_conversion_pct).toBeNull();
  });
  it('DuPont: margin 10% × turnover 1.5 × multiplier 2 = ROE 30%, equal to profit ÷ equity', () => {
    const d = dupont({ revenue: 1500, netProfit: 150, assets: 1000, equity: 500 });
    expect(d.net_margin_pct).toBeCloseTo(10, 10);
    expect(d.asset_turnover).toBeCloseTo(1.5, 10);
    expect(d.equity_multiplier).toBeCloseTo(2, 10);
    expect(d.roe_pct).toBeCloseTo(30, 10);
    expect(d.roe_direct_pct).toBeCloseTo(d.roe_pct, 10);
    expect(() => dupont({ revenue: 0, netProfit: 1, assets: 1, equity: 1 })).toThrow();
  });
  it('ROCE = EBIT ÷ (equity + debt); undefined for non-positive capital', () => {
    expect(roce(180, 800, 400)).toBeCloseTo(15, 10);
    expect(roce(10, -50, 20)).toBeNull();
  });
  it('EV bridge: 1,000 + 300 − 100 = 1,200; EV/EBITDA 8×; P/E 12.5×; loss-maker has no P/E', () => {
    expect(evBridge({ marketCap: 1000, debt: 300, cash: 100, ebitda: 150, netProfit: 80 })).toEqual({ ev: 1200, ev_ebitda: 8, pe: 12.5 });
    expect(evBridge({ marketCap: 1000, debt: 0, cash: 0, ebitda: -5, netProfit: -1 })).toEqual({ ev: 1000, ev_ebitda: null, pe: null });
  });
});

describe('returns, bias and experiments (SIGNAL ENGINEER)', () => {
  it('max drawdown of 100 → 150 → 90 → 120 is 40% from peak 1 to trough 2', () => {
    expect(maxDrawdown([100, 150, 90, 120])).toEqual({ max_drawdown_pct: 40, peak: 1, trough: 2 });
    expect(maxDrawdown([100, 110, 120]).max_drawdown_pct).toBe(0);
  });
  it('overfitting: the best of 200 no-edge strategies looks good in-sample and regresses out of sample', () => {
    const a = overfitDemo(200, 100, 42);
    expect(a).toEqual(overfitDemo(200, 100, 42)); // deterministic
    expect(a.best_in_sample_pct).toBeGreaterThan(10);
    expect(Math.abs(a.average_in_sample_pct)).toBeLessThan(2);
    // Across many seeds, the in-sample winner's out-of-sample result averages about zero.
    let sum = 0;
    for (let s = 1; s <= 200; s++) sum += overfitDemo(200, 100, s).same_strategy_out_of_sample_pct;
    expect(Math.abs(sum / 200)).toBeLessThan(1.5);
  });
  it('cost drag: turnover 4× at 0.3% = 1.2% a year', () => expect(costDragPct(4, 0.3)).toBeCloseTo(1.2, 12));
});

describe('valuation, portfolio risk and validation (MARKET ARCHITECT)', () => {
  it('DCF: FCF 100, 110, 121 at 12% with 4% terminal growth', () => {
    const v = dcf({ fcf: [100, 110, 121], discountPct: 12, terminalGrowthPct: 4 });
    // PV explicit = 100/1.12 + 110/1.12² + 121/1.12³ = 89.2857 + 87.6913 + 86.1253 = 263.1023
    expect(v.pv_explicit).toBeCloseTo(263.1023, 3);
    // TV = 121 × 1.04 / 0.08 = 1573; 1.12³ = 1.404928; PV = 1573 / 1.404928 = 1119.6303
    expect(v.pv_terminal).toBeCloseTo(1119.6303, 3);
    expect(v.value).toBeCloseTo(1382.7326, 3);
    expect(v.terminal_share_pct).toBeCloseTo(80.97, 1);
    expect(() => dcf({ fcf: [100], discountPct: 4, terminalGrowthPct: 4 })).toThrow();
  });
  it('sensitivity grid is monotone and blank where discount ≤ growth', () => {
    const g = dcfSensitivity([100, 110, 121], [10, 12, 14], [3, 4, 5]);
    expect(g[1]![1]).toBeCloseTo(1382.7326, 3);
    expect(g[0]![0]!).toBeGreaterThan(g[1]![0]!); // lower discount → higher value
    expect(g[1]![2]!).toBeGreaterThan(g[1]![1]!); // higher growth → higher value
    expect(dcfSensitivity([100], [4], [4, 5])).toEqual([[null, null]]);
  });
  it('two-asset volatility: 20%/20%, ρ = 0, 50/50 → 14.14%; ρ = 1 → 20%; ρ = −1 → 0', () => {
    expect(twoAssetVol(0.5, 20, 20, 0)).toBeCloseTo(14.1421, 4);
    expect(twoAssetVol(0.5, 20, 20, 1)).toBeCloseTo(20, 10);
    expect(twoAssetVol(0.5, 20, 20, -1)).toBeCloseTo(0, 10);
    expect(() => twoAssetVol(1.2, 20, 20, 0)).toThrow();
  });
  it('multiple testing: 100 tests at 5% → 5 expected false positives, 99.4% chance of at least one', () => {
    const m = multipleTesting(100, 0.05);
    expect(m.expected_false_positives).toBeCloseTo(5, 12);
    expect(m.p_at_least_one_pct).toBeCloseTo(99.408, 3);
    expect(m.bonferroni_alpha).toBeCloseTo(0.0005, 12);
  });
});
