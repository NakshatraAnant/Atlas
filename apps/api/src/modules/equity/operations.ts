import type { Db } from '../../db/db.js';
import { importEquityPrices, type EquityKeys, type ImportSummary } from './ingest.js';
import { eodhdGet, EODHD_COSTS, EquityProviderError, parseEodhdDividends, parseEodhdExchangeDetails, parseEodhdSplits, parseEodhdUser, type EodhdEndpoint, type FetchFn, type ProviderAction } from './providers.js';
import { logRequest, markExhausted, Pacer, quotaDay, quotaStatus, recordProviderUsage, spend, type QuotaCategory, type QuotaPolicy } from './quota.js';

// Daily operation of the tracked Indian equity universe on a small call allowance:
//   1. ask the provider how much of today's allowance is used (free of charge);
//   2. work out the latest session that should have data (weekdays, minus holidays ATLAS has evidence for);
//   3. refresh due instruments in priority order, charging each call before it is sent;
//   4. spend the small validation budget on the exchange calendar and on splits/dividends;
//   5. record what happened, including what was deferred because the budget ran out.
// Nothing is retried in a loop: failures set a retry time on the instrument and the run moves on or stops.

export interface Policies { eodhd: QuotaPolicy; alphavantage: QuotaPolicy }

const IST_OFFSET_MS = 330 * 60_000;
/**
 * Earliest IST time at which a session's end-of-day data is expected from the provider. NSE closes at
 * 15:30 IST; EODHD does not document when Indian end-of-day files are complete, so ATLAS waits until
 * 20:00 IST before it expects that day's row (an assumption, stated in the runbook).
 */
export const EOD_READY_IST_MINUTES = 20 * 60;

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const isWeekend = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

export interface CalendarDay { day: string; kind: 'holiday' | 'special_session' | 'no_session_observed'; description: string | null; source: string }

export async function calendarFor(db: Db, exchange: 'NSE' | 'BSE', from: string, to: string): Promise<CalendarDay[]> {
  return db.query<CalendarDay>(`SELECT to_char(day, 'YYYY-MM-DD') AS day, kind, description, source FROM equity.calendar_days WHERE exchange=$1 AND day BETWEEN $2 AND $3 ORDER BY day`, [exchange, from, to]);
}

/** Is `day` expected to be a trading session? Weekdays are, unless ATLAS holds evidence of a holiday; a recorded special session overrides a weekend. */
export function isExpectedSession(day: string, cal: CalendarDay[]): boolean {
  const entries = cal.filter((c) => c.day === day);
  if (entries.some((c) => c.kind === 'special_session')) return true;
  if (entries.some((c) => c.kind === 'holiday' || c.kind === 'no_session_observed')) return false;
  return !isWeekend(day);
}

/** The latest session whose end-of-day data should exist by `now`. */
export function expectedLatestSession(now: Date, cal: CalendarDay[]): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  let day = ist.toISOString().slice(0, 10);
  if (ist.getUTCHours() * 60 + ist.getUTCMinutes() < EOD_READY_IST_MINUTES) day = addDays(day, -1);
  for (let i = 0; i < 15 && !isExpectedSession(day, cal); i++) day = addDays(day, -1);
  return day;
}

// ───────────── Universe ─────────────

export interface UniverseInput { exchange: 'NSE' | 'BSE' | 'INDEX'; symbol: string; kind?: 'equity' | 'index'; name?: string; provider_symbol?: string; priority?: number; note?: string }

/**
 * Starting suggestions: large NSE companies and the two headline indices. These are identifiers only (no
 * data); each mapping stays "unverified" until the provider answers for it. EODHD index codes are taken
 * from EODHD's index naming (CODE.INDX) and are confirmed or rejected by the first request.
 */
export const STARTER_UNIVERSE: UniverseInput[] = [
  { exchange: 'INDEX', symbol: 'NIFTY50', kind: 'index', name: 'NIFTY 50', provider_symbol: 'NSEI.INDX', priority: 1 },
  { exchange: 'INDEX', symbol: 'SENSEX', kind: 'index', name: 'S&P BSE SENSEX', provider_symbol: 'BSESN.INDX', priority: 1 },
  ...['RELIANCE', 'HDFCBANK', 'TCS', 'ICICIBANK', 'INFY', 'BHARTIARTL', 'SBIN', 'ITC', 'LT', 'HINDUNILVR'].map((symbol) => ({ exchange: 'NSE' as const, symbol, priority: 2 })),
];

export function providerFor(exchange: string): 'eodhd' | 'alphavantage' {
  return exchange === 'BSE' ? 'alphavantage' : 'eodhd';
}

export async function addToUniverse(db: Db, input: UniverseInput, userId: string | null): Promise<{ instrument_id: string; provider_symbol: string; created: boolean }> {
  const symbol = input.symbol.trim().toUpperCase();
  if (!/^[A-Z0-9&_.-]{1,30}$/.test(symbol)) throw new EquityProviderError('eodhd', 'not_found', 'Invalid symbol.');
  const kind = input.kind ?? (input.exchange === 'INDEX' ? 'index' : 'equity');
  const provider = providerFor(input.exchange);
  let providerSymbol = input.provider_symbol?.trim();
  if (!providerSymbol) {
    if (input.exchange === 'NSE') providerSymbol = `${symbol}.NSE`;
    else if (input.exchange === 'BSE') providerSymbol = `${symbol}.BSE`;
    else throw new EquityProviderError(provider, 'not_found', 'Indices need the provider code (for EODHD, e.g. NSEI.INDX).');
  }
  if (!/^[A-Za-z0-9&_.^-]{1,40}$/.test(providerSymbol)) throw new EquityProviderError(provider, 'not_found', 'Invalid provider symbol.');
  return db.tx(async (t) => {
    const inst = await t.one<{ instrument_id: string }>(`INSERT INTO equity.instruments (kind, exchange, symbol, name) VALUES ($1,$2,$3,$4)
      ON CONFLICT (exchange, symbol) DO UPDATE SET name=coalesce(equity.instruments.name, EXCLUDED.name) RETURNING instrument_id`, [kind, input.exchange, symbol, input.name ?? null]);
    const mapped = await t.maybeOne<{ instrument_id: string }>(`SELECT instrument_id FROM equity.provider_symbols WHERE provider_id=$1 AND provider_symbol=$2`, [provider, providerSymbol]);
    if (mapped && mapped.instrument_id !== inst.instrument_id) throw new EquityProviderError(provider, 'not_found', `${providerSymbol} is already mapped to another instrument.`);
    if (!mapped) await t.query(`INSERT INTO equity.provider_symbols (provider_id, provider_symbol, instrument_id, verification) VALUES ($1,$2,$3,'unverified')`, [provider, providerSymbol, inst.instrument_id]);
    const existing = await t.maybeOne<{ enabled: boolean }>(`SELECT enabled FROM equity.universe WHERE instrument_id=$1`, [inst.instrument_id]);
    await t.query(`INSERT INTO equity.universe (instrument_id, provider_id, provider_symbol, priority, note, added_by) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (instrument_id) DO UPDATE SET enabled=true, priority=EXCLUDED.priority, provider_symbol=EXCLUDED.provider_symbol, retry_after=NULL, last_error=NULL, last_error_category=NULL, note=coalesce(EXCLUDED.note, equity.universe.note), updated_at=now()`,
      [inst.instrument_id, provider, providerSymbol, input.priority ?? 3, input.note ?? null, userId]);
    return { instrument_id: inst.instrument_id, provider_symbol: providerSymbol!, created: !existing };
  });
}

export async function updateUniverse(db: Db, exchange: string, symbol: string, patch: { priority?: number; enabled?: boolean; note?: string | null }): Promise<boolean> {
  const r = await db.query(`UPDATE equity.universe u SET priority=coalesce($3, u.priority), enabled=coalesce($4, u.enabled), note=CASE WHEN $5::boolean THEN $6 ELSE u.note END,
      retry_after=CASE WHEN $4 IS TRUE THEN NULL ELSE u.retry_after END, updated_at=now()
    FROM equity.instruments i WHERE i.instrument_id=u.instrument_id AND i.exchange=$1 AND i.symbol=$2 RETURNING 1`,
    [exchange, symbol, patch.priority ?? null, patch.enabled ?? null, patch.note !== undefined, patch.note ?? null]);
  return r.length > 0;
}

export interface UniverseItem {
  exchange: string; symbol: string; name: string | null; kind: string; provider_id: string; provider_symbol: string; verification: string | null;
  priority: number; enabled: boolean; note: string | null; added_at: string;
  last_date: string | null; observations: number; last_attempt_at: string | null; last_success_at: string | null; last_error: string | null; last_error_category: string | null; retry_after: string | null;
  state: 'disabled' | 'awaiting_first_import' | 'up_to_date' | 'due' | 'waiting_retry';
}

export async function listUniverse(db: Db, now: Date, expected: string): Promise<UniverseItem[]> {
  const rows = await db.query<Omit<UniverseItem, 'state'>>(
    `SELECT i.exchange, i.symbol, i.name, i.kind, u.provider_id, u.provider_symbol, ps.verification, u.priority, u.enabled, u.note, u.added_at,
            to_char(s.last_date, 'YYYY-MM-DD') AS last_date, coalesce(s.observations, 0) AS observations, u.last_attempt_at, u.last_success_at, u.last_error, u.last_error_category, u.retry_after
       FROM equity.universe u JOIN equity.instruments i USING (instrument_id)
       LEFT JOIN equity.provider_symbols ps ON ps.provider_id=u.provider_id AND ps.provider_symbol=u.provider_symbol
       LEFT JOIN equity.price_series s ON s.instrument_id=u.instrument_id AND s.provider_id=u.provider_id AND s.basis='raw'
      ORDER BY u.enabled DESC, u.priority, i.exchange, i.symbol`);
  return rows.map((r) => ({
    ...r,
    state: !r.enabled ? 'disabled' : r.retry_after && Date.parse(r.retry_after) > now.getTime() ? 'waiting_retry' : !r.last_date ? 'awaiting_first_import' : r.last_date >= expected ? 'up_to_date' : 'due',
  }));
}

// ───────────── Provider calls outside price imports ─────────────

type CallResult<T> = { ok: true; value: T } | { ok: false; error: EquityProviderError | null; refused?: 'budget' | 'daily_limit' | 'exhausted' };

/** One charged EODHD call: budget first, then pace, then the request, then the log. */
async function eodhdCall<T>(db: Db, fetchFn: FetchFn, token: string, policy: QuotaPolicy, pacer: Pacer | undefined, category: Exclude<QuotaCategory, 'reserve'>, endpoint: EodhdEndpoint, target: string, params: Record<string, string | undefined>, parse: (status: number, body: string) => T, now: Date): Promise<CallResult<T>> {
  const cost = EODHD_COSTS[endpoint];
  const s = await spend(db, policy, category, cost, now);
  if (!s.ok) {
    await logRequest(db, now, { provider_id: 'eodhd', category, endpoint, target, cost: 0, outcome: 'not_sent_budget', error_category: 'quota_exhausted' });
    return { ok: false, error: null, refused: s.reason };
  }
  await pacer?.wait();
  let status: number | null = null;
  try {
    const r = await eodhdGet(fetchFn, token, endpoint, target, params);
    status = r.status;
    const value = parse(r.status, r.body);
    await logRequest(db, now, { provider_id: 'eodhd', category: endpoint === 'user' ? 'usage_check' : category, endpoint, target, cost, outcome: 'ok', http_status: status });
    return { ok: true, value };
  } catch (err) {
    const e = err instanceof EquityProviderError ? err : new EquityProviderError('eodhd', 'provider_error', (err as Error).message);
    await logRequest(db, now, { provider_id: 'eodhd', category: endpoint === 'user' ? 'usage_check' : category, endpoint, target, cost, outcome: 'error', http_status: status, error_category: e.category });
    if (e.category === 'quota_exhausted') await markExhausted(db, 'eodhd', now, e.message);
    if (e.category === 'auth') await db.query(`UPDATE equity.providers SET health='not_entitled', last_error_at=$1, last_error=$2, last_error_category='auth' WHERE provider_id='eodhd'`, [now.toISOString(), e.message]);
    return { ok: false, error: e };
  }
}

/** Provider-reported usage (EODHD /api/user costs 0 calls). */
export async function checkProviderUsage(db: Db, fetchFn: FetchFn, token: string, policy: QuotaPolicy, now: Date): Promise<{ ok: boolean; applied?: boolean; error?: string }> {
  const r = await eodhdCall(db, fetchFn, token, policy, undefined, 'validation', 'user', '', {}, parseEodhdUser, now);
  if (!r.ok) return { ok: false, error: r.error?.message ?? 'not sent' };
  const { applied } = await recordProviderUsage(db, 'eodhd', now, r.value);
  return { ok: true, applied };
}

export async function storeCorporateActions(db: Db, instrumentId: string, providerId: string, actions: ProviderAction[], now: Date): Promise<number> {
  let n = 0;
  for (const a of actions) {
    await db.query(`INSERT INTO equity.corporate_actions (instrument_id, provider_id, kind, ex_date, ratio, value, currency, raw, retrieved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (instrument_id, provider_id, kind, ex_date) DO UPDATE SET ratio=EXCLUDED.ratio, value=EXCLUDED.value, currency=EXCLUDED.currency, raw=EXCLUDED.raw, retrieved_at=EXCLUDED.retrieved_at`,
      [instrumentId, providerId, a.kind, a.ex_date, a.ratio, a.value, a.currency, JSON.stringify(a.raw), now.toISOString()]);
    n++;
  }
  return n;
}

/**
 * Does the provider's adjusted close agree with its own split record? Across a split's ex-date the
 * adjustment factor (adjusted close ÷ close) should change by the split ratio. Dividends move the factor
 * a little too, so agreement within 5% is accepted.
 */
export async function splitConsistency(db: Db, instrumentId: string): Promise<{ ex_date: string; ratio: string; expected_change: number; observed_change: number | null; consistent: boolean | null; note: string }[]> {
  const splits = await db.query<{ ex_date: string; ratio: string }>(`SELECT to_char(ex_date, 'YYYY-MM-DD') AS ex_date, ratio FROM equity.corporate_actions WHERE instrument_id=$1 AND kind='split' ORDER BY ex_date`, [instrumentId]);
  const out = [];
  for (const s of splits) {
    const [a, b] = s.ratio.split('/').map(Number) as [number, number];
    const expected = a / b;
    const pts = await db.query<{ trade_date: string; basis: string; close: number }>(
      `SELECT to_char(p.trade_date, 'YYYY-MM-DD') AS trade_date, ps.basis, p.close::float8 AS close FROM equity.prices p JOIN equity.price_series ps USING (series_id)
        WHERE ps.instrument_id=$1 AND ps.provider_id='eodhd' AND p.trade_date IN ((SELECT max(trade_date) FROM equity.prices p2 JOIN equity.price_series s2 USING (series_id) WHERE s2.instrument_id=$1 AND p2.trade_date < $2), (SELECT min(trade_date) FROM equity.prices p3 JOIN equity.price_series s3 USING (series_id) WHERE s3.instrument_id=$1 AND p3.trade_date >= $2))`,
      [instrumentId, s.ex_date]);
    const factor = (when: 'before' | 'after') => {
      const days = [...new Set(pts.map((p) => p.trade_date))].sort();
      const d = when === 'before' ? days.find((x) => x < s.ex_date) : days.find((x) => x >= s.ex_date);
      const raw = pts.find((p) => p.trade_date === d && p.basis === 'raw');
      const adj = pts.find((p) => p.trade_date === d && p.basis === 'adjusted_split_dividend');
      return raw && adj ? adj.close / raw.close : null;
    };
    const fb = factor('before');
    const fa = factor('after');
    if (fb === null || fa === null) { out.push({ ex_date: s.ex_date, ratio: s.ratio, expected_change: expected, observed_change: null, consistent: null, note: 'Stored prices do not span this split.' }); continue; }
    const observed = fa / fb;
    const ok = Math.abs(observed / expected - 1) <= 0.05;
    out.push({ ex_date: s.ex_date, ratio: s.ratio, expected_change: expected, observed_change: observed, consistent: ok, note: ok ? 'The adjusted series reflects this split.' : 'The adjusted series does not change by the split ratio across the ex-date: check before relying on adjusted returns here.' });
  }
  return out;
}

/**
 * Infers days that were not sessions from stored data: a weekday on which at least three tracked series,
 * each with observations on both sides, have no row. Recorded as "no_session_observed" with the evidence;
 * a later observation on that day removes the inference.
 */
export async function inferNoSessionDays(db: Db, now: Date, lookbackDays = 60): Promise<number> {
  const to = quotaDay(now);
  const from = addDays(to, -lookbackDays);
  await db.query(`DELETE FROM equity.calendar_days c WHERE c.source='inferred_from_data' AND EXISTS (
      SELECT 1 FROM equity.prices p JOIN equity.price_series s USING (series_id) JOIN equity.instruments i USING (instrument_id) WHERE p.trade_date=c.day AND s.basis='raw' AND i.exchange IN ('NSE','INDEX'))`);
  const series = await db.query<{ series_id: string; dates: string[] }>(
    `SELECT s.series_id, array_agg(to_char(p.trade_date, 'YYYY-MM-DD') ORDER BY p.trade_date) AS dates FROM equity.price_series s JOIN equity.instruments i USING (instrument_id) JOIN equity.prices p USING (series_id)
      WHERE s.basis='raw' AND i.exchange IN ('NSE','INDEX') AND p.trade_date BETWEEN $1 AND $2 GROUP BY s.series_id`, [from, to]);
  if (series.length < 3) return 0;
  const sets = series.map((s) => ({ first: s.dates[0]!, last: s.dates[s.dates.length - 1]!, has: new Set(s.dates) }));
  let n = 0;
  for (let d = addDays(from, 1); d < to; d = addDays(d, 1)) {
    if (isWeekend(d)) continue;
    const spanning = sets.filter((s) => s.first < d && s.last > d);
    if (spanning.length < 3 || spanning.some((s) => s.has.has(d))) continue;
    await db.query(`INSERT INTO equity.calendar_days (exchange, day, kind, description, source, evidence, retrieved_at) VALUES ('NSE',$1,'no_session_observed',$2,'inferred_from_data',$3,$4)
      ON CONFLICT (exchange, day, source) DO UPDATE SET evidence=EXCLUDED.evidence, retrieved_at=EXCLUDED.retrieved_at`,
      [d, `No row on this weekday in any of ${spanning.length} tracked series that have data before and after it.`, JSON.stringify({ series: spanning.length }), now.toISOString()]);
    n++;
  }
  return n;
}

// ───────────── The refresh run ─────────────

export interface RefreshOptions { trigger: 'schedule' | 'manual'; requestedBy?: string | null; policies: Policies; pacer?: Pacer; validation?: boolean }

export interface RefreshResult { run_id: string; status: string; expected_session: string; attempted: number; succeeded: number; failed: number; up_to_date: number; deferred_budget: number; calls_spent: number; stop_reason: string | null; items: { instrument: string; outcome: string; detail: string | null }[] }

const RETRY_AFTER_HOURS: Record<string, number> = { entitlement: 24 * 7, not_found: 24 * 7, malformed: 24, network: 6, timeout: 6, provider_error: 6 };

export async function runEquityRefresh(db: Db, fetchFn: FetchFn, keys: EquityKeys, now: Date, opts: RefreshOptions): Promise<RefreshResult> {
  const cal = await calendarFor(db, 'NSE', addDays(quotaDay(now), -30), addDays(quotaDay(now), 1));
  const expected = expectedLatestSession(now, cal);
  const { run_id } = await db.one<{ run_id: string }>(`INSERT INTO equity.refresh_runs (trigger, requested_by, started_at, expected_session, status) VALUES ($1,$2,$3,$4,'running') RETURNING run_id`, [opts.trigger, opts.requestedBy ?? null, now.toISOString(), expected]);
  const res: RefreshResult = { run_id, status: 'succeeded', expected_session: expected, attempted: 0, succeeded: 0, failed: 0, up_to_date: 0, deferred_budget: 0, calls_spent: 0, stop_reason: null, items: [] };
  const before = { eodhd: (await quotaStatus(db, opts.policies.eodhd, now)).spent_local, alphavantage: (await quotaStatus(db, opts.policies.alphavantage, now)).spent_local };
  const finish = async () => {
    const after = { eodhd: (await quotaStatus(db, opts.policies.eodhd, now)).spent_local, alphavantage: (await quotaStatus(db, opts.policies.alphavantage, now)).spent_local };
    res.calls_spent = after.eodhd - before.eodhd + after.alphavantage - before.alphavantage;
    await db.query(`UPDATE equity.refresh_runs SET finished_at=$2, status=$3, attempted=$4, succeeded=$5, failed=$6, up_to_date=$7, deferred_budget=$8, calls_spent=$9, stop_reason=$10, detail=$11 WHERE run_id=$1`,
      [run_id, new Date().toISOString(), res.status, res.attempted, res.succeeded, res.failed, res.up_to_date, res.deferred_budget, res.calls_spent, res.stop_reason, JSON.stringify({ items: res.items.slice(0, 50) })]);
    return res;
  };
  if (!keys.eodhd && !keys.alphavantage) { res.status = 'skipped'; res.stop_reason = 'No provider key is configured (EODHD_API_TOKEN in .env.local).'; return finish(); }

  const providers = await db.query<{ provider_id: string; health: string; last_error_category: string | null }>(`SELECT provider_id, health, last_error_category FROM equity.providers`);
  const circuitOpen = (p: string) => providers.find((x) => x.provider_id === p)?.last_error_category === 'auth';
  if (keys.eodhd && !circuitOpen('eodhd')) {
    const u = await checkProviderUsage(db, fetchFn, keys.eodhd, opts.policies.eodhd, now);
    if (!u.ok && /401/.test(u.error ?? '')) { res.status = 'failed'; res.stop_reason = 'EODHD rejected the API token; no further calls until the key is fixed and ATLAS restarted.'; return finish(); }
  }

  const items = (await listUniverse(db, now, expected)).filter((i) => i.state === 'due' || i.state === 'awaiting_first_import');
  const recentlyTried = (i: UniverseItem) => i.last_attempt_at && now.getTime() - Date.parse(i.last_attempt_at) < 6 * 3_600_000 && i.last_date !== null;
  res.up_to_date = (await listUniverse(db, now, expected)).filter((i) => i.state === 'up_to_date').length;
  const stopped = new Set<string>();
  for (const it of items) {
    const label = `${it.exchange}:${it.symbol}`;
    const pid = it.provider_id as 'eodhd' | 'alphavantage';
    if (!keys[pid]) { res.items.push({ instrument: label, outcome: 'not_configured', detail: null }); continue; }
    if (circuitOpen(pid) || stopped.has(pid)) { res.items.push({ instrument: label, outcome: 'skipped', detail: 'provider stopped for this run' }); continue; }
    // Provider has not published the expected session yet when we last asked: wait, do not spend another call.
    if (recentlyTried(it)) { res.items.push({ instrument: label, outcome: 'waiting', detail: 'asked within the last 6 hours; provider had no newer session' }); continue; }
    const category = it.last_date ? 'refresh' : 'backfill';
    res.attempted++;
    const sum: ImportSummary = await importEquityPrices(db, fetchFn, keys, { provider: pid, exchange: it.exchange as 'NSE', symbol: it.symbol, kind: it.kind as 'equity', providerSymbol: it.provider_symbol, from: it.last_date ?? undefined }, now,
      { policy: opts.policies[pid], category, pacer: opts.pacer });
    if (sum.quota_refusal) {
      res.attempted--;
      res.deferred_budget++;
      res.items.push({ instrument: label, outcome: 'deferred_budget', detail: sum.error });
      if (sum.quota_refusal !== 'budget') stopped.add(pid);
      continue;
    }
    const ok = sum.status !== 'failed';
    const retryH = ok ? null : RETRY_AFTER_HOURS[sum.error_category ?? ''] ?? null;
    await db.query(`UPDATE equity.universe u SET last_attempt_at=$2, last_success_at=CASE WHEN $3 THEN $2 ELSE u.last_success_at END, last_error=$4, last_error_category=$5, retry_after=$6, updated_at=now()
      FROM equity.instruments i WHERE i.instrument_id=u.instrument_id AND i.exchange=$1 AND i.symbol=$7`,
      [it.exchange, now.toISOString(), ok, ok ? null : sum.error, ok ? null : sum.error_category, retryH ? new Date(now.getTime() + retryH * 3_600_000).toISOString() : null, it.symbol]);
    if (!ok && ['entitlement', 'not_found'].includes(sum.error_category ?? '')) await db.query(`UPDATE equity.provider_symbols SET verification='failed', last_checked_at=$3, last_check_error=$4 WHERE provider_id=$1 AND provider_symbol=$2 AND verification <> 'verified'`, [pid, it.provider_symbol, now.toISOString(), sum.error]);
    if (ok) res.succeeded++; else res.failed++;
    res.items.push({ instrument: label, outcome: ok ? (sum.stored || sum.corrected ? 'updated' : 'no_new_rows') : 'failed', detail: ok ? `${sum.stored} new, ${sum.corrected} corrected, ${sum.unchanged} unchanged` : sum.error });
    if (['auth', 'rate_limited', 'quota_exhausted'].includes(sum.error_category ?? '')) { stopped.add(pid); res.stop_reason = sum.error; }
  }
  await inferNoSessionDays(db, now);
  if (opts.validation !== false && keys.eodhd && !circuitOpen('eodhd') && !stopped.has('eodhd')) await runValidation(db, fetchFn, keys.eodhd, now, opts);
  res.status = res.failed && res.succeeded ? 'partial' : res.failed && !res.succeeded ? 'failed' : res.attempted === 0 && res.deferred_budget === 0 ? 'skipped' : res.deferred_budget && !res.succeeded ? 'partial' : 'succeeded';
  if (!res.stop_reason && res.deferred_budget) res.stop_reason = `${res.deferred_budget} instrument(s) deferred: today’s budget is spent. They are next in line after the reset.`;
  if (!res.stop_reason && res.attempted === 0) res.stop_reason = 'Nothing was due: every tracked instrument has the latest expected session, is waiting to retry, or was asked recently.';
  return finish();
}

/**
 * Validation budget: the exchange calendar (once a year, unless the plan refuses it; a refusal is not
 * retried for 30 days), then one instrument's splits and dividends per day, oldest-checked first.
 */
async function runValidation(db: Db, fetchFn: FetchFn, token: string, now: Date, opts: RefreshOptions): Promise<void> {
  const policy = opts.policies.eodhd;
  const year = now.toISOString().slice(0, 4);
  const haveCal = await db.maybeOne(`SELECT 1 FROM equity.calendar_days WHERE source='eodhd_exchange_details' AND to_char(day, 'YYYY')=$1 LIMIT 1`, [year]);
  const refused = await db.maybeOne(`SELECT 1 FROM equity.provider_requests WHERE provider_id='eodhd' AND endpoint='exchange_details' AND requested_at > $1 AND (outcome='error' OR outcome='ok') LIMIT 1`, [new Date(now.getTime() - 30 * 86_400_000).toISOString()]);
  if (!haveCal && !refused) {
    const r = await eodhdCall(db, fetchFn, token, policy, opts.pacer, 'validation', 'exchange_details', 'NSE', { from: `${year}-01-01`, to: `${year}-12-31` }, parseEodhdExchangeDetails, now);
    if (r.ok) for (const h of r.value.holidays) {
      await db.query(`INSERT INTO equity.calendar_days (exchange, day, kind, description, source, evidence, retrieved_at) VALUES ('NSE',$1,'holiday',$2,'eodhd_exchange_details',$3,$4)
        ON CONFLICT (exchange, day, source) DO UPDATE SET description=EXCLUDED.description, evidence=EXCLUDED.evidence, retrieved_at=EXCLUDED.retrieved_at`, [h.date, h.name, JSON.stringify({ type: h.type }), now.toISOString()]);
    }
    if (!r.ok) return;
  }
  const next = await db.maybeOne<{ instrument_id: string; provider_symbol: string }>(
    `SELECT u.instrument_id, u.provider_symbol FROM equity.universe u JOIN equity.price_series s ON s.instrument_id=u.instrument_id AND s.provider_id='eodhd' AND s.basis='raw'
       LEFT JOIN LATERAL (SELECT max(retrieved_at) AS checked FROM equity.corporate_actions c WHERE c.instrument_id=u.instrument_id) c ON true
       LEFT JOIN LATERAL (SELECT max(requested_at) AS asked FROM equity.provider_requests r WHERE r.provider_id='eodhd' AND r.endpoint IN ('splits','dividends') AND r.target=u.provider_symbol) r ON true
      WHERE u.enabled AND u.provider_id='eodhd' AND (r.asked IS NULL OR r.asked < $1)
      ORDER BY greatest(c.checked, r.asked) NULLS FIRST, u.priority LIMIT 1`, [new Date(now.getTime() - 7 * 86_400_000).toISOString()]);
  if (!next) return;
  const from = addDays(quotaDay(now), -366);
  for (const [endpoint, parse] of [['splits', parseEodhdSplits], ['dividends', parseEodhdDividends]] as const) {
    const r = await eodhdCall(db, fetchFn, token, policy, opts.pacer, 'validation', endpoint, next.provider_symbol, { from }, parse, now);
    if (!r.ok) return;
    await storeCorporateActions(db, next.instrument_id, 'eodhd', r.value, now);
  }
}

export function defaultPolicies(cfg: { EODHD_DAILY_LIMIT: number; eodhdBudgets: Record<QuotaCategory, number> }, policyFor: (limit: number, b: Record<QuotaCategory, number>) => QuotaPolicy, av: QuotaPolicy): Policies {
  return { eodhd: policyFor(cfg.EODHD_DAILY_LIMIT, cfg.eodhdBudgets), alphavantage: av };
}
