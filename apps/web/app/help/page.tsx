'use client';
import { useState } from 'react';
import { Loading, Problem, useApi } from '@/components/ui';

export default function Help() {
  const [q, setQ] = useState('');
  const h = useApi<{ total: number; articles: { slug: string; category: string; title: string; body: string }[] }>(`/v1/help?q=${encodeURIComponent(q)}`, [q]);
  return (
    <>
      <h1>Help centre</h1>
      <label className="field">Search {h.data ? `${h.data.total} articles` : 'articles'}<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="refund, stale, backtest costs…" /></label>
      {h.loading && <Loading />}
      <Problem error={h.error} />
      <div className="grid">{h.data?.articles.map((a) => <a key={a.slug} className="card" href={`/help/${a.slug}`}><span className="t m">{a.category}</span><h3>{a.title}</h3><p className="mu">{a.body.slice(0, 120)}…</p></a>)}</div>
      {h.data && !h.data.articles.length && <p className="mu">No articles match. Use “Send feedback” at the bottom of the page to contact support.</p>}
    </>
  );
}
