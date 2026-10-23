import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { totpCode } from '../src/lib/crypto.js';
import { missingSessions } from '../src/modules/equity/analytics.js';
import { importEquityPrices } from '../src/modules/equity/ingest.js';
import { addToUniverse, expectedLatestSession, inferNoSessionDays, isExpectedSession, listUniverse, runEquityRefresh, splitConsistency, storeCorporateActions, updateUniverse, type Policies } from '../src/modules/equity/operations.js';
import { EquityProviderError, parseEodhd, parseEodhdDividends, parseEodhdExchangeDetails, parseEodhdSplits, parseEodhdUser, redact, type FetchFn } from '../src/modules/equity/providers.js';
import { ALPHAVANTAGE_POLICY, eodhdPolicy, markExhausted, Pacer, parseBudgets, quotaStatus, recordProviderUsage, spend } from '../src/modules/equity/quota.js';
import { lastSlot, nextSlot } from '../src/modules/equity/routes.js';
import { DEV_ADMIN_TOTP_SECRET, DEV_PASSWORD } from '../src/seed.js';
import { Client } from './http.js';
import { fixtureContext } from './fixture.js';

// Quota-aware Indian equity operations on a free provider plan. Response SHAPES for /api/user, splits and
// dividends are real EODHD responses recorded with the public demo token on 23 Oct 2026
// (test/fixtures/equity). Price rows for Indian tickers are generated inside this test (test data, in a
// throwaway database) because no real Indian response can be obtained without a key.

const FX = (f: string) => readFileSync(new URL(`./fixtures/equity/${f}`, import.meta.url), 'utf8');
const KEYS = { eodhd: 'test-token-not-real', alphavantage: '' };
// Monday 26 Oct 2026, 21:30 IST: the session of the 26th should be published.
let clockMs = Date.parse('2026-10-26T16:00:00Z');
const now = () => new Date(clockMs);

/** Weekday sessions between two dates (inclusive), skipping `skip`; a gentle deterministic path. */
function bars(from: string, to: string, skip: string[] = [], base = 1000) {
  const out: { date: string; open: number; high: number; low: number; close: number; adjusted_close: number; volume: number }[] = [];
  let p = base;
  for (let d = Date.parse(`${from}T00:00:00Z`); d <= Date.parse(`${to}T00:00:00Z`); d += 86_400_000) {
    const iso = new Date(d).toISOString().slice(0, 10);
    const wd = new Date(d).getUTCDay();
    if (wd === 0 || wd === 6 || skip.includes(iso)) continue;
    p = Math.round(p * (1 + 0.008 * Math.sin(out.length / 4)) * 100) / 100;
    out.push({ date: iso, open: p, high: Math.round(p * 1.01 * 100) / 100, low: Math.round(p * 0.99 * 100) / 100, close: p, adjusted_close: p, volume: 100_000 + out.length });
  }
  return out;
}

interface Route { status: number; body: string }
const routes: Record<string, (url: string) => Route> = {};
const calls: string[] = [];
const fetchFn: FetchFn = async (url) => {
  calls.push(url);
  const path = new URL(url).pathname.replace('/api/', '');
  const key = Object.keys(routes).find((k) => path.startsWith(k));
  if (!key) return { status: 404, ok: false, text: async () => 'Ticker Not Found.' };
  const r = routes[key]!(url);
  if (r.status === -1) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  return { status: r.status, ok: r.status < 400, text: async () => r.body };
};
const json = (x: unknown): Route => ({ status: 200, body: JSON.stringify(x) });
const usage = (n: number, date = '2026-10-26') => json({ apiRequests: n, apiRequestsDate: date, dailyRateLimit: 20, extraLimit: 500, subscriptionType: 'free' });

let ctx: AppContext;
let app: FastifyInstance;
let policies: Policies;
beforeAll(async () => {
  ctx = await fixtureContext({ clock: now, equityFetch: fetchFn });
  app = await buildApp(ctx);
  policies = { eodhd: eodhdPolicy(), alphavantage: ALPHAVANTAGE_POLICY };
});
afterAll(async () => {
  await app?.close();
  await ctx?.db.close();
});
beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(routes)) delete routes[k];
  routes['user'] = () => usage(0);
});

const run = (o: Partial<Parameters<typeof runEquityRefresh>[4]> = {}) => runEquityRefresh(ctx.db, fetchFn, KEYS, now(), { trigger: 'manual', policies, validation: false, ...o });
const reset = async () => {
  for (const t of ['equity.provider_requests', 'equity.quota_days', 'equity.refresh_runs', 'equity.calendar_days', 'equity.corporate_actions', 'equity.universe']) await ctx.db.query(`DELETE FROM ${t}`);
  await ctx.db.query(`UPDATE equity.providers SET health='unknown', last_error_category=NULL`);
};

describe('provider responses (recorded real shapes)', () => {
  it('usage, splits and dividends parse from real EODHD responses', () => {
    expect(parseEodhdUser(200, FX('eodhd-user-demo.json'))).toMatchObject({ api_requests_date: '2026-10-23', daily_limit: 10000000, extra_limit: 0 });
    expect(parseEodhdSplits(200, FX('eodhd-splits-aapl.json'))).toEqual([
      expect.objectContaining({ kind: 'split', ex_date: '2014-06-09', ratio: '7.000000/1.000000' }), expect.objectContaining({ kind: 'split', ex_date: '2020-08-31', ratio: '4.000000/1.000000' })]);
    const div = parseEodhdDividends(200, FX('eodhd-div-aapl.json'));
    expect(div[0]).toMatchObject({ kind: 'dividend', ex_date: '2025-02-10', value: 0.25, currency: 'USD' });
  });
  it('402 is "allowance spent", distinct from 429 "per-minute limit" and 401 "bad token"', () => {
    expect(() => parseEodhd(402, 'API Rate Limit Exceeded')).toThrow(expect.objectContaining({ category: 'quota_exhausted' }));
    expect(() => parseEodhd(429, '')).toThrow(expect.objectContaining({ category: 'rate_limited' }));
    expect(() => parseEodhdUser(401, '')).toThrow(expect.objectContaining({ category: 'auth' }));
  });
  it('unexpected shapes are rejected, never guessed at', () => {
    expect(() => parseEodhdUser(200, '{"apiRequests":"x"}')).toThrow(expect.objectContaining({ category: 'malformed' }));
    expect(() => parseEodhdSplits(200, '{"error":1}')).toThrow(EquityProviderError);
    expect(() => parseEodhdExchangeDetails(200, '[]')).not.toThrow();
    expect(() => parseEodhdExchangeDetails(200, '{"ExchangeHolidays":"none"}')).toThrow(expect.objectContaining({ category: 'malformed' }));
    expect(parseEodhdExchangeDetails(200, JSON.stringify({ Timezone: 'Asia/Kolkata', ExchangeHolidays: { 0: { Holiday: 'Test holiday', Date: '2026-11-10', Type: 'official' }, 1: { Holiday: 'bad', Date: 'soon' } } })).holidays).toEqual([{ date: '2026-11-10', name: 'Test holiday', type: 'official' }]);
    // Empty arrays and extra fields are fine: no rows means no rows.
    expect(parseEodhd(200, '[]')).toEqual([]);
    expect(parseEodhd(200, '[{"date":"2026-10-01","open":1,"high":1,"low":1,"close":1,"volume":1,"adjusted_close":1,"unexpected":"x"}]')).toHaveLength(1);
  });
  it('secrets are redacted from any URL that is logged', () => {
    expect(redact('https://eodhd.com/api/eod/X.NSE?api_token=abc123&fmt=json')).toBe('https://eodhd.com/api/eod/X.NSE?api_token=REDACTED&fmt=json');
  });
});

describe('quota ledger', () => {
  beforeEach(reset);
  it('budgets parse only when complete and adding up to the limit', () => {
    expect(parseBudgets('refresh=12,backfill=2,validation=2,manual=2,reserve=2', 20).refresh).toBe(12);
    expect(() => parseBudgets('refresh=12,backfill=2', 20)).toThrow(/missing/);
    expect(() => parseBudgets('refresh=15,backfill=2,validation=2,manual=2,reserve=2', 20)).toThrow(/add up to 23/);
    expect(() => loadConfig({ NODE_ENV: 'test', EODHD_QUOTA_BUDGETS: 'refresh=1' } as NodeJS.ProcessEnv)).toThrow();
    const c = loadConfig({ NODE_ENV: 'test', EODHD_API_KEY: 'alias-value', EODHD_DAILY_LIMIT: '100' } as NodeJS.ProcessEnv);
    expect(c.EODHD_API_TOKEN).toBe('alias-value');
    expect(Object.values(c.eodhdBudgets).reduce((s, x) => s + x, 0)).toBe(100);
  });
  it('each purpose stops at its budget; the reserve is only for an explicit manual request', async () => {
    const t = now();
    for (let i = 0; i < 2; i++) expect((await spend(ctx.db, policies.eodhd, 'backfill', 1, t)).ok).toBe(true);
    expect(await spend(ctx.db, policies.eodhd, 'backfill', 1, t)).toEqual({ ok: false, reason: 'budget' });
    expect((await spend(ctx.db, policies.eodhd, 'manual', 1, t)).ok).toBe(true);
    expect((await spend(ctx.db, policies.eodhd, 'manual', 1, t)).ok).toBe(true);
    expect(await spend(ctx.db, policies.eodhd, 'manual', 1, t)).toEqual({ ok: false, reason: 'budget' });
    expect(await spend(ctx.db, policies.eodhd, 'manual', 1, t, { useReserve: true })).toEqual({ ok: true, charged_to: 'reserve' });
    const q = await quotaStatus(ctx.db, policies.eodhd, t);
    expect(q).toMatchObject({ spent_local: 5, remaining: 15, usage_date: '2026-10-26', next_reset_at: '2026-10-27T00:00:00.000Z' });
  });
  it('concurrent spending never exceeds a budget', async () => {
    const t = now();
    const results = await Promise.all(Array.from({ length: 30 }, () => spend(ctx.db, policies.eodhd, 'refresh', 1, t)));
    expect(results.filter((r) => r.ok)).toHaveLength(12);
    expect((await quotaStatus(ctx.db, policies.eodhd, t)).spent_local).toBe(12);
  });
  it('provider-reported usage counts when higher; a figure for another day is ignored', async () => {
    const t = now();
    expect((await recordProviderUsage(ctx.db, 'eodhd', t, { api_requests: 7, api_requests_date: '2026-10-25', daily_limit: 20 })).applied).toBe(false);
    await recordProviderUsage(ctx.db, 'eodhd', t, { api_requests: 17, api_requests_date: '2026-10-26', daily_limit: 20 });
    const q = await quotaStatus(ctx.db, policies.eodhd, t);
    expect(q.remaining).toBe(3);
    expect(q.discrepancy_note).toMatch(/provider reports 17/);
    // 12 refresh calls would fit the refresh budget, but only 3 fit what the provider says is left.
    let ok = 0;
    for (let i = 0; i < 12; i++) if ((await spend(ctx.db, policies.eodhd, 'refresh', 1, t)).ok) ok++;
    expect(ok, JSON.stringify(await quotaStatus(ctx.db, policies.eodhd, t))).toBe(3);
    expect(await spend(ctx.db, policies.eodhd, 'refresh', 1, t)).toEqual({ ok: false, reason: 'daily_limit' });
    // A newer report that already includes ATLAS's calls is not double-counted.
    await recordProviderUsage(ctx.db, 'eodhd', t, { api_requests: 18, api_requests_date: '2026-10-26', daily_limit: 20 });
    expect((await quotaStatus(ctx.db, policies.eodhd, t)).remaining).toBe(2);
  });
  it('a provider "allowance spent" stops all calls until the reset; the next quota day starts clean', async () => {
    await markExhausted(ctx.db, 'eodhd', now(), 'HTTP 402');
    expect(await spend(ctx.db, policies.eodhd, 'manual', 1, now(), { useReserve: true })).toEqual({ ok: false, reason: 'exhausted' });
    const tomorrow = new Date(Date.parse('2026-10-27T00:00:01Z'));
    expect((await spend(ctx.db, policies.eodhd, 'refresh', 1, tomorrow)).ok).toBe(true);
    expect((await quotaStatus(ctx.db, policies.eodhd, tomorrow)).exhausted).toBe(false);
  });
  it('the pacer spaces requests by the per-minute limit without real waiting in tests', async () => {
    let clock = 0;
    const slept: number[] = [];
    const p = new Pacer(3100, () => clock, async (ms) => { slept.push(ms); clock += ms; });
    await p.wait();
    clock += 1000;
    await p.wait();
    expect(slept).toEqual([2100]);
  });
});

describe('sessions and calendar', () => {
  beforeEach(reset);
  it('expected session: after 20:00 IST today counts; before, the previous weekday; weekends and evidenced holidays skipped', () => {
    expect(expectedLatestSession(new Date('2026-10-26T16:00:00Z'), [])).toBe('2026-10-26'); // Mon 21:30 IST
    expect(expectedLatestSession(new Date('2026-10-26T10:00:00Z'), [])).toBe('2026-10-23'); // Mon 15:30 IST → Fri
    const cal = [{ day: '2026-10-23', kind: 'holiday' as const, description: 'x', source: 'user' }];
    expect(expectedLatestSession(new Date('2026-10-26T10:00:00Z'), cal)).toBe('2026-10-22');
    expect(isExpectedSession('2026-10-24', [{ day: '2026-10-24', kind: 'special_session', description: 'x', source: 'user' }])).toBe(true);
    expect(missingSessions(['2026-10-19', '2026-10-23'], cal)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
  });
  it('refresh slots are 08:00 and 20:30 IST', () => {
    const t = new Date('2026-10-26T16:00:00Z'); // 21:30 IST
    expect(lastSlot(t).toISOString()).toBe('2026-10-26T15:00:00.000Z');
    expect(nextSlot(t).toISOString()).toBe('2026-10-27T02:30:00.000Z');
  });
});

describe('universe and the refresh run', () => {
  beforeEach(reset);
  it('instruments are queued by priority; new ones use the backfill budget, the rest the refresh budget', async () => {
    for (const [s, p] of [['AAA', 2], ['BBB', 1], ['CCC', 3]] as const) await addToUniverse(ctx.db, { exchange: 'NSE', symbol: s, priority: p }, null);
    routes['eod/'] = () => json(bars('2026-09-01', '2026-10-26'));
    const r = await run();
    // Backfill budget is 2: BBB (priority 1) and AAA (2) are imported; CCC waits for tomorrow.
    expect(r).toMatchObject({ attempted: 2, succeeded: 2, deferred_budget: 1, status: 'succeeded' });
    expect(calls.filter((u) => u.includes('/eod/')).map((u) => /eod\/([A-Z]+)/.exec(u)![1])).toEqual(['BBB', 'AAA']);
    const q = await quotaStatus(ctx.db, policies.eodhd, now());
    expect(q.budgets.find((b) => b.category === 'backfill')).toMatchObject({ spent: 2, remaining: 0 });
    const u = await listUniverse(ctx.db, now(), '2026-10-26');
    expect(u.map((x) => [x.symbol, x.state])).toEqual([['BBB', 'up_to_date'], ['AAA', 'up_to_date'], ['CCC', 'awaiting_first_import']]);
    expect(u[0]!.verification).toBe('verified');
    expect(r.stop_reason).toMatch(/deferred/);
  });
  it('an up-to-date universe spends no price calls', async () => {
    await addToUniverse(ctx.db, { exchange: 'NSE', symbol: 'AAA', priority: 1 }, null);
    const r = await run();
    expect(r.attempted).toBe(0);
    expect(calls.filter((u) => u.includes('/eod/'))).toHaveLength(0);
    expect(r.stop_reason).toMatch(/Nothing was due/);
  });
  it('a provider with no newer session is not asked again within 6 hours', async () => {
    await addToUniverse(ctx.db, { exchange: 'NSE', symbol: 'AAA', priority: 1 }, null);
    clockMs = Date.parse('2026-10-27T16:00:00Z'); // Tue 21:30 IST: the 27th is expected
    routes['eod/'] = () => json([]);
    const r1 = await run();
    expect(r1.attempted).toBe(1);
    const r2 = await run();
    expect(r2.attempted).toBe(0);
    expect(r2.items[0]).toMatchObject({ outcome: 'waiting' });
    clockMs = Date.parse('2026-10-26T16:00:00Z');
  });
  it('an entitlement refusal marks the mapping failed and waits a week; removal keeps the data', async () => {
    await addToUniverse(ctx.db, { exchange: 'NSE', symbol: 'AAA', priority: 1 }, null);
    await addToUniverse(ctx.db, { exchange: 'NSE', symbol: 'NOPE', priority: 1 }, null);
    routes['eod/NOPE'] = () => ({ status: 403, body: 'Forbidden' });
    const r = await run();
    expect(r).toMatchObject({ failed: 1, succeeded: 0, status: 'failed' });
    const u = (await listUniverse(ctx.db, now(), '2026-10-26')).find((x) => x.symbol === 'NOPE')!;
    expect(u).toMatchObject({ state: 'waiting_retry', verification: 'failed', last_error_category: 'entitlement' });
    expect(Date.parse(u.retry_after!) - now().getTime()).toBe(7 * 86_400_000);
    expect(await updateUniverse(ctx.db, 'NSE', 'AAA', { enabled: false })).toBe(true);
    expect((await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM equity.prices p JOIN equity.price_series s USING (series_id) JOIN equity.instruments i USING (instrument_id) WHERE i.symbol='AAA'`)).n).toBeGreaterThan(0);
  });
  it('a rejected token stops the run immediately and keeps the circuit open', async () => {
    await addToUniverse(ctx.db, { exchange: 'NSE', symbol: 'DDD', priority: 1 }, null);
    routes['user'] = () => ({ status: 401, body: 'Unauthenticated' });
    const r = await run();
    expect(r.status).toBe('failed');
    expect(calls.filter((u) => u.includes('/eod/'))).toHaveLength(0);
    const again = await run();
    expect(calls.filter((u) => u.includes('/eod/'))).toHaveLength(0);
    expect(again.items.every((i) => i.outcome === 'skipped')).toBe(true);
  });
  it('HTTP 402 marks the day exhausted and stops; timeouts are retried later, not in a loop', async () => {
    await addToUniverse(ctx.db, { exchange: 'NSE', symbol: 'EEE', priority: 1 }, null);
    await addToUniverse(ctx.db, { exchange: 'NSE', symbol: 'FFF', priority: 2 }, null);
    routes['eod/EEE'] = () => ({ status: -1, body: '' });
    routes['eod/FFF'] = () => ({ status: 402, body: 'API Rate Limit Exceeded' });
    const r = await run();
    expect(r.items.map((i) => i.outcome)).toEqual(['failed', 'failed']);
    expect((await quotaStatus(ctx.db, policies.eodhd, now())).exhausted).toBe(true);
    const e = (await listUniverse(ctx.db, now(), '2026-10-26')).find((x) => x.symbol === 'EEE')!;
    expect(e.last_error_category).toBe('timeout');
    expect(Date.parse(e.retry_after!) - now().getTime()).toBe(6 * 3_600_000);
    const log = await ctx.db.query<{ endpoint: string; outcome: string; error_category: string | null }>(`SELECT endpoint, outcome, error_category FROM equity.provider_requests WHERE endpoint='eod' ORDER BY request_id`);
    expect(log).toEqual([{ endpoint: 'eod', outcome: 'error', error_category: 'timeout' }, { endpoint: 'eod', outcome: 'error', error_category: 'quota_exhausted' }]);
  });
  it('validation fetches the calendar once, then splits and dividends, inside its own budget', async () => {
    await addToUniverse(ctx.db, { exchange: 'NSE', symbol: 'AAA', priority: 1 }, null);
    routes['exchange-details/NSE'] = () => json({ Timezone: 'Asia/Kolkata', ExchangeHolidays: { 0: { Holiday: 'Test holiday (fixture)', Date: '2026-11-10', Type: 'official' } } });
    routes['splits/'] = () => json([]);
    routes['div/'] = () => json([]);
    const r = await run({ validation: true });
    expect(r.attempted).toBe(0);
    const endpoints = calls.map((u) => new URL(u).pathname.split('/')[2]);
    expect(endpoints).toEqual(['user', 'exchange-details', 'splits']);
    expect((await quotaStatus(ctx.db, policies.eodhd, now())).budgets.find((b) => b.category === 'validation')).toMatchObject({ spent: 2, remaining: 0 });
    expect((await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM equity.calendar_days WHERE source='eodhd_exchange_details'`)).n).toBe(1);
    expect(isExpectedSession('2026-11-10', [{ day: '2026-11-10', kind: 'holiday', description: '', source: 'eodhd_exchange_details' }])).toBe(false);
    // The dividends call was not sent: the validation budget was spent. It is logged as such.
    expect((await ctx.db.query(`SELECT 1 FROM equity.provider_requests WHERE endpoint='dividends' AND outcome='not_sent_budget'`)).length).toBe(1);
  });
  it('a weekday missing from every tracked series is recorded as "no session observed", with evidence', async () => {
    await ctx.db.query(`DELETE FROM equity.prices WHERE trade_date='2026-10-20'`);
    routes['eod/'] = () => json(bars('2026-10-01', '2026-10-26', ['2026-10-20']));
    await importEquityPrices(ctx.db, fetchFn, KEYS, { provider: 'eodhd', exchange: 'NSE', symbol: 'GGG', kind: 'equity' }, now());
    expect(await inferNoSessionDays(ctx.db, now())).toBe(1);
    const cal = await ctx.db.query<{ day: string; source: string; evidence: { series: number } }>(`SELECT to_char(day,'YYYY-MM-DD') AS day, source, evidence FROM equity.calendar_days WHERE kind='no_session_observed'`);
    expect(cal).toEqual([{ day: '2026-10-20', source: 'inferred_from_data', evidence: { series: 3 } }]);
    // A later observation on that day removes the inference.
    routes['eod/'] = () => json(bars('2026-10-01', '2026-10-26'));
    await importEquityPrices(ctx.db, fetchFn, KEYS, { provider: 'eodhd', exchange: 'NSE', symbol: 'GGG', kind: 'equity' }, now());
    await inferNoSessionDays(ctx.db, now());
    expect(await ctx.db.query(`SELECT 1 FROM equity.calendar_days WHERE kind='no_session_observed'`)).toEqual([]);
  });
});

describe('provisional sessions (observed live: EODHD serves today’s row minutes after the close)', () => {
  it('a row for a session before 20:00 IST is not stored; a stored provisional row is withdrawn with its history kept', async () => {
    const at = new Date('2026-10-27T10:15:00Z'); // Tue 15:45 IST
    routes['eod/'] = () => json(bars('2026-10-20', '2026-10-27'));
    const s = await importEquityPrices(ctx.db, fetchFn, KEYS, { provider: 'eodhd', exchange: 'NSE', symbol: 'PROV', kind: 'equity' }, at);
    expect(s).toMatchObject({ status: 'succeeded', provisional: 1, last_date: '2026-10-26' });
    // A row that was stored before its session was final (as imports before this rule did) is withdrawn.
    const series = await ctx.db.one<{ series_id: string }>(`SELECT s.series_id FROM equity.price_series s JOIN equity.instruments i USING (instrument_id) WHERE i.symbol='PROV' AND s.basis='raw'`);
    await ctx.db.query(`INSERT INTO equity.prices (series_id, trade_date, open, high, low, close, volume, imported_at) VALUES ($1,'2026-10-27',10,11,9,10,1,'2026-10-27T10:15:00Z')`, [series.series_id]);
    const { withdrawProvisionalRows } = await import('../src/modules/equity/ingest.js');
    expect(await withdrawProvisionalRows(ctx.db)).toBe(1);
    const rev = await ctx.db.one<{ previous: { withdrawn: string; close: number } }>(`SELECT previous FROM equity.price_revisions WHERE series_id=$1 AND trade_date='2026-10-27'`, [series.series_id]);
    expect(rev.previous).toMatchObject({ close: 10, withdrawn: expect.stringMatching(/provisional/) });
    expect((await ctx.db.one<{ last_date: string }>(`SELECT to_char(last_date,'YYYY-MM-DD') AS last_date FROM equity.price_series WHERE series_id=$1`, [series.series_id])).last_date).toBe('2026-10-26');
    // After 20:00 IST the same session is final and stored.
    const later = await importEquityPrices(ctx.db, fetchFn, KEYS, { provider: 'eodhd', exchange: 'NSE', symbol: 'PROV', kind: 'equity', from: '2026-10-26' }, new Date('2026-10-27T15:00:00Z'));
    expect(later).toMatchObject({ provisional: 0, last_date: '2026-10-27' });
  });
});

describe('holiday placeholder rows (observed live in EODHD index data)', () => {
  it('a flat zero-volume row repeating the previous close is quarantined as "no trading", not stored, and does not make the job partial', async () => {
    const rows = bars('2025-12-22', '2025-12-26');
    const prev = rows.find((r) => r.date === '2025-12-24')!;
    // Same shape as NSEBANK.INDX on 2025-12-25: O=H=L=C=previous close, volume 0.
    Object.assign(rows.find((r) => r.date === '2025-12-25')!, { open: prev.close, high: prev.close, low: prev.close, close: prev.close, adjusted_close: prev.close, volume: 0 });
    routes['eod/'] = () => json(rows);
    const s = await importEquityPrices(ctx.db, fetchFn, KEYS, { provider: 'eodhd', exchange: 'INDEX', symbol: 'HOLTEST', kind: 'index', providerSymbol: 'HOLTEST.INDX' }, now());
    expect(s).toMatchObject({ status: 'succeeded', placeholders: 1, rejected: 0, stored: 4 });
    const q = await ctx.db.one<{ reasons: string[] }>(`SELECT reasons FROM equity.quarantine WHERE job_id=$1`, [s.job_id]);
    expect(q.reasons).toEqual(['no_trading_placeholder']);
    // A placeholder stored before this rule existed is withdrawn, with its values kept in the revision history.
    const series = await ctx.db.one<{ series_id: string }>(`SELECT s.series_id FROM equity.price_series s JOIN equity.instruments i USING (instrument_id) WHERE i.symbol='HOLTEST' AND s.basis='raw'`);
    await ctx.db.query(`INSERT INTO equity.prices (series_id, trade_date, open, high, low, close, volume, imported_at) VALUES ($1,'2025-12-25',$2,$2,$2,$2,0,$3)`, [series.series_id, prev.close, now().toISOString()]);
    const { withdrawPlaceholderRows } = await import('../src/modules/equity/ingest.js');
    expect(await withdrawPlaceholderRows(ctx.db)).toBe(1);
    expect((await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM equity.price_revisions WHERE series_id=$1 AND previous->>'withdrawn' LIKE 'no_trading_placeholder%'`, [series.series_id])).n).toBe(1);
  });
});

describe('corporate actions', () => {
  it('a split shows up in the provider-adjusted series, or is flagged', async () => {
    const inst = await ctx.db.one<{ instrument_id: string }>(`SELECT instrument_id FROM equity.instruments WHERE exchange='NSE' AND symbol='AAA'`);
    await storeCorporateActions(ctx.db, inst.instrument_id, 'eodhd', [{ kind: 'split', ex_date: '2026-10-15', ratio: '2.000000/1.000000', value: null, currency: null, raw: {} }], now());
    const [check] = await splitConsistency(ctx.db, inst.instrument_id);
    // Test rows have adjusted = raw, so the factor does not change by 2: flagged, not hidden.
    expect(check).toMatchObject({ ex_date: '2026-10-15', expected_change: 2, consistent: false });
  });
});

describe('API', () => {
  let admin: Client;
  beforeAll(async () => {
    ctx.cfg.EODHD_API_TOKEN = KEYS.eodhd; // as if set in .env.local
    admin = new Client(app);
    expect((await admin.login('admin@atlas.test', DEV_PASSWORD, totpCode(DEV_ADMIN_TOTP_SECRET, clockMs))).status).toBe(200);
  });
  it('status shows the quota, schedule, universe, calendar and request log, and never a key', async () => {
    const c = new Client(app);
    await c.login('pro@atlas.test', DEV_PASSWORD);
    const s = (await c.get('/v1/equity/status')).json;
    expect(s.quota.eodhd).toMatchObject({ daily_limit: 20, reset_time_zone: 'UTC' });
    expect(s.quota.eodhd.budgets.map((b: { category: string }) => b.category)).toEqual(['refresh', 'backfill', 'validation', 'manual', 'reserve']);
    expect(s.schedule.slots_ist).toEqual(['08:00', '20:30']);
    expect(s.expected_session).toBe('2026-10-26');
    expect(Array.isArray(s.universe)).toBe(true);
    expect(JSON.stringify(s)).not.toContain(KEYS.eodhd);
  });
  it('market overview and explorer use stored real-provider rows only, and say what they cover', async () => {
    const c = new Client(app);
    await c.login('pro@atlas.test', DEV_PASSWORD);
    const m = (await c.get('/v1/equity/market')).json;
    expect(m.coverage.note).toMatch(/not the whole exchange/);
    const e = (await c.get('/v1/equity/explorer?sort=m1&dir=desc')).json;
    expect(e.rows.length).toBeGreaterThan(0);
    expect(e.rows.every((r: { classification: string }) => r.classification === 'REAL_UNVERIFIED')).toBe(true);
    const filtered = (await c.get('/v1/equity/explorer?rsi_below=0')).json;
    expect(filtered.rows).toEqual([]);
    const d = (await c.get('/v1/equity/instruments/NSE/AAA')).json;
    expect(d.analysis.metrics.observations).toBeGreaterThan(10);
    expect(d.analysis.chart[0]).toHaveProperty('rsi');
    expect(d.fundamentals_note).toMatch(/excludes them/);
    expect((await c.get('/v1/equity/instruments/NSE/ZZZZ')).status).toBe(404);
  });
  it('universe changes, manual refresh and usage checks need an administrator with two-step verification', async () => {
    const c = new Client(app);
    await c.login('pro@atlas.test', DEV_PASSWORD);
    expect((await c.post('/admin/v1/equity/universe', { exchange: 'NSE', symbol: 'XYZ' })).status).toBe(403);
    expect((await c.post('/admin/v1/equity/refresh', {})).status).toBe(403);
    expect((await admin.post('/admin/v1/equity/universe', { exchange: 'NSE', symbol: 'xyz', priority: 2 })).json).toMatchObject({ provider_symbol: 'XYZ.NSE', created: true });
    expect((await admin.post('/admin/v1/equity/universe', { exchange: 'INDEX', symbol: 'NOCODE' })).status).toBe(400);
    expect((await admin.patch('/admin/v1/equity/universe/NSE/XYZ', { priority: 5 })).status).toBe(200);
    const starter = (await admin.post('/admin/v1/equity/universe/starter', {})).json;
    expect(starter.added).toContain('INDEX:NIFTY50');
    expect(calls.length).toBe(0); // adding to the universe never calls the provider
    expect((await admin.post('/admin/v1/equity/calendar', { day: '2026-12-25', kind: 'holiday', description: 'Added by you (test)' })).status).toBe(200);
    expect((await admin.del('/admin/v1/equity/calendar/2026-12-25')).status).toBe(200);
  });
  it('manual imports are charged to the manual budget and refused, unsent, once it is spent', async () => {
    await reset();
    routes['eod/'] = () => json(bars('2026-10-01', '2026-10-26'));
    for (let i = 0; i < 2; i++) { const r = (await admin.post('/admin/v1/equity/import', { provider: 'eodhd', exchange: 'NSE', symbol: 'AAA' })).json; expect(r.status, JSON.stringify(r)).not.toBe('failed'); }
    const refused = (await admin.post('/admin/v1/equity/import', { provider: 'eodhd', exchange: 'NSE', symbol: 'AAA' })).json;
    expect(refused).toMatchObject({ status: 'failed', error_category: 'quota_exhausted', quota_refusal: 'budget' });
    expect(calls.filter((u) => u.includes('/eod/'))).toHaveLength(2);
    expect((await admin.post('/admin/v1/equity/import', { provider: 'eodhd', exchange: 'NSE', symbol: 'AAA', use_reserve: true })).json.status).not.toBe('failed');
  });
});
