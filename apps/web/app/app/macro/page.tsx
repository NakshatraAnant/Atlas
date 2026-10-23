'use client';
import { Loading, Problem, useApi } from '@/components/ui';

// Macro: US and India-relevant series from the official FRED API, grouped by theme. Each row shows the
// period its latest value refers to and whether that is as recent as the series' schedule allows.

interface Item { series_id: string; category: string; title: string; units: string | null; frequency: string | null; seasonal_adjustment: string | null; notes: string | null; latest: { d: string; v: number; p: string | null } | null; previous: { d: string; v: number } | null; freshness: { state: string; age_days: number | null; rule: string } }
const GROUPS: [string, string][] = [['inflation', 'Inflation'], ['rates', 'Interest rates and yields'], ['labour', 'Labour market'], ['activity', 'Economic activity'], ['credit', 'Financial conditions'], ['fx', 'Currencies'], ['india', 'India']];
const STATE: Record<string, [string, string]> = { fresh: ['o', 'current'], delayed: ['i', 'delayed'], stale: ['r', 'stale'], unavailable: ['m', 'no data'], provider_error: ['r', 'update failed'] };

export default function Macro() {
  const m = useApi<{ configured: boolean; items: Item[]; terms: string; notice: string }>('/v1/macro');
  if (m.loading && !m.data) return <Loading lines={8} />;
  if (m.error) return <Problem error={m.error} retry={m.reload} />;
  const d = m.data!;
  return (
    <>
      <h1>Macro</h1>
      <p className="mu">{d.notice}</p>
      {!d.configured && <p className="err">Macro data is not connected in this installation.</p>}
      {GROUPS.map(([g, title]) => {
        const rows = d.items.filter((i) => i.category === g);
        if (!rows.length) return null;
        return (
          <section className="card" key={g}>
            <h2>{title}</h2>
            <div className="wrap"><table className="term-table"><thead><tr><th scope="col" style={{ textAlign: 'left' }}>Series</th><th scope="col">Latest</th><th scope="col">Units</th><th scope="col">Period</th><th scope="col">Previous</th><th scope="col">Frequency</th><th scope="col">Status</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.series_id}>
                  <td style={{ textAlign: 'left' }}><a href={`/app/macro/${r.series_id}`}>{r.title === r.series_id ? r.series_id : r.title}</a></td>
                  <td className="num">{r.latest ? r.latest.v.toLocaleString('en-IN', { maximumFractionDigits: 3 }) : '—'}</td>
                  <td>{r.units ?? ''}</td>
                  <td>{r.latest?.d ?? '—'}</td>
                  <td className="num">{r.previous ? r.previous.v.toLocaleString('en-IN', { maximumFractionDigits: 3 }) : '—'}</td>
                  <td>{r.frequency ?? ''}</td>
                  <td><span className={`t ${STATE[r.freshness.state]?.[0] ?? 'm'}`} title={r.freshness.rule}>{STATE[r.freshness.state]?.[1] ?? r.freshness.state}</span></td>
                </tr>
              ))}</tbody></table></div>
          </section>
        );
      })}
      <p className="mu">{d.terms}</p>
    </>
  );
}
