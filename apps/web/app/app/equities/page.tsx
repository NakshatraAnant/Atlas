'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApp } from '@/components/providers';
import { Classification } from '@/components/research';
import { Loading, Problem, useApi } from '@/components/ui';

// Indian equities, real data only. Shows which providers are configured, what each is allowed to do,
// what has been imported, and every import job with its counts. Synthetic development companies are
// listed elsewhere (Companies) and are never mixed in here.

interface Status {
  providers: { provider_id: string; name: string; docs_url: string; terms_url: string; docs_checked_on: string; coverage_note: string; limits_note: string; licence_note: string; health: string; configured: boolean; env: string; last_success_at: string | null; last_error_at: string | null; last_error: string | null; last_error_category: string | null }[];
  instruments: { exchange: string; symbol: string; name: string | null; kind: string; provider_id: string; classification: string; basis: string; first_date: string | null; last_date: string | null; observations: number; last_import_at: string | null }[];
  jobs: { job_id: string; provider_id: string; dry_run: boolean; status: string; started_at: string; received: number; stored: number; unchanged: number; corrected: number; rejected: number; error: string | null; error_category: string | null; detail: { symbol?: string; exchange?: string } }[];
  counts: { instruments: number; prices: number; quarantined: number; revisions: number };
  classification: Record<string, string>;
  market_status_note: string;
  synthetic_notice: string;
}

export default function Equities() {
  const { me, toast } = useApp();
  const s = useApi<Status>('/v1/equity/status');
  const admin = !!me && ['admin', 'data_ops'].includes(me.profile.role);
  const [f, setF] = useState({ provider: 'eodhd', exchange: 'NSE', symbol: '', kind: 'equity', name: '', provider_symbol: '', dry_run: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [last, setLast] = useState<Record<string, unknown> | null>(null);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<Record<string, unknown>>('/admin/v1/equity/import', { body: { ...f, name: f.name || undefined, provider_symbol: f.provider_symbol || undefined } });
      setLast(r);
      toast(`Import ${r.status}`);
      s.reload();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  };
  if (s.loading && !s.data) return <Loading lines={8} />;
  if (s.error) return <Problem error={s.error} retry={s.reload} />;
  const d = s.data!;
  const anyConfigured = d.providers.some((p) => p.configured);
  return (
    <>
      <h1>Indian equities: real data</h1>
      <p className="warn">{d.synthetic_notice}</p>
      {!anyConfigured && <div className="err" role="status"><p><strong>No provider is configured, so no real Indian prices can be imported.</strong> ATLAS cannot create provider accounts for you. To enable this:</p><ol><li>Create your own free key with EODHD (NSE end-of-day, with split- and dividend-adjusted closes) or Alpha Vantage (BSE, latest 100 days on free keys), and read and accept their terms.</li><li>Add <code>EODHD_API_TOKEN=…</code> or <code>ALPHAVANTAGE_API_KEY=…</code> to <code>.env.local</code> (never commit it).</li><li>Restart ATLAS (<code>node scripts/atlas.mjs restart</code>), then import here as an administrator. Imported instruments refresh daily.</li></ol></div>}
      <section className="card">
        <h2>Providers</h2>
        {d.providers.map((p) => (
          <details key={p.provider_id} className="qcard" open={!p.configured}>
            <summary><strong>{p.name}</strong> <span className={`t ${p.health === 'healthy' ? 'o' : p.health === 'not_configured' ? 'm' : 'r'}`}>{p.health.replace(/_/g, ' ')}</span> <span className="mu">{p.configured ? 'key configured' : `set ${p.env}`}</span></summary>
            <p><strong>Coverage:</strong> {p.coverage_note}</p>
            <p><strong>Limits:</strong> {p.limits_note}</p>
            <p><strong>Licence:</strong> {p.licence_note}</p>
            <p className="mu">Docs checked {p.docs_checked_on}: <a href={p.docs_url} target="_blank" rel="noreferrer noopener">documentation</a> · <a href={p.terms_url} target="_blank" rel="noreferrer noopener">terms</a>{p.last_error ? ` · last error (${p.last_error_category}) ${p.last_error_at?.slice(0, 16)}: ${p.last_error}` : ''}</p>
          </details>
        ))}
        <p className="mu">{d.market_status_note}</p>
      </section>
      <section className="card">
        <h2>Imported instruments</h2>
        <p className="mu">{d.counts.instruments} instruments · {d.counts.prices} stored daily rows · {d.counts.revisions} corrections recorded · {d.counts.quarantined} rows quarantined.</p>
        {d.instruments.length ? (
          <div className="wrap"><table className="term-table"><thead><tr><th scope="col" style={{ textAlign: 'left' }}>Instrument</th><th scope="col">Data</th><th scope="col">Basis</th><th scope="col">Provider</th><th scope="col">Coverage</th><th scope="col">Rows</th><th scope="col">Last import</th></tr></thead>
            <tbody>{d.instruments.map((i) => <tr key={`${i.exchange}${i.symbol}${i.basis}`}><td style={{ textAlign: 'left' }}>{i.exchange}:{i.symbol} <span className="mu">{i.name}</span></td><td><Classification c={i.classification} /></td><td>{i.basis === 'raw' ? 'raw (as traded)' : 'adjusted (splits + dividends)'}</td><td>{i.provider_id}</td><td>{i.first_date} → {i.last_date}</td><td className="num">{i.observations}</td><td>{i.last_import_at?.slice(0, 16) ?? '—'}</td></tr>)}</tbody></table></div>
        ) : <p className="mu">Nothing imported yet.</p>}
        <h3>What the labels mean</h3>
        <ul>{Object.entries(d.classification).map(([k, v]) => <li key={k}><Classification c={k} /> {v}</li>)}</ul>
        <p className="mu">Use imported instruments in the <a href="/app/research-hub">Research hub</a> (workbench, portfolios, alerts, reports). Raw series give price returns only; adjusted series approximate total return.</p>
      </section>
      {admin && (
        <section className="card">
          <h2>Import (administrators)</h2>
          <div className="cx-filters">
            <label className="field">Provider<select value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value, exchange: e.target.value === 'alphavantage' ? 'BSE' : 'NSE' })}><option value="eodhd">EODHD</option><option value="alphavantage">Alpha Vantage</option></select></label>
            <label className="field">Exchange<select value={f.exchange} onChange={(e) => setF({ ...f, exchange: e.target.value })}>{(f.provider === 'eodhd' ? ['NSE', 'INDEX'] : ['BSE']).map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="field">Symbol<input value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase() })} placeholder="e.g. RELIANCE" /></label>
            <label className="field">Kind<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="equity">Equity</option><option value="index">Index</option></select></label>
            <label className="field">Name (optional)<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label className="field">Provider symbol (indices)<input value={f.provider_symbol} onChange={(e) => setF({ ...f, provider_symbol: e.target.value })} placeholder="only if not SYMBOL.NSE" /></label>
            <label className="row" style={{ gap: 6, alignItems: 'center' }}><input type="checkbox" checked={f.dry_run} onChange={(e) => setF({ ...f, dry_run: e.target.checked })} />Dry run (validate only)</label>
            <button className="btn" disabled={!f.symbol || busy} onClick={run}>{busy ? 'Importing…' : f.dry_run ? 'Validate' : 'Import'}</button>
          </div>
          <Problem error={err} />
          {last && <pre className="qcard" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(last, null, 2)}</pre>}
        </section>
      )}
      <section className="card">
        <h2>Import jobs</h2>
        {d.jobs.length ? <div className="wrap"><table className="term-table"><thead><tr><th scope="col">Started</th><th scope="col">Instrument</th><th scope="col">Status</th><th scope="col">Received</th><th scope="col">Stored</th><th scope="col">Unchanged</th><th scope="col">Corrected</th><th scope="col">Rejected</th><th scope="col" style={{ textAlign: 'left' }}>Error</th></tr></thead>
          <tbody>{d.jobs.map((j) => <tr key={j.job_id}><td>{j.started_at.slice(0, 16)}{j.dry_run ? ' (dry run)' : ''}</td><td>{j.detail.exchange}:{j.detail.symbol}</td><td><span className={`t ${j.status === 'succeeded' ? 'o' : j.status === 'partial' ? 'i' : 'r'}`}>{j.status}</span></td><td className="num">{j.received}</td><td className="num">{j.stored}</td><td className="num">{j.unchanged}</td><td className="num">{j.corrected}</td><td className="num">{j.rejected}</td><td style={{ textAlign: 'left' }}>{j.error ? `${j.error_category}: ${j.error}` : ''}</td></tr>)}</tbody></table></div> : <p className="mu">No imports yet.</p>}
      </section>
    </>
  );
}
