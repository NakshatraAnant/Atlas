import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { DEV_PASSWORD } from '../src/seed.js';
import { Client } from './http.js';
import { fixtureContext } from './fixture.js';

let ctx: AppContext;
let app: FastifyInstance;
let c: Client;
beforeAll(async () => {
  ctx = await fixtureContext();
  app = await buildApp(ctx);
  c = new Client(app);
  expect((await c.login('pro@atlas.test', DEV_PASSWORD)).status).toBe(200);
});
afterAll(async () => {
  await app?.close();
  await ctx?.db.close();
});

describe('market terminal (/v1/market/terminal)', () => {
  it('requires sign-in and says it is end-of-day, not live', async () => {
    expect((await new Client(app).get('/v1/market/terminal')).status).toBe(401);
    const t = (await c.get('/v1/market/terminal')).json;
    expect(t.data_kind).toBe('end_of_day');
    expect(t.notice).toMatch(/Nothing on this screen is live/);
    expect(t.synthetic).toBe(true);
  });

  it('index values equal the stored index levels', async () => {
    const t = (await c.get('/v1/market/terminal?sessions=20')).json;
    expect(t.indices.length).toBeGreaterThan(0);
    for (const i of t.indices) {
      const rows = await ctx.db.query<{ trade_date: string; close: number }>(`SELECT trade_date, close::float8 AS close FROM market.index_levels WHERE index_code=$1 AND trade_date <= $2 ORDER BY trade_date DESC LIMIT 2`, [i.code, t.as_of]);
      expect(i.close).toBe(rows[0]!.close);
      expect(i.date).toBe(rows[0]!.trade_date);
      expect(i.prev_close).toBe(rows[1]!.close);
      expect(i.change_pct).toBeCloseTo(rows[0]!.close / rows[1]!.close - 1, 12);
      expect(i.series.length).toBeLessThanOrEqual(20);
      expect(i.series.map((s: any) => s.date)).toEqual([...i.series.map((s: any) => s.date)].sort());
    }
  });

  it('movers are sorted, come from the latest session, and match stored prices', async () => {
    const t = (await c.get('/v1/market/terminal')).json;
    const g = t.movers.gainers.map((m: any) => m.change_pct);
    expect(g).toEqual([...g].sort((a, b) => b - a));
    const l = t.movers.losers.map((m: any) => m.change_pct);
    expect(l).toEqual([...l].sort((a, b) => a - b));
    const top = t.movers.gainers[0];
    const row = await ctx.db.one<{ close: number; prev_close: number }>(
      `SELECT p.close::float8 AS close, p.prev_close::float8 AS prev_close FROM market.price_eod p JOIN ref.securities s USING (security_id) WHERE s.company_id=$1 AND p.trade_date=$2 AND p.exchange_code='NSE'`, [top.company_id, t.as_of]);
    expect(top.close).toBe(row.close);
    expect(top.change_pct).toBeCloseTo(row.close / row.prev_close - 1, 12);
  });

  it('the feed is newest first and never shows items from the future', async () => {
    const t = (await c.get('/v1/market/terminal')).json;
    const times = t.feed.items.map((f: any) => Date.parse(f.published_at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(times.every((x: number) => x <= Date.parse(t.generated_at))).toBe(true);
    expect(t.feed.kind).toBe('company announcements');
  });

  it('the version is stable while no new data is stored', async () => {
    const a = (await c.get('/v1/market/terminal')).json.version;
    const b = (await c.get('/v1/market/terminal')).json.version;
    expect(a).toBe(b);
    expect(a.startsWith((await ctx.db.one<{ d: string }>(`SELECT max(trade_date) AS d FROM market.price_eod`)).d)).toBe(true);
  });

  it('rejects unsupported chart windows', async () => {
    expect((await c.get('/v1/market/terminal?sessions=7')).status).toBe(400);
  });
});
