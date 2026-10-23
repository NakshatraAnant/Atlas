'use client';
import { useApi, Loading } from './ui';

// Home in real-data mode: a market snapshot built only from stored, sourced observations. Every figure
// shows the date it refers to and its source; a panel without data says so instead of showing a number.

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);
const cls = (v: number | null | undefined) => (v === null || v === undefined ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : '');
const fmt = (v: number | null | undefined, max = 2) => (v === null || v === undefined ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: max }));
const FRESH: Record<string, [string, string]> = { fresh: ['o', 'current'], current: ['o', 'current'], delayed: ['i', 'delayed'], stale: ['r', 'stale'], unavailable: ['m', 'no data'], provider_error: ['r', 'update failed'], no_data: ['m', 'no data'] };
const Tag = ({ s }: { s: string }) => <span className={`t ${FRESH[s]?.[0] ?? 'm'}`}>{FRESH[s]?.[1] ?? s}</span>;

function Tile({ k, v, s, sub, state, href }: { k: string; v: string; s?: string; sub?: string; state?: string; href?: string }) {
  return (
    <div className="cx-kpi">
      <span className="k">{href ? <a href={href}>{k}</a> : k}</span>
      <span className="v">{v}</span>
      {s && <span className={`s ${s.startsWith('+') ? 'up' : s.startsWith('-') ? 'dn' : ''}`}>{s}</span>}
      {sub && <span className="s">{sub} {state && <Tag s={state} />}</span>}
    </div>
  );
}

export function RealHome({ name }: { name?: string | null }) {
  const eq = useApi<{ indices: { symbol: string; name: string | null; exchange: string; last_close: number | null; last_date: string | null; returns: Record<string, number | null>; behind: number | null }[]; empty_reason: string | null }>('/v1/equity/market');
  const cm = useApi<{ categories: { series: { series_id: string; name: string; unit: string; source_id: string; source_series: string; last: number | null; last_date: string | null; change: { m1: number | null } | null; freshness: { state: string } }[] }[] }>('/v1/commodities');
  const mc = useApi<{ configured: boolean; items: { series_id: string; title: string; units: string | null; latest: { d: string; v: number } | null; freshness: { state: string } }[] }>('/v1/macro');
  const cr = useApi<{ majors: { canonical_key: string; name: string; symbol: string; price: number; change_24h_pct: number | null; provider_updated_at: string | null }[]; attribution?: string }>('/v1/crypto/overview');
  const commodities = cm.data?.categories.flatMap((c) => c.series).filter((x) => ['fred:DCOILBRENTEU', 'fred:DCOILWTICO', 'fred:DHHNGSP', 'fred:PCOPPUSDM'].includes(x.series_id)) ?? [];
  const macro = mc.data?.items.filter((x) => ['DGS10', 'DFF', 'DEXINUS', 'CPIAUCSL', 'UNRATE', 'T10Y2Y'].includes(x.series_id)) ?? [];
  return (
    <>
      <h1>Good {new Date().getHours() < 12 ? 'morning' : 'evening'}{name ? `, ${name}` : ''}</h1>
      <p className="mu">Every figure below is a stored observation from a named source, shown with the date it refers to. End-of-day and monthly data are not live prices.</p>
      <section className="card" aria-labelledby="h-in">
        <h2 id="h-in"><a href="/app/equities">Indian indices</a> <span className="mu">· end of day, EODHD</span></h2>
        {eq.loading && !eq.data ? <Loading lines={2} /> : eq.data?.indices.length ? (
          <div className="cx-kpis">{eq.data.indices.map((i) => <Tile key={i.symbol} k={i.name ?? i.symbol} href={`/app/equities/INDEX/${i.symbol}`} v={fmt(i.last_close)} s={pct(i.returns.d1, 2)} sub={`close on ${i.last_date}`} state={i.behind === 0 ? 'current' : i.behind === null ? 'no_data' : 'delayed'} />)}</div>
        ) : <p className="mu">{eq.data?.empty_reason ?? 'No index data stored yet.'}</p>}
      </section>
      <div className="grid2">
        <section className="card" aria-labelledby="h-cm">
          <h2 id="h-cm"><a href="/app/commodities">Commodities</a> <span className="mu">· benchmark prices (USD)</span></h2>
          {cm.loading && !cm.data ? <Loading lines={2} /> : commodities.length ? (
            <div className="cx-kpis">{commodities.map((c) => <Tile key={c.series_id} k={c.name.replace(/ \(.*\)$/, '')} href={`/app/commodities/${c.source_id}/${c.source_series}`} v={fmt(c.last)} s={pct(c.change?.m1)} sub={`${c.unit}, ${c.last_date ?? '—'}`} state={c.freshness.state} />)}</div>
          ) : <p className="mu">Commodity series are not imported yet.</p>}
        </section>
        <section className="card" aria-labelledby="h-mc">
          <h2 id="h-mc"><a href="/app/macro">Macro</a> <span className="mu">· FRED</span></h2>
          {mc.loading && !mc.data ? <Loading lines={2} /> : !mc.data?.configured ? <p className="mu">Macro data is not connected.</p> : macro.some((m) => m.latest) ? (
            <div className="cx-kpis">{macro.map((m) => <Tile key={m.series_id} k={m.title.length > 42 ? m.series_id : m.title} href={`/app/macro/${m.series_id}`} v={m.latest ? fmt(m.latest.v, 3) : '—'} sub={`${m.units ?? ''}${m.latest ? `, ${m.latest.d}` : ''}`} state={m.freshness.state} />)}</div>
          ) : <p className="mu">Macro series are being imported.</p>}
        </section>
      </div>
      <section className="card" aria-labelledby="h-cr">
        <h2 id="h-cr"><a href="/app/crypto">Digital assets</a> <span className="mu">· {cr.data?.attribution ?? 'CoinGecko reference prices'}</span></h2>
        {cr.loading && !cr.data ? <Loading lines={2} /> : cr.data?.majors.length ? (
          <div className="cx-kpis">{cr.data.majors.slice(0, 6).map((a) => <Tile key={a.canonical_key} k={`${a.name} (${a.symbol})`} href={`/app/crypto/assets/${a.canonical_key}`} v={`$${fmt(a.price)}`} s={a.change_24h_pct === null ? undefined : `${a.change_24h_pct >= 0 ? '+' : ''}${a.change_24h_pct.toFixed(2)}% 24h`} sub={a.provider_updated_at ? `as of ${new Date(a.provider_updated_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })} IST` : ''} />)}</div>
        ) : <p className="mu">No crypto snapshot stored yet.</p>}
      </section>
      <p><a href="/app/research-hub">Research hub</a> · <a href="/app/academy">Academy</a> · <a href="/app/data-health">Data sources and freshness</a></p>
    </>
  );
}

