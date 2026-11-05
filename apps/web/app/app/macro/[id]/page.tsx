'use client';
import { useParams } from 'next/navigation';
import { TsChart } from '@/components/ts-chart';
import { FollowButton } from '@/components/follow-button';
import { Loading, Problem, useApi } from '@/components/ui';

// One macro series: its observations, year-on-year change for index series, revisions FRED has made
// since ATLAS first stored a value, and where every number comes from.

const STATE: Record<string, [string, string]> = { fresh: ['o', 'current'], delayed: ['i', 'delayed'], stale: ['r', 'stale'], unavailable: ['m', 'no data'], provider_error: ['r', 'update failed'] };

export default function MacroSeries() {
  const p = useParams<{ id: string }>();
  const r = useApi<any>(`/v1/macro/series/${encodeURIComponent(String(p.id))}`, [p.id]);
  if (r.loading && !r.data) return <Loading lines={8} />;
  if (r.error) return <><p><a href="/app/macro">← Macro</a></p><Problem error={r.error} retry={r.reload} /></>;
  const d = r.data;
  const s = d.series;
  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb"><a href="/app/macro">Macro</a> › <span aria-current="page">{s.series_id}</span> · <a href={`/app/macro/explorer`}>Compare with another series</a></nav>
      <div className="home-panel-hd"><h1>{s.title}</h1><FollowButton seriesKey={`macro:${s.series_id}`} label={s.title} /></div>
      <p>{s.frequency} · {s.units}{s.seasonal_adjustment ? ` · ${s.seasonal_adjustment}` : ''} · <span className={`t ${STATE[d.freshness.state]?.[0] ?? 'm'}`}>{STATE[d.freshness.state]?.[1] ?? d.freshness.state}</span></p>
      {s.notes && <p className="mu">{s.notes}</p>}
      {!d.latest ? <section className="card"><p>{d.empty_reason}</p></section> : (
        <>
          <section className="card">
            <div className="cx-kpis">
              <div className="cx-kpi"><span className="k">Latest value</span><span className="v">{d.latest.v.toLocaleString('en-IN', { maximumFractionDigits: 4 })}</span><span className="s">{s.units}</span></div>
              <div className="cx-kpi"><span className="k">Period it refers to</span><span className="v">{d.latest.d}</span></div>
              <div className="cx-kpi"><span className="k">Shown in FRED since</span><span className="v">{d.latest.p ?? '—'}</span><span className="s">vintage date of this value</span></div>
              <div className="cx-kpi"><span className="k">Retrieved by ATLAS</span><span className="v">{d.provenance.last_retrieved_at ? new Date(d.provenance.last_retrieved_at).toLocaleDateString('en-IN') : '—'}</span></div>
            </div>
            <TsChart title={s.title} defaultRange={/^d/i.test(s.frequency ?? '') ? '5Y' : 'Max'} gapDays={/^d/i.test(s.frequency ?? '') ? 7 : /^w/i.test(s.frequency ?? '') ? 20 : /^q/i.test(s.frequency ?? '') ? 140 : /^a/i.test(s.frequency ?? '') ? 400 : 70} series={[{ label: s.series_id, unit: s.units ?? '', points: d.observations }]} note={`Source: ${d.provenance.source}`} />
            <p className="mu">{d.freshness.rule}</p>
          </section>
          {d.yoy && d.yoy.length > 1 && (
            <section className="card">
              <h2>Year-on-year change</h2>
              <TsChart title="Change from the same period a year earlier" defaultRange="Max" gapDays={400} zeroLine series={[{ label: 'Year-on-year change', unit: 'fraction (0.03 = 3%)', points: d.yoy }]} />
              <p className="mu">{d.yoy_note}</p>
            </section>
          )}
          <section className="card">
            <h2>Revisions</h2>
            {d.revisions.length ? <ul>{d.revisions.map((x: any, i: number) => <li key={i}>{x.obs_date}: previously {x.previous}{x.previous_published_at ? ` (shown from ${x.previous_published_at})` : ''}, revised {new Date(x.revised_at).toLocaleDateString('en-IN')}</li>)}</ul> : <p className="mu">No revisions since ATLAS first stored this series.</p>}
          </section>
        </>
      )}
      <section className="card">
        <h2>Source</h2>
        <p><a href={d.provenance.url} target="_blank" rel="noreferrer noopener">{d.provenance.source}</a>; FRED last updated the series {d.provenance.source_last_updated ? new Date(d.provenance.source_last_updated).toLocaleString('en-IN') : '—'}.</p>
        <p className="mu">{d.provenance.terms}</p>
      </section>
    </>
  );
}
