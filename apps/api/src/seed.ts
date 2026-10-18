import type { AppContext } from './context.js';
import { encryptSecret, hashPassword } from './lib/crypto.js';
import { istNow } from './lib/dates.js';
import { seedCostTables } from './modules/backtest/costs.js';
import { seedTemplates } from './modules/backtest/templates.js';
import { seedPlans } from './modules/billing/entitlements.js';
import { seedFlags } from './modules/ops/flags.js';
import { createSnapshot, runDailyCycle } from './pipeline/daily.js';
import { runHistoryLoad, seedReferenceData } from './pipeline/run.js';
import { tradingCalendar } from './pipeline/synthetic/market.js';

// Development and test seed. DEVELOPMENT CREDENTIALS ONLY — these accounts exist only in local
// databases built from synthetic data; production refuses synthetic data and these never ship.
export const DEV_PASSWORD = 'atlas-dev-Password-2026';
export const DEV_ADMIN_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
export const DEV_USERS = [
  { email: 'free@atlas.test', role: 'user', plan: 'free', beta: false },
  { email: 'plus@atlas.test', role: 'user', plan: 'plus', beta: true },
  { email: 'pro@atlas.test', role: 'user', plan: 'pro', beta: false },
  { email: 'admin@atlas.test', role: 'admin', plan: 'pro', beta: false },
] as const;

export async function seedStatic(ctx: AppContext): Promise<void> {
  const db = ctx.db;
  await seedReferenceData(db);
  await seedPlans(db);
  await seedFlags(db);
  await seedCostTables(db);
  await seedTemplates(db);
  await db.query(`INSERT INTO app.coupons (code, description, percent_off, duration_months, max_redemptions, expires_at, beta_only) VALUES ('FOUNDING','Founding-member offer for private-beta users: one-third off the first three months',33.33,3,500,'2027-06-30T18:29:59Z',true) ON CONFLICT DO NOTHING`);
  // Monthly budgets from the 24-Month Financial Model base case (planning allocations, Blueprint §13).
  await db.query(`INSERT INTO ops.budgets (category, monthly_limit_inr, per_unit_budget_inr, hard_stop, note) VALUES
      ('ai', 40000, 5, false, 'AI fixed ₹40,000/month to M12; ₹5 per answered question; ₹110 per paying user'),
      ('infrastructure', 35000, NULL, false, 'Fixed infrastructure ≈ ₹35,000/month in the launch year'),
      ('data_licence', 168750, NULL, false, '₹20.25 lakh/year base case (₹1,68,750/month)')
    ON CONFLICT DO NOTHING`);
}

/** Latest completed trading session as of now (data window closes 21:30 IST). */
export function latestCompletedSession(now: Date, start = '2026-01-01', horizon = '2027-06-30'): string {
  const { date, minutes } = istNow(now);
  const cal = tradingCalendar(start, date > horizon ? horizon : date).filter((d) => d.isTradingDay).map((d) => d.date);
  let last = cal[cal.length - 1]!;
  if (last === date && minutes < 21 * 60 + 30) last = cal[cal.length - 2]!;
  return last;
}

export async function seedMarketData(ctx: AppContext, opts: { asOf: string; dailyDays?: number }): Promise<void> {
  const pctx = { db: ctx.db, store: ctx.store, cfg: ctx.cfg, log: ctx.log, now: ctx.clock };
  const days = tradingCalendar('2026-01-01', opts.asOf).filter((d) => d.isTradingDay).map((d) => d.date);
  const n = Math.max(0, Math.min(opts.dailyDays ?? 3, days.length - 1));
  const historyEnd = days[days.length - 1 - n]!;
  await runHistoryLoad(pctx, ctx.vendor, historyEnd);
  await createSnapshot(ctx.db, historyEnd, `seed history ${historyEnd}`);
  for (const d of days.slice(days.length - n)) await runDailyCycle(pctx, ctx.vendor, d, { simulatedClock: true });
  await createSnapshot(ctx.db, opts.asOf, `seed ${opts.asOf}`);
}

export async function seedUsers(ctx: AppContext): Promise<Record<string, string>> {
  const db = ctx.db;
  const hash = await hashPassword(DEV_PASSWORD);
  const ids: Record<string, string> = {};
  for (const u of DEV_USERS) {
    const existing = await db.maybeOne<{ user_id: string }>(`SELECT user_id FROM app.users WHERE lower(email)=$1`, [u.email]);
    const id = existing?.user_id ?? (await db.one<{ user_id: string }>(
      `INSERT INTO app.users (email, password_hash, display_name, role, email_verified_at, experience_level, briefing_email, is_beta, onboarding_completed_at, state_code) VALUES ($1,$2,$3,$4,now(),'intermediate','daily',$5,now(),'27') RETURNING user_id`,
      [u.email, hash, u.email.split('@')[0], u.role, u.beta],
    )).user_id;
    ids[u.email] = id;
    if (!existing) {
      for (const [kind, version] of [['terms', 'terms-2026-10-draft'], ['privacy', 'privacy-2026-10-draft'], ['age_18', 'age-confirmation-v1'], ['analytics', 'analytics-v1']]) {
        await db.query(`INSERT INTO app.consents (user_id, kind, version, granted, ip, source) VALUES ($1,$2,$3,true,'127.0.0.1','seed')`, [id, kind, version]);
      }
      if (u.plan !== 'free') {
        const price = u.plan === 'plus' ? 499 : 1499;
        await db.query(
          `INSERT INTO app.subscriptions (user_id, plan_code, status, gateway, gateway_subscription_id, price_inr, current_period_start, current_period_end, mandate_status, first_charge_at, place_of_supply_state)
           VALUES ($1,$2,'active','sandbox',$3,$4, now() - interval '3 days', now() + interval '27 days', 'active', now() - interval '3 days', '27')`,
          [id, u.plan, `sub_seed_${id.slice(0, 8)}`, price],
        );
      }
      if (u.role === 'admin') await db.query(`UPDATE app.users SET totp_secret=$2, totp_enabled_at=now() WHERE user_id=$1`, [id, encryptSecret(DEV_ADMIN_TOTP_SECRET, ctx.cfg.APP_SECRET)]);
    }
  }
  if (!ctx.cfg.isProduction) {
    // Development-only approval so the legal-gated research summary can be exercised locally.
    // It is not counsel approval, and isEnabled() ignores it in production.
    await db.query(
      `UPDATE ops.feature_flags SET enabled=true, approval=$1 WHERE flag_key='research_summary_panel' AND approval IS NULL`,
      [JSON.stringify({ approver: 'DEVELOPMENT ENVIRONMENT ONLY — not counsel approval', approved_on: '2026-10-18', document_ref: 'DEV-ONLY-NO-LEGAL-EFFECT', environment: 'development' })],
    );
  }
  return ids;
}

export async function seedAll(ctx: AppContext, opts: { asOf?: string; dailyDays?: number } = {}): Promise<{ asOf: string; users: Record<string, string> }> {
  const asOf = opts.asOf ?? latestCompletedSession(ctx.clock());
  await seedStatic(ctx);
  const haveData = await ctx.db.maybeOne(`SELECT 1 FROM market.price_eod LIMIT 1`);
  if (!haveData) await seedMarketData(ctx, { asOf, dailyDays: opts.dailyDays });
  const users = await seedUsers(ctx);
  return { asOf, users };
}
