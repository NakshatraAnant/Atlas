'use client';
import { Loading, Problem, useApi } from '@/components/ui';
import { formatIstDateTime } from '@/lib/format';
import { useApp } from '@/components/providers';

interface Assessment { provider_id: string; provider: string; datasets: string[]; site: string; terms_url: string; assessed_on: string; automated_retrieval: string; local_retention: string; commercial_display: string; redistribution: string; finding: string; atlas_action: string; next_step: string }
interface Health {
  generated_at: string;
  data_mode: 'synthetic' | 'mixed' | 'real';
  real_data: { connected: boolean; summary: string };
  coverage: { companies: { total: number; synthetic: number; real: number }; prices: { first: string | null; last: string | null; days: number; rows: number; expected_trading_days: number; missing_trading_days: number; recent_missing_dates: string[] } };
  sources: { source_id: string; provider: string; dataset: string; is_synthetic: boolean; status: string; last_success_at: string | null; last_data_date: string | null; schedule: string; licence_status: string | null; freshness: { stale: boolean; label: string } | null }[];
  ingestion: { last_7_days: { status: string; n: number; rows_valid: number; rows_quarantined: number }[]; recent_runs: { run_id: string; source_id: string; dataset: string; data_date: string | null; status: string; started_at: string; rows_in: number; rows_valid: number; rows_quarantined: number; error: string }[]; open_quarantined_rows: number };
  scheduler: { jobs: { job_name: string; run_key: string; status: string; started_at: string; error: string }[]; recent_failures: { job_name: string; run_key: string; started_at: string; error: string }[]; how_it_runs: string };
  quality: { issues: { severity: string; status: string; n: number }[] };
  providers: { version: string; assessments: Assessment[]; pending_licences: { counterparty: string; contract_ref: string; status: string; permitted_use: string }[] };
}

const RIGHT: Record<string, string> = { permitted: 'Permitted', prohibited: 'Prohibited', requires_consent: 'Needs written consent', requires_licence: 'Needs a licence', unverified: 'Unverified (treated as not permitted)' };
const tone = (s: string) => (s === 'permitted' || s === 'succeeded' ? 'o' : s === 'prohibited' || s === 'failed' ? 'i' : 'm');

interface Sources { providers: { provider_id: string; name: string; covers: string; attribution: string; frequency: string; status: string; last_update: string | null }[]; datasets: Record<string, Record<string, number>>; not_available: { what: string; why: string }[]; freshness_rule: string }

/** Real-data mode: where the data comes from, how current it is, and what is not available. */
function DataSources() {
  const s = useApi<Sources>('/v1/data-sources');
  if (s.loading && !s.data) return <Loading lines={6} />;
  if (s.error) return <Problem error={s.error} retry={s.reload} />;
  const d = s.data!;
  return (
    <>
      <h1>Data sources</h1>
      <section className="card">
        <div className="wrap"><table className="term-table"><thead><tr><th scope="col" style={{ textAlign: 'left' }}>Source</th><th scope="col" style={{ textAlign: 'left' }}>What it covers</th><th scope="col">Update frequency</th><th scope="col">Status</th><th scope="col">Last update</th></tr></thead>
          <tbody>{d.providers.map((p) => <tr key={p.provider_id}><td style={{ textAlign: 'left' }}>{p.name}<br /><span className="mu">{p.attribution}</span></td><td style={{ textAlign: 'left' }}>{p.covers}</td><td>{p.frequency}</td><td>{p.status}</td><td>{p.last_update ? formatIstDateTime(p.last_update) : '—'}</td></tr>)}</tbody></table></div>
      </section>
      <section className="card">
        <h2>Freshness</h2>
        <ul>{Object.entries(d.datasets).map(([k, v]) => <li key={k}>{k[0]!.toUpperCase() + k.slice(1)}: {Object.entries(v).map(([state, n]) => `${n} ${state.replace('_', ' ')}`).join(', ') || 'no series'}</li>)}</ul>
        <p className="mu">{d.freshness_rule}</p>
      </section>
      <section className="card">
        <h2>Not available</h2>
        <ul>{d.not_available.map((n) => <li key={n.what}><strong>{n.what}</strong>: {n.why}</li>)}</ul>
      </section>
    </>
  );
}

export default function DataHealth() {
  const { me, loading } = useApp();
  if (loading || !me) return <Loading lines={6} />;
  if (me.demo_mode === false) return <DataSources />;
  return <DemoDataHealth />;
}

function DemoDataHealth() {
  const h = useApi<Health>('/v1/data/health');
  if (h.loading) return <Loading lines={8} label="Loading data health" />;
  if (h.error) return <Problem error={h.error} retry={h.reload} />;
  const d = h.data!;
  const p = d.coverage.prices;
  return (
    <>
      <h1>Data health</h1>
      <p className="mu">What data ATLAS holds, where it came from, how fresh and complete it is, and which real-data sources are blocked and why. Generated {formatIstDateTime(d.generated_at)}.</p>
      <section className={`card ${d.real_data.connected ? '' : 'warn'}`} aria-labelledby="mode">
        <h2 id="mode">Data in use: {d.data_mode === 'synthetic' ? 'synthetic development data only' : d.data_mode === 'mixed' ? 'synthetic and real data' : 'real data'}</h2>
        <p>{d.real_data.summary}</p>
      </section>

      <div className="grid2">
        <section className="card" aria-labelledby="cov">
          <h2 id="cov">Coverage</h2>
          <ul>
            <li>Companies with full profiles: {d.coverage.companies.total} ({d.coverage.companies.synthetic} synthetic, {d.coverage.companies.real} real)</li>
            <li>End-of-day prices: {p.first ? `${p.first} to ${p.last}` : 'none'} · {p.rows.toLocaleString('en-IN')} rows on {p.days.toLocaleString('en-IN')} trading days</li>
            <li>Trading days missing in that range: {p.missing_trading_days}{p.recent_missing_dates.length ? ` (latest: ${p.recent_missing_dates.slice(0, 5).join(', ')})` : ''}</li>
            <li>Quarantined price rows awaiting review: {d.ingestion.open_quarantined_rows}</li>
          </ul>
        </section>
        <section className="card" aria-labelledby="sch">
          <h2 id="sch">Scheduler</h2>
          <p className="mu">{d.scheduler.how_it_runs}</p>
          {d.scheduler.jobs.length ? <ul>{d.scheduler.jobs.map((j) => <li key={j.job_name}>{j.job_name}: <span className={`t ${tone(j.status)}`}>{j.status}</span> <span className="mu">{j.run_key} · {formatIstDateTime(j.started_at)}</span>{j.error ? <span className="mu"> · {j.error}</span> : null}</li>)}</ul> : <p className="mu">No scheduled jobs have run yet.</p>}
          {d.scheduler.recent_failures.length > 0 && <><h3>Recent failures</h3><ul>{d.scheduler.recent_failures.map((f) => <li key={`${f.job_name}-${f.run_key}`}>{f.job_name} {f.run_key}: {f.error}</li>)}</ul></>}
        </section>
      </div>

      <section className="card" aria-labelledby="src">
        <h2 id="src">Sources and freshness</h2>
        <div className="wrap"><table><caption className="sr-only">Registered data sources</caption>
          <thead><tr><th scope="col">Dataset</th><th scope="col">Provider</th><th scope="col">Kind</th><th scope="col">Last data</th><th scope="col">Freshness</th><th scope="col">Licence</th></tr></thead>
          <tbody>{d.sources.map((s) => <tr key={s.source_id}><td>{s.dataset}</td><td>{s.provider}</td><td>{s.dataset === 'derived_metrics' ? 'derived' : s.is_synthetic ? 'synthetic' : 'real'}</td><td>{s.last_data_date ?? '—'}</td><td>{s.freshness ? <span className={`t ${s.freshness.stale ? 'i' : 'o'}`}>{s.freshness.label}</span> : '—'}</td><td>{s.licence_status ?? '—'}</td></tr>)}</tbody>
        </table></div>
      </section>

      <section className="card" aria-labelledby="ing">
        <h2 id="ing">Ingestion runs</h2>
        <p>Last 7 days: {d.ingestion.last_7_days.length ? d.ingestion.last_7_days.map((r) => `${r.n} ${r.status} (${r.rows_valid.toLocaleString('en-IN')} rows valid, ${r.rows_quarantined} quarantined)`).join(' · ') : 'no runs'}</p>
        <div className="wrap"><table><caption className="sr-only">Most recent ingestion runs</caption>
          <thead><tr><th scope="col">Started</th><th scope="col">Dataset</th><th scope="col">Data date</th><th scope="col">Status</th><th scope="col">Rows in / valid / quarantined</th><th scope="col">Error</th></tr></thead>
          <tbody>{d.ingestion.recent_runs.map((r) => <tr key={r.run_id}><td>{formatIstDateTime(r.started_at)}</td><td>{r.dataset}</td><td>{r.data_date ?? '—'}</td><td><span className={`t ${tone(r.status)}`}>{r.status}</span></td><td>{r.rows_in} / {r.rows_valid} / {r.rows_quarantined}</td><td>{r.error || '—'}</td></tr>)}</tbody>
        </table></div>
        <p className="mu">Re-running a dataset is an audited admin action (Admin → pipeline, two-step verification required).</p>
      </section>

      <section aria-labelledby="prov">
        <h2 id="prov">Real-data sources: what their terms allow</h2>
        <p className="mu">Assessment {d.providers.version}. These record what each provider's published terms say on the date read; they are not legal advice. ATLAS never fetches from a source that is not permitted.</p>
        {d.providers.assessments.map((a) => (
          <div key={a.provider_id} className="card">
            <h3>{a.provider}</h3>
            <p className="mu">Datasets: {a.datasets.join(', ')} · Terms: <a href={a.terms_url} rel="noreferrer noopener" target="_blank">{a.terms_url}</a> · read {a.assessed_on}</p>
            <ul className="rights">
              <li>Automated retrieval: <span className={`t ${tone(a.automated_retrieval)}`}>{RIGHT[a.automated_retrieval]}</span></li>
              <li>Keeping a local copy: <span className={`t ${tone(a.local_retention)}`}>{RIGHT[a.local_retention]}</span></li>
              <li>Commercial display: <span className={`t ${tone(a.commercial_display)}`}>{RIGHT[a.commercial_display]}</span></li>
              <li>Redistribution: <span className={`t ${tone(a.redistribution)}`}>{RIGHT[a.redistribution]}</span></li>
            </ul>
            <p>{a.finding}</p>
            <p><strong>ATLAS:</strong> {a.atlas_action} {a.next_step !== '—' && <><strong>To unblock:</strong> {a.next_step}</>}</p>
          </div>
        ))}
        {d.providers.pending_licences.length > 0 && (
          <div className="card">
            <h3>Licences being evaluated</h3>
            <ul>{d.providers.pending_licences.map((l) => <li key={`${l.counterparty}-${l.contract_ref}`}>{l.counterparty}: {l.contract_ref} <span className="mu">({l.status}; {l.permitted_use})</span></li>)}</ul>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="q">
        <h2 id="q">Data-quality issues</h2>
        {d.quality.issues.length ? <ul>{d.quality.issues.map((q) => <li key={`${q.severity}-${q.status}`}>{q.severity === 'fail' ? 'Blocking' : 'Warning'} · {q.status}: {q.n}</li>)}</ul> : <p className="mu">No data-quality issues recorded.</p>}
      </section>
    </>
  );
}
