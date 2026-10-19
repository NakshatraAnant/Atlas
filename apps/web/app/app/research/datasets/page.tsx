'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Empty, Loading, Problem, useApi } from '@/components/ui';

const FIELDS = ['date', 'open', 'high', 'low', 'close', 'volume'] as const;
type Mapping = Partial<Record<(typeof FIELDS)[number], string>>;
interface Preview { headers: string[]; suggested_mapping: Mapping; rows: number; sample_report: any; label: string }
interface Report { rows_in: number; rows_valid: number; rows_rejected: number; issues: { row: number; reasons: string[] }[]; first_date: string | null; last_date: string | null; checks: string[] }
interface Detail { dataset_id: string; name: string; instrument_label: string; currency: string; source_description: string; report: Report; prices: { trade_date: string; close: number }[]; analysis: { sessions: number; total_return_pct: number | null; cagr_pct: number | null; volatility_20d_annualised_pct: number | null; max_drawdown_pct: number | null; sma_50: number | null; sma_200: number | null; caveats: string[] }; label: string }

const n = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? 'not available' : x.toLocaleString('en-IN', { maximumFractionDigits: d }));

export default function Datasets() {
  const list = useApi<{ datasets: { dataset_id: string; name: string; instrument_label: string; rows_valid: number; first_date: string; last_date: string }[]; label: string }>('/v1/datasets');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [meta, setMeta] = useState({ name: '', instrument_label: '', source_description: '', rights_attested: false });
  const [report, setReport] = useState<Report | null>(null);
  const [open, setOpen] = useState<Detail | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const onFile = async (f: File | undefined) => {
    setErr(null); setPreview(null); setReport(null);
    if (!f) return;
    if (f.size > 2_000_000) return setErr(new ApiError({ status: 400, detail: 'Files up to 2 MB are supported.' }));
    if (!/\.csv$/i.test(f.name)) return setErr(new ApiError({ status: 400, detail: 'Upload a .csv file (export from a spreadsheet with "Save as CSV").' }));
    const text = await f.text();
    setCsv(text);
    try {
      const p = await api<Preview>('/v1/datasets/preview', { body: { csv: text } });
      setPreview(p);
      setMapping(p.suggested_mapping);
      setMeta((m) => ({ ...m, name: m.name || f.name.replace(/\.csv$/i, '') }));
    } catch (e) { setErr(e as ApiError); }
  };
  const save = async () => {
    setErr(null);
    try {
      const r = await api<{ dataset_id: string; report: Report }>('/v1/datasets', { body: { csv, mapping, ...meta } });
      setReport(r.report);
      await list.reload();
      setOpen(await api<Detail>(`/v1/datasets/${r.dataset_id}`));
    } catch (e) {
      const p = (e as ApiError).problem;
      if (p?.report) setReport(p.report as Report);
      setErr(e as ApiError);
    }
  };
  return (
    <div className="narrow" style={{ maxWidth: 900, margin: '0 auto' }}>
      <p><a href="/app/research">← My research</a></p>
      <h1>Your own data</h1>
      <p>Upload daily prices you are entitled to use (for example, an export from your broker) and analyse them with ATLAS&apos;s calculations. {list.data?.label}</p>
      <section className="card" aria-labelledby="up-h">
        <h2 id="up-h">Upload a CSV</h2>
        <label className="field">CSV file (up to 2 MB; columns for date, open, high, low, close and optionally volume)
          <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        {preview && (
          <>
            <p className="mu">{preview.rows} data rows found. Check the column mapping:</p>
            <div className="row">
              {FIELDS.map((f) => (
                <label key={f} className="field">{f}{f === 'volume' ? ' (optional)' : ''}
                  <select value={mapping[f] ?? ''} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value || undefined })}>
                    <option value="">Not mapped</option>
                    {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div className="row">
              <label className="field">Dataset name<input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></label>
              <label className="field">Instrument<input value={meta.instrument_label} onChange={(e) => setMeta({ ...meta, instrument_label: e.target.value })} placeholder="e.g. company or fund name" /></label>
            </div>
            <label className="field">Where the data came from<input value={meta.source_description} onChange={(e) => setMeta({ ...meta, source_description: e.target.value })} placeholder="e.g. my broker's contract-note export" style={{ width: '100%' }} /></label>
            <label style={{ display: 'flex', gap: 8, margin: '10px 0' }}><input type="checkbox" checked={meta.rights_attested} onChange={(e) => setMeta({ ...meta, rights_attested: e.target.checked })} /> <span>I am entitled to use this data for my own analysis. ATLAS keeps it private to my account and does not share it or send it to an external AI model.</span></label>
            <button className="btn" disabled={!meta.rights_attested || !meta.name || !meta.instrument_label || meta.source_description.length < 3} onClick={() => void save()}>Validate and save</button>
          </>
        )}
        <Problem error={err} />
        {report && (
          <div className={report.rows_rejected ? 'warn' : 'okbox'} role="status">
            <p><strong>{report.rows_valid} of {report.rows_in} rows passed validation{report.rows_rejected ? `; ${report.rows_rejected} were rejected and not saved` : ''}.</strong> {report.first_date && `${report.first_date} to ${report.last_date}.`}</p>
            {report.issues.length > 0 && <ul>{report.issues.slice(0, 20).map((i) => <li key={i.row}>Row {i.row}: {i.reasons.join('; ')}</li>)}</ul>}
            <details><summary>Checks applied</summary><ul>{report.checks.map((c) => <li key={c}>{c}</li>)}</ul></details>
          </div>
        )}
      </section>
      <section className="card" aria-labelledby="mine-h">
        <h2 id="mine-h">Your datasets</h2>
        {list.loading ? <Loading lines={2} /> : list.error ? <Problem error={list.error} /> : list.data!.datasets.length === 0 ? <Empty>No datasets yet.</Empty> : (
          <ul>{list.data!.datasets.map((d) => <li key={d.dataset_id}><button className="link" onClick={async () => setOpen(await api<Detail>(`/v1/datasets/${d.dataset_id}`))}>{d.name}</button> <span className="mu">{d.instrument_label} · {d.rows_valid} sessions · {d.first_date} to {d.last_date}</span></li>)}</ul>
        )}
      </section>
      {open && (
        <section className="card" aria-labelledby="an-h">
          <h2 id="an-h">{open.name}: analysis <span className="badge-syn" style={{ background: 'var(--ev)' }}>User-provided</span></h2>
          <p className="mu">{open.instrument_label} · {open.currency} · source: {open.source_description}</p>
          <table><caption>Calculated by ATLAS from your uploaded closes</caption><tbody>
            <tr><th scope="row">Sessions</th><td>{open.analysis.sessions}</td></tr>
            <tr><th scope="row">Total return</th><td>{n(open.analysis.total_return_pct)}%</td></tr>
            <tr><th scope="row">CAGR</th><td>{open.analysis.cagr_pct === null ? 'not shown (needs at least one year)' : `${n(open.analysis.cagr_pct)}%`}</td></tr>
            <tr><th scope="row">Volatility (20 sessions, annualised)</th><td>{open.analysis.volatility_20d_annualised_pct === null ? 'not available' : `${n(open.analysis.volatility_20d_annualised_pct)}%`}</td></tr>
            <tr><th scope="row">Maximum drawdown</th><td>{n(open.analysis.max_drawdown_pct)}%</td></tr>
            <tr><th scope="row">SMA 50 / SMA 200</th><td>{n(open.analysis.sma_50)} / {n(open.analysis.sma_200)}</td></tr>
          </tbody></table>
          <ul className="mu">{open.analysis.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
          <p className="mu">{open.label}</p>
          <button className="btn s" onClick={async () => { await api(`/v1/datasets/${open.dataset_id}`, { method: 'DELETE' }); setOpen(null); await list.reload(); }}>Delete this dataset</button>
        </section>
      )}
    </div>
  );
}
