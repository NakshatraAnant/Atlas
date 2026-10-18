'use client';
import { use, useMemo, useState } from 'react';
import { LineChart } from '@/components/charts';
import { Loading, Problem, useApi } from '@/components/ui';

interface IndexHistory { index_code: string; name: string; kind: string; type_label: string; series: { trade_date: string; close: number }[]; period_definition: string }
const RANGES: [string, number][] = [['1M', 21], ['6M', 126], ['1Y', 252], ['3Y', 756], ['All', 0]];

export default function IndexPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [range, setRange] = useState('1Y');
  const h = useApi<IndexHistory>(`/v1/market/indices/${code}/history`);
  const pts = useMemo(() => {
    const s = h.data?.series ?? [];
    const n = RANGES.find((r) => r[0] === range)![1];
    return (n ? s.slice(-n) : s).map((p) => ({ x: p.trade_date, y: p.close }));
  }, [h.data, range]);
  if (h.loading) return <Loading lines={6} />;
  if (h.error) return <Problem error={h.error} retry={h.reload} />;
  const d = h.data!;
  return (
    <>
      <p><a href="/app/market">← Market</a></p>
      <h1>{d.name}</h1>
      <p className="mu">{d.type_label} · end of day · {d.period_definition}</p>
      <div className="row" role="group" aria-label="Range">{RANGES.map(([k]) => <button key={k} className={`btn s`} aria-pressed={range === k} onClick={() => setRange(k)}>{k}</button>)}</div>
      <div className="card"><LineChart title={`${d.name} closing level`} yLabel="Index level" series={[{ name: d.name, points: pts }]} /></div>
    </>
  );
}
