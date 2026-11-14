import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { weeklyCorrelation } from '../src/modules/macro/network.js';
import type { Loaded } from '../src/modules/macro/explorer.js';
import { DEV_PASSWORD } from '../src/seed.js';
import { Client } from './http.js';
import { fixtureContext } from './fixture.js';

const WEEK = 7 * 86_400_000;
const series = (vals: number[], percentUnits = false): Loaded => ({ key: 'k', label: 'l', units: '', source: '', frequency: 'weekly', percentUnits, obs: vals.map((v, i) => ({ t: Date.UTC(2025, 0, 6) + i * WEEK, v })) });

describe('intelligence network', () => {
  it('weekly correlation: known answers, minimum sample, percentage points for percent units', () => {
    const up = Array.from({ length: 40 }, (_, i) => 100 * 1.01 ** i * (i % 2 ? 1.02 : 1));
    expect(weeklyCorrelation(series(up), series(up), 0)!.r).toBeCloseTo(1, 9);
    const inv = up.map((v) => 1e6 / v);
    expect(weeklyCorrelation(series(up), series(inv), 0)!.r).toBeLessThan(-0.99);
    expect(weeklyCorrelation(series(up.slice(0, 20)), series(up.slice(0, 20)), 0)).toBeNull(); // 19 changes < 26
    // Percent units use differences: a yield going 4.0, 4.1, 4.0 … has changes ±0.1.
    const y = Array.from({ length: 40 }, (_, i) => 4 + (i % 2) * 0.1);
    expect(weeklyCorrelation(series(y, true), series(y, true), 0)!.n).toBe(39);
  });
  describe('GET /v1/network', () => {
    let ctx: AppContext; let app: FastifyInstance;
    beforeAll(async () => { ctx = await fixtureContext(); app = await buildApp(ctx); });
    afterAll(async () => { await app?.close(); await ctx?.db.close(); });
    it('needs sign-in; returns only stored series, with method and caveats; never invents nodes', async () => {
      expect((await new Client(app).get('/v1/network')).status).toBe(401);
      const c = new Client(app);
      await c.login('free@atlas.test', DEV_PASSWORD);
      expect((await c.get('/v1/network?window=9y')).status).toBe(400);
      const r = await c.get('/v1/network?window=1y');
      expect(r.status).toBe(200);
      const keys = new Set(r.json.nodes.map((n: { key: string }) => n.key));
      for (const e of r.json.edges) { expect(keys.has(e.a) && keys.has(e.b)).toBe(true); expect(Math.abs(e.r)).toBeLessThanOrEqual(1 + 1e-9); expect(e.n).toBeGreaterThanOrEqual(26); }
      expect(r.json.nodes.length + r.json.not_stored.length).toBe(17);
      expect(r.json.method).toMatch(/Pearson/);
      expect(r.json.caveats.join(' ')).toMatch(/not show that one causes/);
    });
  });
});
