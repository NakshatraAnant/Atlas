'use client';
import { useState } from 'react';
import { Loading, Problem, useApi } from '@/components/ui';

interface M { metrics: { code: string; version: number; name: string; category: string; unit: string; screener: boolean }[] }

export default function Methodology() {
  const m = useApi<M>('/v1/methodology/metrics');
  const [q, setQ] = useState('');
  const cats = [...new Set(m.data?.metrics.map((x) => x.category) ?? [])];
  return (
    <>
      <h1>Methodology</h1>
      <div className="grid">
        <a className="card" href="/methodology/backtests"><h3>Backtest methodology</h3><p className="mu">Engine, cost table, bias controls, reproducibility, limitations.</p></a>
        <a className="card" href="/methodology/ai"><h3>How AI answers work</h3><p className="mu">Pipeline, what the assistant will not do, latest evaluation.</p></a>
        <a className="card" href="/methodology/sources"><h3>Data sources and freshness</h3><p className="mu">Datasets, schedules, delays, coverage, live status.</p></a>
        <a className="card" href="/methodology/corrections"><h3>Correction log</h3><p className="mu">Material corrections with date and impact.</p></a>
      </div>
      <h2>Metric definitions</h2>
      <label className="field">Find a metric<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. cash conversion" /></label>
      {m.loading && <Loading />}
      <Problem error={m.error} />
      {cats.map((c) => {
        const list = m.data!.metrics.filter((x) => x.category === c && `${x.name} ${x.code}`.toLowerCase().includes(q.toLowerCase()));
        if (!list.length) return null;
        return (
          <section key={c} className="card">
            <h3 style={{ textTransform: 'capitalize' }}>{c.replace('_', ' ')}</h3>
            <ul>{list.map((x) => <li key={x.code}><a href={`/methodology/metrics/${x.code}`}>{x.name}</a> <span className="mu">{x.code} v{x.version}{x.screener ? ' · screener field' : ''}</span></li>)}</ul>
          </section>
        );
      })}
    </>
  );
}
