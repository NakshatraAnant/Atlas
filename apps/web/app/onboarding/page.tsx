'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Loading, Problem, useApi } from '@/components/ui';
import { useApp } from '@/components/providers';
import { FollowButton } from '@/components/follow-button';

export default function Onboarding() {
  const { me } = useApp();
  if (!me) return <Loading />;
  return me.demo_mode === false ? <RealOnboarding /> : <DemoOnboarding />;
}

const INTERESTS = ['IT', 'FMCG', 'Auto', 'Pharma', 'Banks', 'NBFC', 'Metals', 'Capital Goods', 'Chemicals', 'Retail', 'Utilities', 'Materials', 'Insurance', 'Telecom'];

function DemoOnboarding() {
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

// ───────── Real-data onboarding: goal → markets → one tailored first action ─────────

type Goal = 'learn' | 'track' | 'research';
type Market = 'india' | 'crypto' | 'commodities' | 'us';
const GOALS: { id: Goal; title: string; desc: string; icon: string }[] = [
  { id: 'learn', title: 'Learn how markets work', desc: 'Short courses with 3D charts and labs on real data', icon: '◇' },
  { id: 'track', title: 'Keep up with markets', desc: 'A Home page of the markets you follow, with notices', icon: '◎' },
  { id: 'research', title: 'Research and test ideas', desc: 'Portfolios, backtests, comparisons and reports', icon: '△' },
];
const MARKETS: { id: Market; title: string; desc: string }[] = [
  { id: 'india', title: 'Indian markets', desc: 'NIFTY 50, SENSEX, NIFTY BANK' },
  { id: 'us', title: 'The economy', desc: 'Rates, inflation, jobs, the rupee' },
  { id: 'commodities', title: 'Commodities', desc: 'Oil, gas, metals, crops' },
  { id: 'crypto', title: 'Digital assets', desc: 'Bitcoin, ether and more' },
];
const PERSONAS: { id: string; title: string; desc: string; course: [string, string] }[] = [
  { id: 'student', title: 'Finance student', desc: 'Building foundations', course: ['market-decoder', 'Market Decoder'] },
  { id: 'aspiring_analyst', title: 'Aspiring analyst', desc: 'Preparing for a research role', course: ['equity-detective', 'Equity Detective'] },
  { id: 'equity_researcher', title: 'Equity researcher', desc: 'Analysing companies', course: ['equity-detective', 'Equity Detective'] },
  { id: 'investor', title: 'Investor', desc: 'Managing my own money', course: ['market-decoder', 'Market Decoder'] },
  { id: 'trader', title: 'Trader', desc: 'Testing rules honestly', course: ['signal-engineer', 'Signal Engineer'] },
  { id: 'quant', title: 'Quantitative researcher', desc: 'Data, statistics, backtests', course: ['signal-engineer', 'Signal Engineer'] },
  { id: 'professional', title: 'Finance professional', desc: 'Sharpening my edge', course: ['market-architect', 'Market Architect'] },
  { id: 'learner', title: 'Independent learner', desc: 'Curious about markets', course: ['market-decoder', 'Market Decoder'] },
];
const LEVELS: [string, string][] = [['beginner', 'New to this'], ['intermediate', 'Some experience'], ['advanced', 'Experienced']];
const PANEL_FOR: Record<Market, string> = { india: 'indices', us: 'macro', commodities: 'commodities', crypto: 'crypto' };
const FIRST_LESSON: Record<Market, [string, string]> = { india: ['md-l1', 'How the Indian share market works'], us: ['md-l1', 'How the Indian share market works'], commodities: ['cm-l1', 'What a commodity price actually is'], crypto: ['cd-l1', 'Your first crypto lesson'] };
const SUGGESTED_FOLLOWS: Partial<Record<Market, [string, string]>> = { india: ['macro:DEXINUS', 'Rupee per US dollar'], us: ['macro:DGS10', 'US 10-year Treasury yield'], commodities: ['commodity:fred:DCOILBRENTEU', 'Brent crude oil'] };

function RealOnboarding() {
  const { refresh } = useApp();
  const [step, setStep] = useState(0);
  const [persona, setPersona] = useState<string | null>(null);
  const [level, setLevel] = useState('intermediate');
  const [goal, setGoal] = useState<Goal | null>(null);
  const skip = async () => {
    await api('/v1/me', { method: 'PATCH', body: { onboarding_completed: true, display_prefs: { tour_done: true } } }).catch(() => undefined);
    await refresh();
    window.location.href = '/app';
  };
  const [markets, setMarkets] = useState<Market[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Error | null>(null);
  const toggle = (m: Market) => setMarkets(markets.includes(m) ? markets.filter((x) => x !== m) : [...markets, m]);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const chosen = markets.map((m) => PANEL_FOR[m]);
      const rest = ['indices', 'macro', 'commodities', 'crypto'].filter((p) => !chosen.includes(p));
      const panels = goal === 'learn' ? ['learning', 'attention', 'following', ...chosen, ...rest] : ['attention', 'following', ...chosen, 'learning', ...rest];
      await api('/v1/me', { method: 'PATCH', body: { experience_level: level, display_prefs: { markets, home_panels: panels, goal: goal!, tour_done: true, ...(persona ? { persona } : {}) }, onboarding_completed: true } });
      await refresh();
      setStep(3);
    } catch (x) {
      setErr(x as Error);
    } finally {
      setBusy(false);
    }
  };
  const first = markets[0] ?? 'india';
  const lesson = FIRST_LESSON[first];
  const follows = markets.map((m) => SUGGESTED_FOLLOWS[m]).filter((x): x is [string, string] => !!x).slice(0, 2);
  const primary = goal === 'learn' ? { href: `/app/academy/lesson/${lesson[0]}`, label: `Start: ${lesson[1]}` } : goal === 'research' ? { href: '/app/research-hub', label: 'Open the Research Studio' } : { href: '/app', label: 'Go to your Home' };
  return (
    <div className="ob">
      <ol className="ob-dots" aria-label={`Step ${step + 1} of 4`}>{[0, 1, 2, 3].map((n) => <li key={n} className={n === step ? 'on' : n < step ? 'done' : ''} />)}</ol>
      {step === 0 && (
        <section className="ob-step" key="s0">
          <h1>Welcome. Who are you?</h1>
          <p className="mu">This only shapes suggestions. You can change it later in Settings.</p>
          <div className="ob-options two" role="radiogroup" aria-label="What describes you best">
            {PERSONAS.map((x) => (
              <button key={x.id} role="radio" aria-checked={persona === x.id} className={`ob-option${persona === x.id ? ' on' : ''}`} onClick={() => setPersona(x.id)}>
                <span className="ob-check" aria-hidden="true">{persona === x.id ? '✓' : ''}</span><strong>{x.title}</strong><span className="mu">{x.desc}</span>
              </button>
            ))}
          </div>
          <div className="ob-actions"><button className="link" onClick={() => void skip()}>Skip setup</button><button className="btn btn-cta btn-lg" disabled={!persona} onClick={() => setStep(1)}>Continue <span aria-hidden="true">→</span></button></div>
        </section>
      )}
      {step === 1 && (
        <section className="ob-step" key="s1">
          <h1>What brings you to ATLAS?</h1>
          <p className="mu">We will set things up around it. You can change everything later.</p>
          <div className="ob-options" role="radiogroup" aria-label="Your goal">
            {GOALS.map((g) => (
              <button key={g.id} role="radio" aria-checked={goal === g.id} className={`ob-option${goal === g.id ? ' on' : ''}`} onClick={() => setGoal(g.id)}>
                <span className="ob-icon" aria-hidden="true">{g.icon}</span><strong>{g.title}</strong><span className="mu">{g.desc}</span>
              </button>
            ))}
          </div>
          <div className="ob-level" role="radiogroup" aria-label="Your experience"><span className="mu">Your experience:</span>{LEVELS.map(([v, l]) => <button key={v} role="radio" aria-checked={level === v} className={`chip${level === v ? ' on' : ''}`} onClick={() => setLevel(v)}>{l}</button>)}</div>
          <div className="ob-actions"><button className="btn s" onClick={() => setStep(0)}>Back</button><button className="btn btn-cta btn-lg" disabled={!goal} onClick={() => setStep(2)}>Continue <span aria-hidden="true">→</span></button></div>
        </section>
      )}
      {step === 2 && (
        <section className="ob-step" key="s2">
          <h1>Which markets interest you?</h1>
          <p className="mu">Pick one or more. Home will show these first.</p>
          <div className="ob-options two" role="group" aria-label="Markets">
            {MARKETS.map((m) => (
              <button key={m.id} aria-pressed={markets.includes(m.id)} className={`ob-option${markets.includes(m.id) ? ' on' : ''}`} onClick={() => toggle(m.id)}>
                <span className="ob-check" aria-hidden="true">{markets.includes(m.id) ? '✓' : ''}</span><strong>{m.title}</strong><span className="mu">{m.desc}</span>
              </button>
            ))}
          </div>
          <Problem error={err} />
          <div className="ob-actions">
            <button className="btn s" onClick={() => setStep(1)}>Back</button>
            <button className="btn btn-cta btn-lg" disabled={!markets.length || busy} onClick={() => void save()}>{busy ? 'Saving…' : <>Continue <span aria-hidden="true">→</span></>}</button>
          </div>
        </section>
      )}
      {step === 3 && (
        <section className="ob-step ob-done" key="s3">
          <p className="complete-badge" aria-hidden="true">✓</p>
          <h1>You are set up</h1>
          <p className="mu">{goal === 'learn' ? 'Your first lesson takes about 12 minutes and starts with a short video.' : goal === 'research' ? 'The Research hub has portfolios, walk-forward backtests, a notebook and sourced reports.' : 'Home now leads with the markets you chose.'}</p>
          {follows.length > 0 && goal !== 'research' && (
            <div className="ob-follows"><p><strong>Get notified when new data lands:</strong></p>
              {follows.map(([key, label]) => <span key={key} className="ob-follow">{label} <FollowButton seriesKey={key} label={label} /></span>)}
            </div>
          )}
          <div className="ob-actions center"><a className="btn btn-cta btn-lg" href={primary.href}>{primary.label} <span aria-hidden="true">→</span></a></div>
          {persona && goal !== 'learn' && <p className="mu">Suggested course for you: <a href={`/app/academy/${PERSONAS.find((x) => x.id === persona)!.course[0]}`}>{PERSONAS.find((x) => x.id === persona)!.course[1]}</a></p>}
          <p><a href="/app" className="mu">{goal === 'track' ? '' : 'Or go to Home'}</a></p>
        </section>
      )}
    </div>
  );
}
