'use client';
import { use } from 'react';
import { compactUsd, CryptoNav, MiniLine, pctPts, signCls, utc } from '@/components/crypto';
import { Loading, Problem, useApi } from '@/components/ui';

interface P {
  protocol: { protocol_id: string; name: string; category: string | null; chains: string[]; url: string | null; description: string | null; tvl_usd: number | null; change_1d_pct: number | null; change_7d_pct: number | null; tvl_rank: number | null; retrieved_at: string; asset_key: string | null; asset_symbol: string | null };
  tvl: { t: string; v: number }[]; fees: { t: string; v: number }[]; revenue: { t: string; v: number }[];
  availability: Record<string, string>; definitions: Record<string, string>; source_url: string;
}

const sum30 = (xs: { v: number }[]) => (xs.length >= 30 ? xs.slice(-30).reduce((a, b) => a + b.v, 0) : null);

export default function Protocol({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const d = useApi<P>(`/v1/crypto/defi/${id}`);
  if (d.loading && !d.data) return <><CryptoNav /><Loading lines={8} /></>;
  if (d.error) return <><CryptoNav /><Problem error={d.error} retry={d.reload} /></>;
  const x = d.data!;
  const p = x.protocol;
  const recent = (xs: { t: string; v: number }[]) => xs.slice(-730);
  return (
    <>
      <CryptoNav />
      <header className="card">
        <h1 style={{ marginTop: 0 }}>{p.name} <span className="mu">{p.category}</span></h1>
        <p><strong>{compactUsd(p.tvl_usd)}</strong> TVL · <span className={signCls(p.change_1d_pct)}>{pctPts(p.change_1d_pct)} 1 d</span> · <span className={signCls(p.change_7d_pct)}>{pctPts(p.change_7d_pct)} 7 d</span> · rank {p.tvl_rank ?? '—'}</p>
        {p.description && <p>{p.description}</p>}
        <p className="cx-src">Chains: {p.chains.join(', ') || '—'}. {p.asset_key && <>Token: <a href={`/app/crypto/assets/${p.asset_key}`}>{p.asset_symbol}</a>. </>}Source: <a href={x.source_url} target="_blank" rel="noreferrer noopener">DefiLlama</a>, retrieved {utc(p.retrieved_at)}.{p.url && <> Project site: <a href={p.url} target="_blank" rel="noreferrer noopener">{p.url}</a></>}</p>
      </header>
      <div className="grid2">
        <section className="card">{x.tvl.length > 1 ? <MiniLine title="TVL (USD), daily, up to 2 years" points={recent(x.tvl)} format={compactUsd} /> : <p className="mu">TVL history: {x.availability.tvl}.</p>}</section>
        <section className="card"><h2>Fees and revenue</h2>
          <dl className="term-kv">
            <dt>Fees, last 30 days</dt><dd>{sum30(x.fees) === null ? <span className="mu">{x.availability.fees}</span> : compactUsd(sum30(x.fees))}</dd>
            <dt>Revenue, last 30 days</dt><dd>{sum30(x.revenue) === null ? <span className="mu">{x.availability.revenue}</span> : compactUsd(sum30(x.revenue))}</dd>
          </dl>
          {x.fees.length > 1 && <MiniLine title="Daily fees (USD)" points={recent(x.fees)} format={compactUsd} height={120} />}
          {x.revenue.length > 1 && <MiniLine title="Daily revenue (USD)" points={recent(x.revenue)} format={compactUsd} height={120} />}
        </section>
      </div>
      <section className="card"><h2>Definitions</h2><dl>{Object.entries(x.definitions).map(([k, v]) => <div key={k}><dt><strong>{k.toUpperCase()}</strong></dt><dd>{v}</dd></div>)}</dl>
        <p className="mu">Protocol fees and revenue are not company revenue or profit, and TVL is not a valuation. Compare protocols only within the same provider's methodology.</p></section>
    </>
  );
}
