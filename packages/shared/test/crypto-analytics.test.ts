import { describe, expect, it } from 'vitest';
import { alignToSessions, backtestSma, beta, cagr, correlation, DAY, distribution, drawdowns, logReturns, periodReturn, realisedVol, regimes, rollingCorrelation, sessionCorrelation, stdev, volumeTrend, type Obs } from '../src/crypto-analytics.js';
import { catchUpProbability, impermanentLoss, lpVsHold, posSelect, powExpectedBlocks, simulateTokenomics, swapXForY, toyHash, toyMine, verifyToyChain } from '../src/crypto-sims.js';

// Expected values below were calculated by hand (or from published tables) and are written out in
// the comments, so a reviewer can re-derive every number.

const T0 = Date.UTC(2024, 0, 1);
const series = (vs: number[], start = T0): Obs[] => vs.map((v, i) => ({ t: start + i * DAY, v }));
const fromLogReturns = (rs: number[], p0 = 100): Obs[] => {
  const out: Obs[] = [{ t: T0, v: p0 }];
  rs.forEach((r, i) => out.push({ t: T0 + (i + 1) * DAY, v: out[i]!.v * Math.exp(r) }));
  return out;
};

describe('returns', () => {
  it('computes daily log returns: ln(110/100) = 0.0953102, ln(99/110) = −0.1053605', () => {
    const r = logReturns(series([100, 110, 99]));
    expect(r.map((x) => x.r)).toEqual([expect.closeTo(0.0953102, 6), expect.closeTo(-0.1053605, 6)]);
  });
  it('does not bridge gaps: day 1 → day 3 produces no daily return', () => {
    const obs = [{ t: T0, v: 100 }, { t: T0 + DAY, v: 110 }, { t: T0 + 3 * DAY, v: 121 }];
    expect(logReturns(obs)).toHaveLength(1);
  });
  it('period return uses the observation exactly N days earlier: 110/103 − 1 = 6.7961%', () => {
    const r = periodReturn(series(Array.from({ length: 11 }, (_, i) => 100 + i)), 7);
    expect(r.ok && r.value).toBeCloseTo(0.0679612, 6);
    expect(r.ok && r.days_actual).toBe(7);
  });
  it('falls back to the nearest earlier observation within tolerance and reports the actual span', () => {
    const obs = series(Array.from({ length: 11 }, (_, i) => 100 + i)).filter((_, i) => i !== 3);
    const r = periodReturn(obs, 7);
    expect(r.ok && r.value).toBeCloseTo(110 / 102 - 1, 9);
    expect(r.ok && r.days_actual).toBe(8);
  });
  it('reports insufficient history instead of inventing a start price', () => {
    const r = periodReturn(series([100, 101, 102]), 30);
    expect(r.ok).toBe(false);
  });
});

describe('volatility', () => {
  it('sample standard deviation of [1,2,3,4] is 1.2909944', () => expect(stdev([1, 2, 3, 4])).toBeCloseTo(1.2909944, 6));
  it('annualises with √365: alternating ±1% log returns over 10 days → 0.0105409 × √365 = 0.201382', () => {
    const obs = fromLogReturns([0.01, -0.01, 0.01, -0.01, 0.01, -0.01, 0.01, -0.01, 0.01, -0.01]);
    const v = realisedVol(obs, { window: 10 });
    expect(v.ok && v.value).toBeCloseTo(0.201382, 5);
    expect(v.ok && v.returns_used).toBe(10);
  });
  it('uses √252 when asked (equity trading-day convention)', () => {
    const obs = fromLogReturns([0.01, -0.01, 0.01, -0.01, 0.01, -0.01, 0.01, -0.01, 0.01, -0.01]);
    const v = realisedVol(obs, { window: 10, annualisation: 252 });
    expect(v.ok && v.value).toBeCloseTo(0.0105409 * Math.sqrt(252), 5);
  });
  it('refuses a window with too many missing days', () => {
    const obs = series([100, 101, 102, 103, 104, 105]).filter((_, i) => i % 2 === 0);
    expect(realisedVol(obs, { window: 5 }).ok).toBe(false);
  });
});

describe('drawdowns', () => {
  it('[100,120,90,130,117]: max drawdown −25% (120→90), recovered in 2 days, current −10%', () => {
    const d = drawdowns(series([100, 120, 90, 130, 117]));
    if (!d.ok) throw new Error('expected ok');
    expect(d.max_drawdown).toBeCloseTo(-0.25, 9);
    expect(d.max_dd_peak.v).toBe(120);
    expect(d.max_dd_trough.v).toBe(90);
    expect(d.max_dd_recovery?.v).toBe(130);
    expect(d.recovery_days).toBe(2);
    expect(d.current_drawdown).toBeCloseTo(117 / 130 - 1, 9);
    expect(d.days_since_peak).toBe(1);
  });
  it('an unrecovered drawdown has no recovery date', () => {
    const d = drawdowns(series([100, 80, 90]));
    expect(d.ok && d.max_dd_recovery).toBeNull();
  });
});

describe('correlation and beta', () => {
  const rs = Array.from({ length: 60 }, (_, i) => Math.sin(i) * 0.02);
  const a = fromLogReturns(rs);
  it('a series is perfectly correlated with a scaled copy of itself (ρ = 1) and anti-correlated with its mirror (ρ = −1)', () => {
    expect((correlation(a, fromLogReturns(rs.map((r) => 2 * r))) as { value: number }).value).toBeCloseTo(1, 9);
    expect((correlation(a, fromLogReturns(rs.map((r) => -r))) as { value: number }).value).toBeCloseTo(-1, 9);
  });
  it('aligns on dates: observations missing from either series are excluded, not filled', () => {
    const b = fromLogReturns(rs.map((r) => 2 * r)).filter((_, i) => i % 10 !== 5);
    const c = correlation(a, b, { minObs: 10 });
    expect(c.ok && c.n).toBe(60 - 6 * 2); // each removed day removes two daily returns
  });
  it('beta of 2r against r is 2', () => {
    expect((beta(fromLogReturns(rs.map((r) => 2 * r)), a) as { value: number }).value).toBeCloseTo(2, 9);
  });
  it('rolling correlation produces one value per day with a full window', () => {
    expect(rollingCorrelation(a, a, 20, 20).length).toBe(60 - 20 + 1);
    expect(rollingCorrelation(a, a, 20).length).toBe(60 - 16 + 1); // default minObs = ceil(0.8 × 20) = 16
  });
  it('needs a minimum number of aligned observations', () => expect(correlation(series([1, 2, 3]), series([1, 2, 3])).ok).toBe(false));
});

describe('distribution, CAGR, regimes, volume', () => {
  it('a symmetric return set has zero skew', () => {
    const d = distribution(fromLogReturns(Array.from({ length: 40 }, (_, i) => (i % 2 ? 1 : -1) * Math.log(1.01))));
    // simple returns +1% and −0.990099%: nearly symmetric, skew close to 0
    expect(d.ok && Math.abs(d.skew)).toBeLessThan(0.01);
    expect(d.ok && d.n).toBe(40);
  });
  it('CAGR over 730 days from 100 to 121 = 1.21^(365.25/730) − 1 = 10.0072%', () => {
    const obs = [{ t: T0, v: 100 }, { t: T0 + 730 * DAY, v: 121 }];
    expect((cagr(obs) as { value: number }).value).toBeCloseTo(0.100072, 5);
  });
  it('CAGR is refused for spans under a year', () => expect(cagr(series([100, 110])).ok).toBe(false));
  it('classifies regimes only once 200-day averages exist', () => {
    expect(regimes(series(Array.from({ length: 100 }, (_, i) => 100 + i))).ok).toBe(false);
    const up = regimes(fromLogReturns(Array.from({ length: 300 }, (_, i) => 0.002 + 0.01 * Math.sin(i))));
    expect(up.ok && up.current.startsWith('uptrend')).toBe(true);
  });
  it('volume trend: last-30 mean ÷ last-90 mean', () => {
    const v = volumeTrend([...Array(60).fill(10), ...Array(30).fill(20)]);
    expect(v.ok && v.ratio).toBeCloseTo(20 / (40 / 3), 9); // 90-day mean = (600 + 600)/90 = 13.333
  });
});

describe('backtest (no look-ahead)', () => {
  it('a rising series: one entry, cost charged once, lag makes the strategy trail buy and hold', () => {
    const obs = series(Array.from({ length: 120 }, (_, i) => 100 * 1.01 ** i));
    const r = backtestSma(obs, { fast: 5, slow: 20, fee_bps: 10, slippage_bps: 5 });
    if (!r.ok) throw new Error('expected ok');
    expect(r.trades).toBe(1);
    expect(r.costs_paid).toBeGreaterThan(0);
    expect(r.strategy_total_return).toBeLessThan(r.buy_hold_total_return);
    expect(r.assumptions.join(' ')).toMatch(/next day's close/);
  });
  it('cannot profit from a jump on the day its signal fires (execution is one day later)', () => {
    // flat, then a single +50% jump; the SMA cross happens on the jump day, so the strategy misses it
    const vs = [...Array(60).fill(100), 150, ...Array(40).fill(150)];
    const r = backtestSma(series(vs), { fast: 2, slow: 10, fee_bps: 0, slippage_bps: 0 });
    expect(r.ok && r.strategy_total_return).toBeCloseTo(0, 9);
  });
});

describe('cross-asset session alignment', () => {
  it('keeps only crypto days that are equity sessions (weekend crypto days dropped)', () => {
    const crypto = series(Array.from({ length: 14 }, (_, i) => 100 + i));
    const sessions = crypto.filter((o) => ![0, 6].includes(new Date(o.t).getUTCDay())).map((o) => ({ t: o.t, v: 50 }));
    const aligned = alignToSessions(sessions, crypto);
    expect(aligned.length).toBe(sessions.length);
    expect(aligned.every((x) => ![0, 6].includes(new Date(x.t).getUTCDay()))).toBe(true);
    expect(sessionCorrelation(aligned, 100).ok).toBe(false);
  });
});

describe('educational simulations', () => {
  it('constant-product swap: x=y=100, no fee, 10 in → 100·10/110 = 9.090909 out', () => {
    const s = swapXForY({ x: 100, y: 100, fee: 0 }, 10);
    expect(s.dy).toBeCloseTo(9.090909, 6);
    expect(s.priceImpact).toBeCloseTo(-0.0909091, 6);
    expect(s.pool.x * s.pool.y).toBeCloseTo(10_000, 6);
  });
  it('a fee keeps k growing: x·y after a swap with 0.3% fee exceeds 10,000', () => {
    const s = swapXForY({ x: 100, y: 100, fee: 0.003 }, 10);
    expect(s.pool.x * s.pool.y).toBeGreaterThan(10_000);
  });
  it('impermanent loss: IL(1) = 0, IL(4) = 2·2/5 − 1 = −20%', () => {
    expect(impermanentLoss(1)).toBeCloseTo(0, 12);
    expect(impermanentLoss(4)).toBeCloseTo(-0.2, 12);
  });
  it('LP vs hold after a 4× price move: LP 4,000 vs hold 5,000 (ratio 0.8 = 1 + IL(4))', () => {
    const r = lpVsHold(10, 1000, 400);
    expect(r.lp).toBeCloseTo(4000, 6);
    expect(r.hold).toBeCloseTo(5000, 6);
  });
  it('tokenomics: 100 locked, 2-month cliff, 4-month linear vesting → circulating 100,100,125,…,200', () => {
    const m = simulateTokenomics({ initialCirculating: 100, tranches: [{ label: 'team', amount: 100, cliffMonths: 2, vestingMonths: 4 }], monthlyEmission: 0, monthlyBurnRate: 0, maxSupply: null, price: 1, months: 7 });
    expect(m.map((x) => x.circulating)).toEqual([100, 100, 100, 125, 150, 175, 200, 200]);
    expect(m[0]!.fdv).toBe(200);
    expect(m[3]!.monthlyDilution).toBeCloseTo(0.25, 9);
  });
  it('tokenomics: 10% monthly burn of 1,000 → 900, 810; emissions stop at the cap', () => {
    expect(simulateTokenomics({ initialCirculating: 1000, tranches: [], monthlyEmission: 0, monthlyBurnRate: 0.1, maxSupply: null, price: 1, months: 2 }).map((x) => x.circulating)).toEqual([1000, 900, 810]);
    expect(simulateTokenomics({ initialCirculating: 90, tranches: [], monthlyEmission: 7, monthlyBurnRate: 0, maxSupply: 100, price: 1, months: 3 }).map((x) => x.circulating)).toEqual([90, 97, 100, 100]);
  });
  it('toy hash is FNV-1a: "" → 811c9dc5, "a" → e40c292c', () => {
    expect(toyHash('')).toBe('811c9dc5');
    expect(toyHash('a')).toBe('e40c292c');
  });
  it('editing a mined block breaks the chain at that block', () => {
    const b0 = toyMine(0, '00000000', ['coinbase→alice 50'], 2)!;
    const b1 = toyMine(1, b0.hash, ['alice→bob 10'], 2)!;
    const b2 = toyMine(2, b1.hash, ['bob→carol 3'], 2)!;
    expect(b1.hash.startsWith('00')).toBe(true);
    expect(verifyToyChain([b0, b1, b2])).toBeNull();
    expect(verifyToyChain([b0, { ...b1, txs: ['alice→bob 1000'] }, b2])).toBe(1);
  });
  it('Nakamoto catch-up probability matches the whitepaper table (q=0.1, z=5 → 0.0009137; q=0.3, z=5 → 0.1773523)', () => {
    expect(catchUpProbability(0.1, 5)).toBeCloseTo(0.0009137, 7);
    expect(catchUpProbability(0.3, 5)).toBeCloseTo(0.1773523, 7);
    expect(catchUpProbability(0.5, 3)).toBe(1);
  });
  it('proof of work expected blocks follow hash share; proof-of-stake draws are reproducible', () => {
    expect(powExpectedBlocks([1, 3], 100)).toEqual([25, 75]);
    expect(posSelect([10, 30], 1000)).toEqual(posSelect([10, 30], 1000));
    const c = posSelect([10, 30], 4000);
    expect(c[1]! / 4000).toBeGreaterThan(0.7);
  });
});
