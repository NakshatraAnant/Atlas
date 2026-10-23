import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { importEquityPrices } from '../src/modules/equity/ingest.js';
import { adjustRow, checkRow, EquityProviderError, parseAlphaVantage, parseEodhd, type FetchFn } from '../src/modules/equity/providers.js';
import { refreshEquities } from '../src/modules/equity/routes.js';
import { DEV_PASSWORD } from '../src/seed.js';
import { Client } from './http.js';
import { fixtureContext } from './fixture.js';

// Indian equity reference data. Provider response SHAPES come from real responses recorded on
// 23 Oct 2026 with each provider's public demo key (test/fixtures/equity). Rows for an Indian ticker are
// generated inside this test (clearly test data) because no real Indian response can be obtained
// without your own key; nothing generated here is ever stored outside the throwaway test database.

const FX = (f: string) => readFileSync(new URL(`./fixtures/equity/${f}`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-23T12:00:00Z');
const KEYS = { eodhd: 'test-token-not-real', alphavantage: '' };

function sessions(n: number, start = '2026-01-01', base = 2500) {
  const out: { date: string; open: number; high: number; low: number; close: number; adjusted_close: number; volume: number }[] = [];
  let d = new Date(`${start}T00:00:00Z`);
  let p = base;
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
      p = Math.round(p * (1 + 0.01 * Math.sin(out.length / 5)) * 100) / 100;
      out.push({ date: d.toISOString().slice(0, 10), open: p, high: Math.round(p * 1.01 * 100) / 100, low: Math.round(p * 0.99 * 100) / 100, close: p, adjusted_close: Math.round(p * 0.98 * 100) / 100, volume: 1_000_000 + out.length });
    }
    d = new Date(d.getTime() + 86_400_000);
  }
  return out;
}

let body = JSON.stringify(sessions(30));
let status = 200;
const seenUrls: string[] = [];
const fakeFetch: FetchFn = async (url) => {
  seenUrls.push(url);
  return { status, ok: status < 400, text: async () => body };
};

let ctx: AppContext;
let app: FastifyInstance;
beforeAll(async () => {
  ctx = await fixtureContext({ clock: () => NOW, equityFetch: fakeFetch });
  app = await buildApp(ctx);
});
afterAll(async () => {
  await app?.close();
  await ctx?.db.close();
});

describe('provider parsing (recorded real responses)', () => {
  it('EODHD: raw OHLC and the separate adjusted close', () => {
    const rows = parseEodhd(200, FX('eodhd-eod-aapl.json'));
    expect(rows[0]).toMatchObject({ date: '2026-10-01', open: 330, high: 332.48, low: 325.81, close: 330.32, adjusted_close: 330.32 });
    expect(rows.every((r) => checkRow(r, '2026-10-23').ok)).toBe(true);
  });
  it('EODHD refusals are classified, never treated as data', () => {
    expect(() => parseEodhd(403, FX('eodhd-403.txt'))).toThrow(expect.objectContaining({ category: 'entitlement' }));
    expect(() => parseEodhd(401, '')).toThrow(expect.objectContaining({ category: 'auth' }));
    expect(() => parseEodhd(429, '')).toThrow(expect.objectContaining({ category: 'rate_limited' }));
    expect(() => parseEodhd(200, '<html>')).toThrow(expect.objectContaining({ category: 'malformed' }));
  });
  it('Alpha Vantage: daily series parsed and sorted; its HTTP-200 "Information" refusal is an entitlement error', () => {
    const rows = parseAlphaVantage(200, FX('av-daily-ibm.json'));
    expect(rows.length).toBeGreaterThan(50);
    expect(rows[0]!.date < rows[rows.length - 1]!.date).toBe(true);
    expect(() => parseAlphaVantage(200, FX('av-information.json'))).toThrow(expect.objectContaining({ category: 'entitlement' }));
    expect(() => parseAlphaVantage(200, '{"Note":"Thank you for using Alpha Vantage! Our standard API rate limit is 25 requests per day."}')).toThrow(EquityProviderError);
  });
  it('adjustment keeps OHLC integrity and is applied once', () => {
    const a = adjustRow({ date: '2026-01-02', open: 100, high: 110, low: 90, close: 100, volume: 5, adjusted_close: 50 })!;
    expect(a).toEqual({ date: '2026-01-02', open: 50, high: 55, low: 45, close: 50, volume: 5 });
    expect(checkRow(a, '2026-10-23').ok).toBe(true);
  });
  it('validation rejects impossible rows and future dates', () => {
    expect(checkRow({ date: '2026-01-02', open: 10, high: 9, low: 11, close: 10, volume: 1 }, '2026-10-23').reasons).toContain('high_below_low');
    expect(checkRow({ date: '2027-01-02', open: 10, high: 11, low: 9, close: 10, volume: 1 }, '2026-10-23').reasons).toContain('date_in_future');
    expect(checkRow({ date: '2026-01-02', open: 10, high: 11, low: 9, close: 10, volume: -1 }, '2026-10-23').reasons).toContain('volume_negative');
  });
});

describe('import (idempotent, corrections, quarantine, dry run)', () => {
  const req = { provider: 'eodhd' as const, exchange: 'NSE' as const, symbol: 'TCS', kind: 'equity' as const, name: 'Test instrument (generated rows)' };
  it('without a key: a failed job that says what to configure, and no data', async () => {
    const s = await importEquityPrices(ctx.db, fakeFetch, { eodhd: '', alphavantage: '' }, req, NOW);
    expect(s.status).toBe('failed');
    expect(s.error_category).toBe('not_configured');
    expect(s.error).toMatch(/EODHD_API_TOKEN/);
    expect((await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM equity.prices`)).n).toBe(0);
  });
  it('a dry run reports what would happen and writes no prices', async () => {
    const s = await importEquityPrices(ctx.db, fakeFetch, KEYS, { ...req, dryRun: true }, NOW);
    expect(s).toMatchObject({ status: 'succeeded', dry_run: true, received: 30, stored: 30 });
    expect((await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM equity.prices`)).n).toBe(0);
  });
  it('stores raw and adjusted series; re-running stores nothing new', async () => {
    const s1 = await importEquityPrices(ctx.db, fakeFetch, KEYS, req, NOW);
    expect(s1).toMatchObject({ status: 'succeeded', received: 30, stored: 30, unchanged: 0 });
    const series = await ctx.db.query<{ basis: string; observations: number; classification: string }>(`SELECT basis, observations, classification FROM equity.price_series ORDER BY basis`);
    expect(series).toEqual([{ basis: 'adjusted_split_dividend', observations: 30, classification: 'REAL_UNVERIFIED' }, { basis: 'raw', observations: 30, classification: 'REAL_UNVERIFIED' }]);
    const s2 = await importEquityPrices(ctx.db, fakeFetch, KEYS, req, NOW);
    expect(s2).toMatchObject({ stored: 0, unchanged: 30, corrected: 0 });
    expect((await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM equity.prices`)).n).toBe(60);
  });
  it('a changed value is a correction with the previous value kept; an invalid row is quarantined and the job is partial', async () => {
    const rows = sessions(30);
    rows[5]!.close = rows[5]!.close + 1;
    rows[5]!.high = Math.max(rows[5]!.high, rows[5]!.close);
    rows[6]!.high = 1; // impossible
    body = JSON.stringify(rows);
    const s = await importEquityPrices(ctx.db, fakeFetch, KEYS, req, NOW);
    expect(s.status).toBe('partial');
    expect(s.corrected).toBe(1);
    expect(s.rejected).toBe(1);
    const rev = await ctx.db.query<{ trade_date: string }>(`SELECT r.trade_date FROM equity.price_revisions r JOIN equity.price_series s USING (series_id) WHERE s.basis='raw'`);
    expect(rev.map((r) => r.trade_date)).toEqual([rows[5]!.date]);
    expect((await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM equity.quarantine`)).n).toBe(1);
    body = JSON.stringify(sessions(30));
  });
  it('an entitlement refusal fails the job and marks the provider, and the token never appears in records', async () => {
    status = 403;
    body = 'Forbidden';
    const s = await importEquityPrices(ctx.db, fakeFetch, KEYS, { ...req, symbol: 'INFY' }, NOW);
    status = 200;
    body = JSON.stringify(sessions(30));
    expect(s).toMatchObject({ status: 'failed', error_category: 'entitlement', stored: 0 });
    expect((await ctx.db.one<{ health: string }>(`SELECT health FROM equity.providers WHERE provider_id='eodhd'`)).health).toBe('not_entitled');
    const dump = JSON.stringify(await ctx.db.query(`SELECT * FROM equity.import_jobs`)) + JSON.stringify(await ctx.db.query(`SELECT * FROM equity.providers`));
    expect(dump).not.toContain(KEYS.eodhd);
    expect(seenUrls.some((u) => u.includes('TCS.NSE'))).toBe(true);
  });
  it('the daily refresh does nothing without a key and resumes from the last stored date with one', async () => {
    expect((await refreshEquities(ctx.db, fakeFetch, { eodhd: '', alphavantage: '' }, new Date('2026-10-25T00:00:00Z'))).attempted).toBe(0);
    seenUrls.length = 0;
    const r = await refreshEquities(ctx.db, fakeFetch, KEYS, new Date('2026-10-25T00:00:00Z'));
    expect(r.attempted).toBe(1);
    expect(seenUrls[0]).toMatch(/TCS\.NSE.*from=2026-02-11/);
  });
});

describe('API', () => {
  it('status shows providers, configuration and classification; synthetic data is not listed', async () => {
    const c = new Client(app);
    expect((await c.get('/v1/equity/status')).status).toBe(401);
    await c.login('pro@atlas.test', DEV_PASSWORD);
    const s = (await c.get('/v1/equity/status')).json;
    expect(s.providers.map((p: { provider_id: string }) => p.provider_id)).toEqual(['eodhd', 'alphavantage']);
    expect(s.providers[0].configured).toBe(false); // test config has no keys
    expect(s.instruments.every((i: { classification: string }) => i.classification.startsWith('REAL_'))).toBe(true);
    expect(s.classification.SYNTHETIC_DEMO).toMatch(/Never mixed/);
  });
  it('imports are limited to administrators with two-step verification', async () => {
    const c = new Client(app);
    await c.login('pro@atlas.test', DEV_PASSWORD);
    expect((await c.post('/admin/v1/equity/import', { provider: 'eodhd', exchange: 'NSE', symbol: 'TCS' })).status).toBe(403);
  });
});
