import type { Db } from '../../db/db.js';
import { admit, categoryFor, record, retryAfterSeconds, type FailureCategory } from '../../lib/providerGate.js';
import type { FetchFn } from '../equity/providers.js';

// Official FRED API client (https://fred.stlouisfed.org/docs/api/fred/), used by Macro and Commodities.
// Every request passes the durable provider gate; the key is sent only to api.stlouisfed.org and never
// logged. Observations carry FRED's realtime_start (the vintage date from which FRED shows the value),
// used as the publication-date proxy; "." means no observation and is never stored as a number.

export class FredError extends Error {
  constructor(readonly category: FailureCategory | 'not_configured' | 'paused', message: string) {
    super(message);
  }
}

export interface FredMeta { id: string; title: string; units: string; frequency: string; seasonal_adjustment: string; last_updated: string; observation_start: string; observation_end: string; notes: string | null }
export interface FredObs { date: string; value: number | null; realtime_start: string }

const BASE = 'https://api.stlouisfed.org/fred';
const redactKey = (s: string) => s.replace(/api_key=[^&\s]+/g, 'api_key=REDACTED');

async function call(db: Db, fetchFn: FetchFn, key: string, path: string, params: Record<string, string>, now: Date, job: string): Promise<any> {
  if (!key) throw new FredError('not_configured', 'FRED is not configured: set FRED_API_KEY in .env.local.');
  const a = await admit(db, 'fred', now, path, job);
  if (!a.allowed) throw new FredError('paused', `FRED requests are paused (${a.reason}); next attempt after ${a.next_eligible_at ?? 'configuration'}.`);
  const q = new URLSearchParams({ ...params, api_key: key, file_type: 'json' }).toString();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  let status = 0;
  try {
    const r = await fetchFn(`${BASE}/${path}?${q}`, { signal: ctrl.signal, headers: { accept: 'application/json', 'user-agent': 'ATLAS-local-research/0.1' } });
    status = r.status;
    const body = await r.text();
    const retryAfter = retryAfterSeconds((r as { headers?: { get(n: string): string | null } }).headers?.get?.('retry-after'), now);
    let json: any;
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }
    if (status >= 400) {
      // FRED answers an unknown series with HTTP 400 "The series does not exist."
      const msg = String(json?.error_message ?? `HTTP ${status}`);
      const cat: FailureCategory = status === 400 && /does not exist/i.test(msg) ? 'not_found' : status === 429 ? 'rate_limited' : categoryFor(status);
      await record(db, 'fred', now, { endpoint: path, job, http_status: status, ok: false, category: cat, message: msg, retry_after_s: retryAfter });
      throw new FredError(cat, `FRED: ${msg.slice(0, 200)}`);
    }
    if (!json) {
      await record(db, 'fred', now, { endpoint: path, job, http_status: status, ok: false, category: 'malformed', message: 'not JSON' });
      throw new FredError('malformed', 'FRED returned a response that is not JSON.');
    }
    await record(db, 'fred', now, { endpoint: path, job, http_status: status, ok: true });
    return json;
  } catch (err) {
    if (err instanceof FredError) throw err;
    const timeout = (err as Error).name === 'AbortError';
    await record(db, 'fred', now, { endpoint: path, job, http_status: status || null, ok: false, category: timeout ? 'timeout' : 'network', message: redactKey((err as Error).message) });
    throw new FredError(timeout ? 'timeout' : 'network', timeout ? 'FRED did not answer in time.' : `Network error: ${redactKey((err as Error).message)}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function fredSeriesMeta(db: Db, fetchFn: FetchFn, key: string, id: string, now: Date, job = 'meta'): Promise<FredMeta> {
  const j = await call(db, fetchFn, key, 'series', { series_id: id }, now, job);
  const s = j?.seriess?.[0];
  if (!s || s.id !== id) throw new FredError('malformed', `FRED metadata for ${id} is missing.`);
  return { id: s.id, title: String(s.title), units: String(s.units), frequency: String(s.frequency), seasonal_adjustment: String(s.seasonal_adjustment ?? ''), last_updated: String(s.last_updated), observation_start: s.observation_start, observation_end: s.observation_end, notes: s.notes ? String(s.notes).slice(0, 2000) : null };
}

export function parseFredObservations(json: any): FredObs[] {
  const obs = json?.observations;
  if (!Array.isArray(obs)) throw new FredError('malformed', 'FRED observations response has no observations array.');
  const out: FredObs[] = [];
  for (const o of obs) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(o?.date))) continue;
    const v = o.value === '.' || o.value === '' || o.value == null ? null : Number(o.value);
    out.push({ date: o.date, value: v !== null && Number.isFinite(v) ? v : null, realtime_start: String(o.realtime_start ?? '') });
  }
  return out;
}

/** Observations (all, or from `start`); FRED returns up to 100,000 per request, ascending. */
export async function fredObservations(db: Db, fetchFn: FetchFn, key: string, id: string, now: Date, start?: string, job = 'observations'): Promise<FredObs[]> {
  const j = await call(db, fetchFn, key, 'series/observations', { series_id: id, ...(start ? { observation_start: start } : {}), sort_order: 'asc' }, now, job);
  return parseFredObservations(j);
}
