'use client';
import { use, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { DraftBanner } from '@/components/academy';
import { Loading, Problem, useApi } from '@/components/ui';

interface Detail {
  course_id: string; title: string; tagline: string; description: string; audience: string; prerequisites: string; completion_statement: string; draft: boolean;
  preceding_course: { course_id: string; title: string } | null;
  diagnostic: { questions: number; minutes: number; max_attempts_per_week: number; rules: { high_min: number; low_max: number } };
  objectives: { objective_id: string; statement: string }[];
  modules: { module_id: string; position: number; title: string; summary: string; lessons: { lesson_id: string; title: string; minutes: number; draft: boolean }[] }[];
  learner: null | {
    enrolment: { entry_route: string; enrolled_at: string } | null;
    attempts: { attempt_id: string; submitted_at: string | null; readiness: string | null }[];
    diagnostic: { remaining: number; next_allowed_at: string | null };
    progress: { lesson_id: string; completed_at: string | null }[];
    mastery: { objective_id: string; state: string; estimate: number; evidence_count: number }[];
  };
}

export default function CoursePage({ params }: { params: Promise<{ course: string }> }) {
  const { course } = use(params);
  const d = useApi<Detail>(`/v1/academy/courses/${course}`);
  const [err, setErr] = useState<ApiError | null>(null);
  const [confirming, setConfirming] = useState(false);
  if (d.loading) return <Loading lines={8} label="Loading course" />;
  if (d.error) return <Problem error={d.error} retry={d.reload} />;
  const c = d.data!;
  const L = c.learner;
  const lastDone = L?.attempts.find((a) => a.submitted_at);
  const enrol = async (ack: boolean) => {
    setErr(null);
    try {
      await api(`/v1/academy/courses/${course}/enrol`, { body: { attempt_id: lastDone?.attempt_id, acknowledge: ack } });
      setConfirming(false);
      await d.reload();
    } catch (e) {
      if ((e as ApiError).status === 409) setConfirming(true);
      else setErr(e as ApiError);
    }
  };
  const done = (id: string) => !!L?.progress.find((p) => p.lesson_id === id && p.completed_at);
  return (
    <div className="academy">
      <p><a href="/app/academy">← Academy</a></p>
      <header className="ac-hero">
        <p className="eyebrow">{c.title}</p>
        <h1>{c.tagline}</h1>
        <p style={{ maxWidth: 680 }}>{c.description}</p>
        <p className="mu">For: {c.audience}</p>
      </header>
      {c.draft && <DraftBanner what="This course" />}
      <div className="grid2">
        <section className="card" aria-labelledby="ready">
          <h2 id="ready">Before you start</h2>
          <p><strong>You will need:</strong> {c.prerequisites}</p>
          {c.preceding_course && <p className="mu">New to this? <a href={`/app/academy/${c.preceding_course.course_id}`}>{c.preceding_course.title}</a> covers the groundwork.</p>}
          <p>The readiness check has {c.diagnostic.questions} questions and takes about 5–10 minutes. It checks the prerequisites above, not your general confidence, and gives a rough estimate only. You can take it up to {c.diagnostic.max_attempts_per_week} times a week; each retake uses different questions where possible.</p>
          {L?.enrolment ? (
            <p className="okbox">You are enrolled{L.enrolment.entry_route === 'learner_override' ? ' (you chose to start despite the check)' : ''}.</p>
          ) : (
            <div className="row">
              {L && L.diagnostic.remaining > 0 ? <a className="btn" href={`/app/academy/${course}/check`}>{L.attempts.length ? 'Retake the readiness check' : 'Take the readiness check'}</a> : L ? <span className="mu">Next readiness check available {L.diagnostic.next_allowed_at ? new Date(L.diagnostic.next_allowed_at).toLocaleString('en-IN') : 'later'}.</span> : null}
              <button className="btn s" onClick={() => void enrol(false)}>Start the course{lastDone ? '' : ' without the check'}</button>
            </div>
          )}
          {lastDone && !L?.enrolment && <p className="mu">Your last check: <a href={`/app/academy/${course}/check?result=${lastDone.attempt_id}`}>{lastDone.readiness === 'high' ? 'ready' : lastDone.readiness === 'borderline' ? 'nearly ready' : 'review first'}</a>.</p>}
          {confirming && (
            <div className="warn" role="alertdialog" aria-labelledby="confirm-h">
              <p id="confirm-h"><strong>{lastDone ? 'Your readiness check suggested reviewing the prerequisites first.' : 'You have not taken the readiness check.'}</strong> You can still start; lessons list their prerequisites and you can come back to them.</p>
              <button className="btn" onClick={() => void enrol(true)}>Start anyway</button> <button className="btn s" onClick={() => setConfirming(false)}>Not now</button>
            </div>
          )}
          <Problem error={err} />
        </section>
        <section className="card" aria-labelledby="obj">
          <h2 id="obj">What you will be able to do</h2>
          <ul className="objectives">
            {c.objectives.map((o) => {
              const m = L?.mastery.find((x) => x.objective_id === o.objective_id);
              return <li key={o.objective_id}><span>{o.statement}</span>{m && <span className={`t ${m.state === 'mastered' ? 'o' : 'm'}`}>{m.state === 'mastered' ? 'Mastered' : `Practising · ${Math.round(m.estimate * 100)}%`}</span>}</li>;
            })}
          </ul>
          <p className="mu">Mastery is shown only after repeated correct answers over time; finishing a lesson does not count as mastery.</p>
        </section>
      </div>
      <section aria-labelledby="mods">
        <h2 id="mods">Modules</h2>
        <ol className="modules">
          {c.modules.map((m) => (
            <li key={m.module_id} className="card">
              <h3>Module {m.position}: {m.title}</h3>
              <p className="mu">{m.summary}</p>
              {m.lessons.length ? (
                <ol className="lessons">
                  {m.lessons.map((l) => <li key={l.lesson_id}><a href={`/app/academy/lesson/${l.lesson_id}`}>{l.title}</a> <span className="mu">· {l.minutes} min{l.draft ? ' · draft' : ''}</span>{done(l.lesson_id) && <span className="t o">Completed</span>}</li>)}
                </ol>
              ) : <p className="mu">Lessons in preparation.</p>}
            </li>
          ))}
        </ol>
      </section>
      <p className="disc">{c.completion_statement}</p>
    </div>
  );
}
