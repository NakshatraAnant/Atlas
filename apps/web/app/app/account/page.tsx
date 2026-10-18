'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/components/providers';
import { Loading, Problem, useApi } from '@/components/ui';
import { dateOrDash } from '@/lib/format';

export default function Account() {
  const { me, refresh, toast } = useApp();
  const [err, setErr] = useState<Error | null>(null);
  const [f, setF] = useState({ display_name: '', experience_level: 'intermediate', briefing_email: 'daily' });
  useEffect(() => {
    if (me) setF({ display_name: me.profile.display_name ?? '', experience_level: me.profile.experience_level ?? 'intermediate', briefing_email: me.profile.briefing_email });
  }, [me]);
  if (!me) return <Loading />;
  const save = async () => {
    try {
      await api('/v1/me', { method: 'PATCH', body: { display_name: f.display_name || null, experience_level: f.experience_level, briefing_email: f.briefing_email } });
      toast('Saved. Briefing email changes apply from the next cycle.');
      setErr(null);
      void refresh();
    } catch (e) { setErr(e as Error); }
  };
  return (
    <>
      <h1>Account</h1>
      <section className="card stack"><h2>Profile and preferences</h2>
        <p>Email: {me.profile.email} {me.profile.email_verified_at ? <span className="t o">verified</span> : <span className="t r">not verified</span>}</p>
        <label className="field">Display name<input value={f.display_name} maxLength={80} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></label>
        <label className="field">Experience level<select value={f.experience_level} onChange={(e) => setF({ ...f, experience_level: e.target.value })}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label>
        <label className="field">Market briefing email<select value={f.briefing_email} onChange={(e) => setF({ ...f, briefing_email: e.target.value })}><option value="daily">Every trading day</option><option value="weekly">Weekly summary</option><option value="off">Off</option></select></label>
        <Problem error={err} />
        <button className="btn" onClick={save}>Save</button>
      </section>
      <Consents />
      <Security />
      <Sessions />
      <DataRights />
    </>
  );
}

function Consents() {
  const c = useApi<{ current: { kind: string; version: string; granted: boolean; at: string }[]; history: { kind: string; granted: boolean; at: string; source: string }[] }>('/v1/me/consents');
  const { toast } = useApp();
  if (c.loading) return <Loading />;
  if (c.error) return <Problem error={c.error} />;
  const get = (k: string) => c.data!.current.find((x) => x.kind === k)?.granted ?? false;
  const set = async (k: string, v: boolean) => {
    await api('/v1/me/consents', { body: { [k]: v } });
    toast('Preference saved');
    c.reload();
  };
  return (
    <section className="card"><h2>Communication and privacy choices</h2>
      {[['product_updates', 'Product update emails'], ['marketing', 'Marketing emails'], ['analytics', 'Non-essential product analytics']].map(([k, l]) => (
        <label key={k} style={{ display: 'block' }}><input type="checkbox" checked={get(k!)} onChange={(e) => set(k!, e.target.checked)} /> {l}</label>
      ))}
      <p className="mu">Service emails (security, billing, data corrections you asked for) are always sent. Every change is recorded below.</p>
      <details><summary>Consent history</summary><ul>{c.data!.history.map((h, i) => <li key={i}>{h.kind}: {h.granted ? 'granted' : 'withdrawn'} · {dateOrDash(h.at)} · {h.source}</li>)}</ul></details>
    </section>
  );
}

function Security() {
  const { me, refresh } = useApp();
  const [enrol, setEnrol] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  return (
    <section className="card stack"><h2>Two-step verification</h2>
      {me!.profile.totp_enabled_at ? <p className="okbox">On since {dateOrDash(me!.profile.totp_enabled_at)}.</p> : !enrol ? (
        <><p>Add an authenticator app for a second sign-in step. Staff accounts must use it.</p><button className="btn s" onClick={async () => { try { setEnrol(await api('/v1/auth/totp/enrol', { body: {} })); } catch (e) { setErr(e as Error); } }}>Set up an authenticator app</button></>
      ) : (
        <>
          <p>Add this key to your authenticator app (or open the link on your phone), then enter the 6-digit code.</p>
          <p><code style={{ wordBreak: 'break-all' }}>{enrol.secret}</code></p>
          <p><a href={enrol.otpauth}>Open in authenticator app</a></p>
          <label className="field">6-digit code<input inputMode="numeric" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /></label>
          <button className="btn" onClick={async () => { try { const r = await api<{ recovery_codes: string[] }>('/v1/auth/totp/confirm', { body: { code } }); setCodes(r.recovery_codes); setEnrol(null); void refresh(); } catch (e) { setErr(e as Error); } }}>Turn on</button>
        </>
      )}
      {codes && <div className="warn"><p><strong>Recovery codes — shown once.</strong> Each works one time if you lose your phone.</p><pre>{codes.join('\n')}</pre></div>}
      <Problem error={err} />
      <p><a href="/forgot-password">Change password</a> (sends a reset link to your email)</p>
    </section>
  );
}

function Sessions() {
  const s = useApi<{ sessions: { id: string; created_at: string; last_seen_at: string; ip: string | null; user_agent: string | null; current: boolean }[] }>('/v1/me/sessions');
  if (s.loading) return <Loading />;
  if (s.error) return <Problem error={s.error} />;
  return (
    <section className="card"><h2>Signed-in devices</h2>
      <ul>{s.data!.sessions.map((x) => <li key={x.id}>{x.user_agent?.slice(0, 80) ?? 'Unknown device'} · {x.ip ?? ''} · last active {dateOrDash(x.last_seen_at)} {x.current ? <strong>(this device)</strong> : <button className="link" onClick={async () => { await api(`/v1/me/sessions/${x.id}`, { method: 'DELETE' }); s.reload(); }}>Sign out</button>}</li>)}</ul>
      <button className="btn s" onClick={async () => { await api('/v1/me/sessions/revoke-all', { body: {} }); s.reload(); }}>Sign out all other devices</button>
    </section>
  );
}

function DataRights() {
  const [exp, setExp] = useState<{ status: string; download: string | null; expires_at: string | null; note: string } | null>(null);
  const [del, setDel] = useState({ open: false, password: '', confirm: '' });
  const [err, setErr] = useState<Error | null>(null);
  return (
    <section className="card stack"><h2>Your data</h2>
      <div>
        <button className="btn s" onClick={async () => { try { setExp(await api('/v1/me/export', { body: {} })); } catch (e) { setErr(e as Error); } }}>Export my data (JSON and CSV)</button>
        {exp && <p className="okbox">{exp.status === 'ready' && exp.download ? <>Ready: <a href={exp.download}>download JSON</a> · <a href={exp.download.replace('format=json', 'format=csv') + (exp.download.includes('format=') ? '' : '&format=csv')}>CSV</a>. The link expires {dateOrDash(exp.expires_at)}.</> : exp.note}</p>}
      </div>
      <div>
        {!del.open ? <button className="link" onClick={() => setDel({ ...del, open: true })}>Delete my account</button> : (
          <div className="warn stack">
            <p>Deleting closes your account now, stops any renewal and signs you out everywhere. Personal data is erased within 30 days; invoices are kept as tax law requires.</p>
            <label className="field">Password<input type="password" autoComplete="current-password" value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} /></label>
            <label className="field">Type DELETE to confirm<input value={del.confirm} onChange={(e) => setDel({ ...del, confirm: e.target.value })} /></label>
            <div className="row">
              <button className="btn" disabled={del.confirm !== 'DELETE' || !del.password} onClick={async () => { try { await api('/v1/me', { method: 'DELETE', body: { password: del.password, confirm: 'DELETE' } }); window.location.href = '/'; } catch (e) { setErr(e as Error); } }}>Delete account</button>
              <button className="btn s" onClick={() => setDel({ open: false, password: '', confirm: '' })}>Cancel</button>
            </div>
          </div>
        )}
      </div>
      <Problem error={err} />
      <p className="mu">Questions about your data: <a href="/legal/grievance">grievance officer</a>.</p>
    </section>
  );
}
