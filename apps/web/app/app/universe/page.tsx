'use client';
import { useState } from 'react';
import { Globe3D, type GlobeNode } from '@/components/globe3d';
import { Loading, useApi } from '@/components/ui';

// ATLAS Universe: the globe is a map of what ATLAS actually stores. Every value in a panel is a stored
// observation with its date and timing; anything ATLAS has no permitted source for is listed as unavailable.

interface Eq { indices: { symbol: string; name: string | null; last_close: number | null; last_date: string | null; returns: Record<string, number | null> }[] }
interface Cm { categories: { series: { series_id: string; name: string; unit: string; source_id: string; source_series: string; last: number | null; last_date: string | null; freshness: { state: string } }[] }[] }
interface Mc { items: { series_id: string; title: string; units: string | null; latest: { d: string; v: number } | null; freshness: { state: string } }[] }
interface Cr { majors: { canonical_key: string; name: string; symbol: string; price: number; change_24h_pct: number | null; provider_updated_at: string | null }[] }
interface Row { label: string; value: string; date: string; timing: string; href: string; stale?: boolean }

const NODES: (GlobeNode & { blurb: string; open: [string, string]; macro?: string[]; commodity?: string[]; indices?: boolean; crypto?: boolean; missing: string[] })[] = [
  { id: 'india', label: 'India', lat: 21, lon: 78, blurb: 'Benchmark indices at end of day, the rupee and Indian inflation.', open: ['/app/equities', 'Open Indian markets'], indices: true, macro: ['DEXINUS', 'INDCPIALLMINMEI', 'MKTGDPINA646NWDB'], missing: ['Individual NSE and BSE shares', 'Company financial statements', 'MCX commodity futures'] },
  { id: 'us', label: 'United States', lat: 39, lon: -98, blurb: 'Rates, inflation, jobs and energy benchmarks from FRED and the EIA.', open: ['/app/macro', 'Open Macro'], macro: ['DGS10', 'DGS2', 'DFF', 'CPIAUCSL', 'UNRATE', 'PAYEMS'], commodity: ['fred:DCOILWTICO', 'fred:DHHNGSP', 'eia:WCESTUS1'], missing: ['US share prices and indices (S&P 500, Nasdaq)', 'Company fundamentals'] },
  { id: 'europe', label: 'Europe', lat: 50, lon: 10, blurb: 'European energy benchmarks.', open: ['/app/commodities', 'Open Commodities'], commodity: ['fred:DCOILBRENTEU', 'fred:PNGASEUUSDM'], missing: ['European share indices (STOXX, DAX, FTSE)', 'ECB and Bank of England rates'] },
  { id: 'eastasia', label: 'East Asia', lat: 36, lon: 138, blurb: 'Asian energy import prices.', open: ['/app/commodities', 'Open Commodities'], commodity: ['fred:PNGASJPUSDM'], missing: ['Nikkei, Hang Seng, Shanghai indices', 'Asian central-bank rates'] },
  { id: 'australia', label: 'Australia', lat: -25, lon: 134, blurb: 'Seaborne coal benchmark.', open: ['/app/commodities', 'Open Commodities'], commodity: ['fred:PCOALAUUSDM'], missing: ['ASX share prices and indices'] },
  { id: 'crypto', label: 'Digital assets', orbit: 0, phase: 0.1, blurb: 'Global, around the clock: reference prices, venue candles, DeFi and on-chain data.', open: ['/app/crypto', 'Open Digital assets'], crypto: true, missing: ['Real-time order books (prices are about 15 minutes delayed)'] },
  { id: 'commodities', label: 'Global commodities', orbit: 1, phase: 0.45, blurb: 'World benchmark prices for metals and crops (monthly averages).', open: ['/app/commodities', 'Open Commodities'], commodity: ['fred:PCOPPUSDM', 'fred:PALUMUSDM', 'fred:PWHEAMTUSDM', 'fred:PSUGAISAUSDM'], missing: ['Gold and silver (no permitted free source)', 'Live futures quotes'] },
  { id: 'macro', label: 'Global conditions', orbit: 0, phase: 0.6, blurb: 'The dollar and financial conditions that link markets.', open: ['/app/network', 'Open the Intelligence Network'], macro: ['DTWEXBGS', 'NFCI', 'STLFSI4', 'T10Y2Y'], missing: ['Global equity indices (MSCI)'] },
];

const num = (v: number, max = 2) => v.toLocaleString('en-IN', { maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : max });

export default function Universe() {
  const [sel, setSel] = useState<string | null>(null);
  const eq = useApi<Eq>('/v1/equity/market');
  const cm = useApi<Cm>('/v1/commodities');
  const mc = useApi<Mc>('/v1/macro');
  const cr = useApi<Cr>('/v1/crypto/overview');
  const node = NODES.find((n) => n.id === sel) ?? null;
  const loading = eq.loading || cm.loading || mc.loading || cr.loading;

  const rowsFor = (n: (typeof NODES)[number]): Row[] => {
    const rows: Row[] = [];
    if (n.indices) for (const i of eq.data?.indices ?? []) if (i.last_close !== null) rows.push({ label: i.name ?? i.symbol, value: num(i.last_close), date: i.last_date ?? '', timing: 'End of day', href: `/app/equities/INDEX/${i.symbol}` });
    for (const id of n.macro ?? []) { const m = mc.data?.items.find((x) => x.series_id === id); if (m?.latest) rows.push({ label: m.title.length > 46 ? `${m.title.slice(0, 44)}…` : m.title, value: `${num(m.latest.v, 3)}${m.units && /percent/i.test(m.units) ? '%' : ''}`, date: m.latest.d, timing: 'Latest official observation', href: `/app/macro/${id}`, stale: m.freshness.state === 'stale' }); }
    const series = cm.data?.categories.flatMap((c) => c.series) ?? [];
    for (const id of n.commodity ?? []) { const c = series.find((x) => x.series_id === id); if (c && c.last !== null) rows.push({ label: c.name.replace(/ \(.*\)$/, ''), value: `${num(c.last)} ${c.unit.replace('USD per ', '$/')}`, date: c.last_date ?? '', timing: 'Latest official observation', href: `/app/commodities/${c.source_id}/${c.source_series}`, stale: c.freshness.state === 'stale' }); }
    if (n.crypto) for (const a of cr.data?.majors ?? []) rows.push({ label: `${a.name} (${a.symbol.toUpperCase()})`, value: `$${num(a.price)}`, date: a.provider_updated_at ? new Date(a.provider_updated_at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '', timing: 'Delayed about 15 minutes', href: `/app/crypto/assets/${a.canonical_key}` });
    return rows;
  };

  const picker = (
    <div className="uni-list" role="group" aria-label="Regions and markets">
      {NODES.map((n) => <button key={n.id} className={`chip${sel === n.id ? ' on' : ''}`} aria-pressed={sel === n.id} onClick={() => setSel(sel === n.id ? null : n.id)}>{n.label}</button>)}
    </div>
  );
  return (
    <div className="universe">
      <header className="uni-hd">
        <p className="eyebrow">ATLAS Universe</p>
        <h1>Explore what ATLAS knows, by place.</h1>
        <p className="mu">Gold markers are regions and global markets with stored data. Select one to see its latest observations and open the research pages.</p>
      </header>
      <div className="uni-grid">
        <div className="uni-globe">
          <Globe3D nodes={NODES} selected={sel} onSelect={(id) => setSel(id || null)} title="ATLAS Universe globe" fallback={picker} />
        </div>
        <aside className="uni-panel" aria-live="polite">
          {!node ? (
            <div className="uni-empty">
              <h2>Choose a marker</h2>
              <p className="mu">Five regions and three global markets. Each panel lists only what is stored, with its date, and says what is not available.</p>
              <ul className="uni-quick">{NODES.map((n) => <li key={n.id}><button className="link" onClick={() => setSel(n.id)}>{n.label}</button><span className="mu"> · {n.blurb}</span></li>)}</ul>
            </div>
          ) : (
            <div className="uni-detail" key={node.id}>
              <h2>{node.label}</h2>
              <p className="mu">{node.blurb}</p>
              {loading && !rowsFor(node).length ? <Loading lines={4} /> : rowsFor(node).length ? (
                <ul className="uni-rows">
                  {rowsFor(node).map((r) => (
                    <li key={r.href + r.label}><a href={r.href}>
                      <span className="ur-label">{r.label}</span><span className="ur-value">{r.value}</span>
                      <span className="ur-meta">{r.date} · {r.timing}{r.stale && <span className="t r"> stale</span>}</span>
                    </a></li>
                  ))}
                </ul>
              ) : <p className="mu">No stored observations for this marker yet.</p>}
              <p><a className="btn btn-cta" href={node.open[0]}>{node.open[1]} <span aria-hidden="true">→</span></a></p>
              <details className="uni-missing" open><summary>Not available in ATLAS</summary><ul>{node.missing.map((m) => <li key={m}>{m}</li>)}</ul><p className="mu">These need data licences ATLAS does not hold; nothing is estimated in their place.</p></details>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
