'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Problem } from '@/components/ui';
import { useApp } from '@/components/providers';

export default function Login() {
  const { refresh } = useApp();
  const [f, setF] = useState({ email: '', password: '', totp: '' });
  const [mfa, setMfa] = useState(false);
  const [err, setErr] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const next = typeof window !== 'undefined' ? new URLSearchParams(location.search).get('next') : null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ mfa_required?: boolean }>('/v1/auth/login', { body: { email: f.email, password: f.password, totp: mfa ? f.totp : undefined } });
      if (r.mfa_required) {
        setMfa(true);
        return;
      }
      await refresh();
      const safe = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
      // A first sign-in without a destination continues the journey: a minute of setup before Home.
      const who = await api<{ signed_in?: false; demo_mode?: boolean; profile?: { onboarding_completed_at: string | null } }>('/v1/me?optional=1').catch(() => null);
      const setup = who?.profile && !who.profile.onboarding_completed_at && who.demo_mode === false;
      window.location.href = safe ?? (setup ? '/onboarding' : '/app');
    } catch (x) {
      setErr(x as Error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-card" style={{ maxWidth: 440 }}>
      <h1>Welcome back</h1>
      <form onSubmit={submit} className="stack">
        <label className="field">Email<input type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="field">Password<input type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
        {mfa && <label className="field">Verification code (authenticator app or a recovery code)<input inputMode="numeric" autoComplete="one-time-code" required autoFocus value={f.totp} onChange={(e) => setF({ ...f, totp: e.target.value })} /></label>}
        <Problem error={err} />
        <button className="btn btn-cta btn-lg" type="submit" disabled={busy}>{busy ? 'Signing in…' : mfa ? 'Verify and sign in' : 'Sign in'}</button>
      </form>
      <p><a href="/forgot-password">Forgot your password?</a></p>
      <p className="mu">New to ATLAS? <a href="/signup">Create a free account</a></p>
    </div>
  );
}
