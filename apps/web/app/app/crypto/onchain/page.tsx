'use client';
import { compactNum, CryptoNav, Freshness, Kind, utc, type Fresh } from '@/components/crypto';
import { Loading, Problem, useApi } from '@/components/ui';

interface Net {
  network_id: string; name: string; family: string; chain_id: number | null; source_id: string | null; explorer_url: string | null; capabilities: string[]; supported: boolean; freshness: Fresh;
  coverage: { n: number; lo: number | null; hi: number | null; oldest: string | null } | null;
  blocks: { height: number; block_hash: string; block_time: string; tx_count: number | null; size_bytes: number | null; gas_used: number | null; gas_limit: number | null; base_fee_gwei: number | null; total_fees_native: number | null; producer: string | null }[];
  metrics: { metric: string; value: number; unit: string; window_desc: string; methodology: string; observed_at: string }[];
}

export default function Onchain() {
  const d = useApi<{ networks: Net[]; scope: string }>('/v1/crypto/onchain');
  return (
    <>
      <h1 style={{ margin: 0 }}>Digital Assets</h1>
      <CryptoNav />
      {d.loading && !d.data ? <Loading lines={8} /> : d.error ? <Problem error={d.error} retry={d.reload} /> : d.data && (
        <>
          <p className="warn">{d.data.scope}</p>
          {d.data.networks.map((n) => (
            <section key={n.network_id} id={n.network_id} className="card" aria-labelledby={`h-${n.network_id}`}>
              <h2 id={`h-${n.network_id}`}>{n.name} <Kind k="onchain" /> {n.supported && <Freshness f={n.freshness} label="Latest block" />}</h2>
              {!n.supported ? <p className="mu">Not covered yet: no free public endpoint has been integrated and verified for this network.</p> : (
                <>
                  <p className="cx-src">Network id <code>{n.network_id}</code>{n.chain_id ? ` · EVM chain id ${n.chain_id}` : ' · no EVM chain id'} · source {n.source_id} · stored window: {n.coverage?.n ?? 0} blocks (heights {n.coverage?.lo ?? '—'}–{n.coverage?.hi ?? '—'}, oldest {utc(n.coverage?.oldest)})</p>
                  {n.metrics.length > 0 && (
                    <div className="cx-kpis">{n.metrics.map((m) => <div key={m.metric} className="cx-kpi" title={m.methodology}><span className="k">{m.metric.replace(/_/g, ' ')}</span><span className="v">{m.unit === 'ratio' ? `${(m.value * 100).toFixed(1)}%` : `${m.value.toLocaleString('en-US', { maximumFractionDigits: m.value < 10 ? 4 : 1 })} ${m.unit}`}</span><span className="s">{m.window_desc}</span></div>)}</div>
                  )}
                  <details><summary>Metric definitions</summary><ul>{n.metrics.map((m) => <li key={m.metric}><strong>{m.metric.replace(/_/g, ' ')}</strong>: {m.methodology}</li>)}</ul></details>
                  <div className="wrap"><table className="term-table">
                    <caption>Latest stored blocks</caption>
                    <thead><tr><th scope="col">Height</th><th scope="col" style={{ textAlign: 'left' }}>Time (UTC)</th><th scope="col">Transactions</th><th scope="col">Size</th>{n.family === 'evm' ? <><th scope="col">Gas used</th><th scope="col">Base fee (gwei)</th></> : <th scope="col">Fees (BTC)</th>}<th scope="col" style={{ textAlign: 'left' }}>Producer</th></tr></thead>
                    <tbody>{n.blocks.map((b) => (
                      <tr key={b.height}>
                        <td className="num">{n.explorer_url ? <a href={n.network_id === 'bitcoin' ? `${n.explorer_url}/block/${b.block_hash}` : `${n.explorer_url}/block/${b.height}`} target="_blank" rel="noreferrer noopener">{b.height}</a> : b.height}</td>
                        <td style={{ textAlign: 'left' }}>{utc(b.block_time)}</td>
                        <td className="num">{b.tx_count ?? '—'}</td>
                        <td className="num">{b.size_bytes === null ? '—' : `${compactNum(b.size_bytes)} B`}</td>
                        {n.family === 'evm' ? <><td className="num">{b.gas_used !== null && b.gas_limit ? `${((b.gas_used / b.gas_limit) * 100).toFixed(0)}%` : '—'}</td><td className="num">{b.base_fee_gwei?.toFixed(3) ?? '—'}</td></> : <td className="num">{b.total_fees_native?.toFixed(5) ?? '—'}</td>}
                        <td style={{ textAlign: 'left' }} className={n.family === 'evm' ? 'cx-addr' : ''}>{b.producer ?? '—'}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                  <p className="mu">Transaction counts are not user counts and are not a measure of adoption. {n.family === 'evm' ? 'Ethereum total fees per block need every transaction receipt and are not fetched from the free endpoint.' : 'Fees exclude the block subsidy; pool names are mempool.space attributions.'} Block links open the public explorer.</p>
                </>
              )}
            </section>
          ))}
        </>
      )}
    </>
  );
}
