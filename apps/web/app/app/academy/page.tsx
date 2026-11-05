'use client';
import { useApp } from '@/components/providers';
import { Empty, Loading, Problem, useApi } from '@/components/ui';

interface Course {
  course_id: string; title: string; tagline: string; description: string; audience: string; position: number; track: 'equities' | 'digital_assets' | 'commodities'; level: number; draft: boolean; status: string; available: boolean;
  modules: number; lessons: number; minutes: number; enrolment: { entry_route: string } | null; last_diagnostic: { readiness: string | null } | null;
}
interface Progress { courses: { course_id: string; title: string; lessons: number; lessons_completed: number; objectives: number; mastered: number }[]; reviews_due: number; note: string }
interface MeLite { xp: { level: number; xp: number }; streak: { daily: { current: number; today_active: boolean } }; recommendation: { title: string; reason: string; href?: string } }
interface Catalogue { courses: Course[]; not_a_qualification: string; preview_mode: boolean; review_note: string }

const READINESS: Record<string, string> = { high: 'Ready', borderline: 'Nearly ready', low: 'Review first' };
const LEVEL: Record<number, string> = { 1: 'Beginner', 2: 'Intermediate', 3: 'Advanced', 4: 'Expert' };
const STATUS: Record<string, string> = { published: 'Published', in_review: 'In expert review', draft: 'Draft' };
const hours = (m: number) => (m >= 60 ? `about ${Math.round(m / 6) / 10} h` : `${m} min`);

export default function AcademyHome() {
  const courses = useApi<Catalogue>('/v1/academy/courses');
  const showStreak = useApp().me?.profile.display_prefs?.show_streak !== false;
  const progress = useApi<Progress>('/v1/academy/progress');
  const me = useApi<MeLite>('/v1/academy/me');
  if (courses.loading) return <Loading lines={6} label="Loading courses" />;
  if (courses.error) return <Problem error={courses.error} retry={courses.reload} />;
  const cat = courses.data!;
  const p = progress.data;
  // The most useful next action: continue an enrolled course, else start with the first available one.
  const enrolled = cat.courses.find((c) => c.enrolment && c.available);
  const firstOpen = cat.courses.find((c) => c.available);
  return (
    <div className="academy">
      <header className="ac-hero">
        <p className="eyebrow">ATLAS Academy</p>
        <h1>Learn to read markets the way ATLAS does: with evidence.</h1>
        <p className="mu" style={{ maxWidth: 640 }}>Two tracks of four courses: Indian equities, from how a share works to defending a valuation, and digital assets, from how a blockchain works to an evidence-based crypto research report. Each starts with a five-question readiness check so you begin at the right place. {cat.not_a_qualification}</p>
        {me.data && (
          <div className="card next-action">
            <p className="big">Next: {me.data.recommendation.href ? <a href={me.data.recommendation.href}>{me.data.recommendation.title}</a> : me.data.recommendation.title}</p>
            <p className="mu">{me.data.recommendation.reason} · Level {me.data.xp.level} · {me.data.xp.xp} XP{showStreak ? ` · ${me.data.streak.daily.current}-day streak` : ''}</p>
          </div>
        )}
        <p className={cat.preview_mode ? 'warn' : 'mu'} role="note">{cat.review_note}</p>
        <p className="ac-actions">
          {enrolled ? <a className="btn" href={`/app/academy/${enrolled.course_id}`}>Continue {enrolled.title.replace('ATLAS: ', '')}</a> : firstOpen ? <a className="btn" href={`/app/academy/${firstOpen.course_id}`}>Start with {firstOpen.title.replace('ATLAS: ', '')}</a> : null}
          {p && p.reviews_due > 0 && <a className="btn s" href="/app/academy/review">Review {p.reviews_due} due concept{p.reviews_due === 1 ? '' : 's'}</a>}
          {firstOpen && <a className="btn s" href="/app/academy/games">Practice games</a>}
          <a className="btn s" href="/app/academy/progress">My progress and achievements</a>
        </p>
      </header>
      {cat.courses.length === 0 ? (
        <Empty>No courses are set up in this environment yet. The curriculum loads when the API starts; if this persists, check the API log for the curriculum sync.</Empty>
      ) : (
        <>{(['equities', 'digital_assets', 'commodities'] as const).map((t) => cat.courses.some((c) => c.track === t) && (
          <section key={t} aria-labelledby={`track-${t}`}>
            <h2 id={`track-${t}`} className="eyebrow" style={{ margin: '18px 0 8px' }}>{t === 'equities' ? 'Track 1 · Indian equities' : t === 'digital_assets' ? 'Track 2 · Digital assets' : 'Track 3 · Commodities'}</h2>
          <ol className="course-grid">
          {cat.courses.filter((c) => c.track === t).map((c) => {
            const mine = p?.courses.find((x) => x.course_id === c.course_id);
            return (
              <li key={c.course_id} className={`course c${c.level}${c.available ? '' : ' locked'}`}>
                <a href={`/app/academy/${c.course_id}`} className="course-link" aria-describedby={`st-${c.course_id}`}>
                  <span className="num" aria-hidden="true">0{c.level}</span>
                  <span className="level">{LEVEL[c.level] ?? ''}</span>
                  <h2>{c.title.replace('ATLAS: ', '')}</h2>
                  <p>{c.tagline}</p>
                  <p className="mu">
                    {c.modules} modules
                    {c.available ? ` · ${c.lessons} lesson${c.lessons === 1 ? '' : 's'} · ${hours(c.minutes)}` : ''}
                  </p>
                  <p id={`st-${c.course_id}`} className="mu">
                    Status: {STATUS[c.status] ?? c.status}{c.available && c.draft ? ' · shown as a draft preview' : ''}{!c.available ? ' · not yet open' : ''}
                  </p>
                  {!c.available ? <span className="t">Opens after expert review</span> : mine ? (
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
          </section>
        ))}</>
      )}
      {p && p.courses.length > 0 && <p className="mu">{p.note}</p>}
      <p className="mu">Prefer short concept notes? See <a href="/app/learn">Quick lessons</a>.</p>
    </div>
  );
}
