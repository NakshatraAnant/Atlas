'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { formatIndianNumber } from '@/lib/format';
import { Loading, Problem, useApi } from '@/components/ui';
import { useApp } from '@/components/providers';

interface Plans { gst_rate: number; plans: { code: string; name: string; priceInrMonthly: number; total_inr: number; supportNote: string; entitlements: Record<string, number> }[]; states: Record<string, string>; terms: { cancellation: string; refund: string } }

const ROWS: [string, string, (v: number) => string][] = [
  ['AI questions / month', 'ai_questions_per_month', (v) => (v === -1 ? 'Unlimited' : String(v))],
  ['Full company profiles / month', 'full_profiles_per_month', (v) => (v === -1 ? 'All covered companies' : `${v} (summaries for all)`)],
  ['Financial history (years / quarters)', 'history_years', (v) => (v === -1 ? 'All available' : `${v} years`)],
  ['Peer comparison', 'peer_edit_max', (v) => (v === 0 ? '—' : `Up to ${v} peers`)],
  ['Screener filters', 'screener_filters_max', (v) => (v === -1 ? 'All filters' : `${v} filters`)],
  ['Saved screens', 'saved_screens', (v) => String(v)],
  ['Backtests / month', 'backtests_per_month', (v) => String(v)],
  ['Universe strategies and rule builder', 'backtest_universe_strategies', (v) => (v ? 'Included' : '—')],
  ['Watchlists × companies', 'watchlists', (v) => String(v)],
  ['Material-change alerts', 'alerts_active', (v) => (v ? `${v} active` : '—')],
  ['Notes', 'notes', (v) => (v === -1 ? 'Unlimited' : String(v))],
  ['PDF summaries / month', 'pdf_exports_per_month', (v) => (v ? String(v) : '—')],
  ['CSV export of permitted fields', 'csv_export', (v) => (v ? 'Included' : '—')],
];

export default function Pricing() {
  const { me } = useApp();
  const p = useApi<Plans>('/v1/billing/plans');
  const [buying, setBuying] = useState<string | null>(null);
  const [state, setState] = useState(me?.profile.state_code ?? '');
  const [gstin, setGstin] = useState('');
  const [err, setErr] = useState<Error | null>(null);
  const checkout = async (plan: string) => {
    setErr(null);
    try {
      const r = await api<{ checkout: { url?: string } }>('/v1/billing/checkout', { body: { plan, state_code: state, gstin: gstin || undefined }, headers: { 'idempotency-key': `${plan}-${Date.now()}` } });
      if (r.checkout.url) window.location.href = r.checkout.url.replace(/^https?:\/\/[^/]+/, '');
    } catch (e) {
      setErr(e as Error);
    }
  };
  return (
    <>
      <h1>Plans</h1>
      <p className="mu">Prices are shown before GST, which is added at {p.data ? Math.round(p.data.gst_rate * 100) : 18}%. No countdowns, no pre-ticked options. {p.data?.terms.cancellation}</p>
      {p.loading && <Loading />}
      <Problem error={p.error} retry={p.reload} />
      {p.data && (
        <div className="card wrap">
          <table>
            <caption>Plan comparison (entitlements come from the same service that enforces them)</caption>
            <thead><tr><th scope="col">Entitlement</th>{p.data.plans.map((x) => <th key={x.code} scope="col">{x.name}</th>)}</tr></thead>
            <tbody>
              <tr><td>Price / month</td>{p.data.plans.map((x) => <td key={x.code}>{x.priceInrMonthly ? <>₹{formatIndianNumber(x.priceInrMonthly, 0)} + GST<br /><span className="mu">₹{formatIndianNumber(x.total_inr, 2)} total</span></> : '₹0'}</td>)}</tr>
              {ROWS.map(([label, key, f]) => <tr key={key}><td>{label}</td>{p.data!.plans.map((x) => <td key={x.code}>{key === 'watchlists' ? `${x.entitlements.watchlists} × ${x.entitlements.watchlist_size}` : key === 'history_years' ? `${f(x.entitlements.history_years!)}, ${x.entitlements.history_quarters === -1 ? 'all' : x.entitlements.history_quarters} quarters` : f(x.entitlements[key] ?? 0)}</td>)}</tr>)}
              <tr><td>Support</td>{p.data.plans.map((x) => <td key={x.code}>{x.supportNote}</td>)}</tr>
              <tr><td></td>{p.data.plans.map((x) => <td key={x.code}>{x.code === 'free' ? (me ? <span className="mu">{me.plan.code === 'free' ? 'Current plan' : ''}</span> : <a className="btn s" href="/signup">Start free</a>) : me?.plan.code === x.code ? <span className="mu">Current plan</span> : me && me.plan.code !== 'free' ? <a className="btn s" href="/app/billing">Change plan</a> : <button className="btn" onClick={() => (me ? setBuying(x.code) : (window.location.href = '/signup'))}>Choose {x.name}</button>}</td>)}</tr>
            </tbody>
          </table>
        </div>
      )}
      {buying && p.data && (
        <div className="card" aria-live="polite">
          <h2>Checkout: {p.data.plans.find((x) => x.code === buying)?.name}</h2>
          <p className="mu">You pay on the payment gateway’s page (UPI Autopay or card mandate). ATLAS never sees card or UPI details. A GST tax invoice is issued for every charge.</p>
          <div className="row">
            <label>State (place of supply)<select required value={state} onChange={(e) => setState(e.target.value)}><option value="">Choose…</option>{Object.entries(p.data.states).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
            <label>GSTIN (optional, for business purchases)<input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} maxLength={15} placeholder="22AAAAA0000A1Z5" /></label>
          </div>
          {!me?.profile.email_verified_at && <p className="warn">Verify your email before checkout.</p>}
          <Problem error={err} />
          <div className="row"><button className="btn" disabled={!state} onClick={() => checkout(buying)}>Continue to payment</button><button className="btn s" onClick={() => setBuying(null)}>Cancel</button></div>
        </div>
      )}
      <p className="mu">{p.data?.terms.refund}</p>
    </>
  );
}
