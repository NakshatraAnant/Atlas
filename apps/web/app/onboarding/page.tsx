'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Loading, Problem, useApi } from '@/components/ui';
import { useApp } from '@/components/providers';

const INTERESTS = ['IT', 'FMCG', 'Auto', 'Pharma', 'Banks', 'NBFC', 'Metals', 'Capital Goods', 'Chemicals', 'Retail', 'Utilities', 'Materials', 'Insurance', 'Telecom'];

export default function Onboarding() {
  const { me, refresh } = useApp();
  const [step, setStep] = useState(1);
  const [level, setLevel] = useState('intermediate');
  const [interests, setInterests] = useState<string[]>([]);
  const [err, setErr] = useState<Error | null>(null);
  const cov = useApi<{ companies: { company_id: string; short_name: string; sector: string }[] }>(step === 2 ? '/v1/coverage' : null, [step]);
  if (!me) return <Loading />;
  const save = async () => {
    try {
      await api('/v1/me', { method: 'PATCH', body: { experience_level: level, interests } });
      setStep(2);
    } catch (x) {
      setErr(x as Error);
    }
  };
  const finish = async (href: string) => {
    await api('/v1/me', { method: 'PATCH', body: { onboarding_completed: true } }).catch(() => undefined);
    await refresh();
    window.location.href = href;
  };
  const suggestions = (cov.data?.companies ?? []).filter((c) => !interests.length || interests.includes(c.sector)).slice(0, 6);
  return (
    <div className="card" style={{ maxWidth: 760, margin: '16px auto' }}>
      <p className="mu">Step {step} of 2</p>
      {step === 1 && (
        <>
          <h1>How do you research?</h1>
          <fieldset style={{ border: 0, padding: 0 }}>
            <legend>Experience level (sets how much the assistant explains)</legend>
            {[['beginner', 'New to company analysis'], ['intermediate', 'I read results and ratios'], ['advanced', 'I build my own models']].map(([v, l]) => (
              <label key={v} style={{ display: 'block' }}><input type="radio" name="lvl" value={v} checked={level === v} onChange={() => setLevel(v)} /> {l}</label>
            ))}
          </fieldset>
          <fieldset style={{ border: 0, padding: 0, marginTop: 12 }}>
            <legend>Sectors you follow (optional)</legend>
            <div className="row">{INTERESTS.map((s) => <label key={s}><input type="checkbox" checked={interests.includes(s)} onChange={(e) => setInterests(e.target.checked ? [...interests, s] : interests.filter((x) => x !== s))} /> {s}</label>)}</div>
          </fieldset>
          <Problem error={err} />
          <button className="btn" onClick={save}>Continue</button>
        </>
      )}
      {step === 2 && (
        <>
          <h1>Start with a company</h1>
          <p>Open a company page and ask the assistant how its margins changed — then open the evidence for one figure and save the company to your watchlist. This first question does not count against your allowance.</p>
          {cov.loading && <Loading />}
          <div className="grid">{suggestions.map((c) => (
            <div key={c.company_id} className="card" style={{ margin: 0 }}>
              <h3>{c.short_name}</h3><p className="mu">{c.sector}</p>
              <div className="row">
                <button className="btn" onClick={() => finish(`/app/companies/${c.company_id}`)}>Open company</button>
                <button className="btn s" onClick={() => finish(`/app/assistant?onboarding=1&company_id=${c.company_id}&q=${encodeURIComponent(`How did ${c.short_name}'s operating margin change over the last eight quarters?`)}`)}>Ask about margins</button>
              </div>
            </div>
          ))}</div>
          <p><button className="link" onClick={() => finish('/app')}>Skip to Home</button></p>
        </>
      )}
    </div>
  );
}
