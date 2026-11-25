import { DEFAULT_PLANS, PLAN_CODES, formatIndianNumber, type PlanCode } from '@atlas/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { badRequest, forbidden, notFound, parse } from '../../lib/http.js';
import { renderPdf } from '../../lib/pdf.js';
import { requireUser, requireVerified } from '../auth/service.js';
import { isEnabled } from '../ops/flags.js';
import { listPlans, userPlan } from './entitlements.js';
import { SandboxGateway } from './gateway.js';
import { CANCEL_REASONS, cancelSubscription, changePlan, gstSplit, processWebhook, startCheckout } from './service.js';

const INDIAN_STATES: Record<string, string> = { '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh' };

export async function billingRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // Pricing page data (BIL-01): read from the entitlement service, GST stated separately.
  app.get('/v1/billing/plans', async () => {
    const plans = await listPlans(ctx.db);
    return {
      gst_rate: ctx.cfg.GST_RATE,
      currency: 'INR',
      prices_exclude_gst: true,
      annual_billing: await isEnabled(ctx.db, 'annual_billing'),
      plans: plans.map((p) => ({ ...p, gst_inr: Math.round(p.priceInrMonthly * ctx.cfg.GST_RATE * 100) / 100, total_inr: Math.round(p.priceInrMonthly * (1 + ctx.cfg.GST_RATE) * 100) / 100, display: p.priceInrMonthly ? `₹${formatIndianNumber(p.priceInrMonthly, 0)} / month + GST` : '₹0' })),
      states: INDIAN_STATES,
      terms: { cancellation: 'Cancel any time from Billing in two screens; access continues to the end of the paid period.', refund: 'Full refund on request within 7 days of the first paid charge (proposed policy, pending counsel review).', no_dark_patterns: true },
    };
  });

  app.post('/v1/billing/checkout', { config: { idempotent: true } }, async (req) => {
    const u = requireVerified(req);
    const body = parse(z.object({ plan: z.enum(['plus', 'pro']), coupon: z.string().max(40).optional(), state_code: z.string().regex(/^\d{2}$/), buyer_name: z.string().trim().max(120).optional(), gstin: z.string().trim().toUpperCase().max(15).optional() }), req.body);
    if (!INDIAN_STATES[body.state_code]) throw badRequest('Choose your state for the place of supply.');
    const r = await startCheckout(ctx, u, { plan: body.plan, coupon: body.coupon, stateCode: body.state_code, buyerName: body.buyer_name, gstin: body.gstin || undefined });
    return { subscription_id: r.subscriptionId, checkout: r.checkout, amount: r.amount, sandbox: ctx.payments.isSandbox, note: 'You will complete payment on the payment gateway’s page. ATLAS never sees card or UPI details.' };
  });

  app.get('/v1/billing/subscription', async (req) => {
    const u = requireUser(req);
    const sub = await ctx.db.maybeOne(`SELECT subscription_id, plan_code, status, price_inr, coupon_code, current_period_start, current_period_end, cancel_at_period_end, scheduled_plan_code, grace_until, mandate_status, gateway, created_at FROM app.subscriptions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`, [u.userId]);
    const plan = await userPlan(ctx.db, u.userId, ctx.clock());
    const lastPayment = await ctx.db.maybeOne(`SELECT method, created_at FROM app.payments WHERE user_id=$1 AND kind='charge' ORDER BY created_at DESC LIMIT 1`, [u.userId]);
    return { effective_plan: plan.plan, status: plan.status, subscription: sub ?? null, payment_method: lastPayment ? { method: lastPayment.method, note: 'Mandate held by the payment gateway' } : null, next_charge: sub && !(sub as { cancel_at_period_end: boolean }).cancel_at_period_end ? (sub as { current_period_end: string | null }).current_period_end : null };
  });

  app.post('/v1/billing/change', async (req) => {
    const u = requireVerified(req);
    const { plan } = parse(z.object({ plan: z.enum(['free', 'plus', 'pro']) }), req.body);
    return changePlan(ctx, u, plan as PlanCode);
  });

  // Cancellation in two screens (BIL-05): screen 1 explains the effect; screen 2 confirms with an optional reason.
  app.get('/v1/billing/cancel/preview', async (req) => {
    const u = requireUser(req);
    const sub = await ctx.db.maybeOne<{ current_period_end: string | null; plan_code: string }>(`SELECT current_period_end, plan_code FROM app.subscriptions WHERE user_id=$1 AND status IN ('active','past_due','pending','created') ORDER BY created_at DESC LIMIT 1`, [u.userId]);
    if (!sub) throw notFound('No subscription to cancel.');
    return { access_until: sub.current_period_end, plan: sub.plan_code, after: 'Your account moves to Free. Nothing you have saved is deleted; items above Free limits become read-only.', reasons: CANCEL_REASONS, reason_optional: true };
  });
  app.post('/v1/billing/cancel', async (req) => {
    const u = requireUser(req);
    const body = parse(z.object({ reason: z.enum(CANCEL_REASONS).optional(), comment: z.string().max(1000).optional() }), req.body ?? {});
    return cancelSubscription(ctx, u, body);
  });

  app.get('/v1/billing/invoices', async (req) => {
    const u = requireUser(req);
    const rows = await ctx.db.query(`SELECT invoice_id, invoice_number, doc_type, issued_at, taxable_value, cgst, sgst, igst, total, approval_status, is_sandbox FROM app.invoices WHERE user_id=$1 ORDER BY issued_at DESC`, [u.userId]);
    return { invoices: rows };
  });
  app.get('/v1/billing/payments', async (req) => {
    const u = requireUser(req);
    return { payments: await ctx.db.query(`SELECT payment_id, kind, taxable_inr, gst_inr, amount_inr, status, method, is_sandbox, created_at FROM app.payments WHERE user_id=$1 ORDER BY created_at DESC`, [u.userId]) };
  });
  app.get('/v1/billing/invoices/:id/pdf', async (req, reply) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const inv = await ctx.db.maybeOne<Record<string, unknown> & { user_id: string; lines: { description: string; taxable: number }[]; invoice_number: string }>(`SELECT * FROM app.invoices WHERE invoice_id=$1`, [id]);
    if (!inv) throw notFound();
    if (inv.user_id !== u.userId) throw notFound(); // never confirm another user's invoice exists
    const pdf = await renderInvoicePdf(ctx, inv);
    return reply.type('application/pdf').header('content-disposition', `inline; filename="${inv.invoice_number.replace(/\//g, '-')}.pdf"`).send(pdf);
  });

  app.get('/v1/notifications', async (req) => {
    const u = requireUser(req);
    return { notifications: await ctx.db.query(`SELECT notification_id, kind, title, body, href, created_at, read_at FROM app.notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [u.userId]) };
  });
  app.post('/v1/notifications/:id/read', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    await ctx.db.query(`UPDATE app.notifications SET read_at=now() WHERE notification_id=$1 AND user_id=$2`, [id, u.userId]);
    return { read: true };
  });

  // Gateway webhooks: raw body, signature verified, stored before processing, idempotent.
  app.post('/webhooks/payments', { config: { rawBody: true, csrfExempt: true } }, async (req, reply) => {
    const raw = (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
    const sig = (req.headers['x-razorpay-signature'] ?? req.headers['x-atlas-signature']) as string | undefined;
    const eventId = req.headers['x-razorpay-event-id'];
    const r = await processWebhook(ctx, raw, sig, typeof eventId === 'string' ? eventId : undefined);
    if (r.status === 'rejected') return reply.status(400).send({ status: 'rejected' });
    return { status: r.status };
  });

  // Sandbox checkout (development only): the tester chooses an outcome; no payment details are collected.
  if (ctx.payments instanceof SandboxGateway) {
    const gw = ctx.payments;
    app.get('/v1/sandbox/checkout/:id', async (req) => {
      const u = requireUser(req);
      const { id } = parse(z.object({ id: z.string().max(64) }), req.params);
      const s = await gw.load(id);
      if (!s || (s.customer as { userId: string }).userId !== u.userId) throw notFound();
      return { id, plan: s.planCode, amount_inr: Number(s.amountPaise) / 100, status: s.status, sandbox: true, outcomes: ['success', 'failure', 'pending'] };
    });
    app.post('/v1/sandbox/checkout/:id', async (req) => {
      const u = requireUser(req);
      const { id } = parse(z.object({ id: z.string().max(64) }), req.params);
      const body = parse(z.object({ outcome: z.enum(['success', 'failure', 'pending', 'renewal_success', 'renewal_failure', 'halt']), method: z.enum(['upi', 'card']).default('upi'), deliver: z.enum(['once', 'twice', 'none']).default('once') }), req.body);
      const s = await gw.load(id);
      if (!s || (s.customer as { userId: string }).userId !== u.userId) throw notFound();
      if (body.outcome.startsWith('renewal') || body.outcome === 'halt') {
        if (!ctx.cfg.allowSyntheticData) throw forbidden();
      }
      const { events } = await gw.simulate(id, body.outcome, body.method);
      const results = [];
      if (body.deliver !== 'none') {
        for (const e of events) {
          results.push(await processWebhook(ctx, e.body, e.signature));
          if (body.deliver === 'twice') results.push(await processWebhook(ctx, e.body, e.signature));
        }
      }
      return { delivered: body.deliver, results };
    });
  }
}

async function renderInvoicePdf(ctx: AppContext, inv: Record<string, unknown> & { lines: { description: string; taxable: number }[]; invoice_number: string }): Promise<Buffer> {
  const n = (k: string) => Number(inv[k] ?? 0);
  const isCredit = inv.doc_type === 'credit_note';
  return renderPdf(
    [
      { kind: 'watermark', text: 'DRAFT TEMPLATE — not a valid tax invoice until the invoice format, SAC code and numbering are approved by the chartered accountant.' },
      ...(inv.is_sandbox ? [{ kind: 'watermark' as const, text: 'SANDBOX TRANSACTION — no money moved.' }] : []),
      { kind: 'title', text: isCredit ? 'Credit note' : 'Tax invoice' },
      { kind: 'text', text: `Number: ${inv.invoice_number}    Date: ${String(inv.issued_at).slice(0, 10)}` },
      { kind: 'text', text: `Supplier: ATLAS (legal entity and GSTIN pending registration) · State code ${inv.supplier_state_code}${ctx.cfg.SUPPLIER_GSTIN ? ` · GSTIN ${ctx.cfg.SUPPLIER_GSTIN}` : ''}` },
      { kind: 'text', text: `Recipient: ${inv.buyer_name ?? 'Individual subscriber'}${inv.buyer_gstin ? ` · GSTIN ${inv.buyer_gstin}` : ''} · Place of supply: state code ${inv.place_of_supply_state}` },
      { kind: 'text', text: `SAC: ${inv.sac_code}` },
      { kind: 'table', columns: ['Description', 'Taxable value', 'CGST', 'SGST', 'IGST', 'Total'], widths: [200, 70, 60, 60, 60, 70], rows: inv.lines.map((l) => [l.description, formatIndianNumber(n('taxable_value'), 2), formatIndianNumber(n('cgst'), 2), formatIndianNumber(n('sgst'), 2), formatIndianNumber(n('igst'), 2), formatIndianNumber(n('total'), 2)]) },
      { kind: 'footnote', text: `GST at ${(ctx.cfg.GST_RATE * 100).toFixed(0)}%: intra-state supplies are split into CGST and SGST; inter-state supplies carry IGST. Amounts in Indian rupees.` },
    ],
    { footer: `ATLAS ${isCredit ? 'credit note' : 'invoice'} ${inv.invoice_number}`, disclosure: false },
  );
}

export const _test = { gstSplit, PLAN_CODES, DEFAULT_PLANS };
