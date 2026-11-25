import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/db.js';
import { hmacSha256Hex, safeEqualHex } from '../../lib/crypto.js';
import { unavailable } from '../../lib/http.js';

// Payment gateway boundary (PRD BIL-02, Blueprint §4.3, §7.5). ATLAS never sees card numbers or
// UPI credentials: checkout happens on the gateway's page; ATLAS learns the outcome only through
// signed webhooks and gateway API reads.

export interface CreateSubscriptionInput {
  subscriptionRef: string;
  planCode: string;
  amountPaise: number;
  customer: { userId: string; email: string };
  couponCode?: string | null;
}

export interface GatewaySubscriptionState {
  status: 'created' | 'authenticated' | 'active' | 'pending' | 'halted' | 'cancelled' | 'completed';
  currentStart: string | null;
  currentEnd: string | null;
  lastPaymentId: string | null;
}

export interface PaymentGateway {
  readonly name: 'sandbox' | 'razorpay';
  readonly isSandbox: boolean;
  /** Whether the gateway will actually charge less for this coupon. A discount it cannot apply must not be shown to the customer. */
  supportsCoupon(code: string): boolean;
  createSubscription(input: CreateSubscriptionInput): Promise<{ gatewaySubscriptionId: string; checkout: { url?: string; razorpay?: { key_id: string; subscription_id: string } } }>;
  cancelSubscription(gatewaySubscriptionId: string, atPeriodEnd: boolean): Promise<void>;
  chargeOneTime(input: { userId: string; amountPaise: number; description: string; subscriptionId: string }): Promise<{ gatewayPaymentId: string; status: 'captured' | 'failed' }>;
  refund(gatewayPaymentId: string, amountPaise: number): Promise<{ refundId: string }>;
  fetchSubscription(gatewaySubscriptionId: string): Promise<GatewaySubscriptionState>;
  verifyWebhook(rawBody: string, signature: string | undefined): boolean;
  /** Normalise the gateway's own event JSON. `eventId` is the delivery id from its HTTP header, when it sends one. */
  parseWebhook(raw: Record<string, unknown>, eventId?: string): WebhookEvent;
}

export interface WebhookEvent {
  id: string;
  event: 'subscription.authenticated' | 'subscription.activated' | 'subscription.charged' | 'subscription.pending' | 'subscription.halted' | 'subscription.cancelled' | 'payment.failed' | 'refund.processed';
  created_at: number;
  payload: {
    subscription?: { id: string; status: string; current_start: number | null; current_end: number | null };
    payment?: { id: string; amount: number; status: string; method: string; subscription_id?: string; error_description?: string };
    refund?: { id: string; payment_id: string; amount: number };
  };
}

/**
 * Sandbox gateway (development and tests). It behaves like a subscription gateway: a checkout
 * page where the tester chooses an outcome, signed webhook delivery (optionally duplicated or
 * delayed to exercise idempotency and reconciliation) and API reads. No money moves.
 */
export class SandboxGateway implements PaymentGateway {
  readonly name = 'sandbox' as const;
  readonly isSandbox = true;
  constructor(private readonly db: Db, private readonly secret: string, private readonly webOrigin: string, private readonly clock: () => Date = () => new Date()) {}

  private async save(id: string, kind: 'subscription' | 'payment' | 'refund', data: Record<string, unknown>) {
    await this.db.query(`INSERT INTO ops.sandbox_gateway (object_id, kind, data) VALUES ($1,$2,$3) ON CONFLICT (object_id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`, [id, kind, JSON.stringify(data)]);
  }
  async load(id: string): Promise<Record<string, unknown> | undefined> {
    return (await this.db.maybeOne<{ data: Record<string, unknown> }>(`SELECT data FROM ops.sandbox_gateway WHERE object_id=$1`, [id]))?.data;
  }

  supportsCoupon() {
    return true;
  }
  async createSubscription(input: CreateSubscriptionInput) {
    const id = `sub_sbx_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
    await this.save(id, 'subscription', { ...input, status: 'created', current_start: null, current_end: null, last_payment_id: null });
    return { gatewaySubscriptionId: id, checkout: { url: `${this.webOrigin}/sandbox/checkout/${id}` } };
  }
  async cancelSubscription(id: string, atPeriodEnd: boolean) {
    const s = await this.load(id);
    if (!s) return;
    await this.save(id, 'subscription', { ...s, cancel_at_cycle_end: atPeriodEnd, status: atPeriodEnd ? s.status : 'cancelled', mandate: 'revoked' });
  }
  async chargeOneTime(input: { userId: string; amountPaise: number; description: string; subscriptionId: string }) {
    const id = `pay_sbx_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
    await this.save(id, 'payment', { ...input, status: 'captured', method: 'upi' });
    return { gatewayPaymentId: id, status: 'captured' as const };
  }
  async refund(paymentId: string, amountPaise: number) {
    const id = `rfnd_sbx_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
    await this.save(id, 'refund', { payment_id: paymentId, amount: amountPaise });
    return { refundId: id };
  }
  async fetchSubscription(id: string): Promise<GatewaySubscriptionState> {
    const s = await this.load(id);
    if (!s) return { status: 'created', currentStart: null, currentEnd: null, lastPaymentId: null };
    return { status: s.status as GatewaySubscriptionState['status'], currentStart: (s.current_start as string) ?? null, currentEnd: (s.current_end as string) ?? null, lastPaymentId: (s.last_payment_id as string) ?? null };
  }
  verifyWebhook(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;
    return safeEqualHex(hmacSha256Hex(this.secret, rawBody), signature);
  }

  parseWebhook(raw: Record<string, unknown>): WebhookEvent {
    return raw as unknown as WebhookEvent;
  }

  sign(body: string): string {
    return hmacSha256Hex(this.secret, body);
  }

  /** Simulate the tester's choice on the sandbox checkout page; returns the signed events the gateway would send. */
  async simulate(id: string, outcome: 'success' | 'failure' | 'pending' | 'renewal_success' | 'renewal_failure' | 'halt', method: 'upi' | 'card' = 'upi'): Promise<{ events: { body: string; signature: string }[] }> {
    const s = await this.load(id);
    if (!s) throw new Error('Unknown sandbox subscription');
    const now = this.clock();
    const events: WebhookEvent[] = [];
    const amount = Number(s.amountPaise);
    const mk = (event: WebhookEvent['event'], payload: WebhookEvent['payload']): WebhookEvent => ({ id: `evt_sbx_${randomUUID().replace(/-/g, '').slice(0, 16)}`, event, created_at: Math.floor(now.getTime() / 1000), payload });
    const periodFrom = (start: Date) => ({ current_start: Math.floor(start.getTime() / 1000), current_end: Math.floor(addMonth(start).getTime() / 1000) });
    if (outcome === 'success' || outcome === 'renewal_success') {
      const start = outcome === 'success' || !s.current_end ? now : new Date(String(s.current_end));
      const pid = `pay_sbx_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
      const p = periodFrom(start);
      await this.save(pid, 'payment', { subscription_id: id, amount, status: 'captured', method });
      await this.save(id, 'subscription', { ...s, status: 'active', current_start: new Date(p.current_start * 1000).toISOString(), current_end: new Date(p.current_end * 1000).toISOString(), last_payment_id: pid });
      if (outcome === 'success') events.push(mk('subscription.activated', { subscription: { id, status: 'active', ...p } }));
      events.push(mk('subscription.charged', { subscription: { id, status: 'active', ...p }, payment: { id: pid, amount, status: 'captured', method, subscription_id: id } }));
    } else if (outcome === 'failure' || outcome === 'renewal_failure') {
      const pid = `pay_sbx_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
      events.push(mk('payment.failed', { payment: { id: pid, amount, status: 'failed', method, subscription_id: id, error_description: 'Payment declined in sandbox' } }));
      if (outcome === 'renewal_failure') events.push(mk('subscription.pending', { subscription: { id, status: 'pending', current_start: null, current_end: null } }));
    } else if (outcome === 'pending') {
      await this.save(id, 'subscription', { ...s, status: 'authenticated' });
      events.push(mk('subscription.authenticated', { subscription: { id, status: 'authenticated', current_start: null, current_end: null } }));
    } else if (outcome === 'halt') {
      await this.save(id, 'subscription', { ...s, status: 'halted' });
      events.push(mk('subscription.halted', { subscription: { id, status: 'halted', current_start: null, current_end: null } }));
    }
    return { events: events.map((e) => { const body = JSON.stringify(e); return { body, signature: this.sign(body) }; }) };
  }

  async refundEvent(refundId: string): Promise<{ body: string; signature: string }> {
    const r = await this.load(refundId);
    const e: WebhookEvent = { id: `evt_sbx_${randomUUID().replace(/-/g, '').slice(0, 16)}`, event: 'refund.processed', created_at: Math.floor(this.clock().getTime() / 1000), payload: { refund: { id: refundId, payment_id: String(r?.payment_id), amount: Number(r?.amount) } } };
    const body = JSON.stringify(e);
    return { body, signature: this.sign(body) };
  }
}

function addMonth(d: Date): Date {
  const x = new Date(d.getTime());
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + 1);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, last));
  return x;
}

/**
 * Razorpay Subscriptions adapter. Written against Razorpay's published REST API (subscriptions,
 * refunds, webhook signature = hex HMAC-SHA256 of the raw body). NOT yet exercised against a live
 * Razorpay test account — blocked on account creation (BLOCKERS.md B-PAY-01). Plans must be created
 * in the Razorpay dashboard; their ids are supplied through RAZORPAY_PLAN_IDS (JSON map plan -> plan id). A coupon
 * works only if a matching offer exists there and is listed in RAZORPAY_OFFER_IDS (JSON map coupon code -> offer id).
 */
export class RazorpayGateway implements PaymentGateway {
  readonly name = 'razorpay' as const;
  readonly isSandbox: boolean;
  private readonly base = 'https://api.razorpay.com/v1';
  constructor(private readonly keyId: string, private readonly keySecret: string, private readonly webhookSecret: string, private readonly planIds: Record<string, string>, private readonly offerIds: Record<string, string> = {}) {
    this.isSandbox = keyId.startsWith('rzp_test_');
  }
  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}` }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Razorpay ${method} ${path} failed with ${res.status}`);
    return (await res.json()) as T;
  }
  supportsCoupon(code: string) {
    return Object.hasOwn(this.offerIds, code);
  }
  async createSubscription(input: CreateSubscriptionInput) {
    if (input.couponCode && !this.supportsCoupon(input.couponCode)) throw new Error(`No Razorpay offer id configured for coupon ${input.couponCode}`);
    const planId = this.planIds[input.planCode];
    if (!planId) throw new Error(`No Razorpay plan id configured for ${input.planCode}`);
    const r = await this.call<{ id: string; short_url?: string }>('POST', '/subscriptions', { plan_id: planId, total_count: 120, customer_notify: 1, ...(input.couponCode ? { offer_id: this.offerIds[input.couponCode] } : {}), notes: { atlas_subscription: input.subscriptionRef, user_id: input.customer.userId } });
    // The hosted payment page: the web app sends the customer to checkout.url.
    return { gatewaySubscriptionId: r.id, checkout: { url: r.short_url, razorpay: { key_id: this.keyId, subscription_id: r.id } } };
  }
  async cancelSubscription(id: string, atPeriodEnd: boolean) {
    await this.call('POST', `/subscriptions/${id}/cancel`, { cancel_at_cycle_end: atPeriodEnd ? 1 : 0 });
  }
  async chargeOneTime(): Promise<{ gatewayPaymentId: string; status: 'captured' | 'failed' }> {
    // Razorpay subscriptions handle upgrades through subscription updates; proration is invoiced
    // via an add-on on the next charge. Not available until the live account is configured.
    throw unavailable('Upgrading mid-period is not available yet. Your current plan is unchanged.', { blocker: 'B-PAY-01' });
  }
  async refund(paymentId: string, amountPaise: number) {
    const r = await this.call<{ id: string }>('POST', `/payments/${paymentId}/refund`, { amount: amountPaise });
    return { refundId: r.id };
  }
  async fetchSubscription(id: string): Promise<GatewaySubscriptionState> {
    const r = await this.call<{ status: GatewaySubscriptionState['status']; current_start: number | null; current_end: number | null }>('GET', `/subscriptions/${id}`);
    return { status: r.status, currentStart: r.current_start ? new Date(r.current_start * 1000).toISOString() : null, currentEnd: r.current_end ? new Date(r.current_end * 1000).toISOString() : null, lastPaymentId: null };
  }
  verifyWebhook(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;
    return safeEqualHex(hmacSha256Hex(this.webhookSecret, rawBody), signature);
  }
  /** Razorpay wraps each object as payload.<kind>.entity and sends the event id only as an HTTP header. */
  parseWebhook(raw: Record<string, unknown>, eventId?: string): WebhookEvent {
    const payload = (raw.payload ?? {}) as Record<string, { entity?: Record<string, unknown> } | undefined>;
    const unwrap = (k: string) => payload[k]?.entity;
    return { id: eventId ?? '', event: raw.event, created_at: raw.created_at, payload: { subscription: unwrap('subscription'), payment: unwrap('payment'), refund: unwrap('refund') } } as unknown as WebhookEvent;
  }
}
