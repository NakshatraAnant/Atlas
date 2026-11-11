import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { crossoverReturns, horizonSurface, monthlyCurves, sharpe, sma, spearman, weekByYear } from '../src/modules/academy/charts3d.js';
import { DEV_PASSWORD } from '../src/seed.js';
import { Client } from './http.js';
import { fixtureContext } from './fixture.js';

// Academy 3D chart analyses (session 13): known answers for every calculation, and the route's rules.

describe('3D chart calculations (known answers)', () => {
  it('holding-period returns: start every step sessions, only where the longest horizon exists', () => {
    const dates = Array.from({ length: 10 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
    const close = Array.from({ length: 10 }, (_, i) => 100 + i);
    const s = horizonSurface(dates, close, [1, 2], 3);
    expect(s.starts).toEqual(['2026-01-01', '2026-01-04', '2026-01-07']);
    expect(s.values[0]![0]).toBeCloseTo(0.01, 12);
    expect(s.values[1]![1]).toBeCloseTo(105 / 103 - 1, 12);
    expect(horizonSurface(dates, [...close.slice(0, 3), 0, ...close.slice(4)], [1], 3).values[1]![0]).toBeNull(); // a non-positive level is a gap
  });
  it('simple moving average', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
  it('crossover rule uses only the previous close (no look-ahead) and charges each switch', () => {
    // Rising then falling prices: fast(1) vs slow(2).
    const close = [10, 11, 12, 11, 10, 11];
    const r = crossoverReturns(close, 1, 2, 0, close.length, 0.01);
    // t=1: averages at t-1=0: slow not ready -> flat (0). t=2: at t-1=1 fast 11 > slow 10.5 -> long, switch cost.
    expect(r[0]).toBe(0);
    expect(r[1]).toBeCloseTo(12 / 11 - 1 - 0.01, 12);
    expect(r[2]).toBeCloseTo(11 / 12 - 1, 12); // still long (decided at the close of 12)
    expect(r[3]).toBeCloseTo(-0.01, 12); // decided at 11 < 11.5: flat, pays the switch, no price exposure
  });
  it('Sharpe needs 60 returns and variance', () => {
    expect(sharpe(new Array(59).fill(0.01))).toBeNull();
    expect(sharpe(new Array(100).fill(0.01))).toBeNull();
    const r = Array.from({ length: 100 }, (_, i) => (i % 2 ? 0.02 : 0));
    expect(sharpe(r)).toBeCloseTo((0.01 / Math.sqrt(100 * 0.0001 / 99 * 1)) * Math.sqrt(252), 6);
  });
  it('Spearman rank correlation', () => {
    expect(spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50])).toBeCloseTo(1, 12);
    expect(spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1])).toBeCloseTo(-1, 12);
    expect(spearman([1, null, 3], [1, 2, 3])).toBeNull();
  });
  it('monthly curves keep the last observation of each month per contract; a missing contract stays null', () => {
    const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
    const m = monthlyCurves([[{ t: t('2024-01-02'), v: 70 }, { t: t('2024-01-31'), v: 72 }, { t: t('2024-02-29'), v: 75 }], [{ t: t('2024-01-31'), v: 73 }]]);
    expect(m.months).toEqual(['2024-01', '2024-02']);
    expect(m.values).toEqual([[72, 73], [75, null]]);
  });
  it('week-of-year grid', () => {
    const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
    const g = weekByYear([{ t: t('2025-01-03'), v: 1 }, { t: t('2025-01-10'), v: 2 }, { t: t('2025-12-31'), v: 9 }, { t: t('2024-06-01'), v: 5 }], [2025]);
    expect(g[0]![0]).toBe(1);
    expect(g[0]![1]).toBe(2);
    expect(g[0]![51]).toBe(9); // day 364 would be week 53: joins week 52
    expect(g[0]!.filter((v) => v !== null).length).toBe(3); // 2024 is outside the years asked for
  });
});

describe('GET /v1/academy/charts/:id', () => {
  let ctx: AppContext;
  let app: FastifyInstance;
  beforeAll(async () => { ctx = await fixtureContext(); app = await buildApp(ctx); });
  afterAll(async () => { await app?.close(); await ctx?.db.close(); });
  it('requires sign-in, rejects unknown charts, and says when data is not stored (never invents it)', async () => {
    expect((await new Client(app).get('/v1/academy/charts/term_structure')).status).toBe(401);
    const c = new Client(app);
    await c.login('free@atlas.test', DEV_PASSWORD);
    expect((await c.get('/v1/academy/charts/nope')).status).toBe(400);
    for (const id of ['horizon_surface', 'param_surface', 'term_structure', 'seasonality']) {
      const r = await c.get(`/v1/academy/charts/${id}`);
      expect([200, 404]).toContain(r.status);
      if (r.status === 200) {
        expect(r.json.values.length).toBe(r.json.z.labels.length);
        for (const row of r.json.values) expect(row.length).toBe(r.json.x.labels.length);
        expect(r.json.source.name).toMatch(/stored by ATLAS/);
      } else expect(r.json.detail).toMatch(/not stored/);
    }
  });
});
