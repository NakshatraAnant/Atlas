'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Loading, Problem, useApi } from '@/components/ui';

interface Hit { company_id: string; short_name: string; legal_name: string; nse_symbol: string | null; bse_code: string | null; isin: string; sector: string; coverage: string; status: string; matched_on: string }

export default function Companies() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const cov = useApi<{ companies: { company_id: string; short_name: string; sector: string; industry: string; status: string }[]; freeze_note: string }>('/v1/coverage');
  useEffect(() => {
    if (q.trim().length < 1) {
      setHits(null);
      return;
    }
    const c = new AbortController();
    const t = setTimeout(() => {
      api<{ results: Hit[] }>(`/v1/search?q=${encodeURIComponent(q.trim())}&limit=12`, { signal: c.signal }).then((r) => { setHits(r.results); setErr(null); }).catch((e) => { if (e.name !== 'AbortError') setErr(e); });
    }, 150);
    return () => { clearTimeout(t); c.abort(); };
  }, [q]);
  const sectors = new Map<string, { company_id: string; short_name: string; industry: string; status: string }[]>();
  for (const c of cov.data?.companies ?? []) sectors.set(c.sector, [...(sectors.get(c.sector) ?? []), c]);
  return (
    <>
      <h1>Companies</h1>
      <label className="field">Search by name, former name, NSE symbol, BSE code or ISIN
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Kaveri, KAVERIFOOD, 500100" autoFocus aria-controls="results" />
      </label>
      <div id="results" aria-live="polite">
        <Problem error={err} />
        {hits && (hits.length === 0 ? <p className="mu">No company matches “{q}”. Coverage is limited to the companies listed below.</p> : (
          <ul className="card">{hits.map((h) => (
            <li key={h.company_id}>
              {h.coverage === 'full' ? <a href={`/app/companies/${h.company_id}`}>{h.short_name}</a> : <span>{h.short_name}</span>}{' '}
              <span className="mu">{[h.nse_symbol, h.bse_code, h.isin, h.sector].filter(Boolean).join(' · ')}{h.status !== 'listed' ? ` · ${h.status}` : ''}{h.coverage !== 'full' ? ' · not in full coverage yet' : ''}{h.matched_on === 'former_name' ? ' · matched a former name' : ''}</span>
            </li>
          ))}</ul>
        ))}
      </div>
      <h2>Coverage universe</h2>
      {cov.loading ? <Loading /> : cov.error ? <Problem error={cov.error} retry={cov.reload} /> : (
        <>
          <p className="mu">{cov.data!.freeze_note}</p>
          <div className="grid">{[...sectors].sort().map(([s, list]) => (
            <div key={s} className="card" style={{ margin: 0 }}><h3>{s}</h3><ul>{list.map((c) => <li key={c.company_id}><a href={`/app/companies/${c.company_id}`}>{c.short_name}</a>{c.status !== 'listed' && <span className="mu"> · {c.status}</span>}</li>)}</ul></div>
          ))}</div>
        </>
      )}
    </>
  );
}
