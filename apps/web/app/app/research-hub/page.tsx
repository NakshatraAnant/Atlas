'use client';
import { useEffect, useState } from 'react';
import { Tabs } from '@/components/ui';
import * as T from './tabs';

// Research hub: cross-asset research over real crypto data, real imported Indian equities and your own
// uploaded files. Synthetic development data is never selectable here.

const TABS: [string, string][] = [
  ['workbench', 'Workbench'], ['screener', 'Screener & factors'], ['portfolios', 'Portfolios & risk'], ['correlation', 'Correlation regimes'],
  ['backtest', 'Walk-forward'], ['events', 'Event study'], ['regimes', 'Regimes'], ['integrity', 'Data integrity'], ['discovery', 'Discovery'],
  ['notebook', 'Notebook'], ['reports', 'Reports'], ['alerts', 'Alerts'],
];

export default function ResearchHub() {
  const [tab, setTab] = useState('workbench');
  useEffect(() => {
    // The address wins; otherwise the studio reopens on the tool you used last (this device).
    let t = new URLSearchParams(location.search).get('tab');
    if (!t) { try { t = localStorage.getItem('atlas-studio-tab'); } catch { /* storage off */ } }
    if (t && TABS.some((x) => x[0] === t)) setTab(t);
  }, []);
  // Alt+1 … Alt+9 jump between the first nine tools.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.altKey && /^[1-9]$/.test(e.key) && TABS[Number(e.key) - 1]) { e.preventDefault(); change(TABS[Number(e.key) - 1]![0]); } };
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
      <div className="studio-tabs"><Tabs tabs={TABS} active={tab} onChange={change} /></div>
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
    </>
  );
}
