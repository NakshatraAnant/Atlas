'use client';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, streamAsk } from '@/lib/api';
import { useApp } from '@/components/providers';
import { Problem, Tag, useApi, Value } from '@/components/ui';
import { dateOrDash } from '@/lib/format';

interface Item { text: string; type: string; claim_ids: string[] }
interface Answer {
  kind: string; intent: string;
  sections: { direct_answer: Item[]; figures: { label: string; display: string; claim_id: string; evidence_id: string; period: string | null }[]; method: string; sources: { evidence_id: string; label: string; period: string | null; as_of: string | null; source: string }[]; uncertainty: string[]; inspect: { label: string; href: string }[] };
  claims: { id: string; evidenceId: string; display: string; label: string }[];
  check: { status: string; numbers: number };
  context: { company_id?: string; company_name?: string };
  options?: { company_id: string; short_name: string }[];
  versions: Record<string, string>; disclosure: { id: string; text: string }; suggestions: string[];
}
interface Turn { question: string; answer?: Answer; message_id?: string; progress: string[]; error?: ApiError | Error; latency_ms?: number }

const STEP_LABEL: Record<string, string> = { classify: 'Checking the question', resolve: 'Finding the company', retrieve: 'Retrieving filed data', compose: 'Writing the answer', check: 'Checking every number against the data' };

export default function Assistant() {
  const { me, refresh } = useApp();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [conv, setConv] = useState<string | undefined>();
  const [ctxCompany, setCtxCompany] = useState<string | undefined>();
  const [briefingDate, setBriefingDate] = useState<string | undefined>();
  const [onboarding, setOnboarding] = useState(false);
  const [runId, setRunId] = useState<string | undefined>();
  const convs = useApi<{ conversations: { conversation_id: string; title: string; created_at: string }[] }>('/v1/assistant/conversations', [turns.length]);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    setCtxCompany(p.get('company_id') ?? undefined);
    setBriefingDate(p.get('briefing_date') ?? undefined);
    setOnboarding(p.get('onboarding') === '1');
    setRunId(p.get('run_id') ?? undefined);
    const pre = p.get('q');
    if (pre) setQ(pre);
  }, []);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), [turns]);

  const ask = async (question: string, companyOverride?: string) => {
    if (!question.trim() || busy) return;
    setBusy(true);
    setQ('');
    const idx = turns.length;
    setTurns((t) => [...t, { question, progress: [] }]);
    const upd = (f: (t: Turn) => Turn) => setTurns((all) => all.map((t, i) => (i === idx ? f(t) : t)));
    try {
      await streamAsk({ question, conversation_id: conv, context: { company_id: companyOverride ?? ctxCompany, briefing_date: briefingDate, run_id: runId }, onboarding: onboarding || undefined }, (ev, data) => {
        if (ev === 'progress') upd((t) => ({ ...t, progress: [...t.progress, STEP_LABEL[data.step] ?? data.step] }));
        if (ev === 'answer') {
          setConv(data.conversation_id);
          upd((t) => ({ ...t, answer: data.answer, message_id: data.message_id, latency_ms: data.latency_ms }));
          if (data.answer.context?.company_id) setCtxCompany(data.answer.context.company_id);
        }
        if (ev === 'error') upd((t) => ({ ...t, error: new ApiError({ status: data.status, detail: data.detail, ...(data.extra ?? {}) }) }));
      });
      setOnboarding(false);
      void refresh();
    } catch (e) {
      upd((t) => ({ ...t, error: e as Error }));
    } finally {
      setBusy(false);
    }
  };
  const open = async (id: string) => {
    const r = await api<{ messages: { message_id: string; role: string; content_json: any }[] }>(`/v1/assistant/conversations/${id}`);
    const out: Turn[] = [];
    for (const m of r.messages) {
      if (m.role === 'user') out.push({ question: m.content_json.text, progress: [] });
      else if (out.length) out[out.length - 1] = { ...out[out.length - 1]!, answer: m.content_json, message_id: m.message_id };
    }
    setTurns(out);
    setConv(id);
  };
  const used = me ? me.usage.ai_questions : 0;
  const limit = me ? me.entitlements.ai_questions_per_month : 0;
  return (
    <div className="grid2" style={{ gridTemplateColumns: 'minmax(0,3fr) minmax(0,1fr)' }}>
      <div>
        <h1>Research assistant</h1>
        <p className="mu">Answers use only ATLAS data; every number links to its evidence and is checked before you see it. It explains — it does not recommend buying, selling or holding. {limit > 0 && `${used} of ${limit} questions used this month.`}</p>
        {ctxCompany && <p className="mu">Context: this conversation is about a selected company. <button className="link" onClick={() => setCtxCompany(undefined)}>Clear</button></p>}
        {turns.length === 0 && (
          <div className="card"><h2>Try asking</h2><ul>{['How did Kaveri Foods’ operating margin change over the last eight quarters?', 'What is ROCE and how is it calculated?', 'Compare debt to equity for IT companies', 'Why did the market fall today?'].map((s) => <li key={s}><button className="link" onClick={() => ask(s)}>{s}</button></li>)}</ul></div>
        )}
        {turns.map((t, i) => <TurnView key={i} t={t} onAsk={ask} />)}
        <div ref={endRef} />
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
          <label className="field">Your question<textarea rows={3} maxLength={1000} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(q); } }} /></label>
          <div className="row"><button className="btn" type="submit" disabled={busy || q.trim().length < 2}>{busy ? 'Working…' : 'Ask'}</button>{conv && <button type="button" className="btn s" onClick={() => { setTurns([]); setConv(undefined); }}>New conversation</button>}</div>
        </form>
      </div>
      <aside className="card"><h2>Conversations</h2>
        {convs.data?.conversations.length ? <ul>{convs.data.conversations.map((c) => <li key={c.conversation_id}><button className="link" onClick={() => open(c.conversation_id)}>{c.title || 'Untitled'}</button> <span className="mu">{dateOrDash(c.created_at)}</span> <button className="link mu" aria-label="Delete conversation" onClick={async () => { await api(`/v1/assistant/conversations/${c.conversation_id}`, { method: 'DELETE' }); convs.reload(); if (conv === c.conversation_id) { setTurns([]); setConv(undefined); } }}>×</button></li>)}</ul> : <p className="mu">No saved conversations.</p>}
      </aside>
    </div>
  );
}

function TurnView({ t, onAsk }: { t: Turn; onAsk: (q: string, company?: string) => void }) {
  const a = t.answer;
  const claim = new Map((a?.claims ?? []).map((c) => [c.id, c]));
  return (
    <article className="card" aria-live="polite">
      <p><strong>You:</strong> {t.question}</p>
      {!a && !t.error && <ol className="mu" aria-label="Progress">{t.progress.map((p, i) => <li key={i}>{p}</li>)}{t.progress.length === 0 && <li>Starting…</li>}</ol>}
      <Problem error={t.error ?? null} />
      {a && (
        <>
          {a.kind === 'policy' && <p className="warn">ATLAS can explain data and methods but cannot give personal investment advice.</p>}
          {a.kind === 'disambiguation' && a.options && <div><p>Which company did you mean?</p><div className="row">{a.options.map((o) => <button key={o.company_id} className="btn s" onClick={() => onAsk(t.question, o.company_id)}>{o.short_name}</button>)}</div></div>}
          <section aria-label="Direct answer">{a.sections.direct_answer.map((it, i) => <p key={i}><Tag kind={it.type} />{it.text} {it.claim_ids.map((cid, k) => { const c = claim.get(cid); return c ? <Value key={cid} evidence={c.evidenceId} surface="assistant">{`[${k + 1}]`}</Value> : null; })}</p>)}</section>
          {a.sections.figures.length > 0 && (
            <details open><summary>Supporting figures ({a.sections.figures.length})</summary>
              <div className="wrap"><table><caption className="sr-only">Figures</caption><tbody>{a.sections.figures.map((f) => <tr key={f.claim_id}><th scope="row">{f.label}</th><td><Value evidence={f.evidence_id} surface="assistant">{f.display}</Value></td></tr>)}</tbody></table></div>
            </details>
          )}
          {a.sections.method && <details><summary>Method</summary><p>{a.sections.method}</p></details>}
          {a.sections.sources.length > 0 && <details><summary>Sources</summary><ul>{a.sections.sources.map((s) => <li key={s.evidence_id}><Value evidence={s.evidence_id} surface="assistant">{`${s.label}${s.period ? `, ${s.period}` : ''}`}</Value> <span className="mu">{s.source}{s.as_of ? ` · as of ${s.as_of}` : ''}</span></li>)}</ul></details>}
          {a.sections.uncertainty.length > 0 && <div><h3>Limits of this answer</h3><ul>{a.sections.uncertainty.map((u) => <li key={u}>{u}</li>)}</ul></div>}
          {a.sections.inspect.length > 0 && <p>Inspect further: {a.sections.inspect.map((x, i) => <span key={x.href}>{i > 0 && ' · '}<a href={x.href}>{x.label}</a></span>)}</p>}
          {a.suggestions.length > 0 && <div className="row">{a.suggestions.map((s) => <button key={s} className="btn s" onClick={() => onAsk(s)}>{s}</button>)}</div>}
          <p className="mu">Number check: {a.check.status} ({a.check.numbers} numbers) · {a.versions.model}{t.latency_ms ? ` · ${(t.latency_ms / 1000).toFixed(1)} s` : ''}</p>
          <p className="disc">{a.disclosure.text}</p>
          {t.message_id && <Feedback id={t.message_id} />}
        </>
      )}
    </article>
  );
}

function Feedback({ id }: { id: string }) {
  const [sent, setSent] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [open, setOpen] = useState(false);
  const send = async (rating: 'up' | 'down', report = false) => {
    await api(`/v1/assistant/messages/${id}/feedback`, { body: { rating, report_error: report, comment: comment || undefined } }).catch(() => undefined);
    setSent(report ? 'Thanks — the error report goes to the review queue.' : 'Thanks for the feedback.');
  };
  if (sent) return <p className="mu">{sent}</p>;
  return (
    <div className="row">
      <button className="btn s" onClick={() => send('up')} aria-label="Helpful">Helpful</button>
      <button className="btn s" onClick={() => send('down')} aria-label="Not helpful">Not helpful</button>
      <button className="link" onClick={() => setOpen(!open)}>Report an error</button>
      {open && <><input aria-label="What was wrong?" placeholder="What was wrong?" value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} /><button className="btn s" onClick={() => send('down', true)}>Send report</button></>}
    </div>
  );
}
