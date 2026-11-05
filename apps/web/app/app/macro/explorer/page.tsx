'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { TsChart } from '@/components/ts-chart';
import { Loading, Problem, useApi } from '@/components/ui';

// Macro relationship explorer: two stored series on a common frequency, their levels on separate axes,
// and the rolling correlation of their period-to-period changes. Correlation is not causation.

interface Opt { key: string; label: string; frequency: string | null }
interface Result {
  a: { key: string; label: string; units: string; source: string; change_unit: string }; b: { key: string; label: string; units: string; source: string; change_unit: string };
  frequency: string; window: number; n: number; correlation: number | null; first: string | null; last: string | null;
  levels: { t: string; a: number; b: number }[]; rolling: { t: string; v: number }[]; insufficient: string | null; method: string; caveats: string[];
}
const PRESETS: [string, string, string][] = [
  ['US 10-year yield vs rupee per dollar', 'macro:DGS10', 'macro:DEXINUS'],
  ['Brent crude vs NIFTY 50', 'commodity:fred:DCOILBRENTEU', 'equity:INDEX:NIFTY50'],
  ['US core inflation vs fed funds rate', 'macro:CPILFESL', 'macro:DFF'],
  ['Financial stress vs 10y–2y curve', 'macro:STLFSI4', 'macro:T10Y2Y'],
];

export default function Explorer() {
  const opts = useApi<{ groups: { group: string; items: Opt[] }[] }>('/v1/macro/explorer/options');
  const [a, setA] = useState('macro:DGS10');
  const [b, setB] = useState('macro:DEXINUS');
  const [frequency, setFrequency] = useState<'monthly' | 'weekly'>('monthly');
  const [windowN, setWindowN] = useState(24);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (x = a, y = b) => {
    setBusy(true);
    setErr(null);
    try {
      setRes(await api<Result>('/v1/macro/explore', { body: { a: x, b: y, frequency, window: windowN } }));
    } catch (e) {
      setErr(e as ApiError);
      setRes(null);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { void run(); /* first comparison on open */ }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const select = (value: string, set: (v: string) => void, label: string) => (
    <label className="field">{label}
      <select value={value} onChange={(e) => set(e.target.value)}>
        {opts.data?.groups.map((g) => <optgroup key={g.group} label={g.group}>{g.items.map((i) => <option key={i.key} value={i.key}>{i.label}{i.frequency ? ` (${i.frequency.toLowerCase()})` : ''}</option>)}</optgroup>)}
      </select>
    </label>
  );
  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb"><a href="/app/macro">Macro</a> › <span aria-current="page">Relationship explorer</span></nav>
      <h1>Macro relationship explorer</h1>
      <p className="mu">Compare any two series ATLAS stores: macro indicators, commodity benchmarks and Indian indices. Both are put on the same frequency and their changes are correlated over a rolling window. A correlation shows how two series moved together in the past; it does not show that one causes the other.</p>
      <section className="card">
        {opts.loading && !opts.data ? <Loading lines={2} /> : (
          <>
            <div className="cx-filters">
              {select(a, setA, 'First series')}
              {select(b, setB, 'Second series')}
              <label className="field">Frequency<select value={frequency} onChange={(e) => setFrequency(e.target.value as 'monthly' | 'weekly')}><option value="monthly">Monthly</option><option value="weekly">Weekly</option></select></label>
              <label className="field">Rolling window<select value={windowN} onChange={(e) => setWindowN(Number(e.target.value))}>{[12, 24, 36, 60].map((n) => <option key={n} value={n}>{n} {frequency === 'monthly' ? 'months' : 'weeks'}</option>)}</select></label>
              <button className="btn" disabled={busy} onClick={() => run()}>{busy ? 'Comparing…' : 'Compare'}</button>
            </div>
            <p className="mu" style={{ marginBottom: 0 }}>Try: {PRESETS.map(([label, x, y], i) => <span key={label}>{i ? ' · ' : ''}<button className="link" onClick={() => { setA(x); setB(y); void run(x, y); }}>{label}</button></span>)}</p>
          </>
        )}
      </section>
      <Problem error={err} />
      {busy && !res && <Loading lines={6} />}
      {res && (
        <>
          <section className="card">
            <div className="cx-kpis">
              <div className="cx-kpi"><span className="k">Correlation of changes</span><span className="v">{res.correlation === null ? '—' : res.correlation.toFixed(2)}</span><span className="s">{res.n} shared {res.frequency === 'monthly' ? 'months' : 'weeks'}{res.first ? `, ${res.first} to ${res.last}` : ''}</span></div>
              <div className="cx-kpi"><span className="k">{res.a.label}</span><span className="v" style={{ fontSize: 14 }}>{res.a.change_unit}</span><span className="s">{res.a.source}</span></div>
              <div className="cx-kpi"><span className="k">{res.b.label}</span><span className="v" style={{ fontSize: 14 }}>{res.b.change_unit}</span><span className="s">{res.b.source}</span></div>
            </div>
            {res.insufficient && <p className="warn">{res.insufficient}</p>}
          </section>
          <section className="card">
            <TsChart title="Levels (each on its own axis)" defaultRange="10Y" gapDays={res.frequency === 'monthly' ? 70 : 20}
              series={[{ label: res.a.label, unit: res.a.units, points: res.levels.map((p) => ({ t: p.t, v: p.a })) }, { label: res.b.label, unit: res.b.units, points: res.levels.map((p) => ({ t: p.t, v: p.b })) }]} />
          </section>
          {res.rolling.length > 1 && (
            <section className="card">
              <TsChart title={`Rolling ${res.window}-${res.frequency === 'monthly' ? 'month' : 'week'} correlation of changes`} defaultRange="Max" gapDays={res.frequency === 'monthly' ? 70 : 20} zeroLine series={[{ label: 'Correlation', unit: '−1 to +1', points: res.rolling }]} />
            </section>
          )}
          <section className="card">
            <h2>Method and limits</h2>
            <p>{res.method}</p>
            <ul>{res.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
          </section>
        </>
      )}
    </>
  );
}
