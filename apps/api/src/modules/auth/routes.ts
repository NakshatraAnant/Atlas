import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { badRequest, parse, unavailable } from '../../lib/http.js';
import { track } from '../analytics/events.js';
import { isEnabled } from '../ops/flags.js';
import { CSRF_COOKIE, NEUTRAL_RESET, NEUTRAL_SIGNUP, SESSION_COOKIE, beginTotpEnrolment, confirmTotpEnrolment, cookieOptions, login, requestPasswordReset, requireUser, resetPassword, sendVerification, signup, verifyEmail, verifyMfaForSession } from './service.js';

const email = z.string().trim().email().max(254);

export async function authRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post('/v1/auth/signup', { config: { rateLimit: { limit: 10, windowMs: 3600_000, key: 'ip' } } }, async (req, reply) => {
    const body = parse(z.object({ email, password: z.string().min(1).max(200), age_confirmed: z.boolean(), accept_terms: z.boolean(), accept_privacy: z.boolean(), marketing: z.boolean().optional(), product_updates: z.boolean().optional(), analytics: z.boolean().optional(), display_name: z.string().trim().max(80).optional(), source: z.string().max(80).optional(), campaign: z.string().max(80).optional() }), req.body);
    const r = await signup(ctx, req, { email: body.email, password: body.password, ageConfirmed: body.age_confirmed, acceptTerms: body.accept_terms, acceptPrivacy: body.accept_privacy, marketing: body.marketing, productUpdates: body.product_updates, analytics: body.analytics, displayName: body.display_name });
    if (r.userId) await track(ctx.db, 'signup_completed', { method: 'email', source: body.source, campaign: body.campaign }, { userId: r.userId, plan: 'free', origin: 'server' });
    return reply.status(202).send({ message: NEUTRAL_SIGNUP });
  });

  app.post('/v1/auth/verify-email', async (req) => {
    const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.body);
    const r = await verifyEmail(ctx, token);
    await track(ctx.db, 'email_verified', { minutes_since_signup: r.minutesSinceSignup }, { userId: r.userId, origin: 'server' });
    return { verified: true };
  });

  app.post('/v1/auth/resend-verification', async (req) => {
    const u = requireUser(req);
    if (u.verified) return { message: 'Your email is already verified.' };
    const ok = await sendVerification(ctx, u.userId, u.email);
    if (!ok) throw badRequest('You can request at most 5 verification emails an hour. Try again later.');
    return { message: 'Verification email sent.' };
  });

  app.post('/v1/auth/login', { config: { rateLimit: { limit: 30, windowMs: 15 * 60_000, key: 'ip' } } }, async (req, reply) => {
    const body = parse(z.object({ email, password: z.string().min(1).max(200), totp: z.string().trim().max(20).optional() }), req.body);
    const r = await login(ctx, req, reply, body);
    if (r.mfaRequired) return reply.status(200).send({ mfa_required: true });
    return { signed_in: true };
  });

  app.post('/v1/auth/logout', async (req, reply) => {
    if (req.user) await ctx.db.query(`UPDATE app.sessions SET revoked_at=now() WHERE session_hash=$1`, [req.user.sessionHash]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' }).clearCookie(CSRF_COOKIE, { path: '/' });
    return { signed_out: true };
  });

  app.get('/v1/auth/csrf', async (req, reply) => {
    // Issues a CSRF token cookie for anonymous forms (sign-up, sign-in).
    const token = (req.cookies[CSRF_COOKIE] as string | undefined) ?? (await import('../../lib/crypto.js')).randomToken(18);
    reply.setCookie(CSRF_COOKIE, token, cookieOptions(ctx, 12 * 3600, false));
    return { csrf: token };
  });

  app.post('/v1/auth/password-reset/request', { config: { rateLimit: { limit: 10, windowMs: 3600_000, key: 'ip' } } }, async (req) => {
    const body = parse(z.object({ email }), req.body);
    await requestPasswordReset(ctx, body.email);
    return { message: NEUTRAL_RESET };
  });

  app.post('/v1/auth/password-reset/confirm', async (req) => {
    const body = parse(z.object({ token: z.string().min(10).max(200), password: z.string().min(1).max(200) }), req.body);
    await resetPassword(ctx, body.token, body.password);
    return { reset: true, message: 'Password changed. All sessions were signed out; sign in again.' };
  });

  app.get('/v1/auth/google', async (req) => {
    if (!ctx.cfg.GOOGLE_CLIENT_ID || !(await isEnabled(ctx.db, 'google_sign_in'))) {
      throw unavailable('Google sign-in is not available yet. Use email and password.', { blocker: 'B-AUTH-01: Google OAuth client not configured' });
    }
    throw unavailable('Google sign-in is configured but the OAuth callback is not enabled in this build.', { blocker: 'B-AUTH-01' });
  });

  // Two-step verification (ACC-05)
  app.post('/v1/auth/totp/enrol', async (req) => {
    const u = requireUser(req);
    return beginTotpEnrolment(ctx, u);
  });
  app.post('/v1/auth/totp/confirm', async (req, reply) => {
    const u = requireUser(req);
    const { code } = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body);
    const r = await confirmTotpEnrolment(ctx, req, reply, u, code);
    return { enabled: true, recovery_codes: r.recoveryCodes, note: 'Store these 10 single-use recovery codes somewhere safe. They are shown once.' };
  });
  app.post('/v1/auth/mfa/verify', async (req, reply) => {
    const u = requireUser(req);
    const { code } = parse(z.object({ code: z.string().trim().min(6).max(20) }), req.body);
    await verifyMfaForSession(ctx, req, reply, u, code);
    return { mfa_verified: true };
  });
}
