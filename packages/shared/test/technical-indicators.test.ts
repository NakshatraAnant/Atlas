import { describe, expect, it } from 'vitest';
import { backtestSma, DAY, ema, gaps, macd, momentum, rangeHighLow, relativeStrength, rollingReturns, rsi, walkForward } from '../src/index.js';

// Hand-calculated values; each expectation shows the arithmetic.

const day = (i: number) => Date.UTC(2026, 0, 1) + i * DAY;

describe('ema', () => {
  it('seeds with the simple average, then k = 2/(n+1)', () => {
    // n=3, k=0.5: seed (1+2+3)/3 = 2; then 4·0.5 + 2·0.5 = 3; 5·0.5 + 3·0.5 = 4
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(ema([1, 2], 3)).toEqual([null, null]);
  });
});

describe('rsi (Wilder)', () => {
  it('matches a hand calculation', () => {
    // changes +1 +1 −1 +1, n=2. i=2: gain 1, loss 0 → 100.
    // i=3: gain (1·1+0)/2 = 0.5, loss (0·1+1)/2 = 0.5 → RS 1 → 50.
    // i=4: gain (0.5+1)/2 = 0.75, loss (0.5+0)/2 = 0.25 → RS 3 → 75.
    expect(rsi([1, 2, 3, 2, 3], 2)).toEqual([null, null, 100, 50, 75]);
  });
  it('a flat series is 50, and values stay within 0–100', () => {
    expect(rsi([5, 5, 5, 5], 2)).toEqual([null, null, 50, 50]);
    const r = rsi(Array.from({ length: 60 }, (_, i) => 100 + 10 * Math.sin(i / 3)), 14).filter((x): x is number => x !== null);
    expect(r.every((x) => x >= 0 && x <= 100)).toBe(true);
    expect(rsi([1, 2], 14).every((x) => x === null)).toBe(true);
  });
});

describe('macd', () => {
  it('is zero on a constant series and positive in a steady rise', () => {
    const flat = macd(Array(40).fill(100));
    expect(flat.macd[39]).toBeCloseTo(0, 12);
    expect(flat.signal[39]).toBeCloseTo(0, 12);
    const rise = macd(Array.from({ length: 60 }, (_, i) => 100 + i));
    expect(rise.macd[59]!).toBeGreaterThan(0);
    // First MACD value at index slow−1 = 25; first signal 8 values later (index 33).
    expect(rise.macd[24]).toBeNull();
    expect(rise.macd[25]).not.toBeNull();
    expect(rise.signal[32]).toBeNull();
    expect(rise.signal[33]).not.toBeNull();
    expect(rise.histogram[33]).toBeCloseTo(rise.macd[33]! - rise.signal[33]!, 12);
  });
});

describe('momentum, rolling returns, relative strength', () => {
  it('momentum(n) = c_t / c_{t−n} − 1', () => {
    expect(momentum([100, 110, 121], 1)).toEqual([null, 0.10000000000000009, 0.10000000000000009]);
    expect(momentum([100, 110, 121], 2)[2]).toBeCloseTo(0.21, 12);
  });
  it('rolling returns are defined only where the window is covered', () => {
    const obs = [100, 110, 121, 133.1].map((v, i) => ({ t: day(i), v }));
    expect(rollingReturns(obs, 2).map((p) => +p.v.toFixed(4))).toEqual([0.21, 0.21]);
  });
  it('relative strength uses shared dates only and starts at 1', () => {
    const a = [{ t: day(0), v: 100 }, { t: day(1), v: 110 }, { t: day(3), v: 120 }];
    const b = [{ t: day(0), v: 50 }, { t: day(1), v: 50 }, { t: day(2), v: 60 }, { t: day(3), v: 60 }];
    // day 3: (120/100) / (60/50) = 1.2 / 1.2 = 1; day 2 dropped (A has no value).
    expect(relativeStrength(a, b).map((p) => +p.v.toFixed(6))).toEqual([1, 1.1, 1]);
    expect(relativeStrength(a, [])).toEqual([]);
  });
});

describe('gaps and range', () => {
  it('lists gaps above the threshold and whether they were filled', () => {
    const bars = [
      { t: day(0), open: 100, high: 101, low: 99, close: 100 },
      { t: day(1), open: 103, high: 104, low: 99.5, close: 103 }, // +3%, low 99.5 ≤ 100 → filled
      { t: day(2), open: 99, high: 100, low: 98, close: 99 }, // 99/103 − 1 = −3.88%, high 100 < 103 → not filled
      { t: day(3), open: 99.5, high: 100, low: 99, close: 99.5 }, // +0.5% → below threshold
    ];
    const g = gaps(bars, 0.02);
    expect(g.map((x) => [x.t, +x.gap.toFixed(4), x.filled])).toEqual([[day(1), 0.03, true], [day(2), -0.0388, false]]);
  });
  it('52-week range over the last window', () => {
    const obs = [5, 9, 3, 7].map((v, i) => ({ t: day(i), v }));
    const r = rangeHighLow(obs, 3);
    expect(r).toMatchObject({ ok: true, high: 9, low: 3, observations: 3 }); // last 3: 9, 3, 7
    expect(rangeHighLow(obs, 252).ok).toBe(false); // fewer than 20 observations for a long window
    const long = Array.from({ length: 30 }, (_, i) => ({ t: day(i), v: i === 10 ? 200 : 100 + i }));
    const r2 = rangeHighLow(long, 252);
    expect(r2).toMatchObject({ ok: true, high: 200, low: 100, observations: 30 });
  });
});

describe('session-calendar backtests', () => {
  // Weekday-only series: on calendar-day rules every Monday return would be dropped.
  const sessions = (() => {
    const out: { t: number; v: number }[] = [];
    let v = 100;
    for (let i = 0; out.length < 300; i++) {
      const t = day(i);
      const wd = new Date(t).getUTCDay();
      if (wd === 0 || wd === 6) continue;
      v *= 1.001;
      out.push({ t, v });
    }
    return out;
  })();
  it('counts session-to-session returns across weekends, which the calendar-day rule drops', () => {
    const p = { fast: 5, slow: 20, fee_bps: 0, slippage_bps: 0 };
    const days = backtestSma(sessions, p);
    const sess = backtestSma(sessions, { ...p, calendar: 'sessions' });
    if (!days.ok || !sess.ok) throw new Error('backtest failed');
    // Buy and hold over n sessions of +0.1% = 1.001^(n−1) − 1 with sessions; fewer returns with calendar days.
    const n = sessions.length - 19;
    expect(sess.buy_hold_total_return).toBeCloseTo(1.001 ** (n - 1) - 1, 10);
    expect(days.buy_hold_total_return).toBeLessThan(sess.buy_hold_total_return);
    expect(sess.assumptions[0]).toMatch(/Session calendar/);
  });
  it('a gap longer than 5 calendar days earns nothing', () => {
    const withHole = sessions.filter((o) => o.t < day(100) || o.t > day(110));
    const r = backtestSma(withHole, { fast: 5, slow: 20, fee_bps: 0, slippage_bps: 0, calendar: 'sessions' });
    const full = backtestSma(sessions, { fast: 5, slow: 20, fee_bps: 0, slippage_bps: 0, calendar: 'sessions' });
    if (!r.ok || !full.ok) throw new Error('backtest failed');
    expect(r.buy_hold_total_return).toBeLessThan(full.buy_hold_total_return);
  });
  it('walk-forward passes the calendar through and says windows are sessions', () => {
    const r = walkForward(sessions, [{ fast: 5, slow: 20 }], 100, 50, { fee_bps: 0, slippage_bps: 0, calendar: 'sessions' });
    if (!r.ok) throw new Error(r.reason);
    expect(r.folds.length).toBe(4);
    expect(r.assumptions.join(' ')).toMatch(/trading sessions/);
  });
});
