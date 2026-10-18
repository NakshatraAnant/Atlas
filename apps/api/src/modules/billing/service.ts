import { fiscalYearOf, formatRupees, fyLabel, type PlanCode } from '@atlas/shared';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/db.js';
import { badRequest, conflict, notFound } from '../../lib/http.js';
import { track } from '../analytics/events.js';
import { audit } from '../ops/audit.js';
import { queueEmail } from '../notify/email.js';
import type { WebhookEvent } from './gateway.js';

// Subscription lifecycle (PRD BIL-02..BIL-08). Every state change is driven by a verified,
// idempotent webhook or by reconciliation against the gateway — never by the browser.

export const GRACE_DAYS = 7;
export const REFUND_WINDOW_DAYS = 7;
/** SAC code and invoice layout are pending chartered-accountant approval (BIL-03, BLOCKERS B-GST-01). */
export const SAC_CODE_PENDING = 'PENDING-CA-APPROVAL';

export interface GstSplit {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** GST on an exclusive price; intra-state → CGST + SGST halves, inter-state → IGST (place of supply). */
export function gstSplit(taxable: number, rate: number, supplierState: string, placeOfSupply: string): GstSplit {
  const t = r2(taxable);
  if (placeOfSupply === supplierState) {
    const half = r2((t * rate) / 2);
    return { taxable: t, cgst: half, sgst: half, igst: 0, total: r2(t + 2 * half) };
  }
  const igst = r2(t * rate);
  return { taxable: t, cgst: 0, sgst: 0, igst, total: r2(t + igst) };
}

export function prorationAmount(oldPrice: number, newPrice: number, periodStart: string, periodEnd: string, now: Date): number {
  const total = Date.parse(periodEnd) - Date.parse(periodStart);
  const remaining = Math.max(0, Date.parse(periodEnd) - now.getTime());
  if (total <= 0 || newPrice <= oldPrice) return 0;
  return r2((newPrice - oldPrice) * (remaining / total));
}

async function nextInvoiceNumber(db: Db, fiscalYear: number, docType: 'invoice' | 'credit_note'): Promise<{ number: string; seq: number }> {
  await db.query(`INSERT INTO app.invoice_sequences (fiscal_year, doc_type, last_seq) VALUES ($1,$2,0) ON CONFLICT DO NOTHING`, [fiscalYear, docType]);
  const r = await db.one<{ last_seq: number }>(`UPDATE app.invoice_sequences SET last_seq = last_seq + 1 WHERE fiscal_year=$1 AND doc_type=$2 RETURNING last_seq`, [fiscalYear, docType]);
  const prefix = docType === 'invoice' ? 'ATL' : 'ATL-CN';
  return { number: `${prefix}/${fyLabel(fiscalYear)}/${String(r.last_seq).padStart(6, '0')}`, seq: r.last_seq };
}

export async function issueInvoice(ctx: AppContext, db: Db, input: { userId: string; paymentId: string; docType: 'invoice' | 'credit_note'; taxable: number; description: string; placeOfSupply: string; buyerName: string | null; buyerGstin: string | null; relatedInvoiceId?: string | null; at: Date }): Promise<string> {
  const istDate = new Date(input.at.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const fy = fiscalYearOf(istDate);
  const split = gstSplit(input.taxable, ctx.cfg.GST_RATE, ctx.cfg.SUPPLIER_STATE_CODE, input.placeOfSupply);
  const { number, seq } = await nextInvoiceNumber(db, fy, input.docType);
  const sign = input.docType === 'credit_note' ? -1 : 1;
  const row = await db.one<{ invoice_id: string }>(
    `INSERT INTO app.invoices (invoice_number, doc_type, fiscal_year, seq, user_id, payment_id, related_invoice_id, issued_at, supplier_state_code, place_of_supply_state, buyer_name, buyer_gstin, sac_code, taxable_value, cgst, sgst, igst, total, lines, approval_status, is_sandbox)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'template_pending_ca_approval',$20) RETURNING invoice_id`,
    [number, input.docType, fy, seq, input.userId, input.paymentId, input.relatedInvoiceId ?? null, input.at.toISOString(), ctx.cfg.SUPPLIER_STATE_CODE, input.placeOfSupply, input.buyerName, input.buyerGstin, SAC_CODE_PENDING,
      sign * split.taxable, sign * split.cgst, sign * split.sgst, sign * split.igst, sign * split.total, JSON.stringify([{ description: input.description, taxable: sign * split.taxable }]), ctx.payments.isSandbox],
  );
  return row.invoice_id;
}

export async function planPrice(db: Db, plan: PlanCode): Promise<number> {
  const p = await db.maybeOne<{ price_inr_monthly: number }>(`SELECT price_inr_monthly FROM app.plans WHERE plan_code=$1 AND active`, [plan]);
  if (!p) throw badRequest('Unknown plan.');
  return p.price_inr_monthly;
}

export async function startCheckout(ctx: AppContext, user: { userId: string; email: string }, input: { plan: PlanCode; coupon?: string; stateCode: string; buyerName?: string; gstin?: string }): Promise<{ subscriptionId: string; checkout: unknown; amount: { taxable: number; gst: number; total: number; discount: number } }> {
  if (input.plan === 'free') throw badRequest('The Free plan needs no checkout.');
  if (input.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(input.gstin)) throw badRequest('The GSTIN format is not valid.');
  const live = await ctx.db.maybeOne<{ subscription_id: string; status: string; plan_code: string }>(`SELECT subscription_id, status, plan_code FROM app.subscriptions WHERE user_id=$1 AND status IN ('created','pending','active','past_due')`, [user.userId]);
  if (live && ['active', 'past_due'].includes(live.status)) throw conflict('You already have a subscription. Change plan from Billing instead.');
  let price = await planPrice(ctx.db, input.plan);
  let discount = 0;
  let couponCode: string | null = null;
  let months = 0;
  const u = await ctx.db.one<{ is_beta: boolean; founding_member: boolean }>(`SELECT is_beta, founding_member FROM app.users WHERE user_id=$1`, [user.userId]);
  const code = input.coupon?.trim().toUpperCase() || (u.is_beta ? 'FOUNDING' : undefined);
  if (code) {
    const c = await ctx.db.maybeOne<{ code: string; percent_off: number | null; amount_off_inr: number | null; duration_months: number; max_redemptions: number | null; redeemed: number; expires_at: string | null; applies_to: string[]; beta_only: boolean }>(`SELECT * FROM app.coupons WHERE code=$1`, [code]);
    const valid = c && (!c.expires_at || c.expires_at > ctx.clock().toISOString()) && (c.max_redemptions === null || c.redeemed < c.max_redemptions) && c.applies_to.includes(input.plan) && (!c.beta_only || u.is_beta);
    if (!valid && input.coupon) throw badRequest('This coupon cannot be applied.');
    if (valid && c) {
      discount = r2(c.percent_off ? (price * c.percent_off) / 100 : Math.min(price, c.amount_off_inr ?? 0));
      couponCode = c.code;
      months = c.duration_months;
    }
  }
  price = r2(price - discount);
  const split = gstSplit(price, ctx.cfg.GST_RATE, ctx.cfg.SUPPLIER_STATE_CODE, input.stateCode);
  const sub = live?.status === 'created' || live?.status === 'pending'
    ? (await ctx.db.one<{ subscription_id: string }>(`UPDATE app.subscriptions SET plan_code=$2, price_inr=$3, coupon_code=$4, discount_months_left=$5, place_of_supply_state=$6, buyer_name=$7, buyer_gstin=$8, updated_at=now() WHERE subscription_id=$1 RETURNING subscription_id`, [live.subscription_id, input.plan, price, couponCode, months, input.stateCode, input.buyerName ?? null, input.gstin ?? null]))
    : await ctx.db.one<{ subscription_id: string }>(`INSERT INTO app.subscriptions (user_id, plan_code, status, gateway, price_inr, coupon_code, discount_months_left, place_of_supply_state, buyer_name, buyer_gstin) VALUES ($1,$2,'created',$3,$4,$5,$6,$7,$8,$9) RETURNING subscription_id`, [user.userId, input.plan, ctx.payments.name, price, couponCode, months, input.stateCode, input.buyerName ?? null, input.gstin ?? null]);
  const g = await ctx.payments.createSubscription({ subscriptionRef: sub.subscription_id, planCode: input.plan, amountPaise: Math.round(split.total * 100), customer: user });
  await ctx.db.query(`UPDATE app.subscriptions SET gateway_subscription_id=$2, status='pending', mandate_status='pending' WHERE subscription_id=$1`, [sub.subscription_id, g.gatewaySubscriptionId]);
  await track(ctx.db, 'checkout_started', { plan: input.plan, coupon: couponCode ?? undefined }, { userId: user.userId, origin: 'server' });
  return { subscriptionId: sub.subscription_id, checkout: g.checkout, amount: { taxable: split.taxable, gst: r2(split.total - split.taxable), total: split.total, discount } };
}

/** Process one verified gateway event idempotently (BIL-02). Returns what happened. */
export async function processWebhook(ctx: AppContext, rawBody: string, signature: string | undefined): Promise<{ status: 'processed' | 'duplicate' | 'rejected' | 'ignored'; eventId?: string }> {
  const valid = ctx.payments.verifyWebhook(rawBody, signature);
  let evt: WebhookEvent;
  try {
    evt = JSON.parse(rawBody) as WebhookEvent;
  } catch {
    return { status: 'rejected' };
  }
  if (!valid) {
    await ctx.db.query(`INSERT INTO app.webhook_events (event_id, gateway, event_type, payload, signature_valid, status, error) VALUES ($1,$2,$3,$4,false,'rejected','invalid signature') ON CONFLICT DO NOTHING`, [`rejected:${evt.id ?? Date.now()}:${Date.now()}`, ctx.payments.name, String(evt.event ?? 'unknown'), rawBody.slice(0, 5000)]);
    ctx.log.warn('webhook signature rejected', { gateway: ctx.payments.name });
    return { status: 'rejected' };
  }
  // Store first, then process; a duplicate delivery hits the primary key and is a no-op.
  const stored = await ctx.db.query(`INSERT INTO app.webhook_events (event_id, gateway, event_type, payload, signature_valid, status) VALUES ($1,$2,$3,$4,true,'received') ON CONFLICT (event_id) DO NOTHING RETURNING event_id`, [evt.id, ctx.payments.name, evt.event, rawBody]);
  if (!stored.length) return { status: 'duplicate', eventId: evt.id };
  try {
    const handled = await ctx.db.tx((db) => applyEvent(ctx, db, evt));
    await ctx.db.query(`UPDATE app.webhook_events SET status=$2, processed_at=now() WHERE event_id=$1`, [evt.id, handled ? 'processed' : 'ignored']);
    return { status: handled ? 'processed' : 'ignored', eventId: evt.id };
  } catch (err) {
    await ctx.db.query(`UPDATE app.webhook_events SET status='failed', error=$2 WHERE event_id=$1`, [evt.id, err instanceof Error ? err.message : String(err)]);
    throw err;
  }
}

async function subByGateway(db: Db, gatewaySubscriptionId: string | undefined) {
  if (!gatewaySubscriptionId) return undefined;
  return db.maybeOne<{ subscription_id: string; user_id: string; plan_code: PlanCode; status: string; price_inr: number; place_of_supply_state: string | null; buyer_name: string | null; buyer_gstin: string | null; first_charge_at: string | null; scheduled_plan_code: PlanCode | null; discount_months_left: number; coupon_code: string | null; email: string }>(
    `SELECT s.*, u.email FROM app.subscriptions s JOIN app.users u USING (user_id) WHERE s.gateway_subscription_id=$1 FOR UPDATE OF s`,
    [gatewaySubscriptionId],
  );
}

async function notify(db: Db, userId: string, kind: string, title: string, body: string, href?: string) {
  await db.query(`INSERT INTO app.notifications (user_id, kind, title, body, href) VALUES ($1,$2,$3,$4,$5)`, [userId, kind, title, body, href ?? null]);
}

async function applyEvent(ctx: AppContext, db: Db, evt: WebhookEvent): Promise<boolean> {
  const now = ctx.clock();
  const s = evt.payload.subscription;
  const p = evt.payload.payment;
  switch (evt.event) {
    case 'subscription.authenticated': {
      const sub = await subByGateway(db, s?.id);
      if (!sub) return false;
      await db.query(`UPDATE app.subscriptions SET status='pending', mandate_status='active', updated_at=now() WHERE subscription_id=$1 AND status IN ('created','pending')`, [sub.subscription_id]);
      return true;
    }
    case 'subscription.activated':
      // Entitlements switch on with the first successful charge (subscription.charged).
      return !!(await subByGateway(db, s?.id));
    case 'subscription.charged': {
      const sub = await subByGateway(db, s?.id ?? p?.subscription_id);
      if (!sub || !p) return false;
      const existing = await db.maybeOne(`SELECT 1 FROM app.payments WHERE gateway_payment_id=$1`, [p.id]);
      if (existing) return true;
      const periodStart = s?.current_start ? new Date(s.current_start * 1000).toISOString() : now.toISOString();
      const periodEnd = s?.current_end ? new Date(s.current_end * 1000).toISOString() : new Date(now.getTime() + 30 * 86_400_000).toISOString();
      // Renewal: apply a scheduled downgrade, step down a discount.
      const isRenewal = !!sub.first_charge_at;
      const plan = isRenewal && sub.scheduled_plan_code ? sub.scheduled_plan_code : sub.plan_code;
      let taxable = isRenewal && sub.scheduled_plan_code ? await planPrice(db, plan) : sub.price_inr;
      if (isRenewal && sub.discount_months_left <= 1 && sub.coupon_code) taxable = await planPrice(db, plan);
      const split = gstSplit(taxable, ctx.cfg.GST_RATE, ctx.cfg.SUPPLIER_STATE_CODE, sub.place_of_supply_state ?? ctx.cfg.SUPPLIER_STATE_CODE);
      const pay = await db.one<{ payment_id: string }>(
        `INSERT INTO app.payments (user_id, subscription_id, gateway_payment_id, kind, taxable_inr, gst_inr, amount_inr, status, method, is_sandbox) VALUES ($1,$2,$3,'charge',$4,$5,$6,'captured',$7,$8) RETURNING payment_id`,
        [sub.user_id, sub.subscription_id, p.id, split.taxable, r2(split.total - split.taxable), split.total, p.method, ctx.payments.isSandbox],
      );
      await db.query(
        `UPDATE app.subscriptions SET status='active', plan_code=$2, price_inr=$3, current_period_start=$4, current_period_end=$5, grace_until=NULL, scheduled_plan_code=NULL, mandate_status='active',
           first_charge_at=COALESCE(first_charge_at, $6), discount_months_left=greatest(0, discount_months_left - 1), updated_at=now() WHERE subscription_id=$1`,
        [sub.subscription_id, plan, taxable, periodStart, periodEnd, now.toISOString()],
      );
      if (!isRenewal && sub.coupon_code) await db.query(`UPDATE app.coupons SET redeemed = redeemed + 1 WHERE code=$1`, [sub.coupon_code]);
      const invoiceId = await issueInvoice(ctx, db, { userId: sub.user_id, paymentId: pay.payment_id, docType: 'invoice', taxable: split.taxable, description: `ATLAS ${plan === 'pro' ? 'Pro Research' : 'Plus'} subscription, ${periodStart.slice(0, 10)} to ${periodEnd.slice(0, 10)}`, placeOfSupply: sub.place_of_supply_state ?? ctx.cfg.SUPPLIER_STATE_CODE, buyerName: sub.buyer_name, buyerGstin: sub.buyer_gstin, at: now });
      await db.query(`UPDATE app.invoices SET emailed_at=now() WHERE invoice_id=$1`, [invoiceId]);
      await queueEmail(db, { to: sub.email, userId: sub.user_id, template: 'invoice', category: 'billing', subject: `ATLAS payment received — ${formatRupees(split.total, 2)}`, text: `Thank you. Your ${plan === 'pro' ? 'Pro Research' : 'Plus'} plan is active until ${periodEnd.slice(0, 10)}. Your tax invoice is available under Billing: /app/billing/invoices/${invoiceId}${ctx.payments.isSandbox ? '\n\nSANDBOX: no money moved; this is a test transaction.' : ''}` });
      if (!isRenewal) await track(db, 'subscription_started', { plan, payment_method: p.method, coupon: sub.coupon_code ?? undefined }, { userId: sub.user_id, origin: 'server' });
      return true;
    }
    case 'payment.failed': {
      const sub = await subByGateway(db, p?.subscription_id);
      if (!sub) return false;
      if (!sub.first_charge_at) {
        // First payment failed: stay pending; the user can retry with another method (J9).
        await notify(db, sub.user_id, 'payment_failed', 'Payment did not go through', 'Your payment was declined. You can retry with a different method from the pricing page.', '/app/billing');
        return true;
      }
      const grace = new Date(now.getTime() + GRACE_DAYS * 86_400_000).toISOString();
      await db.query(`UPDATE app.subscriptions SET status='past_due', grace_until=COALESCE(grace_until, $2), updated_at=now() WHERE subscription_id=$1`, [sub.subscription_id, grace]);
      await queueEmail(db, { to: sub.email, userId: sub.user_id, template: 'dunning', category: 'billing', subject: 'ATLAS renewal payment failed', text: `We could not collect your renewal payment. The gateway will retry on its schedule. You keep full access for ${GRACE_DAYS} days; after that your plan moves to Free and all your saved work is kept.` });
      await notify(db, sub.user_id, 'payment_failed', 'Renewal payment failed', `Full access continues for ${GRACE_DAYS} days while the payment is retried. Update your payment method from Billing.`, '/app/billing');
      return true;
    }
    case 'subscription.pending':
      return true;
    case 'subscription.halted': {
      const sub = await subByGateway(db, s?.id);
      if (!sub) return false;
      await db.query(`UPDATE app.subscriptions SET status='halted', mandate_status='revoked', updated_at=now() WHERE subscription_id=$1`, [sub.subscription_id]);
      await notify(db, sub.user_id, 'downgraded', 'Your plan moved to Free', 'Renewal payments failed after the grace period. Your saved work is kept; content above Free limits is read-only.', '/app/billing');
      return true;
    }
    case 'subscription.cancelled': {
      const sub = await subByGateway(db, s?.id);
      if (!sub) return false;
      await db.query(`UPDATE app.subscriptions SET mandate_status='revoked', updated_at=now() WHERE subscription_id=$1`, [sub.subscription_id]);
      return true;
    }
    case 'refund.processed': {
      const rf = evt.payload.refund;
      if (!rf) return false;
      const orig = await db.maybeOne<{ payment_id: string; user_id: string; subscription_id: string | null; taxable_inr: number; amount_inr: number }>(`SELECT payment_id, user_id, subscription_id, taxable_inr, amount_inr FROM app.payments WHERE gateway_payment_id=$1`, [rf.payment_id]);
      if (!orig) return false;
      const dup = await db.maybeOne(`SELECT 1 FROM app.payments WHERE gateway_payment_id=$1`, [rf.id]);
      if (dup) return true;
      const share = rf.amount / Math.round(orig.amount_inr * 100);
      const taxable = r2(orig.taxable_inr * share);
      const refundRow = await db.one<{ payment_id: string }>(
        `INSERT INTO app.payments (user_id, subscription_id, gateway_payment_id, kind, taxable_inr, gst_inr, amount_inr, status, is_sandbox, refund_of) VALUES ($1,$2,$3,'refund',$4,$5,$6,'refunded',$7,$8) RETURNING payment_id`,
        [orig.user_id, orig.subscription_id, rf.id, -taxable, -r2(rf.amount / 100 - taxable), -r2(rf.amount / 100), ctx.payments.isSandbox, orig.payment_id],
      );
      await db.query(`UPDATE app.payments SET status='refunded' WHERE payment_id=$1`, [orig.payment_id]);
      const inv = await db.maybeOne<{ invoice_id: string; place_of_supply_state: string; buyer_name: string | null; buyer_gstin: string | null }>(`SELECT invoice_id, place_of_supply_state, buyer_name, buyer_gstin FROM app.invoices WHERE payment_id=$1 AND doc_type='invoice'`, [orig.payment_id]);
      await issueInvoice(ctx, db, { userId: orig.user_id, paymentId: refundRow.payment_id, docType: 'credit_note', taxable, description: 'Refund (credit note)', placeOfSupply: inv?.place_of_supply_state ?? ctx.cfg.SUPPLIER_STATE_CODE, buyerName: inv?.buyer_name ?? null, buyerGstin: inv?.buyer_gstin ?? null, relatedInvoiceId: inv?.invoice_id ?? null, at: now });
      return true;
    }
  }
  return false;
}

export async function changePlan(ctx: AppContext, user: { userId: string; email: string; role: string }, target: PlanCode): Promise<{ effective: 'immediately' | 'period_end'; prorationInr?: number; effectiveOn?: string }> {
  const sub = await ctx.db.maybeOne<{ subscription_id: string; plan_code: PlanCode; status: string; price_inr: number; current_period_start: string; current_period_end: string; place_of_supply_state: string | null; buyer_name: string | null; buyer_gstin: string | null; gateway_subscription_id: string }>(`SELECT * FROM app.subscriptions WHERE user_id=$1 AND status IN ('active','past_due')`, [user.userId]);
  if (!sub) throw notFound('No active subscription to change. Choose a plan on the pricing page.');
  if (target === sub.plan_code) throw badRequest('You are already on this plan.');
  const rank = { free: 0, plus: 1, pro: 2 };
  if (rank[target] > rank[sub.plan_code]) {
    const newPrice = await planPrice(ctx.db, target);
    const now = ctx.clock();
    const taxable = prorationAmount(sub.price_inr, newPrice, sub.current_period_start, sub.current_period_end, now);
    const split = gstSplit(taxable, ctx.cfg.GST_RATE, ctx.cfg.SUPPLIER_STATE_CODE, sub.place_of_supply_state ?? ctx.cfg.SUPPLIER_STATE_CODE);
    // External side effects never run inside a database transaction; the captured charge is
    // recorded immediately afterwards (reconciliation covers a crash between the two steps).
    let charge: { gatewayPaymentId: string; status: 'captured' | 'failed' } | null = null;
    if (taxable > 0) {
      charge = await ctx.payments.chargeOneTime({ userId: user.userId, amountPaise: Math.round(split.total * 100), description: `Upgrade to ${target} (prorated)`, subscriptionId: sub.gateway_subscription_id });
      if (charge.status !== 'captured') throw badRequest('The prorated upgrade charge did not go through. Try another payment method.');
    }
    await ctx.db.tx(async (db) => {
      if (charge) {
        const pay = await db.one<{ payment_id: string }>(`INSERT INTO app.payments (user_id, subscription_id, gateway_payment_id, kind, taxable_inr, gst_inr, amount_inr, status, method, is_sandbox) VALUES ($1,$2,$3,'proration',$4,$5,$6,'captured','mandate',$7) RETURNING payment_id`, [user.userId, sub.subscription_id, charge.gatewayPaymentId, split.taxable, r2(split.total - split.taxable), split.total, ctx.payments.isSandbox]);
        await issueInvoice(ctx, db, { userId: user.userId, paymentId: pay.payment_id, docType: 'invoice', taxable: split.taxable, description: `Prorated upgrade to ${target === 'pro' ? 'Pro Research' : 'Plus'} until ${sub.current_period_end.slice(0, 10)}`, placeOfSupply: sub.place_of_supply_state ?? ctx.cfg.SUPPLIER_STATE_CODE, buyerName: sub.buyer_name, buyerGstin: sub.buyer_gstin, at: now });
      }
      await db.query(`UPDATE app.subscriptions SET plan_code=$2, price_inr=$3, scheduled_plan_code=NULL, updated_at=now() WHERE subscription_id=$1`, [sub.subscription_id, target, newPrice]);
    });
    await audit(ctx.db, { actorUserId: user.userId, actorRole: user.role, action: 'subscription.upgrade', targetType: 'subscription', targetId: sub.subscription_id, details: { from: sub.plan_code, to: target, proration_taxable: taxable } });
    return { effective: 'immediately', prorationInr: split.total };
  }
  if (target === 'free') {
    await cancelSubscription(ctx, user, { reason: 'downgrade_to_free' });
    return { effective: 'period_end', effectiveOn: sub.current_period_end };
  }
  await ctx.db.query(`UPDATE app.subscriptions SET scheduled_plan_code=$2, updated_at=now() WHERE subscription_id=$1`, [sub.subscription_id, target]);
  await audit(ctx.db, { actorUserId: user.userId, actorRole: user.role, action: 'subscription.downgrade_scheduled', targetType: 'subscription', targetId: sub.subscription_id, details: { from: sub.plan_code, to: target, effective: sub.current_period_end } });
  return { effective: 'period_end', effectiveOn: sub.current_period_end };
}

export const CANCEL_REASONS = ['too_expensive', 'not_using_enough', 'missing_features', 'data_quality', 'switched_tool', 'temporary_break', 'other'] as const;

export async function cancelSubscription(ctx: AppContext, user: { userId: string; email: string; role: string }, input: { reason?: string; comment?: string }): Promise<{ accessUntil: string }> {
  const sub = await ctx.db.maybeOne<{ subscription_id: string; gateway_subscription_id: string; current_period_end: string; status: string; created_at: string; first_charge_at: string | null }>(`SELECT * FROM app.subscriptions WHERE user_id=$1 AND status IN ('active','past_due','pending','created')`, [user.userId]);
  if (!sub) throw notFound('No subscription to cancel.');
  // Stop auto-renewal and revoke the mandate; access continues to the end of the paid period (BIL-05).
  await ctx.payments.cancelSubscription(sub.gateway_subscription_id, true);
  const immediate = !sub.first_charge_at;
  await ctx.db.query(
    `UPDATE app.subscriptions SET cancel_at_period_end=true, status=CASE WHEN $4 THEN 'cancelled' ELSE status END, cancelled_at=now(), cancel_reason=$2, cancel_comment=$3, mandate_status='revoked', updated_at=now() WHERE subscription_id=$1`,
    [sub.subscription_id, input.reason ?? null, input.comment ?? null, immediate],
  );
  const until = sub.current_period_end ?? ctx.clock().toISOString();
  await queueEmail(ctx.db, { to: user.email, userId: user.userId, template: 'cancelled', category: 'billing', subject: 'Your ATLAS subscription is cancelled', text: `Your subscription is cancelled. Auto-renewal and the payment mandate are stopped; no further debits will be made. You keep access until ${until.slice(0, 10)}. Your saved work stays available on the Free plan.` });
  await track(ctx.db, 'subscription_cancelled', { reason: input.reason, tenure_days: Math.round((ctx.clock().getTime() - Date.parse(sub.first_charge_at ?? sub.created_at)) / 86_400_000) }, { userId: user.userId, origin: 'server' });
  await audit(ctx.db, { actorUserId: user.userId, actorRole: user.role, action: 'subscription.cancel', targetType: 'subscription', targetId: sub.subscription_id, details: { reason: input.reason ?? null } });
  return { accessUntil: until };
}

/** Admin-initiated refund (BIL-07): triggers the gateway refund; the webhook records it and issues a credit note. */
export async function refundPayment(ctx: AppContext, admin: { userId: string; role: string }, paymentId: string, reason: string): Promise<{ refundId: string; withinPolicy: boolean }> {
  const pay = await ctx.db.maybeOne<{ payment_id: string; gateway_payment_id: string; amount_inr: number; user_id: string; subscription_id: string | null; status: string; created_at: string; kind: string }>(`SELECT * FROM app.payments WHERE payment_id=$1`, [paymentId]);
  if (!pay || pay.kind === 'refund') throw notFound('Payment not found.');
  if (pay.status === 'refunded') throw conflict('This payment has already been refunded.');
  const sub = pay.subscription_id ? await ctx.db.maybeOne<{ first_charge_at: string | null }>(`SELECT first_charge_at FROM app.subscriptions WHERE subscription_id=$1`, [pay.subscription_id]) : undefined;
  const withinPolicy = !!sub?.first_charge_at && ctx.clock().getTime() - Date.parse(sub.first_charge_at) <= REFUND_WINDOW_DAYS * 86_400_000;
  const r = await ctx.payments.refund(pay.gateway_payment_id, Math.round(pay.amount_inr * 100));
  if (withinPolicy && pay.subscription_id) {
    // Full refund under the 7-day policy ends paid access now.
    await ctx.db.query(`UPDATE app.subscriptions SET status='cancelled', cancel_at_period_end=true, current_period_end=$2, mandate_status='revoked', cancel_reason=COALESCE(cancel_reason,'refunded'), updated_at=now() WHERE subscription_id=$1`, [pay.subscription_id, ctx.clock().toISOString()]);
  }
  await audit(ctx.db, { actorUserId: admin.userId, actorRole: admin.role, action: 'payment.refund', targetType: 'payment', targetId: paymentId, reason, details: { gateway_refund_id: r.refundId, within_policy: withinPolicy, amount_inr: pay.amount_inr } });
  return { refundId: r.refundId, withinPolicy };
}

/** Reconciliation job (every 10 minutes): activate subscriptions whose webhook was delayed (BIL-02). */
export async function reconcileSubscriptions(ctx: AppContext): Promise<{ checked: number; repaired: number }> {
  const pending = await ctx.db.query<{ subscription_id: string; gateway_subscription_id: string; user_id: string }>(`SELECT subscription_id, gateway_subscription_id, user_id FROM app.subscriptions WHERE status IN ('pending','created') AND gateway_subscription_id IS NOT NULL AND updated_at < now() - interval '1 minute'`);
  let repaired = 0;
  for (const p of pending) {
    const g = await ctx.payments.fetchSubscription(p.gateway_subscription_id);
    if (g.status === 'active' && g.lastPaymentId) {
      const have = await ctx.db.maybeOne(`SELECT 1 FROM app.payments WHERE gateway_payment_id=$1`, [g.lastPaymentId]);
      if (!have) {
        const evt: WebhookEvent = { id: `reconcile:${g.lastPaymentId}`, event: 'subscription.charged', created_at: Math.floor(ctx.clock().getTime() / 1000), payload: { subscription: { id: p.gateway_subscription_id, status: 'active', current_start: g.currentStart ? Math.floor(Date.parse(g.currentStart) / 1000) : null, current_end: g.currentEnd ? Math.floor(Date.parse(g.currentEnd) / 1000) : null }, payment: { id: g.lastPaymentId, amount: 0, status: 'captured', method: 'reconciled', subscription_id: p.gateway_subscription_id } } };
        const stored = await ctx.db.query(`INSERT INTO app.webhook_events (event_id, gateway, event_type, payload, signature_valid, status) VALUES ($1,$2,$3,$4,true,'received') ON CONFLICT DO NOTHING RETURNING event_id`, [evt.id, ctx.payments.name, evt.event, JSON.stringify(evt)]);
        if (stored.length) {
          await ctx.db.tx((db) => applyEvent(ctx, db, evt));
          await ctx.db.query(`UPDATE app.webhook_events SET status='processed', processed_at=now() WHERE event_id=$1`, [evt.id]);
          repaired++;
        }
      }
    }
  }
  return { checked: pending.length, repaired };
}

/** Daily: end cancelled subscriptions at period end; expire grace periods (BIL-05, BIL-06). */
export async function settlePeriods(ctx: AppContext): Promise<{ expired: number; graceEnded: number }> {
  const expired = await ctx.db.query(`UPDATE app.subscriptions SET status='expired', updated_at=now() WHERE cancel_at_period_end AND status IN ('active','cancelled') AND current_period_end <= now() RETURNING subscription_id`);
  const grace = await ctx.db.query<{ user_id: string }>(`UPDATE app.subscriptions SET status='halted', updated_at=now() WHERE status='past_due' AND grace_until <= now() RETURNING user_id`);
  for (const g of grace) await ctx.db.query(`INSERT INTO app.notifications (user_id, kind, title, body, href) VALUES ($1,'downgraded','Your plan moved to Free','The grace period ended without a successful payment. Your saved work is kept.','/app/billing')`, [g.user_id]);
  return { expired: expired.length, graceEnded: grace.length };
}
