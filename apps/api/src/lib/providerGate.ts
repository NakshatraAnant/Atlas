import type { Db } from '../db/db.js';

// Durable, provider-specific request gate (docs/ATLAS_PROVIDER_QUOTA_AND_RECOVERY.md).
//
// Every provider request asks `admit` first and reports its outcome with `record`. State lives in
// ops.provider_state, so a pause survives restarts. Rules:
//   • 429: pause until Retry-After, or exponential backoff (1, 5, 15, 60 min) when none is given;
//   • quota exhausted: pause until the provider's documented reset when known, otherwise recheck hourly
//     (the reset time is then shown as unknown, never guessed);
//   • 401/403: credential or entitlement problem: one recheck a day, never a retry loop;
//   • 5xx, timeout, network, malformed: backoff 1, 5, 15, 60 min; "degraded" after 3 in a row;
//   • after a pause, exactly one request is admitted as a health check ("recovering"); others wait
//     60 s, so recovery never becomes a request storm; a success restores normal scheduling.

export type FailureCategory = 'rate_limited' | 'quota_exhausted' | 'auth' | 'server' | 'timeout' | 'network' | 'malformed' | 'not_found';

export interface ProviderDefinition { provider_id: string; plan_note: string; reset_rule: string | null }

export const PROVIDERS: ProviderDefinition[] = [
  { provider_id: 'fred', plan_note: 'FRED API with your key: 120 requests per minute (documented). No daily cap documented.', reset_rule: null },
  { provider_id: 'fred_csv', plan_note: 'FRED public CSV download (no key), used for commodity series when FRED_API_KEY is not set. No published rate limit; ATLAS sends one request at a time with a pause.', reset_rule: null },
  { provider_id: 'eia', plan_note: 'EIA API v2 with your key: hourly and daily request limits apply per key (EIA documents a limit without a fixed number; a 429 pauses requests). 5,000 rows per JSON response.', reset_rule: null },
  { provider_id: 'coingecko', plan_note: 'CoinGecko Demo plan: 100 calls per minute, 10,000 calls per month, 1 year of daily history, attribution required, no commercial licence (verified 23 Oct 2026). Usage is counted locally; the usage endpoint is for paid plans only.', reset_rule: 'Monthly credits; CoinGecko does not state the reset day for Demo keys. ATLAS paces usage per calendar month (UTC).' },
  { provider_id: 'eodhd', plan_note: 'EODHD free plan: 20 API calls per day, 20 requests per minute (documented); provider-reported usage via /api/user.', reset_rule: 'Midnight GMT (documented).' },
  { provider_id: 'data_gov_in', plan_note: 'data.gov.in Open Government Data API with your own key. Rate limits are not documented; the shared sample key answered HTTP 429 on 23 Oct 2026.', reset_rule: null },
];

const BACKOFF_MIN = [1, 5, 15, 60];
const minutes = (n: number) => n * 60_000;

export interface Admission { allowed: boolean; reason: string | null; next_eligible_at: string | null; recovering?: boolean }

export async function syncProviderState(db: Db, configured: Record<string, boolean>): Promise<void> {
  for (const p of PROVIDERS) {
    const on = !!configured[p.provider_id];
    await db.query(`INSERT INTO ops.provider_state (provider_id, configured, status, plan_note, reset_rule) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (provider_id) DO UPDATE SET configured=EXCLUDED.configured, plan_note=EXCLUDED.plan_note, reset_rule=EXCLUDED.reset_rule,
        status=CASE WHEN NOT EXCLUDED.configured THEN 'unconfigured'
                    WHEN ops.provider_state.status='unconfigured' THEN 'unknown'
                    -- A credential error is re-checked after a restart (the usual way a key is changed).
                    WHEN ops.provider_state.last_failure_category='auth' THEN 'recovering' ELSE ops.provider_state.status END,
        next_eligible_at=CASE WHEN ops.provider_state.last_failure_category='auth' AND EXCLUDED.configured THEN NULL ELSE ops.provider_state.next_eligible_at END,
        updated_at=now()`,
      [p.provider_id, on, on ? 'unknown' : 'unconfigured', p.plan_note, p.reset_rule]);
  }
}

/** May a request to this provider be sent now? Atomic: only one caller is admitted as a recovery probe. */
export async function admit(db: Db, providerId: string, now: Date, endpoint = 'request', job?: string): Promise<Admission> {
  const s = await db.maybeOne<{ configured: boolean; status: string; next_eligible_at: string | null; paused_reason: string | null }>(`SELECT configured, status, next_eligible_at, paused_reason FROM ops.provider_state WHERE provider_id=$1`, [providerId]);
  if (!s) return { allowed: true, reason: null, next_eligible_at: null };
  if (!s.configured) return { allowed: false, reason: 'not configured', next_eligible_at: null };
  if (s.next_eligible_at && Date.parse(s.next_eligible_at) > now.getTime()) {
    await db.query(`UPDATE ops.provider_state SET skipped_while_paused=skipped_while_paused+1 WHERE provider_id=$1`, [providerId]);
    await logRequest(db, providerId, now, { endpoint, job, outcome: 'skipped_paused', cost: 0 });
    return { allowed: false, reason: s.paused_reason ?? s.status, next_eligible_at: s.next_eligible_at };
  }
  if (['rate_limited', 'quota_exhausted', 'unavailable', 'degraded', 'recovering'].includes(s.status) && s.next_eligible_at) {
    // The pause has ended: admit exactly one health-check request; hold everyone else for 60 s.
    const won = await db.query(`UPDATE ops.provider_state SET status='recovering', next_eligible_at=$2, paused_reason='recovery check in progress', updated_at=now()
      WHERE provider_id=$1 AND (next_eligible_at IS NULL OR next_eligible_at <= $3) RETURNING 1`, [providerId, new Date(now.getTime() + 60_000).toISOString(), now.toISOString()]);
    if (!won.length) return { allowed: false, reason: 'recovery check in progress', next_eligible_at: new Date(now.getTime() + 60_000).toISOString() };
    return { allowed: true, reason: null, next_eligible_at: null, recovering: true };
  }
  return { allowed: true, reason: null, next_eligible_at: null };
}

export interface Outcome { endpoint: string; job?: string; http_status?: number | null; ok: boolean; category?: FailureCategory; message?: string; retry_after_s?: number | null; reset_at?: Date | null; cost?: number; retry?: number }

/** Classifies an HTTP status into a failure category (provider-specific quota codes are passed by the adapter). */
export function categoryFor(status: number): FailureCategory {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status >= 500) return 'server';
  return 'malformed';
}

/** Parses a Retry-After header (seconds or HTTP date). */
export function retryAfterSeconds(v: string | null | undefined, now: Date): number | null {
  if (!v) return null;
  if (/^\d+$/.test(v.trim())) return Number(v.trim());
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.max(0, Math.round((t - now.getTime()) / 1000));
}

export async function record(db: Db, providerId: string, now: Date, o: Outcome): Promise<void> {
  const quotaEvent = o.category === 'quota_exhausted' || o.category === 'rate_limited';
  await logRequest(db, providerId, now, { endpoint: o.endpoint, job: o.job, http_status: o.http_status ?? null, outcome: o.ok ? 'ok' : 'error', category: o.category ?? null, cost: o.cost ?? 1, retry: o.retry ?? 0, quota_event: quotaEvent });
  if (o.ok) {
    await db.query(`UPDATE ops.provider_state SET status='operational', last_success_at=$2, consecutive_failures=0, next_eligible_at=NULL, paused_reason=NULL, updated_at=now() WHERE provider_id=$1`, [providerId, now.toISOString()]);
    return;
  }
  // A 404 is about one item, not the provider: it never pauses the provider.
  if (o.category === 'not_found') {
    await db.query(`UPDATE ops.provider_state SET last_failure_at=$2, last_failure_category='not_found', last_failure_message=$3, status=CASE WHEN status='recovering' THEN 'operational' ELSE status END, next_eligible_at=CASE WHEN status='recovering' THEN NULL ELSE next_eligible_at END, updated_at=now() WHERE provider_id=$1`, [providerId, now.toISOString(), (o.message ?? '').slice(0, 300)]);
    return;
  }
  const cur = await db.one<{ consecutive_failures: number }>(`SELECT consecutive_failures FROM ops.provider_state WHERE provider_id=$1`, [providerId]).catch(() => ({ consecutive_failures: 0 }));
  const n = cur.consecutive_failures + 1;
  let status: string;
  let until: Date;
  let reason: string;
  let resetAt: Date | null = null;
  if (o.category === 'quota_exhausted') {
    status = 'quota_exhausted';
    resetAt = o.reset_at ?? null;
    until = resetAt ?? new Date(now.getTime() + minutes(60));
    reason = resetAt ? `quota exhausted until the documented reset` : 'quota exhausted; reset time not published, rechecking hourly';
  } else if (o.category === 'rate_limited') {
    status = 'rate_limited';
    until = new Date(now.getTime() + (o.retry_after_s != null ? o.retry_after_s * 1000 : minutes(BACKOFF_MIN[Math.min(n - 1, BACKOFF_MIN.length - 1)]!)));
    reason = o.retry_after_s != null ? `rate limited; Retry-After ${o.retry_after_s} s` : 'rate limited; backing off';
  } else if (o.category === 'auth') {
    status = 'unavailable';
    until = new Date(now.getTime() + minutes(24 * 60));
    reason = 'the provider refused the credential or entitlement; rechecked once a day or after a restart';
  } else {
    status = n >= 3 ? 'degraded' : 'operational';
    until = new Date(now.getTime() + minutes(BACKOFF_MIN[Math.min(n - 1, BACKOFF_MIN.length - 1)]!));
    reason = `${o.category ?? 'error'}; backing off`;
  }
  await db.query(`UPDATE ops.provider_state SET status=$2, last_failure_at=$3, last_failure_category=$4, last_failure_message=$5, consecutive_failures=$6, next_eligible_at=$7, paused_reason=$8,
      reset_at=CASE WHEN $9::timestamptz IS NOT NULL THEN $9::timestamptz ELSE reset_at END, updated_at=now() WHERE provider_id=$1`,
    [providerId, status, now.toISOString(), o.category ?? 'server', (o.message ?? '').slice(0, 300), n, until.toISOString(), reason, resetAt?.toISOString() ?? null]);
}

export async function noteProviderUsage(db: Db, providerId: string, reported: Record<string, unknown> | null, remaining: number | null, confidence: 'provider_reported' | 'estimated' | 'unknown'): Promise<void> {
  await db.query(`UPDATE ops.provider_state SET provider_reported=$2, remaining=$3, usage_confidence=$4, updated_at=now() WHERE provider_id=$1`, [providerId, reported ? JSON.stringify(reported) : null, remaining, confidence]);
}

async function logRequest(db: Db, providerId: string, runTime: Date, r: { endpoint: string; job?: string; http_status?: number | null; outcome: 'ok' | 'error' | 'cached' | 'skipped_paused' | 'skipped_budget'; category?: string | null; cost: number; retry?: number; quota_event?: boolean }): Promise<void> {
  // Callers pass the time their run started; the log records when this request actually happened
  // (the later of the two, so injected test clocks still work).
  const now = new Date(Math.max(runTime.getTime(), Date.now()));
  await db.query(`INSERT INTO ops.provider_requests (provider_id, requested_at, endpoint, job, http_status, outcome, failure_category, retry, cost, quota_event) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [providerId, now.toISOString(), r.endpoint.slice(0, 60), r.job ?? null, r.http_status ?? null, r.outcome, r.category ?? null, r.retry ?? 0, r.cost, !!r.quota_event]);
}

export async function providerStates(db: Db) {
  return db.query(`SELECT provider_id, configured, status, plan_note, provider_reported, usage_confidence, remaining, reset_at, reset_rule, last_success_at, last_failure_at, last_failure_category, last_failure_message,
      consecutive_failures, next_eligible_at, paused_reason, skipped_while_paused, updated_at,
      (SELECT count(*)::int FROM ops.provider_requests r WHERE r.provider_id=s.provider_id AND r.requested_at > now() - interval '24 hours' AND r.outcome IN ('ok','error')) AS requests_24h,
      (SELECT count(*)::int FROM ops.provider_requests r WHERE r.provider_id=s.provider_id AND r.requested_at > now() - interval '24 hours' AND r.outcome='error') AS errors_24h
    FROM ops.provider_state s ORDER BY provider_id`);
}
