'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { ago, compactUsd, CryptoNav, Freshness, Kind, MiniLine, pctPts, signCls, SymbolBadge, usd, utc, type Fresh } from '@/components/crypto';
import { TickValue } from '@/components/terminal';
import { Loading, Problem } from '@/components/ui';

interface Row { canonical_key: string; name: string; symbol: string; price: number | null; market_cap: number | null; volume_24h: number | null; change_24h_pct: number | null; change_7d_pct: number | null; market_cap_rank: number | null; provider_updated_at: string | null; retrieved_at: string }
interface Overview {
  attribution: string;
  global: null | { observed_at: string; retrieved_at: string; total_market_cap_usd: number | null; total_volume_usd: number | null; market_cap_change_24h_pct: number | null; btc_dominance_pct: number | null; eth_dominance_pct: number | null; active_cryptocurrencies: number | null; markets: number | null; freshness: Fresh; note: string };
  global_history_7d: { observed_at: string; total_market_cap_usd: number }[];
  snapshot: { retrieved_at: string | null; freshness: Fresh; count: number };
  majors: Row[]; gainers: Row[]; losers: Row[]; heatmap: Row[];
  volatility: { key: string; symbol: string; vol_30d: number | null; reason: string | null }[];
  defi: { tvl: { value: number; observed_on: string } | null; stablecoin_supply: { value: number; observed_on: string } | null };
  events: { event_id: string; category: string; headline: string; source_id: string; source_url: string; published_at: string; verification: string }[];
  sources: { source_id: string; provider: string; health: string; last_success_at: string | null; enabled: boolean }[];
}
interface Live { state: string; last_message_at: string | null; stale_after_seconds: number; reconnects: number; note?: string; tickers: { product_id: string; last: number; open_24h: number; high_24h: number; low_24h: number; event_time: string; stale: boolean; asset: { canonical_key: string; name: string } | null }[] }

const heat = (v: number | null) => {
  if (v === null) return 'var(--sf2)';
  const a = Math.min(1, Math.abs(v) / 10);
  return `color-mix(in srgb, ${v >= 0 ? 'var(--ok)' : 'var(--rd)'} ${Math.round(12 + a * 50)}%, var(--sf))`;
};

export default function CryptoOverview() {
  const [o, setO] = useState<Overview | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const load = useCallback(async () => {
    try {
      setO(await api<Overview>('/v1/crypto/overview'));
      setErr(null);
    } catch (e) {
      setErr(e as ApiError);
    }
  }, []);
  useEffect(() => {
    void load();
    // Snapshots refresh every 15 min on the server; checking each minute shows new data soon after it lands.
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      // Pause while the tab is hidden: no point re-rendering prices nobody is looking at.
      if (document.visibilityState === 'hidden') return;
      try {
        const l = await api<Live>('/v1/crypto/live');
        if (!stop) setLive(l);
      } catch {
        if (!stop) setLive((p) => (p ? { ...p, state: 'disconnected' } : p));
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 3_000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  return (
    <div className="terminal">
      <h1 style={{ margin: 0 }}>Digital Assets</h1>
      <CryptoNav />
      {!o && !err && <Loading lines={10} label="Loading digital assets overview" />}
      {err && <Problem error={err} retry={() => void load()} />}
      {o && <Body o={o} live={live} />}
    </div>
  );
}

function Body({ o, live }: { o: Overview; live: Live | null }) {
  const g = o.global;
  const failing = o.sources.filter((s) => s.enabled && ['failing', 'degraded', 'rate_limited'].includes(s.health));
  return (
    <>
      <header className="term-bar" aria-label="Data status">
        <span className="term-tag">24/7 MARKET · PERIODIC SNAPSHOTS</span>
        <span>Market snapshot {o.snapshot.retrieved_at ? <>retrieved <strong>{utc(o.snapshot.retrieved_at)}</strong></> : 'not imported yet'}</span>
        <Freshness f={o.snapshot.freshness} />
        {failing.length > 0 && <a className="t r" href="/app/crypto/sources" style={{ color: 'inherit' }}>{failing.length} source{failing.length > 1 ? 's' : ''} unhealthy</a>}
        <span className="mu">{o.attribution}</span>
      </header>
      <p className="mu term-note">Reference prices and totals are CoinGecko snapshots refreshed about every 15 minutes, not tick data. Only the venue panel below streams, and it is marked live only while messages arrive.</p>

      {!g ? <div className="warn">Waiting for the first import of global market data.</div> : (
        <section aria-label="Global market" className="cx-kpis">
          <Kpi k="Total market capitalisation" v={compactUsd(g.total_market_cap_usd)} s={<span className={signCls(g.market_cap_change_24h_pct)}>{pctPts(g.market_cap_change_24h_pct)} 24 h</span>} />
          <Kpi k="24-hour volume" v={compactUsd(g.total_volume_usd)} s="all tracked venues" />
          <Kpi k="BTC dominance" v={g.btc_dominance_pct === null ? '—' : `${g.btc_dominance_pct.toFixed(1)}%`} s="share of total market cap" />
          <Kpi k="ETH dominance" v={g.eth_dominance_pct === null ? '—' : `${g.eth_dominance_pct.toFixed(1)}%`} s="share of total market cap" />
          <Kpi k="Assets tracked by provider" v={g.active_cryptocurrencies?.toLocaleString('en-US') ?? '—'} s={`${g.markets?.toLocaleString('en-US') ?? '—'} venues`} />
          <Kpi k="DeFi TVL (DefiLlama)" v={compactUsd(o.defi.tvl?.value)} s={o.defi.tvl ? `as of ${o.defi.tvl.observed_on}` : 'not imported yet'} />
          <Kpi k="Stablecoin supply" v={compactUsd(o.defi.stablecoin_supply?.value)} s={o.defi.stablecoin_supply ? `as of ${o.defi.stablecoin_supply.observed_on}` : 'not imported yet'} />
        </section>
      )}
      {g && <p className="cx-src">Totals: CoinGecko global endpoint, provider updated {utc(g.observed_at)}. {g.note} <Freshness f={g.freshness} /></p>}

      <div className="term-grid">
        <section className="card" aria-labelledby="majors">
          <h2 id="majors">Reference prices <Kind k="reference" /></h2>
          <div className="cx-kpis">
            {o.majors.map((m) => (
              <a key={m.canonical_key} href={`/app/crypto/assets/${m.canonical_key}`} className="cx-kpi" style={{ textDecoration: 'none', color: 'inherit' }}>
                <span className="k"><SymbolBadge symbol={m.symbol} />{m.name}</span>
                <span className="v">{usd(m.price)}</span>
                <span className="s"><span className={signCls(m.change_24h_pct)}>{pctPts(m.change_24h_pct)} 24 h</span> · <span className={signCls(m.change_7d_pct)}>{pctPts(m.change_7d_pct)} 7 d</span></span>
              </a>
            ))}
          </div>
          {o.global_history_7d.length > 1 && <MiniLine title="Total market capitalisation, stored snapshots (last 7 days)" points={o.global_history_7d.map((p) => ({ t: p.observed_at.slice(0, 16).replace('T', ' '), v: p.total_market_cap_usd }))} format={compactUsd} />}
          <h3>Realised volatility (30 days)</h3>
          <ul className="plain">{o.volatility.map((v) => <li key={v.key}>{v.symbol}: {v.vol_30d === null ? <span className="mu">not calculated: {v.reason}</span> : <strong>{(v.vol_30d * 100).toFixed(1)}% annualised</strong>}</li>)}</ul>
          <p className="mu">Annualised with √365 from stored daily closes. <a href="/app/crypto/research">Method and more analytics</a></p>
        </section>
        <LivePanel live={live} />
      </div>

      <div className="term-grid">
        <section className="card" aria-labelledby="mv">
          <h2 id="mv">24-hour movers <Kind k="reference" /></h2>
          <p className="mu">Among the top 100 by market capitalisation with at least $1M of 24-hour volume.</p>
          <div className="grid2">
            <Movers title="Gainers" rows={o.gainers} />
            <Movers title="Losers" rows={o.losers} />
          </div>
        </section>
        <section className="card" aria-labelledby="ev">
          <h2 id="ev">Source-linked events</h2>
          {o.events.length ? (
            <ol className="term-feed">{o.events.map((e) => (
              <li key={e.event_id}>
                <time dateTime={e.published_at}>{utc(e.published_at)}</time>
                <span className="t c">{e.category.replace(/_/g, ' ')}</span>
                <a href={e.source_url} rel="noreferrer noopener" target="_blank">{e.headline}</a>
                <span className="mu">{e.verification === 'observed_by_atlas' ? 'observed by ATLAS' : e.source_id.replace('_', ' ')}</span>
              </li>
            ))}</ol>
          ) : <p className="mu">No events imported yet.</p>}
          <p><a href="/app/crypto/events">All events and their scope</a></p>
        </section>
      </div>

      <section className="card" aria-labelledby="hm">
        <h2 id="hm">Heatmap: top 50 by market capitalisation, 24-hour change</h2>
        <div className="cx-heat">{o.heatmap.map((h) => (
          <a key={h.canonical_key} href={`/app/crypto/assets/${h.canonical_key}`} style={{ background: heat(h.change_24h_pct) }} aria-label={`${h.name}: ${pctPts(h.change_24h_pct)} in 24 hours`}>
            <b>{h.symbol}</b><span>{pctPts(h.change_24h_pct, 1)}</span>
          </a>
        ))}</div>
        <p className="mu">Colour intensity scales with the size of the move, capped at ±10%. Source: CoinGecko snapshot {utc(o.snapshot.retrieved_at)}.</p>
      </section>
    </>
  );
}

function Kpi({ k, v, s }: { k: string; v: string; s?: React.ReactNode }) {
  return <div className="cx-kpi"><span className="k">{k}</span><span className="v">{v}</span>{s && <span className="s">{s}</span>}</div>;
}

function Movers({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="wrap"><table className="term-table">
      <caption>{title}</caption>
      <thead><tr><th scope="col" style={{ textAlign: 'left' }}>Asset</th><th scope="col" className="num">Price</th><th scope="col" className="num">24 h</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.canonical_key}><td style={{ textAlign: 'left' }}><a href={`/app/crypto/assets/${r.canonical_key}`}>{r.symbol}</a> <span className="mu">{r.name}</span></td><td className="num">{usd(r.price)}</td><td className={`num ${signCls(r.change_24h_pct)}`}>{pctPts(r.change_24h_pct)}</td></tr>)}</tbody>
    </table></div>
  );
}

function LivePanel({ live }: { live: Live | null }) {
  const state = live?.state ?? 'connecting';
  const label: Record<string, string> = { live: 'Live: receiving messages', stale: 'Stale: no recent messages', connecting: 'Connecting', disconnected: 'Disconnected: reconnecting', disabled: 'Off' };
  return (
    <section className="card" aria-labelledby="lv" aria-live="off">
      <h2 id="lv">Binance spot, streaming <Kind k="venue" /></h2>
      <p role="status"><span className={`cx-dot ${state}`} aria-hidden="true" />{label[state] ?? state}{live?.last_message_at ? <span className="mu"> · last message {ago(live.last_message_at)}</span> : null}</p>
      {state === 'disabled' && <p className="mu">{live?.note ?? 'The live feed is not running.'}</p>}
      <div className="cx-live">{(live?.tickers ?? []).map((t) => {
        const ch = t.open_24h > 0 ? (t.last / t.open_24h - 1) * 100 : null;
        const stale = t.stale || state !== 'live';
        return (
          <div key={t.product_id} className={`cell ${stale ? 'stale' : ''}`}>
            <span className="mu">{t.asset ? <a href={`/app/crypto/assets/${t.asset.canonical_key}`}>{t.product_id}</a> : t.product_id}</span>
            <strong><TickValue value={t.last} format={(v) => v.toLocaleString('en-US', { maximumFractionDigits: v >= 1 ? 2 : 6 })} stale={stale} /></strong>
            <span className={signCls(ch)}>{pctPts(ch)} rolling 24 h</span>
            <span className="mu" style={{ fontSize: 11 }}>event {t.event_time.slice(11, 19)} UTC{stale ? ' · stale' : ''}</span>
          </div>
        );
      })}</div>
      <p className="mu">Prices in USDT on Binance only; other venues and USD prices differ. Values animate only when a new message changes them. If no message arrives for {live?.stale_after_seconds ?? 15} seconds the feed is marked stale and the server reconnects.</p>
    </section>
  );
}
