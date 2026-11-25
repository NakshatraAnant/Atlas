import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { startBackgroundJobs } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { RazorpayGateway, type SandboxGateway } from '../src/modules/billing/gateway.js';
import { isIsoDate } from '../src/lib/http.js';
import { DEV_PASSWORD } from '../src/seed.js';
import { fixtureContext } from './fixture.js';
import { Client } from './http.js';

// Defects found by the 24 Nov 2026 production audit.

let ctx: AppContext;
let app: FastifyInstance;
beforeAll(async () => { ctx = await fixtureContext(); app = await buildApp(ctx); });
afterAll(async () => { await app.close(); await ctx.db.close(); });

const PW = 'a-long-unique-passphrase';
async function account(email: string) {
  const c = new Client(app);
  await c.post('/v1/auth/signup', { email, password: PW, age_confirmed: true, accept_terms: true, accept_privacy: true });
  await ctx.db.query(`UPDATE app.users SET email_verified_at=now() WHERE email=$1`, [email]);
  expect((await c.login(email, PW)).status).toBe(200);
  return c;
}
const deliver = async (e: unknown) => {
  const body = JSON.stringify(e);
  return app.inject({ method: 'POST', url: '/webhooks/payments', payload: body, headers: { 'content-type': 'application/json', 'x-atlas-signature': (ctx.payments as SandboxGateway).sign(body) } });
};

describe('requests', () => {
  it('demo mode off cannot be bypassed with an encoded path', async () => {
    const off = await buildApp({ ...ctx, cfg: { ...ctx.cfg, allowSyntheticData: false } });
    const c = new Client(off);
    expect((await c.get('/v1/companies')).status).toBe(403);
    expect((await c.get('/v1/%63ompanies')).status).toBe(404);
    await off.close();
  });
  it('identifies clients by the nearest non-loopback hop, which a client cannot choose', async () => {
    const probe = async (xff?: string) => {
      const r = await app.inject({ method: 'GET', url: '/v1/auth/csrf', headers: xff ? { 'x-forwarded-for': xff } : {} });
      return Number(r.headers['ratelimit-remaining']);
    };
    const a = await probe('203.0.113.9');
    expect(await probe('203.0.113.10')).toBe(a);
    expect(await probe('198.51.100.1, 203.0.113.9, 127.0.0.1')).toBe(a - 1);
  });
  it('cookies are Secure when the request came over HTTPS', async () => {
    const https = await app.inject({ method: 'GET', url: '/v1/auth/csrf', headers: { 'x-forwarded-proto': 'https' } });
    const http = await app.inject({ method: 'GET', url: '/v1/auth/csrf' });
    expect(https.cookies[0]!.secure).toBe(true);
    expect(http.cookies[0]!.secure).toBeFalsy();
  });
  it('only real calendar dates are dates', () => {
    expect(['2026-02-28', '2024-02-29'].every(isIsoDate)).toBe(true);
    expect(['2026-02-30', '2026-99-99', '2026-2-1', ''].some(isIsoDate)).toBe(false);
  });
});

describe('accounts', () => {
  it('a password reset lifts the lockout, works once, and retires other reset links', async () => {
    await account('locked@example.test');
    const c = new Client(app);
    for (let i = 0; i < 5; i++) await c.login('locked@example.test', 'wrong-password-here');
    expect((await c.login('locked@example.test', PW)).status).toBe(429);
    for (let i = 0; i < 2; i++) await c.post('/v1/auth/password-reset/request', { email: 'locked@example.test' });
    const mails = await ctx.db.query<{ body_text: string }>(`SELECT body_text FROM app.email_outbox WHERE to_email='locked@example.test' AND template='reset_password'`);
    const tokens = mails.map((m) => /token=([\w-]+)/.exec(m.body_text)![1]!);
    expect(tokens).toHaveLength(2);
    const results = await Promise.all([0, 0].map(() => new Client(app).post('/v1/auth/password-reset/confirm', { token: tokens[0], password: 'another-long-passphrase' })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect((await c.post('/v1/auth/password-reset/confirm', { token: tokens[1], password: 'third-long-passphrase' })).status).toBe(400);
    expect((await c.login('locked@example.test', 'another-long-passphrase')).status).toBe(200);
  });
  it('failures before a successful sign-in do not count towards a lockout', async () => {
    await account('typo@example.test');
    const c = new Client(app);
    for (let i = 0; i < 4; i++) await c.login('typo@example.test', 'wrong-password-here');
    expect((await c.login('typo@example.test', PW)).status).toBe(200);
    await c.login('typo@example.test', 'wrong-password-here');
    expect((await c.login('typo@example.test', PW)).status).toBe(200);
  });
  it('a display name can be cleared, and other saves leave it alone', async () => {
    const c = await account('namer@example.test');
    await c.patch('/v1/me', { display_name: 'Asha' });
    await c.patch('/v1/me', { briefing_email: 'off' });
    expect((await c.get('/v1/me')).json.profile.display_name).toBe('Asha');
    await c.patch('/v1/me', { display_name: null });
    expect((await c.get('/v1/me')).json.profile.display_name).toBeNull();
  });
  it('simultaneous sign-ups for one address both get the neutral answer', async () => {
    const body = { email: 'race@example.test', password: PW, age_confirmed: true, accept_terms: true, accept_privacy: true };
    const r = await Promise.all([0, 0, 0].map(() => new Client(app).post('/v1/auth/signup', body)));
    expect(r.map((x) => x.status)).toEqual([202, 202, 202]);
  });
  it('the account export includes research hub content, and writes negative numbers as numbers', async () => {
    const c = await account('exporter@example.test');
    await c.post('/v1/research/notebook', { kind: 'note', title: 'Mine', body: 'text' });
    const e = await c.post('/v1/me/export');
    const file = JSON.parse((await ctx.store.get(`exports/${e.json.export_id}/atlas-export.json`)).toString());
    expect(file.research_notebook).toHaveLength(1);
    const { toCsv } = await import('../src/modules/exports/accountExport.js');
    expect(toCsv([{ n: -5, s: '-cmd' }])).toBe("n,s\n-5,'-cmd");
  });
  it('erasure removes mail, sessions, tokens and sign-in records', async () => {
    const c = await account('goner@example.test');
    const id = (await c.get('/v1/me')).json.profile.user_id;
    expect((await c.del('/v1/me', { password: PW, confirm: 'DELETE' })).status).toBe(200);
    await ctx.db.query(`UPDATE app.account_deletions SET erase_after=now() - interval '1 minute' WHERE user_id=$1`, [id]);
    const { runRetention } = await import('../src/bootstrap.js');
    await runRetention(ctx);
    for (const q of ['app.email_outbox', 'app.sessions', 'app.auth_tokens']) expect(await ctx.db.query(`SELECT 1 FROM ${q} WHERE user_id=$1`, [id]), q).toHaveLength(0);
    expect(await ctx.db.query(`SELECT 1 FROM app.login_attempts WHERE email='goner@example.test'`)).toHaveLength(0);
  });
});

describe('billing', () => {
  const subscribe = async (email: string) => {
    const c = await account(email);
    const co = await c.post('/v1/billing/checkout', { plan: 'plus', state_code: '29' });
    const gid = co.json.checkout.url.split('/').pop() as string;
    return { c, gid };
  };
  it('a webhook whose processing failed is processed when the gateway redelivers it', async () => {
    const { c, gid } = await subscribe('retry@example.test');
    const evt = { id: 'evt_retry_1', event: 'subscription.charged', created_at: 1, payload: { subscription: { id: gid, status: 'active', current_start: null, current_end: null }, payment: { id: 'pay_retry_1', amount: 1, status: 'captured', method: 'upi', subscription_id: gid } } };
    await ctx.db.query(`INSERT INTO app.webhook_events (event_id, gateway, event_type, payload, signature_valid, status, error) VALUES ('evt_retry_1','sandbox','subscription.charged','{}',true,'failed','database restarted')`);
    expect((await deliver(evt)).json().status).toBe('processed');
    expect((await deliver(evt)).json().status).toBe('duplicate');
    expect((await c.get('/v1/billing/payments')).json.payments).toHaveLength(1);
  });
  it('malformed webhook bodies are rejected, not errors', async () => {
    for (const payload of ['null', '[]', '"x"', '{}']) expect((await app.inject({ method: 'POST', url: '/webhooks/payments', payload, headers: { 'content-type': 'application/json' } })).statusCode).toBe(400);
  });
  it('a three-month coupon discounts exactly three charges', async () => {
    const { gid } = await subscribe('coupon@example.test');
    await ctx.db.query(`INSERT INTO app.coupons (code, description, percent_off, duration_months, max_redemptions, expires_at, beta_only) VALUES ('THREE','t',50,3,NULL,NULL,false) ON CONFLICT DO NOTHING`);
    const full = (await ctx.db.one<{ p: number }>(`SELECT price_inr_monthly AS p FROM app.plans WHERE plan_code='plus'`)).p;
    await ctx.db.query(`UPDATE app.subscriptions SET coupon_code='THREE', discount_months_left=3, price_inr=$2 WHERE gateway_subscription_id=$1`, [gid, full / 2]);
    for (let i = 1; i <= 5; i++) await deliver({ id: `evt_c${i}`, event: 'subscription.charged', created_at: i, payload: { subscription: { id: gid, status: 'active', current_start: null, current_end: null }, payment: { id: `pay_c${i}`, amount: 1, status: 'captured', method: 'upi', subscription_id: gid } } });
    const paid = await ctx.db.query<{ t: number }>(`SELECT taxable_inr AS t FROM app.payments WHERE gateway_payment_id LIKE 'pay_c_' ORDER BY gateway_payment_id`);
    expect(paid.map((x) => x.t)).toEqual([full / 2, full / 2, full / 2, full, full]);
  });
  it('a late failure notice does not revive an ended subscription, and closing an account stops the gateway', async () => {
    const { c, gid } = await subscribe('ended@example.test');
    await c.post(`/v1/sandbox/checkout/${gid}`, { outcome: 'success' });
    await ctx.db.query(`UPDATE app.subscriptions SET status='expired' WHERE gateway_subscription_id=$1`, [gid]);
    await c.post(`/v1/sandbox/checkout/${gid}`, { outcome: 'renewal_failure' });
    expect((await ctx.db.one<{ status: string }>(`SELECT status FROM app.subscriptions WHERE gateway_subscription_id=$1`, [gid])).status).toBe('expired');
    const two = await subscribe('closer@example.test');
    await two.c.post(`/v1/sandbox/checkout/${two.gid}`, { outcome: 'success' });
    await two.c.del('/v1/me', { password: PW, confirm: 'DELETE' });
    expect((await (ctx.payments as SandboxGateway).load(two.gid))!.mandate).toBe('revoked');
  });
  it('two refund clicks send one refund', async () => {
    const { c, gid } = await subscribe('refunded@example.test');
    await c.post(`/v1/sandbox/checkout/${gid}`, { outcome: 'success' });
    const { refundPayment } = await import('../src/modules/billing/service.js');
    const p = await ctx.db.one<{ payment_id: string }>(`SELECT payment_id FROM app.payments p JOIN app.users u USING (user_id) WHERE u.email='refunded@example.test'`);
    const admin = await ctx.db.one<{ user_id: string }>(`SELECT user_id FROM app.users WHERE email='admin@atlas.test'`);
    const r = await Promise.allSettled([0, 0].map(() => refundPayment(ctx, { userId: admin.user_id, role: 'admin' }, p.payment_id, 'Customer asked for it')));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  });
  it('a coupon the gateway cannot apply is refused, never shown as a discount', async () => {
    const c = await account('razor-coupon@example.test');
    await ctx.db.query(`INSERT INTO app.coupons (code, description, percent_off, duration_months, max_redemptions, expires_at, beta_only) VALUES ('NOOFFER','t',50,3,NULL,NULL,false) ON CONFLICT DO NOTHING`);
    const before = ctx.payments;
    ctx.payments = new RazorpayGateway('rzp_test_x', 's', 'w', { plus: 'plan_1', pro: 'plan_2' });
    try {
      const r = await c.post('/v1/billing/checkout', { plan: 'plus', state_code: '29', coupon: 'nooffer' }, { 'idempotency-key': 'razor-coupon-1' });
      expect(r.status).toBe(400);
    } finally { ctx.payments = before; }
  });
  it('Razorpay checkout sends the offer and returns the hosted payment page', async () => {
    const { vi } = await import('vitest');
    const sent: any[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: 'sub_9', short_url: 'https://rzp.io/i/x' }), { status: 200 }); });
    try {
      const g = new RazorpayGateway('rzp_test_x', 's', 'w', { plus: 'plan_1' }, { SAVE: 'offer_1' });
      const input = { subscriptionRef: 'r', planCode: 'plus', amountPaise: 100, customer: { userId: 'u', email: 'u@example.test' } };
      expect((await g.createSubscription({ ...input, couponCode: 'SAVE' })).checkout.url).toBe('https://rzp.io/i/x');
      await g.createSubscription(input);
      expect(sent[0]).toMatchObject({ plan_id: 'plan_1', offer_id: 'offer_1' });
      expect(sent[1]).not.toHaveProperty('offer_id');
      await expect(g.createSubscription({ ...input, couponCode: 'OTHER' })).rejects.toThrow(/offer/);
    } finally { vi.unstubAllGlobals(); }
  });
  it('reads Razorpay event envelopes', () => {
    const g = new RazorpayGateway('rzp_test_x', 's', 'w', {});
    const e = g.parseWebhook({ event: 'subscription.charged', created_at: 1, payload: { subscription: { entity: { id: 'sub_1' } }, payment: { entity: { id: 'pay_1' } } } }, 'evt_1');
    expect(e).toMatchObject({ id: 'evt_1', event: 'subscription.charged', payload: { subscription: { id: 'sub_1' }, payment: { id: 'pay_1' } } });
  });
});

describe('operations', () => {
  it('a slow job does not stop other jobs from running', async () => {
    const { vi } = await import('vitest');
    vi.useFakeTimers();
    try {
      let reads = 0;
      let release: () => void = () => undefined;
      const stuck = new Promise<void>((ok) => { release = ok; });
      const db = { query: async (sql: string) => { if (sql.includes('email_outbox')) { await stuck; } if (sql.includes("status IN ('pending','created')")) reads++; return []; }, maybeOne: async () => undefined, one: async () => ({}), tx: async () => undefined } as unknown as AppContext['db'];
      const stop = startBackgroundJobs({ ...ctx, db });
      await vi.advanceTimersByTimeAsync(10 * 60_000 + 10);
      stop();
      release();
      expect(reads).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('production accepts smtp only when it is complete', () => {
    const base = { NODE_ENV: 'production', DATABASE_URL: 'postgres://x', DATABASE_SSL: 'verify-full', DATABASE_CA_CERT: 'ca.pem', APP_SECRET: 'x'.repeat(40), PAYMENT_GATEWAY: 'razorpay', RAZORPAY_KEY_ID: 'a', RAZORPAY_KEY_SECRET: 'b', RAZORPAY_WEBHOOK_SECRET: 'c', RAZORPAY_PLAN_IDS: '{"plus":"plan_1","pro":"plan_2"}', WEB_ORIGIN: 'https://atlas.example', EMAIL_TRANSPORT: 'smtp' } as NodeJS.ProcessEnv;
    expect(() => loadConfig(base)).toThrow(/SMTP_URL/);
    expect(() => loadConfig({ ...base, SMTP_URL: 'smtps://u:p@mail.example', EMAIL_FROM: 'a@b.example' })).not.toThrow();
    expect(() => loadConfig({ ...base, EMAIL_TRANSPORT: 'ses' })).toThrow();
    expect(DEV_PASSWORD.length).toBeGreaterThan(10);
  });
});
