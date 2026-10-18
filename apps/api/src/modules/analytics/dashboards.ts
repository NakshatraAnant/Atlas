import type { Db } from '../../db/db.js';

// Activation, Weekly Active Researchers, funnel and cohort reporting (PRD §2.4, §9, ANL-02, ANL-03).
// Computed directly from raw events so the numbers reconcile to them.

/** Activation: ai_answer_delivered + evidence_opened + (watchlist_item_added or note_saved) within 7 days of email_verified. */
export async function activation(db: Db, from: string, to: string) {
  const rows = await db.query<{ verified: number; activated: number }>(
    `WITH v AS (SELECT user_id, min(occurred_at) AS at FROM app.analytics_events WHERE name='email_verified' AND occurred_at >= $1 AND occurred_at < $2 GROUP BY user_id)
     SELECT count(*)::int AS verified,
            count(*) FILTER (WHERE
              EXISTS (SELECT 1 FROM app.analytics_events e WHERE e.user_id=v.user_id AND e.name='ai_answer_delivered' AND e.occurred_at BETWEEN v.at AND v.at + interval '7 days')
              AND EXISTS (SELECT 1 FROM app.analytics_events e WHERE e.user_id=v.user_id AND e.name='evidence_opened' AND e.occurred_at BETWEEN v.at AND v.at + interval '7 days')
              AND EXISTS (SELECT 1 FROM app.analytics_events e WHERE e.user_id=v.user_id AND e.name IN ('watchlist_item_added','note_saved') AND e.occurred_at BETWEEN v.at AND v.at + interval '7 days'))::int AS activated
       FROM v`,
    [from, to],
  );
  const r = rows[0] ?? { verified: 0, activated: 0 };
  return { ...r, rate: r.verified ? r.activated / r.verified : null, definition: 'AI answer delivered + evidence opened + watchlist add or note saved within 7 days of email verification' };
}

/**
 * Weekly Active Researchers: distinct users completing a meaningful task in an IST calendar week.
 * Implemented signals: answered-and-verified question (ai_answer_delivered + evidence_opened in the
 * week), source-inspected company analysis (company_viewed ≥ 60 s + evidence, or a note on a company),
 * completed market investigation (briefing_opened + market_drilldown), reproducible backtest
 * (backtest_completed + report viewed, or saved).
 */
export async function weeklyActiveResearchers(db: Db, weeks = 12) {
  return db.query<{ week: string; war: number; answered_verified: number; company_analysis: number; market_investigation: number; backtest: number }>(
    `WITH e AS (SELECT user_id, name, props, date_trunc('week', occurred_at + interval '330 minutes')::date AS week FROM app.analytics_events WHERE occurred_at > now() - make_interval(weeks => $1) AND user_id IS NOT NULL),
     per AS (
       SELECT week, user_id,
         bool_or(name='ai_answer_delivered') AND bool_or(name='evidence_opened') AS answered_verified,
         (bool_or(name='company_viewed' AND (props->>'dwell_seconds')::float >= 60) AND bool_or(name='evidence_opened')) OR bool_or(name='note_saved' AND props->>'attached_type'='company') AS company_analysis,
         bool_or(name='briefing_opened') AND bool_or(name='market_drilldown') AS market_investigation,
         bool_or(name='backtest_completed') AND bool_or(name='backtest_report_viewed') AS backtest
       FROM e GROUP BY week, user_id)
     SELECT week::text, count(*) FILTER (WHERE answered_verified OR company_analysis OR market_investigation OR backtest)::int AS war,
            count(*) FILTER (WHERE answered_verified)::int AS answered_verified, count(*) FILTER (WHERE company_analysis)::int AS company_analysis,
            count(*) FILTER (WHERE market_investigation)::int AS market_investigation, count(*) FILTER (WHERE backtest)::int AS backtest
       FROM per GROUP BY week ORDER BY week`,
    [weeks],
  );
}

export async function funnel(db: Db, from: string, to: string) {
  const r = await db.one<{ signups: number; verified: number; checkout: number; paid: number }>(
    `WITH s AS (SELECT DISTINCT user_id FROM app.analytics_events WHERE name='signup_completed' AND occurred_at >= $1 AND occurred_at < $2)
     SELECT count(*)::int AS signups,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM app.analytics_events e WHERE e.user_id=s.user_id AND e.name='email_verified'))::int AS verified,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM app.analytics_events e WHERE e.user_id=s.user_id AND e.name='checkout_started'))::int AS checkout,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM app.analytics_events e WHERE e.user_id=s.user_id AND e.name='subscription_started'))::int AS paid
     FROM s`,
    [from, to],
  );
  return { ...r, conversion_60d_note: 'Free-to-paid (60-day) = sign-ups in the month with subscription_started within 60 days ÷ sign-ups in the month' };
}

export async function cohorts(db: Db) {
  return db.query(
    `WITH c AS (SELECT user_id, date_trunc('month', min(occurred_at))::date AS cohort FROM app.analytics_events WHERE name='signup_completed' GROUP BY user_id),
     a AS (SELECT DISTINCT user_id, date_trunc('month', occurred_at)::date AS m FROM app.analytics_events WHERE user_id IS NOT NULL)
     SELECT c.cohort::text, (extract(year FROM age(a.m, c.cohort)) * 12 + extract(month FROM age(a.m, c.cohort)))::int AS month_offset, count(DISTINCT a.user_id)::int AS active
       FROM c JOIN a USING (user_id) WHERE a.m >= c.cohort GROUP BY 1, 2 ORDER BY 1, 2`,
  );
}

export async function churn(db: Db) {
  const reasons = await db.query(`SELECT COALESCE(cancel_reason, 'not given') AS reason, count(*)::int AS n FROM app.subscriptions WHERE cancelled_at IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`);
  const monthly = await db.query(
    `WITH m AS (SELECT generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month')::date AS month)
     SELECT m.month::text,
       (SELECT count(*) FROM app.subscriptions s WHERE s.first_charge_at < m.month AND (s.cancelled_at IS NULL OR s.cancelled_at >= m.month))::int AS opening,
       (SELECT count(*) FROM app.subscriptions s WHERE s.first_charge_at < m.month AND ((s.status IN ('expired','halted','cancelled') AND s.updated_at >= m.month AND s.updated_at < m.month + interval '1 month')))::int AS ended
     FROM m ORDER BY 1`,
  );
  return { reasons, monthly, definition: 'Monthly churn = subscriptions ending in the month ÷ subscriptions active at the start of the month' };
}

export async function eventHealth(db: Db) {
  const r = await db.one<{ accepted: number; rejected: number }>(`SELECT (SELECT count(*) FROM app.analytics_events WHERE occurred_at > now() - interval '7 days')::int AS accepted, (SELECT count(*) FROM app.analytics_rejections WHERE at > now() - interval '7 days')::int AS rejected`);
  return { ...r, rejected_share: r.accepted + r.rejected ? r.rejected / (r.accepted + r.rejected) : 0, target: 'less than 1% rejected' };
}
