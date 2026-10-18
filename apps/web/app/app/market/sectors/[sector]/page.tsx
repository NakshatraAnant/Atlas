'use client';
import { use } from 'react';
import { Loading, Problem, useApi, Value } from '@/components/ui';
import { cls, fmt, formatDate, pct } from '@/lib/format';

interface Sector {
  sector: string; date: string; evidence_id: string;
  aggregate: { ret_equal: number; ret_cap: number; constituents: number; advances: number; declines: number; classification_version: number } | null;
  constituents: { company_id: string; short_name: string; industry: string; ret_1d: number | null; market_cap_cr: number | null; adj_close: number | null; sma_50: number | null; above_50dma: boolean | null }[];
  announcements: { announcement_id: string; company_id?: string; short_name?: string; subject: string; published_at: string }[];
}

export default function SectorPage({ params }: { params: Promise<{ sector: string }> }) {
  const { sector } = use(params);
  const date = typeof window !== 'undefined' ? new URLSearchParams(location.search).get('date') : null;
  const s = useApi<Sector>(`/v1/market/sectors/${sector}${date ? `?date=${date}` : ''}`);
  if (s.loading) return <Loading lines={6} />;
  if (s.error) return <Problem error={s.error} retry={s.reload} />;
  const d = s.data!;
  return (
    <>
      <p><a href="/app/market">← Market</a></p>
      <h1>{d.sector}</h1>
      <p className="mu">{formatDate(d.date)} · end of day · covered companies only (classification version {d.aggregate?.classification_version ?? '—'})</p>
      {d.aggregate && (
        <div className="grid">
          <div className="card"><div className="mu">Equal-weighted move</div><div className={`big ${cls(d.aggregate.ret_equal)}`}><Value evidence={d.evidence_id} surface="sector">{pct(d.aggregate.ret_equal * 100)}</Value></div></div>
          <div className="card"><div className="mu">Cap-weighted move</div><div className={`big ${cls(d.aggregate.ret_cap)}`}>{pct(d.aggregate.ret_cap * 100)}</div></div>
          <div className="card"><div className="mu">Up / down</div><div className="big">{d.aggregate.advances} / {d.aggregate.declines}</div></div>
        </div>
      )}
      <div className="wrap card">
        <table>
          <caption>Constituents</caption>
          <thead><tr><th scope="col">Company</th><th scope="col">Industry</th><th scope="col">1-day move</th><th scope="col">Market cap</th><th scope="col">Close (adjusted)</th><th scope="col">vs 50-day average</th></tr></thead>
          <tbody>{d.constituents.map((c) => (
            <tr key={c.company_id}>
              <th scope="row"><a href={`/app/companies/${c.company_id}`}>{c.short_name}</a></th><td>{c.industry}</td>
              <td className={cls(c.ret_1d)}>{c.ret_1d === null ? '—' : pct(c.ret_1d * 100)}</td>
              <td>{fmt(c.market_cap_cr, 'INR_cr')}</td><td>{fmt(c.adj_close, 'INR')}</td>
              <td>{c.above_50dma === null ? '—' : c.above_50dma ? 'Above' : 'Below'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <section className="card"><h2>Announcements on this date</h2>
        {d.announcements.length === 0 ? <p className="mu">No announcements from companies in this sector on this date.</p> : <ul>{d.announcements.map((a) => <li key={a.announcement_id}>{a.short_name ? `${a.short_name}: ` : ''}<a href={`/v1/documents/${a.announcement_id}`}>{a.subject}</a></li>)}</ul>}
      </section>
    </>
  );
}
