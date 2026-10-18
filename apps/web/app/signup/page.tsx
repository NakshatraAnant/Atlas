'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Problem } from '@/components/ui';

export default function Signup() {
  const [f, setF] = useState({ email: '', password: '', display_name: '', age_confirmed: false, accept_terms: false, accept_privacy: false, product_updates: false, marketing: false, analytics: false });
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const r = await api<{ message: string }>('/v1/auth/signup', { body: { ...f, display_name: f.display_name || undefined, source: 'web' } });
      setDone(r.message);
    } catch (x) {
      setErr(x as Error);
    }
  };
  const box = (k: keyof typeof f, label: React.ReactNode) => (
    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><input type="checkbox" checked={f[k] as boolean} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> <span>{label}</span></label>
  );
  if (done) return <div className="card" style={{ maxWidth: 520, margin: '24px auto' }}><h1>Check your email</h1><p className="okbox">{done}</p><p className="mu">The link is valid for 24 hours. In this local environment, emails appear in Admin → Outbox.</p><p><a href="/login">Sign in</a></p></div>;
  return (
    <div className="card" style={{ maxWidth: 560, margin: '24px auto' }}>
      <h1>Create your free account</h1>
      <p className="mu">We collect only what the service needs. Read the <a href="/legal/privacy">privacy notice</a> before you continue.</p>
      <form onSubmit={submit} className="stack">
        <label className="field">Email<input type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="field">Password (at least 10 characters; common breached passwords are refused)<input type="password" autoComplete="new-password" minLength={10} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
        <label className="field">Display name (optional)<input value={f.display_name} maxLength={80} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></label>
        <fieldset className="stack" style={{ border: 0, padding: 0 }}>
          <legend className="mu">Required</legend>
          {box('age_confirmed', 'I confirm that I am 18 or older.')}
          {box('accept_terms', <>I accept the <a href="/legal/terms">Terms of Use</a>.</>)}
          {box('accept_privacy', <>I have read the <a href="/legal/privacy">Privacy Notice</a>.</>)}
        </fieldset>
        <fieldset className="stack" style={{ border: 0, padding: 0 }}>
          <legend className="mu">Optional — you can change these at any time in Account</legend>
          {box('product_updates', 'Product update emails')}
          {box('marketing', 'Marketing emails')}
          {box('analytics', 'Non-essential product analytics in the browser')}
        </fieldset>
        <Problem error={err} />
        <button className="btn" type="submit">Create free account</button>
      </form>
      <p className="mu">Already registered? <a href="/login">Sign in</a></p>
    </div>
  );
}
