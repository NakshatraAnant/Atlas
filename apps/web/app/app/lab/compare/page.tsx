'use client';
import { useEffect, useState } from 'react';
import { Loading, Problem, useApi } from '@/components/ui';

interface Cmp { runs: { run_id: string; name: string | null; template: string; metrics: Record<string, string>; warnings: { code: string; title: string }[]; results_hash: string }[]; metrics: { code: string; name: string }[] }

export default function Compare() {
  const [ids, setIds] = useState<string | null>(null);
  useEffect(() => setIds(new URLSearchParams(location.search).get('ids') ?? ''), []);
  const c = useApi<Cmp>(ids ? `/v1/backtests/compare/${ids}` : null, [ids]);
  if (ids === '') return <p className="err">Choose two to four runs to compare in the Quant Lab.</p>;
  if (c.loading || !c.data) return c.error ? <Problem error={c.error} /> : <Loading />;
  const d = c.data;
  return (
    <>
      <p><a href="/app/lab">← Quant Lab</a></p>
      <h1>Compare backtests</h1>
      <div className="wrap card"><table>
        <caption>Side-by-side metrics (same definitions for every run)</caption>
        <thead><tr><th scope="col">Metric</th>{d.runs.map((r) => <th key={r.run_id} scope="col"><a href={`/app/lab/runs/${r.run_id}`}>{r.name ?? r.template.replace(/_/g, ' ')}</a></th>)}</tr></thead>
        <tbody>
          {d.metrics.map((m) => <tr key={m.code}><th scope="row"><a href={`/methodology/metrics/${m.code}`}>{m.name}</a></th>{d.runs.map((r) => <td key={r.run_id}>{r.metrics[m.code] ?? '—'}</td>)}</tr>)}
          <tr><th scope="row">Warnings</th>{d.runs.map((r) => <td key={r.run_id}>{r.warnings.map((w) => w.title).join('; ') || 'None'}</td>)}</tr>
        </tbody>
      </table></div>
    </>
  );
}
