'use client';
import { use, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { answered, DraftBanner, Lab, QuestionInput, StageStepper, type Answer, type PublicQuestion } from '@/components/academy';
import { Loading, Problem, useApi } from '@/components/ui';
import { useApp } from '@/components/providers';
import { isDemoPath } from '@/components/shell';
import { LessonComplete, LessonProgress } from '@/components/academy-journey';

type Block =
  | { stage: 'discover'; kind: 'text'; title: string; body: string[] }
  | { stage: 'observe'; kind: 'interactive'; title: string; widget: string; intro: string; alt_text: string }
  | { stage: 'observe'; kind: 'atlas_task'; title: string; href: string; steps: string[]; alt_text: string; widget?: string; intro?: string }
  | { stage: 'predict'; kind: 'prediction'; prompt: string; options: string[]; answer: number; reveal: string }
  | { stage: 'investigate'; kind: 'worked_example'; title: string; steps: string[] }
  | { stage: 'decide'; kind: 'guided_practice'; prompt: string; hint: string; answer_text: string }
  | { stage: 'explain'; kind: 'reflection'; prompt: string; model_answer: string }
  | { stage: 'review'; kind: 'summary'; points: string[] };

interface Lesson {
  lesson_id: string; version: number; course: { course_id: string; title: string }; title: string; minutes: number; draft: boolean;
  objectives: { objective_id: string; statement: string }[]; prerequisites: { lesson_id: string; title: string; completed: boolean }[];
  blocks: Block[]; references: { title: string; url?: string; note: string }[]; mastery_rule: string; quiz: PublicQuestion[];
  progress: { last_block: number; completed_at: string | null } | null;
  videos?: LessonVideo[];
  journey?: { position: number; total: number; completed: number; next_lesson: { lesson_id: string; title: string } | null };
}
interface LessonVideo { id: string; title: string; objective: string; duration_s: number; width: number; height: number; status: string; src: string; poster: string; captions: string; transcript: string }
interface QuizResult { score: number; correct: number; of: number; outcomes: { question_id: string; correct: boolean; correct_answer: any; explanation: string; misconception: string | null }[]; mastery: { objective_id: string; state: string; estimate: number; evidence_count: number; next_review_at: string }[] }

export default function LessonPlayer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const l = useApi<Lesson>(`/v1/academy/lessons/${id}`);
  const [i, setI] = useState(0);
  const [reached, setReached] = useState(0);
  const [inQuiz, setInQuiz] = useState(false);
  const [resumed, setResumed] = useState<number | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (l.data?.progress) {
      const b = Math.min(l.data.progress.last_block, l.data.blocks.length - 1);
      setReached(l.data.progress.completed_at ? l.data.blocks.length - 1 : b);
      // Resume an unfinished lesson at the stage the learner reached; a finished one opens at the start.
      if (!l.data.progress.completed_at && b > 0) {
        setI(b);
        setResumed(b);
      }
    }
  }, [l.data]);
  if (l.loading) return <Loading lines={8} label="Loading lesson" />;
  if (l.error) return <Problem error={l.error} retry={l.reload} />;
  const d = l.data!;
  const go = (n: number) => {
    setI(n);
    setInQuiz(false);
    const r = Math.max(reached, n);
    setReached(r);
    void api(`/v1/academy/lessons/${id}/progress`, { body: { block: r } }).catch(() => undefined);
    requestAnimationFrame(() => heading.current?.focus());
  };
  const b = d.blocks[i]!;
  const last = i === d.blocks.length - 1;
  return (
    <div className="academy narrow">
      <p><a href={`/app/academy/${d.course.course_id}`}>← {d.course.title}</a></p>
      <LessonProgress stage={i} stages={d.blocks.length} inQuiz={inQuiz} journey={d.journey} courseTitle={d.course.title} />
      <h1>{d.title}</h1>
      <p className="mu">{d.minutes} min · {d.objectives.map((o) => o.statement).join(' ')}</p>
      {d.draft && <DraftBanner what="This lesson" />}
      {resumed !== null && i === resumed && !inQuiz && <p className="okbox" role="status">Resumed where you left off (stage {resumed + 1} of {d.blocks.length}). <button className="link" onClick={() => go(0)}>Start from the beginning</button></p>}
      {d.prerequisites.some((p) => !p.completed) && <p className="mu">Builds on: {d.prerequisites.map((p, k) => <span key={p.lesson_id}>{k > 0 && ', '}<a href={`/app/academy/lesson/${p.lesson_id}`}>{p.title}</a>{p.completed ? ' ✓' : ''}</span>)}. You can continue without it.</p>}
      {(d.videos ?? []).map((v) => <VideoPanel key={v.id} v={v} />)}
      <StageStepper current={inQuiz ? -1 : i} maxReached={reached} onPick={go} />
      {!inQuiz ? (
        <section className="stage card" key={i} aria-labelledby="stage-h">
          <h2 id="stage-h" tabIndex={-1} ref={heading}>{stageTitle(b)}</h2>
          <BlockView b={b} />
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 16 }}>
            <button className="btn s" disabled={i === 0} onClick={() => go(i - 1)}>Back</button>
            {last ? <button className="btn" onClick={() => { setInQuiz(true); setReached(d.blocks.length - 1); }}>Check your understanding</button> : <button className="btn" onClick={() => go(i + 1)}>Continue</button>}
          </div>
        </section>
      ) : (
        <Quiz lesson={d} />
      )}
      {d.references.length > 0 && (
        <details className="card"><summary>References</summary><ul>{d.references.map((r) => <li key={r.title}>{r.url ? <a href={r.url} rel="noopener noreferrer" target="_blank">{r.title}</a> : r.title} <span className="mu">{r.note}</span></li>)}</ul></details>
      )}
    </div>
  );
}

function VideoPanel({ v }: { v: LessonVideo }) {
  const [failed, setFailed] = useState(false);
  // Truncated like the browser's own player, so both show the same length.
  const secs = Math.floor(v.duration_s);
  const mins = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  return (
    <section className="card lesson-video" aria-labelledby={`video-${v.id}`}>
      <h2 id={`video-${v.id}`} style={{ fontSize: 18, marginTop: 0 }}>Watch: {v.title} <span className="mu">({mins})</span></h2>
      {failed ? (
        <p className="warn" role="alert">This video could not be played in your browser. The <a href={v.transcript} target="_blank" rel="noopener">full transcript</a> covers the same content.</p>
      ) : (
        <video controls preload="metadata" poster={v.poster} width={v.width} height={v.height} onError={() => setFailed(true)} data-testid="lesson-video">
          <source src={v.src} type="video/webm" onError={() => setFailed(true)} />
          <track kind="captions" src={v.captions} srcLang="en" label="English" default />
        </video>
      )}
      <p className="mu">{v.objective} Captions are on by default. <a href={v.transcript} target="_blank" rel="noopener">Read the transcript</a>. Narrated by a computer voice; {v.status === 'published' ? 'reviewed' : 'awaiting expert review'}. Education, not investment advice.</p>
    </section>
  );
}

const stageTitle = (b: Block) => ('title' in b ? b.title : b.stage === 'predict' ? 'Make a prediction' : b.stage === 'decide' ? 'Try it yourself' : b.stage === 'explain' ? 'Explain it in your words' : 'Key points');

function BlockView({ b }: { b: Block }) {
  const { me } = useApp();
  const [pick, setPick] = useState<number | null>(null);
  const [show, setShow] = useState(false);
  const [text, setText] = useState('');
  switch (b.kind) {
    case 'text':
      return <>{b.body.map((p) => <p key={p}>{p}</p>)}</>;
    case 'interactive':
      return <><p>{b.intro}</p><Lab widget={b.widget} /><p className="sr-only">{b.alt_text}</p></>;
    case 'atlas_task': {
      // An optional 3D analysis on real stored data comes first; it works in every installation.
      const analysis = b.widget ? <div className="task-analysis"><p className="lab-intro">{b.intro}</p><Lab widget={b.widget} /><h3 className="task-h">Now practise in ATLAS</h3></div> : null;
      // Exercises built on the fictional practice companies cannot run when demo data is switched off.
      if (me?.demo_mode === false && isDemoPath(b.href)) return (
        <>{analysis}<div className="atlas-task">
          <p><strong>Practical exercise unavailable here.</strong> It uses the fictional practice companies, which are switched off in this installation (it shows only real, sourced data). Read the steps to follow the method:</p>
          <ol>{b.steps.map((st) => <li key={st}>{st}</li>)}</ol>
        </div></>
      );
      return (
        <>{analysis}<div className="atlas-task">
          <p>Practise in ATLAS itself. Open the page below in a new tab, work through the steps, then come back.</p>
          <ol>{b.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          <p><a className="btn s" href={b.href} target="_blank" rel="noopener">Open {b.href} in a new tab</a></p>
        </div></>
      );
    }
    case 'prediction':
      return (
        <fieldset className="qcard"><legend><strong>{b.prompt}</strong></legend>
          {b.options.map((o, k) => <label key={o} className={`opt${pick !== null && k === b.answer ? ' key' : ''}`}><input type="radio" name="predict" disabled={pick !== null} checked={pick === k} onChange={() => setPick(k)} /> <span>{o}</span></label>)}
          {pick !== null && <p className="feedback" role="status"><strong>{pick === b.answer ? 'Good prediction.' : 'Interesting guess. Here is what happens:'}</strong> {b.reveal}</p>}
          {pick === null && <p className="mu">Commit to an answer first; predicting before checking helps you remember.</p>}
        </fieldset>
      );
    case 'worked_example':
      return <ol className="steps">{b.steps.map((s) => <li key={s}>{s}</li>)}</ol>;
    case 'guided_practice':
      return (
        <div>
          <p><strong>{b.prompt}</strong></p>
          <label className="field">Your working (not graded)<textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} /></label>
          <details><summary>Hint</summary><p>{b.hint}</p></details>
          {show ? <p className="okbox">{b.answer_text}</p> : <button className="btn s" onClick={() => setShow(true)}>Show the answer</button>}
        </div>
      );
    case 'reflection':
      return (
        <div>
          <p><strong>{b.prompt}</strong></p>
          <label className="field">Your explanation (stays on this device; not saved)<textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} /></label>
          {show ? <p className="okbox">One good answer: {b.model_answer}</p> : <button className="btn s" disabled={text.trim().length < 10} onClick={() => setShow(true)}>Compare with a model answer</button>}
        </div>
      );
    case 'summary':
      return <ul>{b.points.map((p) => <li key={p}>{p}</li>)}</ul>;
  }
}

function Quiz({ lesson }: { lesson: Lesson }) {
  const [ans, setAns] = useState<Record<string, Answer>>({});
  const [res, setRes] = useState<QuizResult | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const all = lesson.quiz.every((q) => answered(ans[q.question_id] ?? null));
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      setRes(await api<QuizResult>(`/v1/academy/lessons/${lesson.lesson_id}/quiz`, { body: { answers: lesson.quiz.map((q) => ({ question_id: q.question_id, version: q.version, response: ans[q.question_id] ?? null })) } }));
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" aria-labelledby="quiz-h">
      <h2 id="quiz-h">Check your understanding</h2>
      <p className="mu">{lesson.mastery_rule}</p>
      {lesson.quiz.map((q, k) => <QuestionInput key={q.question_id} index={k} q={q} value={ans[q.question_id] ?? null} onChange={(a) => setAns({ ...ans, [q.question_id]: a })} disabled={!!res} outcome={res?.outcomes.find((o) => o.question_id === q.question_id)} />)}
      {res ? (
        <>
          <LessonComplete correct={res.correct} of={res.of} courseId={lesson.course.course_id} next={lesson.journey?.next_lesson ?? null} />
          <div className="mu" style={{ marginTop: 8 }}>
            {res.mastery.map((m) => <p key={m.objective_id}>{m.state === 'mastered' ? 'Objective mastered.' : `Still practising this objective (estimate ${Math.round(m.estimate * 100)}% from ${m.evidence_count} answers).`} Next review: {new Date(m.next_review_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.</p>)}
          </div>
        </>
      ) : (
        <button className="btn" disabled={!all || busy} onClick={() => void submit()}>{busy ? 'Checking…' : all ? 'Check answers' : 'Answer every question to check'}</button>
      )}
      <Problem error={err} />
    </section>
  );
}
