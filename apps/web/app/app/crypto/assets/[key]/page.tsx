'use client';
import { use, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { compactNum, compactUsd, CryptoNav, Freshness, inr, Kind, MiniLine, pctFrac, pctPts, PriceChart, signCls, SymbolBadge, usd, utc, type Candle, type Fresh } from '@/components/crypto';
import { useApp } from '@/components/providers';
import { Loading, Problem, Tabs, useApi } from '@/components/ui';

interface Series { series_id: string; source_id: string; kind: string; quote_currency: string; product_id: string | null; exchange_id: string | null; first_open_time: string | null; last_open_time: string | null; observations: number; backfill_complete: boolean; label: string }
interface Snap { quote_currency: string; price: number | null; market_cap: number | null; fdv: number | null; volume_24h: number | null; high_24h: number | null; low_24h: number | null; change_24h_pct: number | null; change_7d_pct: number | null; change_30d_pct: number | null; ath: number | null; ath_at: string | null; market_cap_rank: number | null; provider_updated_at: string | null; retrieved_at: string; source_id: string }
interface Supply { observed_on: string; circulating_supply: number | null; total_supply: number | null; max_supply: number | null; methodology: string; validation: string; validation_note: string | null; provider_updated_at: string | null; retrieved_at: string; source_id: string }
interface Detail {
  asset: { asset_id: string; canonical_key: string; name: string; symbol: string; classification: string; category: string | null; description: string | null; primary_network_id: string | null; listing_status: string; market_cap_rank: number | null; metadata_source: string; first_seen_at: string; last_verified_at: string };
  network: { network_id: string; name: string; family: string; chain_id: number | null } | null;
  snapshots: Snap[]; snapshot_freshness: Fresh; supply_latest: Supply | null; supply_history: Supply[];
  contracts: { network_id: string; network: string; explorer_url: string | null; address: string; decimals: number | null; verification: string; source_id: string; verified_at: string }[];
  provider_ids: { provider: string; external_id: string; verified_by: string; verified_at: string }[];
  pairs: { exchange_id: string; exchange: string; product_id: string; base_symbol: string; quote_symbol: string; status: string; tradable: boolean; mapping_source: string; verified_at: string }[];
  series: Series[];
  events: { event_id: string; category: string; headline: string; source_id: string; source_url: string; published_at: string; verification: string }[];
  protocols: { protocol_id: string; name: string; category: string | null; tvl_usd: number | null; retrieved_at: string }[];
  watchlisted: boolean; metadata_error: string | null;
  panels: { tokenomics: boolean; onchain: boolean; defi: boolean; pairs: boolean; history: boolean };
}

export default function AssetPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const d = useApi<Detail>(`/v1/crypto/assets/${key}`);
  const [tab, setTab] = useState('overview');
  useEffect(() => {
    const t = new URLSearchParams(location.search).get('tab');
    if (t) setTab(t);
  }, []);
  const change = (t: string) => {
    setTab(t);
    const u = new URL(location.href);
    u.searchParams.set('tab', t);
    history.replaceState(null, '', u);
  };
  if (d.loading && !d.data) return <><CryptoNav /><Loading lines={10} label="Loading asset" /></>;
  if (d.error) return <><CryptoNav /><Problem error={d.error} retry={d.reload} /></>;
  const x = d.data!;
  const tabs: [string, string][] = [['overview', 'Price & overview'], ['analytics', 'Analytics'], ['tokenomics', 'Tokenomics'], ['markets', 'Markets'], ['events', 'Events'], ['notes', 'My notes']];
  return (
    <>
      <CryptoNav />
      <AssetHeader d={x} onWatch={d.reload} />
      <Tabs tabs={tabs} active={tab} onChange={change} />
      {tab === 'overview' && <OverviewTab d={x} />}
      {tab === 'analytics' && <AnalyticsTab d={x} />}
      {tab === 'tokenomics' && <TokenomicsTab d={x} />}
      {tab === 'markets' && <MarketsTab d={x} />}
      {tab === 'events' && <EventsTab d={x} />}
      {tab === 'notes' && <NotesTab k={x.asset.canonical_key} />}
    </>
  );
}

function AssetHeader({ d, onWatch }: { d: Detail; onWatch: () => void }) {
  const { toast } = useApp();
  const a = d.asset;
  const s = d.snapshots.find((x) => x.quote_currency === 'usd');
  const toggle = async () => {
    try {
      if (d.watchlisted) await api(`/v1/crypto/watchlist/${a.canonical_key}`, { method: 'DELETE' });
      else await api('/v1/crypto/watchlist', { body: { key: a.canonical_key } });
      toast(d.watchlisted ? 'Removed from your watchlist' : 'Added to your watchlist');
      onWatch();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <header className="card" style={{ display: 'grid', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0 }}><SymbolBadge symbol={a.symbol} />{a.name} <span className="mu">{a.symbol}</span></h1>
        <button className="btn s" onClick={toggle} aria-pressed={d.watchlisted}>{d.watchlisted ? '★ On watchlist' : '☆ Add to watchlist'}</button>
      </div>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span style={{ font: '600 26px var(--font)', fontVariantNumeric: 'tabular-nums' }}>{usd(s?.price)}</span>
        <span className={signCls(s?.change_24h_pct)}>{pctPts(s?.change_24h_pct)} 24 h</span>
        <Kind k="reference" title="CoinGecko aggregate across venues; not an executable price" />
        <Freshness f={d.snapshot_freshness} />
        {a.listing_status !== 'listed' && <span className="t r">Not in the latest provider snapshot</span>}
      </div>
      <p className="cx-src">Identity: CoinGecko id <code>{a.canonical_key}</code> · rank {a.market_cap_rank ?? '—'} · {a.classification === 'native_coin' ? 'native coin' : a.classification === 'token' ? 'token' : 'type not yet classified'}{d.network ? ` · primary network ${d.network.name}${d.network.chain_id ? ` (chain id ${d.network.chain_id})` : ''}` : ''} · metadata verified {utc(a.last_verified_at)} · Powered by CoinGecko</p>
    </header>
  );
}

function OverviewTab({ d }: { d: Detail }) {
  const [series, setSeries] = useState<string>(d.series[0]?.series_id ?? '');
  const [range, setRange] = useState('365');
  const h = useApi<{ series: Series & { data_kind: string } | null; observations: Candle[]; gaps: { from: string; to: string; missing_days: number }[]; coverage: { first: string; last: string; observations: number; backfill_complete: boolean } | null; suspect: number; note?: string }>(series ? `/v1/crypto/assets/${d.asset.canonical_key}/history?series=${series}&range=${range}` : null, [series, range]);
  const usdSnap = d.snapshots.find((x) => x.quote_currency === 'usd');
  const inrSnap = d.snapshots.find((x) => x.quote_currency === 'inr');
  const sel = d.series.find((s) => s.series_id === series);
  return (
    <>
      <section className="card" aria-labelledby="pc">
        <h2 id="pc">Price history</h2>
        {!d.series.length ? <p className="warn">No stored daily history for this asset yet. ATLAS imports history for the highest-ranked assets first (venue candles from Binance and Coinbase, and CoinGecko's 365-day reference series).</p> : (
          <>
            <div className="cx-filters">
              <label className="field">Series<select value={series} onChange={(e) => setSeries(e.target.value)}>{d.series.map((s) => <option key={s.series_id} value={s.series_id}>{s.label} · {s.observations} days</option>)}</select></label>
              <div role="group" aria-label="Period" className="seg">{[['30', '30 d'], ['90', '90 d'], ['365', '1 y'], ['1095', '3 y'], ['max', 'All stored']].map(([k, l]) => <button key={k} aria-pressed={range === k} className={range === k ? 'on' : ''} onClick={() => setRange(k)}>{l}</button>)}</div>
            </div>
            {h.loading && !h.data ? <Loading lines={6} /> : h.error ? <Problem error={h.error} retry={h.reload} /> : h.data && (
              <>
                <PriceChart data={h.data.observations} quote={sel?.quote_currency ?? 'USD'} title={`${d.asset.name}: ${sel?.label ?? ''}`}
                  note={<><span><Kind k={h.data.series?.data_kind ?? 'reference'} /></span><span>Stored coverage {h.data.coverage?.first?.slice(0, 10)} to {h.data.coverage?.last?.slice(0, 10)} ({h.data.coverage?.observations} days{h.data.coverage?.backfill_complete ? '' : ', backfill in progress'})</span><span>Last observation {utc(h.data.coverage?.last, false)}</span></>} />
                {h.data.gaps.length > 0 && <p className="warn">{h.data.gaps.length} gap{h.data.gaps.length > 1 ? 's' : ''} in this period ({h.data.gaps.reduce((a, g) => a + g.missing_days, 0)} missing days, e.g. {h.data.gaps[0]!.from} to {h.data.gaps[0]!.to}). Gaps are shown as gaps, never filled.</p>}
                {h.data.suspect > 0 && <p className="mu">{h.data.suspect} observation(s) flagged as extreme moves (kept, not removed). See the table view.</p>}
              </>
            )}
          </>
        )}
      </section>
      <div className="grid2">
        <section className="card" aria-labelledby="ms">
          <h2 id="ms">Market statistics <Kind k="reference" /></h2>
          {usdSnap ? (
            <dl className="term-kv">
              <dt>Market capitalisation</dt><dd>{usdSnap.market_cap === null ? <span className="mu">not available</span> : compactUsd(usdSnap.market_cap)}</dd>
              <dt>Fully diluted valuation</dt><dd>{usdSnap.fdv === null ? <span className="mu">not available</span> : compactUsd(usdSnap.fdv)}</dd>
              <dt>24 h volume (all venues)</dt><dd>{compactUsd(usdSnap.volume_24h)}</dd>
              <dt>24 h range</dt><dd>{usd(usdSnap.low_24h)} – {usd(usdSnap.high_24h)}</dd>
              <dt>7 d / 30 d change</dt><dd><span className={signCls(usdSnap.change_7d_pct)}>{pctPts(usdSnap.change_7d_pct)}</span> / <span className={signCls(usdSnap.change_30d_pct)}>{pctPts(usdSnap.change_30d_pct)}</span></dd>
              <dt>All-time high (provider)</dt><dd>{usd(usdSnap.ath)} <span className="mu">{usdSnap.ath_at?.slice(0, 10)}</span></dd>
              {inrSnap && <><dt>INR reference <Kind k="converted" title="CoinGecko's own USD→INR conversion. Not a price on an Indian exchange." /></dt><dd>{inr(inrSnap.price)}</dd></>}
            </dl>
          ) : <p className="mu">No market snapshot stored.</p>}
          <p className="cx-src">CoinGecko snapshot: provider updated {utc(usdSnap?.provider_updated_at)}, retrieved {utc(usdSnap?.retrieved_at)}. Volume and market cap follow CoinGecko methodology.</p>
        </section>
        <section className="card" aria-labelledby="ab">
          <h2 id="ab">About and identity</h2>
          {d.asset.description ? <p style={{ whiteSpace: 'pre-line' }}>{d.asset.description.slice(0, 900)}{d.asset.description.length > 900 ? '…' : ''}</p> : <p className="mu">{d.metadata_error ?? 'No description stored.'}</p>}
          {d.asset.description && <p className="cx-src">Description: CoinGecko, project-supplied text. Not verified by ATLAS.</p>}
          <h3>Provider identifiers</h3>
          <ul>{d.provider_ids.map((p) => <li key={p.provider + p.external_id}>{p.provider}: <code>{p.external_id}</code> <span className="mu">({p.verified_by})</span></li>)}</ul>
          {d.contracts.length > 0 && <>
            <h3>Contracts</h3>
            <ul>{d.contracts.map((c) => <li key={c.network_id + c.address}>{c.network}: <span className="cx-addr">{c.address}</span>{c.decimals !== null ? ` · ${c.decimals} decimals` : ''} <span className="mu">({c.verification.replace('_', ' ')}, {c.source_id})</span></li>)}</ul>
            <p className="mu">Contract addresses are as reported by CoinGecko; ATLAS has not verified them on-chain. Always check an address against the project's official sources.</p>
          </>}
          {d.panels.onchain && <p><a href={`/app/crypto/onchain#${d.network!.network_id}`}>Network activity for {d.network!.name}</a></p>}
          {d.protocols.length > 0 && <p>DeFi: {d.protocols.map((p) => <a key={p.protocol_id} href={`/app/crypto/defi/${p.protocol_id}`}>{p.name} ({compactUsd(p.tvl_usd)} TVL) </a>)}</p>}
        </section>
      </div>
    </>
  );
}

interface Analytics {
  series: Series | null; note?: string; calculated_at: string; last_observation: string;
  returns: Record<string, { value: number | null; from?: string; to?: string; days_actual?: number; reason?: string }>;
  volatility: Record<string, { value: number | null; returns_used?: number; annualisation?: string; reason?: string }> & { rolling_30d: { t: string; v: number }[] };
  drawdown: { current?: number; max?: number; peak?: { t: string; v: number }; max_peak?: string; max_trough?: string; recovery?: string | null; recovery_days?: number | null; days_since_peak?: number; series?: { t: string; v: number }[]; reason?: string };
  distribution: { n?: number; stdev?: number; skew?: number; excess_kurtosis?: number; p01?: number; p05?: number; p95?: number; p99?: number; worst?: { t: string; r: number }; best?: { t: string; r: number }; reason?: string };
  regime: { current?: string; share?: Record<string, number>; recent_segments?: { from: string; to: string; regime: string }[]; reason?: string };
  volume_trend: { ratio?: number; reason?: string };
  correlation: Record<string, { value: number | null; n: number | null; reason: string | null; beta_365d: number | null; beta_reason: string | null; rolling_90d: { t: string; v: number }[] }>;
  formulas: { code: string; name: string; formula: string; inputs: string; period: string; missing: string }[];
  caveats: string[];
}

function AnalyticsTab({ d }: { d: Detail }) {
  const [series, setSeries] = useState(d.series[0]?.series_id ?? '');
  const a = useApi<Analytics>(`/v1/crypto/assets/${d.asset.canonical_key}/analytics${series ? `?series=${series}` : ''}`, [series]);
  if (!d.series.length) return <p className="warn">No stored daily history for this asset, so nothing can be calculated yet.</p>;
  if (a.loading && !a.data) return <Loading lines={8} />;
  if (a.error) return <Problem error={a.error} retry={a.reload} />;
  const x = a.data!;
  const pending = (r?: string) => <span className="mu" title={r}>not calculated{r ? `: ${r}` : ''}</span>;
  return (
    <>
      <div className="cx-filters">
        <label className="field">Calculated from<select value={series} onChange={(e) => setSeries(e.target.value)}>{d.series.map((s) => <option key={s.series_id} value={s.series_id}>{s.label} · {s.observations} days</option>)}</select></label>
        <span className="mu">Calculated {utc(x.calculated_at)} from stored observations to {x.last_observation?.slice(0, 10)}. <Kind k="derived" /></span>
      </div>
      <div className="grid2">
        <section className="card"><h2>Returns</h2>
          <table className="term-table"><thead><tr><th scope="col" style={{ textAlign: 'left' }}>Period</th><th scope="col" className="num">Return</th><th scope="col">From → to</th></tr></thead>
            <tbody>{Object.entries(x.returns).map(([k, r]) => <tr key={k}><td style={{ textAlign: 'left' }}>{k.replace('d', ' days').replace(/^1 days/, '1 day')}</td><td className={`num ${signCls(r.value)}`}>{r.value === null ? '—' : pctFrac(r.value)}</td><td className="mu">{r.value === null ? r.reason : `${r.from} → ${r.to}${r.days_actual && r.days_actual !== Number(k.replace('d', '')) ? ` (${r.days_actual} days: nearest earlier observation)` : ''}`}</td></tr>)}</tbody>
          </table>
        </section>
        <section className="card"><h2>Volatility and drawdown</h2>
          <dl className="term-kv">
            {(['30d', '90d'] as const).map((k) => <span key={k} style={{ display: 'contents' }}><dt>Realised volatility, {k.replace('d', ' days')}</dt><dd>{x.volatility[k]!.value === null ? pending(x.volatility[k]!.reason) : `${(x.volatility[k]!.value! * 100).toFixed(1)}% (${x.volatility[k]!.annualisation}, ${x.volatility[k]!.returns_used} returns)`}</dd></span>)}
            <dt>Current drawdown from peak</dt><dd className={signCls(x.drawdown.current)}>{x.drawdown.current === undefined ? pending(x.drawdown.reason) : pctFrac(x.drawdown.current)}</dd>
            <dt>Maximum drawdown in stored history</dt><dd className="dn">{x.drawdown.max === undefined ? '—' : `${pctFrac(x.drawdown.max)} (${x.drawdown.max_peak} → ${x.drawdown.max_trough})`}</dd>
            <dt>Recovered from that drawdown</dt><dd>{x.drawdown.max === undefined ? '—' : x.drawdown.recovery ? `${x.drawdown.recovery} (${x.drawdown.recovery_days} days after the peak)` : 'not yet'}</dd>
            <dt>Days since the stored peak</dt><dd>{x.drawdown.days_since_peak ?? '—'}</dd>
            <dt>Volume, 30-day vs 90-day average</dt><dd>{x.volume_trend.ratio === undefined ? pending(x.volume_trend.reason) : `${x.volume_trend.ratio.toFixed(2)}×`}</dd>
            <dt>Historical regime now</dt><dd>{x.regime.current ? x.regime.current.replace('_', ', ') : pending(x.regime.reason)}</dd>
          </dl>
        </section>
      </div>
      <div className="grid2">
        {x.drawdown.series && <section className="card"><MiniLine title="Drawdown from running peak" points={x.drawdown.series} zero /></section>}
        {x.volatility.rolling_30d.length > 1 && <section className="card"><MiniLine title="Rolling 30-day realised volatility (annualised)" points={x.volatility.rolling_30d} /></section>}
      </div>
      <div className="grid2">
        <section className="card"><h2>Relationship to benchmarks</h2>
          {Object.keys(x.correlation).length === 0 ? <p className="mu">This asset is itself a benchmark.</p> : Object.entries(x.correlation).map(([k, c]) => (
            <div key={k}>
              <p><strong>vs {k}</strong>: 90-day correlation {c.value === null ? pending(c.reason ?? undefined) : `${c.value.toFixed(2)} (${c.n} aligned days)`}; 365-day beta {c.beta_365d === null ? pending(c.beta_reason ?? undefined) : c.beta_365d.toFixed(2)}</p>
              {c.rolling_90d.length > 1 && <MiniLine title={`Rolling 90-day correlation with ${k}`} points={c.rolling_90d} format={(v) => v.toFixed(2)} height={120} />}
            </div>
          ))}
          <p className="mu">Both series from the same source so observation times align. Correlation does not establish causation.</p>
        </section>
        <section className="card"><h2>Daily return distribution</h2>
          {x.distribution.n === undefined ? pending(x.distribution.reason) : (
            <dl className="term-kv">
              <dt>Daily returns used</dt><dd>{x.distribution.n}</dd>
              <dt>Standard deviation</dt><dd>{(x.distribution.stdev! * 100).toFixed(2)}%</dd>
              <dt>1st / 5th percentile</dt><dd>{pctFrac(x.distribution.p01)} / {pctFrac(x.distribution.p05)}</dd>
              <dt>95th / 99th percentile</dt><dd>{pctFrac(x.distribution.p95)} / {pctFrac(x.distribution.p99)}</dd>
              <dt>Worst day</dt><dd className="dn">{pctFrac(x.distribution.worst!.r)} on {x.distribution.worst!.t}</dd>
              <dt>Best day</dt><dd className="up">{pctFrac(x.distribution.best!.r)} on {x.distribution.best!.t}</dd>
              <dt>Skewness / excess kurtosis</dt><dd>{x.distribution.skew!.toFixed(2)} / {x.distribution.excess_kurtosis!.toFixed(2)}</dd>
            </dl>
          )}
        </section>
      </div>
      <section className="card"><h2>Formulas and assumptions</h2>
        <div className="wrap"><table><thead><tr><th scope="col" style={{ textAlign: 'left' }}>Metric</th><th scope="col" style={{ textAlign: 'left' }}>Formula</th><th scope="col" style={{ textAlign: 'left' }}>Period</th><th scope="col" style={{ textAlign: 'left' }}>Missing data</th></tr></thead>
          <tbody>{x.formulas.map((f) => <tr key={f.code}><td style={{ textAlign: 'left' }}>{f.name}</td><td style={{ textAlign: 'left' }}><code>{f.formula}</code></td><td style={{ textAlign: 'left' }}>{f.period}</td><td style={{ textAlign: 'left' }}>{f.missing}</td></tr>)}</tbody></table></div>
        <ul>{x.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
      </section>
    </>
  );
}

function TokenomicsTab({ d }: { d: Detail }) {
  const s = d.supply_latest;
  const price = d.snapshots.find((x) => x.quote_currency === 'usd')?.price ?? null;
  if (!s) return <p className="warn">No supply figures stored for this asset.</p>;
  const share = s.circulating_supply !== null && (s.max_supply ?? s.total_supply) ? s.circulating_supply / (s.max_supply ?? s.total_supply)! : null;
  const hist = d.supply_history.filter((h) => h.circulating_supply !== null).map((h) => ({ t: h.observed_on, v: h.circulating_supply! }));
  return (
    <>
      <div className="grid2">
        <section className="card"><h2>Supply <Kind k="provider_estimate" /></h2>
          <dl className="term-kv">
            <dt>Circulating supply</dt><dd>{s.circulating_supply === null ? <span className="mu">not available</span> : `${compactNum(s.circulating_supply)} ${d.asset.symbol}`}</dd>
            <dt>Total supply</dt><dd>{s.total_supply === null ? <span className="mu">not available</span> : `${compactNum(s.total_supply)} ${d.asset.symbol}`}</dd>
            <dt>Maximum supply</dt><dd>{s.max_supply === null ? <span className="mu" title="The provider reports no maximum: either none exists or it is not defined">no maximum defined</span> : `${compactNum(s.max_supply)} ${d.asset.symbol}`}</dd>
            <dt>Circulating ÷ {s.max_supply ? 'maximum' : 'total'}</dt><dd>{share === null ? '—' : `${(share * 100).toFixed(1)}%`}</dd>
            <dt>Not yet circulating (at today's price)</dt><dd>{share === null || price === null ? '—' : compactUsd(((s.max_supply ?? s.total_supply)! - s.circulating_supply!) * price)}</dd>
          </dl>
          {s.validation === 'inconsistent' && <p className="warn">Provider figures are inconsistent: {s.validation_note}. Shown as reported.</p>}
          <p className="cx-src">Observed {s.observed_on} (provider updated {utc(s.provider_updated_at)}). {s.methodology}</p>
        </section>
        <section className="card"><h2>How to read this</h2>
          <ul>
            <li><strong>Circulating</strong> is the provider's estimate of tokens that can trade now. <strong>Total</strong> counts tokens that exist minus burned ones. <strong>Maximum</strong> is a protocol cap, where one exists (Bitcoin: 21 million; many assets have none).</li>
            <li>Market cap uses circulating supply; fully diluted valuation uses maximum (or total) supply. A large gap means future supply could dilute holders.</li>
            <li>Unlock and vesting schedules are <strong>not available</strong> from ATLAS's free sources (DefiLlama's unlock data is a paid feature). ATLAS does not estimate them.</li>
            <li>Holder concentration is not shown: no reliable free address-level dataset with classified exchange, bridge and treasury addresses is connected.</li>
          </ul>
          <p><a href="/app/academy">Learn more in TOKENOMICS DETECTIVE</a></p>
        </section>
      </div>
      <section className="card">
        {hist.length > 1 ? <MiniLine title="Circulating supply, ATLAS daily snapshots (history starts when ATLAS began importing)" points={hist} format={compactNum} /> : <p className="mu">Supply history builds up one snapshot per day from the first import ({d.supply_history[0]?.observed_on ?? '—'}). There is not enough yet to chart.</p>}
      </section>
    </>
  );
}

function MarketsTab({ d }: { d: Detail }) {
  if (!d.pairs.length) return <p className="warn">No verified market pairs on Binance or Coinbase Exchange for this asset. ATLAS maps a pair only when CoinGecko's ticker list names this asset and the exchange's own product list confirms the pair.</p>;
  return (
    <section className="card"><h2>Verified market pairs <Kind k="venue" /></h2>
      <div className="wrap"><table className="term-table">
        <thead><tr><th scope="col" style={{ textAlign: 'left' }}>Venue</th><th scope="col" style={{ textAlign: 'left' }}>Product</th><th scope="col" style={{ textAlign: 'left' }}>Base / quote</th><th scope="col" style={{ textAlign: 'left' }}>Status</th><th scope="col" style={{ textAlign: 'left' }}>Verified</th></tr></thead>
        <tbody>{d.pairs.map((p) => <tr key={p.exchange_id + p.product_id}><td style={{ textAlign: 'left' }}>{p.exchange}</td><td style={{ textAlign: 'left' }}><code>{p.product_id}</code></td><td style={{ textAlign: 'left' }}>{p.base_symbol} / {p.quote_symbol}</td><td style={{ textAlign: 'left' }}><span className={`t ${p.tradable ? 'o' : 'r'}`}>{p.status}</span></td><td style={{ textAlign: 'left' }}>{utc(p.verified_at)}</td></tr>)}</tbody>
      </table></div>
      <p className="mu">BTC/USD, BTC/USDT and BTC/EUR are different markets with different prices. Mapping: {d.pairs[0]?.mapping_source}. A listing is not an endorsement, and availability can depend on your jurisdiction.</p>
    </section>
  );
}

function EventsTab({ d }: { d: Detail }) {
  if (!d.events.length) return <p className="mu">No source-linked events stored for this asset. <a href="/app/crypto/events">What the events feed covers</a></p>;
  return (
    <section className="card"><ol className="term-feed">{d.events.map((e) => <li key={e.event_id}><time dateTime={e.published_at}>{utc(e.published_at)}</time><span className="t c">{e.category.replace(/_/g, ' ')}</span><a href={e.source_url} target="_blank" rel="noreferrer noopener">{e.headline}</a><span className="mu">{e.verification === 'observed_by_atlas' ? 'observed by ATLAS' : e.source_id}</span></li>)}</ol></section>
  );
}

function NotesTab({ k }: { k: string }) {
  const n = useApi<{ rows: { note_id: string; body: string; created_at: string }[] }>(`/v1/crypto/assets/${k}/notes`);
  const [body, setBody] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api(`/v1/crypto/assets/${k}/notes`, { body: { body } });
      setBody('');
      setErr(null);
      n.reload();
    } catch (x) {
      setErr((x as Error).message);
    }
  };
  return (
    <section className="card"><h2>My research notes</h2>
      <form onSubmit={add} className="stack"><label className="field">New note (private to you)<textarea rows={3} maxLength={10000} value={body} onChange={(e) => setBody(e.target.value)} required /></label><button className="btn" type="submit">Save note</button>{err && <p className="err">{err}</p>}</form>
      {n.data?.rows.map((r) => <article key={r.note_id} className="qcard"><p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{r.body}</p><p className="mu">{utc(r.created_at)} <button className="link" onClick={async () => { await api(`/v1/crypto/notes/${r.note_id}`, { method: 'DELETE' }); n.reload(); }}>Delete</button></p></article>)}
    </section>
  );
}
