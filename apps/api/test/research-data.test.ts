import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { runRetention } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { parseFundamentalsCsv, ratiosFor } from '../src/modules/research/fundamentalsRoutes.js';
import { NoVendor } from '../src/pipeline/vendor.js';
import { DEV_PASSWORD } from '../src/seed.js';
import { Client } from './http.js';
import { fixtureContext } from './fixture.js';

// User-imported financial statements, the explicit demo-data switch, and erasure of research data.
// Statement figures below are test values typed for this test, not any company's figures.

const HEAD = 'instrument,period_end,period_type,line_item,value,unit,source_note';
const CSV = [HEAD,
  'NSE:TESTCO,2025-03-31,annual,revenue,1000,crore,Test value',
  'NSE:TESTCO,2025-03-31,annual,net_profit,100,crore,Test value',
  'NSE:TESTCO,2025-03-31,annual,total_equity,500,crore,Test value',
  'NSE:TESTCO,2025-03-31,annual,total_debt,250,crore,Test value',
  'NSE:TESTCO,2025-03-31,annual,eps_diluted,20,inr,Test value',
  'NSE:TESTCO,2024-03-31,annual,revenue,800,crore,Test value',
  'NSE:TESTCO,2024-03-31,annual,net_profit,80,crore,Test value'].join('\n');

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

describe('financial statements you import', () => {
  it('every row is validated; units become rupees; nothing is coerced', () => {
    const ok = parseFundamentalsCsv(CSV);
    expect(ok.errors).toEqual([]);
    expect(ok.rows[0]).toMatchObject({ instrument: 'NSE:TESTCO', statement: 'income', line_item: 'revenue', value_inr: 1000e7 });
    const bad = parseFundamentalsCsv([HEAD, 'TESTCO,2025-13-40,yearly,sales,abc,crores,x', 'NSE:TESTCO,2025-03-31,annual,eps_diluted,20,crore,Test value'].join('\n'));
    expect(bad.rows).toEqual([]);
    expect(bad.errors[0]!.reasons).toHaveLength(7);
    expect(bad.errors[1]!.reasons).toEqual(['per-share items use unit inr']);
    expect(parseFundamentalsCsv('a,b\n1,2').errors[0]!.reasons[0]).toMatch(/header must be/);
  });
  it('ratios need every input from the same period; growth only across consecutive years', () => {
    const r = ratiosFor([
      { period_end: '2025-03-31', period_type: 'annual', values: { revenue: 1000, net_profit: 100, total_equity: 500, total_debt: 250 } },
      { period_end: '2024-03-31', period_type: 'annual', values: { revenue: 800, net_profit: 80 } },
      { period_end: '2022-03-31', period_type: 'annual', values: { revenue: 500 } },
    ]);
    expect(r[0]!.ratios).toEqual({ net_margin: 0.1, return_on_equity: 0.2, debt_to_equity: 0.5, revenue_growth: 0.25, net_profit_growth: 0.25 });
    expect(r[1]!.ratios).toEqual({ net_margin: 0.1 }); // 2022 is not the previous year
    expect(r[2]!.ratios).toEqual({});
  });
  it('import is all-or-nothing, private to the user, idempotent, and deletable', async () => {
    const a = new Client(app);
    await a.login('pro@atlas.test', DEV_PASSWORD);
    const bad = await a.post('/v1/research/fundamentals/import', { csv: `${CSV}\nNSE:TESTCO,2025-03-31,annual,unknown_item,1,inr,x` });
    expect(bad.status).toBe(400);
    expect((await a.get('/v1/research/fundamentals')).json.instruments).toEqual([]);
    const ok = (await a.post('/v1/research/fundamentals/import', { csv: CSV })).json;
    expect(ok).toMatchObject({ imported: 7, changed: 7, instruments: ['NSE:TESTCO'] });
    expect((await a.post('/v1/research/fundamentals/import', { csv: CSV })).json).toMatchObject({ changed: 0, unchanged: 7 });
    const d = (await a.get('/v1/research/fundamentals?instrument=NSE:TESTCO')).json;
    expect(d.classification).toBe('USER_IMPORTED');
    expect(d.ratios.find((x: { period_end: string }) => x.period_end === '2025-03-31').ratios.net_margin).toBeCloseTo(0.1, 12);
    expect(d.valuation.pe_ratio).toBeNull(); // no stored provider price for TESTCO
    const b = new Client(app);
    await b.login('plus@atlas.test', DEV_PASSWORD);
    expect((await b.get('/v1/research/fundamentals?instrument=NSE:TESTCO')).status).toBe(404);
    expect((await a.del('/v1/research/fundamentals?instrument=NSE:TESTCO')).json.deleted).toBe(7);
  });
  it('account erasure removes research hub data, crypto notes, uploads and imported statements', async () => {
    const a = new Client(app);
    await a.login('plus@atlas.test', DEV_PASSWORD);
    await a.post('/v1/research/fundamentals/import', { csv: CSV });
    await a.post('/v1/research/notebook', { kind: 'note', title: 'Erase me', body: 'test' });
    const uid = (await a.get('/v1/me')).json.profile.user_id;
    const count = async () => (await ctx.db.one<{ n: number }>(`SELECT (SELECT count(*) FROM research.user_fundamentals WHERE user_id=$1) + (SELECT count(*) FROM research.notebook_entries WHERE user_id=$1) AS n`, [uid])).n;
    expect(Number(await count())).toBeGreaterThan(0);
    await ctx.db.query(`INSERT INTO app.account_deletions (user_id, requested_at, erase_after) VALUES ($1, now() - interval '40 days', now() - interval '1 day') ON CONFLICT (user_id) DO UPDATE SET erase_after = EXCLUDED.erase_after, erased_at = NULL`, [uid]);
    await runRetention(ctx);
    expect(Number(await count())).toBe(0);
  });
});

describe('demo mode is explicit', () => {
  let off: AppContext;
  let offApp: FastifyInstance;
  beforeAll(async () => {
    const cfg = loadConfig({ NODE_ENV: 'test', APP_SECRET: 'test-secret-test-secret-test-secret-test', LOG_LEVEL: 'silent', RATE_LIMIT_MULTIPLIER: '1000', WEB_ORIGIN: 'http://localhost:3000', ALLOW_SYNTHETIC_DATA: 'false' } as NodeJS.ProcessEnv);
    off = await fixtureContext({ cfg, vendor: new NoVendor() });
    offApp = await buildApp(off);
  });
  afterAll(async () => {
    await offApp?.close();
    await off?.db.close();
  });
  it('with demo mode off, synthetic-only sections refuse and real-data sections still work', async () => {
    const c = new Client(offApp);
    await c.login('pro@atlas.test', DEV_PASSWORD);
    expect((await c.get('/v1/me')).json.demo_mode).toBe(false);
    for (const url of ['/v1/market/summary', '/v1/screener/fields', '/v1/backtests', '/v1/assistant/conversations', '/v1/watchlists']) {
      const r = await c.get(url);
      expect(r.status, url).toBe(403);
      expect(r.json.detail).toMatch(/demo mode is off/);
    }
    expect((await c.get('/v1/equity/status')).status).toBe(200);
    expect((await c.get('/v1/crypto/overview')).status).not.toBe(403);
    expect((await c.get('/v1/research/instruments?q=bit')).status).toBe(200);
    expect((await c.get('/v1/equity/status')).json.synthetic_notice).toMatch(/Demo mode is off/);
  });
  it('a synthetic vendor is refused when demo mode is off, and production refuses demo mode', async () => {
    expect(() => loadConfig({ NODE_ENV: 'production', ALLOW_SYNTHETIC_DATA: 'true' } as NodeJS.ProcessEnv)).toThrow(/Synthetic data must never be served/);
    expect(off.vendor.isSynthetic).toBe(false);
  });
  it('with demo mode on (development default), the flag is reported so every demo page can carry the warning', async () => {
    const c = new Client(app);
    await c.login('pro@atlas.test', DEV_PASSWORD);
    expect((await c.get('/v1/me')).json.demo_mode).toBe(true);
  });
});
