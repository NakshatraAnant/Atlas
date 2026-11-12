'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Problem } from '@/components/ui';

// Sign-up kept to what it needs: email, password, two required confirmations. Optional choices are folded
// away (all off by default) and can be changed later in Account. The value of the free plan sits beside
// the form so the decision is easy.
export default function Signup() {
  const [f, setF] = useState({ email: '', password: '', age: false, legal: false, product_updates: false, marketing: false, analytics: false });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const ready = f.email.includes('@') && f.password.length >= 10 && f.age && f.legal;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ message: string }>('/v1/auth/signup', { body: {
        email: f.email, password: f.password, age_confirmed: f.age, accept_terms: f.legal, accept_privacy: f.legal,
        product_updates: f.product_updates, marketing: f.marketing, analytics: f.analytics, source: 'web',
      } });
      setDone(r.message);
    } catch (x) {
      setErr(x as Error);
    } finally {
      setBusy(false);
    }
  };
  const box = (k: 'age' | 'legal' | 'product_updates' | 'marketing' | 'analytics', label: React.ReactNode) => (
    <label className="check-row"><input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> <span>{label}</span></label>
  );
  if (done) return (
    <div className="auth-card auth-done">
      <p className="auth-badge" aria-hidden="true">✉</p>
      <h1>Check your email</h1>
      <p className="okbox">{done}</p>
      <ol className="auth-next"><li>Open the email from ATLAS.</li><li>Click the link (valid for 24 hours).</li><li>Choose your markets: it takes a minute.</li></ol>
      <p className="mu">In this local environment, emails appear in Admin → Outbox.</p>
      <p><a className="btn s" href="/login">Back to sign in</a></p>
    </div>
  );
  return (
    <div className="auth-wrap">
      <aside className="auth-pitch">
        <h2>Free, and useful from day one</h2>
        <ul className="auth-benefits">
          <li>Indian indices, macro, commodities and crypto, each number with its source and date</li>
          <li>Follow series and get a notice when new data lands</li>
          <li>Nine Academy courses with 3D charts on real data</li>
        </ul>
        <p className="mu">No card needed. Education and research, not investment advice.</p>
      </aside>
      <div className="auth-card">
        <h1>Create your free account</h1>
        <form onSubmit={submit} className="stack">
          <label className="field">Email<input type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label className="field">Password
            <span className="pw">
              <input type={show ? 'text' : 'password'} autoComplete="new-password" minLength={10} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} aria-describedby="pw-hint" />
              <button type="button" className="link" onClick={() => setShow(!show)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
            </span>
            <span id="pw-hint" className={`mu pw-hint${f.password && f.password.length < 10 ? ' short' : ''}`}>At least 10 characters{f.password ? ` · ${Math.min(f.password.length, 10)}/10` : ''}</span>
          </label>
          {box('age', 'I am 18 or older.')}
          {box('legal', <>I accept the <a href="/legal/terms" target="_blank" rel="noopener">Terms of Use</a> and have read the <a href="/legal/privacy" target="_blank" rel="noopener">Privacy Notice</a>.</>)}
          <details className="auth-optional">
            <summary>Email and analytics preferences (optional, all off)</summary>
            <div className="stack">
              {box('product_updates', 'Product update emails')}
              {box('marketing', 'Marketing emails')}
              {box('analytics', 'Non-essential product analytics in the browser')}
              <p className="mu">You can change these at any time in Account.</p>
            </div>
          </details>
          <Problem error={err} />
          <button className="btn btn-cta btn-lg" type="submit" disabled={!ready || busy}>{busy ? 'Creating your account…' : <>Create free account <span aria-hidden="true">→</span></>}</button>
          {!ready && <p className="mu" style={{ margin: 0, fontSize: 13 }}>Enter your email and a 10-character password, and tick both confirmations.</p>}
        </form>
        <p className="mu">Already registered? <a href="/login">Sign in</a></p>
      </div>
    </div>
  );
}
