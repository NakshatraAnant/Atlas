'use client';
import { use, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { answered, QuestionInput, type Answer, type PublicQuestion } from '@/components/academy';
import { Loading, Problem } from '@/components/ui';

interface Start { attempt_id: string; expires_at: string; resumed: boolean; questions: PublicQuestion[]; caveat: string }
interface Outcome { question_id: string; version: number; qtype: PublicQuestion['qtype']; unit: string | null; stem: string; options: string[]; correct: boolean; correct_answer: any; explanation: string; misconception: string | null; your_response: Answer; skill: string }
interface Result { attempt_id: string; readiness: 'high' | 'borderline' | 'low'; ratio: number; reasons: string[]; recommendation: { action: string; text: string }; skills_to_review: string[]; caveat: string; outcomes: Outcome[]; preceding_course: { course_id: string; title: string } | null }

const HEAD: Record<Result['readiness'], [string, string]> = {
  high: ['You look ready for this course', 'okbox'],
  borderline: ['You are nearly ready', 'warn'],
  low: ['A little groundwork first would help', 'warn'],
};

export default function Check({ params }: { params: Promise<{ course: string }> }) {
  const { course } = use(params);
  const [start, setStart] = useState<Start | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const existing = new URLSearchParams(location.search).get('result');
    const go = async () => {
      try {
        if (existing && /^[0-9a-f-]{36}$/.test(existing)) {
          const r = await api<{ result: Result | null }>(`/v1/academy/diagnostics/${existing}`);
          if (r.result) return setResult({ ...r.result, attempt_id: existing } as Result);
        }
        setStart(await api<Start>(`/v1/academy/courses/${course}/diagnostic`, { method: 'POST', body: {} }));
      } catch (e) {
        setErr(e as ApiError);
      }
    };
    void go();
  }, [course]);
  const submit = async () => {
    if (!start) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<Result>(`/v1/academy/diagnostics/${start.attempt_id}/submit`, { body: { answers: start.questions.map((q) => ({ question_id: q.question_id, response: answers[q.question_id] ?? null })) } });
      setResult(r);
      window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  };
  const enrol = async (ack: boolean) => {
    try {
      await api(`/v1/academy/courses/${course}/enrol`, { body: { attempt_id: result!.attempt_id, acknowledge: ack } });
      location.href = `/app/academy/${course}`;
    } catch (e) {
      setErr(e as ApiError);
    }
  };

  if (err && !start && !result) return <div className="academy"><p><a href={`/app/academy/${course}`}>← Course</a></p><Problem error={err} /></div>;
  if (result) {
    const [h, cls] = HEAD[result.readiness];
    return (
      <div className="academy narrow">
        <p><a href={`/app/academy/${course}`}>← Course</a></p>
        <section className={`result ${cls}`} aria-labelledby="res-h">
          <h1 id="res-h">{h}</h1>
          <ul>{result.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          <p><strong>Suggestion:</strong> {result.recommendation.text}</p>
          <p className="mu">{result.caveat}</p>
          <div className="row">
            {result.readiness === 'high' && <button className="btn" onClick={() => void enrol(false)}>Start the course</button>}
            {result.readiness === 'borderline' && <><button className="btn" onClick={() => void enrol(false)}>Start the course</button><a className="btn s" href={`/app/academy/${course}`}>Review prerequisites first</a></>}
            {result.readiness === 'low' && <>{result.preceding_course && <a className="btn" href={`/app/academy/${result.preceding_course.course_id}`}>Go to {result.preceding_course.title}</a>}<button className="btn s" onClick={() => void enrol(true)}>Start this course anyway</button></>}
          </div>
          <Problem error={err} />
        </section>
        <h2>Your answers, explained</h2>
        {result.outcomes.map((o, i) => (
          <QuestionInput key={o.question_id} index={i} q={{ question_id: o.question_id, version: o.version, qtype: o.qtype, stem: o.stem, options: o.options, skill: o.skill, difficulty: 1, unit: o.unit }} value={o.your_response} onChange={() => undefined} disabled outcome={o} />
        ))}
      </div>
    );
  }
  if (!start) return <Loading lines={6} label="Preparing your readiness check" />;
  const n = start.questions.filter((q) => answered(answers[q.question_id] ?? null)).length;
  return (
    <div className="academy narrow">
      <p><a href={`/app/academy/${course}`}>← Course</a></p>
      <h1>Readiness check</h1>
      <p className="mu">{start.caveat} {start.resumed ? 'You are continuing a check you started earlier.' : ''} Please finish by {new Date(start.expires_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.</p>
      <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={start.questions.length} aria-valuenow={n} aria-label="Questions answered"><i style={{ width: `${(n / start.questions.length) * 100}%` }} /></div>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {start.questions.map((q, i) => <QuestionInput key={q.question_id} index={i} q={q} value={answers[q.question_id] ?? null} onChange={(a) => setAnswers({ ...answers, [q.question_id]: a })} />)}
        <p className="mu">{n} of {start.questions.length} answered. Unanswered questions count as incorrect; it is fine to say you don't know.</p>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Checking…' : 'See my result'}</button>
        <Problem error={err} />
      </form>
    </div>
  );
}
