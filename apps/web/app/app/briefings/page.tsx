'use client';
import { Loading, Problem, useApi } from '@/components/ui';
import { formatDate } from '@/lib/format';

export default function Briefings() {
  const b = useApi<{ briefings: { trade_date: string; status: string; published_at: string | null }[] }>('/v1/market/briefings');
  return (
    <>
      <h1>Briefing archive</h1>
      <p className="mu">Each briefing is kept as published. Corrections are listed in the <a href="/methodology/corrections">correction log</a>.</p>
      {b.loading ? <Loading /> : b.error ? <Problem error={b.error} retry={b.reload} /> : (
        <ul className="card">{b.data!.briefings.map((x) => <li key={x.trade_date}><a href={`/app/briefings/${x.trade_date}`}>{formatDate(x.trade_date)}</a> <span className="mu">{x.status === 'published' ? 'Published' : x.status === 'held' ? 'Held back by quality checks' : 'Market holiday'}</span></li>)}</ul>
      )}
    </>
  );
}
