'use client';
import { DraftBanner } from '@/components/academy';
import { Loading, Problem, useApi } from '@/components/ui';

interface G { id: string; title: string; course_id: string; mechanic: 'classify' | 'tune'; intro: string; last: { correct: number; total: number; played_at: string } | null }

export default function Games() {
  const g = useApi<{ games: G[]; note: string }>('/v1/academy/games');
  if (g.loading) return <Loading lines={5} label="Loading games" />;
  if (g.error) return <Problem error={g.error} retry={g.reload} />;
  return (
    <div className="academy">
      <p><a href="/app/academy">← Academy</a></p>
      <header className="ac-hero"><p className="eyebrow">Practice</p><h1>Learning games</h1><p className="mu" style={{ maxWidth: 640 }}>{g.data!.note} Each game practises one learning objective with fixed, explained rules.</p></header>
      <DraftBanner what="Game content" />
      <ul className="course-grid">
        {g.data!.games.map((x) => (
          <li key={x.id} className="course">
            <a className="course-link" href={`/app/academy/games/${x.id}`}>
              <h2>{x.title}</h2>
              <p>{x.intro}</p>
              <p className="mu">{x.mechanic === 'classify' ? 'Sort and classify' : 'Adjust inputs to meet targets'}{x.last ? ` · last result ${x.last.correct}/${x.last.total}` : ''}</p>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
