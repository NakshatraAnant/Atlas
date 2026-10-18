'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Problem } from '@/components/ui';

export default function Reset() {
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = new URLSearchParams(location.search).get('token') ?? '';
      setMsg((await api<{ message: string }>('/v1/auth/password-reset/confirm', { body: { token, password } })).message);
    } catch (x) {
      setErr(x as Error);
    }
  };
  return (
    <div className="card" style={{ maxWidth: 440, margin: '24px auto' }}>
      <h1>Choose a new password</h1>
      {msg ? <><p className="okbox">{msg}</p><a className="btn" href="/login">Sign in</a></> : (
        <form className="stack" onSubmit={submit}>
          <label className="field">New password (at least 10 characters)<input type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <Problem error={err} />
          <button className="btn" type="submit">Set password</button>
        </form>
      )}
    </div>
  );
}
