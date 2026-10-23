import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { totpCode } from '../src/lib/crypto.js';
import { importCommoditySeries, refreshCommodities } from '../src/modules/commodity/ingest.js';
import { CommodityError, eiaUrl, parseEiaV2, parseFredCsv, redactUrl, SERIES } from '../src/modules/commodity/sources.js';
import type { FetchFn } from '../src/modules/equity/providers.js';
import { DEV_ADMIN_TOTP_SECRET, DEV_PASSWORD } from '../src/seed.js';
import { Client } from './http.js';
import { fixtureContext } from './fixture.js';

// Commodity data. FRED responses are real CSV downloads recorded on 23 Oct 2026 (test/fixtures/commodity,
// trimmed to their last rows). Longer histories for analytics are generated inside this test (test data,
// throwaway database). The EIA response shape follows EIA's API documentation (no key was available).

const FX = (f: string) => readFileSync(new URL(`./fixtures/commodity/${f}`, import.meta.url), 'utf8');
let clockMs = Date.parse('2026-10-23T12:00:00Z');

/** Business-day series ending 2026-10-20 with a gentle path; `neg` puts one negative print in. */
function daily(id: string, base: number, days = 900, neg?: string) {
  const lines = [`observation_date,${id}`];
  let v = base;
  for (let t = Date.parse('2026-10-20T00:00:00Z') - days * 86_400_000, i = 0; t <= Date.parse('2026-10-20T00:00:00Z'); t += 86_400_000, i++) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    v = v * (1 + 0.01 * Math.sin(i / 7 + base));
    const iso = d.toISOString().slice(0, 10);
    lines.push(`${iso},${iso === neg ? '-5.5' : v.toFixed(3)}`);
  }
  return lines.join('\n');
}

const bodies: Record<string, { status: number; body: string }> = {};
const calls: string[] = [];
const fetchFn: FetchFn = async (url) => {
  calls.push(url);
  const id = new URL(url).searchParams.get('id') ?? 'eia';
  const r = bodies[id] ?? { status: 404, body: '<html>Not found</html>' };
  return { status: r.status, ok: r.status < 400, text: async () => r.body };
};

let ctx: AppContext;
let app: FastifyInstance;
let admin: Client;
let user: Client;
beforeAll(async () => {
  ctx = await fixtureContext({ clock: () => new Date(clockMs), equityFetch: fetchFn });
  app = await buildApp(ctx);
  admin = new Client(app);
  expect((await admin.login('admin@atlas.test', DEV_PASSWORD, totpCode(DEV_ADMIN_TOTP_SECRET, clockMs))).status).toBe(200);
  user = new Client(app);
  await user.login('pro@atlas.test', DEV_PASSWORD);
});
afterAll(async () => {
  await app?.close();
  await ctx?.db.close();
});

describe('source parsing', () => {
  it('FRED CSV (recorded): values parsed, a blank day counted as missing, never zero', () => {
    const p = parseFredCsv(200, FX('fred-DCOILWTICO-tail.csv'), 'DCOILWTICO');
    expect(p.missing).toBe(1); // 2026-09-07, US Labor Day
    expect(p.rows.find((r) => r.date === '2026-09-07')).toBeUndefined();
    expect(p.rows[p.rows.length - 1]).toEqual({ date: '2026-10-20', value: 107.89 });
    expect(parseFredCsv(200, FX('fred-PCOPPUSDM-tail.csv'), 'PCOPPUSDM').rows.every((r) => r.date.endsWith('-01'))).toBe(true);
  });
  it('wrong series, HTML and HTTP errors are classified, never treated as data', () => {
    expect(() => parseFredCsv(200, FX('fred-DCOILWTICO-tail.csv'), 'DCOILBRENTEU')).toThrow(expect.objectContaining({ category: 'malformed' }));
    expect(() => parseFredCsv(404, '<html>', 'X')).toThrow(expect.objectContaining({ category: 'not_found' }));
    expect(() => parseFredCsv(429, '', 'X')).toThrow(expect.objectContaining({ category: 'rate_limited' }));
  });
  it('EIA v2 (documented shape): rows for the requested series only, sorted; a key error is an auth error', () => {
    const body = JSON.stringify({ response: { data: [{ period: '2026-10-20', series: 'RCLC2', value: 71 }, { period: '2026-10-20', series: 'RCLC1', value: 70.5 }, { period: '2026-10-17', series: 'RCLC1', value: null }, { period: '2026-10-16', series: 'RCLC1', value: '70.1' }] } });
    expect(parseEiaV2(200, body, 'RCLC1')).toMatchObject({ rows: [{ date: '2026-10-16', value: 70.1 }, { date: '2026-10-20', value: 70.5 }], missing: 1 });
    expect(() => parseEiaV2(200, '{"error":"invalid api_key"}', 'RCLC1')).toThrow(expect.objectContaining({ category: 'auth' }));
    expect(() => parseEiaV2(200, '{"response":{}}', 'RCLC1')).toThrow(CommodityError);
  });
  it('the EIA key never appears once redacted', () => {
    const def = SERIES.find((s) => s.series_id === 'eia:RCLC1')!;
    expect(redactUrl(eiaUrl(def, 'secret-eia-key'))).not.toContain('secret-eia-key');
  });
  it('the catalogue keeps the three categories apart and names each series’ price type and unit', () => {
    expect(new Set(SERIES.map((s) => s.category))).toEqual(new Set(['global_benchmark', 'physical_fundamental']));
    expect(SERIES.every((s) => s.unit && s.price_type && s.licence_note)).toBe(true);
    expect(SERIES.filter((s) => s.category === 'indian_futures')).toEqual([]); // no permitted source
  });
});

describe('import', () => {
  it('stores values, counts blanks, keeps a negative print, and is idempotent', async () => {
    bodies.DCOILWTICO = { status: 200, body: daily('DCOILWTICO', 70, 900, '2025-04-21') };
    const s1 = await importCommoditySeries(ctx.db, fetchFn, { eia: '' }, 'fred:DCOILWTICO', new Date(clockMs));
    expect(s1).toMatchObject({ status: 'succeeded', corrected: 0 });
    expect(s1.stored).toBeGreaterThan(600);
    const neg = await ctx.db.one<{ v: number }>(`SELECT value::float8 AS v FROM commodity.observations WHERE series_id='fred:DCOILWTICO' AND obs_date='2025-04-21'`);
    expect(neg.v).toBe(-5.5);
    const s2 = await importCommoditySeries(ctx.db, fetchFn, { eia: '' }, 'fred:DCOILWTICO', new Date(clockMs));
    expect(s2).toMatchObject({ stored: 0, corrected: 0, unchanged: s1.stored });
  });
  it('a revised value is a correction with the previous value kept', async () => {
    bodies.DCOILWTICO = { status: 200, body: bodies.DCOILWTICO!.body.replace(/2026-10-20,[\d.]+/, '2026-10-20,107.89') };
    const s = await importCommoditySeries(ctx.db, fetchFn, { eia: '' }, 'fred:DCOILWTICO', new Date(clockMs));
    expect(s.corrected).toBe(1);
    expect((await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM commodity.revisions WHERE series_id='fred:DCOILWTICO'`)).n).toBe(1);
  });
  it('EIA series without a key fail with what to configure, and send nothing', async () => {
    const before = calls.length;
    const s = await importCommoditySeries(ctx.db, fetchFn, { eia: '' }, 'eia:RCLC1', new Date(clockMs));
    // An empty series still states where it would come from.
    const d = (await user.get('/v1/commodities/series/eia/RCLC1')).json;
    expect(d).toMatchObject({ analysis: null, provenance: { source: 'EIA series RCLC1' } });
    expect(d.empty_reason).toMatch(/EIA_API_KEY/);
    expect(s).toMatchObject({ status: 'failed', error_category: 'not_configured' });
    expect(calls.length).toBe(before);
  });
  it('the refresh fetches each series at most once per 20 hours and stops at a rate limit', async () => {
    for (const s of SERIES.filter((x) => x.source_id === 'fred')) bodies[s.source_series] ??= { status: 200, body: s.frequency === 'daily' ? daily(s.source_series, 50 + s.source_series.length) : FX('fred-PCOPPUSDM-tail.csv').replace('PCOPPUSDM', s.source_series) };
    const r1 = await refreshCommodities(ctx.db, fetchFn, { eia: '' }, new Date(clockMs));
    expect(r1.attempted).toBe(SERIES.filter((x) => x.source_id === 'fred').length - 1); // WTI was imported moments ago
    const r2 = await refreshCommodities(ctx.db, fetchFn, { eia: '' }, new Date(clockMs + 3_600_000));
    expect(r2.attempted).toBe(0);
    bodies.DCOILBRENTEU = { status: 429, body: '' };
    const r3 = await refreshCommodities(ctx.db, fetchFn, { eia: '' }, new Date(clockMs + 21 * 3_600_000));
    expect(r3.results[r3.results.length - 1]!.error_category).toBe('rate_limited');
    expect(r3.attempted).toBeLessThan(SERIES.filter((x) => x.source_id === 'fred').length);
  });
});

describe('API', () => {
  it('lists categories separately, with Indian futures and gold stated as unavailable', async () => {
    const r = (await user.get('/v1/commodities')).json;
    expect(r.categories.map((c: { category: string }) => c.category)).toEqual(['global_benchmark', 'indian_futures', 'physical_fundamental']);
    expect(r.categories[1].series).toEqual([]);
    expect(r.categories[1].note).toMatch(/Not available/);
    expect(r.unavailable.map((u: { what: string }) => u.what).join(' ')).toMatch(/Gold/);
    const wti = r.categories[0].series.find((s: { series_id: string }) => s.series_id === 'fred:DCOILWTICO');
    expect(wti).toMatchObject({ unit: 'USD per barrel', price_type: 'spot', frequency: 'daily', freshness: { state: 'fresh' } });
  });
  it('series detail: stats by frequency, seasonality, correlations and provenance; drawdown refused across a negative price', async () => {
    const d = (await user.get('/v1/commodities/series/fred/DCOILWTICO')).json;
    expect(d.analysis.stats.annualisation).toBe('daily → ×√252');
    expect(d.analysis.stats.skipped_non_positive).toBe(0); // the negative print is older than one year
    expect(d.analysis.seasonality.ok).toBe(true);
    expect(d.analysis.correlations.length).toBeGreaterThan(0);
    expect(d.provenance).toMatchObject({ source: 'FRED series DCOILWTICO', revisions: 1 });
    const m = (await user.get('/v1/commodities/series/fred/PCOPPUSDM')).json;
    expect(m.analysis.stats.annualisation).toBe('monthly → ×√12');
    expect((await user.get('/v1/commodities/series/fred/NOPE')).status).toBe(404);
  });
  it('spreads use shared dates and state units; term structure says it needs an EIA key', async () => {
    const s = (await user.get('/v1/commodities/spreads')).json;
    const crack = s.spreads.find((x: { id: string }) => x.id === 'heating_oil_crack');
    expect(crack).toMatchObject({ available: true, unit: 'USD per barrel', fa: 42 });
    expect(crack.percentile_3y).toBeGreaterThanOrEqual(0);
    const ts = (await user.get('/v1/commodities/term-structure')).json;
    expect(ts).toMatchObject({ available: false });
    expect(ts.reason).toMatch(/EIA_API_KEY/);
  });
  it('daily commodity series work in the research hub; monthly ones are refused with a reason', async () => {
    const found = (await user.get('/v1/research/instruments?q=brent')).json.results;
    expect(found[0]).toMatchObject({ key: 'commodity:fred:DCOILBRENTEU', asset_class: 'commodity' });
    const wb = await user.post('/v1/research/workbench', { keys: ['commodity:fred:DCOILWTICO', 'commodity:fred:DHHNGSP'], benchmark: 'commodity:fred:DCOILWTICO', range: '1y' });
    expect(wb.status, JSON.stringify(wb.json).slice(0, 300)).toBe(200);
    expect(wb.json.instruments[0].notes.join(' ')).toMatch(/not a tradable quote/);
    expect((await user.post('/v1/research/workbench', { keys: ['commodity:fred:PCOPPUSDM'], range: '1y' })).status).toBe(400);
  });
  it('a manual refresh needs an administrator with two-step verification', async () => {
    expect((await user.post('/admin/v1/commodities/refresh', {})).status).toBe(403);
    expect((await admin.post('/admin/v1/commodities/refresh', {})).status).toBe(200);
  });
});
