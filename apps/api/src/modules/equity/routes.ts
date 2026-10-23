import * as A from '@atlas/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/db.js';
import { badRequest, conflict, notFound, parse } from '../../lib/http.js';
import { requireRole, requireUser } from '../auth/service.js';
import { loadBars, metricsOf, missingSessionsFor, sessionsBehind, toObs, type Bars } from './analytics.js';
import { importEquityPrices, type EquityKeys } from './ingest.js';
import { addToUniverse, calendarFor, checkProviderUsage, expectedLatestSession, listUniverse, runEquityRefresh, splitConsistency, STARTER_UNIVERSE, updateUniverse, type Policies } from './operations.js';
import { EQUITY_PROVIDERS, EquityProviderError, type FetchFn } from './providers.js';
import { ALPHAVANTAGE_POLICY, eodhdPolicy, Pacer, quotaStatus } from './quota.js';

// Indian equities, real data only (equity schema). The synthetic development companies elsewhere in
// ATLAS are never shown here. Provider calls use the local owner's own keys, are charged against a
// persistent daily quota before they are sent, and are limited to administrators/data operators.

export function equityKeys(ctx: AppContext): EquityKeys {
  return { eodhd: ctx.cfg.EODHD_API_TOKEN, alphavantage: ctx.cfg.ALPHAVANTAGE_API_KEY };
}

interface Runtime { policies: Policies; pacers: Partial<Record<'eodhd' | 'alphavantage', Pacer>>; running: boolean }
const runtimes = new WeakMap<AppContext, Runtime>();

/** Per-process quota policies and request pacers (tests run without pacing). */
export function equityRuntime(ctx: AppContext): Runtime {
  let r = runtimes.get(ctx);
  if (!r) {
    const policies: Policies = { eodhd: eodhdPolicy(ctx.cfg.EODHD_DAILY_LIMIT, ctx.cfg.eodhdBudgets), alphavantage: ALPHAVANTAGE_POLICY };
    const pace = ctx.cfg.NODE_ENV !== 'test';
    r = { policies, pacers: pace ? { eodhd: new Pacer(policies.eodhd.min_interval_ms), alphavantage: new Pacer(policies.alphavantage.min_interval_ms) } : {}, running: false };
    runtimes.set(ctx, r);
  }
  return r;
}

/** Refresh slots in IST: 20:30 (after the session's data should be published) and 08:00 (catch-up). */
const SLOTS_IST = [8 * 60, 20 * 60 + 30];
const IST = 330 * 60_000;
export function lastSlot(now: Date): Date {
  const ist = new Date(now.getTime() + IST);
  const day = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const past = SLOTS_IST.filter((s) => s <= mins);
  const slot = past.length ? day + past[past.length - 1]! * 60_000 : day - 86_400_000 + SLOTS_IST[SLOTS_IST.length - 1]! * 60_000;
  return new Date(slot - IST);
}
export function nextSlot(now: Date): Date {
  const ist = new Date(now.getTime() + IST);
  const day = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const next = SLOTS_IST.find((s) => s > mins);
  return new Date((next !== undefined ? day + next * 60_000 : day + 86_400_000 + SLOTS_IST[0]! * 60_000) - IST);
}

/** Scheduled refresh: runs when the most recent slot has passed without a scheduled run since. */
export async function scheduledEquityRefresh(ctx: AppContext): Promise<{ ran: boolean }> {
  const rt = equityRuntime(ctx);
  const keys = equityKeys(ctx);
  if (!ctx.cfg.equityRefresh || rt.running || (!keys.eodhd && !keys.alphavantage)) return { ran: false };
  const now = ctx.clock();
  const last = await ctx.db.maybeOne<{ started_at: string }>(`SELECT started_at FROM equity.refresh_runs WHERE trigger='schedule' ORDER BY started_at DESC LIMIT 1`);
  if (last && Date.parse(last.started_at) >= lastSlot(now).getTime()) return { ran: false };
  rt.running = true;
  try {
    await runEquityRefresh(ctx.db, ctx.equityFetch, keys, now, { trigger: 'schedule', policies: rt.policies, pacer: rt.pacers.eodhd });
  } finally {
    rt.running = false;
  }
  return { ran: true };
}

const instKey = z.object({ exchange: z.enum(['NSE', 'BSE', 'INDEX']), symbol: z.string().regex(/^[A-Z0-9&_.-]{1,30}$/) });

async function instrumentRow(db: Db, exchange: string, symbol: string) {
  return db.maybeOne<{ instrument_id: string; exchange: string; symbol: string; name: string | null; kind: string; isin: string | null; currency: string; created_at: string }>(
    `SELECT instrument_id, exchange, symbol, name, kind, isin, currency, created_at FROM equity.instruments WHERE exchange=$1 AND symbol=$2`, [exchange, symbol]);
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const tail = <T>(xs: T[], n: number) => xs.slice(Math.max(0, xs.length - n));

export async function equityRoutes(app: FastifyInstance, ctx: AppContext, fetchFn: FetchFn): Promise<void> {
  const db = ctx.db;
  const now = () => ctx.clock();

  app.get('/v1/equity/status', async (req) => {
    requireUser(req);
    const rt = equityRuntime(ctx);
    const t = now();
    const providers = await db.query(`SELECT provider_id, name, docs_url, terms_url, docs_checked_on, coverage_note, limits_note, licence_note, priority, health, last_success_at, last_error_at, last_error, last_error_category FROM equity.providers ORDER BY priority`);
    const keys = equityKeys(ctx);
    const cal = await calendarFor(db, 'NSE', iso(t.getTime() - 40 * 86_400_000), iso(t.getTime() + 400 * 86_400_000));
    const expected = expectedLatestSession(t, cal);
    const instruments = await db.query(`SELECT i.exchange, i.symbol, i.name, i.kind, s.provider_id, s.classification, s.basis, s.first_date, s.last_date, s.observations, s.last_import_at
        FROM equity.instruments i JOIN equity.price_series s USING (instrument_id) ORDER BY i.exchange, i.symbol, s.basis`);
    const jobs = await db.query(`SELECT job_id, provider_id, kind, dry_run, status, started_at, finished_at, received, stored, unchanged, corrected, rejected, error, error_category, detail FROM equity.import_jobs ORDER BY started_at DESC LIMIT 20`);
    const counts = await db.one<{ instruments: number; prices: number; quarantined: number; revisions: number; corporate_actions: number }>(`SELECT (SELECT count(*)::int FROM equity.instruments) AS instruments, (SELECT count(*)::int FROM equity.prices) AS prices, (SELECT count(*)::int FROM equity.quarantine) AS quarantined, (SELECT count(*)::int FROM equity.price_revisions) AS revisions, (SELECT count(*)::int FROM equity.corporate_actions) AS corporate_actions`);
    const runs = await db.query(`SELECT run_id, trigger, started_at, finished_at, to_char(expected_session, 'YYYY-MM-DD') AS expected_session, status, attempted, succeeded, failed, up_to_date, deferred_budget, calls_spent, stop_reason FROM equity.refresh_runs ORDER BY started_at DESC LIMIT 10`);
    const requests = await db.query(`SELECT requested_at, provider_id, category, endpoint, target, cost, outcome, http_status, error_category FROM equity.provider_requests ORDER BY requested_at DESC LIMIT 30`);
    const universe = await listUniverse(db, t, expected);
    return {
      providers: providers.map((p: any) => ({ ...p, configured: !!keys[p.provider_id as keyof EquityKeys], env: EQUITY_PROVIDERS.find((d) => d.provider_id === p.provider_id)?.env })),
      quota: { eodhd: await quotaStatus(db, rt.policies.eodhd, t), alphavantage: await quotaStatus(db, rt.policies.alphavantage, t) },
      schedule: { enabled: ctx.cfg.equityRefresh, next_run_at: nextSlot(t).toISOString(), slots_ist: ['08:00', '20:30'], running: rt.running, note: 'Each run first asks the provider for today’s usage (free), refreshes due instruments in priority order, then spends the validation budget.' },
      expected_session: expected,
      expected_session_note: 'Latest weekday whose end-of-day data should be published (after 20:00 IST), skipping holidays ATLAS has evidence for. ATLAS does not claim to know whether the market is open now.',
      universe, instruments, jobs, counts, runs, requests,
      calendar: cal.filter((c) => c.day >= iso(t.getTime() - 30 * 86_400_000)).slice(0, 60),
      calendar_note: cal.some((c) => c.source === 'eodhd_exchange_details') ? 'Holidays from EODHD exchange details, plus days inferred from stored data and any you added.' : 'No official holiday list is stored yet (fetched from EODHD with the validation budget when the plan allows). Until then only weekends and days inferred from stored data are excluded.',
      classification: { REAL_VERIFIED: 'Cross-checked against a second independent source (none yet).', REAL_UNVERIFIED: 'From one permitted provider; not cross-checked.', USER_IMPORTED: 'Your own uploaded files (My research → Your own data); private to you.', SYNTHETIC_DEMO: 'The fictional development companies elsewhere in ATLAS. Never mixed into this page, research, portfolios or alerts.' },
      market_status_note: 'ATLAS does not infer whether the market is open from this computer’s clock: values here are end-of-day provider closes dated by the provider.',
      synthetic_notice: ctx.cfg.allowSyntheticData ? 'Demo mode is on: Companies, Market, Screener, Quant Lab, Assistant and briefings show fictional development data, labelled as such. Real Indian prices appear only on this page, the explorer and the Research hub.' : 'Demo mode is off: the fictional development sections are disabled.',
    };
  });

  /** Overview of the tracked universe only (not the whole market): indices, breadth, movers. */
  app.get('/v1/equity/market', async (req) => {
    requireUser(req);
    const t = now();
    const cal = await calendarFor(db, 'NSE', iso(t.getTime() - 40 * 86_400_000), iso(t.getTime() + 86_400_000));
    const expected = expectedLatestSession(t, cal);
    const insts = await db.query<{ instrument_id: string; exchange: string; symbol: string; name: string | null; kind: string }>(`SELECT DISTINCT i.instrument_id, i.exchange, i.symbol, i.name, i.kind FROM equity.instruments i JOIN equity.price_series s USING (instrument_id) WHERE s.observations > 0 ORDER BY i.kind DESC, i.symbol`);
    const rows = [];
    for (const i of insts) {
      const b = await loadBars(db, i.instrument_id);
      if (!b) continue;
      const m = metricsOf(b);
      rows.push({ exchange: i.exchange, symbol: i.symbol, name: i.name, kind: i.kind, ...m, behind: sessionsBehind(m.last_date, expected, cal), spark: tail(b.close, 120).map((v, k, arr) => ({ t: tail(b.dates, arr.length)[k], v })) });
    }
    const stocks = rows.filter((r) => r.kind === 'equity');
    const latest = stocks.reduce<string | null>((mx, r) => (r.last_date && (!mx || r.last_date > mx) ? r.last_date : mx), null);
    const onLatest = stocks.filter((r) => r.last_date === latest && r.returns.d1 !== null);
    const movers = [...onLatest].sort((a, b) => (b.returns.d1 ?? 0) - (a.returns.d1 ?? 0));
    return {
      as_of_session: latest, expected_session: expected,
      indices: rows.filter((r) => r.kind === 'index'),
      breadth: latest ? { session: latest, advancers: onLatest.filter((r) => r.returns.d1! > 0).length, decliners: onLatest.filter((r) => r.returns.d1! < 0).length, unchanged: onLatest.filter((r) => r.returns.d1 === 0).length, counted: onLatest.length, not_on_latest_session: stocks.length - onLatest.length } : null,
      gainers: movers.slice(0, 5), losers: movers.slice(-5).reverse(),
      coverage: { tracked_with_data: rows.length, note: `Breadth and movers cover only the ${stocks.length} tracked shares with stored data, not the whole exchange.` },
      basis_note: 'Returns use the provider’s split- and dividend-adjusted closes where supplied (otherwise raw closes); one session = one stored trading day.',
      empty_reason: rows.length ? null : 'No real Indian prices are stored yet. Add instruments to the tracked universe and configure EODHD_API_TOKEN in .env.local; the refresh fills them within the daily budget.',
    };
  });

  /** Explorer and screener over tracked instruments with stored data. Filters exclude rows where the metric is unavailable (counted). */
  app.get('/v1/equity/explorer', async (req) => {
    requireUser(req);
    const q = parse(z.object({
      q: z.string().max(40).optional(), kind: z.enum(['all', 'equity', 'index']).default('all'),
      sort: z.enum(['symbol', 'd1', 'm1', 'm3', 'y1', 'vol_3m', 'rsi14', 'from_high']).default('symbol'), dir: z.enum(['asc', 'desc']).default('asc'),
      min_m1: z.coerce.number().optional(), max_vol: z.coerce.number().optional(), rsi_below: z.coerce.number().optional(), rsi_above: z.coerce.number().optional(),
    }), req.query);
    const t = now();
    const cal = await calendarFor(db, 'NSE', iso(t.getTime() - 40 * 86_400_000), iso(t.getTime() + 86_400_000));
    const expected = expectedLatestSession(t, cal);
    const insts = await db.query<{ instrument_id: string; exchange: string; symbol: string; name: string | null; kind: string; classification: string }>(
      `SELECT DISTINCT ON (i.instrument_id) i.instrument_id, i.exchange, i.symbol, i.name, i.kind, s.classification FROM equity.instruments i JOIN equity.price_series s USING (instrument_id) WHERE s.observations > 0 ORDER BY i.instrument_id`);
    let rows = [];
    for (const i of insts) {
      if (q.kind !== 'all' && i.kind !== q.kind) continue;
      if (q.q && !`${i.symbol} ${i.name ?? ''}`.toLowerCase().includes(q.q.toLowerCase())) continue;
      const b = await loadBars(db, i.instrument_id);
      if (!b) continue;
      const m = metricsOf(b);
      rows.push({ exchange: i.exchange, symbol: i.symbol, name: i.name, kind: i.kind, classification: i.classification, key: `equity:${i.exchange}:${i.symbol}`, behind: sessionsBehind(m.last_date, expected, cal), ...m });
    }
    const excluded: Record<string, number> = {};
    const keep = (name: string, v: number | null, ok: (x: number) => boolean) => {
      if (v === null) { excluded[name] = (excluded[name] ?? 0) + 1; return false; }
      return ok(v);
    };
    if (q.min_m1 !== undefined) rows = rows.filter((r) => keep('min_m1', r.returns.m1, (x) => x >= q.min_m1!));
    if (q.max_vol !== undefined) rows = rows.filter((r) => keep('max_vol', r.vol_3m, (x) => x <= q.max_vol!));
    if (q.rsi_below !== undefined) rows = rows.filter((r) => keep('rsi_below', r.rsi14, (x) => x < q.rsi_below!));
    if (q.rsi_above !== undefined) rows = rows.filter((r) => keep('rsi_above', r.rsi14, (x) => x > q.rsi_above!));
    const val = (r: (typeof rows)[number]): number | string | null => q.sort === 'symbol' ? r.symbol : q.sort === 'vol_3m' ? r.vol_3m : q.sort === 'rsi14' ? r.rsi14 : q.sort === 'from_high' ? r.range_52w?.from_high ?? null : r.returns[q.sort];
    rows.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x === null) return 1;
      if (y === null) return -1;
      const c = typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number);
      return q.dir === 'asc' ? c : -c;
    });
    return { expected_session: expected, rows, excluded_for_missing_metric: excluded, definitions: { ...A.INDICATOR_DEFINITIONS, volatility: 'Annualised volatility: standard deviation of session log returns × √252 (3 months = last 63 sessions).', returns: 'Returns over 1, 5, 21, 63, 126 and 252 stored sessions.' } };
  });

  app.get('/v1/equity/instruments/:exchange/:symbol', async (req) => {
    requireUser(req);
    const p = parse(instKey, req.params);
    const inst = await instrumentRow(db, p.exchange, p.symbol);
    if (!inst) throw notFound('This instrument is not in ATLAS. Add it to the tracked universe (Indian equities → Tracked universe).');
    const t = now();
    const series = await db.query(`SELECT series_id, provider_id, classification, basis, first_date, last_date, observations, last_import_at FROM equity.price_series WHERE instrument_id=$1 ORDER BY basis`, [inst.instrument_id]);
    const symbols = await db.query(`SELECT provider_id, provider_symbol, validated_at, verification, effective_from, effective_to, last_checked_at, last_check_error FROM equity.provider_symbols WHERE instrument_id=$1`, [inst.instrument_id]);
    const universe = await db.maybeOne(`SELECT priority, enabled, note, last_attempt_at, last_success_at, last_error, last_error_category, retry_after FROM equity.universe WHERE instrument_id=$1`, [inst.instrument_id]);
    const actions = await db.query(`SELECT kind, to_char(ex_date, 'YYYY-MM-DD') AS ex_date, ratio, value::float8 AS value, currency, provider_id, retrieved_at FROM equity.corporate_actions WHERE instrument_id=$1 ORDER BY ex_date DESC`, [inst.instrument_id]);
    const revisions = await db.query(`SELECT s.basis, to_char(r.trade_date, 'YYYY-MM-DD') AS trade_date, r.previous, r.revised_at FROM equity.price_revisions r JOIN equity.price_series s USING (series_id) WHERE s.instrument_id=$1 ORDER BY r.revised_at DESC LIMIT 20`, [inst.instrument_id]);
    const raw = await loadBars(db, inst.instrument_id, 'raw');
    const adj = await loadBars(db, inst.instrument_id, 'adjusted_split_dividend');
    const main: Bars | null = adj ?? raw;
    const cal = await calendarFor(db, 'NSE', iso(t.getTime() - 40 * 86_400_000), iso(t.getTime() + 86_400_000));
    const expected = expectedLatestSession(t, cal);
    let analysis = null;
    if (main && main.close.length) {
      const m = metricsOf(main);
      const rsiS = A.rsi(main.close, 14);
      const mac = A.macd(main.close);
      const bench = p.exchange !== 'INDEX' ? await instrumentRow(db, 'INDEX', 'NIFTY50') : null;
      const benchBars = bench ? await loadBars(db, bench.instrument_id) : null;
      const rs = benchBars ? A.relativeStrength(toObs(main), toObs(benchBars)) : [];
      const n = main.close.length;
      const pick = <T>(xs: T[]) => tail(xs, 260);
      analysis = {
        basis: main.basis, metrics: m, behind: sessionsBehind(m.last_date, expected, cal),
        chart: pick(main.dates.map((d, i) => ({ t: d, open: main.open[i], high: main.high[i], low: main.low[i], close: main.close[i], volume: main.volume[i], rsi: rsiS[i], macd: mac.macd[i], signal: mac.signal[i], hist: mac.histogram[i] }))),
        relative_strength: benchBars ? { benchmark: 'INDEX:NIFTY50', basis_note: `Benchmark basis: ${benchBars.basis}.`, points: pick(rs).map((x) => ({ t: iso(x.t), v: x.v })), last: rs[rs.length - 1]?.v ?? null } : { benchmark: null, reason: 'NIFTY 50 has no stored data yet (add INDEX:NIFTY50 to the tracked universe).' },
        gaps: A.gaps(main.dates.map((d, i) => ({ t: Date.parse(`${d}T00:00:00Z`), open: main.open[i]!, high: main.high[i]!, low: main.low[i]!, close: main.close[i]! })), 0.02).slice(-20).reverse().map((g) => ({ ...g, t: iso(g.t) })),
        rolling_21: pick(A.rollingReturns(toObs(main), 21)).map((x) => ({ t: iso(x.t), v: x.v })),
        risk: (() => {
          const lr = main.close.slice(1).map((c, i) => c / main.close[i]! - 1);
          const rr = A.riskRatios(lr.slice(-252), 252, ctx.cfg.RESEARCH_RISK_FREE_RATE);
          return rr.ok ? { ...rr, window_sessions: Math.min(252, lr.length) } : { reason: rr.reason };
        })(),
        missing_sessions: (await missingSessionsFor(db, main)).slice(-30),
        sessions_stored: n,
        definitions: A.INDICATOR_DEFINITIONS,
      };
    }
    return {
      instrument: inst, provider_symbols: symbols, universe, series, analysis,
      corporate_actions: actions, split_checks: await splitConsistency(db, inst.instrument_id), revisions,
      recent_prices: raw ? tail(raw.dates.map((d, i) => ({ basis: 'raw', trade_date: d, open: raw.open[i], high: raw.high[i], low: raw.low[i], close: raw.close[i], volume: raw.volume[i] })), 30).reverse() : [],
      expected_session: expected,
      empty_reason: main ? null : universe ? 'Tracked, but no prices are stored yet: it is imported when the daily budget allows (see Data operations).' : 'No prices stored.',
      fundamentals_note: 'Company fundamentals are not available from the configured free provider (EODHD’s free plan excludes them). You can import statements you obtained yourself under Research hub → Notebook → Financial statements.',
    };
  });

  app.get('/v1/equity/calendar', async (req) => {
    requireUser(req);
    const q = parse(z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.query);
    const t = now();
    const from = q.from ?? iso(t.getTime() - 90 * 86_400_000);
    const to = q.to ?? iso(t.getTime() + 365 * 86_400_000);
    return { days: await calendarFor(db, 'NSE', from, to), expected_session: expectedLatestSession(t, await calendarFor(db, 'NSE', iso(t.getTime() - 40 * 86_400_000), iso(t.getTime() + 86_400_000))) };
  });

  // ───────── Administration (two-step verification required) ─────────
  const admin = (req: Parameters<typeof requireRole>[0]) => requireRole(req, ['admin', 'data_ops']);
  const providerError = (e: unknown) => {
    if (e instanceof EquityProviderError) throw badRequest(e.message);
    throw e;
  };

  app.post('/admin/v1/equity/import', { config: { rateLimit: { limit: 10, windowMs: 60_000, key: 'user' } } }, async (req) => {
    const u = admin(req);
    const b = parse(z.object({ provider: z.enum(['eodhd', 'alphavantage']), exchange: z.enum(['NSE', 'BSE', 'INDEX']), symbol: z.string().trim().toUpperCase().pipe(z.string().regex(/^[A-Z0-9&_.-]{1,30}$/)), kind: z.enum(['equity', 'index']).default('equity'), name: z.string().max(120).optional(), provider_symbol: z.string().max(40).regex(/^[A-Za-z0-9&_.^-]+$/).optional(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), dry_run: z.boolean().default(false), use_reserve: z.boolean().default(false) }), req.body);
    const rt = equityRuntime(ctx);
    // A dry run still calls the provider, so it is charged like any other manual request.
    return importEquityPrices(db, fetchFn, equityKeys(ctx), { provider: b.provider, exchange: b.exchange, symbol: b.symbol, kind: b.kind, name: b.name, providerSymbol: b.provider_symbol, from: b.from, dryRun: b.dry_run, requestedBy: u.userId }, now(),
      { policy: rt.policies[b.provider], category: 'manual', useReserve: b.use_reserve, pacer: rt.pacers[b.provider] });
  });

  const universeBody = z.object({ exchange: z.enum(['NSE', 'BSE', 'INDEX']), symbol: z.string().trim().toUpperCase().pipe(z.string().regex(/^[A-Z0-9&_.-]{1,30}$/)), kind: z.enum(['equity', 'index']).optional(), name: z.string().trim().max(120).optional(), provider_symbol: z.string().trim().max(40).regex(/^[A-Za-z0-9&_.^-]+$/).optional(), priority: z.number().int().min(1).max(5).default(3), note: z.string().max(300).optional() });

  app.post('/admin/v1/equity/universe', async (req) => {
    const u = admin(req);
    const b = parse(universeBody, req.body);
    try {
      return await addToUniverse(db, b, u.userId);
    } catch (e) {
      return providerError(e);
    }
  });

  app.post('/admin/v1/equity/universe/starter', async (req) => {
    const u = admin(req);
    const added = [];
    for (const s of STARTER_UNIVERSE) {
      const exists = await db.maybeOne(`SELECT 1 FROM equity.universe u JOIN equity.instruments i USING (instrument_id) WHERE i.exchange=$1 AND i.symbol=$2`, [s.exchange, s.symbol]);
      if (exists) continue;
      await addToUniverse(db, { ...s, note: 'Starter list (mapping unverified until the provider answers).' }, u.userId);
      added.push(`${s.exchange}:${s.symbol}`);
    }
    return { added, note: 'Nothing was requested from the provider. These are imported by the scheduled refresh within the daily backfill budget (2 a day on the free plan). Individual NSE/BSE shares returned "Ticker Not Found" on a free key in testing, so the starter list holds the indices that worked.' };
  });

  app.patch('/admin/v1/equity/universe/:exchange/:symbol', async (req) => {
    admin(req);
    const p = parse(instKey, req.params);
    const b = parse(z.object({ priority: z.number().int().min(1).max(5).optional(), enabled: z.boolean().optional(), note: z.string().max(300).nullable().optional() }), req.body);
    if (!(await updateUniverse(db, p.exchange, p.symbol, b))) throw notFound('This instrument is not in the tracked universe.');
    return { ok: true, note: b.enabled === false ? 'Removed from the refresh queue. Stored prices are kept.' : undefined };
  });

  app.post('/admin/v1/equity/refresh', { config: { rateLimit: { limit: 6, windowMs: 60_000, key: 'user' } } }, async (req) => {
    const u = admin(req);
    const rt = equityRuntime(ctx);
    if (rt.running) throw conflict('A refresh is already running.');
    rt.running = true;
    try {
      return await runEquityRefresh(db, fetchFn, equityKeys(ctx), now(), { trigger: 'manual', requestedBy: u.userId, policies: rt.policies, pacer: rt.pacers.eodhd });
    } finally {
      rt.running = false;
    }
  });

  app.post('/admin/v1/equity/usage-check', async (req) => {
    admin(req);
    const keys = equityKeys(ctx);
    if (!keys.eodhd) throw badRequest('EODHD is not configured: set EODHD_API_TOKEN in .env.local and restart ATLAS.');
    const rt = equityRuntime(ctx);
    const r = await checkProviderUsage(db, fetchFn, keys.eodhd, rt.policies.eodhd, now());
    return { ...r, quota: await quotaStatus(db, rt.policies.eodhd, now()) };
  });

  app.post('/admin/v1/equity/calendar', async (req) => {
    admin(req);
    const b = parse(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), kind: z.enum(['holiday', 'special_session']), description: z.string().trim().min(3).max(200) }), req.body);
    await db.query(`INSERT INTO equity.calendar_days (exchange, day, kind, description, source, retrieved_at) VALUES ('NSE',$1,$2,$3,'user',$4)
      ON CONFLICT (exchange, day, source) DO UPDATE SET kind=EXCLUDED.kind, description=EXCLUDED.description, retrieved_at=EXCLUDED.retrieved_at`, [b.day, b.kind, b.description, now().toISOString()]);
    return { ok: true };
  });

  app.delete('/admin/v1/equity/calendar/:day', async (req) => {
    admin(req);
    const p = parse(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), req.params);
    // Only entries you added; provider and inferred entries are managed by ATLAS.
    const r = await db.query(`DELETE FROM equity.calendar_days WHERE exchange='NSE' AND day=$1 AND source='user' RETURNING 1`, [p.day]);
    if (!r.length) throw notFound('No calendar entry of yours on that day.');
    return { ok: true };
  });
}
