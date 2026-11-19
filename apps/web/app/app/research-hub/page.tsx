'use client';
import { useEffect, useRef, useState } from 'react';
import { Tabs, useApi } from '@/components/ui';
import { api } from '@/lib/api';
import { readRecent } from '@/components/motion';
import * as T from './tabs';

// Research hub: cross-asset research over real crypto data, real imported Indian equities and your own
// uploaded files. Synthetic development data is never selectable here.

const TABS: [string, string][] = [
  ['workbench', 'Workbench'], ['screener', 'Screener & factors'], ['portfolios', 'Portfolios & risk'], ['correlation', 'Correlation regimes'],
  ['backtest', 'Walk-forward'], ['events', 'Event study'], ['regimes', 'Regimes'], ['integrity', 'Data integrity'], ['discovery', 'Discovery'],
  ['notebook', 'Notebook'], ['reports', 'Reports'], ['alerts', 'Alerts'],
];

const HELP: Record<string, string> = {
  workbench: 'Compare instruments rebased to 1.0, with returns, volatility, drawdown, Sharpe and beta', screener: 'Rank stored assets on momentum, volatility, size and other factors',
  portfolios: 'Build hypothetical portfolios; see return, risk, contributions and stress tests', correlation: 'Rolling correlation between two instruments and how it shifts',
  backtest: 'Test a rule out of sample, with costs, against buy-and-hold', events: 'Average behaviour around dated events', regimes: 'Calm and stressed periods in a series',
  integrity: 'Gaps, deviations between sources and revisions in the data', discovery: 'Rule-based things worth a closer look', notebook: 'Notes, hypotheses with review dates, and reflections',
  reports: 'Sourced research reports you can export', alerts: 'Notices when stored data meets your conditions',
};
type Layout = { side: boolean; dense: boolean };

/** Studio side panel: what you opened recently, reviews that are due, a quick note, shortcuts. */
function StudioSide({ onTab, tab }: { onTab: (t: string) => void; tab: string }) {
  const nb = useApi<{ reviews_due: { entry_id: string; title: string; review_date: string }[] }>('/v1/research/notebook');
  const [recent, setRecent] = useState<{ href: string; label: string }[]>([]);
  const [note, setNote] = useState({ title: '', body: '' });
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setRecent([...readRecent('atlas-recent'), ...readRecent('atlas-tools')].slice(0, 6)); }, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try { await api('/v1/research/notebook', { body: { kind: 'note', title: note.title.trim(), body: note.body } }); setNote({ title: '', body: '' }); setMsg('Saved to your notebook.'); }
    catch (x) { setMsg((x as Error).message); }
  };
  return (
    <aside className="studio-side" aria-label="Studio side panel">
      <section>
        <h2>Reviews due</h2>
        {nb.data?.reviews_due.length ? <ul>{nb.data.reviews_due.slice(0, 4).map((r) => <li key={r.entry_id}><button className="link" onClick={() => onTab('notebook')}>{r.title}</button><span className="mu"> · {r.review_date}</span></li>)}</ul> : <p className="mu">No hypotheses are due for review.</p>}
      </section>
      {tab !== 'notebook' && <section>
        <h2>Quick note</h2>
        <form onSubmit={save} className="stack">
          <input aria-label="Quick note heading" placeholder="Heading" required maxLength={200} value={note.title} onChange={(e) => setNote({ ...note, title: e.target.value })} />
          <textarea aria-label="Quick note text" placeholder="What did you notice?" rows={3} maxLength={20000} value={note.body} onChange={(e) => setNote({ ...note, body: e.target.value })} />
          <button className="btn s" disabled={!note.title.trim()}>Save note</button>
          {msg && <p className="mu" role="status" style={{ margin: 0 }}>{msg}</p>}
        </form>
      </section>}
      <section>
        <h2>Recently opened</h2>
        {recent.length ? <ul>{recent.map((r) => <li key={r.href}><a href={r.href}>{r.label}</a></li>)}</ul> : <p className="mu">Pages you open appear here (this device).</p>}
      </section>
      <section>
        <h2>Shortcuts</h2>
        <ul className="mu"><li><kbd>Alt</kbd>+<kbd>1</kbd>–<kbd>9</kbd> switch tools</li><li><kbd>Ctrl</kbd>+<kbd>K</kbd> search everything</li><li><kbd>Alt</kbd>+<kbd>S</kbd> show or hide this panel</li></ul>
      </section>
    </aside>
  );
}

export default function ResearchHub() {
  const [layout, setLayoutState] = useState<Layout>({ side: true, dense: false });
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem('atlas-studio-layout') ?? 'null'); if (v) setLayoutState(v); } catch { /* storage off */ } }, []);
  const setLayout = (l: Layout) => { setLayoutState(l); try { localStorage.setItem('atlas-studio-layout', JSON.stringify(l)); } catch { /* storage off */ } };
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [tab, setTab] = useState('workbench');
  useEffect(() => {
    // The address wins; otherwise the studio reopens on the tool you used last (this device).
    let t = new URLSearchParams(location.search).get('tab');
    if (!t) { try { t = localStorage.getItem('atlas-studio-tab'); } catch { /* storage off */ } }
    if (t && TABS.some((x) => x[0] === t)) setTab(t);
  }, []);
  // Alt+1 … Alt+9 jump between the first nine tools.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.altKey && /^[1-9]$/.test(e.key) && TABS[Number(e.key) - 1]) { e.preventDefault(); change(TABS[Number(e.key) - 1]![0]); }
      if (e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); setLayout({ ...layoutRef.current, side: !layoutRef.current.side }); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const change = (t: string) => {
    setTab(t);
    try { localStorage.setItem('atlas-studio-tab', t); } catch { /* storage off */ }
    const u = new URL(location.href);
    u.searchParams.set('tab', t);
    history.replaceState(null, '', u);
  };
  return (
    <>
      <header className="studio-hd">
        <div><p className="eyebrow">Research Studio</p><h1>Research hub</h1></div>
        <p className="mu">Stored real data and your own files. Every figure shows its source, basis and calendar; nothing here is advice or a forecast. <kbd>Alt</kbd>+<kbd>1</kbd>–<kbd>9</kbd> switches tools · <kbd>Ctrl</kbd>+<kbd>K</kbd> searches.</p>
      </header>
      <div className="studio-tabs">
        <Tabs tabs={TABS} active={tab} onChange={change} help={HELP} />
        <div className="studio-layout" role="group" aria-label="Layout">
          <button className={`chip${layout.side ? ' on' : ''}`} aria-pressed={layout.side} onClick={() => setLayout({ ...layout, side: !layout.side })}>Side panel</button>
          <button className={`chip${layout.dense ? ' on' : ''}`} aria-pressed={layout.dense} onClick={() => setLayout({ ...layout, dense: !layout.dense })}>Compact</button>
        </div>
      </div>
      <p className="studio-help mu">{HELP[tab]}</p>
      <div className={`studio-grid${layout.side ? ' with-side' : ''}${layout.dense ? ' dense' : ''}`}>
      <div className="studio-body" key={tab}>
      {tab === 'workbench' && <T.Workbench />}
      {tab === 'screener' && <T.Screener />}
      {tab === 'portfolios' && <T.Portfolios />}
      {tab === 'correlation' && <T.Correlation />}
      {tab === 'backtest' && <T.WalkForward />}
      {tab === 'events' && <T.EventStudy />}
      {tab === 'regimes' && <T.Regimes />}
      {tab === 'integrity' && <T.Integrity />}
      {tab === 'discovery' && <T.Discovery />}
      {tab === 'notebook' && <T.Notebook />}
      {tab === 'reports' && <T.Reports />}
      {tab === 'alerts' && <T.Alerts />}
      </div>
      {layout.side && <StudioSide onTab={change} tab={tab} />}
      </div>
    </>
  );
}
