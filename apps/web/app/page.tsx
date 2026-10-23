'use client';

import { Loading, Problem, Synthetic, useApi, Value } from '@/components/ui';
import { pct, cls, formatIndianNumber } from '@/lib/format';
import { useApp } from '@/components/providers';
import { useDemoMode } from '@/components/shell';

interface Summary { date: string; as_of_label: string; indices: { index_code: string; name: string; close: number; returns: Record<string, number | null>; evidence_id: string; label: string }[]; breadth: { traded: number; advances: number; declines: number; unchanged: number } | null; freshness: { label: string; stale: boolean } | null }

export default function Landing() {
  const demo = useDemoMode();
  if (demo === null) return <Loading lines={4} />;
  return demo ? <DemoLanding /> : <RealLanding />;
}

/** Real-data mode: describes only what works, and shows no provider data on a public page. */
function RealLanding() {
  const { me } = useApp();
  return (
    <>
      <section className="hero">
        <h1>A research workspace for Indian markets, digital assets, commodities and the economy, built on named, dated sources.</h1>
        <p className="mu" style={{ maxWidth: 760, fontSize: 15 }}>ATLAS stores data from permitted providers, shows where every number comes from and when it was observed, and says plainly when something is missing or out of date. It is a research and learning tool, not investment advice.</p>
        <div className="row">{me ? <a className="btn" href="/app">Open your workspace</a> : <><a className="btn" href="/signup">Create free account</a><a className="btn s" href="/login">Sign in</a></>}<a className="btn s" href="/methodology">Methodology</a></div>
      </section>
      <section className="grid2">
        <div className="card"><h2>What you can research</h2><ul>
          <li><strong>Indian indices</strong>: NIFTY 50, SENSEX and NIFTY BANK, end of day, with returns, volatility, RSI, MACD and data-quality checks.</li>
          <li><strong>Digital assets</strong>: crypto prices, market data, DeFi and on-chain statistics.</li>
          <li><strong>Commodities</strong>: oil, gas, metals and agricultural benchmarks; US energy inventories; spreads and seasonality.</li>
          <li><strong>Macro</strong>: inflation, rates, labour, financial conditions and the rupee.</li>
          <li><strong>Research hub</strong>: portfolios, correlation, walk-forward backtests, notebooks, reports and alerts on the data above and your own files.</li>
          <li><strong>Academy</strong>: structured courses with practical exercises.</li>
        </ul></div>
        <div className="card"><h2>What it does not claim</h2><ul>
          <li>No live exchange prices: Indian data is end of day.</li>
          <li>No individual NSE/BSE share prices, company financials or MCX futures: these need data licences ATLAS does not have.</li>
          <li>No recommendations, targets or predictions. Past results do not predict future results.</li>
        </ul><p className="mu">See <a href="/status">Status</a> for the current state of each data source.</p></div>
      </section>
    </>
  );
}

function DemoLanding() {
  const { me } = useApp();
  const s = useApi<Summary>('/v1/market/summary');
  return (
    <>
      <section className="hero">
        <h1>Understand a company’s financial performance and the market context around it — in one research workspace.</h1>
        <p className="mu" style={{ maxWidth: 720, fontSize: 15 }}>ATLAS connects the post-close market briefing, company fundamentals with every figure linked to its source, honest historical testing with Indian trading costs, and an AI research assistant whose numbers come from code, not guesses. This is a product promise, not a promise of investment returns.</p>
        <div className="row">{me ? <a className="btn" href="/app">Open your workspace</a> : <><a className="btn" href="/signup">Create free account</a><a className="btn s" href="/briefing-sample">Read a sample briefing</a></>}<a className="btn s" href="/methodology/ai">How AI answers work</a></div>
      </section>
      <section className="card" aria-labelledby="mkt">
        <h2 id="mkt">Latest session {s.data && <span className="mu">· {s.data.as_of_label}</span>}</h2>
        <p><Synthetic /> <span className="mu">This environment runs on fictional companies so the product can be tried without licensed data.</span></p>
        {s.loading && <Loading />}
        <Problem error={s.error} retry={s.reload} />
        {s.data && (
          <div className="grid">
            {s.data.indices.filter((i) => i.label.startsWith('Price')).map((i) => (
              <div key={i.index_code} className="card" style={{ margin: 0 }}>
                <div className="mu">{i.name}</div>
                <div className="big">{formatIndianNumber(i.close, 2)}</div>
                <div className={cls(i.returns['1D'])}>{pct(i.returns['1D'])} on the day</div>
                <div className="mu">{i.label} · {s.data!.freshness?.label ?? 'End of day'}</div>
              </div>
            ))}
            {s.data.breadth && <div className="card" style={{ margin: 0 }}><div className="mu">Breadth</div><div className="big">{s.data.breadth.advances} / {s.data.breadth.traded}</div><div className="mu">advanced ({s.data.breadth.declines} declined, {s.data.breadth.unchanged} unchanged)</div></div>}
          </div>
        )}
      </section>
      <section className="grid2">
        <div className="card"><h2>Every number opens its evidence</h2><p>Click any figure to see its source, reporting period, filing date, retrieval time, definition version and validation status. Restatements and source conflicts are shown, never hidden.</p><p className="mu">Illustrative figure, not a real company: <Value v={18.4} unit="percent" /> operating margin. In the product, each figure opens the filing it came from.</p></div>
        <div className="card"><h2>AI that shows its work</h2><p>Six-part answers: the direct answer, the figures, the method, sources and periods, uncertainties, and links to inspect the data. Every number is checked against tool outputs before you see it. ATLAS does not give buy, sell or hold views, targets or predictions.</p></div>
        <div className="card"><h2>Historical tests, honestly</h2><p>Five templates with STT, exchange charges, stamp duty, GST and slippage included by default; point-in-time universes that include later-delisted companies; warnings for few trades, cost sensitivity and overfitting. Historical results do not indicate future performance.</p></div>
        <div className="card"><h2>ATLAS Academy</h2><p>Four courses — MARKET DECODER, EQUITY DETECTIVE, SIGNAL ENGINEER and MARKET ARCHITECT — from how a share works to defending a research dossier, each starting with a five-question readiness check. Education, not advice. <a href="/app/academy">Open the Academy</a></p></div>
        <div className="card"><h2>Research memory</h2><p>Watchlists, notes with dated table snapshots, saved workspaces and material-change alerts when results are filed or promoter holdings move.</p></div>
      </section>
      <section className="card"><h2>Plans</h2><p>Free to start. Plus ₹499 a month + GST and Pro Research ₹1,499 a month + GST. Cancel in two screens. <a href="/pricing">Compare plans</a></p></section>
    </>
  );
}
