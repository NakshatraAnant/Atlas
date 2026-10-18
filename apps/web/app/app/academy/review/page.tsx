'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { answered, QuestionInput, type Answer, type PublicQuestion } from '@/components/academy';
import { Empty, Loading, Problem, useApi } from '@/components/ui';

interface Due { due_total: number; daily_cap: number; next_due_at: string | null; items: { objective_id: string; objective: string; box: number; question: PublicQuestion }[] }

export default function Review() {
  const due = useApi<Due>('/v1/academy/reviews');
  const [ans, setAns] = useState<Record<string, Answer>>({});
  const [res, setRes] = useState<{ outcomes: { question_id: string; correct: boolean; correct_answer: any; explanation: string; misconception: string | null }[] } | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  if (due.loading) return <Loading lines={5} label="Loading reviews" />;
  if (due.error) return <Problem error={due.error} retry={due.reload} />;
  const d = due.data!;
  const submit = async () => {
    setErr(null);
    try {
      setRes(await api(`/v1/academy/reviews`, { body: { answers: d.items.map((x) => ({ question_id: x.question.question_id, version: x.question.version, response: ans[x.question.question_id] ?? null })) } }));
    } catch (e) {
      setErr(e as ApiError);
    }
  };
  return (
    <div className="academy narrow">
      <p><a href="/app/academy">← Academy</a></p>
      <h1>Spaced review</h1>
      <p className="mu">Short recall practice on concepts you studied earlier. Gaps widen as you keep answering correctly (1, 3, 7, 16 and 35 days); a miss brings the concept back tomorrow. At most {d.daily_cap} a day, and ATLAS never sends reminders for them.</p>
      {d.items.length === 0 ? (
        <Empty>Nothing is due. {d.next_due_at ? `Next review: ${new Date(d.next_due_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.` : 'Complete a lesson quiz to start your review schedule.'}</Empty>
      ) : (
        <>
          {d.items.map((x, k) => (
            <div key={x.objective_id}>
              <p className="mu" style={{ marginBottom: 2 }}>{x.objective}</p>
              <QuestionInput index={k} q={x.question} value={ans[x.question.question_id] ?? null} onChange={(a) => setAns({ ...ans, [x.question.question_id]: a })} disabled={!!res} outcome={res?.outcomes.find((o) => o.question_id === x.question.question_id)} />
            </div>
          ))}
          {res ? <p className="okbox"><strong>{res.outcomes.filter((o) => o.correct).length} of {res.outcomes.length} recalled.</strong> <a href="/app/academy">Back to the Academy</a></p> : <button className="btn" disabled={!d.items.every((x) => answered(ans[x.question.question_id] ?? null))} onClick={() => void submit()}>Check answers</button>}
          <Problem error={err} />
        </>
      )}
    </div>
  );
}
