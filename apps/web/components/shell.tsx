'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { Disclosure, useApi } from './ui';
import { useApp } from './providers';
import { CommandPalette } from './command-palette';

const APP_NAV: [string, string][] = [
  ['/app', 'Home'], ['/app/academy', 'Academy'], ['/app/terminal', 'Terminal (demo)'], ['/app/market', 'Market (demo)'], ['/app/crypto', 'Digital Assets'], ['/app/equities', 'Indian equities'], ['/app/commodities', 'Commodities'], ['/app/research-hub', 'Research hub'], ['/app/companies', 'Companies (demo)'], ['/app/assistant', 'Assistant (demo)'], ['/app/screener', 'Screener (demo)'], ['/app/lab', 'Quant Lab (demo)'], ['/app/research', 'My research'], ['/app/learn', 'Quick lessons'], ['/app/data-health', 'Data health'],
];
/** Sections that show only the fictional development companies (API: DEMO_ONLY_PREFIXES in app.ts). */
const DEMO_PATHS = ['/app/terminal', '/app/market', '/app/companies', '/app/assistant', '/app/screener', '/app/lab', '/app/briefings'];
// My research mixes company watchlists (demo) with your own uploads (real): only its main page is flagged.
export const isDemoPath = (path: string) => path === '/app/research' || path === '/app' || DEMO_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

/** Real-data mode (demo data off): only modules that run on real, sourced data. */
const REAL_NAV: [string, string][] = [
  ['/app', 'Home'], ['/app/equities', 'Indian markets'], ['/app/crypto', 'Digital Assets'], ['/app/commodities', 'Commodities'], ['/app/macro', 'Macro'], ['/app/research-hub', 'Research hub'], ['/app/research/datasets', 'Your data'], ['/app/academy', 'Academy'], ['/app/learn', 'Quick lessons'], ['/app/data-health', 'Data sources'],
];

const PUBLIC_NAV: [string, string][] = [['/', 'Overview'], ['/app/academy', 'Academy'], ['/briefing-sample', 'Sample briefing'], ['/pricing', 'Pricing'], ['/methodology', 'Methodology'], ['/help', 'Help']];
const PUBLIC_NAV_REAL: [string, string][] = PUBLIC_NAV.filter(([h]) => h !== '/briefing-sample');

// Grouped navigation: a few clear choices at the top (Hick's law); the detail one click away.
type NavLink = { href: string; label: string; desc?: string };
type NavGroup = { label: string; href?: string; items?: NavLink[] };
const REAL_GROUPS: NavGroup[] = [
  { label: 'Home', href: '/app' },
  { label: 'Markets', items: [
    { href: '/app/equities', label: 'Indian markets', desc: 'NIFTY 50, SENSEX, NIFTY BANK · end of day' },
    { href: '/app/crypto', label: 'Digital assets', desc: 'Prices, DeFi and on-chain data' },
    { href: '/app/commodities', label: 'Commodities', desc: 'Oil, gas, metals, crops, inventories' },
    { href: '/app/macro', label: 'Macro', desc: 'Rates, inflation, jobs, the rupee' },
  ] },
  { label: 'Discover', items: [
    { href: '/app/universe', label: 'ATLAS Universe', desc: 'A 3D globe of everything ATLAS stores' },
    { href: '/app/network', label: 'Intelligence Network', desc: 'How markets moved together, measured' },
    { href: '/app/pulse', label: 'Market Pulse', desc: 'What moved and what was published' },
  ] },
  { label: 'Research', items: [
    { href: '/app/research-hub', label: 'Research Studio', desc: 'Portfolios, backtests, notebook, reports' },
    { href: '/app/macro/explorer', label: 'Compare two series', desc: 'Correlation over time, explained' },
    { href: '/app/research/datasets', label: 'Your data', desc: 'Upload and analyse your own files' },
    { href: '/app/data-health', label: 'Data sources', desc: 'Where every number comes from, and how fresh it is' },
  ] },
  { label: 'Learn', items: [
    { href: '/app/academy', label: 'Academy', desc: 'Nine courses with 3D charts, labs and videos' },
    { href: '/app/academy/constellation', label: 'Knowledge Constellation', desc: 'Your learning as a 3D sky' },
    { href: '/app/academy/progress', label: 'My progress', desc: 'XP, levels, missions and badges' },
    { href: '/app/learn', label: 'Quick lessons', desc: 'Short concept notes' },
  ] },
];
const DEMO_GROUPS: NavGroup[] = [
  { label: 'Home', href: '/app' },
  { label: 'Markets', items: [{ href: '/app/market', label: 'Market (demo)' }, { href: '/app/equities', label: 'Indian equities' }, { href: '/app/crypto', label: 'Digital assets' }, { href: '/app/commodities', label: 'Commodities' }, { href: '/app/terminal', label: 'Terminal (demo)' }] },
  { label: 'Research', items: [{ href: '/app/research-hub', label: 'Research hub' }, { href: '/app/companies', label: 'Companies (demo)' }, { href: '/app/screener', label: 'Screener (demo)' }, { href: '/app/lab', label: 'Quant Lab (demo)' }, { href: '/app/assistant', label: 'Assistant (demo)' }, { href: '/app/research', label: 'My research' }, { href: '/app/data-health', label: 'Data health' }] },
  { label: 'Discover', items: [{ href: '/app/universe', label: 'ATLAS Universe' }, { href: '/app/network', label: 'Intelligence Network' }, { href: '/app/pulse', label: 'Market Pulse' }] },
  { label: 'Learn', items: [{ href: '/app/academy', label: 'Academy' }, { href: '/app/academy/constellation', label: 'Knowledge Constellation' }, { href: '/app/academy/progress', label: 'My progress' }, { href: '/app/learn', label: 'Quick lessons' }] },
];
const TOOL_PATHS: Record<string, string> = { '/app/research-hub': 'Research Studio', '/app/universe': 'ATLAS Universe', '/app/network': 'Intelligence Network', '/app/pulse': 'Market Pulse', '/app/macro/explorer': 'Compare two series', '/app/academy/constellation': 'Knowledge Constellation', '/app/research/datasets': 'Your data' };
const remember = (key: string, item: { href: string; label: string }) => {
  try {
    const list = (JSON.parse(localStorage.getItem(key) ?? '[]') as { href: string; label: string }[]).filter((x) => x.href !== item.href);
    localStorage.setItem(key, JSON.stringify([item, ...list].slice(0, 6)));
  } catch { /* storage off */ }
};

/** A top-level section: a plain link, or a menu that opens on click (keyboard and screen-reader friendly). */
function NavMenu({ g, active, open, setOpen }: { g: NavGroup; active: (href: string) => boolean; open: boolean; setOpen: (v: boolean) => void }) {
  if (g.href) return <a className="nav-top" href={g.href} aria-current={active(g.href) ? 'page' : undefined}>{g.label}</a>;
  const on = g.items!.some((i) => active(i.href));
  return (
    <div className="nav-group" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
      <button className={`nav-top${on ? ' on' : ''}`} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>{g.label}<span className="caret" aria-hidden="true">▾</span></button>
      {open && (
        <div className="nav-menu" role="menu">
          {g.items!.map((i) => (
            <a key={i.href} role="menuitem" href={i.href} aria-current={active(i.href) ? 'page' : undefined}>
              <span className="nm-label">{i.label}</span>{i.desc && <span className="nm-desc">{i.desc}</span>}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/** Everything about the account in one place: plan, settings, theme, feedback, sign out. */
function AccountMenu({ email, name, plan, role, onTheme, onSignOut, onFeedback }: { email: string; name: string | null; plan: string; role: string; onTheme: () => void; onSignOut: () => void; onFeedback: () => void }) {
  const [open, setOpen] = useState(false);
  const initials = (name || email.replace(/@.*/, '')).split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'A';
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.acct')) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="acct">
      <button className="avatar" aria-expanded={open} aria-haspopup="true" aria-label="Account menu" onClick={() => setOpen(!open)}>{initials}</button>
      {open && (
        <div className="acct-menu" role="menu">
          <p className="acct-who"><strong>{name || email.replace(/@.*/, '')}</strong><span>{email}</span><a className="acct-plan" href="/app/billing">{plan} plan</a></p>
          <a role="menuitem" href="/app/settings">Settings</a>
          <a role="menuitem" href="/app/account">Account and privacy</a>
          {['admin', 'support', 'data_ops'].includes(role) && <a role="menuitem" href="/admin">Admin</a>}
          <button role="menuitem" onClick={onTheme}>Switch light / dark</button>
          <button role="menuitem" onClick={() => { setOpen(false); onFeedback(); }}>Send feedback</button>
          <button role="menuitem" className="acct-out" onClick={onSignOut}>Sign out</button>
        </div>
      )}
    </div>
  );
}

/** Demo mode as reported by the API (public /v1/status), for pages shown before sign-in. */
export function useDemoMode(): boolean | null {
  const s = useApi<{ demo_mode?: boolean }>('/v1/status');
  return s.data ? s.data.demo_mode !== false : null;
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname() ?? '/';
  const router = useRouter();
  const { me, loading, refresh } = useApp();
  const inApp = path.startsWith('/app') || path.startsWith('/admin');
  const publicDemo = useDemoMode();
  // Signed out (or before the account loads), the API's public status says which mode this install runs in.
  // Until either answers, no demo-only links are shown: in real-data mode they would lead to 403 pages.
  const demo = me ? me.demo_mode !== false : publicDemo;
  const nav = inApp ? (demo === false ? REAL_NAV : demo === null ? [] : APP_NAV) : publicDemo === true ? PUBLIC_NAV : PUBLIC_NAV_REAL;
  const groups = inApp ? (demo === false ? REAL_GROUPS : demo === null ? [] : DEMO_GROUPS) : null;
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  // Menus close on any outside click and when the page changes.
  useEffect(() => {
    if (!openMenu) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.nav-group')) setOpenMenu(null); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openMenu]);
  useEffect(() => { setOpenMenu(null); }, [path]);
  // Experience mode: Focus by default; the saved choice applies on any device, the local one wins.
  const [mode, setModeState] = useState<'focus' | 'explore'>('focus');
  useEffect(() => {
    let m: string | null = null;
    try { m = localStorage.getItem('atlas-mode'); } catch { /* storage off */ }
    const v = (m ?? me?.profile.display_prefs?.mode) === 'explore' ? 'explore' : 'focus';
    document.documentElement.dataset.mode = v;
    setModeState(v);
    window.dispatchEvent(new Event('atlas-mode'));
  }, [me]);
  const setMode = (v: 'focus' | 'explore') => {
    document.documentElement.dataset.mode = v;
    setModeState(v);
    try { localStorage.setItem('atlas-mode', v); } catch { /* storage off */ }
    window.dispatchEvent(new Event('atlas-mode'));
    if (me) void api('/v1/me', { method: 'PATCH', body: { display_prefs: { mode: v } } }).catch(() => undefined);
  };
  // Recently viewed pages and tools, kept on this device for the command centre.
  useEffect(() => {
    if (!me || !inApp) return;
    const tool = TOOL_PATHS[path];
    if (tool) { remember('atlas-tools', { href: path, label: tool }); return; }
    if (!/^\/app\/(equities\/[^/]+\/[^/]+|crypto\/assets\/[^/]+|commodities\/[^/]+\/[^/]+|macro\/(?!explorer)[^/]+|academy\/lesson\/[^/]+)$/.test(path)) return;
    const t = setTimeout(() => { const h = document.querySelector('main h1')?.textContent?.trim(); if (h) remember('atlas-recent', { href: path, label: h.slice(0, 70) }); }, 1800);
    return () => clearTimeout(t);
  }, [path, me, inApp]);
  const notes = useApi<{ notifications: { notification_id: string; read_at: string | null }[] }>(me ? '/v1/notifications' : null, [me?.profile.user_id]);
  const unread = notes.data?.notifications.filter((n) => !n.read_at).length ?? 0;
  const [fb, setFb] = useState(false);
  const [search, setSearch] = useState(false);
  // Ctrl/⌘+K anywhere, or "/" when not typing in a field, opens universal search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable);
      if ((e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        if (!me) return;
        e.preventDefault();
        setSearch(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [me]);
  // The account's saved theme applies on a device that has no theme choice of its own yet.
  useEffect(() => {
    const t = me?.profile.display_prefs?.theme;
    if (!t) return;
    try { if (localStorage.getItem('atlas-theme')) return; } catch { /* ignore */ }
    document.documentElement.dataset.theme = t;
  }, [me]);
  useEffect(() => {
    if (!loading && !me && inApp) router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [loading, me, inApp, path, router]);
  const toggleTheme = () => {
    const r = document.documentElement;
    const cur = r.dataset.theme === 'light' ? 'light' : 'dark'; // dark is the default theme
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
        {!inApp && <nav className="pub-nav" aria-label="Site">{nav.filter(([h]) => h !== '/').map(([href, label]) => <a key={href} href={href} aria-current={active(href) ? 'page' : undefined}>{label}</a>)}</nav>}
        <span className="spacer" />
        {me ? (
          <>
            {inApp && (
              <div className="mode-switch" role="group" aria-label="Experience mode">
                <button className={mode === 'focus' ? 'on' : ''} aria-pressed={mode === 'focus'} onClick={() => setMode('focus')} title="Focus: dense and quiet, for working">Focus</button>
                <button className={mode === 'explore' ? 'on' : ''} aria-pressed={mode === 'explore'} onClick={() => setMode('explore')} title="Explore: immersive 3D and richer motion">Explore</button>
              </div>
            )}
            <button className="searchbtn" onClick={() => setSearch(true)} aria-label="Search ATLAS (Ctrl+K)"><span aria-hidden="true">⌕</span><span className="lbl">Search</span><kbd>Ctrl K</kbd></button>
            <a className="bell" href="/app/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z" /></svg>{unread > 0 && <span className="badge">{unread > 9 ? '9+' : unread}</span>}</a>
            {!inApp && path !== "/onboarding" && <a className="btn btn-cta" href="/app">Open ATLAS</a>}
            <AccountMenu email={me.profile.email} name={me.profile.display_name} plan={me.plan.name} role={me.profile.role} onTheme={toggleTheme} onSignOut={signOut} onFeedback={() => setFb(true)} />
          </>
        ) : (
          <>
            <a className="signin" href="/login">Sign in</a>
            <a className="btn btn-cta" href="/signup">Start free</a>
          </>
        )}
      </header>
      {groups && groups.length > 0 && (
        <nav className="nav" aria-label="Sections">
          {groups.map((g) => <NavMenu key={g.label} g={g} active={active} open={openMenu === g.label} setOpen={(v) => setOpenMenu(v ? g.label : null)} />)}
        </nav>
      )}
      {me && !me.profile.email_verified_at && inApp && <div className="warn" style={{ margin: '0 auto', maxWidth: 1140 }}>Verify your email to save research, pay or receive alerts. <ResendLink /></div>}
      {me && inApp && isDemoPath(path) && !(me.demo_mode === false && path === '/app') && (me.demo_mode !== false
        ? <div className="warn" role="note" style={{ margin: '0 auto', maxWidth: 1140 }}><strong>Demo data.</strong> This section shows fictional development companies and generated figures, not real Indian market data. Real NSE/BSE prices are under <a href="/app/equities">Indian equities</a>.</div>
        : <div className="err" role="note" style={{ margin: '0 auto', maxWidth: 1140 }}>Demo mode is off (ALLOW_SYNTHETIC_DATA=false), so this section has no data. Real NSE/BSE prices are under <a href="/app/equities">Indian equities</a>.</div>)}
      <main id="main" tabIndex={-1}>{children}</main>
      <footer className="foot">
        <nav aria-label="Footer">
          <a href="/methodology">Methodology</a><a href="/methodology/sources">Data sources</a><a href="/methodology/corrections">Correction log</a><a href="/methodology/ai">How AI answers work</a>
          <a href="/help">Help</a><a href="/status">Status</a><a href="/legal/privacy">Privacy</a><a href="/legal/terms">Terms</a><a href="/legal/grievance">Grievances</a>
          <button className="link" onClick={() => setFb(true)}>Send feedback</button>
          {!me && <button className="link" onClick={toggleTheme}>Light / dark</button>}
        </nav>
        <Disclosure />
      </footer>
      {fb && <FeedbackDialog onClose={() => setFb(false)} />}
      <CommandPalette open={search} onClose={() => setSearch(false)} />
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
