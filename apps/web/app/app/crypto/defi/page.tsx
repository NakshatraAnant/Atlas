'use client';
import { useState } from 'react';
import { compactUsd, CryptoNav, Freshness, MiniLine, pctPts, signCls, type Fresh } from '@/components/crypto';
import { Loading, Problem, useApi } from '@/components/ui';

interface Defi {
  total: number; page: number;
  rows: { protocol_id: string; name: string; category: string | null; chains: string[]; tvl_usd: number | null; change_1d_pct: number | null; change_7d_pct: number | null; tvl_rank: number; retrieved_at: string; history_points: number }[];
  categories: { category: string; n: number; tvl: number }[];
  chains: { chain: string; latest: { t: string; v: number } | null; points: number }[];
  all_tvl: { t: string; v: number }[]; stablecoin_supply: { t: string; v: number }[];
  freshness: Fresh; methodology: string; attribution: string;
}

export default function DefiPage() {
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const p = new URLSearchParams({ page: String(page) });
  if (category) p.set('category', category);
  if (q) p.set('q', q);
  const d = useApi<Defi>(`/v1/crypto/defi?${p}`);
  const x = d.data;
  return (
    <>
      <h1 style={{ margin: 0 }}>Digital Assets</h1>
      <CryptoNav />
      {d.loading && !x ? <Loading lines={8} /> : d.error ? <Problem error={d.error} retry={d.reload} /> : x && (
        <>
          <p className="mu">DeFi data from DefiLlama (free API). <Freshness f={x.freshness} label="Protocol list" /></p>
          <p className="warn">{x.methodology}</p>
          <div className="grid2">
            <section className="card">{x.all_tvl.length > 1 ? <MiniLine title="Total DeFi TVL, all chains (last 2 years, DefiLlama)" points={x.all_tvl} format={compactUsd} /> : <p className="mu">Total TVL history not imported yet.</p>}</section>
            <section className="card">{x.stablecoin_supply.length > 1 ? <MiniLine title="Total stablecoin supply (USD-pegged, DefiLlama)" points={x.stablecoin_supply} format={compactUsd} /> : <p className="mu">Stablecoin history not imported yet.</p>}</section>
          </div>
          <section className="card"><h2>Chains</h2>
            <div className="cx-kpis">{x.chains.map((c) => <div key={c.chain} className="cx-kpi"><span className="k">{c.chain}</span><span className="v">{compactUsd(c.latest?.v)}</span><span className="s">{c.latest ? `TVL on ${c.latest.t}` : 'not imported'}</span></div>)}</div>
          </section>
          <section className="card"><h2>Protocols by TVL</h2>
            <div className="cx-filters">
              <label className="field">Search<input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
              <label className="field">Category<select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}><option value="">All</option>{x.categories.map((c) => <option key={c.category} value={c.category}>{c.category} ({c.n})</option>)}</select></label>
            </div>
            <div className="wrap"><table className="term-table cx-explorer">
              <caption>{x.total} protocols (the top 300 by TVL are stored)</caption>
              <thead><tr><th scope="col" className="num">#</th><th scope="col" style={{ textAlign: 'left' }}>Protocol</th><th scope="col" style={{ textAlign: 'left' }}>Category</th><th scope="col" className="num">TVL</th><th scope="col" className="num">1 d</th><th scope="col" className="num">7 d</th><th scope="col" style={{ textAlign: 'left' }}>Chains</th></tr></thead>
              <tbody>{x.rows.map((r) => <tr key={r.protocol_id}><td className="num">{r.tvl_rank}</td><td style={{ textAlign: 'left' }}><a href={`/app/crypto/defi/${r.protocol_id}`}>{r.name}</a>{r.history_points > 0 && <span className="mu"> · history</span>}</td><td style={{ textAlign: 'left' }}>{r.category ?? '—'}</td><td className="num">{compactUsd(r.tvl_usd)}</td><td className={`num ${signCls(r.change_1d_pct)}`}>{pctPts(r.change_1d_pct)}</td><td className={`num ${signCls(r.change_7d_pct)}`}>{pctPts(r.change_7d_pct)}</td><td style={{ textAlign: 'left' }}>{r.chains.slice(0, 4).join(', ')}{r.chains.length > 4 ? ` +${r.chains.length - 4}` : ''}</td></tr>)}</tbody>
            </table></div>
            <div className="cx-pager"><button className="btn s" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span className="mu">Page {page} of {Math.max(1, Math.ceil(x.total / 50))}</span><button className="btn s" disabled={page * 50 >= x.total} onClick={() => setPage(page + 1)}>Next</button></div>
            <p className="mu">Source: {x.attribution}. TVL is not market capitalisation, revenue or profit.</p>
          </section>
        </>
      )}
    </>
  );
}
