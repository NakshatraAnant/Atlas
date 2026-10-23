'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApp } from '@/components/providers';
import { Loading, Problem, useApi } from '@/components/ui';

// Import financial statements you obtained yourself (annual reports, exchange filings). The free price
// provider has no fundamentals and ATLAS has no licence to supply them; nothing here is pre-filled.

interface Template { header: string; line_items: Record<string, { statement: string; label: string; per_share?: boolean }>; units: string[]; example: string; note: string }
interface Preview { valid: number; rejected: number; errors: { line: number; reasons: string[] }[]; sample: { instrument: string; period_end: string; line_item: string; value_inr: number }[] }

export default function Statements() {
  const { toast } = useApp();
  const t = useApi<Template>('/v1/research/fundamentals/template');
  const mine = useApi<{ instruments: { instrument: string; rows: number; periods: number; latest_period: string; imported_at: string }[] }>('/v1/research/fundamentals');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const run = async (path: string) => {
    setErr(null);
    try {
      if (path.endsWith('preview')) setPreview(await api<Preview>(path, { body: { csv } }));
      else {
        const r = await api<{ imported: number; changed: number }>(path, { body: { csv } });
        toast(`${r.imported} rows imported (${r.changed} new or changed)`);
        setCsv('');
        setPreview(null);
        mine.reload();
      }
    } catch (e) {
      setErr(e as ApiError);
    }
  };
  const remove = async (instrument: string) => {
    await api(`/v1/research/fundamentals?instrument=${encodeURIComponent(instrument)}`, { method: 'DELETE' });
    mine.reload();
  };
  if (t.loading && !t.data) return <Loading lines={6} />;
  if (t.error) return <Problem error={t.error} retry={t.reload} />;
  return (
    <>
      <p><a href="/app/equities">← Indian equities</a></p>
      <h1>Financial statements you import</h1>
      <p>ATLAS’s free price provider does not include company fundamentals, and ATLAS holds no licence to supply them. You can import figures from documents you obtained yourself (annual reports, results filings). They stay private to you, every row cites its source, and ratios are computed only from what you import.</p>
      <section className="card">
        <h2>Your imported statements</h2>
        {mine.data?.instruments.length ? <ul>{mine.data.instruments.map((x) => { const [ex, sym] = x.instrument.split(':'); return <li key={x.instrument}><a href={`/app/equities/${ex}/${encodeURIComponent(sym!)}`}>{x.instrument}</a>: {x.rows} rows, {x.periods} periods, latest {String(x.latest_period).slice(0, 10)} <button className="link" onClick={() => remove(x.instrument)}>Delete</button></li>; })}</ul> : <p className="mu">None yet.</p>}
      </section>
      <section className="card">
        <h2>Import a CSV</h2>
        <p className="mu">{t.data!.note}</p>
        <p>Header: <code>{t.data!.header}</code>. Units: {t.data!.units.join(', ')} (values are stored in rupees). Every row must pass, or nothing is imported.</p>
        <details><summary>Line items</summary><ul>{Object.entries(t.data!.line_items).map(([k, v]) => <li key={k}><code>{k}</code>: {v.label} ({v.statement}{v.per_share ? ', unit inr' : ''})</li>)}</ul></details>
        <label className="field">CSV text<textarea rows={8} value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); }} placeholder={t.data!.example} /></label>
        <label className="field">…or choose a file<input type="file" accept=".csv,text/csv" onChange={async (e) => { const file = e.target.files?.[0]; if (file) { setCsv(await file.text()); setPreview(null); } }} /></label>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn ghost" disabled={!csv} onClick={() => run('/v1/research/fundamentals/preview')}>Check</button>
          <button className="btn" disabled={!preview || preview.rejected > 0 || preview.valid === 0} onClick={() => run('/v1/research/fundamentals/import')}>Import {preview?.valid ?? ''} rows</button>
        </div>
        {preview && <p>{preview.valid} rows valid, {preview.rejected} rejected.</p>}
        {preview?.errors.length ? <ul className="err">{preview.errors.map((e) => <li key={e.line}>Line {e.line}: {e.reasons.join('; ')}</li>)}</ul> : null}
        <Problem error={err} />
      </section>
    </>
  );
}
