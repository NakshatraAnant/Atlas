'use client';
import { use } from 'react';
import { Loading, Problem, useApi } from '@/components/ui';
import { formatIstDateTime } from '@/lib/format';

export default function MethodologyPage({ params }: { params: Promise<{ page: string }> }) {
  const { page } = use(params);
  if (page === 'sources') return <Sources />;
  if (page === 'corrections') return <Corrections />;
  return <Doc slug={page} />;
}

function Doc({ slug }: { slug: string }) {
  const d = useApi<{ title: string; sections: { heading: string; body: string }[]; data: any }>(`/v1/methodology/pages/${slug}`);
  if (d.loading) return <Loading />;
  if (d.error) return <Problem error={d.error} />;
  const p = d.data!;
  return (
    <article className="card">
      <h1>{p.title}</h1>
      {p.sections.map((s) => <section key={s.heading} id={s.heading.toLowerCase().replace(/\W+/g, '-')}><h2>{s.heading}</h2><p>{s.body}</p></section>)}
      {slug === 'ai' && (
        <section>
          <h2>Latest evaluation</h2>
          {p.data ? (
            <>
              <p>{p.data.provider} / {p.data.model_id} · prompt {p.data.prompt_version} · tools {p.data.tool_version} · <strong>{p.data.passed ? 'all thresholds passed' : 'thresholds NOT passed'}</strong> · {p.data.finished_at ? formatIstDateTime(p.data.finished_at) : ''}</p>
              <div className="wrap"><table><thead><tr><th scope="col">Metric</th><th scope="col">Result</th><th scope="col">Threshold</th></tr></thead><tbody>{Object.entries(p.data.metrics ?? {}).map(([k, v]) => <tr key={k}><td>{k}</td><td>{typeof v === 'number' ? v.toFixed(4) : String(v)}</td><td>{String((p.data.thresholds ?? {})[k] ?? '—')}</td></tr>)}</tbody></table></div>
            </>
          ) : <p className="mu">No evaluation run has been recorded in this environment yet.</p>}
        </section>
      )}
      {slug === 'backtests' && Array.isArray(p.data) && (
        <section>
          <h2>Cost tables</h2>
          {p.data.map((t: any) => (
            <div key={t.version} className="card">
              <h3>{t.version} {!t.verified_against_current_schedules && <span className="t i">Not yet verified against current schedules</span>}</h3>
              <p>{t.notes}</p>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(t.components, null, 1)}</pre>
            </div>
          ))}
        </section>
      )}
    </article>
  );
}

function Sources() {
  const s = useApi<{ sources: any[]; pending_licences: any[]; coverage: { full_profiles: number; searchable: number } }>('/v1/sources/status');
  if (s.loading) return <Loading />;
  if (s.error) return <Problem error={s.error} />;
  const d = s.data!;
  return (
    <>
      <h1>Data sources and freshness</h1>
      <p className="mu">Generated from pipeline metadata. Coverage: {d.coverage.full_profiles} companies with full profiles; {d.coverage.searchable} searchable.</p>
      <div className="card wrap">
        <table>
          <caption>Datasets</caption>
          <thead><tr><th scope="col">Dataset</th><th scope="col">Provider</th><th scope="col">Schedule</th><th scope="col">Delay</th><th scope="col">Last data</th><th scope="col">Status</th><th scope="col">Licence</th></tr></thead>
          <tbody>{d.sources.map((x) => <tr key={x.source_id}><td>{x.description}{x.is_synthetic && <> <span className="t i">synthetic</span></>}</td><td>{x.provider}</td><td>{x.schedule}</td><td>{x.delay_note}</td><td>{x.last_data_date ?? '—'}</td><td>{x.freshness?.stale ? <span className="t r">{x.freshness.label}</span> : x.status}</td><td>{x.licence_status}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="card">
        <h2>Licences pending</h2>
        <ul>{d.pending_licences.map((l) => <li key={l.contract_ref}><strong>{l.counterparty}</strong> — {l.contract_ref} ({l.status}). {l.permitted_use}</li>)}</ul>
        <p className="mu">Datasets from pending licences are not displayed, exported or sent to any AI provider until a signed licence is recorded.</p>
      </div>
    </>
  );
}

function Corrections() {
  const c = useApi<{ corrections: { correction_id: string; published_at: string; kind: string; title: string; description: string; impact: string }[] }>('/v1/corrections');
  return (
    <>
      <h1>Correction log</h1>
      <p className="mu">Material corrections to data, calculations or AI behaviour, with date and impact. Users with affected saved items are notified.</p>
      {c.loading && <Loading />}
      <Problem error={c.error} />
      {c.data && (c.data.corrections.length
        ? c.data.corrections.map((x) => <div key={x.correction_id} className="card"><h3>{x.title}</h3><p className="mu">{formatIstDateTime(x.published_at)} · {x.kind}</p><p>{x.description}</p><p><strong>Impact:</strong> {x.impact}</p></div>)
        : <p className="mu">No corrections have been published.</p>)}
    </>
  );
}
