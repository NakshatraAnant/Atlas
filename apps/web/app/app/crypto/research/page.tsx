'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { CryptoNav, Kind, MiniLine, pctFrac, signCls } from '@/components/crypto';
import { Loading, Problem, useApi } from '@/components/ui';

interface Matrix { keys: string[]; source: string; window_days: number; matrix: { value: number | null; n: number | null; reason: string | null }[][]; missing: string[]; caveat: string; method: { formula: string } }
interface Backtest { asset: string; series: { label: string }; trades: number; exposure: number; strategy_total_return: number; buy_hold_total_return: number; strategy_max_drawdown: number; buy_hold_max_drawdown: number; strategy_vol: number; buy_hold_vol: number; costs_paid: number; strategy: { t: string; v: number }[]; buy_hold: { t: string; v: number }[]; assumptions: string[]; disclaimer: string }
interface Cross { datasets: { dataset_id: string; name: string; instrument_label: string; currency: string; first_date: string | null; last_date: string | null; rows_valid: number }[]; policy: string; result: null | { crypto_series: string; aligned_sessions: number; from: string | null; to: string | null; correlation: number | null; n: number | null; reason: string | null; method: string } }

const cell = (v: number | null) => (v === null ? 'var(--sf2)' : `color-mix(in srgb, ${v >= 0 ? 'var(--ac)' : 'var(--rd)'} ${Math.round(Math.abs(v) * 60)}%, var(--sf))`);

export default function Research() {
  return (
    <>
      <h1 style={{ margin: 0 }}>Digital Assets</h1>
      <CryptoNav />
      <p className="mu">Quantitative research on stored daily history. Every result is <Kind k="derived" /> with a documented formula; nothing here forecasts prices or recommends anything.</p>
      <CorrelationPanel />
      <BacktestPanel />
      <CrossAssetPanel />
    </>
  );
}

function CorrelationPanel() {
  const [keys, setKeys] = useState('bitcoin,ethereum,solana,ripple,binancecoin,dogecoin');
  const [win, setWin] = useState('90');
  const [source, setSource] = useState('binance');
  const [q, setQ] = useState(`keys=${keys}&window=${win}&source=${source}`);
  const m = useApi<Matrix>(`/v1/crypto/research/correlation?${q}`, [q]);
  return (
    <section className="card" aria-labelledby="cm">
      <h2 id="cm">Correlation matrix</h2>
      <form className="cx-filters" onSubmit={(e) => { e.preventDefault(); setQ(`keys=${encodeURIComponent(keys)}&window=${win}&source=${source}`); }}>
        <label className="field">Asset ids (comma-separated, up to 12)<input value={keys} onChange={(e) => setKeys(e.target.value)} size={50} /></label>
        <label className="field">Window<select value={win} onChange={(e) => setWin(e.target.value)}>{['30', '90', '180', '365'].map((w) => <option key={w} value={w}>{w} days</option>)}</select></label>
        <label className="field">Source (all series from one source)<select value={source} onChange={(e) => setSource(e.target.value)}><option value="binance">Binance daily candles (USDT)</option><option value="coinbase">Coinbase daily candles (USD)</option><option value="coingecko">CoinGecko reference (USD)</option></select></label>
        <button className="btn" type="submit">Calculate</button>
      </form>
      {m.loading && !m.data ? <Loading lines={5} /> : m.error ? <Problem error={m.error} retry={m.reload} /> : m.data && (
        <>
          <div className="wrap"><table className="cx-matrix">
            <caption>Correlation of daily log returns, last {m.data.window_days} days, source {m.data.source}</caption>
            <thead><tr><th scope="col" />{m.data.keys.map((k) => <th key={k} scope="col">{k}</th>)}</tr></thead>
            <tbody>{m.data.matrix.map((row, i) => <tr key={m.data!.keys[i]}><th scope="row" style={{ textAlign: 'left' }}>{m.data!.keys[i]}</th>{row.map((c, j) => <td key={j} style={{ background: cell(c.value) }} title={c.reason ?? `${c.n ?? ''} aligned days`}>{c.value === null ? <span className="mu">n/a</span> : c.value.toFixed(2)}</td>)}</tr>)}</tbody>
          </table></div>
          {m.data.missing.length > 0 && <p className="warn">No stored {m.data.source} series for: {m.data.missing.join(', ')}. Hover a cell for the reason.</p>}
          <p className="mu">{m.data.caveat} Method: {m.data.method.formula}.</p>
        </>
      )}
    </section>
  );
}

function BacktestPanel() {
  const [f, setF] = useState({ key: 'bitcoin', fast: 50, slow: 200, fee_bps: 10, slippage_bps: 5 });
  const [r, setR] = useState<Backtest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      setR(await api<Backtest>('/v1/crypto/research/backtest', { body: f }));
    } catch (x) {
      setErr((x as Error).message);
      setR(null);
    } finally {
      setBusy(false);
    }
  };
  const num = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Number(e.target.value) });
  return (
    <section className="card" aria-labelledby="bt">
      <h2 id="bt">Moving-average trend backtest (educational)</h2>
      <form className="cx-filters" onSubmit={run}>
        <label className="field">Asset id<input value={f.key} onChange={(e) => setF({ ...f, key: e.target.value.trim() })} /></label>
        <label className="field">Fast average (days)<input type="number" min={2} max={100} value={f.fast} onChange={num('fast')} /></label>
        <label className="field">Slow average (days)<input type="number" min={3} max={400} value={f.slow} onChange={num('slow')} /></label>
        <label className="field">Fee per trade (bp)<input type="number" min={0} max={200} value={f.fee_bps} onChange={num('fee_bps')} /></label>
        <label className="field">Slippage per trade (bp)<input type="number" min={0} max={200} value={f.slippage_bps} onChange={num('slippage_bps')} /></label>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Running…' : 'Run backtest'}</button>
      </form>
      {err && <p className="err">{err}</p>}
      {r && (
        <>
          <p className="mu">Series: {r.series.label}. {r.disclaimer}</p>
          <div className="wrap"><table className="term-table"><thead><tr><th scope="col" style={{ textAlign: 'left' }} /><th scope="col" className="num">Total return</th><th scope="col" className="num">Max drawdown</th><th scope="col" className="num">Volatility (√365)</th></tr></thead>
            <tbody>
              <tr><th scope="row" style={{ textAlign: 'left' }}>Trend rule ({r.trades} trades, long {(r.exposure * 100).toFixed(0)}% of days)</th><td className={`num ${signCls(r.strategy_total_return)}`}>{pctFrac(r.strategy_total_return)}</td><td className="num dn">{pctFrac(r.strategy_max_drawdown)}</td><td className="num">{(r.strategy_vol * 100).toFixed(1)}%</td></tr>
              <tr><th scope="row" style={{ textAlign: 'left' }}>Buy and hold</th><td className={`num ${signCls(r.buy_hold_total_return)}`}>{pctFrac(r.buy_hold_total_return)}</td><td className="num dn">{pctFrac(r.buy_hold_max_drawdown)}</td><td className="num">{(r.buy_hold_vol * 100).toFixed(1)}%</td></tr>
            </tbody></table></div>
          <div className="grid2">
            <MiniLine title="Trend rule: growth of 1" points={r.strategy} format={(v) => v.toFixed(2)} />
            <MiniLine title="Buy and hold: growth of 1" points={r.buy_hold} format={(v) => v.toFixed(2)} />
          </div>
          <h3>Assumptions and biases</h3>
          <ul>{r.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
        </>
      )}
    </section>
  );
}

function CrossAssetPanel() {
  const [key, setKey] = useState('bitcoin');
  const [ds, setDs] = useState('');
  const c = useApi<Cross>(`/v1/crypto/research/cross-asset?key=${encodeURIComponent(key)}${ds ? `&dataset=${ds}` : ''}`, [key, ds]);
  return (
    <section className="card" aria-labelledby="xa">
      <h2 id="xa">Crypto and equities</h2>
      {c.loading && !c.data ? <Loading lines={3} /> : c.error ? <Problem error={c.error} retry={c.reload} /> : c.data && (
        <>
          <p className="warn">{c.data.policy}</p>
          {c.data.datasets.length === 0 ? <p>You have no uploaded price files. <a href="/app/research/datasets">Upload a daily price CSV</a> you are entitled to use (for example an index or a stock), then come back to compare.</p> : (
            <div className="cx-filters">
              <label className="field">Crypto asset id<input value={key} onChange={(e) => setKey(e.target.value.trim())} /></label>
              <label className="field">Your dataset<select value={ds} onChange={(e) => setDs(e.target.value)}><option value="">Choose…</option>{c.data.datasets.map((d) => <option key={d.dataset_id} value={d.dataset_id}>{d.name} ({d.instrument_label}, {d.currency}, {d.rows_valid} rows)</option>)}</select></label>
            </div>
          )}
          {c.data.result && (
            <>
              <p><strong>Correlation of session-to-session returns:</strong> {c.data.result.correlation === null ? <span className="mu">not calculated: {c.data.result.reason}</span> : `${c.data.result.correlation.toFixed(2)} over ${c.data.result.n} sessions (${c.data.result.from} to ${c.data.result.to})`}</p>
              <p className="mu">Crypto series: {c.data.result.crypto_series}. {c.data.result.method}</p>
              <p className="mu">Equity metrics such as P/E or ROE are not applied to crypto assets: tokens generally have no earnings or book equity in the accounting sense.</p>
            </>
          )}
        </>
      )}
    </section>
  );
}
