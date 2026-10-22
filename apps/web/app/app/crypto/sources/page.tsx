'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { ago, CryptoNav, Freshness, utc, type Fresh } from '@/components/crypto';
import { useApp } from '@/components/providers';
import { Loading, Problem, useApi } from '@/components/ui';

interface Src { source_id: string; provider: string; category: string; base_url: string; docs_url: string; terms_url: string | null; docs_checked_on: string; auth: string; rate_limit_note: string; budget_per_minute: number; history_note: string; cadence_note: string; attribution: string | null; storage_note: string; known_gaps: string; fallback_source_id: string | null; enabled: boolean; health: string; last_request_at: string | null; last_success_at: string | null; last_import_at: string | null; last_error_at: string | null; last_error: string | null; requests_today: number | null; errors_today: number | null; rate_limited_today: number | null; cache_hits_today: number | null; refused_today: number | null }
interface Health {
  sources: Src[];
  jobs: { type: string; source: string; every_minutes: number; freshness_minutes: number; last_started: string | null; last_status: string | null; last_success: string | null; freshness: Fresh }[];
  coverage: Record<string, number | string | null>;
  series_coverage: { source_id: string; quote_currency: string; series: number; observations: number; earliest: string; latest: string; complete: number }[];
  recent_failures: { job_id: string; job_type: string; source_id: string; started_at: string; error: string }[];
  quarantine: { dataset: string; record_key: string; reasons: string[]; created_at: string; source_id: string }[];
  budgets: Record<string, { limit: number; used: number; remaining: number; backoff_ms: number } | null>;
  live: { state: string; last_message_at: string | null; reconnects: number; dropped_messages: number; last_error: string | null; symbols: string[] } | null;
  ingestion_enabled: boolean; coingecko_key_configured: boolean;
}

const H: Record<string, string> = { healthy: 'o', unknown: 'm', degraded: 'i', rate_limited: 'i', failing: 'r', disabled: 'm' };

export default function Sources() {
  const { me, toast } = useApp();
  const d = useApi<Health>('/v1/crypto/sources');
  const [running, setRunning] = useState<string | null>(null);
  const admin = !!me && ['admin', 'data_ops'].includes(me.profile.role);
  const run = async (type: string) => {
    setRunning(type);
    try {
      const r = await api<{ status: string; records_persisted: number; error: string | null }>(`/admin/v1/crypto/jobs/${type}/run`, { body: {} });
      toast(`${type}: ${r.status}, ${r.records_persisted} records${r.error ? ` (${r.error.slice(0, 80)})` : ''}`);
      d.reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setRunning(null);
    }
  };
  const x = d.data;
  return (
    <>
      <h1 style={{ margin: 0 }}>Digital Assets</h1>
      <CryptoNav />
      {d.loading && !x ? <Loading lines={10} /> : d.error ? <Problem error={d.error} retry={d.reload} /> : x && (
        <>
          {!x.ingestion_enabled && <p className="warn">Scheduled ingestion is off in this environment (CRYPTO_INGESTION=false). Stored data is shown but will not refresh.</p>}
          <p className="mu">CoinGecko Demo key: {x.coingecko_key_configured ? 'configured (higher limit)' : 'not configured (using the keyless public API, about 10–30 calls/min shared per IP; ATLAS uses at most 5/min)'}.</p>
          <section className="card"><h2>Coverage</h2>
            <div className="cx-kpis">{Object.entries(x.coverage).map(([k, v]) => <div key={k} className="cx-kpi"><span className="k">{k.replace(/_/g, ' ')}</span><span className="v" style={{ fontSize: 16 }}>{typeof v === 'string' && v.includes('T') ? v.slice(0, 10) : v ?? '—'}</span></div>)}</div>
            <div className="wrap"><table className="term-table"><caption>Daily price history by source</caption>
              <thead><tr><th scope="col" style={{ textAlign: 'left' }}>Source</th><th scope="col">Quote</th><th scope="col">Series</th><th scope="col">Observations</th><th scope="col">Earliest</th><th scope="col">Latest</th><th scope="col">Backfill complete</th></tr></thead>
              <tbody>{x.series_coverage.map((s) => <tr key={s.source_id + s.quote_currency}><td style={{ textAlign: 'left' }}>{s.source_id}</td><td>{s.quote_currency}</td><td className="num">{s.series}</td><td className="num">{s.observations.toLocaleString('en-US')}</td><td>{s.earliest?.slice(0, 10)}</td><td>{s.latest?.slice(0, 10)}</td><td className="num">{s.complete} / {s.series}</td></tr>)}</tbody>
            </table></div>
          </section>
          <section className="card"><h2>Jobs and freshness</h2>
            <div className="wrap"><table className="term-table">
              <thead><tr><th scope="col" style={{ textAlign: 'left' }}>Job</th><th scope="col" style={{ textAlign: 'left' }}>Source</th><th scope="col">Every</th><th scope="col">Last run</th><th scope="col">Status</th><th scope="col">Last success</th><th scope="col">Freshness</th>{admin && <th scope="col">Manual</th>}</tr></thead>
              <tbody>{x.jobs.map((j) => <tr key={j.type}><td style={{ textAlign: 'left' }}>{j.type}</td><td style={{ textAlign: 'left' }}>{j.source}</td><td>{j.every_minutes >= 60 ? `${j.every_minutes / 60} h` : `${j.every_minutes} min`}</td><td>{ago(j.last_started)}</td><td>{j.last_status ? <span className={`t ${j.last_status === 'succeeded' ? 'o' : j.last_status === 'partial' ? 'i' : 'r'}`}>{j.last_status}</span> : '—'}</td><td>{utc(j.last_success)}</td><td><Freshness f={j.freshness} /></td>{admin && <td><button className="btn s" disabled={!!running} onClick={() => run(j.type)}>{running === j.type ? 'Running…' : 'Run now'}</button></td>}</tr>)}</tbody>
            </table></div>
            <p className="mu">A job is "succeeded" only after its records are validated and stored. "partial" means some items failed (for example a protocol without a fees adapter). {admin ? 'Manual runs are recorded with trigger "manual".' : 'Manual runs need an administrator with two-step verification.'}</p>
          </section>
          <section className="card"><h2>Providers</h2>
            {x.sources.map((s) => (
              <details key={s.source_id} className="qcard">
                <summary><strong>{s.source_id}</strong> <span className={`t ${H[s.health] ?? 'm'}`}>{s.enabled ? s.health : 'disabled'}</span> <span className="mu">{s.provider} · last success {ago(s.last_success_at)} · today {s.requests_today ?? 0} requests, {s.errors_today ?? 0} errors{s.cache_hits_today ? `, ${s.cache_hits_today} cache hits` : ''}{x.budgets[s.source_id] ? ` · budget ${x.budgets[s.source_id]!.used}/${x.budgets[s.source_id]!.limit} this minute` : ''}</span></summary>
                <dl className="term-kv" style={{ gridTemplateColumns: 'minmax(140px, 1fr) 3fr' }}>
                  <dt>Category / auth</dt><dd style={{ textAlign: 'left', fontWeight: 400 }}>{s.category} · {s.auth.replace('_', ' ')}</dd>
                  <dt>Limits</dt><dd style={{ textAlign: 'left', fontWeight: 400 }}>{s.rate_limit_note} ATLAS budget: {s.budget_per_minute}/min.</dd>
                  <dt>History</dt><dd style={{ textAlign: 'left', fontWeight: 400 }}>{s.history_note}</dd>
                  <dt>Cadence</dt><dd style={{ textAlign: 'left', fontWeight: 400 }}>{s.cadence_note}</dd>
                  <dt>Storage and terms</dt><dd style={{ textAlign: 'left', fontWeight: 400 }}>{s.storage_note}{s.attribution ? ` Attribution: ${s.attribution}.` : ''}</dd>
                  <dt>Known gaps</dt><dd style={{ textAlign: 'left', fontWeight: 400 }}>{s.known_gaps}</dd>
                  <dt>Fallback</dt><dd style={{ textAlign: 'left', fontWeight: 400 }}>{s.fallback_source_id ?? 'none'}</dd>
                  <dt>Documentation</dt><dd style={{ textAlign: 'left', fontWeight: 400 }}><a href={s.docs_url.startsWith('http') ? s.docs_url : '#'} target="_blank" rel="noreferrer noopener">{s.docs_url}</a> (checked {s.docs_checked_on}){s.terms_url && <> · <a href={s.terms_url} target="_blank" rel="noreferrer noopener">terms</a></>}</dd>
                  <dt>Last error</dt><dd style={{ textAlign: 'left', fontWeight: 400 }}>{s.last_error ? `${utc(s.last_error_at)}: ${s.last_error}` : 'none'}</dd>
                  <dt>Last import</dt><dd style={{ textAlign: 'left', fontWeight: 400 }}>{utc(s.last_import_at)}</dd>
                </dl>
              </details>
            ))}
          </section>
          <div className="grid2">
            <section className="card"><h2>WebSocket feed</h2>
              {x.live ? <p>State <strong>{x.live.state}</strong> · last message {ago(x.live.last_message_at)} · {x.live.reconnects} reconnects · {x.live.dropped_messages} malformed messages dropped{x.live.last_error ? ` · last error: ${x.live.last_error}` : ''}. Pairs: {x.live.symbols.join(', ')}.</p> : <p className="mu">Not running.</p>}
            </section>
            <section className="card"><h2>Recent failures and quarantine</h2>
              {x.recent_failures.length ? <ul>{x.recent_failures.map((f) => <li key={f.job_id}>{utc(f.started_at)} <strong>{f.job_type}</strong>: {f.error?.slice(0, 200)}</li>)}</ul> : <p className="mu">No failed jobs.</p>}
              {x.quarantine.length ? <ul>{x.quarantine.map((q, i) => <li key={i}>{utc(q.created_at)} {q.source_id}/{q.dataset}: {q.reasons.join(', ')}</li>)}</ul> : <p className="mu">Nothing quarantined.</p>}
            </section>
          </div>
        </>
      )}
    </>
  );
}
