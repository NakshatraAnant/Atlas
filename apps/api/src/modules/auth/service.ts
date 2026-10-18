import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext, SessionUser } from '../../context.js';
import type { Db } from '../../db/db.js';
import { decryptSecret, encryptSecret, base32Encode, hashPassword, randomToken, sha256Hex, verifyPassword, verifyTotp } from '../../lib/crypto.js';
import { badRequest, forbidden, tooMany, unauthorized } from '../../lib/http.js';
import { audit } from '../ops/audit.js';
import { queueEmail } from '../notify/email.js';
import { checkPassword } from './breached.js';
import { randomBytes } from 'node:crypto';

// Accounts and authentication (PRD ACC-01..ACC-05, Blueprint §9.1). Self-hosted identity behind
// one module boundary so it can be replaced by Amazon Cognito (ADR-009) without touching callers.

export const SESSION_COOKIE = 'atlas_session';
export const CSRF_COOKIE = 'atlas_csrf';
export const TERMS_VERSION = 'terms-2026-10-draft';
export const PRIVACY_VERSION = 'privacy-2026-10-draft';
const SESSION_DAYS = 30;
const IDLE_DAYS = 14;
const ADMIN_SESSION_HOURS = 12;
export const LOCKOUT = { attempts: 5, windowMinutes: 15 };
export const VERIFY_TTL_HOURS = 24;
export const RESET_TTL_MINUTES = 60;
export const RESEND_PER_HOUR = 5;

export const NEUTRAL_SIGNUP = 'If this email can be used, we have sent a verification link. Check your inbox.';
export const NEUTRAL_RESET = 'If an account exists for this email, we have sent a reset link valid for 60 minutes.';

export function cookieOptions(ctx: AppContext, maxAgeSeconds: number, httpOnly = true) {
  return { path: '/', httpOnly, secure: ctx.cfg.isProduction, sameSite: 'lax' as const, maxAge: maxAgeSeconds };
}

export async function createSession(ctx: AppContext, reply: FastifyReply, req: FastifyRequest, userId: string, opts: { mfaVerified: boolean; role: string }): Promise<string> {
  const token = randomToken(32);
  const hours = opts.role === 'user' ? SESSION_DAYS * 24 : ADMIN_SESSION_HOURS;
  const expires = new Date(ctx.clock().getTime() + hours * 3600_000);
  await ctx.db.query(`INSERT INTO app.sessions (session_hash, user_id, expires_at, ip, user_agent, mfa_verified) VALUES ($1,$2,$3,$4,$5,$6)`, [sha256Hex(token), userId, expires.toISOString(), req.ip, String(req.headers['user-agent'] ?? '').slice(0, 300), opts.mfaVerified]);
  reply.setCookie(SESSION_COOKIE, token, cookieOptions(ctx, hours * 3600));
  reply.setCookie(CSRF_COOKIE, randomToken(18), cookieOptions(ctx, hours * 3600, false));
  return token;
}

/** Rotate the session token (on privilege change: MFA verified, password change, role change). */
export async function rotateSession(ctx: AppContext, reply: FastifyReply, req: FastifyRequest, user: SessionUser, mfaVerified: boolean): Promise<void> {
  await ctx.db.query(`UPDATE app.sessions SET revoked_at=now() WHERE session_hash=$1`, [user.sessionHash]);
  await createSession(ctx, reply, req, user.userId, { mfaVerified, role: user.role });
}

export async function resolveSession(ctx: AppContext, token: string | undefined): Promise<SessionUser | undefined> {
  if (!token) return undefined;
  const hash = sha256Hex(token);
  const row = await ctx.db.maybeOne<{ user_id: string; email: string; role: SessionUser['role']; email_verified_at: string | null; mfa_verified: boolean; totp_enabled_at: string | null; last_seen_at: string; expires_at: string; display_name: string | null; experience_level: string | null }>(
    `SELECT u.user_id, u.email, u.role, u.email_verified_at, s.mfa_verified, u.totp_enabled_at, s.last_seen_at, s.expires_at, u.display_name, u.experience_level
       FROM app.sessions s JOIN app.users u USING (user_id)
      WHERE s.session_hash=$1 AND s.revoked_at IS NULL AND u.status='active'`,
    [hash],
  );
  if (!row) return undefined;
  const now = ctx.clock();
  if (row.expires_at <= now.toISOString()) return undefined;
  if (Date.parse(row.last_seen_at) < now.getTime() - IDLE_DAYS * 86_400_000) return undefined;
  if (now.getTime() - Date.parse(row.last_seen_at) > 60_000) await ctx.db.query(`UPDATE app.sessions SET last_seen_at=now() WHERE session_hash=$1`, [hash]);
  return { userId: row.user_id, email: row.email, role: row.role, verified: !!row.email_verified_at, mfaVerified: row.mfa_verified, totpEnabled: !!row.totp_enabled_at, sessionHash: hash, displayName: row.display_name, experienceLevel: row.experience_level };
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requireVerified(req: FastifyRequest): SessionUser {
  const u = requireUser(req);
  if (!u.verified) throw forbidden('Verify your email address to save research, pay or receive alerts (ACC-02).');
  return u;
}

export function requireRole(req: FastifyRequest, roles: SessionUser['role'][]): SessionUser {
  const u = requireUser(req);
  if (!roles.includes(u.role)) throw forbidden();
  // Admin console refuses access without two-step verification (ACC-05, ADM-01).
  if (!u.totpEnabled || !u.mfaVerified) throw forbidden('Two-step verification is required for the admin console.');
  return u;
}

async function recentFailures(db: Db, email: string, ip: string): Promise<{ byEmail: number; byIp: number }> {
  const r = await db.one<{ by_email: number; by_ip: number }>(
    `SELECT count(*) FILTER (WHERE lower(email)=lower($1))::int AS by_email, count(*) FILTER (WHERE ip=$2)::int AS by_ip
       FROM app.login_attempts WHERE NOT success AND at > now() - make_interval(mins => $3)`,
    [email, ip, LOCKOUT.windowMinutes],
  );
  return { byEmail: r.by_email, byIp: r.by_ip };
}

export async function signup(ctx: AppContext, req: FastifyRequest, input: { email: string; password: string; ageConfirmed: boolean; acceptTerms: boolean; acceptPrivacy: boolean; marketing?: boolean; productUpdates?: boolean; analytics?: boolean; displayName?: string }): Promise<{ userId: string | null }> {
  if (!input.ageConfirmed) throw badRequest('You must confirm that you are 18 or older.');
  if (!input.acceptTerms || !input.acceptPrivacy) throw badRequest('Accept the Terms of Use and the Privacy Notice to create an account.');
  const pw = checkPassword(input.password, input.email);
  if (!pw.ok) throw badRequest(pw.reason!);
  const email = input.email.trim().toLowerCase();
  const existing = await ctx.db.maybeOne<{ user_id: string }>(`SELECT user_id FROM app.users WHERE lower(email)=$1 AND status='active'`, [email]);
  if (existing) {
    // No account enumeration: same response; the owner is told by email instead.
    await queueEmail(ctx.db, { to: email, userId: existing.user_id, template: 'signup_existing', category: 'security', subject: 'Someone tried to create an ATLAS account with your email', text: 'An attempt was made to create an account with this email address. If it was you, sign in or reset your password. If not, you can ignore this message.' });
    return { userId: null };
  }
  const hash = await hashPassword(input.password);
  const user = await ctx.db.tx(async (db) => {
    const u = await db.one<{ user_id: string }>(`INSERT INTO app.users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING user_id`, [email, hash, input.displayName ?? null]);
    const consents: [string, string, boolean][] = [
      ['terms', TERMS_VERSION, true],
      ['privacy', PRIVACY_VERSION, true],
      ['age_18', 'age-confirmation-v1', true],
      ['marketing', 'marketing-v1', !!input.marketing],
      ['product_updates', 'product-updates-v1', !!input.productUpdates],
      ['analytics', 'analytics-v1', !!input.analytics],
    ];
    for (const [kind, version, granted] of consents) {
      await db.query(`INSERT INTO app.consents (user_id, kind, version, granted, ip, source) VALUES ($1,$2,$3,$4,$5,'signup')`, [u.user_id, kind, version, granted, req.ip]);
    }
    return u;
  });
  await sendVerification(ctx, user.user_id, email);
  return { userId: user.user_id };
}

export async function sendVerification(ctx: AppContext, userId: string, email: string): Promise<boolean> {
  const sent = await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM app.auth_tokens WHERE user_id=$1 AND kind='verify_email' AND created_at > now() - interval '1 hour'`, [userId]);
  if (sent.n >= RESEND_PER_HOUR) return false;
  const token = randomToken(32);
  await ctx.db.query(`INSERT INTO app.auth_tokens (token_hash, user_id, kind, expires_at) VALUES ($1,$2,'verify_email', now() + make_interval(hours => $3))`, [sha256Hex(token), userId, VERIFY_TTL_HOURS]);
  await queueEmail(ctx.db, { to: email, userId, template: 'verify_email', category: 'service', subject: 'Verify your email for ATLAS', text: `Open this link within 24 hours to verify your email: ${ctx.cfg.WEB_ORIGIN}/verify-email?token=${token}\n\nUntil you verify, you can preview onboarding but cannot save research, pay or receive alerts.` });
  return true;
}

export async function verifyEmail(ctx: AppContext, token: string): Promise<{ userId: string; minutesSinceSignup: number }> {
  const row = await ctx.db.maybeOne<{ user_id: string; created_at: string }>(
    `UPDATE app.auth_tokens t SET used_at=now() FROM app.users u WHERE t.token_hash=$1 AND t.kind='verify_email' AND t.used_at IS NULL AND t.expires_at > now() AND u.user_id=t.user_id RETURNING t.user_id, u.created_at`,
    [sha256Hex(token)],
  );
  if (!row) throw badRequest('This verification link is invalid or has expired. Request a new one from your account page.');
  await ctx.db.query(`UPDATE app.users SET email_verified_at=COALESCE(email_verified_at, now()), updated_at=now() WHERE user_id=$1`, [row.user_id]);
  return { userId: row.user_id, minutesSinceSignup: Math.round((ctx.clock().getTime() - Date.parse(row.created_at)) / 60000) };
}

export async function login(ctx: AppContext, req: FastifyRequest, reply: FastifyReply, input: { email: string; password: string; totp?: string }): Promise<{ userId: string; mfaRequired: boolean }> {
  const email = input.email.trim().toLowerCase();
  const fails = await recentFailures(ctx.db, email, req.ip);
  if (fails.byEmail >= LOCKOUT.attempts || fails.byIp >= LOCKOUT.attempts * 4) {
    throw tooMany(`Too many failed sign-in attempts. Try again in ${LOCKOUT.windowMinutes} minutes or reset your password.`, { retry_after_minutes: LOCKOUT.windowMinutes });
  }
  const user = await ctx.db.maybeOne<{ user_id: string; password_hash: string | null; role: string; totp_secret: string | null; totp_enabled_at: string | null }>(`SELECT user_id, password_hash, role, totp_secret, totp_enabled_at FROM app.users WHERE lower(email)=$1 AND status='active'`, [email]);
  // Constant-ish work whether or not the user exists.
  const ok = user?.password_hash ? await verifyPassword(input.password, user.password_hash) : (await hashPassword(input.password), false);
  if (!user || !ok) {
    await ctx.db.query(`INSERT INTO app.login_attempts (email, ip, success) VALUES ($1,$2,false)`, [email, req.ip]);
    throw unauthorized('Email or password is incorrect.');
  }
  let mfaVerified = false;
  if (user.totp_enabled_at && user.totp_secret) {
    if (!input.totp) return { userId: user.user_id, mfaRequired: true };
    mfaVerified = await checkSecondFactor(ctx, user.user_id, user.totp_secret, input.totp);
    if (!mfaVerified) {
      await ctx.db.query(`INSERT INTO app.login_attempts (email, ip, success) VALUES ($1,$2,false)`, [email, req.ip]);
      throw unauthorized('The verification code is not valid.');
    }
  }
  await ctx.db.query(`INSERT INTO app.login_attempts (email, ip, success) VALUES ($1,$2,true)`, [email, req.ip]);
  await ctx.db.query(`UPDATE app.users SET last_seen_at=now() WHERE user_id=$1`, [user.user_id]);
  await createSession(ctx, reply, req, user.user_id, { mfaVerified, role: user.role });
  return { userId: user.user_id, mfaRequired: false };
}

async function checkSecondFactor(ctx: AppContext, userId: string, encSecret: string, code: string): Promise<boolean> {
  const secret = decryptSecret(encSecret, ctx.cfg.APP_SECRET);
  if (verifyTotp(secret, code, ctx.clock().getTime())) return true;
  // Recovery codes: single use.
  const row = await ctx.db.one<{ recovery_codes: string[] }>(`SELECT recovery_codes FROM app.users WHERE user_id=$1`, [userId]);
  const h = sha256Hex(code.trim().toUpperCase());
  if (row.recovery_codes.includes(h)) {
    await ctx.db.query(`UPDATE app.users SET recovery_codes = $2 WHERE user_id=$1`, [userId, JSON.stringify(row.recovery_codes.filter((c) => c !== h))]);
    return true;
  }
  return false;
}

export async function requestPasswordReset(ctx: AppContext, emailRaw: string): Promise<void> {
  const email = emailRaw.trim().toLowerCase();
  const user = await ctx.db.maybeOne<{ user_id: string }>(`SELECT user_id FROM app.users WHERE lower(email)=$1 AND status='active'`, [email]);
  if (!user) return;
  const recent = await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM app.auth_tokens WHERE user_id=$1 AND kind='reset_password' AND created_at > now() - interval '1 hour'`, [user.user_id]);
  if (recent.n >= RESEND_PER_HOUR) return;
  const token = randomToken(32);
  await ctx.db.query(`INSERT INTO app.auth_tokens (token_hash, user_id, kind, expires_at) VALUES ($1,$2,'reset_password', now() + make_interval(mins => $3))`, [sha256Hex(token), user.user_id, RESET_TTL_MINUTES]);
  await queueEmail(ctx.db, { to: email, userId: user.user_id, template: 'reset_password', category: 'security', subject: 'Reset your ATLAS password', text: `Use this single-use link within 60 minutes: ${ctx.cfg.WEB_ORIGIN}/reset-password?token=${token}\n\nIf you did not ask for this, ignore this email; your password is unchanged.` });
}

export async function resetPassword(ctx: AppContext, token: string, password: string): Promise<void> {
  const row = await ctx.db.maybeOne<{ user_id: string; email: string }>(
    `SELECT t.user_id, u.email FROM app.auth_tokens t JOIN app.users u USING (user_id) WHERE t.token_hash=$1 AND t.kind='reset_password' AND t.used_at IS NULL AND t.expires_at > now()`,
    [sha256Hex(token)],
  );
  if (!row) throw badRequest('This reset link is invalid or has expired. Request a new one.');
  const pw = checkPassword(password, row.email);
  if (!pw.ok) throw badRequest(pw.reason!);
  const hash = await hashPassword(password);
  await ctx.db.tx(async (db) => {
    await db.query(`UPDATE app.auth_tokens SET used_at=now() WHERE token_hash=$1`, [sha256Hex(token)]);
    await db.query(`UPDATE app.users SET password_hash=$2, updated_at=now() WHERE user_id=$1`, [row.user_id, hash]);
    // All sessions are revoked after a reset (ACC-04).
    await db.query(`UPDATE app.sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [row.user_id]);
  });
  await queueEmail(ctx.db, { to: row.email, userId: row.user_id, template: 'password_changed', category: 'security', subject: 'Your ATLAS password was changed', text: 'Your password was changed and every session was signed out. If this was not you, reset your password immediately and contact support.' });
}

export async function beginTotpEnrolment(ctx: AppContext, user: SessionUser): Promise<{ secret: string; otpauth: string }> {
  const secret = base32Encode(randomBytes(20));
  await ctx.db.query(`UPDATE app.users SET totp_secret=$2 WHERE user_id=$1 AND totp_enabled_at IS NULL`, [user.userId, encryptSecret(secret, ctx.cfg.APP_SECRET)]);
  return { secret, otpauth: `otpauth://totp/ATLAS:${encodeURIComponent(user.email)}?secret=${secret}&issuer=ATLAS&period=30&digits=6` };
}

export async function confirmTotpEnrolment(ctx: AppContext, req: FastifyRequest, reply: FastifyReply, user: SessionUser, code: string): Promise<{ recoveryCodes: string[] }> {
  const row = await ctx.db.one<{ totp_secret: string | null; totp_enabled_at: string | null }>(`SELECT totp_secret, totp_enabled_at FROM app.users WHERE user_id=$1`, [user.userId]);
  if (!row.totp_secret || row.totp_enabled_at) throw badRequest('Start enrolment first.');
  if (!verifyTotp(decryptSecret(row.totp_secret, ctx.cfg.APP_SECRET), code, ctx.clock().getTime())) throw badRequest('That code is not valid. Check the time on your device and try again.');
  const codes = Array.from({ length: 10 }, () => randomToken(6).toUpperCase().replace(/[^A-Z0-9]/g, 'X').slice(0, 10));
  await ctx.db.query(`UPDATE app.users SET totp_enabled_at=now(), recovery_codes=$2 WHERE user_id=$1`, [user.userId, JSON.stringify(codes.map((c) => sha256Hex(c)))]);
  await audit(ctx.db, { actorUserId: user.userId, actorRole: user.role, action: 'auth.totp_enabled', targetType: 'user', targetId: user.userId });
  await rotateSession(ctx, reply, req, user, true);
  return { recoveryCodes: codes };
}

export async function verifyMfaForSession(ctx: AppContext, req: FastifyRequest, reply: FastifyReply, user: SessionUser, code: string): Promise<void> {
  const row = await ctx.db.one<{ totp_secret: string | null }>(`SELECT totp_secret FROM app.users WHERE user_id=$1`, [user.userId]);
  if (!row.totp_secret || !(await checkSecondFactor(ctx, user.userId, row.totp_secret, code))) throw unauthorized('The verification code is not valid.');
  await rotateSession(ctx, reply, req, user, true);
}

/** Re-authentication for sensitive actions (account deletion). */
export async function reauthenticate(ctx: AppContext, user: SessionUser, password: string): Promise<void> {
  const row = await ctx.db.one<{ password_hash: string | null }>(`SELECT password_hash FROM app.users WHERE user_id=$1`, [user.userId]);
  if (!row.password_hash || !(await verifyPassword(password, row.password_hash))) throw unauthorized('Password is incorrect.');
}
