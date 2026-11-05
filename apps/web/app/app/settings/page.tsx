'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp, type DisplayPrefs } from '@/components/providers';
import { FollowButton } from '@/components/follow-button';
import { Loading, useApi } from '@/components/ui';
import { DEFAULT_PANELS, PANELS } from '@/lib/home-panels';

// Settings: what Home shows and in which order, which notices arrive, theme and the optional streak.
// Saved to the account (display preferences), so they follow the user across devices.

const MARKETS: [string, string][] = [['india', 'Indian markets'], ['us', 'US economy'], ['commodities', 'Commodities'], ['crypto', 'Digital assets']];

export default function Settings() {
  const { me, refresh, toast } = useApp();
  const follows = useApi<{ items: { key: string; title: string; href: string; latest: string | null }[] }>('/v1/follows');
  const [p, setP] = useState<DisplayPrefs | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (me && !p) setP(me.profile.display_prefs ?? {}); }, [me, p]);
  if (!me || !p) return <Loading lines={6} />;
  const panels = p.home_panels ?? DEFAULT_PANELS;
  const set = (patch: Partial<DisplayPrefs>) => setP({ ...p, ...patch });
  const move = (id: string, by: number) => {
    const a = [...panels];
    const i = a.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j]!, a[i]!];
    set({ home_panels: a });
  };
  const toggle = (id: string) => set({ home_panels: panels.includes(id) ? panels.filter((x) => x !== id) : [...panels, id] });
  const save = async () => {
    setSaving(true);
    try {
      const display_prefs: DisplayPrefs = { home_panels: panels, markets: p.markets ?? [], notify: { releases: p.notify?.releases ?? true, digest: p.notify?.digest ?? false }, show_streak: p.show_streak ?? true, theme: p.theme ?? 'dark' };
      await api('/v1/me', { method: 'PATCH', body: { display_prefs } });
      document.documentElement.dataset.theme = display_prefs.theme;
      try { localStorage.setItem('atlas-theme', display_prefs.theme!); } catch { /* ignore */ }
      await refresh();
      toast('Settings saved.');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const hidden = PANELS.filter(([id]) => !panels.includes(id));
  return (
    <>
      <h1>Settings</h1>
      <p className="mu">These choices are saved to your account. Profile, privacy, sign-in and data export are on <a href="/app/account">Account</a>.</p>

      <section className="card" aria-labelledby="s-home">
        <h2 id="s-home">Home panels</h2>
        <p className="mu">Choose what Home shows and in which order.</p>
        <ol className="settings-list">
          {panels.map((id, i) => {
            const d = PANELS.find((x) => x[0] === id);
            if (!d) return null;
            return (
              <li key={id}>
                <span><strong>{d[1]}</strong> <span className="mu">· {d[2]}</span></span>
                <span className="row-actions">
                  <button className="btn s" onClick={() => move(id, -1)} disabled={i === 0} aria-label={`Move ${d[1]} up`}>↑</button>
                  <button className="btn s" onClick={() => move(id, 1)} disabled={i === panels.length - 1} aria-label={`Move ${d[1]} down`}>↓</button>
                  <button className="btn s" onClick={() => toggle(id)}>Hide</button>
                </span>
              </li>
            );
          })}
        </ol>
        {hidden.length > 0 && <p>Hidden: {hidden.map(([id, title], i) => <span key={id}>{i ? ' · ' : ''}<button className="link" onClick={() => toggle(id)}>Show {title}</button></span>)}</p>}
        <button className="link" onClick={() => set({ home_panels: DEFAULT_PANELS })}>Restore the default order</button>
      </section>

      <section className="card" aria-labelledby="s-mk">
        <h2 id="s-mk">Markets you follow most</h2>
        <p className="mu">Used to order search results and suggestions. Leave all unticked to treat every market equally.</p>
        <div className="cx-filters">
          {MARKETS.map(([id, label]) => (
            <label key={id} className="check"><input type="checkbox" checked={(p.markets ?? []).includes(id)} onChange={(e) => set({ markets: e.target.checked ? [...(p.markets ?? []), id] : (p.markets ?? []).filter((x) => x !== id) })} /> {label}</label>
          ))}
        </div>
      </section>

      <section className="card" aria-labelledby="s-nt">
        <h2 id="s-nt">Notices</h2>
        <label className="check"><input type="checkbox" checked={p.notify?.releases ?? true} onChange={(e) => set({ notify: { ...p.notify, releases: e.target.checked } })} /> Tell me when a series I follow has new data</label>
        <label className="check"><input type="checkbox" checked={p.notify?.digest ?? false} onChange={(e) => set({ notify: { ...p.notify, digest: e.target.checked } })} /> Weekly summary of my followed series and learning (in-app, at most once a week)</label>
        <p className="mu">Notices appear under <a href="/app/notifications">Notices</a>. ATLAS does not send push notifications. Email briefings are set on Account.</p>
      </section>

      <section className="card" aria-labelledby="s-ap">
        <h2 id="s-ap">Appearance and learning</h2>
        <div className="cx-filters">
          <label className="field">Theme<select value={p.theme ?? 'dark'} onChange={(e) => set({ theme: e.target.value as 'dark' | 'light' })}><option value="dark">Dark</option><option value="light">Light</option></select></label>
        </div>
        <label className="check"><input type="checkbox" checked={p.show_streak ?? true} onChange={(e) => set({ show_streak: e.target.checked })} /> Show learning streaks</label>
        <p className="mu">Streaks are optional. Hiding them changes nothing about your XP, levels or achievements.</p>
      </section>

      <p><button className="btn" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save settings'}</button></p>

      <section className="card" aria-labelledby="s-fl">
        <h2 id="s-fl">Followed series</h2>
        {follows.loading && !follows.data ? <Loading lines={2} /> : follows.data?.items.length ? (
          <ul className="settings-list">{follows.data.items.map((f) => <li key={f.key}><span><a href={f.href}>{f.title}</a> <span className="mu">· latest {f.latest ?? '—'}</span></span><FollowButton seriesKey={f.key} label={f.title} /></li>)}</ul>
        ) : <p className="mu">You are not following any series. Open a <a href="/app/macro">macro</a> or <a href="/app/commodities">commodity</a> series and choose Follow.</p>}
      </section>
    </>
  );
}
