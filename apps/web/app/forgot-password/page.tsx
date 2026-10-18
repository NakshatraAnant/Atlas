'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Problem } from '@/components/ui';

export default function Forgot() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  return (
    <div className="card" style={{ maxWidth: 440, margin: '24px auto' }}>
      <h1>Reset your password</h1>
      {msg ? <p className="okbox">{msg}</p> : (
        <form className="stack" onSubmit={async (e) => { e.preventDefault(); try { setMsg((await api<{ message: string }>('/v1/auth/password-reset/request', { body: { email } })).message); } catch (x) { setErr(x as Error); } }}>
          <label className="field">Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <Problem error={err} />
          <button className="btn" type="submit">Send reset link</button>
        </form>
      )}
    </div>
  );
}
