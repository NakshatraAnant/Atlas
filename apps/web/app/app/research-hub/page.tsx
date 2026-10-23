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
    const t = new URLSearchParams(location.search).get('tab');
    if (t && TABS.some((x) => x[0] === t)) setTab(t);
  }, []);
  const change = (t: string) => {
    setTab(t);
    const u = new URL(location.href);
    u.searchParams.set('tab', t);
    history.replaceState(null, '', u);
  };
  return (
    <>
      <h1 style={{ marginBottom: 4 }}>Research hub</h1>
      <p className="mu" style={{ marginTop: 0 }}>Cross-asset research on stored real data (crypto, imported Indian equities) and your own files. Every figure shows its source, basis and calendar; nothing here is advice or a forecast.</p>
      <Tabs tabs={TABS} active={tab} onChange={change} />
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
    </>
  );
}
