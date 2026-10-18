'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/components/providers';

export default function Verify() {
  const { refresh, me } = useApp();
  const [state, setState] = useState<'working' | 'ok' | 'error'>('working');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    const token = new URLSearchParams(location.search).get('token');
    if (!token) {
      setState('error');
      setMsg('This link has no token.');
      return;
    }
    api('/v1/auth/verify-email', { body: { token } })
      .then(async () => {
        setState('ok');
        await refresh();
      })
      .catch((e) => {
        setState('error');
        setMsg((e as Error).message);
      });
  }, [refresh]);
  return (
    <div className="card" style={{ maxWidth: 520, margin: '24px auto' }}>
      <h1>Email verification</h1>
      {state === 'working' && <p>Verifying…</p>}
      {state === 'ok' && <><p className="okbox">Your email is verified.</p><a className="btn" href={me ? '/onboarding' : '/login?next=/onboarding'}>Continue to onboarding</a></>}
      {state === 'error' && <p className="err">{msg}</p>}
    </div>
  );
}
