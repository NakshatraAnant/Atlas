'use client';
import { Loading, Problem, useApi } from '@/components/ui';

interface Course { course_id: string; title: string; tagline: string; description: string; audience: string; position: number; draft: boolean; modules: number; lessons: number; enrolment: { entry_route: string } | null; last_diagnostic: { readiness: string | null } | null }
interface Progress { courses: { course_id: string; title: string; lessons: number; lessons_completed: number; objectives: number; mastered: number }[]; reviews_due: number; note: string }

const READINESS: Record<string, string> = { high: 'Ready', borderline: 'Nearly ready', low: 'Review first' };

export default function AcademyHome() {
  const courses = useApi<{ courses: Course[]; not_a_qualification: string }>('/v1/academy/courses');
  const progress = useApi<Progress>('/v1/academy/progress');
  if (courses.loading) return <Loading lines={6} label="Loading courses" />;
  if (courses.error) return <Problem error={courses.error} retry={courses.reload} />;
  const p = progress.data;
  return (
    <div className="academy">
      <header className="ac-hero">
        <p className="eyebrow">ATLAS Academy</p>
        <h1>Learn to read markets the way ATLAS does: with evidence.</h1>
        <p className="mu" style={{ maxWidth: 640 }}>Four courses, from how a share works to defending a valuation. Each starts with a five-question readiness check so you begin at the right place. {courses.data!.not_a_qualification}</p>
        <p><a className="btn s" href="/app/academy/games">Practice games</a></p>
        {p && p.reviews_due > 0 && <p><a className="btn" href="/app/academy/review">Review {p.reviews_due} due concept{p.reviews_due === 1 ? '' : 's'}</a></p>}
      </header>
      <ol className="course-grid">
        {courses.data!.courses.map((c) => {
          const mine = p?.courses.find((x) => x.course_id === c.course_id);
          return (
            <li key={c.course_id} className={`course c${c.position}`}>
              <a href={`/app/academy/${c.course_id}`} className="course-link">
                <span className="num" aria-hidden="true">0{c.position}</span>
                <h2>{c.title.replace('ATLAS: ', '')}</h2>
                <p>{c.tagline}</p>
                <p className="mu">{c.modules} modules · {c.lessons ? `${c.lessons} lesson${c.lessons === 1 ? '' : 's'} available` : 'lessons in preparation'}{c.draft ? ' · draft' : ''}</p>
                {mine ? (
                  <div className="mini">
                    <span>Lessons {mine.lessons_completed}/{mine.lessons}</span>
                    <span>Mastered {mine.mastered}/{mine.objectives} objectives</span>
                  </div>
                ) : c.last_diagnostic?.readiness ? <span className="t m">Readiness check: {READINESS[c.last_diagnostic.readiness]}</span> : <span className="t c">Take the 5-question check</span>}
              </a>
            </li>
          );
        })}
      </ol>
      {p && p.courses.length > 0 && <p className="mu">{p.note}</p>}
    </div>
  );
}
