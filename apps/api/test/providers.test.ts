import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { totpCode } from '../src/lib/crypto.js';
import { freshnessOf } from '../src/lib/freshness.js';
import { admit, record, retryAfterSeconds, syncProviderState } from '../src/lib/providerGate.js';
import { importCommoditySeries } from '../src/modules/commodity/ingest.js';
import { parseMandi } from '../src/modules/commodity/mandi.js';
import { eiaTotal, parseEiaV2 } from '../src/modules/commodity/sources.js';
import type { FetchFn } from '../src/modules/equity/providers.js';
import { FredError, fredObservations, parseFredObservations } from '../src/modules/macro/fred.js';
import { importMacroSeries } from '../src/modules/macro/macro.js';
import { NoVendor } from '../src/pipeline/vendor.js';
import { DEV_ADMIN_TOTP_SECRET, DEV_PASSWORD } from '../src/seed.js';
import { Client } from './http.js';
import { fixtureContext } from './fixture.js';

// Shared provider gate (durable pause, automatic resume, single-probe recovery), FRED API, EIA paging,
// data.gov.in parsing, freshness, and real-data mode. FRED and EIA bodies are real responses recorded on
// 23 Oct 2026 (test/fixtures/macro, test/fixtures/commodity); the data.gov.in body follows the documented
// field names (no real response could be obtained without your key). No test touches the network.

const FX = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
let clockMs = Date.parse('2026-10-23T12:00:00Z');
const now = () => new Date(clockMs);
const KEY = 'test-fred-key-not-real';

type Reply = { status: number; body: string; headers?: Record<string, string> };
let handler: (url: string) => Reply = () => ({ status: 404, body: '{}' });
const urls: string[] = [];
const fetchFn: FetchFn = async (url) => {
  urls.push(url);
  const r = handler(url);
  const h = new Map(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return { status: r.status, ok: r.status < 400, text: async () => r.body, headers: { get: (n: string) => h.get(n.toLowerCase()) ?? null } } as unknown as Awaited<ReturnType<FetchFn>>;
};

let ctx: AppContext;
let app: FastifyInstance;
beforeAll(async () => {
  ctx = await fixtureContext({ clock: now, equityFetch: fetchFn });
  app = await buildApp(ctx);
});
afterAll(async () => {
  await app?.close();
  await ctx?.db.close();
});
const resetGate = async () => {
  await ctx.db.query(`DELETE FROM ops.provider_requests`);
  await ctx.db.query(`UPDATE ops.provider_state SET status='unknown', next_eligible_at=NULL, paused_reason=NULL, consecutive_failures=0, last_failure_category=NULL, configured=true, skipped_while_paused=0`);
};

describe('provider gate', () => {
  beforeEach(resetGate);
  it('429 with Retry-After pauses exactly that long, durably; requests are not sent meanwhile', async () => {
    await record(ctx.db, 'fred', now(), { endpoint: 'series', ok: false, http_status: 429, category: 'rate_limited', retry_after_s: 120 });
    expect(await admit(ctx.db, 'fred', new Date(clockMs + 60_000))).toMatchObject({ allowed: false });
    // A restart (provider sync) keeps the pause: it lives in the database.
    await syncProviderState(ctx.db, { fred: true, eia: true, coingecko: true, eodhd: true, data_gov_in: false });
    expect((await admit(ctx.db, 'fred', new Date(clockMs + 90_000))).allowed).toBe(false);
    const s = await ctx.db.one<{ status: string; skipped_while_paused: number }>(`SELECT status, skipped_while_paused FROM ops.provider_state WHERE provider_id='fred'`);
    expect(s).toEqual({ status: 'rate_limited', skipped_while_paused: 2 });
  });
  it('after a pause one health-check request is admitted; the rest wait; success restores normal service', async () => {
    await record(ctx.db, 'eia', now(), { endpoint: 'x', ok: false, http_status: 429, category: 'rate_limited', retry_after_s: 10 });
    const later = new Date(clockMs + 11_000);
    const [a, b, c] = await Promise.all([admit(ctx.db, 'eia', later), admit(ctx.db, 'eia', later), admit(ctx.db, 'eia', later)]);
    expect([a, b, c].filter((x) => x.allowed)).toHaveLength(1);
    expect([a, b, c].find((x) => x.allowed)!.recovering).toBe(true);
    await record(ctx.db, 'eia', later, { endpoint: 'x', ok: true, http_status: 200 });
    expect(await admit(ctx.db, 'eia', later)).toMatchObject({ allowed: true });
    expect((await ctx.db.one<{ status: string }>(`SELECT status FROM ops.provider_state WHERE provider_id='eia'`)).status).toBe('operational');
  });
  it('quota exhaustion waits for a known reset, or rechecks hourly when the reset is not published', async () => {
    const reset = new Date('2026-10-24T00:00:00Z');
    await record(ctx.db, 'eodhd', now(), { endpoint: 'eod', ok: false, http_status: 402, category: 'quota_exhausted', reset_at: reset });
    expect((await admit(ctx.db, 'eodhd', new Date('2026-10-23T23:59:00Z'))).allowed).toBe(false);
    expect((await admit(ctx.db, 'eodhd', new Date('2026-10-24T00:00:01Z'))).allowed).toBe(true);
    await record(ctx.db, 'coingecko', now(), { endpoint: 'x', ok: false, http_status: 429, category: 'quota_exhausted' });
    const s = await ctx.db.one<{ next_eligible_at: string; reset_at: string | null; paused_reason: string }>(`SELECT next_eligible_at, reset_at, paused_reason FROM ops.provider_state WHERE provider_id='coingecko'`);
    expect(Date.parse(s.next_eligible_at) - clockMs).toBe(3_600_000);
    expect(s.reset_at).toBeNull();
    expect(s.paused_reason).toMatch(/not published/);
  });
  it('credential errors are rechecked once a day (or after a restart), never in a loop; a 404 never pauses the provider', async () => {
    await record(ctx.db, 'fred', now(), { endpoint: 'series', ok: false, http_status: 403, category: 'auth' });
    expect((await admit(ctx.db, 'fred', new Date(clockMs + 23 * 3_600_000))).allowed).toBe(false);
    await syncProviderState(ctx.db, { fred: true, eia: true, coingecko: true, eodhd: true, data_gov_in: false });
    expect((await admit(ctx.db, 'fred', now())).allowed).toBe(true);
    await resetGate();
    await record(ctx.db, 'fred', now(), { endpoint: 'series', ok: false, http_status: 400, category: 'not_found' });
    expect((await admit(ctx.db, 'fred', now())).allowed).toBe(true);
  });
  it('an unconfigured provider is never called; Retry-After dates and seconds both parse', async () => {
    await ctx.db.query(`UPDATE ops.provider_state SET configured=false WHERE provider_id='data_gov_in'`);
    expect(await admit(ctx.db, 'data_gov_in', now())).toMatchObject({ allowed: false, reason: 'not configured' });
    expect(retryAfterSeconds('30', now())).toBe(30);
    expect(retryAfterSeconds(new Date(clockMs + 90_000).toUTCString(), now())).toBe(90);
  });
});

describe('FRED API (recorded responses)', () => {
  beforeEach(resetGate);
  it('observations: "." is a missing day, never a number; vintages kept', () => {
    const obs = parseFredObservations(JSON.parse(FX('macro/fred-obs-DGS10-tail.json')));
    expect(obs.filter((o) => o.value === null).map((o) => o.date)).toEqual(['2026-09-07', '2026-10-12']); // Labor Day, Columbus Day
    expect(obs.every((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.realtime_start))).toBe(true);
  });
  it('an unknown series is "not found" (not a provider outage); 429 pauses FRED; the key is never logged', async () => {
    handler = () => ({ status: 400, body: FX('macro/fred-error-nosuch.json') });
    await expect(fredObservations(ctx.db, fetchFn, KEY, 'NOSUCH', now())).rejects.toMatchObject({ category: 'not_found' });
    expect((await admit(ctx.db, 'fred', now())).allowed).toBe(true);
    handler = () => ({ status: 429, body: '{"error_code":429,"error_message":"Too Many Requests"}', headers: { 'Retry-After': '60' } });
    await expect(fredObservations(ctx.db, fetchFn, KEY, 'DGS10', now())).rejects.toBeInstanceOf(FredError);
    expect((await admit(ctx.db, 'fred', new Date(clockMs + 30_000))).allowed).toBe(false);
    const log = JSON.stringify(await ctx.db.query(`SELECT * FROM ops.provider_requests`)) + JSON.stringify(await ctx.db.query(`SELECT * FROM ops.provider_state`));
    expect(log).not.toContain(KEY);
  });
  it('macro import stores values with vintages, skips unchanged series, and records revisions', async () => {
    const meta = JSON.parse(FX('macro/fred-series-DGS10.json'));
    let obsBody = FX('macro/fred-obs-DGS10-tail.json');
    handler = (u) => (u.includes('series/observations') ? { status: 200, body: obsBody } : { status: 200, body: JSON.stringify(meta) });
    const r1 = await importMacroSeries(ctx.db, fetchFn, KEY, 'DGS10', now());
    expect(r1).toMatchObject({ status: 'succeeded', missing: 2, revised: 0 });
    expect(r1.stored).toBeGreaterThan(30);
    const stored = await ctx.db.one<{ p: string; r: string }>(`SELECT to_char(published_at,'YYYY-MM-DD') AS p, retrieved_at::text AS r FROM macro.observations WHERE series_id='DGS10' ORDER BY obs_date DESC LIMIT 1`);
    expect(stored.p).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const before = urls.length;
    expect((await importMacroSeries(ctx.db, fetchFn, KEY, 'DGS10', now())).status).toBe('unchanged');
    expect(urls.slice(before).some((u) => u.includes('series/observations'))).toBe(false); // metadata only
    // FRED revises a value and reports a newer last_updated: the change is stored, the old value kept.
    const j = JSON.parse(obsBody);
    const last = j.observations.filter((o: { value: string }) => o.value !== '.').pop();
    last.value = String(Number(last.value) + 0.05);
    obsBody = JSON.stringify(j);
    meta.seriess[0].last_updated = '2099-01-01 00:00:00-05';
    const r3 = await importMacroSeries(ctx.db, fetchFn, KEY, 'DGS10', now());
    expect(r3).toMatchObject({ status: 'succeeded', revised: 1, stored: 0 });
    expect((await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM macro.revisions WHERE series_id='DGS10'`)).n).toBe(1);
    // The list reads every series' latest two observations in one query (session 13); same answers as per series.
    const c = new Client(app);
    await c.login('pro@atlas.test', DEV_PASSWORD);
    const list = (await c.get('/v1/macro')).json;
    const item = list.items.find((i: { series_id: string }) => i.series_id === 'DGS10');
    const two = await ctx.db.query<{ d: string; v: number; p: string | null }>(`SELECT to_char(obs_date,'YYYY-MM-DD') AS d, value::float8 AS v, to_char(published_at,'YYYY-MM-DD') AS p FROM macro.observations WHERE series_id='DGS10' ORDER BY obs_date DESC LIMIT 2`);
    expect([item.latest, item.previous]).toEqual([two[0], two[1]]);
    for (const i of list.items.filter((x: { observations: number }) => !x.observations)) expect(i.latest).toBeNull();
  });
  it('commodity series use the FRED API with a key and keep each observation’s vintage', async () => {
    const body = JSON.stringify({ observations: [{ realtime_start: '2026-10-21', date: '2026-10-19', value: '88.1' }, { realtime_start: '2026-10-22', date: '2026-10-20', value: '.' }, { realtime_start: '2026-10-22', date: '2026-10-21', value: '89.4' }] });
    handler = () => ({ status: 200, body });
    const r = await importCommoditySeries(ctx.db, fetchFn, { eia: '', fred: KEY }, 'fred:DCOILBRENTEU', now());
    expect(r).toMatchObject({ status: 'succeeded', stored: 2, missing_values: 1 });
    expect(urls[urls.length - 1]).toContain('api.stlouisfed.org/fred/series/observations');
    const rows = await ctx.db.query<{ d: string; p: string }>(`SELECT to_char(obs_date,'YYYY-MM-DD') AS d, to_char(published_at,'YYYY-MM-DD') AS p FROM commodity.observations WHERE series_id='fred:DCOILBRENTEU' ORDER BY obs_date`);
    expect(rows).toEqual([{ d: '2026-10-19', p: '2026-10-21' }, { d: '2026-10-21', p: '2026-10-22' }]);
  });
});

describe('EIA (recorded response) and data.gov.in (documented shape)', () => {
  beforeEach(resetGate);
  it('EIA rows parse from a real response and paging follows the reported total', async () => {
    const body = FX('commodity/eia-wstk-WCESTUS1.json');
    expect(parseEiaV2(200, body, 'WCESTUS1').rows.length).toBe(5);
    expect(eiaTotal(body)).toBeGreaterThan(2000);
    const page = (offset: number) => JSON.stringify({ response: { total: '7000', data: Array.from({ length: offset === 0 ? 5000 : 2000 }, (_, i) => ({ period: new Date(Date.UTC(1990, 0, 5) + (offset + i) * 7 * 86_400_000).toISOString().slice(0, 10), series: 'WCESTUS1', value: String(400000 + i) })) } });
    handler = (u) => ({ status: 200, body: page(Number(new URL(u).searchParams.get('offset'))) });
    const before = urls.length;
    const r = await importCommoditySeries(ctx.db, fetchFn, { eia: 'test-eia-key' }, 'eia:WCESTUS1', new Date('2200-01-01T00:00:00Z'));
    expect(urls.length - before).toBe(2);
    expect(r).toMatchObject({ status: 'succeeded', stored: 7000 });
  });
  it('mandi records: dd/mm/yyyy dates, rupees per quintal; rows without a modal price are rejected, not repaired', () => {
    const p = parseMandi(JSON.stringify({ total: 3, records: [
      { state: 'Maharashtra', district: 'Nashik', market: 'Lasalgaon', commodity: 'Onion', variety: 'Red', grade: 'FAQ', arrival_date: '23/10/2026', min_price: '1200', max_price: '2100', modal_price: '1800' },
      { state: 'Maharashtra', district: 'Pune', market: 'Pune', commodity: 'Onion', variety: 'Red', grade: 'FAQ', arrival_date: '23/10/2026', min_price: '1000', max_price: '1900', modal_price: '' },
      { state: 'X', district: 'Y', market: 'Z', commodity: 'Onion', arrival_date: '2026-10-23', modal_price: '1500' },
    ] }));
    expect(p.rows).toEqual([expect.objectContaining({ arrival_date: '2026-10-23', market: 'Lasalgaon', modal_price: 1800, min_price: 1200 })]);
    expect(p.rejected).toBe(2);
    expect(() => parseMandi('{"error":"Rate limit exceeded"}')).toThrow(/Rate limit exceeded/);
  });
});

describe('freshness by publication schedule', () => {
  it('a monthly series two months old is fresh; a daily price two weeks old is stale', () => {
    const t = new Date('2026-10-23T12:00:00Z');
    expect(freshnessOf('2026-09-01', 'Monthly', t).state).toBe('fresh');
    expect(freshnessOf('2026-10-09', 'Daily', t).state).toBe('stale');
    expect(freshnessOf('2026-10-16', 'Daily', t).state).toBe('delayed');
    expect(freshnessOf('2025-03-01', 'Monthly', t).state).toBe('stale');
    expect(freshnessOf('2026-10-09', 'Daily', t, 'HTTP 500').state).toBe('provider_error');
    expect(freshnessOf(null, 'Daily', t).state).toBe('unavailable');
    expect(freshnessOf('2026-04-01', 'Quarterly', t).state).toBe('fresh');
    // Daily rates published in a weekly release; an annual series published mid-following-year; a series the source stopped.
    expect(freshnessOf('2026-10-16', 'Daily', t).state).toBe('delayed');
    expect(freshnessOf('2026-10-16', 'Daily', t, null, { expectedAgeDays: 12 }).state).toBe('fresh');
    expect(freshnessOf('2025-01-01', 'Annual', t).state).toBe('fresh');
    expect(freshnessOf('2024-04-05', 'Daily', t, null, { discontinuedAfter: '2024-04-05' }).state).toBe('discontinued');
  });
});

describe('customer and operator views', () => {
  it('customers get plain-language status without quota ledgers, request logs or provider errors; operators get diagnostics', async () => {
    const c = new Client(app);
    await c.login('pro@atlas.test', DEV_PASSWORD);
    const s = (await c.get('/v1/equity/status')).json;
    expect(s.diagnostics_visible).toBe(false);
    for (const k of ['quota', 'requests', 'runs', 'jobs']) expect(s[k], k).toBeUndefined();
    expect(JSON.stringify(s.providers)).not.toMatch(/last_error/);
    expect((await c.get('/admin/v1/providers')).status).toBe(403);
    const ds = (await c.get('/v1/data-sources')).json;
    expect(ds.providers.map((p: { provider_id: string }) => p.provider_id)).toEqual(expect.arrayContaining(['fred', 'eia', 'coingecko', 'eodhd', 'data_gov_in']));
    expect(ds.not_available.map((n: { what: string }) => n.what).join(' ')).toMatch(/NSE and BSE/);
    const admin = new Client(app);
    await admin.login('admin@atlas.test', DEV_PASSWORD, totpCode(DEV_ADMIN_TOTP_SECRET, clockMs));
    const a = (await admin.get('/admin/v1/providers')).json;
    expect(a.providers.length).toBeGreaterThanOrEqual(5);
    expect(a.quotas.eodhd).toHaveProperty('daily_limit');
    expect((await admin.get('/v1/equity/status')).json).toMatchObject({ diagnostics_visible: true, quota: expect.any(Object) });
    await ctx.db.query(`UPDATE ops.provider_state SET next_eligible_at=$1, status='rate_limited' WHERE provider_id='fred'`, [new Date(clockMs + 3_600_000).toISOString()]);
    expect((await admin.post('/admin/v1/providers/fred/resume', {})).json.ok).toBe(true);
    expect((await admit(ctx.db, 'fred', now())).recovering).toBe(true);
  });
});

describe('real-data mode', () => {
  let off: AppContext;
  let offApp: FastifyInstance;
  beforeAll(async () => {
    const cfg = loadConfig({ NODE_ENV: 'test', APP_SECRET: 'test-secret-test-secret-test-secret-test', LOG_LEVEL: 'silent', RATE_LIMIT_MULTIPLIER: '1000', WEB_ORIGIN: 'http://localhost:3000', ALLOW_SYNTHETIC_DATA: 'false' } as NodeJS.ProcessEnv);
    off = await fixtureContext({ cfg, vendor: new NoVendor(), equityFetch: fetchFn });
    offApp = await buildApp(off);
  });
  afterAll(async () => {
    await offApp?.close();
    await off?.db.close();
  });
  it('the public status reports real pipelines and demo_mode false; demo sections are refused; macro and commodities answer', async () => {
    const pub = new Client(offApp);
    const st = (await pub.get('/v1/status')).json;
    expect(st.demo_mode).toBe(false);
    expect(st.components.map((x: { name: string }) => x.name).join(' ')).toMatch(/FRED/);
    expect(st.latest_briefing).toBeNull();
    const c = new Client(offApp);
    await c.login('pro@atlas.test', DEV_PASSWORD);
    for (const u of ['/v1/home/what-changed', '/v1/companies/X', '/v1/market/summary']) expect((await c.get(u)).status, u).toBe(403);
    expect((await c.get('/v1/macro')).status).toBe(200);
    expect((await c.get('/v1/commodities')).status).toBe(200);
    expect((await c.get('/v1/commodities/mandi')).json).toMatchObject({ configured: false, verified: false });
  });
});
