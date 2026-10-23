'use client';
import { useParams } from 'next/navigation';
import { MiniLine, PriceChart } from '@/components/crypto';
import { Classification } from '@/components/research';
import { Loading, Problem, useApi } from '@/components/ui';

// One Indian instrument from stored provider prices: price chart, returns, risk, indicators, relative
// strength against NIFTY 50, gaps, and the data-quality record (missing sessions, suspect rows,
// corrections, split checks, symbol mapping). Fundamentals come only from statements you import.

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);
const cls = (v: number | null | undefined) => (v === null || v === undefined ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : '');
const inr = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);

export default function Instrument() {
  const p = useParams<{ exchange: string; symbol: string }>();
  const exchange = String(p.exchange).toUpperCase();
  const symbol = decodeURIComponent(String(p.symbol)).toUpperCase();
  const r = useApi<any>(`/v1/equity/instruments/${exchange}/${encodeURIComponent(symbol)}`, [exchange, symbol]);
  // Ask for statements only if you have imported some for this instrument (no 404 noise otherwise).
  const mine = useApi<{ instruments: { instrument: string }[] }>(exchange === 'INDEX' ? null : '/v1/research/fundamentals');
  const has = !!mine.data?.instruments.some((x) => x.instrument === `${exchange}:${symbol}`);
  const f = useApi<any>(has ? `/v1/research/fundamentals?instrument=${exchange}:${encodeURIComponent(symbol)}` : null, [has, exchange, symbol]);
  if (r.loading && !r.data) return <Loading lines={8} />;
  if (r.error) return <><p><a href="/app/equities">← Indian equities</a></p><Problem error={r.error} retry={r.reload} /></>;
  const d = r.data;
  const a = d.analysis;
  const m = a?.metrics;
  const series = d.series as { classification: string; basis: string; provider_id: string; first_date: string; last_date: string; observations: number }[];
  return (
    <>
      <p><a href="/app/equities">← Indian equities</a></p>
      <h1>{d.instrument.exchange}:{d.instrument.symbol} {d.instrument.name && <span className="mu">{d.instrument.name}</span>}</h1>
      <p>{series[0] && <Classification c={series[0].classification} />} {series.map((s) => `${s.provider_id} ${s.basis === 'raw' ? 'raw' : 'adjusted'} ${s.first_date?.slice(0, 10)} → ${s.last_date?.slice(0, 10)} (${s.observations})`).join(' · ')}</p>
      {!a ? (
        <section className="card"><h2>No prices stored</h2><p>{d.empty_reason}</p></section>
      ) : (
        <>
          <section className="card">
            <div className="cx-kpis">
              <div className="cx-kpi"><span className="k">Last close ({m.last_date})</span><span className="v">{inr(m.last_close)}</span><span className={`s ${cls(m.returns.d1)}`}>{pct(m.returns.d1, 2)} on the session</span></div>
              <div className="cx-kpi"><span className="k">Freshness</span><span className="v">{a.behind === 0 ? 'current' : `${a.behind} session(s) behind`}</span><span className="s">expected latest session {d.expected_session}</span></div>
              <div className="cx-kpi"><span className="k">52-week range</span><span className="v">{m.range_52w ? `${inr(m.range_52w.low)} – ${inr(m.range_52w.high)}` : '—'}</span><span className="s">{m.range_52w ? `${pct(m.range_52w.from_high)} from high over ${m.range_52w.sessions} sessions` : 'needs more history'}</span></div>
              <div className="cx-kpi"><span className="k">Volatility (annualised)</span><span className="v">{m.vol_3m === null ? '—' : `${(m.vol_3m * 100).toFixed(1)}%`}</span><span className="s">3 months; 1 year {m.vol_1y === null ? '—' : `${(m.vol_1y * 100).toFixed(1)}%`}</span></div>
            </div>
            <p className="mu">Returns and indicators use the {a.basis === 'raw' ? 'raw (as-traded)' : 'split- and dividend-adjusted'} series. {a.sessions_stored} stored sessions.</p>
          </section>
          <section className="card">
            <PriceChart data={a.chart.map((c: any) => ({ t: c.t, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }))} title={`${symbol} daily prices (last ${a.chart.length} sessions)`} quote="INR" note="Provider end-of-day prices. Missing sessions stay gaps." />
          </section>
          <section className="card">
            <h2>Returns</h2>
            <div className="wrap"><table className="term-table"><thead><tr>{['1 session', '1 week', '1 month', '3 months', '6 months', '1 year'].map((h) => <th scope="col" key={h}>{h}</th>)}</tr></thead>
              <tbody><tr>{(['d1', 'w1', 'm1', 'm3', 'm6', 'y1'] as const).map((k) => <td key={k} className={`num ${cls(m.returns[k])}`}>{pct(m.returns[k])}</td>)}</tr></tbody></table></div>
            <p className="mu">Over 1, 5, 21, 63, 126 and 252 stored sessions; “—” where the history is shorter. The free provider plan keeps one year.</p>
            <MiniLine points={a.rolling_21} title="Rolling 21-session return" zero />
          </section>
          <section className="card">
            <h2>Risk</h2>
            {a.risk.reason ? <p className="mu">{a.risk.reason}</p> : (
              <div className="cx-kpis">
                <div className="cx-kpi"><span className="k">Sharpe ratio</span><span className="v">{a.risk.sharpe?.toFixed(2) ?? '—'}</span><span className="s">risk-free {(a.risk.risk_free * 100).toFixed(2)}%, √252</span></div>
                <div className="cx-kpi"><span className="k">Sortino ratio</span><span className="v">{a.risk.sortino?.toFixed(2) ?? '—'}</span></div>
                <div className="cx-kpi"><span className="k">Maximum drawdown</span><span className="v">{pct(m.max_drawdown)}</span><span className="s">now {pct(m.current_drawdown)}</span></div>
                <div className="cx-kpi"><span className="k">Window</span><span className="v">{a.risk.window_sessions} sessions</span></div>
              </div>
            )}
          </section>
          <section className="card">
            <h2>Indicators</h2>
            <p className="mu">Descriptions of past prices, not signals or recommendations.</p>
            <MiniLine points={a.chart.filter((c: any) => c.rsi !== null).map((c: any) => ({ t: c.t, v: c.rsi }))} title={`RSI 14 (now ${m.rsi14?.toFixed(1) ?? '—'})`} format={(v) => v.toFixed(0)} />
            <MiniLine points={a.chart.filter((c: any) => c.hist !== null).map((c: any) => ({ t: c.t, v: c.hist }))} title="MACD histogram (12, 26, 9)" format={(v) => v.toFixed(2)} zero />
            {a.relative_strength.points ? <MiniLine points={a.relative_strength.points} title={`Relative strength vs NIFTY 50 (1.00 = same as the index since the first shared session; now ${a.relative_strength.last?.toFixed(3)})`} format={(v) => v.toFixed(2)} /> : <p className="mu">Relative strength: {a.relative_strength.reason}</p>}
            <h3>Opening gaps of 2% or more</h3>
            {a.gaps.length ? <div className="wrap"><table className="term-table"><thead><tr><th scope="col">Session</th><th scope="col">Gap</th><th scope="col">Previous close</th><th scope="col">Open</th><th scope="col">Filled that session</th></tr></thead>
              <tbody>{a.gaps.map((g: any) => <tr key={g.t}><td>{g.t}</td><td className={`num ${cls(g.gap)}`}>{pct(g.gap, 2)}</td><td className="num">{inr(g.previous_close)}</td><td className="num">{inr(g.open)}</td><td>{g.filled ? 'yes' : 'no'}</td></tr>)}</tbody></table></div> : <p className="mu">None in the stored history.</p>}
            <details><summary>Definitions</summary><ul>{Object.entries(a.definitions).map(([k, v]) => <li key={k}><strong>{k.replace(/_/g, ' ')}</strong>: {String(v)}</li>)}</ul></details>
          </section>
        </>
      )}
      <section className="card">
        <h2>Data quality</h2>
        <ul>
          <li>Provider symbols: {d.provider_symbols.map((s: any) => `${s.provider_id} ${s.provider_symbol} (${s.verification}${s.effective_from ? `, from ${String(s.effective_from).slice(0, 10)}` : ''}${s.last_check_error ? `: ${s.last_check_error}` : ''})`).join('; ') || 'none'}</li>
          {a && <li>Missing expected sessions in the stored range: {a.missing_sessions.length ? a.missing_sessions.join(', ') : 'none'} <span className="mu">(weekdays minus holidays ATLAS has evidence for)</span></li>}
          {a && <li>Rows flagged suspect (a move above 20%, kept and labelled): {m.suspect_rows}</li>}
          <li>Corrections from re-imports: {d.revisions.length ? d.revisions.map((x: any) => `${x.trade_date} (${x.basis})`).join(', ') : 'none'}</li>
          <li>Corporate actions from the provider: {d.corporate_actions.length ? d.corporate_actions.map((c: any) => `${c.ex_date} ${c.kind} ${c.ratio ?? `${c.value} ${c.currency ?? ''}`}`).join('; ') : 'none retrieved yet (checked with the daily validation budget)'}</li>
          {d.split_checks.map((s: any) => <li key={s.ex_date}>Split {s.ratio} on {s.ex_date}: {s.note}</li>)}
          {d.universe && <li>Refresh queue: priority {d.universe.priority}{d.universe.enabled ? '' : ' (removed)'}{d.universe.last_error ? `; last problem ${d.universe.last_error_category}: ${d.universe.last_error}` : ''}</li>}
        </ul>
      </section>
      {exchange !== 'INDEX' && (
        <section className="card">
          <h2>Financial statements you imported</h2>
          <p className="mu">{d.fundamentals_note}</p>
          {f.data ? (
            <>
              <p className="mu">{f.data.notice}</p>
              <div className="wrap"><table className="term-table"><thead><tr><th scope="col">Period</th>{Object.keys(f.data.definitions).filter((k) => k !== 'pe_ratio').map((k) => <th scope="col" key={k}>{k.replace(/_/g, ' ')}</th>)}</tr></thead>
                <tbody>{f.data.ratios.map((x: any) => <tr key={`${x.period_end}${x.period_type}`}><td>{x.period_end} {x.period_type}</td>{Object.keys(f.data.definitions).filter((k) => k !== 'pe_ratio').map((k) => <td key={k} className="num">{x.ratios[k] === undefined ? '—' : k === 'free_cash_flow_inr' ? inr(x.ratios[k]) : k === 'debt_to_equity' || k === 'cash_conversion' ? x.ratios[k].toFixed(2) : pct(x.ratios[k])}</td>)}</tr>)}</tbody></table></div>
              <p>P/E: {f.data.valuation.pe_ratio ? `${f.data.valuation.pe_ratio.value.toFixed(1)} (price ${f.data.valuation.pe_ratio.price_date}, EPS for ${f.data.valuation.pe_ratio.eps_period})` : f.data.valuation.reason}</p>
            </>
          ) : <p>None yet. <a href="/app/equities/statements">Import statements you obtained yourself</a>.</p>}
        </section>
      )}
    </>
  );
}
