import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { PROVIDER_ASSESSMENTS } from '../src/modules/data/providers.js';
import { DEV_PASSWORD } from '../src/seed.js';
import { Client } from './http.js';
import { fixtureContext } from './fixture.js';

let ctx: AppContext;
let app: FastifyInstance;
beforeAll(async () => {
  ctx = await fixtureContext();
  app = await buildApp(ctx);
});
afterAll(async () => {
  await app?.close();
  await ctx?.db.close();
});

describe('data health (/v1/data/health)', () => {
  it('requires sign-in', async () => {
    expect((await new Client(app).get('/v1/data/health')).status).toBe(401);
  });

  it('reports synthetic data honestly, with coverage measured from the database', async () => {
    const c = new Client(app);
    expect((await c.login('free@atlas.test', DEV_PASSWORD)).status).toBe(200);
    const h = (await c.get('/v1/data/health')).json;
    expect(h.data_mode).toBe('synthetic');
    expect(h.real_data.connected).toBe(false);
    expect(h.real_data.summary).toMatch(/No real market data is connected/);
    expect(h.coverage.companies.real).toBe(0);
    expect(h.coverage.companies.synthetic).toBeGreaterThan(0);
    const db = await ctx.db.one<{ days: number; first: string }>(`SELECT count(DISTINCT trade_date)::int AS days, min(trade_date) AS first FROM market.price_eod`);
    expect(h.coverage.prices.days).toBe(db.days);
    expect(h.coverage.prices.first).toBe(db.first);
    expect(h.coverage.prices.missing_trading_days).toBe(h.coverage.prices.expected_trading_days - h.coverage.prices.days);
    expect(h.sources.filter((s: any) => s.dataset !== 'derived_metrics').every((s: any) => s.is_synthetic)).toBe(true);
    expect(h.providers.pending_licences.length).toBeGreaterThan(0);
    expect(h.scheduler.how_it_runs).toMatch(/Nothing runs while the computer is off/);
    // No secrets or connection details in the payload.
    expect(JSON.stringify(h)).not.toMatch(/password|secret|postgres(ql)?:\/\/|DATABASE_URL|APP_SECRET/i);
  });

  it('lists provider assessments; no exchange website is marked as permitting automated retrieval', async () => {
    const c = new Client(app);
    await c.login('free@atlas.test', DEV_PASSWORD);
    const h = (await c.get('/v1/data/health')).json;
    expect(h.providers.assessments.map((p: any) => p.provider_id)).toEqual(PROVIDER_ASSESSMENTS.map((p) => p.provider_id));
    for (const id of ['nse-website', 'nse-indices-website', 'bse-website']) {
      const p = h.providers.assessments.find((x: any) => x.provider_id === id);
      expect(p.automated_retrieval).not.toBe('permitted');
      expect(p.terms_url).toMatch(/^https:\/\//);
      expect(p.atlas_action).toMatch(/^Not fetched/);
    }
  });
});
