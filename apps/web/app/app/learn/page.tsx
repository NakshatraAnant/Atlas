'use client';
import { Loading, Problem, useApi } from '@/components/ui';

export default function Learn() {
  const p = useApi<{ path: { id: string; title: string; lessons: { slug: string; order: number; title: string; minutes: number; progress: { completed_at: string | null; quiz_score: number | null } | null; locked?: boolean }[] }; all_lessons_included: boolean }>('/v1/learn/paths');
  if (p.loading) return <Loading />;
  if (p.error) return <Problem error={p.error} retry={p.reload} />;
  const d = p.data!;
  const done = d.path.lessons.filter((l) => l.progress?.completed_at).length;
  return (
    <>
      <h1>Learn</h1>
      <p className="mu">Short lessons on reading companies and markets, each linked to the screens where the idea is used. Lessons teach concepts; they do not recommend securities.</p>
      <section className="card">
        <h2>{d.path.title}</h2>
        <div className="meter" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={d.path.lessons.length} aria-label="Lessons completed"><i style={{ width: `${(done / Math.max(1, d.path.lessons.length)) * 100}%` }} /></div>
        <p className="mu">{done} of {d.path.lessons.length} completed</p>
        <ol>{d.path.lessons.map((l) => (
          <li key={l.slug}>{l.locked ? <span>{l.title} <span className="mu">· part of Plus and Pro</span></span> : <a href={`/app/learn/${l.slug}`}>{l.title}</a>} <span className="mu">{l.minutes} min{l.progress?.completed_at ? ` · completed${l.progress.quiz_score !== null ? `, quiz ${l.progress.quiz_score}` : ''}` : ''}</span></li>
        ))}</ol>
        {!d.all_lessons_included && <p className="mu">Free includes the first lessons. <a href="/pricing">Compare plans</a></p>}
      </section>
    </>
  );
}
