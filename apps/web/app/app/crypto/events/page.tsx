'use client';
import { useState } from 'react';
import { CryptoNav, utc } from '@/components/crypto';
import { Loading, Problem, useApi } from '@/components/ui';

interface E { event_id: string; category: string; headline: string; source_id: string; provider: string; source_url: string; published_at: string; event_at: string | null; retrieved_at: string; verification: string; network_ids: string[]; assets: string[] | null }

const CATS = ['', 'software_release', 'network_upgrade', 'protocol_announcement', 'listing_change'];

export default function Events() {
  const [cat, setCat] = useState('');
  const [page, setPage] = useState(1);
  const d = useApi<{ rows: E[]; scope: string }>(`/v1/crypto/events?page=${page}${cat ? `&category=${cat}` : ''}`);
  return (
    <>
      <h1 style={{ margin: 0 }}>Digital Assets</h1>
      <CryptoNav />
      {d.loading && !d.data ? <Loading lines={8} /> : d.error ? <Problem error={d.error} retry={d.reload} /> : d.data && (
        <>
          <p className="warn">Scope: {d.data.scope}</p>
          <div className="cx-filters"><label className="field">Category<select value={cat} onChange={(e) => { setCat(e.target.value); setPage(1); }}>{CATS.map((c) => <option key={c} value={c}>{c ? c.replace(/_/g, ' ') : 'All'}</option>)}</select></label></div>
          <section className="card">
            <ol className="term-feed" style={{ maxHeight: 'none' }}>{d.data.rows.map((e) => (
              <li key={e.event_id}>
                <time dateTime={e.published_at} title="Publication time at the source">{utc(e.published_at)}</time>
                <span className="t c">{e.category.replace(/_/g, ' ')}</span>
                <a href={e.source_url} target="_blank" rel="noreferrer noopener">{e.headline}</a>
                <span className="mu">{e.verification === 'observed_by_atlas' ? 'Observed by ATLAS (time of detection)' : e.provider}{e.network_ids.length ? ` · ${e.network_ids.join(', ')}` : ''}{e.assets?.length ? ` · ${e.assets.join(', ')}` : ''} · retrieved {utc(e.retrieved_at)}</span>
              </li>
            ))}</ol>
            {!d.data.rows.length && <p className="mu">No events in this category.</p>}
            <div className="cx-pager"><button className="btn s" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</button><span className="mu">Page {page}</span><button className="btn s" disabled={d.data.rows.length < 50} onClick={() => setPage(page + 1)}>Older</button></div>
            <p className="mu">Headlines are the source's own titles; follow the link for the original. ATLAS does not summarise or rewrite them.</p>
          </section>
        </>
      )}
    </>
  );
}
