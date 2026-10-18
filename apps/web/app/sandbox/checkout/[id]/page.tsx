'use client';
import { use, useState } from 'react';
import { api } from '@/lib/api';
import { Loading, Problem, useApi } from '@/components/ui';
import { fmt } from '@/lib/format';

// Development-only stand-in for the payment gateway's hosted page. No card or UPI details are
// collected: the tester picks the outcome, and the sandbox delivers signed webhooks to the API.
export default function SandboxCheckout({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const s = useApi<{ id: string; plan: string; amount_inr: number; status: string; sandbox: boolean; outcomes: string[] }>(`/v1/sandbox/checkout/${id}`);
  const [method, setMethod] = useState<'upi' | 'card'>('upi');
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  if (s.loading) return <Loading />;
  if (s.error) return <Problem error={s.error} />;
  const d = s.data!;
  const go = async (outcome: string) => {
    try {
      await api(`/v1/sandbox/checkout/${id}`, { body: { outcome, method } });
      setDone(outcome);
      if (outcome === 'success') setTimeout(() => (window.location.href = '/app/billing'), 1200);
    } catch (e) { setErr(e as Error); }
  };
  return (
    <div className="card" style={{ maxWidth: 520, margin: '24px auto' }}>
      <p className="wm">TEST MODE — no money moves</p>
      <h1>Sandbox payment gateway</h1>
      <p>Plan <strong>{d.plan}</strong> · amount {fmt(d.amount_inr, 'INR')} including GST · status {d.status}</p>
      <fieldset style={{ border: 0, padding: 0 }}><legend>Simulated method</legend>
        <label><input type="radio" checked={method === 'upi'} onChange={() => setMethod('upi')} /> UPI Autopay</label> <label><input type="radio" checked={method === 'card'} onChange={() => setMethod('card')} /> Card mandate</label>
      </fieldset>
      {done ? <p className={done === 'success' ? 'okbox' : 'warn'}>Simulated outcome “{done}” sent to ATLAS. {done === 'success' ? 'Returning to Billing…' : <a href="/app/billing">Back to Billing</a>}</p> : (
        <div className="row">
          <button className="btn" onClick={() => go('success')}>Simulate successful payment</button>
          <button className="btn s" onClick={() => go('failure')}>Simulate failure</button>
          <button className="btn s" onClick={() => go('pending')}>Simulate pending</button>
        </div>
      )}
      <Problem error={err} />
      <p className="mu">This page exists only in development and test environments. In production the real gateway’s hosted page is used.</p>
    </div>
  );
}
