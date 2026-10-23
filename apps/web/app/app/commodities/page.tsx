'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { MiniLine } from '@/components/crypto';
import { useApp } from '@/components/providers';
import { Fresh } from '@/components/commodity';
import { Loading, Problem, Tabs, useApi } from '@/components/ui';

// Commodities: global benchmark prices, Indian exchange-traded futures and physical/fundamental data are
// shown as separate categories, each series with its source, price type, unit, frequency and freshness.

interface Series { series_id: string; category: string; commodity: string; name: string; price_type: string; unit: string; currency: string | null; frequency: string; source_id: string; source_series: string; upstream: string; last_date: string | null; observations: number; last_import_at: string | null; last_error: string | null; freshness: { state: string; age_days: number | null }; last: number | null; change: { m1: number | null; y1: number | null } | null; configured: boolean }
interface List { categories: { category: string; note: string; series: Series[] }[]; unavailable: { what: string; why: string }[]; jobs: { series_id: string; started_at: string; status: string; stored: number; corrected: number; missing_values: number; error: string | null }[]; eia_configured: boolean; notice: string }

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);
const cls = (v: number | null | undefined) => (v === null || v === undefined ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : '');
const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: Math.abs(v) < 10 ? 3 : 2 }));
const TITLES: Record<string, string> = { global_benchmark: 'Global benchmark prices', indian_futures: 'Indian exchange-traded futures (MCX, NCDEX)', physical_fundamental: 'Physical and fundamental data (EIA)' };
const PRICE: Record<string, string> = { spot: 'spot assessment', futures_settlement: 'futures (by contract position)', average_price: 'average price', index: 'price index', inventory: 'inventory level' };

export default function Commodities() {
  const l = useApi<List>('/v1/commodities');
  const [tab, setTab] = useState('series');
  if (l.loading && !l.data) return <Loading lines={8} />;
  if (l.error) return <Problem error={l.error} retry={l.reload} />;
  const d = l.data!;
  return (
    <>
      <h1>Commodities</h1>
      <p className="mu">{d.notice}</p>
      <Tabs tabs={[['series', 'Series'], ['spreads', 'Spreads'], ['curve', 'Term structure'], ['ops', 'Sources and refresh']]} active={tab} onChange={setTab} />
      {tab === 'series' && d.categories.map((c) => (
        <section className="card" key={c.category}>
          <h2>{TITLES[c.category] ?? c.category}</h2>
          <p className="mu">{c.note}</p>
          {c.series.length ? (
            <div className="wrap"><table className="term-table"><thead><tr><th scope="col" style={{ textAlign: 'left' }}>Series</th><th scope="col">What it is</th><th scope="col">Last</th><th scope="col">Unit</th><th scope="col">Date</th><th scope="col">1M</th><th scope="col">1Y</th><th scope="col">Freshness</th></tr></thead>
              <tbody>{c.series.map((s) => (
                <tr key={s.series_id}>
                  <td style={{ textAlign: 'left' }}><a href={`/app/commodities/${s.source_id}/${s.source_series}`}>{s.name}</a></td>
                  <td>{PRICE[s.price_type] ?? s.price_type}, {s.frequency}</td>
                  <td className="num">{num(s.last)}</td>
                  <td>{s.unit}</td>
                  <td>{s.last_date ?? '—'}</td>
                  <td className={`num ${cls(s.change?.m1)}`}>{pct(s.change?.m1)}</td>
                  <td className={`num ${cls(s.change?.y1)}`}>{pct(s.change?.y1)}</td>
                  <td>{s.configured ? <Fresh f={s.freshness} /> : <span className="t m">needs EIA key</span>}</td>
                </tr>
              ))}</tbody></table></div>
          ) : <p>Not available. Nothing is shown in its place.</p>}
        </section>
      ))}
      {tab === 'series' && (
        <section className="card">
          <h2>Not available</h2>
          <ul>{d.unavailable.map((u) => <li key={u.what}><strong>{u.what}</strong>: {u.why}</li>)}</ul>
        </section>
      )}
      {tab === 'spreads' && <Spreads />}
      {tab === 'curve' && <Curve />}
      {tab === 'ops' && <Ops d={d} reload={l.reload} />}
    </>
  );
}

function Spreads() {
  const s = useApi<{ spreads: { id: string; name: string; unit: string; note: string; available: boolean; reason?: string; last?: number; last_date?: string; mean_3y?: number; percentile_3y?: number; min_3y?: number; max_3y?: number; observations?: number; points?: { t: string; v: number }[] }[]; method: string }>('/v1/commodities/spreads');
  if (s.loading && !s.data) return <Loading lines={4} />;
  if (s.error) return <Problem error={s.error} retry={s.reload} />;
  return (
    <section className="card">
      <h2>Spreads</h2>
      <p className="mu">{s.data!.method}</p>
      {s.data!.spreads.map((x) => (
        <div key={x.id} className="qcard">
          <h3>{x.name}</h3>
          {x.available ? (
            <>
              <p><strong>{num(x.last)} {x.unit}</strong> on {x.last_date} · 3-year mean {num(x.mean_3y)} · range {num(x.min_3y)} to {num(x.max_3y)} · today is at the {Math.round((x.percentile_3y ?? 0) * 100)}th percentile of {x.observations} shared days</p>
              <MiniLine points={x.points ?? []} title={`${x.name}, last 12 months`} format={(v) => v.toFixed(2)} zero />
            </>
          ) : <p className="mu">{x.reason}</p>}
          <p className="mu">{x.note}</p>
        </div>
      ))}
    </section>
  );
}

function Curve() {
  const c = useApi<{ available: boolean; reason?: string; latest: { t: string; state: string; front: number; back: number; slope: number; slope_pct: number; roll_yield_annualised: number | null; positions: { position: number; value: number }[] } | null; history: { t: string; slope_pct: number }[]; method: string | null }>('/v1/commodities/term-structure');
  if (c.loading && !c.data) return <Loading lines={3} />;
  if (c.error) return <Problem error={c.error} retry={c.reload} />;
  const d = c.data!;
  return (
    <section className="card">
      <h2>WTI term structure (contract positions 1–4)</h2>
      {!d.available ? <p>{d.reason}</p> : d.latest && (
        <>
          <p><strong>{d.latest.state}</strong> on {d.latest.t}: positions {d.latest.positions.map((p) => `${p.position}: ${p.value.toFixed(2)}`).join(' · ')} USD/bbl. Position 4 − 1 = {d.latest.slope.toFixed(2)} ({pct(d.latest.slope_pct)}). Roll-yield proxy {d.latest.roll_yield_annualised === null ? '—' : pct(d.latest.roll_yield_annualised)} a year.</p>
          <MiniLine points={d.history.map((h) => ({ t: h.t, v: h.slope_pct }))} title="Slope, position 4 vs 1 (above zero = contango)" zero />
        </>
      )}
      {d.method && <p className="mu">{d.method}</p>}
    </section>
  );
}

function Ops({ d, reload }: { d: List; reload: () => void }) {
  const { me, toast } = useApp();
  const admin = !!me && ['admin', 'data_ops'].includes(me.profile.role);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const refresh = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ attempted: number }>('/admin/v1/commodities/refresh', { body: {} });
      toast(`${r.attempted} series refreshed`);
      reload();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card">
      <h2>Sources and refresh</h2>
      <ul>
        <li><strong>FRED</strong> (Federal Reserve Bank of St. Louis) CSV downloads, no key: EIA daily spot prices and IMF monthly prices. Each series is refreshed at most once every 20 hours, one request at a time.</li>
        <li><strong>EIA open data</strong> (inventories, WTI futures by contract position): {d.eia_configured ? 'key configured.' : 'not configured. Add EIA_API_KEY=… (a free key from eia.gov/opendata) to .env.local and restart.'}</li>
      </ul>
      {admin && <p><button className="btn" disabled={busy} onClick={refresh}>{busy ? 'Refreshing…' : 'Refresh due series now'}</button></p>}
      <Problem error={err} />
      <h3>Recent imports</h3>
      {d.jobs.length ? <div className="wrap"><table className="term-table"><thead><tr><th scope="col">Started</th><th scope="col">Series</th><th scope="col">Status</th><th scope="col">New</th><th scope="col">Corrected</th><th scope="col">Missing days</th><th scope="col" style={{ textAlign: 'left' }}>Error</th></tr></thead>
        <tbody>{d.jobs.map((j, i) => <tr key={i}><td>{j.started_at.slice(0, 16).replace('T', ' ')} UTC</td><td>{j.series_id}</td><td>{j.status}</td><td className="num">{j.stored}</td><td className="num">{j.corrected}</td><td className="num">{j.missing_values}</td><td style={{ textAlign: 'left' }}>{j.error ?? ''}</td></tr>)}</tbody></table></div> : <p className="mu">No imports yet; the first refresh runs about 90 seconds after ATLAS starts.</p>}
    </section>
  );
}
