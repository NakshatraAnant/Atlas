'use client';

import { Loading, Problem, Synthetic, useApi, Value } from '@/components/ui';
import { pct, cls, formatIndianNumber } from '@/lib/format';
import { useApp } from '@/components/providers';

interface Summary { date: string; as_of_label: string; indices: { index_code: string; name: string; close: number; returns: Record<string, number | null>; evidence_id: string; label: string }[]; breadth: { traded: number; advances: number; declines: number; unchanged: number } | null; freshness: { label: string; stale: boolean } | null }

export default function Landing() {
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
        <div className="card"><h2>Every number opens its evidence</h2><p>Click any figure to see its source, reporting period, filing date, retrieval time, definition version and validation status. Restatements and source conflicts are shown, never hidden.</p><p className="mu">Example: <Value v={18.4} unit="percent" /> operating margin — in the product this opens the filing it came from.</p></div>
        <div className="card"><h2>AI that shows its work</h2><p>Six-part answers: the direct answer, the figures, the method, sources and periods, uncertainties, and links to inspect the data. Every number is checked against tool outputs before you see it. ATLAS does not give buy, sell or hold views, targets or predictions.</p></div>
        <div className="card"><h2>Historical tests, honestly</h2><p>Five templates with STT, exchange charges, stamp duty, GST and slippage included by default; point-in-time universes that include later-delisted companies; warnings for few trades, cost sensitivity and overfitting. Historical results do not indicate future performance.</p></div>
        <div className="card"><h2>ATLAS Academy</h2><p>Four courses — MARKET DECODER, EQUITY DETECTIVE, SIGNAL ENGINEER and MARKET ARCHITECT — from how a share works to defending a research dossier, each starting with a five-question readiness check. Education, not advice. <a href="/app/academy">Open the Academy</a></p></div>
        <div className="card"><h2>Research memory</h2><p>Watchlists, notes with dated table snapshots, saved workspaces and material-change alerts when results are filed or promoter holdings move.</p></div>
      </section>
      <section className="card"><h2>Plans</h2><p>Free to start. Plus ₹499 a month + GST and Pro Research ₹1,499 a month + GST. Cancel in two screens. <a href="/pricing">Compare plans</a></p></section>
    </>
  );
}
