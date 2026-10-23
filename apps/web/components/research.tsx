'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

// Shared research building blocks: instrument search and selection, provenance chips, number formats.

export interface InstrumentInfo { key: string; label: string; asset_class: string; classification: string; source: string; basis: string; calendar: string; currency: string; annualisation: number; first: string | null; last: string | null; freshness: string; notes: string[]; observations: number }
interface Hit { key: string; label: string; asset_class: string; classification: string; observations: number }

export const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(d)}%`);
export const num = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));
export const cls = (v: number | null | undefined) => (v === null || v === undefined ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : '');

const CLASS: Record<string, [string, string]> = {
  REAL_VERIFIED: ['o', 'Real, verified'], REAL_UNVERIFIED: ['c', 'Real, single source'], USER_IMPORTED: ['i', 'Your file'], SYNTHETIC_DEMO: ['r', 'Synthetic demo'],
};
export function Classification({ c }: { c: string }) {
  const [k, l] = CLASS[c] ?? ['m', c];
  return <span className={`t ${k}`} title={c}>{l}</span>;
}
export function FreshTag({ f }: { f: string }) {
  return <span className={`t ${f === 'fresh' ? 'o' : 'r'}`}>{f === 'fresh' ? 'Fresh' : f === 'stale' ? 'Stale' : 'Missing'}</span>;
}

/** Search-as-you-type picker over crypto, imported equities and your uploads (synthetic data excluded). */
export function InstrumentPicker({ value, onChange, max = 8, label = 'Instruments' }: { value: string[]; onChange: (v: string[]) => void; max?: number; label?: string }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<{ results: Hit[] }>(`/v1/research/instruments?q=${encodeURIComponent(q)}`, { signal: ctrl.signal }).then((r) => setHits(r.results)).catch(() => undefined);
    }, 200);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);
  const add = (k: string) => { if (!value.includes(k) && value.length < max) onChange([...value, k]); setQ(''); setOpen(false); };
  return (
    <div className="rs-picker">
      <label className="field">{label} ({value.length}/{max})
        <input type="search" value={q} placeholder="Search bitcoin, NSE symbols, your files…" onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' && hits[0]) { e.preventDefault(); add(hits[0].key); } }} aria-expanded={open} aria-controls="rs-hits" />
      </label>
      {open && hits.length > 0 && (
        <ul id="rs-hits" className="rs-hits" role="listbox">
          {hits.slice(0, 12).map((h) => <li key={h.key}><button type="button" role="option" aria-selected={value.includes(h.key)} onClick={() => add(h.key)}>{h.label} <span className="mu">{h.asset_class} · {h.observations} obs</span></button></li>)}
        </ul>
      )}
      <div className="rs-chips">{value.map((k) => <span key={k} className="rs-chip">{k}<button type="button" aria-label={`Remove ${k}`} onClick={() => onChange(value.filter((x) => x !== k))}>×</button></span>)}</div>
    </div>
  );
}

/** Single-instrument picker (chooses the first match). */
export function OnePicker({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return <InstrumentPicker value={value ? [value] : []} onChange={(v) => onChange(v[v.length - 1] ?? '')} max={1} label={label} />;
}

export function InstrumentTable({ items }: { items: InstrumentInfo[] }) {
  return (
    <div className="wrap"><table className="term-table">
      <caption>Instruments and provenance</caption>
      <thead><tr><th scope="col" style={{ textAlign: 'left' }}>Instrument</th><th scope="col">Data</th><th scope="col" style={{ textAlign: 'left' }}>Source and basis</th><th scope="col">Calendar</th><th scope="col">Coverage</th><th scope="col">Freshness</th></tr></thead>
      <tbody>{items.map((i) => <tr key={i.key}><td style={{ textAlign: 'left' }}>{i.label}</td><td><Classification c={i.classification} /></td><td style={{ textAlign: 'left' }}>{i.source}; {i.basis} ({i.currency})</td><td>{i.calendar === 'continuous' ? '24/7 (√365)' : 'sessions (√252)'}</td><td>{i.first?.slice(0, 10) ?? '—'} → {i.last?.slice(0, 10) ?? '—'} ({i.observations})</td><td><FreshTag f={i.freshness} /></td></tr>)}</tbody>
    </table></div>
  );
}
