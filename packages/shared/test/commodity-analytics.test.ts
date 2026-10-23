import { describe, expect, it } from 'vitest';
import { alignedReturns, monthEnd, periodicReturns, seasonality, seasonalZ, seriesSpread, termStructure } from '../src/index.js';

// Hand-calculated expectations; arithmetic shown next to each.

const D = (s: string) => Date.parse(`${s}T00:00:00Z`);

describe('periodic returns', () => {
  it('skip gaps longer than the frequency allows and any return across a non-positive price', () => {
    // WTI-like path through a negative print: 18.27 → −37.63 → 10.01 → 20.43
    const obs = [['2020-04-17', 18.27], ['2020-04-20', -37.63], ['2020-04-21', 10.01], ['2020-04-22', 20.43], ['2020-05-05', 24.56]].map(([d, v]) => ({ t: D(d as string), v: v as number }));
    const r = periodicReturns(obs, 'daily');
    // Only 10.01 → 20.43 is computable: 20.43/10.01 − 1 = 1.040959…; 22 Apr → 5 May is a 13-day gap.
    expect(r.returns.map((x) => +x.r.toFixed(6))).toEqual([1.040959]);
    expect(r).toMatchObject({ skipped_non_positive: 2, skipped_gap: 1 });
  });
  it('the shared aligned-returns helper also refuses returns across non-positive prices', () => {
    expect(alignedReturns([D('2020-04-17'), D('2020-04-20'), D('2020-04-21')], [18.27, -37.63, 10.01], 5)).toEqual([null, null]);
  });
});

describe('seasonality', () => {
  it('monthly series: average change by calendar month, with counts and a warning for short histories', () => {
    // Two years: Jan→Feb +10% then +20%; Feb→Mar −10% both years.
    const obs = [['2020-01-01', 100], ['2020-02-01', 110], ['2020-03-01', 99], ['2021-01-01', 100], ['2021-02-01', 120], ['2021-03-01', 108]].map(([d, v]) => ({ t: D(d as string), v: v as number }));
    const s = seasonality(obs, 'monthly');
    if (!s.ok) throw new Error(s.reason);
    expect(s.rows[1]).toMatchObject({ month: 2, years: 2, positive_share: 1 });
    expect(s.rows[1]!.mean).toBeCloseTo(0.15, 12); // (0.10 + 0.20) / 2
    expect(s.rows[2]!.mean).toBeCloseTo(-0.1, 12);
    // Dec 2020 → Jan 2021 is not consecutive in this data, so January has no value.
    expect(s.rows[0]).toMatchObject({ month: 1, years: 0, mean: null });
    expect(s.warning).toMatch(/Fewer than 5 years/);
  });
  it('daily series are reduced to month-end values first', () => {
    const obs = [['2021-01-29', 10], ['2021-01-04', 9], ['2021-02-26', 12]].map(([d, v]) => ({ t: D(d as string), v: v as number })).sort((a, b) => a.t - b.t);
    expect(monthEnd(obs).map((o) => o.v)).toEqual([10, 12]);
  });
});

describe('spreads and term structure', () => {
  it('spread on shared dates with unit multipliers (heating oil USD/gal × 42 − WTI USD/bbl)', () => {
    const ho = [{ t: D('2026-10-19'), v: 3 }, { t: D('2026-10-20'), v: 3.1 }];
    const wti = [{ t: D('2026-10-20'), v: 100 }, { t: D('2026-10-21'), v: 101 }];
    expect(seriesSpread(ho, wti, 42, 1)).toEqual([{ t: D('2026-10-20'), v: 3.1 * 42 - 100 }]); // 130.2 − 100 = 30.2
  });
  it('contango, backwardation and the roll-yield proxy', () => {
    const c = termStructure([{ position: 1, value: 70 }, { position: 2, value: 70.7 }, { position: 4, value: 72.1 }])!;
    expect(c.state).toBe('contango');
    expect(c.slope).toBeCloseTo(2.1, 10); // 72.1 − 70
    expect(c.roll_yield_annualised!).toBeCloseTo((70 / 70.7 - 1) * 12, 12); // −0.1188…
    const b = termStructure([{ position: 1, value: 80 }, { position: 2, value: 79 }])!;
    expect(b.state).toBe('backwardation');
    expect(termStructure([{ position: 1, value: 80 }])).toBeNull();
  });
});

describe('inventory against the same week of earlier years', () => {
  it('z-score against prior years', () => {
    // Same date in 2021–2023: 400, 420, 440 → mean 420, sample stdev 20; latest 460 → z = 2.
    const obs = [['2021-10-15', 400], ['2022-10-14', 420], ['2023-10-13', 440], ['2024-10-15', 460]].map(([d, v]) => ({ t: D(d as string), v: v as number }));
    const z = seasonalZ(obs, 5);
    if (!z.ok) throw new Error(z.reason);
    expect(z).toMatchObject({ mean: 420, comparisons: 3, years: [2023, 2022, 2021] });
    expect(z.z).toBeCloseTo(2, 12);
    expect(seasonalZ(obs.slice(2), 5).ok).toBe(false);
  });
});
