'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';

// App-wide state: the signed-in user, the evidence drawer and toasts.

/** Stored display preferences (validated server-side; every key optional). */
export interface DisplayPrefs { theme?: 'dark' | 'light'; home_panels?: string[]; markets?: string[]; notify?: { releases?: boolean; digest?: boolean }; show_streak?: boolean; tour_done?: boolean; goal?: 'learn' | 'track' | 'research'; mode?: 'focus' | 'explore'; persona?: string }

export interface Me {
  profile: { user_id: string; email: string; email_verified_at: string | null; display_name: string | null; role: string; experience_level: string | null; interests: string[]; briefing_email: string; totp_enabled_at: string | null; onboarding_completed_at: string | null; state_code: string | null; is_beta: boolean; display_prefs?: DisplayPrefs };
  plan: { code: 'free' | 'plus' | 'pro'; name: string; status: string; grace_until: string | null; period_end: string | null };
  entitlements: Record<string, number>;
  usage: Record<string, number>;
  usage_resets_on: string;
  mfa_verified: boolean;
  /** Synthetic development data is served (ALLOW_SYNTHETIC_DATA); demo pages carry a persistent warning. */
  demo_mode?: boolean;
}

interface Ctx {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  openEvidence: (id: string, surface?: string) => void;
  toast: (msg: string) => void;
}

const AppCtx = createContext<Ctx>({ me: null, loading: true, refresh: async () => undefined, openEvidence: () => undefined, toast: () => undefined });
export const useApp = () => useContext(AppCtx);

export function Providers({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [evidence, setEvidence] = useState<{ id: string; surface: string } | null>(null);
  const [toastMsg, setToast] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const r = await api<Me | { signed_in: false }>('/v1/me?optional=1');
      setMe('signed_in' in r && r.signed_in === false ? null : (r as Me));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    try {
      const t = localStorage.getItem('atlas-theme');
      if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    } catch {
      /* storage unavailable */
    }
  }, [refresh]);
  const toast = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3500);
  }, []);
  return (
    <AppCtx.Provider value={{ me, loading, refresh, openEvidence: (id, surface = 'unknown') => setEvidence({ id, surface }), toast }}>
      {children}
      {evidence && <EvidenceDrawer id={evidence.id} surface={evidence.surface} onClose={() => setEvidence(null)} />}
      {toastMsg && <div className="toast" role="status" aria-live="polite">{toastMsg}</div>}
    </AppCtx.Provider>
  );
}

interface Evidence {
  evidence_id: string; kind: string; label: string; value: number | null; unit: string | null; period: string | null; as_of: string | null; filed_at: string | null; retrieved_at: string | null;
  source: { source_id: string; provider: string; dataset: string; is_synthetic: boolean; licence_status: string | null; attribution: string | null } | null;
  definition: { code: string; version: number; name: string; formula: string; url: string } | null;
  transformation: string; quality: { status: string; conflict?: { vendor_value: number; xbrl_value: number; tolerance_rule: string; displayed: string } | null };
  restatement: { version: number; original_value: number | null; restated: boolean } | null;
  inputs?: { id: string; label: string; value: number | null }[]; deep_link: string | null;
}

function EvidenceDrawer({ id, surface, onClose }: { id: string; surface: string; onClose: () => void }) {
  const [e, setE] = useState<Evidence | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reported, setReported] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const { toast } = useApp();
  useEffect(() => {
    closeRef.current?.focus();
    api<Evidence>(`/v1/evidence/${encodeURIComponent(id)}?surface=${encodeURIComponent(surface)}`).then(setE).catch((x: ApiError) => setErr(x.message));
    const onKey = (k: KeyboardEvent) => k.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, surface, onClose]);
  const report = async () => {
    try {
      const r = await api<{ ticket_ref: string; triage: string }>('/v1/feedback', { body: { kind: 'data_issue', subject: `Issue with ${e?.label ?? id}`, comment, page: typeof location !== 'undefined' ? location.pathname : undefined, surface, context: { evidence_id: id, dataset: e?.source?.dataset, value: e?.value, period: e?.period } } });
      setReported(`${r.ticket_ref}: ${r.triage}`);
      toast('Issue reported');
    } catch (x) {
      setReported((x as Error).message);
    }
  };
  return (
    <>
      <div className="backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="ev-title">
        <button ref={closeRef} className="btn s" onClick={onClose}>Close</button>
        <h2 id="ev-title">Evidence</h2>
        {err && <div className="err">{err}</div>}
        {!e && !err && <div className="skeleton" />}
        {e && (
          <>
            <p><strong>{e.label}</strong></p>
            {e.source?.is_synthetic && <p><span className="badge-syn">Synthetic development data</span></p>}
            <dl>
              {e.value !== null && <><dt>Value</dt><dd>{e.value.toLocaleString('en-IN', { maximumFractionDigits: 6 })} {e.unit ?? ''}</dd></>}
              <dt>Source</dt><dd>{e.source ? `${e.source.provider} — ${e.source.dataset}` : '—'}{e.source?.attribution ? ` (${e.source.attribution})` : ''}</dd>
              <dt>Licence</dt><dd>{e.source?.licence_status ?? '—'}</dd>
              <dt>Period</dt><dd>{e.period ?? '—'}</dd>
              <dt>As of</dt><dd>{e.as_of ?? '—'}</dd>
              <dt>Filed / published</dt><dd>{e.filed_at ? new Date(e.filed_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST' : '—'}</dd>
              <dt>Retrieved by ATLAS</dt><dd>{e.retrieved_at ? new Date(e.retrieved_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST' : '—'}</dd>
              <dt>Transformation</dt><dd>{e.transformation}</dd>
              {e.definition && <><dt>Definition</dt><dd><a href={e.definition.url}>{e.definition.name} v{e.definition.version}</a>: {e.definition.formula}</dd></>}
              <dt>Quality</dt><dd>{e.quality.status}</dd>
              {e.quality.conflict && <><dt>Source conflict</dt><dd>Vendor {e.quality.conflict.vendor_value} vs XBRL {e.quality.conflict.xbrl_value}. Rule: {e.quality.conflict.tolerance_rule}. Shown: {e.quality.conflict.displayed}.</dd></>}
              {e.restatement?.restated && <><dt>Restatement</dt><dd>Version {e.restatement.version}; originally reported {e.restatement.original_value ?? '—'}</dd></>}
              {e.inputs?.length ? <><dt>Inputs</dt><dd><ul>{e.inputs.slice(0, 12).map((i) => <li key={i.id}>{i.label}: {i.value ?? '—'}</li>)}</ul></dd></> : null}
            </dl>
            {e.deep_link && <p><a href={e.deep_link.startsWith('/v1/') ? e.deep_link : e.deep_link.replace(/^\/app/, '/app')}>Open the underlying view</a></p>}
          </>
        )}
        <h3>Report an issue</h3>
        {reported ? <p className="okbox">{reported}</p> : (
          <>
            <label className="field">What looks wrong? (optional)<textarea rows={3} value={comment} onChange={(x) => setComment(x.target.value)} maxLength={2000} /></label>
            <p><button className="btn s" onClick={report}>Report an issue</button></p>
          </>
        )}
      </aside>
    </>
  );
}
