'use client';

import { Loading, Problem, Synthetic, useApi, Value } from '@/components/ui';
import { pct, cls, formatIndianNumber } from '@/lib/format';
import { useApp } from '@/components/providers';
import { useDemoMode } from '@/components/shell';
import { Reveal } from '@/components/motion';
import { Hero3D } from '@/components/hero3d';

interface Summary { date: string; as_of_label: string; indices: { index_code: string; name: string; close: number; returns: Record<string, number | null>; evidence_id: string; label: string }[]; breadth: { traded: number; advances: number; declines: number; unchanged: number } | null; freshness: { label: string; stale: boolean } | null }

export default function Landing() {
  const demo = useDemoMode();
  if (demo === null) return <Loading lines={4} />;
  return demo ? <DemoLanding /> : <RealLanding />;
}

/**
 * Real-data mode landing. One goal (start free), stated the same way at the top and the bottom; a short
 * "how it works"; three benefits; the honest limits one click away. No provider data on a public page.
 */
function RealLanding() {
  const { me } = useApp();
  const cta = me ? { href: '/app', label: 'Open your workspace' } : { href: '/signup', label: 'Start free' };
  return (
    <div className="lp">
      <section className="lp-hero">
        <div className="lp-copy">
          <p className="lp-eyebrow">Research workspace · Learning academy</p>
          <h1>Understand markets with evidence, not noise.</h1>
          <p className="lp-sub">Indian indices, global macro, commodities and crypto, with the source and date of every number. Plus nine hands-on courses with 3D charts built on real data.</p>
          <div className="lp-ctas">
            <a className="btn btn-cta btn-lg" href={cta.href}>{cta.label} <span aria-hidden="true">→</span></a>
            <a className="lp-link" href="#how">See how it works</a>
          </div>
          {!me && <p className="lp-micro">Free plan · No card needed · Education and research, not investment advice</p>}
        </div>
        <HeroVisual />
      </section>

      <p className="lp-sources" aria-label="Data sources">Data from <strong>FRED</strong> · <strong>U.S. EIA</strong> · <strong>EODHD</strong> · <strong>CoinGecko</strong>, stored with dates and provenance</p>

      <section id="how" className="lp-section" aria-labelledby="how-h">
        <Reveal><h2 id="how-h" className="lp-h2">Three steps to your first insight</h2></Reveal>
        <ol className="lp-steps">
          {[
            ['1', 'Pick your markets', 'Choose what you follow: Indian indices, crypto, commodities or the economy. Home shows only that.'],
            ['2', 'Follow what matters', 'Follow a series and get a notice when new data lands, with the date it refers to.'],
            ['3', 'Learn by doing', 'Short lessons with 3D charts and labs on the same real data, from first principles to research reports.'],
          ].map(([n, t, d], i) => (
            <Reveal key={n} as="li" delay={i * 90} className="lp-step"><span className="lp-step-n" aria-hidden="true">{n}</span><h3>{t}</h3><p>{d}</p></Reveal>
          ))}
        </ol>
      </section>

      <section className="lp-section" aria-labelledby="why-h">
        <Reveal><h2 id="why-h" className="lp-h2">Built to be trusted</h2></Reveal>
        <div className="lp-cards">
          {[
            ['◎', 'Every number has a source', 'Each figure shows where it came from, the period it refers to and how fresh it is. Missing data stays missing.'],
            ['△', 'Research that stays honest', 'Backtests are tested out of sample, with costs, next to buy-and-hold. Portfolios are clearly hypothetical.'],
            ['◇', 'Learning you can see', 'Turn a 3D futures curve, watch an overfit strategy fall apart, and practise on real series.'],
          ].map(([icon, t, d], i) => (
            <Reveal key={t} delay={i * 90} className="lp-card"><span className="lp-icon" aria-hidden="true">{icon}</span><h3>{t}</h3><p>{d}</p></Reveal>
          ))}
        </div>
        <details className="lp-limits">
          <summary>What ATLAS does not do</summary>
          <ul>
            <li>No live exchange prices: Indian data is end of day; crypto is about 15 minutes delayed.</li>
            <li>No individual NSE/BSE share prices, company financials or MCX futures: these need data licences ATLAS does not have.</li>
            <li>No recommendations, targets or predictions. Past results do not predict future results.</li>
          </ul>
          <p className="mu">Current state of each data source: <a href="/status">Status</a> · How figures are calculated: <a href="/methodology">Methodology</a></p>
        </details>
      </section>

      <Reveal as="section" className="lp-final">
        <h2>Start researching in under a minute.</h2>
        <p>Free to start. Upgrade only if you need more.</p>
        <a className="btn btn-cta btn-lg" href={cta.href}>{cta.label} <span aria-hidden="true">→</span></a>
        {!me && <p className="lp-micro">Already have an account? <a href="/login">Sign in</a></p>}
      </Reveal>
    </div>
  );
}

/** Abstract animated 3D product motif (no data values); the 2D line drawing is the fallback without WebGL. */
function HeroVisual() {
  return (
    <div className="lp-visual" aria-hidden="true">
      <Hero3D height={340} className="lp-3d" fallback={<svg viewBox="0 0 480 320" className="lp-svg">
        <defs>
          <linearGradient id="lpfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#d9b56c" stopOpacity=".35" /><stop offset="100%" stopColor="#d9b56c" stopOpacity="0" /></linearGradient>
        </defs>
        {[60, 120, 180, 240].map((y) => <line key={y} x1="20" x2="460" y1={y} y2={y} className="lp-grid" />)}
        <path className="lp-area" d="M20 230 C 70 210, 100 240, 140 200 S 220 150, 260 170 S 340 110, 380 120 S 440 70, 460 64 L 460 280 L 20 280 Z" fill="url(#lpfill)" />
        <path className="lp-line l1" d="M20 230 C 70 210, 100 240, 140 200 S 220 150, 260 170 S 340 110, 380 120 S 440 70, 460 64" />
        <path className="lp-line l2" d="M20 180 C 80 190, 120 160, 170 170 S 250 210, 300 190 S 380 200, 460 160" />
        <path className="lp-line l3" d="M20 260 C 90 250, 140 262, 200 240 S 300 236, 340 226 S 420 214, 460 206" />
        <circle r="6" className="lp-dot"><animateMotion dur="7s" repeatCount="indefinite" path="M20 230 C 70 210, 100 240, 140 200 S 220 150, 260 170 S 340 110, 380 120 S 440 70, 460 64" /></circle>
      </svg>} />
      <span className="lp-tag t1">FRED · dated</span>
      <span className="lp-tag t2">EIA · weekly</span>
      <span className="lp-tag t3">Source and period on every number</span>
    </div>
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
