import type { Db } from '../../db/db.js';

// Persistent daily quota ledger for equity providers on free plans. Every call is charged *before* it is
// sent, against a purpose budget (refresh, backfill, validation, manual) and the provider's daily limit,
// with a reserve that only an explicit manual request may use. The charge is one conditional UPDATE, so
// concurrent jobs cannot overspend. Usage the provider reports (EODHD /api/user, free of charge) is
// recorded next to ATLAS's own count and the larger of the two is what remains.

export const QUOTA_CATEGORIES = ['refresh', 'backfill', 'validation', 'manual', 'reserve'] as const;
export type QuotaCategory = (typeof QUOTA_CATEGORIES)[number];

export interface QuotaPolicy {
  provider_id: 'eodhd' | 'alphavantage';
  daily_limit: number;
  budgets: Record<QuotaCategory, number>;
  /** Provider's reset time zone; quota days are dates in this zone. */
  reset_time_zone: 'UTC';
  reset_note: string;
  /** Minimum gap between two requests, from the provider's per-minute limit. */
  min_interval_ms: number;
}

export const DEFAULT_EODHD_BUDGETS: Record<QuotaCategory, number> = { refresh: 12, backfill: 2, validation: 2, manual: 2, reserve: 2 };

/** "refresh=12,backfill=2,…" → budgets. Every category must be present and the total must equal the limit. */
export function parseBudgets(spec: string, dailyLimit: number): Record<QuotaCategory, number> {
  const out: Partial<Record<QuotaCategory, number>> = {};
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^([a-z]+)=(\d{1,6})$/.exec(part);
    if (!m || !(QUOTA_CATEGORIES as readonly string[]).includes(m[1]!)) throw new Error(`Invalid quota budget "${part}" (expected e.g. refresh=12).`);
    out[m[1] as QuotaCategory] = Number(m[2]);
  }
  for (const c of QUOTA_CATEGORIES) if (out[c] === undefined) throw new Error(`Quota budget for "${c}" is missing.`);
  const total = QUOTA_CATEGORIES.reduce((s, c) => s + out[c]!, 0);
  if (total !== dailyLimit) throw new Error(`Quota budgets add up to ${total}, but the daily limit is ${dailyLimit}.`);
  return out as Record<QuotaCategory, number>;
}

export function eodhdPolicy(dailyLimit = 20, budgets: Record<QuotaCategory, number> = DEFAULT_EODHD_BUDGETS): QuotaPolicy {
  return { provider_id: 'eodhd', daily_limit: dailyLimit, budgets, reset_time_zone: 'UTC', reset_note: 'Midnight GMT, documented by EODHD (05:30 IST).', min_interval_ms: 3_100 };
}

/** Alpha Vantage free keys: 25 requests a day (documented). The reset time is not documented; UTC is assumed and labelled so. */
export const ALPHAVANTAGE_POLICY: QuotaPolicy = {
  provider_id: 'alphavantage', daily_limit: 25, budgets: { refresh: 15, backfill: 3, validation: 0, manual: 4, reserve: 3 },
  reset_time_zone: 'UTC', reset_note: 'Not documented by Alpha Vantage; ATLAS assumes midnight UTC.', min_interval_ms: 12_500,
};

export const quotaDay = (now: Date) => now.toISOString().slice(0, 10);
export function nextReset(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return d;
}

export type SpendResult = { ok: true; charged_to: QuotaCategory } | { ok: false; reason: 'budget' | 'daily_limit' | 'exhausted' };

const COL: Record<QuotaCategory, string> = { refresh: 'refresh', backfill: 'backfill', validation: 'validation', manual: 'manual', reserve: 'reserve' };
const TOTAL = '(refresh + backfill + validation + manual + reserve)';
/** Usage = the larger of ATLAS's count and (the provider's last figure + ATLAS's calls since that figure). */
const EFFECTIVE = `greatest(${TOTAL}, coalesce(provider_reported + ${TOTAL} - local_at_report, 0))`;

/**
 * Charges `cost` calls to `category` for the provider's current quota day, or refuses. A manual request
 * may fall back to the reserve when `useReserve` is set (an explicit choice by an administrator).
 */
export async function spend(db: Db, policy: QuotaPolicy, category: Exclude<QuotaCategory, 'reserve'>, cost: number, now: Date, opts: { useReserve?: boolean } = {}): Promise<SpendResult> {
  const day = quotaDay(now);
  if (cost === 0) return { ok: true, charged_to: category };
  await db.query(`INSERT INTO equity.quota_days (provider_id, usage_date) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [policy.provider_id, day]);
  const tryCol = async (cat: QuotaCategory) => {
    const col = COL[cat];
    const r = await db.query(
      `UPDATE equity.quota_days SET ${col} = ${col} + $3
        WHERE provider_id=$1 AND usage_date=$2 AND exhausted_at IS NULL AND ${col} + $3 <= $4
          AND ${EFFECTIVE} + $3 <= $5
        RETURNING 1`,
      [policy.provider_id, day, cost, policy.budgets[cat], policy.daily_limit]);
    return r.length > 0;
  };
  if (await tryCol(category)) return { ok: true, charged_to: category };
  if (category === 'manual' && opts.useReserve && (await tryCol('reserve'))) return { ok: true, charged_to: 'reserve' };
  const row = await db.one<{ effective: number; exhausted: boolean }>(`SELECT ${EFFECTIVE}::int AS effective, exhausted_at IS NOT NULL AS exhausted FROM equity.quota_days WHERE provider_id=$1 AND usage_date=$2`, [policy.provider_id, day]);
  if (row.exhausted) return { ok: false, reason: 'exhausted' };
  if (row.effective + cost > policy.daily_limit) return { ok: false, reason: 'daily_limit' };
  return { ok: false, reason: 'budget' };
}

/** The provider said the allowance is spent (EODHD HTTP 402): stop all calls until the next reset. */
export async function markExhausted(db: Db, providerId: string, now: Date, reason: string): Promise<void> {
  const day = quotaDay(now);
  await db.query(`INSERT INTO equity.quota_days (provider_id, usage_date, exhausted_at, exhausted_reason) VALUES ($1,$2,$3,$4)
    ON CONFLICT (provider_id, usage_date) DO UPDATE SET exhausted_at=coalesce(equity.quota_days.exhausted_at, EXCLUDED.exhausted_at), exhausted_reason=coalesce(equity.quota_days.exhausted_reason, EXCLUDED.exhausted_reason)`,
    [providerId, day, now.toISOString(), reason.slice(0, 300)]);
}

/**
 * Records the provider's own usage figure. A figure for an earlier date means nothing has been spent
 * since the provider's reset, so it is not applied to today.
 */
export async function recordProviderUsage(db: Db, providerId: string, now: Date, usage: { api_requests: number; api_requests_date: string; daily_limit: number }): Promise<{ applied: boolean }> {
  const day = quotaDay(now);
  if (usage.api_requests_date !== day) return { applied: false };
  await db.query(`INSERT INTO equity.quota_days (provider_id, usage_date, provider_reported, provider_reported_at, provider_daily_limit, local_at_report) VALUES ($1,$2,$3,$4,$5,0)
    ON CONFLICT (provider_id, usage_date) DO UPDATE SET provider_reported=EXCLUDED.provider_reported, provider_reported_at=EXCLUDED.provider_reported_at, provider_daily_limit=EXCLUDED.provider_daily_limit,
      local_at_report=equity.quota_days.refresh + equity.quota_days.backfill + equity.quota_days.validation + equity.quota_days.manual + equity.quota_days.reserve`,
    [providerId, day, usage.api_requests, now.toISOString(), usage.daily_limit]);
  return { applied: true };
}

export interface RequestLog { provider_id: string; category: QuotaCategory | 'usage_check'; endpoint: string; target?: string | null; cost: number; outcome: 'ok' | 'error' | 'not_sent_budget' | 'not_sent_circuit_open'; http_status?: number | null; error_category?: string | null; job_id?: string | null }

export async function logRequest(db: Db, now: Date, r: RequestLog): Promise<void> {
  await db.query(`INSERT INTO equity.provider_requests (provider_id, usage_date, requested_at, category, endpoint, target, cost, outcome, http_status, error_category, job_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [r.provider_id, quotaDay(now), now.toISOString(), r.category, r.endpoint, r.target ?? null, r.cost, r.outcome, r.http_status ?? null, r.error_category ?? null, r.job_id ?? null]);
}

export interface QuotaStatus {
  provider_id: string;
  usage_date: string;
  reset_time_zone: string;
  reset_note: string;
  next_reset_at: string;
  daily_limit: number;
  spent_local: number;
  provider_reported: number | null;
  provider_reported_at: string | null;
  provider_daily_limit: number | null;
  remaining: number;
  exhausted: boolean;
  exhausted_reason: string | null;
  budgets: { category: QuotaCategory; budget: number; spent: number; remaining: number }[];
  discrepancy_note: string | null;
}

export async function quotaStatus(db: Db, policy: QuotaPolicy, now: Date): Promise<QuotaStatus> {
  const day = quotaDay(now);
  const row = await db.maybeOne<Record<QuotaCategory, number> & { effective: number; provider_reported: number | null; provider_reported_at: string | null; provider_daily_limit: number | null; exhausted_at: string | null; exhausted_reason: string | null }>(
    `SELECT refresh, backfill, validation, manual, reserve, ${EFFECTIVE}::int AS effective, provider_reported, provider_reported_at, provider_daily_limit, exhausted_at, exhausted_reason FROM equity.quota_days WHERE provider_id=$1 AND usage_date=$2`, [policy.provider_id, day]);
  const spentBy = (c: QuotaCategory) => row?.[c] ?? 0;
  const local = QUOTA_CATEGORIES.reduce((s, c) => s + spentBy(c), 0);
  const effective = row?.effective ?? 0;
  let discrepancy: string | null = null;
  if (row?.provider_reported != null && row.provider_reported !== local) {
    discrepancy = row.provider_reported > local
      ? `The provider reports ${row.provider_reported} calls today; ATLAS made ${local}. Another application or a manual request may be using the same key; ATLAS counts the provider’s figure.`
      : `ATLAS counted ${local} calls; the provider last reported ${row.provider_reported} (its figure can lag, and failed requests may not count). ATLAS keeps its own, higher count.`;
  }
  if (row?.provider_daily_limit != null && row.provider_daily_limit !== policy.daily_limit) {
    discrepancy = `${discrepancy ? `${discrepancy} ` : ''}The provider reports a daily limit of ${row.provider_daily_limit}; ATLAS is configured for ${policy.daily_limit} (EODHD_DAILY_LIMIT).`;
  }
  return {
    provider_id: policy.provider_id, usage_date: day, reset_time_zone: policy.reset_time_zone, reset_note: policy.reset_note, next_reset_at: nextReset(now).toISOString(),
    daily_limit: policy.daily_limit, spent_local: local, provider_reported: row?.provider_reported ?? null, provider_reported_at: row?.provider_reported_at ?? null, provider_daily_limit: row?.provider_daily_limit ?? null,
    remaining: row?.exhausted_at ? 0 : Math.max(0, policy.daily_limit - effective), exhausted: !!row?.exhausted_at, exhausted_reason: row?.exhausted_reason ?? null,
    budgets: QUOTA_CATEGORIES.map((c) => ({ category: c, budget: policy.budgets[c], spent: spentBy(c), remaining: Math.max(0, policy.budgets[c] - spentBy(c)) })),
    discrepancy_note: discrepancy,
  };
}

/** Spaces requests to respect a per-minute limit. `sleep` is injectable so tests never wait. */
export class Pacer {
  private last: number | null = null;
  constructor(private readonly minIntervalMs: number, private readonly now: () => number = Date.now, private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {}
  async wait(): Promise<void> {
    const gap = this.last === null ? 0 : this.last + this.minIntervalMs - this.now();
    if (gap > 0) await this.sleep(gap);
    this.last = this.now();
  }
}
