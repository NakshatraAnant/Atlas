import { z } from 'zod';
import type { Db } from '../../db/db.js';

// Product analytics events (PRD §9, ANL-01). Names are object_action. Every event carries
// user_id (or anonymous id), plan, session id and timestamp. The schema below is the contract
// validated in CI; events that do not match are rejected and counted (target < 1% rejected).
// Private research content (note text, questions) is never sent as an event property.

const str = z.string().max(120);
const num = z.number().finite();
export const EVENT_SCHEMAS = {
  signup_completed: z.object({ method: z.enum(['email', 'google']), source: str.optional(), campaign: str.optional() }),
  email_verified: z.object({ minutes_since_signup: num }),
  onboarding_step_completed: z.object({ step: str, experience_level: str.optional() }),
  company_viewed: z.object({ company_id: z.string().uuid(), section: str, dwell_seconds: num }),
  evidence_opened: z.object({ surface: str, metric_code: str.optional(), source_id: str.optional() }),
  briefing_opened: z.object({ briefing_date: str, channel: z.enum(['app', 'email']) }),
  market_drilldown: z.object({ target_type: z.enum(['sector', 'breadth', 'announcement', 'index']), target_id: str }),
  ai_question_asked: z.object({ context_type: str, tokens_budget: num, plan: str }),
  ai_answer_delivered: z.object({ latency_ms: num, claims_count: num, check_passed: z.boolean(), cost_inr: num }),
  ai_answer_rated: z.object({ rating: z.enum(['up', 'down']), reason: str.optional() }),
  screen_run: z.object({ filters_count: num, results_count: num, saved: z.boolean() }),
  backtest_completed: z.object({ template: str, universe_size: num, years: num, warnings: num, runtime_ms: num }),
  backtest_report_viewed: z.object({ run_id: z.string().uuid() }),
  watchlist_item_added: z.object({ watchlist_id: z.string().uuid(), source_surface: str }),
  note_saved: z.object({ attached_type: str }),
  alert_sent: z.object({ alert_type: str, latency_minutes: num }),
  alert_opened: z.object({ alert_type: str, latency_minutes: num }),
  paywall_viewed: z.object({ trigger: str, plan_offered: str, variant: str.optional() }),
  checkout_started: z.object({ plan: str, coupon: str.optional(), payment_method: str.optional() }),
  subscription_started: z.object({ plan: str, coupon: str.optional(), payment_method: str.optional() }),
  subscription_cancelled: z.object({ reason: str.optional(), tenure_days: num }),
  issue_reported: z.object({ issue_type: str, surface: str }),
  lesson_completed: z.object({ lesson: str, score: num }),
  experiment_exposed: z.object({ experiment: str, variant: str }),
} as const;

export type EventName = keyof typeof EVENT_SCHEMAS;
export const EVENT_NAMES = Object.keys(EVENT_SCHEMAS) as EventName[];

/** Events a browser may send directly (only with analytics consent). Others are server-side only. */
export const CLIENT_EVENTS = new Set<EventName>(['company_viewed', 'evidence_opened', 'briefing_opened', 'market_drilldown', 'backtest_report_viewed', 'paywall_viewed', 'onboarding_step_completed']);

export interface TrackContext {
  userId?: string | null;
  anonId?: string | null;
  sessionId?: string | null;
  plan?: string | null;
  origin: 'server' | 'client';
  at?: Date;
}

export async function track(db: Db, name: string, props: unknown, ctx: TrackContext): Promise<boolean> {
  const schema = (EVENT_SCHEMAS as Record<string, z.ZodTypeAny>)[name];
  if (!schema) {
    await db.query(`INSERT INTO app.analytics_rejections (name, reason) VALUES ($1,'unknown event')`, [name.slice(0, 80)]);
    return false;
  }
  const parsed = schema.safeParse(props ?? {});
  if (!parsed.success) {
    await db.query(`INSERT INTO app.analytics_rejections (name, reason) VALUES ($1,$2)`, [name, parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ').slice(0, 300)]);
    return false;
  }
  await db.query(`INSERT INTO app.analytics_events (name, user_id, anon_id, session_id, plan, props, origin, occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
    name, ctx.userId ?? null, ctx.anonId ?? null, ctx.sessionId ? ctx.sessionId.slice(0, 16) : null, ctx.plan ?? null, JSON.stringify(parsed.data), ctx.origin, (ctx.at ?? new Date()).toISOString(),
  ]);
  return true;
}

/** Whether the user (or anonymous visitor) has granted non-essential analytics consent. */
export async function hasAnalyticsConsent(db: Db, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const c = await db.maybeOne<{ granted: boolean }>(`SELECT granted FROM app.consents WHERE user_id=$1 AND kind='analytics' ORDER BY at DESC LIMIT 1`, [userId]);
  return !!c?.granted;
}
