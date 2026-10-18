import { DEFAULT_PLANS, PLAN_CODES, PLAN_RANK, UNLIMITED, type EntitlementKey, type PlanCode } from '@atlas/shared';
import type { Db } from '../../db/db.js';
import { paymentRequired, tooMany } from '../../lib/http.js';

// Entitlement service (PRD BIL-01, BIL-10): the single source of truth for plan limits.
// Enforced server-side on every request. Limits never block access to saved work: content above
// a lower plan's limit becomes read-only, it is never deleted.

export type UsageMetric = 'ai_questions' | 'backtests' | 'full_profiles' | 'pdf_exports' | 'csv_exports';
const METRIC_LIMIT: Record<UsageMetric, EntitlementKey> = {
  ai_questions: 'ai_questions_per_month',
  backtests: 'backtests_per_month',
  full_profiles: 'full_profiles_per_month',
  pdf_exports: 'pdf_exports_per_month',
  csv_exports: 'csv_exports_per_month',
};

export async function seedPlans(db: Db): Promise<void> {
  for (const code of PLAN_CODES) {
    const p = DEFAULT_PLANS[code];
    await db.query(`INSERT INTO app.plans (plan_code, name, price_inr_monthly, support_note, rank) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (plan_code) DO NOTHING`, [code, p.name, p.priceInrMonthly, p.supportNote, PLAN_RANK[code]]);
    await db.query(`INSERT INTO app.plan_price_history (plan_code, price_inr_monthly, effective_from) VALUES ($1,$2,'2026-10-18T00:00:00Z') ON CONFLICT DO NOTHING`, [code, p.priceInrMonthly]);
    for (const [key, value] of Object.entries(p.entitlements)) {
      await db.query(`INSERT INTO app.plan_entitlements (plan_code, key, value) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [code, key, value]);
    }
  }
}

/** First day of the usage period (calendar month, IST). */
export function periodStart(now: Date): string {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return `${ist.toISOString().slice(0, 7)}-01`;
}

export function nextReset(now: Date): string {
  const s = periodStart(now);
  const [y, m] = s.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1)).toISOString().slice(0, 10);
}

export interface PlanView {
  code: PlanCode;
  name: string;
  priceInrMonthly: number;
  supportNote: string;
  entitlements: Record<string, number>;
}

export async function listPlans(db: Db): Promise<PlanView[]> {
  const plans = await db.query<{ plan_code: PlanCode; name: string; price_inr_monthly: number; support_note: string }>(`SELECT plan_code, name, price_inr_monthly, support_note FROM app.plans WHERE active ORDER BY rank`);
  const ents = await db.query<{ plan_code: string; key: string; value: number }>(`SELECT plan_code, key, value FROM app.plan_entitlements`);
  return plans.map((p) => ({ code: p.plan_code, name: p.name, priceInrMonthly: p.price_inr_monthly, supportNote: p.support_note, entitlements: Object.fromEntries(ents.filter((e) => e.plan_code === p.plan_code).map((e) => [e.key, e.value])) }));
}

export interface UserPlan {
  plan: PlanCode;
  status: 'free' | 'active' | 'past_due' | 'cancelling';
  graceUntil: string | null;
  periodEnd: string | null;
  entitlements: Record<EntitlementKey, number>;
}

/** Effective plan: an active subscription, or past_due within the 7-day grace period (BIL-06). */
export async function userPlan(db: Db, userId: string, now: Date = new Date()): Promise<UserPlan> {
  const sub = await db.maybeOne<{ plan_code: PlanCode; status: string; grace_until: string | null; current_period_end: string | null; cancel_at_period_end: boolean }>(
    `SELECT plan_code, status, grace_until, current_period_end, cancel_at_period_end FROM app.subscriptions WHERE user_id=$1 AND status IN ('active','past_due','cancelled') ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  let plan: PlanCode = 'free';
  let status: UserPlan['status'] = 'free';
  if (sub) {
    const inPeriod = sub.current_period_end ? sub.current_period_end > now.toISOString() : false;
    if (sub.status === 'active' && inPeriod) {
      plan = sub.plan_code;
      status = sub.cancel_at_period_end ? 'cancelling' : 'active';
    } else if (sub.status === 'past_due' && sub.grace_until && sub.grace_until > now.toISOString()) {
      plan = sub.plan_code;
      status = 'past_due';
    } else if (sub.status === 'cancelled' && inPeriod) {
      // Cancelled with access until the end of the paid period (BIL-05).
      plan = sub.plan_code;
      status = 'cancelling';
    }
  }
  const rows = await db.query<{ key: EntitlementKey; value: number }>(`SELECT key, value FROM app.plan_entitlements WHERE plan_code=$1`, [plan]);
  const entitlements = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<EntitlementKey, number>;
  const overrides = await db.query<{ key: EntitlementKey; value: number }>(`SELECT key, value FROM app.entitlement_overrides WHERE user_id=$1 AND (expires_at IS NULL OR expires_at > $2) ORDER BY created_at`, [userId, now.toISOString()]);
  for (const o of overrides) entitlements[o.key] = o.value;
  return { plan, status, graceUntil: sub?.grace_until ?? null, periodEnd: sub?.current_period_end ?? null, entitlements };
}

export const isUnlimited = (v: number) => v === UNLIMITED;

export async function usage(db: Db, userId: string, now: Date = new Date()): Promise<Record<UsageMetric, number>> {
  const rows = await db.query<{ metric: UsageMetric; count: number }>(`SELECT metric, count FROM app.usage_counters WHERE user_id=$1 AND period_start=$2`, [userId, periodStart(now)]);
  const out = { ai_questions: 0, backtests: 0, full_profiles: 0, pdf_exports: 0, csv_exports: 0 } as Record<UsageMetric, number>;
  for (const r of rows) out[r.metric] = r.count;
  return out;
}

/**
 * Atomically consume one unit of a monthly quota. Throws 429 (quota) with an upgrade hint when
 * exhausted. The increment and the check happen in one statement so concurrent requests cannot overshoot.
 */
export async function consume(db: Db, userId: string, metric: UsageMetric, plan: UserPlan, now: Date = new Date()): Promise<{ used: number; limit: number }> {
  const limit = plan.entitlements[METRIC_LIMIT[metric]];
  const ps = periodStart(now);
  if (limit === UNLIMITED) {
    const r = await db.one<{ count: number }>(`INSERT INTO app.usage_counters (user_id, metric, period_start, count) VALUES ($1,$2,$3,1) ON CONFLICT (user_id, metric, period_start) DO UPDATE SET count = app.usage_counters.count + 1 RETURNING count`, [userId, metric, ps]);
    return { used: r.count, limit };
  }
  const r = await db.maybeOne<{ count: number }>(
    `INSERT INTO app.usage_counters (user_id, metric, period_start, count) SELECT $1,$2,$3,1 WHERE $4 > 0
     ON CONFLICT (user_id, metric, period_start) DO UPDATE SET count = app.usage_counters.count + 1 WHERE app.usage_counters.count < $4 RETURNING count`,
    [userId, metric, ps, limit],
  );
  if (!r) {
    throw tooMany(limitMessage(metric, limit, plan.plan), { limit, used: limit, resets_on: nextReset(now), upgrade: upgradeHint(plan.plan, METRIC_LIMIT[metric]), metric });
  }
  return { used: r.count, limit };
}

/** Return a unit (for example when an AI answer fails before any provider cost is incurred). */
export async function refund(db: Db, userId: string, metric: UsageMetric, now: Date = new Date()): Promise<void> {
  await db.query(`UPDATE app.usage_counters SET count = greatest(0, count - 1) WHERE user_id=$1 AND metric=$2 AND period_start=$3`, [userId, metric, periodStart(now)]);
}

export function requireFeature(plan: UserPlan, key: EntitlementKey, what: string): void {
  const v = plan.entitlements[key];
  if (!v) throw paymentRequired(`${what} is not included in your current plan.`, { upgrade: upgradeHint(plan.plan, key), entitlement: key });
}

/** Count-style limits (watchlists, saved screens, notes, alerts): creation blocked at the limit; existing items stay. */
export function assertWithinCount(plan: UserPlan, key: EntitlementKey, current: number, what: string): void {
  const limit = plan.entitlements[key];
  if (limit === UNLIMITED) return;
  if (current >= limit) {
    throw paymentRequired(`You have reached the ${what} limit on your plan (${limit}). Nothing you have already saved is affected.`, { limit, current, upgrade: upgradeHint(plan.plan, key), entitlement: key });
  }
}

export function upgradeHint(current: PlanCode, key: EntitlementKey): { plan: PlanCode; adds: string } | null {
  const order: PlanCode[] = ['free', 'plus', 'pro'];
  for (const code of order.slice(order.indexOf(current) + 1)) {
    const v = DEFAULT_PLANS[code].entitlements[key];
    const cur = DEFAULT_PLANS[current].entitlements[key];
    if (v === UNLIMITED || v > cur) return { plan: code, adds: `${DEFAULT_PLANS[code].name} includes ${v === UNLIMITED ? 'unlimited' : v} ${key.replace(/_/g, ' ')}` };
  }
  return null;
}

function limitMessage(metric: UsageMetric, limit: number, plan: PlanCode): string {
  const what = { ai_questions: 'AI questions', backtests: 'backtests', full_profiles: 'full company profiles', pdf_exports: 'PDF exports', csv_exports: 'CSV exports' }[metric];
  return `You have used all ${limit} ${what} included this month on the ${DEFAULT_PLANS[plan].name} plan. Saved work stays available.`;
}

/**
 * Read-only enforcement after a downgrade (BIL-04): items beyond the plan limit, ordered oldest
 * first, remain viewable but cannot be edited.
 */
export function editableIds<T extends { id: string; created_at: string }>(items: T[], limit: number): Set<string> {
  if (limit === UNLIMITED) return new Set(items.map((i) => i.id));
  return new Set([...items].sort((a, b) => (a.created_at < b.created_at ? -1 : 1)).slice(0, limit).map((i) => i.id));
}
