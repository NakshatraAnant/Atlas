import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { compileRules, describeRules, ruleSetSchema, warmup, type RuleSet } from '../src/modules/backtest/rules.js';
import { DEV_PASSWORD } from '../src/seed.js';
import { Client } from './http.js';
import { fixtureContext } from './fixture.js';

const smaCross: RuleSet = {
  entry: { combine: 'and', conditions: [{ left: { kind: 'sma', period: 20 }, op: '>', right: { kind: 'sma', period: 100 } }] },
  exit: { combine: 'and', conditions: [{ left: { kind: 'sma', period: 20 }, op: '<', right: { kind: 'sma', period: 100 } }] },
};

describe('rule builder: compilation and semantics (BKT-02)', () => {
  const px = [10, 11, 12, 11, 10, 9, 10, 12, 13, 12];
  it('evaluates comparisons against numbers and indicators; unknown history is null', () => {
    const r = compileRules({ entry: { combine: 'and', conditions: [{ left: { kind: 'close' }, op: '>=', right: { kind: 'value', value: 12 } }] }, exit: { combine: 'and', conditions: [{ left: { kind: 'sma', period: 3 }, op: '<', right: { kind: 'close' } }] } }, px);
    expect(px.map((_, k) => r.entry(k))).toEqual([false, false, true, false, false, false, false, true, true, true]);
    expect(r.exit(0)).toBeNull();
    expect(r.exit(1)).toBeNull();
    expect(r.exit(2)).toBe(true); // SMA(3) of 10,11,12 = 11 < 12
  });
  it('crosses compare the previous and current session', () => {
    const r = compileRules({ entry: { combine: 'and', conditions: [{ left: { kind: 'close' }, op: 'crosses_above', right: { kind: 'value', value: 11.5 } }] }, exit: { combine: 'and', conditions: [{ left: { kind: 'close' }, op: 'crosses_below', right: { kind: 'value', value: 11.5 } }] } }, px);
    expect(px.map((_, k) => r.entry(k))).toEqual([null, false, true, false, false, false, false, true, false, false]);
    expect(px.map((_, k) => r.exit(k))).toEqual([null, false, false, true, false, false, false, false, false, false]);
  });
  it('AND needs every condition known; OR fires on any known true', () => {
    const r = compileRules({
      entry: { combine: 'and', conditions: [{ left: { kind: 'close' }, op: '>', right: { kind: 'value', value: 0 } }, { left: { kind: 'sma', period: 5 }, op: '>', right: { kind: 'value', value: 0 } }] },
      exit: { combine: 'or', conditions: [{ left: { kind: 'close' }, op: '>', right: { kind: 'value', value: 0 } }, { left: { kind: 'sma', period: 5 }, op: '>', right: { kind: 'value', value: 0 } }] },
    }, px);
    expect(r.entry(2)).toBeNull();
    expect(r.entry(4)).toBe(true);
    expect(r.exit(2)).toBe(true);
  });
  it('has no look-ahead: changing future prices never changes a past signal', () => {
    const rules: RuleSet = { entry: { combine: 'or', conditions: [{ left: { kind: 'close' }, op: '>', right: { kind: 'prev_high', period: 5 } }, { left: { kind: 'return_pct', period: 3 }, op: '<', right: { kind: 'value', value: -5 } }] }, exit: { combine: 'and', conditions: [{ left: { kind: 'rsi', period: 3 }, op: '>', right: { kind: 'value', value: 70 } }] } };
    const a = compileRules(rules, px);
    const future = [...px.slice(0, 7), 50, 1, 99];
    const b = compileRules(rules, future);
    for (let k = 0; k < 7; k++) {
      expect(b.entry(k)).toBe(a.entry(k));
      expect(b.exit(k)).toBe(a.exit(k));
    }
  });
  it('validates limits and describes rules in plain language', () => {
    expect(ruleSetSchema.safeParse({ ...smaCross, entry: { combine: 'and', conditions: [] } }).success).toBe(false);
    expect(ruleSetSchema.safeParse({ ...smaCross, entry: { combine: 'and', conditions: Array(6).fill(smaCross.entry.conditions[0]) } }).success).toBe(false);
    expect(ruleSetSchema.safeParse({ ...smaCross, entry: { combine: 'and', conditions: [{ left: { kind: 'sma', period: 1 }, op: '>', right: { kind: 'close' } }] } }).success).toBe(false);
    expect(describeRules(smaCross)).toBe("Enter long when SMA(20) is above SMA(100). Exit when SMA(20) is below SMA(100). Signals at the close; orders fill at the next session's open.");
    expect(warmup(smaCross)).toBe(101);
  });
});

describe('rule builder: API and cross-check against a built-in template', () => {
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
  const signedIn = async (email: string) => {
    const c = new Client(app);
    await c.login(email, DEV_PASSWORD);
    return c;
  };
  const company = async () => (await ctx.db.one<{ company_id: string }>(`SELECT company_id FROM ref.companies WHERE short_name='Kaveri Foods'`)).company_id;

  it('is a Pro feature and requires rules', async () => {
    const plus = await signedIn('plus@atlas.test');
    const body = { template: 'custom_rules', rules: smaCross, universe: { type: 'security', company_id: await company() }, period: { from: '2021-01-01', to: '2026-10-14' } };
    expect((await plus.post('/v1/backtests', body)).status).toBe(402);
    const pro = await signedIn('pro@atlas.test');
    expect((await pro.post('/v1/backtests', { ...body, rules: undefined })).status).toBe(400);
    expect((await pro.post('/v1/backtests', { ...body, template: 'ma_crossover', params: { fast: 20, slow: 100 } , rules: smaCross })).status).toBe(400);
  });

  it('SMA(20) vs SMA(100) rules reproduce the built-in crossover exactly (independent cross-check)', async () => {
    const pro = await signedIn('pro@atlas.test');
    const common = { universe: { type: 'security', company_id: await company() }, period: { from: '2021-01-01', to: '2026-10-14' } };
    const built = await pro.post('/v1/backtests', { ...common, template: 'ma_crossover', params: { fast: 20, slow: 100 } });
    const custom = await pro.post('/v1/backtests', { ...common, template: 'custom_rules', rules: smaCross });
    expect(custom.status).toBe(201);
    const a = (await pro.get(`/v1/backtests/${built.json.run_id}`)).json;
    const b = (await pro.get(`/v1/backtests/${custom.json.run_id}`)).json;
    expect(b.run.status).toBe('succeeded');
    expect(b.rules_text).toContain('SMA(20) is above SMA(100)');
    expect(b.run.metrics.total_return).toBeCloseTo(a.run.metrics.total_return, 10);
    const ta = (await pro.get(`/v1/backtests/${built.json.run_id}/trades`)).json.trades.map((t: any) => [t.side, t.trade_date, t.price, t.quantity]);
    const tb = (await pro.get(`/v1/backtests/${custom.json.run_id}/trades`)).json.trades.map((t: any) => [t.side, t.trade_date, t.price, t.quantity]);
    expect(tb).toEqual(ta);
    expect(ta.length).toBeGreaterThan(0);
    const rr = await pro.post(`/v1/backtests/${custom.json.run_id}/rerun`);
    expect(rr.json.identical).toBe(true);
  });
});
