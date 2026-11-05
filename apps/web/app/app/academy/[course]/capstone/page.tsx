'use client';
import { useApp } from '@/components/providers';
import { use, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { DraftBanner } from '@/components/academy';
import { Loading, Problem, useApi } from '@/components/ui';

interface Capstone { title: string; brief: string; deliverables: string[]; rubric: { criterion: string; levels: string[] }[]; artefact_kinds: ('note' | 'backtest' | 'hypothesis' | 'watchlist')[]; draft: boolean; submissions: { submission_id: string; status: string; submitted_at: string; review: { scores: Record<string, number>; comments: string; reviewer_name: string } | null }[] }
interface Completion { record: { record_id: string; issued_at: string; assessed: any; statement: string } | null; eligible: boolean; missing: string[]; lessons: number; lessons_completed: number; mastered: number; objectives: { objective_id: string; statement: string; state: string | null }[] }

export default function CapstonePage({ params }: { params: Promise<{ course: string }> }) {
  const { course } = use(params);
  const cap = useApi<Capstone>(`/v1/academy/courses/${course}/capstone`);
  const comp = useApi<Completion>(`/v1/academy/courses/${course}/completion`);
  const notes = useApi<{ notes: { note_id: string; title: string }[] }>('/v1/notes');
  // Backtests and company hypotheses belong to the demo dataset; with demo data off they are not requested.
  const me = useApp().me;
  const demo = !!me && me.demo_mode !== false;
  const runs = useApi<{ runs: { run_id: string; name: string | null; template_code: string; created_at: string }[] }>(demo ? '/v1/backtests' : null);
  const hyps = useApi<{ hypotheses: { hypothesis_id: string; statement: string }[] }>(demo ? '/v1/hypotheses' : null);
  const [body, setBody] = useState('');
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [self, setSelf] = useState<Record<string, number>>({});
  const [err, setErr] = useState<ApiError | null>(null);
  const [msg, setMsg] = useState('');
  if (cap.loading || comp.loading) return <Loading lines={8} label="Loading capstone" />;
  if (cap.error) return <Problem error={cap.error} retry={cap.reload} />;
  const c = cap.data!;
  const options: Record<string, { id: string; label: string }[]> = {
    note: (notes.data?.notes ?? []).map((n) => ({ id: n.note_id, label: n.title || 'Untitled note' })),
    backtest: (runs.data?.runs ?? []).map((r) => ({ id: r.run_id, label: `${r.name ?? r.template_code} (${r.created_at.slice(0, 10)})` })),
    hypothesis: (hyps.data?.hypotheses ?? []).map((h) => ({ id: h.hypothesis_id, label: h.statement.slice(0, 80) })),
    watchlist: [],
  };
  const ready = body.trim().length >= 50 && c.artefact_kinds.every((k) => picked[k]) && c.rubric.every((r) => self[r.criterion] !== undefined);
  const submit = async () => {
    setErr(null);
    try {
      await api(`/v1/academy/courses/${course}/capstone`, { body: { body, artefacts: c.artefact_kinds.map((k) => ({ kind: k, id: picked[k] })), self_assessment: self } });
      setMsg('Submitted. Your self-assessment is recorded; a reviewer may add a marked review.');
      await cap.reload();
      await comp.reload();
    } catch (e) { setErr(e as ApiError); }
  };
  const issue = async () => {
    setErr(null);
    try { await api(`/v1/academy/courses/${course}/completion`, { method: 'POST', body: {} }); await comp.reload(); } catch (e) { setErr(e as ApiError); }
  };
  const k = comp.data;
  return (
    <div className="academy narrow">
      <p><a href={`/app/academy/${course}`}>← Course</a></p>
      <p className="eyebrow">Capstone</p>
      <h1>{c.title}</h1>
      {c.draft && <DraftBanner what="This capstone" />}
      <p>{c.brief}</p>
      <h2>Deliverables</h2>
      <ul>{c.deliverables.map((d) => <li key={d}>{d}</li>)}</ul>
      <h2>Rubric</h2>
      <div className="wrap"><table><caption>Each criterion is scored 0–3</caption><thead><tr><th scope="col">Criterion</th>{[0, 1, 2, 3].map((n) => <th key={n} scope="col">{n}</th>)}</tr></thead>
        <tbody>{c.rubric.map((r) => <tr key={r.criterion}><th scope="row">{r.criterion}</th>{r.levels.map((l) => <td key={l} style={{ textAlign: 'left' }}>{l.replace(/^\d — /, '')}</td>)}</tr>)}</tbody></table></div>

      <section className="card" aria-labelledby="sub-h">
        <h2 id="sub-h">Submit your work</h2>
        <label className="field">Summary of your work (at least 50 characters; your linked note holds the full piece)
          <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} />
        </label>
        {c.artefact_kinds.map((kind) => (
          <label key={kind} className="field">Link a {kind} from your ATLAS account
            <select value={picked[kind] ?? ''} onChange={(e) => setPicked({ ...picked, [kind]: e.target.value })}>
              <option value="">Choose…</option>
              {options[kind]!.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            {options[kind]!.length === 0 && <span className="mu">You have none yet: create one in {kind === 'backtest' ? 'the Quant Lab' : 'My research'} first.</span>}
          </label>
        ))}
        <fieldset style={{ border: 0, padding: 0 }}><legend><strong>Self-assessment</strong></legend>
          {c.rubric.map((r) => (
            <div key={r.criterion} className="row" role="radiogroup" aria-label={r.criterion}>
              <span style={{ minWidth: 200 }}>{r.criterion}</span>
              {[0, 1, 2, 3].map((n) => <label key={n}><input type="radio" name={`s-${r.criterion}`} checked={self[r.criterion] === n} onChange={() => setSelf({ ...self, [r.criterion]: n })} /> {n}</label>)}
            </div>
          ))}
        </fieldset>
        <button className="btn" disabled={!ready} onClick={() => void submit()}>Submit capstone</button>
        {msg && <p className="okbox" role="status">{msg}</p>}
        <Problem error={err} />
      </section>

      {c.submissions.length > 0 && (
        <section className="card"><h2>Your submissions</h2>
          <ul>{c.submissions.map((s) => <li key={s.submission_id}>{new Date(s.submitted_at).toLocaleString('en-IN')} · {s.status === 'reviewed' ? `reviewed by ${s.review?.reviewer_name}: ${s.review?.comments}` : 'self-assessed, awaiting optional review'}</li>)}</ul>
        </section>
      )}

      {k && (
        <section className="card" aria-labelledby="comp-h">
          <h2 id="comp-h">Course completion</h2>
          {k.record ? (
            <div className="okbox">
              <p><strong>Completion record issued {new Date(k.record.issued_at).toLocaleDateString('en-IN')}.</strong></p>
              <p>Lessons completed: {k.record.assessed.lessons_completed}. Objectives demonstrated: {k.record.assessed.objectives.filter((o: any) => o.demonstrated).length} of {k.record.assessed.objectives.length}. Capstone: {k.record.assessed.capstone.assessment}. Content status: {k.record.assessed.content_status}.</p>
              <p className="mu">{k.record.statement}</p>
            </div>
          ) : (
            <>
              <p>Lessons {k.lessons_completed}/{k.lessons} · objectives mastered {k.mastered}/{k.objectives.length} · capstone {c.submissions.length ? 'submitted' : 'not submitted'}</p>
              {k.eligible ? <button className="btn" onClick={() => void issue()}>Issue my completion record</button> : <ul>{k.missing.map((m) => <li key={m}>{m}</li>)}</ul>}
            </>
          )}
        </section>
      )}
    </div>
  );
}
