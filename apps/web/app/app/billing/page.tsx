'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/components/providers';
import { Empty, Loading, Problem, useApi } from '@/components/ui';
import { dateOrDash, fmt } from '@/lib/format';

interface Plans { gst_rate: number; plans: { code: 'free' | 'plus' | 'pro'; name: string; priceInrMonthly: number; gst_inr: number; total_inr: number; display: string; supportNote: string }[]; states: Record<string, string>; terms: { cancellation: string; refund: string } }
interface Sub { effective_plan: string; status: string; subscription: null | { subscription_id: string; plan_code: string; status: string; price_inr: number; current_period_end: string; cancel_at_period_end: boolean; scheduled_plan_code: string | null; grace_until: string | null; mandate_status: string; gateway: string }; next_charge: string | null }

export default function Billing() {
  const { me, refresh, toast } = useApp();
  const plans = useApi<Plans>('/v1/billing/plans');
  const sub = useApi<Sub>('/v1/billing/subscription');
  const inv = useApi<{ invoices: { invoice_id: string; invoice_number: string; doc_type: string; issued_at: string; taxable_value: number; cgst: number; sgst: number; igst: number; total: number; approval_status: string; is_sandbox: boolean }[] }>('/v1/billing/invoices');
  const pay = useApi<{ payments: { payment_id: string; kind: string; amount_inr: number; status: string; method: string | null; is_sandbox: boolean; created_at: string }[] }>('/v1/billing/payments');
  const [state, setState] = useState('');
  const [gstin, setGstin] = useState('');
  const [buyer, setBuyer] = useState('');
  const [coupon, setCoupon] = useState('');
  const [err, setErr] = useState<Error | null>(null);
  const [cancel, setCancel] = useState<null | { access_until: string; after: string; reasons: string[] }>(null);
  const [reason, setReason] = useState('');
  useEffect(() => { if (me?.profile.state_code) setState(me.profile.state_code); }, [me]);
  if (plans.loading || sub.loading) return <Loading lines={6} />;
  if (plans.error) return <Problem error={plans.error} retry={plans.reload} />;
  if (sub.error) return <Problem error={sub.error} retry={sub.reload} />;
  const p = plans.data!;
  const s = sub.data!;
  const current = s.effective_plan;
  const paid = s.subscription && s.subscription.status !== 'cancelled' && s.subscription.plan_code !== 'free';
  const checkout = async (plan: 'plus' | 'pro') => {
    setErr(null);
    try {
      const r = await api<{ checkout: { url: string } }>('/v1/billing/checkout', { body: { plan, state_code: state, coupon: coupon || undefined, gstin: gstin || undefined, buyer_name: buyer || undefined }, headers: { 'idempotency-key': `co-${plan}-${Date.now()}` } });
      const u = new URL(r.checkout.url, location.origin);
      window.location.href = u.origin === location.origin ? u.pathname + u.search : r.checkout.url;
    } catch (e) { setErr(e as Error); }
  };
  const change = async (plan: 'free' | 'plus' | 'pro') => {
    setErr(null);
    try {
      const r = await api<{ effective: string; effectiveOn?: string; prorationInr?: number }>('/v1/billing/change', { body: { plan } });
      toast(r.effective === 'immediately' ? `Plan changed now${r.prorationInr ? `; prorated charge ₹${r.prorationInr}` : ''}` : `Change takes effect on ${dateOrDash(r.effectiveOn)}`);
      sub.reload(); pay.reload(); inv.reload(); void refresh();
    } catch (e) { setErr(e as Error); }
  };
  return (
    <>
      <h1>Billing</h1>
      {s.status === 'past_due' && <div className="warn">Your last payment did not go through. You keep full access until {dateOrDash(s.subscription?.grace_until)} while the payment is retried. Update your payment method on the gateway, or contact support.</div>}
      <section className="card">
        <h2>Current plan: {p.plans.find((x) => x.code === current)?.name ?? current}</h2>
        {s.subscription && paid ? (
          <p>{fmt(s.subscription.price_inr, 'INR')} a month plus GST · status {s.subscription.status} · {s.subscription.cancel_at_period_end ? <strong>ends on {dateOrDash(s.subscription.current_period_end)}</strong> : <>renews on {dateOrDash(s.next_charge)}</>}{s.subscription.scheduled_plan_code && <> · moves to {s.subscription.scheduled_plan_code} on {dateOrDash(s.subscription.current_period_end)}</>} · gateway {s.subscription.gateway}{s.subscription.gateway === 'sandbox' && ' (test mode — no real money)'}</p>
        ) : <p className="mu">You are on the free plan.</p>}
        {me && <p className="mu">This month: {me.usage.ai_questions} AI questions, {me.usage.full_profiles} full company profiles, {me.usage.backtests} backtests. Allowances reset on {dateOrDash(me.usage_resets_on)}.</p>}
      </section>
      <div className="plans">{p.plans.map((x) => (
        <div key={x.code} className="card" aria-current={x.code === current ? 'true' : undefined}>
          <h3>{x.name}</h3>
          <p className="big">{x.display}<span className="mu"> / month</span></p>
          {x.priceInrMonthly > 0 && <p className="mu">+ GST {fmt(x.gst_inr, 'INR')} = {fmt(x.total_inr, 'INR')}</p>}
          <p className="mu">{x.supportNote}</p>
          {x.code === current ? <p><strong>Your plan</strong></p> : !paid && x.code !== 'free' ? <button className="btn" onClick={() => checkout(x.code as 'plus' | 'pro')} disabled={!state}>Choose {x.name}</button> : paid ? <button className="btn s" onClick={() => change(x.code)}>{p.plans.findIndex((y) => y.code === x.code) > p.plans.findIndex((y) => y.code === current) ? 'Upgrade now' : 'Downgrade at period end'}</button> : null}
        </div>
      ))}</div>
      {!paid && (
        <section className="card stack"><h2>Billing details for a GST invoice</h2>
          <label className="field">State (place of supply, required)<select value={state} onChange={(e) => setState(e.target.value)} required><option value="">Choose your state</option>{Object.entries(p.states).sort((a, b) => a[1].localeCompare(b[1])).map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
          <div className="row">
            <label className="field">GSTIN (optional, for business invoices)<input value={gstin} maxLength={15} onChange={(e) => setGstin(e.target.value.toUpperCase())} /></label>
            <label className="field">Name on invoice (optional)<input value={buyer} maxLength={120} onChange={(e) => setBuyer(e.target.value)} /></label>
            <label className="field">Coupon (optional)<input value={coupon} maxLength={40} onChange={(e) => setCoupon(e.target.value)} /></label>
          </div>
          <p className="mu">Prices exclude GST at {Math.round(p.gst_rate * 100)}%. You pay on the payment gateway’s page; ATLAS never sees card or UPI details. {p.terms.refund}</p>
        </section>
      )}
      <Problem error={err} />
      {paid && !s.subscription!.cancel_at_period_end && (
        <section className="card"><h2>Cancel</h2>
          {!cancel ? <button className="btn s" onClick={async () => setCancel(await api('/v1/billing/cancel/preview'))}>Cancel subscription</button> : (
            <div className="stack">
              <p>You keep {s.subscription!.plan_code} until <strong>{dateOrDash(cancel.access_until)}</strong>. {cancel.after}</p>
              <label className="field">Reason (optional)<select value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Prefer not to say</option>{cancel.reasons.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}</select></label>
              <div className="row"><button className="btn" onClick={async () => { try { await api('/v1/billing/cancel', { body: { reason: reason || undefined } }); toast('Cancellation confirmed'); setCancel(null); sub.reload(); } catch (e) { setErr(e as Error); } }}>Confirm cancellation</button><button className="btn s" onClick={() => setCancel(null)}>Keep my plan</button></div>
            </div>
          )}
          <p className="mu">{p.terms.cancellation}</p>
        </section>
      )}
      <section className="card"><h2>Invoices and credit notes</h2>
        {inv.data?.invoices.length ? <div className="wrap"><table><caption className="sr-only">Invoices</caption><thead><tr><th scope="col">Number</th><th scope="col">Date</th><th scope="col">Taxable</th><th scope="col">GST</th><th scope="col">Total</th><th scope="col">PDF</th></tr></thead>
          <tbody>{inv.data.invoices.map((i) => <tr key={i.invoice_id}><td>{i.invoice_number}{i.doc_type === 'credit_note' && ' (credit note)'}{i.is_sandbox && <span className="t m">test</span>}</td><td>{dateOrDash(i.issued_at)}</td><td>{fmt(i.taxable_value, 'INR')}</td><td>{i.igst ? `IGST ${fmt(i.igst, 'INR')}` : `CGST ${fmt(i.cgst, 'INR')} + SGST ${fmt(i.sgst, 'INR')}`}</td><td>{fmt(i.total, 'INR')}</td><td><a href={`/v1/billing/invoices/${i.invoice_id}/pdf`}>Download</a></td></tr>)}</tbody></table></div> : <Empty>No invoices yet.</Empty>}
        {inv.data?.invoices.some((i) => i.approval_status !== 'approved') && <p className="mu">Invoice format is awaiting accountant review; test-mode invoices are marked.</p>}
      </section>
      <section className="card"><h2>Payments</h2>
        {pay.data?.payments.length ? <ul>{pay.data.payments.map((x) => <li key={x.payment_id}>{dateOrDash(x.created_at)} · {x.kind} · {fmt(x.amount_inr, 'INR')} · {x.status}{x.method ? ` · ${x.method}` : ''}{x.is_sandbox && ' · test mode'}</li>)}</ul> : <Empty>No payments.</Empty>}
        <p className="mu">Need a refund within 7 days of your first charge? <a href="/help/refunds">How refunds work</a> or contact support.</p>
      </section>
    </>
  );
}
