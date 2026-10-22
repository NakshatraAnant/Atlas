'use client';
import { useEffect, useState } from 'react';
import { compactNum, compactUsd, CryptoNav, Kind, pctPts, signCls, SymbolBadge, usd, utc } from '@/components/crypto';
import { Loading, Problem, useApi } from '@/components/ui';

interface Row { canonical_key: string; name: string; symbol: string; classification: string; category: string | null; primary_network_id: string | null; listing_status: string; market_cap_rank: number | null; price: number | null; change_24h_pct: number | null; change_7d_pct: number | null; market_cap: number | null; volume_24h: number | null; fdv: number | null; circulating_supply: number | null; max_supply: number | null; retrieved_at: string | null; history_series: number; networks: string[] | null }
interface Page { total: number; page: number; per: number; sort: string; dir: string; rows: Row[]; note: string }

const COLS: [string, string][] = [['rank', '#'], ['name', 'Asset'], ['price', 'Price (USD)'], ['change_24h', '24 h'], ['change_7d', '7 d'], ['market_cap', 'Market cap'], ['volume', '24 h volume']];

export default function Explorer() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sort, setSort] = useState('rank');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [cls, setCls] = useState('');
  const [watch, setWatch] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const params = new URLSearchParams({ sort, dir, page: String(page), per: '50' });
  if (debounced) params.set('q', debounced);
  if (cls) params.set('classification', cls);
  if (watch) params.set('watchlist', 'true');
  const r = useApi<Page>(`/v1/crypto/assets?${params}`);
  const setSortCol = (k: string) => {
    if (k === sort) setDir(dir === 'asc' ? 'desc' : 'asc');
    else { setSort(k); setDir(k === 'rank' || k === 'name' ? 'asc' : 'desc'); }
    setPage(1);
  };
  const d = r.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.per)) : 1;
  return (
    <>
      <h1 style={{ margin: 0 }}>Digital Assets</h1>
      <CryptoNav />
      <div className="cx-filters">
        <label className="field">Search name, symbol or id<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. ethereum or SOL" aria-describedby="sym-note" /></label>
        <label className="field">Type<select value={cls} onChange={(e) => { setCls(e.target.value); setPage(1); }}><option value="">All</option><option value="native_coin">Native coins</option><option value="token">Tokens</option><option value="unknown">Not yet classified</option></select></label>
        <label className="row" style={{ gap: 6, alignItems: 'center' }}><input type="checkbox" checked={watch} onChange={(e) => { setWatch(e.target.checked); setPage(1); }} />My watchlist only</label>
      </div>
      <p id="sym-note" className="mu">Symbols are not unique: different assets can share a ticker. Each row is one asset identified by its CoinGecko id. <Kind k="reference" /> prices; supply figures are <Kind k="provider_estimate" />.</p>
      {r.loading && !d ? <Loading lines={10} /> : r.error ? <Problem error={r.error} retry={r.reload} /> : d && (
        <section className="card">
          <div className="wrap"><table className="term-table cx-explorer">
            <caption>{d.total} assets{debounced ? ` matching “${debounced}”` : ''}, sorted by {COLS.find((c) => c[0] === sort)?.[1]} ({dir === 'asc' ? 'ascending' : 'descending'})</caption>
            <thead><tr>
              {COLS.map(([k, l]) => <th key={k} scope="col" className={k === 'name' ? '' : 'num'} style={k === 'name' ? { textAlign: 'left' } : undefined} aria-sort={sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}><button className="link" onClick={() => setSortCol(k)}>{l}{sort === k ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>)}
              <th scope="col" className="num">Circulating / max supply</th><th scope="col">Type</th><th scope="col">History</th>
            </tr></thead>
            <tbody>{d.rows.map((x) => (
              <tr key={x.canonical_key}>
                <td className="num">{x.market_cap_rank ?? '—'}</td>
                <td style={{ textAlign: 'left' }}><SymbolBadge symbol={x.symbol} /><a href={`/app/crypto/assets/${x.canonical_key}`}>{x.name}</a> <span className="mu">{x.symbol} · {x.canonical_key}</span>{x.listing_status !== 'listed' && <span className="t r"> not in latest snapshot</span>}</td>
                <td className="num">{usd(x.price)}</td>
                <td className={`num ${signCls(x.change_24h_pct)}`}>{pctPts(x.change_24h_pct)}</td>
                <td className={`num ${signCls(x.change_7d_pct)}`}>{pctPts(x.change_7d_pct)}</td>
                <td className="num">{compactUsd(x.market_cap)}</td>
                <td className="num">{compactUsd(x.volume_24h)}</td>
                <td className="num">{compactNum(x.circulating_supply)} / {x.max_supply === null ? <span className="mu" title="No maximum supply defined by the provider">none</span> : compactNum(x.max_supply)}</td>
                <td>{x.classification === 'native_coin' ? 'Native coin' : x.classification === 'token' ? `Token${x.networks?.length ? ` (${x.networks.join(', ')})` : ''}` : <span className="mu">—</span>}</td>
                <td>{x.history_series ? `${x.history_series} series` : <span className="mu">none yet</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
          {!d.rows.length && <p className="mu">No assets match. Assets appear after the CoinGecko market import (top {d.per >= 100 ? d.per : 100} by market capitalisation).</p>}
          <div className="cx-pager">
            <button className="btn s" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span className="mu">Page {page} of {pages}</span>
            <button className="btn s" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
          <p className="mu">Source: CoinGecko, Powered by CoinGecko. Snapshot retrieved {utc(d.rows[0]?.retrieved_at)}. {d.note}</p>
        </section>
      )}
    </>
  );
}
