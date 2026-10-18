'use client';

import { STANDARD_DISCLOSURE } from '@atlas/shared';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';
import { fmt, MISSING, MISSING_TITLE } from '@/lib/format';
import { useApp } from './providers';

export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const ctrl = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (!path) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    setError(null);
    try {
      setData(await api<T>(path, { signal: c.signal }));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e as ApiError);
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => {
    void load();
    return () => ctrl.current?.abort();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

export function Loading({ lines = 3, label = 'Loading' }: { lines?: number; label?: string }) {
  return <div role="status" aria-label={label}>{Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton" style={{ width: `${90 - i * 12}%` }} />)}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="mu">{children}</p>;
}

export function Problem({ error, retry }: { error: ApiError | Error | null; retry?: () => void }) {
  if (!error) return null;
  const p = (error as ApiError).problem;
  if (p?.status === 402 || (p?.status === 429 && p.upgrade)) {
    return (
      <div className="warn" role="alert">
        <p>{error.message}</p>
        {p.upgrade && <p><a className="btn" href="/pricing">See what {p.upgrade.plan === 'pro' ? 'Pro Research' : 'Plus'} adds</a> <span className="mu">{p.upgrade.adds}</span></p>}
        {typeof p.resets_on === 'string' && <p className="mu">Allowance resets on {p.resets_on}.</p>}
      </div>
    );
  }
  if (p?.status === 401) return <div className="warn" role="alert">Sign in to continue. <a href={`/login?next=${typeof location !== 'undefined' ? encodeURIComponent(location.pathname + location.search) : '/app'}`}>Sign in</a></div>;
  return (
    <div className="err" role="alert">
      <p>{error.message}</p>
      {p?.errors && <ul>{p.errors.map((e) => <li key={e.path}>{e.path}: {e.message}</li>)}</ul>}
      {retry && <button className="btn s" onClick={retry}>Try again</button>}
      {p?.correlation_id && <p className="mu">Reference: {p.correlation_id}</p>}
    </div>
  );
}

/** A number that opens its evidence. Missing values show their distinct label. */
export function Value({ v, unit, missing, evidence, surface, children }: { v?: number | null; unit?: string | null; missing?: string | null; evidence?: string | null; surface?: string; children?: ReactNode }) {
  const { openEvidence } = useApp();
  if ((v === null || v === undefined) && missing) return <span className="mu" title={MISSING_TITLE[missing]}>{MISSING[missing] ?? missing}</span>;
  const text = children ?? fmt(v ?? null, unit);
  if (!evidence) return <span>{text}</span>;
  return <button className="ev" onClick={() => openEvidence(evidence, surface)} aria-label={`${typeof text === 'string' ? text : 'Value'}: open evidence`}>{text}</button>;
}

export function Tag({ kind, children }: { kind: 'observed' | 'calculated' | 'interpretation' | 'possible_explanation' | 'data_note' | string; children?: ReactNode }) {
  const map: Record<string, [string, string]> = { observed: ['o', 'Observed'], calculated: ['c', 'Calculated'], interpretation: ['i', 'Interpretation'], possible_explanation: ['i', 'Possible explanation'], data_note: ['m', 'Data note'] };
  const [c, label] = map[kind] ?? ['m', kind];
  return <span className={`t ${c}`}>{children ?? label}</span>;
}

export function Disclosure() {
  return <p className="disc">{STANDARD_DISCLOSURE.text}{STANDARD_DISCLOSURE.status !== 'approved' && ' (Draft disclosure pending counsel review.)'}</p>;
}

export function Tabs({ tabs, active, onChange }: { tabs: [string, string][]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={active === k} onClick={() => onChange(k)} onKeyDown={(e) => {
          const i = tabs.findIndex((t) => t[0] === active);
          if (e.key === 'ArrowRight') onChange(tabs[(i + 1) % tabs.length]![0]);
          if (e.key === 'ArrowLeft') onChange(tabs[(i - 1 + tabs.length) % tabs.length]![0]);
        }}>{label}</button>
      ))}
    </div>
  );
}

export function Stale({ stale, label }: { stale?: boolean; label?: string }) {
  if (!stale) return <span className="mu">{label ?? 'End of day'}</span>;
  return <span className="t r" title="Data is older than its freshness target">{label ?? 'Stale'}</span>;
}

export function Synthetic() {
  return <span className="badge-syn" title="This environment uses fictional companies and generated figures for development.">Synthetic development data</span>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field">{label}{children}{hint && <span className="mu">{hint}</span>}</label>;
}

export function useToast() {
  return useApp().toast;
}
