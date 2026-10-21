import { describe, expect, it } from 'vitest';
import { DEFAULT_STATEMENT_INPUTS, OPENING, threeStatements, validateStatementInputs, type StatementInputs } from '../src/three-statements.js';

describe('three-statement teaching model', () => {
  it('worked default case, by hand', () => {
    const s = threeStatements(DEFAULT_STATEMENT_INPUTS);
    // EBITDA 18% of 1000 = 180; depreciation 10% of 600 = 60; EBIT 120; interest 9% of 300 = 27;
    // PBT 93; tax 25% = 23.25; PAT 69.75.
    expect(s.income).toEqual({ revenue: 1000, operatingCosts: 820, ebitda: 180, depreciation: 60, ebit: 120, interest: 27, pbt: 93, tax: 23.25, pat: 69.75 });
    // OCF = 69.75 + 60 − 30 = 99.75; capex 80; dividends 30% of 69.75 = 20.93 (20.925); net change −1.18.
    expect(s.cashFlow.operating).toBe(99.75);
    expect(s.cashFlow.capex).toBe(80);
    expect(s.cashFlow.dividends).toBe(20.93);
    expect(s.cashFlow.netChange).toBe(-1.18);
    expect(s.links.freeCashFlow).toBe(19.75);
    expect(s.links.cashConversionPct).toBe(143.01);
    expect(s.links.retainedProfit).toBe(48.83);
    expect(s.balanceSheet.closing.equity).toBe(648.83);
    expect(s.balanceSheet.closing.cash).toBe(118.83);
  });

  it('the balance sheet balances for every input combination tried', () => {
    const grid: StatementInputs[] = [];
    for (const revenue of [50, 1000, 20000]) for (const m of [-40, 0, 18, 55]) for (const capex of [0, 15, 40]) for (const wc of [-20, 0, 30]) for (const payout of [0, 60, 100]) for (const b of [-300, 0, 500]) {
      grid.push({ revenue, ebitdaMarginPct: m, capexPct: capex, workingCapitalIncreasePct: wc, payoutPct: payout, newBorrowing: b });
    }
    for (const g of grid) {
      const { balanceSheet: bs } = threeStatements(g);
      expect(Math.abs(bs.closing.assets - bs.closing.liabilitiesAndEquity)).toBeLessThan(0.011);
    }
    expect(grid.length).toBe(3 * 4 * 3 * 3 * 3 * 3);
  });

  it('the opening balance sheet balances and a loss pays no tax or dividend', () => {
    const s = threeStatements({ ...DEFAULT_STATEMENT_INPUTS, ebitdaMarginPct: -10 });
    expect(s.balanceSheet.opening.assets).toBe(OPENING.cash + OPENING.fixedAssets + OPENING.workingCapital);
    expect(s.balanceSheet.opening.assets).toBe(s.balanceSheet.opening.liabilitiesAndEquity);
    expect(s.income.tax).toBe(0);
    expect(s.cashFlow.dividends).toBe(0);
    expect(s.links.cashConversionPct).toBeNull();
    expect(s.warnings.join(' ')).toMatch(/loss/);
  });

  it('cash moves from the opening to the closing balance sheet exactly by the cash-flow statement', () => {
    const s = threeStatements({ ...DEFAULT_STATEMENT_INPUTS, newBorrowing: 120, capexPct: 20 });
    expect(s.balanceSheet.closing.cash).toBeCloseTo(OPENING.cash + s.cashFlow.netChange, 2);
    expect(s.cashFlow.netChange).toBeCloseTo(s.cashFlow.operating + s.cashFlow.investing + s.cashFlow.financing, 2);
  });

  it('rejects inputs outside the teaching ranges with clear messages', () => {
    expect(validateStatementInputs({ ...DEFAULT_STATEMENT_INPUTS, revenue: 0 })).toHaveLength(1);
    expect(() => threeStatements({ ...DEFAULT_STATEMENT_INPUTS, newBorrowing: -400 })).toThrow(/borrowing/);
    expect(() => threeStatements({ ...DEFAULT_STATEMENT_INPUTS, payoutPct: 120 })).toThrow(/Payout/);
  });
});
