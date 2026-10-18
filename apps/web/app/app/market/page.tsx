'use client';
import { useState } from 'react';
import { BriefingView } from '@/components/briefing';
import { LineChart } from '@/components/charts';
import { Loading, Problem, Stale, Tabs, useApi, Value } from '@/components/ui';
import { cls, fmt, formatDate, pct } from '@/lib/format';

interface Summary {
  date: string; as_of_label: string;
  indices: { index_code: string; name: string; kind: string; close: number; returns: Record<string, number | null>; evidence_id: string; label: string }[];
  breadth: { traded: number; advances: number; declines: number; unchanged: number; pct_above_50dma: number; pct_above_200dma: number; new_highs: number; new_lows: number; evidence_id: string };
  activity: { turnover_cr: number; turnover_vs_avg20: number; realised_vol_20d: number; vol_percentile_1y: number; percentile_lookback: string; evidence_id: string };
  volatility_index: { status: string; note: string };
  sectors: { sector: string; ret_equal: number; ret_cap: number; constituents: number; advances: number; declines: number; evidence_id: string }[];
  sector_methodology: string; index_contribution: { status: string; note: string };
  freshness: { stale: boolean; label: string; last_data_date: string };
}
interface Analogues { measure: string; label: string; analogues: { trade_date: string; distance: number; index_return_pct: number; pct_above_50dma: number; realised_vol_20d_pct: number }[] }

export default function Market() {
  const [tab, setTab] = useState('overview');
  const s = useApi<Summary>('/v1/market/summary');
  return (
    <>
      <h1>Market</h1>
      <Tabs tabs={[['overview', 'Overview'], ['briefing', 'Today’s briefing'], ['breadth', 'Breadth history'], ['similar', 'Similar sessions']]} active={tab} onChange={setTab} />
      {tab === 'briefing' && <BriefingView />}
      {tab === 'breadth' && <Breadth />}
      {tab === 'similar' && <Similar />}
      {tab === 'overview' && (s.loading ? <Loading lines={6} /> : s.error ? <Problem error={s.error} retry={s.reload} /> : <Overview s={s.data!} />)}
    </>
  );
}

function Overview({ s }: { s: Summary }) {
  return (
    <>
      <p className="mu">{s.as_of_label} · <Stale stale={s.freshness.stale} label={s.freshness.label} /></p>
      <div className="wrap card">
        <table>
          <caption>Indices (price return unless labelled)</caption>
          <thead><tr><th scope="col">Index</th><th scope="col">Close</th>{['1D', '1W', '1M', '3M', 'YTD', '1Y'].map((k) => <th key={k} scope="col">{k}</th>)}</tr></thead>
          <tbody>{s.indices.map((i) => (
            <tr key={i.index_code}>
              <th scope="row"><a href={`/app/market/indices/${i.index_code}`}>{i.name}</a> <span className="mu">{i.label}</span></th>
              <td><Value v={i.close} evidence={i.evidence_id} surface="market" /></td>
              {['1D', '1W', '1M', '3M', 'YTD', '1Y'].map((k) => <td key={k} className={cls(i.returns[k])}>{pct(i.returns[k])}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="grid">
        <div className="card"><h3>Breadth</h3>
          <p><Value evidence={s.breadth.evidence_id} surface="market">{`${s.breadth.advances} up · ${s.breadth.declines} down · ${s.breadth.unchanged} unchanged`}</Value></p>
          <p className="mu">{fmt(s.breadth.pct_above_50dma, 'percent')} above 50-day average · {fmt(s.breadth.pct_above_200dma, 'percent')} above 200-day · {s.breadth.new_highs} new 52-week highs, {s.breadth.new_lows} new lows</p>
        </div>
        <div className="card"><h3>Activity</h3>
          <p>Turnover <Value v={s.activity.turnover_cr} unit="INR_cr" evidence={s.activity.evidence_id} surface="market" /> ({fmt(s.activity.turnover_vs_avg20, 'ratio')} the 20-day average)</p>
          <p className="mu">20-day realised volatility {fmt(s.activity.realised_vol_20d * 100, 'percent')}, at the {Math.round(s.activity.vol_percentile_1y)}th percentile of {s.activity.percentile_lookback}.</p>
        </div>
        <div className="card"><h3>Volatility index</h3><p className="mu">{s.volatility_index.note}</p></div>
      </div>
      <div className="wrap card">
        <table>
          <caption>Sectors on {formatDate(s.date)}</caption>
          <thead><tr><th scope="col">Sector</th><th scope="col">Equal-weighted</th><th scope="col">Cap-weighted</th><th scope="col">Up / down</th><th scope="col">Companies</th></tr></thead>
          <tbody>{[...s.sectors].sort((a, b) => b.ret_cap - a.ret_cap).map((x) => (
            <tr key={x.sector}>
              <th scope="row"><a href={`/app/market/sectors/${encodeURIComponent(x.sector)}`}>{x.sector}</a></th>
              <td className={cls(x.ret_equal)}><Value evidence={x.evidence_id} surface="market">{pct(x.ret_equal * 100)}</Value></td>
              <td className={cls(x.ret_cap)}>{pct(x.ret_cap * 100)}</td>
              <td>{x.advances} / {x.declines}</td><td>{x.constituents}</td>
            </tr>
          ))}</tbody>
        </table>
        <p className="mu">{s.sector_methodology}</p>
        <p className="mu">{s.index_contribution.note}</p>
      </div>
    </>
  );
}

function Breadth() {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
  const b = useApi<{ series: { trade_date: string; pct_above_50dma: number; pct_above_200dma: number; advances: number; declines: number }[] }>(`/v1/market/breadth?from=${from}&to=${to}`);
  if (b.loading) return <Loading />;
  if (b.error) return <Problem error={b.error} />;
  const ser = b.data!.series;
  return (
    <div className="card">
      <LineChart title="Share of covered companies above their moving averages" yLabel="% of companies" format={(v) => `${Math.round(v)}%`}
        series={[{ name: 'Above 50-day', points: ser.map((r) => ({ x: r.trade_date, y: r.pct_above_50dma })) }, { name: 'Above 200-day', points: ser.map((r) => ({ x: r.trade_date, y: r.pct_above_200dma })) }]} />
    </div>
  );
}

function Similar() {
  const a = useApi<Analogues>('/v1/market/similar-sessions');
  if (a.loading) return <Loading />;
  if (a.error) return <Problem error={a.error} />;
  const d = a.data!;
  return (
    <div className="card">
      <p className="warn">{d.label}</p>
      <p className="mu">Similarity: {d.measure}</p>
      <div className="wrap"><table><caption>Past sessions most similar to the latest one</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Distance</th><th scope="col">Index move</th><th scope="col">Above 50-day</th><th scope="col">Realised vol (20d)</th></tr></thead>
        <tbody>{d.analogues.map((x) => <tr key={x.trade_date}><td><a href={`/app/briefings/${x.trade_date}`}>{formatDate(x.trade_date)}</a></td><td>{x.distance.toFixed(2)}</td><td className={cls(x.index_return_pct)}>{pct(x.index_return_pct)}</td><td>{fmt(x.pct_above_50dma, 'percent')}</td><td>{fmt(x.realised_vol_20d_pct, 'percent')}</td></tr>)}</tbody>
      </table></div>
    </div>
  );
}
