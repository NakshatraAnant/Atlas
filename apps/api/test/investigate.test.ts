import { checkContent } from '@atlas/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { evaluatePrompts, INVESTIGATE_RULES, type SessionObservation } from '../src/modules/market/investigate.js';
import { DEV_PASSWORD } from '../src/seed.js';
import { Client } from './http.js';
import { FIXTURE_CLOCK, fixtureContext } from './fixture.js';

const NOW = new Date('2026-10-14T16:30:00Z');
const base: SessionObservation = {
  company_id: 'c1', short_name: 'Example Ltd', security_id: 7, date: '2026-10-14', prev_date: '2026-10-13', adj_close: 100, ret_1d: 0.01,
  adj_volume: 1000, prev_vol_avg_20: 1000, prev_high_52w: 120, prev_low_52w: 80, results_filed_at: '2026-08-01T12:00:00Z',
};
const rules = (o: Partial<SessionObservation>) => evaluatePrompts({ ...base, ...o }, NOW).map((p) => p.rule);

describe('worth-investigating rules (HOM-03)', () => {
  it('fires nothing on an ordinary session', () => expect(rules({})).toEqual([]));
  it('volume spike at exactly 3× the previous 20-session average, not below', () => {
    expect(rules({ adj_volume: 3000 })).toEqual(['volume_spike']);
    expect(rules({ adj_volume: 2999 })).toEqual([]);
  });
  it('large move at ±5% (inclusive), using the adjusted return', () => {
    expect(rules({ ret_1d: 0.05 })).toEqual(['large_move']);
    expect(rules({ ret_1d: -0.051 })).toEqual(['large_move']);
    expect(rules({ ret_1d: 0.049 })).toEqual([]);
  });
  it('new 52-week high/low compare with the PREVIOUS session window (no self-reference)', () => {
    expect(rules({ adj_close: 121 })).toEqual(['new_high']);
    expect(rules({ adj_close: 120 })).toEqual([]);
    expect(rules({ adj_close: 79 })).toEqual(['new_low']);
  });
  it('results filed within 7 days', () => {
    expect(rules({ results_filed_at: '2026-10-09T12:00:00Z' })).toEqual(['results_filed']);
    expect(rules({ results_filed_at: '2026-10-01T12:00:00Z' })).toEqual([]);
  });
  it('missing inputs never fire a rule', () => {
    expect(rules({ adj_volume: null, ret_1d: null, prev_high_52w: null, prev_low_52w: null, results_filed_at: null, prev_vol_avg_20: 0 })).toEqual([]);
  });
  it('every prompt states its rule, carries evidence for numeric rules, and passes the advice-language policy', () => {
    const all = evaluatePrompts({ ...base, adj_volume: 5000, ret_1d: 0.08, adj_close: 130, results_filed_at: '2026-10-12T00:00:00Z' }, NOW);
    expect(all.map((p) => p.rule).sort()).toEqual(['large_move', 'new_high', 'results_filed', 'volume_spike']);
    for (const p of all) {
      expect(p.rule_text).toBe(INVESTIGATE_RULES[p.rule].text);
      if (p.rule !== 'results_filed') expect(p.evidence.length).toBeGreaterThan(0);
      expect(checkContent(`${p.rule_text}. ${p.observed}`)).toEqual([]);
    }
  });
});

describe('worth-investigating API', () => {
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
  it('requires sign-in and returns rules with prompts only for the user\'s own watchlist', async () => {
    expect((await new Client(app).get('/v1/home/worth-investigating')).status).toBe(401);
    const c = new Client(app);
    await c.login('pro@atlas.test', DEV_PASSWORD);
    const r = await c.get('/v1/home/worth-investigating');
    expect(r.status).toBe(200);
    expect(r.json.date).toBe('2026-10-14');
    expect(Object.keys(r.json.rules)).toContain('volume_spike');
    expect(r.json.note).toMatch(/not signals or recommendations/);
    const mine = new Set((await ctx.db.query<{ company_id: string }>(`SELECT i.company_id FROM app.watchlist_items i JOIN app.watchlists w USING (watchlist_id) JOIN app.users u USING (user_id) WHERE u.email='pro@atlas.test' AND w.deleted_at IS NULL`)).map((x) => x.company_id));
    for (const p of r.json.prompts) expect(mine.has(p.company_id)).toBe(true);
    expect(FIXTURE_CLOCK.toISOString()).toBe('2026-10-14T16:30:00.000Z');
  });
});
