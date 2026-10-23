'use client';
import { useParams } from 'next/navigation';
import { MiniLine } from '@/components/crypto';
import { Classification } from '@/components/research';
import { Loading, Problem, useApi } from '@/components/ui';
import { Fresh } from '@/components/commodity';

// One commodity series: chart of stored observations, changes, volatility at the series' own frequency,
// seasonality, correlations with series of the same frequency, and full provenance.

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);
const cls = (v: number | null | undefined) => (v === null || v === undefined ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : '');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function CommoditySeries() {
  const p = useParams<{ source: string; code: string }>();
  const r = useApi<any>(`/v1/commodities/series/${p.source}/${p.code}`, [p.source, p.code]);
  if (r.loading && !r.data) return <Loading lines={8} />;
  if (r.error) return <><p><a href="/app/commodities">← Commodities</a></p><Problem error={r.error} retry={r.reload} /></>;
  const d = r.data;
  const s = d.series;
  const a = d.analysis;
  return (
    <>
      <p><a href="/app/commodities">← Commodities</a></p>
      <h1>{s.name}</h1>
      <p><Classification c={s.classification} /> {s.price_type.replace('_', ' ')} · {s.frequency} · {s.unit} · <Fresh f={d.freshness} /></p>
      {!a ? <section className="card"><p>{d.empty_reason}</p></section> : (
        <>
          <section className="card">
            <div className="cx-kpis">
              <div className="cx-kpi"><span className="k">Last ({a.stats.last_date})</span><span className="v">{a.stats.last.toLocaleString('en-IN', { maximumFractionDigits: 3 })}</span><span className="s">{s.unit}</span></div>
              {(['m1', 'm3', 'y1', 'y5'] as const).map((k) => <div className="cx-kpi" key={k}><span className="k">{{ m1: '1 month', m3: '3 months', y1: '1 year', y5: '5 years' }[k]}</span><span className={`v ${cls(a.stats.change[k])}`}>{pct(a.stats.change[k])}</span></div>)}
              <div className="cx-kpi"><span className="k">Volatility, 1 year</span><span className="v">{a.stats.vol_1y === null ? '—' : `${(a.stats.vol_1y * 100).toFixed(1)}%`}</span><span className="s">{a.stats.annualisation}; {a.stats.returns_used} returns</span></div>
              <div className="cx-kpi"><span className="k">Max drawdown, 1 year</span><span className="v">{a.stats.max_drawdown_1y === null ? '—' : pct(a.stats.max_drawdown_1y)}</span>{a.stats.drawdown_note && <span className="s">{a.stats.drawdown_note}</span>}</div>
            </div>
            {(a.stats.skipped_gap > 0 || a.stats.skipped_non_positive > 0) && <p className="mu">Left out of the 1-year statistics: {a.stats.skipped_gap} return(s) across a data gap, {a.stats.skipped_non_positive} across a zero or negative price.</p>}
            <MiniLine points={a.chart} title={`${s.name} (${s.unit})`} format={(v) => v.toFixed(2)} />
            <p className="mu">Stored observations only; days without a published value are gaps, not zeros.</p>
          </section>
          <section className="card">
            <h2>Seasonality</h2>
            {a.seasonality.ok ? (
              <>
                <div className="wrap"><table className="term-table"><thead><tr><th scope="col">Month</th>{MONTHS.map((m) => <th scope="col" key={m}>{m}</th>)}</tr></thead>
                  <tbody>
                    <tr><th scope="row">Mean change</th>{a.seasonality.rows.map((x: any) => <td key={x.month} className={`num ${cls(x.mean)}`}>{pct(x.mean)}</td>)}</tr>
                    <tr><th scope="row">Rises</th>{a.seasonality.rows.map((x: any) => <td key={x.month} className="num">{x.positive_share === null ? '—' : `${Math.round(x.positive_share * 100)}%`}</td>)}</tr>
                    <tr><th scope="row">Years</th>{a.seasonality.rows.map((x: any) => <td key={x.month} className="num">{x.years}</td>)}</tr>
                  </tbody></table></div>
                <p className="mu">Basis: {a.seasonality.basis}, last 15 years at most. {a.seasonality.warning ?? 'Describes the past; a seasonal average is not a forecast.'}</p>
              </>
            ) : <p className="mu">{a.seasonality.reason}</p>}
          </section>
          {a.inventory_vs_history && (
            <section className="card">
              <h2>Against the same week of earlier years</h2>
              {a.inventory_vs_history.ok ? <p>Latest {a.inventory_vs_history.latest.toLocaleString('en-IN')} vs mean {a.inventory_vs_history.mean.toLocaleString('en-IN', { maximumFractionDigits: 0 })} ({a.inventory_vs_history.years.join(', ')}); z = {a.inventory_vs_history.z?.toFixed(2) ?? '—'}.</p> : <p className="mu">{a.inventory_vs_history.reason}</p>}
            </section>
          )}
          <section className="card">
            <h2>Correlations ({s.frequency} returns)</h2>
            {a.correlations.length ? <ul>{a.correlations.map((c: any) => <li key={c.series_id}><a href={`/app/commodities/${c.series_id.replace(':', '/')}`}>{c.name}</a>: {c.correlation.toFixed(2)} <span className="mu">({c.observations} shared returns)</span></li>)}</ul> : <p className="mu">No other series of the same frequency has enough shared history yet.</p>}
            <p className="mu">{a.correlation_note}</p>
          </section>
        </>
      )}
      <section className="card">
        <h2>Source</h2>
        <ul>
          <li>{d.provenance.source}; upstream: {s.upstream}</li>
          <li>{s.licence_note}</li>
          <li>Last import: {d.provenance.last_import_at ?? s.last_import_at ?? 'never'}{d.provenance.last_job ? ` (${d.provenance.last_job.status}: ${d.provenance.last_job.stored} new, ${d.provenance.last_job.corrected} corrected, ${d.provenance.last_job.missing_values} days without a value)` : ''}</li>
          <li>Corrections recorded: {d.provenance.revisions}</li>
          {s.frequency === 'daily' && <li>Use it in the <a href="/app/research-hub">Research hub</a> as <code>commodity:{s.series_id}</code> (workbench, portfolios, alerts, reports).</li>}
        </ul>
      </section>
    </>
  );
}
