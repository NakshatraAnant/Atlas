'use client';
import { useEffect, useState } from 'react';

// Learner journeys in the Academy: a course map that shows where you are and what comes next, a lesson
// progress bar, a progress ring, and a short completion moment that leads straight to the next step.
// All motion is CSS, short, and switched off by prefers-reduced-motion (globals.css).

const FEATURE: Record<string, { label: string; title: string }> = {
  '3d': { label: '3D', title: 'Includes a 3D chart or scene you can turn and explore' },
  lab: { label: 'Lab', title: 'Includes an interactive lab' },
  video: { label: 'Video', title: 'Opens with a narrated video (captions and transcript)' },
  task: { label: 'Practice', title: 'Includes a guided exercise in ATLAS itself' },
};

export function FeatureChips({ features }: { features?: string[] }) {
  if (!features?.length) return null;
  return <span className="feat-chips">{features.map((f) => FEATURE[f] && <span key={f} className={`feat f-${f}`} title={FEATURE[f]!.title}>{FEATURE[f]!.label}</span>)}</span>;
}

/** Circular progress (0–1) whose arc grows in when first shown. */
export function ProgressRing({ value, size = 64, label }: { value: number; size?: number; label: string }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);
  useEffect(() => { const t = requestAnimationFrame(() => setShown(Math.max(0, Math.min(1, value)))); return () => cancelAnimationFrame(t); }, [value]);
  return (
    <span className="ring" role="img" aria-label={label} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" />
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - shown)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="ring-text">{Math.round(value * 100)}%</span>
    </span>
  );
}

interface JLesson { lesson_id: string; title: string; minutes: number; draft: boolean; features?: string[] }
interface JModule { module_id: string; position: number; title: string; summary: string; lessons: JLesson[] }

/** The course as a path: modules are stations, lessons are stops; done, up next and still to come. */
export function CourseJourney({ courseId, modules, isDone, nextId, enrolled }: { courseId: string; modules: JModule[]; isDone: (id: string) => boolean; nextId: string | null; enrolled: boolean }) {
  const all = modules.flatMap((m) => m.lessons);
  const completed = all.filter((l) => isDone(l.lesson_id)).length;
  const minutesLeft = all.filter((l) => !isDone(l.lesson_id)).reduce((a, l) => a + l.minutes, 0);
  let k = 0;
  return (
    <section className="journey" aria-labelledby="journey-h">
      <div className="journey-hd">
        <ProgressRing value={all.length ? completed / all.length : 0} label={`${completed} of ${all.length} lessons completed`} />
        <div>
          <h2 id="journey-h">Your path through the course</h2>
          <p className="mu">{completed} of {all.length} lessons done{minutesLeft ? ` · about ${minutesLeft >= 60 ? `${Math.round(minutesLeft / 6) / 10} h` : `${minutesLeft} min`} to go` : ''}{!enrolled ? ' · start the course to save your progress' : ''}</p>
        </div>
      </div>
      <ol className="stations">
        {modules.map((m) => {
          const mDone = m.lessons.length > 0 && m.lessons.every((l) => isDone(l.lesson_id));
          return (
            <li key={m.module_id} className={`station${mDone ? ' complete' : ''}`}>
              <div className="station-hd">
                <span className="station-n" aria-hidden="true">{mDone ? '✓' : m.position}</span>
                <div><h3>Module {m.position}: {m.title}</h3><p className="mu">{m.summary}</p></div>
              </div>
              {m.lessons.length ? (
                <ol className="stops">
                  {m.lessons.map((l) => {
                    const done = isDone(l.lesson_id);
                    const next = l.lesson_id === nextId;
                    const i = k++;
                    return (
                      <li key={l.lesson_id} className={`stop${done ? ' done' : ''}${next ? ' next' : ''}`} style={{ ['--i' as string]: i }}>
                        <span className="dot" aria-hidden="true">{done ? '✓' : ''}</span>
                        <a href={`/app/academy/lesson/${l.lesson_id}`} className="stop-link">
                          <span className="stop-title">{l.title}</span>
                          <span className="stop-meta"><span className="mu">{l.minutes} min{l.draft ? ' · draft' : ''}</span><FeatureChips features={l.features} /></span>
                        </a>
                        {next && <span className="stop-tag">{done ? 'Review' : 'Up next'}</span>}
                        <span className="sr-only">{done ? 'Completed.' : next ? 'Up next.' : 'Not started.'}</span>
                      </li>
                    );
                  })}
                </ol>
              ) : <p className="mu">Lessons in preparation.</p>}
            </li>
          );
        })}
        <li className="station finale">
          <div className="station-hd">
            <span className="station-n" aria-hidden="true">★</span>
            <div><h3>Capstone and completion</h3><p className="mu">Finish with a practical assignment inside ATLAS, assessed against a published rubric. A completion record lists exactly what you completed and demonstrated.</p><p className="row" style={{ marginTop: 8 }}><a className="btn s" href={`/app/academy/${courseId}/capstone`}>Open the capstone</a> <a className="btn s" href="/app/academy/games">Practice games</a></p></div>
          </div>
        </li>
      </ol>
    </section>
  );
}

/** Thin bar above the lesson: where you are in this lesson and in the course. */
export function LessonProgress({ stage, stages, inQuiz, journey, courseTitle }: { stage: number; stages: number; inQuiz: boolean; journey?: { position: number; total: number; completed: number }; courseTitle: string }) {
  const frac = inQuiz ? 1 : (stage + 1) / (stages + 1);
  return (
    <div className="lesson-progress" aria-label={`Stage ${inQuiz ? stages + 1 : stage + 1} of ${stages + 1} in this lesson`}>
      <div className="lp-track"><div className="lp-fill" style={{ transform: `scaleX(${frac})` }} /></div>
      {journey && <p className="mu lp-meta">Lesson {journey.position} of {journey.total} in {courseTitle.replace('ATLAS: ', '')} · {journey.completed} completed</p>}
    </div>
  );
}

/** Shown once a lesson's quiz is checked: the result, then the way forward. */
export function LessonComplete({ correct, of, courseId, next }: { correct: number; of: number; courseId: string; next: { lesson_id: string; title: string } | null }) {
  const perfect = correct === of;
  return (
    <div className="complete" role="status">
      <div className="burst" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ ['--a' as string]: `${(i / 14) * 360}deg`, ['--d' as string]: `${i % 3}` }} />)}</div>
      <p className="complete-badge" aria-hidden="true">{perfect ? '★' : '✓'}</p>
      <h3>Lesson complete</h3>
      <p>{correct} of {of} correct{perfect ? '. Every answer right.' : '. The explanations above show where to look again.'}</p>
      <p className="complete-actions">
        {next ? <a className="btn" href={`/app/academy/lesson/${next.lesson_id}`}>Next lesson: {next.title} →</a> : <a className="btn" href={`/app/academy/${courseId}/capstone`}>All lessons done: open the capstone →</a>}
        <a className="btn s" href={`/app/academy/${courseId}`}>Course map</a>
      </p>
    </div>
  );
}
