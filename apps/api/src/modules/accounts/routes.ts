import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { notFound, parse } from '../../lib/http.js';
import { CSRF_COOKIE, SESSION_COOKIE, reauthenticate, requireUser, requireVerified } from '../auth/service.js';
import { listPlans, nextReset, usage, userPlan } from '../billing/entitlements.js';
import { audit } from '../ops/audit.js';
import { requestAccountExport } from '../exports/accountExport.js';
import { queueEmail } from '../notify/email.js';
import { track } from '../analytics/events.js';

// Profile, preferences, consents, sessions, data export and deletion (PRD ACC-06, ACC-07, ACC-08, ACC-03).

/** Display preferences: known keys only, so the stored object stays small and every value is understood. */
export const HOME_PANELS = ['attention', 'following', 'indices', 'commodities', 'macro', 'crypto', 'learning'] as const;
export const DISPLAY_PREFS = z.object({
  theme: z.enum(['dark', 'light']),
  home_panels: z.array(z.enum(HOME_PANELS)).max(HOME_PANELS.length).refine((a) => new Set(a).size === a.length, 'Each panel once.'),
  markets: z.array(z.enum(['india', 'us', 'commodities', 'crypto'])).max(4),
  notify: z.object({ releases: z.boolean(), digest: z.boolean() }).partial(),
  show_streak: z.boolean(),
  screener_columns: z.array(z.string().max(40)).max(30),
  /** The first-run welcome on Home has been dismissed. */
  tour_done: z.boolean(),
}).partial().strict();

export async function accountRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // The web app asks once per page load whether anyone is signed in. `?optional=1` answers a signed-out
  // visitor with 200 and `{ signed_in: false }` instead of 401, so browsers do not log an error on every
  // public page. Without the flag the route still answers 401 (unchanged for API clients).
  app.get('/v1/me', async (req, reply) => {
    if (!req.user && (req.query as { optional?: string }).optional === '1') { reply.header('cache-control', 'no-store'); return { signed_in: false }; }
    const u = requireUser(req);
    const profile = await ctx.db.one<Record<string, unknown>>(
      `SELECT user_id, email, email_verified_at, display_name, role, experience_level, interests, briefing_email, display_prefs, totp_enabled_at, state_code, is_beta, founding_member, onboarding_completed_at, created_at FROM app.users WHERE user_id=$1`,
      [u.userId],
    );
    const plan = await userPlan(ctx.db, u.userId, ctx.clock());
    const used = await usage(ctx.db, u.userId, ctx.clock());
    const plans = await listPlans(ctx.db);
    return { profile, plan: { code: plan.plan, name: plans.find((p) => p.code === plan.plan)?.name, status: plan.status, grace_until: plan.graceUntil, period_end: plan.periodEnd }, entitlements: plan.entitlements, usage: used, usage_resets_on: nextReset(ctx.clock()), mfa_verified: u.mfaVerified, demo_mode: ctx.cfg.allowSyntheticData };
  });

  app.patch('/v1/me', async (req) => {
    const u = requireUser(req);
    const body = parse(
      z.object({
        display_name: z.string().trim().max(80).nullable().optional(),
        experience_level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
        interests: z.array(z.string().trim().max(40)).max(20).optional(),
        briefing_email: z.enum(['daily', 'weekly', 'off']).optional(),
        display_prefs: DISPLAY_PREFS.optional(),
        state_code: z.string().regex(/^\d{2}$/).optional(),
        onboarding_completed: z.boolean().optional(),
      }),
      req.body,
    );
    // Changes save immediately and apply from the next briefing cycle (ACC-06).
    await ctx.db.query(
      `UPDATE app.users SET display_name=COALESCE($2, display_name), experience_level=COALESCE($3, experience_level), interests=COALESCE($4, interests), briefing_email=COALESCE($5, briefing_email),
         display_prefs = display_prefs || COALESCE($6::jsonb, '{}'::jsonb), state_code=COALESCE($7, state_code),
         onboarding_completed_at = CASE WHEN $8::boolean THEN COALESCE(onboarding_completed_at, now()) ELSE onboarding_completed_at END, updated_at=now() WHERE user_id=$1`,
      [u.userId, body.display_name ?? null, body.experience_level ?? null, body.interests ?? null, body.briefing_email ?? null, body.display_prefs ? JSON.stringify(body.display_prefs) : null, body.state_code ?? null, body.onboarding_completed ?? false],
    );
    if (body.experience_level) await track(ctx.db, 'onboarding_step_completed', { step: 'experience_level', experience_level: body.experience_level }, { userId: u.userId, origin: 'server' });
    if (body.interests) await track(ctx.db, 'onboarding_step_completed', { step: 'interests' }, { userId: u.userId, origin: 'server' });
    return { saved: true };
  });

  // Consents (ACC-08): separate toggles; withdrawal is as easy as granting and is logged.
  app.get('/v1/me/consents', async (req) => {
    const u = requireUser(req);
    const rows = await ctx.db.query(`SELECT DISTINCT ON (kind) kind, version, granted, at, source FROM app.consents WHERE user_id=$1 ORDER BY kind, at DESC`, [u.userId]);
    const history = await ctx.db.query(`SELECT kind, version, granted, at, source FROM app.consents WHERE user_id=$1 ORDER BY at DESC LIMIT 100`, [u.userId]);
    return { current: rows, history };
  });
  app.post('/v1/me/consents', async (req) => {
    const u = requireUser(req);
    const body = parse(z.object({ product_updates: z.boolean().optional(), marketing: z.boolean().optional(), analytics: z.boolean().optional() }), req.body);
    for (const [kind, granted] of Object.entries(body)) {
      if (granted === undefined) continue;
      await ctx.db.query(`INSERT INTO app.consents (user_id, kind, version, granted, ip, source) VALUES ($1,$2,$3,$4,$5,'account_settings')`, [u.userId, kind, `${kind}-v1`, granted, req.ip]);
    }
    return { saved: true, effective: 'immediately (and in every case within 24 hours)' };
  });

  // Sessions (ACC-03)
  app.get('/v1/me/sessions', async (req) => {
    const u = requireUser(req);
    const rows = await ctx.db.query<{ session_hash: string; created_at: string; last_seen_at: string; ip: string; user_agent: string }>(`SELECT session_hash, created_at, last_seen_at, ip, user_agent FROM app.sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC`, [u.userId]);
    return { sessions: rows.map((s) => ({ id: s.session_hash.slice(0, 16), created_at: s.created_at, last_seen_at: s.last_seen_at, ip: s.ip, user_agent: s.user_agent, current: s.session_hash === u.sessionHash })) };
  });
  app.post('/v1/me/sessions/revoke-all', async (req, reply) => {
    const u = requireUser(req);
    await ctx.db.query(`UPDATE app.sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [u.userId]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' }).clearCookie(CSRF_COOKIE, { path: '/' });
    return { signed_out_everywhere: true };
  });
  app.delete('/v1/me/sessions/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().min(8).max(64) }), req.params);
    const r = await ctx.db.query(`UPDATE app.sessions SET revoked_at=now() WHERE user_id=$1 AND left(session_hash, 16)=$2 AND revoked_at IS NULL RETURNING 1`, [u.userId, id]);
    if (!r.length) throw notFound();
    return { revoked: true };
  });

  // Data export (ACC-07): JSON and CSV of the user's own content, link expires after 7 days.
  app.post('/v1/me/export', async (req) => {
    const u = requireVerified(req);
    const r = await requestAccountExport(ctx, u.userId);
    return { export_id: r.exportId, status: r.status, download: r.downloadPath, expires_at: r.expiresAt, note: 'Exports are normally ready within minutes; the commitment is 72 hours.' };
  });

  // Account deletion (ACC-07): re-authentication; access ends immediately; erasure within 30 days.
  app.delete('/v1/me', async (req, reply) => {
    const u = requireUser(req);
    const { password, confirm } = parse(z.object({ password: z.string().min(1).max(200), confirm: z.literal('DELETE') }), req.body);
    await reauthenticate(ctx, u, password);
    await ctx.db.tx(async (db) => {
      await db.query(`UPDATE app.sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [u.userId]);
      await db.query(`UPDATE app.users SET status='deleted', deleted_at=now() WHERE user_id=$1`, [u.userId]);
      await db.query(`INSERT INTO app.account_deletions (user_id, erase_after) VALUES ($1, now() + interval '30 days') ON CONFLICT DO NOTHING`, [u.userId]);
      // Stop renewals: any live subscription ends at period end and the mandate is revoked.
      await db.query(`UPDATE app.subscriptions SET cancel_at_period_end=true, mandate_status='revoked', cancel_reason=COALESCE(cancel_reason,'account_deleted'), updated_at=now() WHERE user_id=$1 AND status IN ('active','past_due','pending','created')`, [u.userId]);
    });
    await audit(ctx.db, { actorUserId: u.userId, actorRole: u.role, action: 'account.delete_requested', targetType: 'user', targetId: u.userId });
    await queueEmail(ctx.db, { to: u.email, userId: u.userId, template: 'account_deleted', category: 'service', subject: 'Your ATLAS account has been closed', text: 'Your account is closed and you have been signed out. Personal data is erased within 30 days, except records the law requires us to keep (such as tax invoices), as listed in the privacy notice.' });
    reply.clearCookie(SESSION_COOKIE, { path: '/' }).clearCookie(CSRF_COOKIE, { path: '/' });
    return { deleted: true };
  });
}
