'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { Disclosure, useApi } from './ui';
import { useApp } from './providers';

const APP_NAV: [string, string][] = [
  ['/app', 'Home'], ['/app/academy', 'Academy'], ['/app/market', 'Market'], ['/app/companies', 'Companies'], ['/app/assistant', 'Assistant'], ['/app/screener', 'Screener'], ['/app/lab', 'Quant Lab'], ['/app/research', 'My research'], ['/app/learn', 'Quick lessons'],
];
const PUBLIC_NAV: [string, string][] = [['/', 'Overview'], ['/app/academy', 'Academy'], ['/briefing-sample', 'Sample briefing'], ['/pricing', 'Pricing'], ['/methodology', 'Methodology'], ['/help', 'Help']];

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname() ?? '/';
  const router = useRouter();
  const { me, loading, refresh } = useApp();
  const inApp = path.startsWith('/app') || path.startsWith('/admin');
  const nav = inApp ? APP_NAV : PUBLIC_NAV;
  const notes = useApi<{ notifications: { notification_id: string; read_at: string | null }[] }>(me ? '/v1/notifications' : null, [me?.profile.user_id]);
  const unread = notes.data?.notifications.filter((n) => !n.read_at).length ?? 0;
  const [fb, setFb] = useState(false);
  useEffect(() => {
    if (!loading && !me && inApp) router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [loading, me, inApp, path, router]);
  const toggleTheme = () => {
    const r = document.documentElement;
    const cur = r.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    r.dataset.theme = next;
    try { localStorage.setItem('atlas-theme', next); } catch { /* ignore */ }
  };
  const signOut = async () => {
    await api('/v1/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
    await refresh();
    router.push('/');
  };
  const active = (href: string) => (href === '/app' || href === '/' ? path === href : path.startsWith(href));
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="top">
        <a href={me ? '/app' : '/'} className="logo" aria-label="ATLAS home">ATLAS</a>
        <span className="tag">Research workspace for Indian equities · end-of-day data</span>
        {me ? (
          <>
            <a className="pill" href="/app/billing" title="Your plan">{me.plan.name}{me.plan.status === 'past_due' ? ' · payment due' : ''}</a>
            <a className="pill" href="/app/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>Notices{unread ? ` (${unread})` : ''}</a>
            {['admin', 'support', 'data_ops'].includes(me.profile.role) && <a className="pill" href="/admin">Admin</a>}
            <a className="pill" href="/app/account">Account</a>
            <button onClick={signOut}>Sign out</button>
          </>
        ) : (
          <>
            <a className="pill" href="/login">Sign in</a>
            <a className="pill" href="/signup">Create free account</a>
          </>
        )}
        <button onClick={toggleTheme} aria-label="Toggle light or dark theme">Theme</button>
      </header>
      <nav className="nav" aria-label="Sections">
        {nav.map(([href, label]) => <a key={href} href={href} aria-current={active(href) ? 'page' : undefined}>{label}</a>)}
      </nav>
      {me && !me.profile.email_verified_at && inApp && <div className="warn" style={{ margin: '0 auto', maxWidth: 1140 }}>Verify your email to save research, pay or receive alerts. <ResendLink /></div>}
      <main id="main" tabIndex={-1}>{children}</main>
      <footer className="foot">
        <nav aria-label="Footer">
          <a href="/methodology">Methodology</a><a href="/methodology/sources">Data sources</a><a href="/methodology/corrections">Correction log</a><a href="/methodology/ai">How AI answers work</a>
          <a href="/help">Help</a><a href="/status">Status</a><a href="/legal/privacy">Privacy</a><a href="/legal/terms">Terms</a><a href="/legal/grievance">Grievances</a>
          <button className="link" onClick={() => setFb(true)}>Send feedback</button>
        </nav>
        <Disclosure />
      </footer>
      {fb && <FeedbackDialog onClose={() => setFb(false)} />}
    </>
  );
}

function ResendLink() {
  const [msg, setMsg] = useState<string | null>(null);
  return msg ? <span>{msg}</span> : <button className="link" onClick={async () => { try { const r = await api<{ message: string }>('/v1/auth/resend-verification', { body: {} }); setMsg(r.message); } catch (e) { setMsg((e as Error).message); } }}>Resend the link</button>;
}

export function FeedbackDialog({ onClose, kind = 'feedback', subject = '' }: { onClose: () => void; kind?: string; subject?: string }) {
  const { me } = useApp();
  const [form, setForm] = useState({ kind, subject, comment: '', email: '' });
  const [shot, setShot] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<{ ticket_ref: string; first_response_due: string }>('/v1/feedback', { body: { ...form, email: me ? undefined : form.email, page: location.pathname, screenshot_data_url: shot ?? undefined } });
      setDone(`Thank you. Reference ${r.ticket_ref}; we reply by ${new Date(r.first_response_due).toLocaleDateString('en-IN')}.`);
    } catch (x) {
      setErr((x as Error).message);
    }
  };
  return (
    <>
      <div className="backdrop" onClick={onClose} aria-hidden="true" />
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="fb-title">
        <h2 id="fb-title">Send feedback</h2>
        {done ? <p className="okbox">{done}</p> : (
          <form onSubmit={submit} className="stack">
            <label className="field">Type<select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="feedback">Feedback</option><option value="data_issue">Data issue</option><option value="ai_issue">AI answer issue</option><option value="support">Support request</option><option value="billing">Billing</option></select></label>
            <label className="field">Subject<input required minLength={2} maxLength={200} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></label>
            <label className="field">Details<textarea rows={4} maxLength={5000} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} /></label>
            {!me && <label className="field">Email for our reply<input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>}
            <label className="field">Screenshot (optional, PNG/JPEG under 2 MB)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return setShot(null);
              if (f.size > 1_800_000) { setErr('Screenshot is larger than 2 MB.'); return; }
              const r = new FileReader();
              r.onload = () => setShot(String(r.result));
              r.readAsDataURL(f);
            }} /></label>
            {err && <p className="err">{err}</p>}
            <p className="mu">The current page address is attached so we can find the context.</p>
            <div className="row"><button className="btn" type="submit">Send</button><button className="btn s" type="button" onClick={onClose}>Cancel</button></div>
          </form>
        )}
        {done && <button className="btn s" onClick={onClose}>Close</button>}
      </div>
    </>
  );
}
