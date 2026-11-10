'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { TsChart } from '@/components/ts-chart';
import { MiniLine } from '@/components/crypto';
import { useApp } from '@/components/providers';
import { cls, InstrumentPicker, InstrumentTable, num, OnePicker, pct, type InstrumentInfo } from '@/components/research';
import { Loading, Problem, useApi } from '@/components/ui';

// Research hub tabs. Each one calls a documented API, shows the method and assumptions returned with
// the result, and shows unavailable values as unavailable (with the reason), never as zero.

function useRun<T>() {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<T>) => {
    setBusy(true);
    setErr(null);
    try { setData(await fn()); } catch (e) { setErr(e as ApiError); setData(null); } finally { setBusy(false); }
  };
  return { data, err, busy, run, setData };
}
const Method = ({ children }: { children: React.ReactNode }) => <details className="rs-method"><summary>Method and assumptions</summary><div className="mu">{children}</div></details>;
const SaveView = ({ kind, config }: { kind: string; config: Record<string, unknown> }) => {
  const { toast } = useApp();
  return <button className="btn s" type="button" onClick={async () => { const name = prompt('Name this saved view'); if (!name) return; try { await api('/v1/research/views', { body: { kind, name, config } }); toast('Saved'); } catch (e) { toast((e as Error).message); } }}>Save view</button>;
};
function SavedViews({ kind, onLoad }: { kind: string; onLoad: (c: any) => void }) {
  const v = useApi<{ rows: { view_id: string; name: string; config: any }[] }>(`/v1/research/views?kind=${kind}`);
  if (!v.data?.rows.length) return null;
  return <p className="mu">Saved: {v.data.rows.map((r) => <button key={r.view_id} className="link" style={{ marginRight: 10 }} onClick={() => onLoad(r.config)}>{r.name}</button>)}</p>;
}

// ───────── Workbench ─────────
interface WB { instruments: InstrumentInfo[]; alignment: { calendar: string; annualisation: number; shared_dates: number; from: string; to: string; note: string }; series: { t: string; values: number[] }[]; metrics: { key: string; own: any; aligned: any }[]; error?: string; caveats: string[]; risk_free: number; definitions: Record<string, string> }
export function Workbench() {
  const [keys, setKeys] = useState<string[]>(['crypto:bitcoin', 'crypto:ethereum']);
  const [bench, setBench] = useState('');
  const [range, setRange] = useState('1y');
  const r = useRun<WB>();
  const go = () => r.run(() => api<WB>('/v1/research/workbench', { body: { keys, benchmark: bench || undefined, range } }));
  const d = r.data;
  return (
    <section className="card">
      <h2>Compare instruments</h2>
      <SavedViews kind="workbench" onLoad={(c) => { setKeys(c.keys ?? []); setBench(c.benchmark ?? ''); setRange(c.range ?? '1y'); }} />
      <div className="grid2">
        <InstrumentPicker value={keys} onChange={setKeys} />
        <div>
          <OnePicker value={bench} onChange={setBench} label="Benchmark (optional)" />
          <label className="field">Range<select value={range} onChange={(e) => setRange(e.target.value)}>{['90d', '1y', '3y', '5y', 'max'].map((x) => <option key={x}>{x}</option>)}</select></label>
          <div className="row"><button className="btn" onClick={go} disabled={!keys.length || r.busy}>{r.busy ? 'Calculating…' : 'Compare'}</button><SaveView kind="workbench" config={{ keys, benchmark: bench, range }} /></div>
        </div>
      </div>
      <Problem error={r.err} />
      {d?.error && <p className="warn">{d.error}</p>}
      {d && !d.error && (
        <>
          <p className="mu">{d.alignment.shared_dates} shared dates, {d.alignment.from} → {d.alignment.to}. {d.alignment.note}</p>
          <TsChart title="Rebased to 1.0 on the first shared date" defaultRange="Max" gapDays={10} height={280} series={d.instruments.map((i, k) => ({ label: i.label, unit: 'growth of 1', points: d.series.filter((s) => typeof s.values[k] === 'number' && Number.isFinite(s.values[k])).map((s) => ({ t: s.t.slice(0, 10), v: s.values[k]! })) }))} />
          <div className="wrap"><table className="term-table">
            <caption>Metrics (own series; risk-free rate {d.risk_free})</caption>
            <thead><tr><th scope="col" style={{ textAlign: 'left' }}>Instrument</th><th scope="col">Return (shared dates)</th><th scope="col">CAGR</th><th scope="col">90-day vol</th><th scope="col">Max drawdown</th><th scope="col">Sharpe</th><th scope="col">Sortino</th><th scope="col">Corr. with benchmark</th><th scope="col">Beta</th><th scope="col">Relative return</th></tr></thead>
            <tbody>{d.metrics.map((m, k) => <tr key={m.key}><td style={{ textAlign: 'left' }}>{d.instruments[k]?.label}</td><td className={`num ${cls(m.aligned.total_return)}`}>{pct(m.aligned.total_return)}</td><td className="num" title={m.own.reasons?.cagr}>{pct(m.own.cagr)}</td><td className="num" title={m.own.reasons?.vol_90d}>{m.own.vol_90d === null ? '—' : `${(m.own.vol_90d * 100).toFixed(1)}%`}</td><td className="num dn">{pct(m.aligned.max_drawdown)}</td><td className="num" title={m.own.reasons?.sharpe}>{num(m.own.sharpe)}</td><td className="num">{num(m.own.sortino)}</td><td className="num" title={m.aligned.relative_reason ?? ''}>{num(m.aligned.correlation)}</td><td className="num">{num(m.aligned.beta)}</td><td className={`num ${cls(m.aligned.relative_return)}`}>{pct(m.aligned.relative_return)}</td></tr>)}</tbody>
          </table></div>
          <p className="mu">“—” means not calculated; hover for the reason.</p>
          <InstrumentTable items={d.instruments} />
          <Method><ul>{Object.entries(d.definitions).map(([k, v]) => <li key={k}><strong>{k}</strong>: {v}</li>)}{d.caveats.map((c) => <li key={c}>{c}</li>)}</ul></Method>
        </>
      )}
    </section>
  );
}

// ───────── Screener and factors ─────────
const METRICS = ['market_cap', 'return_30d', 'return_90d', 'return_365d', 'vol_90d', 'max_drawdown', 'current_drawdown', 'sma50_gap', 'sma200_gap', 'volume_ratio_30_90', 'sharpe'];
export function Screener() {
  const [filters, setFilters] = useState<{ metric: string; op: string; value: number }[]>([{ metric: 'return_90d', op: '>=', value: 0 }]);
  const [asset, setAsset] = useState('all');
  const [sort, setSort] = useState('return_90d');
  const r = useRun<any>();
  const f = useApi<any>('/v1/research/factors');
  const go = () => r.run(() => api('/v1/research/screener', { body: { filters: filters.map((x) => ({ ...x, value: x.metric === 'market_cap' || x.metric === 'volume_ratio_30_90' || x.metric === 'sharpe' ? x.value : x.value / 100 })), asset_class: asset, sort, dir: 'desc' } }));
  return (
    <>
      <section className="card">
        <h2>Screener</h2>
        <SavedViews kind="screen" onLoad={(c) => { setFilters(c.filters ?? []); setAsset(c.asset ?? 'all'); setSort(c.sort ?? 'return_90d'); }} />
        <p className="mu">Percent metrics are entered in % (e.g. 10 for +10%); ratios as numbers.</p>
        {filters.map((x, i) => (
          <div key={i} className="cx-filters">
            <select aria-label="Metric" value={x.metric} onChange={(e) => setFilters(filters.map((y, j) => (j === i ? { ...y, metric: e.target.value } : y)))}>{METRICS.map((m) => <option key={m}>{m}</option>)}</select>
            <select aria-label="Operator" value={x.op} onChange={(e) => setFilters(filters.map((y, j) => (j === i ? { ...y, op: e.target.value } : y)))}><option>{'>='}</option><option>{'<='}</option></select>
            <input aria-label="Value" type="number" value={x.value} onChange={(e) => setFilters(filters.map((y, j) => (j === i ? { ...y, value: Number(e.target.value) } : y)))} />
            <button className="link" onClick={() => setFilters(filters.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <div className="row">
          <button className="btn s" onClick={() => setFilters([...filters, { metric: 'vol_90d', op: '<=', value: 80 }])} disabled={filters.length >= 10}>Add filter</button>
          <label className="field">Assets<select value={asset} onChange={(e) => setAsset(e.target.value)}><option value="all">All</option><option value="crypto">Crypto</option><option value="equity">Indian equities (real)</option></select></label>
          <label className="field">Sort by<select value={sort} onChange={(e) => setSort(e.target.value)}>{METRICS.map((m) => <option key={m}>{m}</option>)}</select></label>
          <button className="btn" onClick={go} disabled={r.busy}>{r.busy ? 'Screening…' : 'Run screen'}</button>
          <SaveView kind="screen" config={{ filters, asset, sort }} />
        </div>
        <Problem error={r.err} />
        {r.data && (
          <>
            <p>{r.data.matched} of {r.data.universe} match. {r.data.excluded_missing_values} exclusions because a filtered value was unavailable.</p>
            <div className="wrap"><table className="term-table"><thead><tr><th scope="col" style={{ textAlign: 'left' }}>Instrument</th><th scope="col">Data</th><th scope="col">30 d</th><th scope="col">90 d</th><th scope="col">1 y</th><th scope="col">90-day vol</th><th scope="col">Max DD</th><th scope="col">vs SMA200</th><th scope="col">Volume 30/90</th></tr></thead>
              <tbody>{r.data.rows.map((x: any) => <tr key={x.key}><td style={{ textAlign: 'left' }}>{x.label}</td><td>{x.asset_class}</td><td className={`num ${cls(x.return_30d)}`}>{pct(x.return_30d)}</td><td className={`num ${cls(x.return_90d)}`}>{pct(x.return_90d)}</td><td className={`num ${cls(x.return_365d)}`}>{pct(x.return_365d)}</td><td className="num">{x.vol_90d === null ? '—' : `${(x.vol_90d * 100).toFixed(1)}%`}</td><td className="num dn">{pct(x.max_drawdown)}</td><td className={`num ${cls(x.sma200_gap)}`}>{pct(x.sma200_gap)}</td><td className="num">{num(x.volume_ratio_30_90)}</td></tr>)}</tbody></table></div>
            <Method><ul>{r.data.notes.map((n: string) => <li key={n}>{n}</li>)}</ul></Method>
          </>
        )}
      </section>
      <section className="card">
        <h2>Factor ranks (crypto)</h2>
        {f.loading ? <Loading /> : f.error ? <Problem error={f.error} /> : f.data && (
          <>
            <div className="grid2">{f.data.factors.map((x: any) => (
              <div key={x.name}><h3>{x.name.replace(/_/g, ' ')} <span className="mu">({x.n})</span></h3>
                <ol className="mu" style={{ margin: 0 }}>{x.ranked.slice(0, 5).map((r2: any) => <li key={r2.key}>{r2.label}: {x.name.startsWith('size') ? `$${(r2.v / 1e9).toFixed(1)}B` : x.name.includes('volume') ? r2.v.toFixed(2) : pct(r2.v)} (Q{r2.quintile})</li>)}</ol>
              </div>
            ))}</div>
            <Method><p>{f.data.method}</p><ul>{f.data.caveats.map((c: string) => <li key={c}>{c}</li>)}</ul></Method>
          </>
        )}
      </section>
    </>
  );
}

// ───────── Portfolios, risk and scenarios ─────────
export function Portfolios() {
  const list = useApi<{ rows: { portfolio_id: string; name: string; holdings: number; rebalance: string }[]; note: string }>('/v1/research/portfolios');
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; bench: string; rebalance: string; holdings: { key: string; weight: number }[] }>({ name: '', bench: 'crypto:bitcoin', rebalance: 'monthly', holdings: [] });
  const [keys, setKeys] = useState<string[]>([]);
  const create = useRun<any>();
  const sum = form.holdings.reduce((a, h) => a + h.weight, 0);
  const syncKeys = (k: string[]) => { setKeys(k); setForm({ ...form, holdings: k.map((x) => form.holdings.find((h) => h.key === x) ?? { key: x, weight: Math.round(100 / k.length) }) }); };
  return (
    <>
      <section className="card">
        <h2>Research portfolios</h2>
        <p className="mu">{list.data?.note}</p>
        {list.data?.rows.length ? <ul>{list.data.rows.map((p) => <li key={p.portfolio_id}><button className="link" onClick={() => setSel(p.portfolio_id)}>{p.name}</button> <span className="mu">{p.holdings} holdings · {p.rebalance}</span></li>)}</ul> : <p className="mu">No portfolios yet.</p>}
        <h3>New portfolio</h3>
        <div className="grid2">
          <div>
            <label className="field">Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} /></label>
            <InstrumentPicker value={keys} onChange={syncKeys} max={30} label="Holdings" />
          </div>
          <div>
            {form.holdings.map((h) => <label key={h.key} className="field">{h.key} weight (%)<input type="number" min={0} max={100} step={0.5} value={h.weight} onChange={(e) => setForm({ ...form, holdings: form.holdings.map((x) => (x.key === h.key ? { ...x, weight: Number(e.target.value) } : x)) })} /></label>)}
            <p className={Math.abs(sum - 100) < 0.1 ? 'mu' : 'warn'}>Weights add up to {sum.toFixed(1)}%{Math.abs(sum - 100) < 0.1 ? '' : ' (must be 100%)'}.</p>
            <OnePicker value={form.bench} onChange={(b) => setForm({ ...form, bench: b })} label="Benchmark" />
            <label className="field">Rebalancing<select value={form.rebalance} onChange={(e) => setForm({ ...form, rebalance: e.target.value })}><option value="monthly">Monthly to target</option><option value="none">None (buy and hold)</option></select></label>
            <button className="btn" disabled={!form.name || !form.holdings.length || create.busy} onClick={() => create.run(async () => { const p = await api<any>('/v1/research/portfolios', { body: { name: form.name, benchmark_key: form.bench || null, rebalance: form.rebalance, holdings: form.holdings.map((h) => ({ instrument_key: h.key, weight: h.weight / 100 })) } }); list.reload(); setSel(p.portfolio_id); return p; })}>Create</button>
            <Problem error={create.err} />
          </div>
        </div>
      </section>
      {sel && <PortfolioAnalysis id={sel} onDeleted={() => { setSel(null); list.reload(); }} />}
    </>
  );
}

function PortfolioAnalysis({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const [range, setRange] = useState('1y');
  const a = useApi<any>(`/v1/research/portfolios/${id}/analysis?range=${range}`, [range]);
  const [shocks, setShocks] = useState<Record<string, number>>({});
  const [vm, setVm] = useState(1.5);
  const [cs, setCs] = useState(0.2);
  const sc = useRun<any>();
  if (a.loading && !a.data) return <Loading />;
  if (a.error) return <Problem error={a.error} />;
  const d = a.data;
  const r = d.result;
  return (
    <section className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}><h2>{d.portfolio.name}</h2><button className="btn s" onClick={async () => { if (confirm('Delete this portfolio?')) { await api(`/v1/research/portfolios/${id}`, { method: 'DELETE' }); onDeleted(); } }}>Delete</button></div>
      <label className="field">Range<select value={range} onChange={(e) => setRange(e.target.value)}><option>1y</option><option>3y</option><option>max</option></select></label>
      {!r ? <p className="warn">{d.reason}</p> : (
        <>
          <div className="cx-kpis">
            <div className="cx-kpi"><span className="k">Total return</span><span className={`v ${cls(r.total_return)}`}>{pct(r.total_return)}</span></div>
            <div className="cx-kpi"><span className="k">Max drawdown</span><span className="v dn">{pct(r.max_drawdown)}</span></div>
            <div className="cx-kpi"><span className="k">Volatility</span><span className="v">{r.ratios.vol === undefined ? '—' : `${(r.ratios.vol * 100).toFixed(1)}%`}</span><span className="s">{r.ratios.reason ?? `√${r.ratios.annualisation}`}</span></div>
            <div className="cx-kpi"><span className="k">Sharpe / Sortino</span><span className="v">{num(r.ratios.sharpe)} / {num(r.ratios.sortino)}</span><span className="s">risk-free {r.ratios.risk_free ?? '—'}</span></div>
            <div className="cx-kpi"><span className="k">Effective holdings</span><span className="v">{r.concentration.effective_holdings.toFixed(1)}</span><span className="s">max weight {pct(r.concentration.max_weight, 0)}</span></div>
            {r.benchmark && <div className="cx-kpi"><span className="k">vs {r.benchmark.label}</span><span className={`v ${cls(r.benchmark.excess_return)}`}>{pct(r.benchmark.excess_return)}</span><span className="s">benchmark {pct(r.benchmark.total_return)}</span></div>}
          </div>
          <MiniLine title="Portfolio value (start = 1.0)" points={r.curve} format={(v) => v.toFixed(2)} />
          <div className="grid2">
            <table className="term-table"><caption>Contribution to return (arithmetic)</caption><thead><tr><th scope="col" style={{ textAlign: 'left' }}>Holding</th><th scope="col">Weight</th><th scope="col">Contribution</th></tr></thead><tbody>{r.contributions.map((c: any) => <tr key={c.key}><td style={{ textAlign: 'left' }}>{c.label}</td><td className="num">{pct(c.weight, 0).replace('+', '')}</td><td className={`num ${cls(c.contribution)}`}>{pct(c.contribution)}</td></tr>)}</tbody></table>
            <div><h3>Exposure</h3><ul>{Object.entries(r.exposure).map(([k, v]) => <li key={k}>{k}: {pct(v as number, 0).replace('+', '')}</li>)}</ul><p className="mu">Correlations use {r.correlations.aligned_returns} aligned returns.</p></div>
          </div>
          <h3>Stress scenario</h3>
          <div className="cx-filters">
            {d.portfolio.holdings.map((h: any) => <label key={h.instrument_key} className="field">{h.instrument_key} shock (%)<input type="number" value={(shocks[h.instrument_key] ?? 0) * 100} onChange={(e) => setShocks({ ...shocks, [h.instrument_key]: Number(e.target.value) / 100 })} /></label>)}
            <label className="field">Volatility ×<input type="number" step={0.1} min={0.1} max={10} value={vm} onChange={(e) => setVm(Number(e.target.value))} /></label>
            <label className="field">Correlation shift<input type="number" step={0.1} min={-1} max={1} value={cs} onChange={(e) => setCs(Number(e.target.value))} /></label>
            <button className="btn" onClick={() => sc.run(() => api(`/v1/research/portfolios/${id}/scenario`, { body: { shocks, vol_multiplier: vm, correlation_shift: cs, range } }))}>Run scenario</button>
          </div>
          <Problem error={sc.err} />
          {sc.data && <p>Shock return <strong className={cls(sc.data.shock_return)}>{pct(sc.data.shock_return)}</strong>; volatility {(sc.data.baseline_vol * 100).toFixed(1)}% → <strong>{(sc.data.stressed_vol * 100).toFixed(1)}%</strong>. <span className="mu">{sc.data.notes.join(' ')}</span></p>}
          <Method><ul>{d.assumptions.map((x: string) => <li key={x}>{x}</li>)}</ul><p>{d.disclaimer}</p></Method>
          <InstrumentTable items={d.instruments} />
        </>
      )}
    </section>
  );
}

// ───────── Correlation regimes ─────────
export function Correlation() {
  const [a, setA] = useState('crypto:bitcoin');
  const [b, setB] = useState('crypto:ethereum');
  const [w, setW] = useState(90);
  const r = useRun<any>();
  return (
    <section className="card">
      <h2>Rolling correlation and regime shifts</h2>
      <div className="grid2"><OnePicker value={a} onChange={setA} label="First" /><OnePicker value={b} onChange={setB} label="Second" /></div>
      <div className="row"><label className="field">Window<select value={w} onChange={(e) => setW(Number(e.target.value))}>{[30, 60, 90, 180].map((x) => <option key={x} value={x}>{x} days</option>)}</select></label>
        <button className="btn" disabled={!a || !b || r.busy} onClick={() => r.run(() => api('/v1/research/correlation/rolling', { body: { a, b, window: w } }))}>Calculate</button></div>
      <Problem error={r.err} />
      {r.data && (
        <>
          <p>Latest: <strong>{r.data.latest ? `${r.data.latest.v.toFixed(2)} on ${r.data.latest.t} (${r.data.latest.n} returns)` : 'not enough aligned data'}</strong>. {r.data.alignment.note}</p>
          {r.data.rolling.length > 1 && <MiniLine title={`Rolling ${r.data.window_days}-day correlation`} points={r.data.rolling} format={(v) => v.toFixed(2)} />}
          <h3>Shifts</h3>
          {r.data.shifts.length ? <ul>{r.data.shifts.map((s: any) => <li key={s.to}>{s.from} → {s.to}: {s.before.toFixed(2)} → {s.after.toFixed(2)}</li>)}</ul> : <p className="mu">No shift of 0.4 or more.</p>}
          <Method><p>{r.data.method}</p><ul>{r.data.caveats.map((c: string) => <li key={c}>{c}</li>)}</ul></Method>
        </>
      )}
    </section>
  );
}

// ───────── Walk-forward ─────────
export function WalkForward() {
  const [key, setKey] = useState('crypto:bitcoin');
  const [train, setTrain] = useState(500);
  const [test, setTest] = useState(120);
  const [fee, setFee] = useState(10);
  const [slip, setSlip] = useState(5);
  const r = useRun<any>();
  const grid = [{ fast: 10, slow: 50 }, { fast: 20, slow: 100 }, { fast: 50, slow: 200 }];
  return (
    <section className="card">
      <h2>Walk-forward backtest (SMA trend rule)</h2>
      <p className="mu">Parameters are chosen on each training window and evaluated only on the following, unseen test window. Grid: {grid.map((g) => `${g.fast}/${g.slow}`).join(', ')}.</p>
      <OnePicker value={key} onChange={setKey} label="Instrument" />
      <p className="mu">Crypto windows count calendar days; Indian equities and your uploads count trading sessions (one year of free-plan history is about 250 sessions, so use e.g. 150 training and 30 test sessions with a short grid).</p>
      <div className="cx-filters">
        <label className="field">Training days / sessions<input type="number" value={train} min={230} onChange={(e) => setTrain(Number(e.target.value))} /></label>
        <label className="field">Test days / sessions<input type="number" value={test} min={30} onChange={(e) => setTest(Number(e.target.value))} /></label>
        <label className="field">Fee (bp)<input type="number" value={fee} onChange={(e) => setFee(Number(e.target.value))} /></label>
        <label className="field">Slippage (bp)<input type="number" value={slip} onChange={(e) => setSlip(Number(e.target.value))} /></label>
        <button className="btn" disabled={!key || r.busy} onClick={() => r.run(() => api('/v1/research/walkforward', { body: { key, train_days: train, test_days: test, grid, fee_bps: fee, slippage_bps: slip } }))}>{r.busy ? 'Running…' : 'Run'}</button>
      </div>
      <Problem error={r.err} />
      {r.data && (
        <>
          <div className="cx-kpis">
            <div className="cx-kpi"><span className="k">Out-of-sample return</span><span className={`v ${cls(r.data.oos_total_return)}`}>{pct(r.data.oos_total_return)}</span></div>
            <div className="cx-kpi"><span className="k">Buy and hold, same span</span><span className={`v ${cls(r.data.buy_hold_total_return)}`}>{pct(r.data.buy_hold_total_return)}</span></div>
            <div className="cx-kpi"><span className="k">Mean in-sample (training) return</span><span className="v">{pct(r.data.in_sample_mean_return)}</span><span className="s">optimistic by construction</span></div>
            <div className="cx-kpi"><span className="k">Mean out-of-sample fold return</span><span className="v">{pct(r.data.out_of_sample_mean_return)}</span></div>
          </div>
          <MiniLine title="Chained out-of-sample equity (start = 1.0)" points={r.data.oos_curve} format={(v) => v.toFixed(2)} />
          <div className="wrap"><table className="term-table"><thead><tr><th scope="col">Train</th><th scope="col">Test</th><th scope="col">Chosen</th><th scope="col">Train return</th><th scope="col">Test return</th><th scope="col">Trades</th></tr></thead>
            <tbody>{r.data.folds.map((f: any) => <tr key={f.test_from}><td>{f.train_from} → {f.train_to}</td><td>{f.test_from} → {f.test_to}</td><td>{f.fast}/{f.slow}</td><td className="num">{pct(f.train_return)}</td><td className={`num ${cls(f.test_return)}`}>{pct(f.test_return)}</td><td className="num">{f.test_trades}</td></tr>)}</tbody></table></div>
          <Method><ul>{r.data.assumptions.map((x: string) => <li key={x}>{x}</li>)}</ul><p>{r.data.disclaimer}</p></Method>
        </>
      )}
    </section>
  );
}

// ───────── Event study ─────────
export function EventStudy() {
  const ev = useApi<{ rows: { event_id: string; headline: string; published_at: string; category: string }[] }>('/v1/crypto/events');
  const [eventId, setEventId] = useState('');
  const [key, setKey] = useState('crypto:ethereum');
  const r = useRun<any>();
  return (
    <section className="card">
      <h2>Event study</h2>
      {ev.loading ? <Loading /> : (
        <label className="field">Event<select value={eventId} onChange={(e) => setEventId(e.target.value)}><option value="">Choose a source-linked event…</option>{ev.data?.rows.map((e) => <option key={e.event_id} value={e.event_id}>{e.published_at.slice(0, 10)} · {e.headline.slice(0, 90)}</option>)}</select></label>
      )}
      <OnePicker value={key} onChange={setKey} label="Instrument" />
      <button className="btn" disabled={!eventId || !key || r.busy} onClick={() => r.run(() => api('/v1/research/event-study', { body: { event_id: eventId, key, benchmark: 'crypto:bitcoin', window: 5 } }))}>Run study</button>
      <Problem error={r.err} />
      {r.data && (r.data.result === null ? <p className="warn">{r.data.reason}</p> : (
        <>
          <p>Cumulative abnormal return over days −5..+5: <strong className={cls(r.data.result.car)}>{pct(r.data.result.car, 2)}</strong>; t = {num(r.data.result.t_stat)} ({r.data.result.robust ? 'at least 2 in size' : 'not distinguishable from normal variation'}); β {num(r.data.result.beta)} from {r.data.result.estimation_days} days.</p>
          <div className="wrap"><table className="term-table"><thead><tr><th scope="col">Day</th><th scope="col">Date</th><th scope="col">Return</th><th scope="col">Expected</th><th scope="col">Abnormal</th></tr></thead><tbody>{r.data.result.rows.map((x: any) => <tr key={x.day}><td>{x.day}</td><td>{x.date}</td><td className="num">{pct(x.ret, 2)}</td><td className="num">{pct(x.expected, 2)}</td><td className={`num ${cls(x.abnormal)}`}>{pct(x.abnormal, 2)}</td></tr>)}</tbody></table></div>
          <p className="mu">Event: <a href={r.data.event.source_url} target="_blank" rel="noreferrer noopener">{r.data.event.headline}</a> ({r.data.event.verification === 'observed_by_atlas' ? 'observed by ATLAS' : 'published by source'}, {r.data.event.published_at}).</p>
          <Method><p>{r.data.method}</p><ul>{r.data.caveats.map((c: string) => <li key={c}>{c}</li>)}</ul></Method>
        </>
      ))}
    </section>
  );
}

// ───────── Regimes ─────────
export function Regimes() {
  const [key, setKey] = useState('crypto:bitcoin');
  const r = useRun<any>();
  return (
    <section className="card">
      <h2>Market regime and volatility lab</h2>
      <OnePicker value={key} onChange={setKey} label="Instrument" />
      <button className="btn" disabled={!key || r.busy} onClick={() => r.run(() => api('/v1/research/regimes', { body: { key } }))}>Classify</button>
      <Problem error={r.err} />
      {r.data && (r.data.result === null ? <p className="warn">{r.data.reason}</p> : (
        <>
          <p>Current (data to {r.data.as_of?.slice(0, 10)}, classified {r.data.classified_at.slice(0, 16)} UTC): <strong>{r.data.result.current.replace('_', ', ')}</strong>. Median 30-day volatility {(r.data.result.median_vol * 100).toFixed(1)}%. {r.data.result.transitions_total} transitions in the history.</p>
          <p className="mu">Share of classified days: {Object.entries(r.data.result.share).map(([k, v]) => `${k.replace('_', ' ')} ${((v as number) * 100).toFixed(0)}%`).join(' · ')}</p>
          <div className="wrap"><table className="term-table"><caption>Recent segments</caption><thead><tr><th scope="col">From</th><th scope="col">To</th><th scope="col">Days</th><th scope="col" style={{ textAlign: 'left' }}>Regime</th></tr></thead><tbody>{r.data.result.segments.slice(-15).reverse().map((s: any) => <tr key={s.from}><td>{s.from}</td><td>{s.to}</td><td className="num">{s.days}</td><td style={{ textAlign: 'left' }}>{s.regime.replace('_', ', ')}</td></tr>)}</tbody></table></div>
          <Method><p>{r.data.method}</p><ul>{r.data.caveats.map((c: string) => <li key={c}>{c}</li>)}</ul></Method>
        </>
      ))}
    </section>
  );
}

// ───────── Data integrity ─────────
export function Integrity() {
  const [key, setKey] = useState('crypto:bitcoin');
  const r = useRun<any>();
  const [finding, setFinding] = useState({ finding: 'gap', date: '', explanation: '' });
  const f = useRun<any>();
  return (
    <section className="card">
      <h2>Data integrity and source explorer</h2>
      <p className="mu">Provider status for every source is on <a href="/app/crypto/sources">Digital Assets → Sources & health</a> and <a href="/app/equities">Indian equities</a>.</p>
      <OnePicker value={key} onChange={setKey} label="Instrument" />
      <button className="btn" disabled={!key || r.busy} onClick={() => r.run(() => api('/v1/research/integrity', { body: { key } }))}>Check</button>
      <Problem error={r.err} />
      {r.data && (
        <>
          <InstrumentTable items={[r.data.instrument]} />
          <p>{r.data.gap_count} gap(s){r.data.suspect_observations !== undefined ? `; ${r.data.suspect_observations} flagged extreme move(s)` : ''}{r.data.quarantined ? `; ${r.data.quarantined.length} quarantined` : ''}.</p>
          {r.data.gaps.length > 0 && <ul>{r.data.gaps.slice(-10).map((g: any) => <li key={g.from}>{g.from} → {g.to}{g.missing ? ` (${g.missing} days)` : ''}</li>)}</ul>}
          {r.data.reconciliation && (
            <>
              <h3>Cross-source reconciliation</h3>
              {r.data.reconciliation.length ? <div className="wrap"><table className="term-table"><thead><tr><th scope="col" style={{ textAlign: 'left' }}>Compared with</th><th scope="col">Shared days</th><th scope="col">Median |dev|</th><th scope="col">Max |dev|</th><th scope="col">Days &gt; 2%</th></tr></thead><tbody>{r.data.reconciliation.map((x: any) => <tr key={x.other}><td style={{ textAlign: 'left' }}>{x.other}</td><td className="num">{x.shared_days}</td><td className="num">{(x.median_abs_deviation * 100).toFixed(2)}%</td><td className="num">{(x.max_abs_deviation * 100).toFixed(2)}%</td><td className="num">{x.days_over_2pct}{x.worst.length ? ` (e.g. ${x.worst[0].date})` : ''}</td></tr>)}</tbody></table></div> : <p className="mu">No other stored series for this asset.</p>}
              <p className="mu">{r.data.reconciliation_rule}</p>
            </>
          )}
          {r.data.revisions && <p className="mu">{r.data.revisions.length} recorded corrections.</p>}
          <h3>Document a finding</h3>
          <div className="cx-filters">
            <label className="field">Type<select value={finding.finding} onChange={(e) => setFinding({ ...finding, finding: e.target.value })}><option value="gap">Gap</option><option value="deviation">Cross-source deviation</option><option value="suspect">Flagged extreme move</option><option value="revision">Revision</option></select></label>
            <label className="field">Date<input type="date" value={finding.date} onChange={(e) => setFinding({ ...finding, date: e.target.value })} /></label>
            <label className="field" style={{ flex: 1 }}>What you found and why it matters (20+ characters)<textarea rows={2} value={finding.explanation} onChange={(e) => setFinding({ ...finding, explanation: e.target.value })} /></label>
            <button className="btn s" onClick={() => f.run(() => api('/v1/research/integrity/finding', { body: { key, ...finding } }))}>Save finding</button>
          </div>
          <Problem error={f.err} />
          {f.data && <p className="okbox">Saved to your notebook. The integrity check confirmed it.</p>}
        </>
      )}
    </section>
  );
}

// ───────── Discovery ─────────
export function Discovery() {
  const d = useApi<any>('/v1/research/discoveries');
  if (d.loading) return <Loading lines={6} label="Scanning stored data" />;
  if (d.error) return <Problem error={d.error} retry={d.reload} />;
  return (
    <section className="card">
      <h2>Research questions from the data</h2>
      <p className="mu">{d.data.note} Scanned {d.data.scanned} assets at {d.data.generated_at.slice(0, 16)} UTC.</p>
      {d.data.findings.length ? <ol className="term-feed" style={{ maxHeight: 'none' }}>{d.data.findings.map((f: any, i: number) => (
        <li key={i} style={{ display: 'block' }}>
          <span className="t c">{f.kind.replace('_', ' ')}</span> <strong>{f.label}</strong>: {f.what}
          <div className="mu" style={{ fontSize: 12 }}>Baseline: {f.baseline}. Period: {f.period}. Sources: {f.sources}. {f.robustness} Limitations: {f.limitations}</div>
        </li>
      ))}</ol> : <p className="mu">No rule fired on the current data.</p>}
      <Method><ul>{d.data.rules.map((r: string) => <li key={r}>{r}</li>)}</ul></Method>
    </section>
  );
}

// ───────── Notebook (notes, hypotheses, journal) ─────────
export function Notebook() {
  const [kind, setKind] = useState<'note' | 'hypothesis' | 'journal'>('note');
  const nb = useApi<{ rows: any[]; reviews_due: { entry_id: string; title: string; review_date: string }[] }>('/v1/research/notebook');
  const blank = { title: '', body: '', instruments: [] as string[], thesis: '', evidence_for: '', evidence_against: '', review_date: '', expected: '', observed: '', missed: '', assumptions: '', counterarguments: '' };
  const [f, setF] = useState(blank);
  const save = useRun<any>();
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const submit = () => save.run(async () => {
    const body: Record<string, unknown> = { kind, title: f.title, body: f.body, instruments: f.instruments, assumptions: f.assumptions || undefined, counterarguments: f.counterarguments || undefined };
    if (kind === 'hypothesis') Object.assign(body, { thesis: f.thesis, evidence_for: f.evidence_for, evidence_against: f.evidence_against, review_date: f.review_date });
    if (kind === 'journal') Object.assign(body, { expected: f.expected, observed: f.observed, missed: f.missed });
    const r = await api('/v1/research/notebook', { body });
    setF(blank);
    nb.reload();
    return r;
  });
  return (
    <>
      {nb.data && nb.data.reviews_due.length > 0 && <div className="warn">Hypotheses due for review: {nb.data.reviews_due.map((r) => r.title).join(', ')}.</div>}
      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}><h2>New entry</h2><a className="btn s" href="/v1/research/notebook/export">Export notebook (Markdown)</a></div>
        <div role="group" aria-label="Entry type" className="seg">{(['note', 'hypothesis', 'journal'] as const).map((k) => <button key={k} aria-pressed={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k === 'note' ? 'Note' : k === 'hypothesis' ? 'Hypothesis' : 'Journal reflection'}</button>)}</div>
        <label className="field">Title<input value={f.title} onChange={set('title')} maxLength={200} /></label>
        <InstrumentPicker value={f.instruments} onChange={(v) => setF({ ...f, instruments: v })} max={20} label="Attached instruments" />
        {kind === 'hypothesis' && (
          <>
            <p className="mu">Record the thesis before the outcome. The thesis and review date cannot be edited later.</p>
            <label className="field">Thesis<textarea rows={2} value={f.thesis} onChange={set('thesis')} /></label>
            <label className="field">Evidence for<textarea rows={2} value={f.evidence_for} onChange={set('evidence_for')} /></label>
            <label className="field">Evidence against<textarea rows={2} value={f.evidence_against} onChange={set('evidence_against')} /></label>
            <label className="field">Review date<input type="date" value={f.review_date} onChange={set('review_date')} /></label>
          </>
        )}
        {kind === 'journal' && (
          <>
            <label className="field">What I expected<textarea rows={2} value={f.expected} onChange={set('expected')} /></label>
            <label className="field">What the evidence showed<textarea rows={2} value={f.observed} onChange={set('observed')} /></label>
            <label className="field">What I missed, and what I would do differently<textarea rows={2} value={f.missed} onChange={set('missed')} /></label>
          </>
        )}
        <label className="field">Notes<textarea rows={4} value={f.body} onChange={set('body')} /></label>
        <label className="field">Assumptions<textarea rows={2} value={f.assumptions} onChange={set('assumptions')} /></label>
        <label className="field">Counterarguments<textarea rows={2} value={f.counterarguments} onChange={set('counterarguments')} /></label>
        <button className="btn" onClick={submit} disabled={!f.title || save.busy}>Save entry</button>
        <Problem error={save.err} />
      </section>
      <section className="card">
        <h2>Your notebook</h2>
        {nb.loading ? <Loading /> : nb.data?.rows.length ? nb.data.rows.map((r) => <NotebookEntry key={r.entry_id} e={r} onChange={nb.reload} />) : <p className="mu">No entries yet. Entries are private to you.</p>}
      </section>
    </>
  );
}

function NotebookEntry({ e, onChange }: { e: any; onChange: () => void }) {
  const [rv, setRv] = useState({ outcome: '', lessons: '' });
  const review = useRun<any>();
  return (
    <article className="qcard">
      <p style={{ margin: 0 }}><span className="t c">{e.kind}</span> <strong>{e.title}</strong> <span className="mu">{e.created_at.slice(0, 10)}</span></p>
      {e.thesis && <p><strong>Thesis:</strong> {e.thesis}</p>}
      {e.evidence_for && <p className="mu"><strong>For:</strong> {e.evidence_for} <strong>Against:</strong> {e.evidence_against}</p>}
      {e.expected && <p className="mu"><strong>Expected:</strong> {e.expected} <strong>Observed:</strong> {e.observed} <strong>Missed:</strong> {e.missed}</p>}
      {e.body && <p style={{ whiteSpace: 'pre-wrap' }}>{e.body}</p>}
      {e.instruments?.length > 0 && <p className="mu">{e.instruments.join(', ')}</p>}
      {e.kind === 'hypothesis' && (e.reviewed_at ? <p className="okbox">Reviewed {e.reviewed_at.slice(0, 10)}: {e.outcome} <em>Lessons:</em> {e.lessons}</p> : (
        <details><summary>Review (due {e.review_date})</summary>
          <label className="field">Outcome: what actually happened<textarea rows={2} value={rv.outcome} onChange={(x) => setRv({ ...rv, outcome: x.target.value })} /></label>
          <label className="field">Lessons<textarea rows={2} value={rv.lessons} onChange={(x) => setRv({ ...rv, lessons: x.target.value })} /></label>
          <button className="btn s" onClick={() => review.run(async () => { const r = await api(`/v1/research/notebook/${e.entry_id}/review`, { body: rv }); onChange(); return r; })}>Save review</button>
          <Problem error={review.err} />
        </details>
      ))}
      <button className="link" onClick={async () => { if (confirm('Delete this entry?')) { await api(`/v1/research/notebook/${e.entry_id}`, { method: 'DELETE' }); onChange(); } }}>Delete</button>
    </article>
  );
}

// ───────── Reports ─────────
export function Reports() {
  const list = useApi<{ rows: { report_id: string; title: string; created_at: string }[] }>('/v1/research/reports');
  const [f, setF] = useState({ title: '', question: '', keys: [] as string[], benchmark: 'crypto:bitcoin', range: '1y' });
  const r = useRun<any>();
  const open = useRun<any>();
  return (
    <>
      <section className="card">
        <h2>Build a report</h2>
        <label className="field">Title<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="field">Research question<textarea rows={2} value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })} /></label>
        <div className="grid2"><InstrumentPicker value={f.keys} onChange={(k) => setF({ ...f, keys: k })} /><OnePicker value={f.benchmark} onChange={(b) => setF({ ...f, benchmark: b })} label="Benchmark" /></div>
        <label className="field">Range<select value={f.range} onChange={(e) => setF({ ...f, range: e.target.value })}>{['1y', '3y', '5y', 'max'].map((x) => <option key={x}>{x}</option>)}</select></label>
        <button className="btn" disabled={!f.title || f.question.length < 10 || !f.keys.length || r.busy} onClick={() => r.run(async () => { const x = await api('/v1/research/reports', { body: { ...f, benchmark: f.benchmark || undefined } }); list.reload(); return x; })}>Generate</button>
        <Problem error={r.err} />
        {r.data && <ReportView r={r.data} />}
      </section>
      <section className="card">
        <h2>Your reports</h2>
        {list.data?.rows.length ? <ul>{list.data.rows.map((x) => <li key={x.report_id}><button className="link" onClick={() => open.run(() => api(`/v1/research/reports/${x.report_id}`))}>{x.title}</button> <span className="mu">{x.created_at.slice(0, 10)}</span> · <a href={`/v1/research/reports/${x.report_id}/markdown`}>Markdown</a></li>)}</ul> : <p className="mu">No reports yet.</p>}
        {open.data && <ReportView r={{ ...open.data.content, title: open.data.title, report_id: open.data.report_id }} />}
      </section>
    </>
  );
}
function ReportView({ r }: { r: any }) {
  return (
    <article className="qcard">
      <h3>{r.title}</h3>
      <p><strong>Question:</strong> {r.question}</p>
      <p className="mu">Shared dates {r.period.shared_from} → {r.period.shared_to} ({r.period.shared_dates}). Generated {r.generated_at.slice(0, 16)} UTC by {r.generator}.</p>
      <InstrumentTable items={r.instruments} />
      <h4>Findings</h4>
      <ul>{r.findings.map((f: any, i: number) => <li key={i}><span className={`t ${f.kind === 'calculation' ? 'o' : 'i'}`}>{f.kind}</span> {f.text}</li>)}</ul>
      <h4>Alternative interpretations</h4><ul>{r.alternative_interpretations.map((x: string) => <li key={x}>{x}</li>)}</ul>
      <h4>Limitations</h4><ul>{r.limitations.map((x: string) => <li key={x}>{x}</li>)}</ul>
      <h4>Unavailable inputs</h4><ul>{r.unavailable.map((x: string) => <li key={x}>{x}</li>)}</ul>
      {r.report_id && <a className="btn s" href={`/v1/research/reports/${r.report_id}/markdown`}>Download Markdown</a>}
    </article>
  );
}

// ───────── Alerts ─────────
export function Alerts() {
  const a = useApi<any>('/v1/research/alerts');
  const [f, setF] = useState({ kind: 'price_above', instrument_key: 'crypto:bitcoin', source_id: 'coingecko', threshold: 0, cooldown_minutes: 360 });
  const create = useRun<any>();
  const ev = useRun<any>();
  const needsThreshold = !['data_stale', 'source_unhealthy'].includes(f.kind);
  return (
    <>
      <section className="card">
        <h2>New alert</h2>
        <div className="cx-filters">
          <label className="field">Type<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.keys(a.data?.definitions ?? { price_above: '' }).map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}</select></label>
          {f.kind === 'source_unhealthy' ? <label className="field">Source<input value={f.source_id} onChange={(e) => setF({ ...f, source_id: e.target.value })} /></label> : <OnePicker value={f.instrument_key} onChange={(k) => setF({ ...f, instrument_key: k })} label="Instrument" />}
          {needsThreshold && <label className="field">Threshold<input type="number" value={f.threshold} onChange={(e) => setF({ ...f, threshold: Number(e.target.value) })} /></label>}
          <label className="field">Cooldown (minutes)<input type="number" min={5} value={f.cooldown_minutes} onChange={(e) => setF({ ...f, cooldown_minutes: Number(e.target.value) })} /></label>
          <button className="btn" onClick={() => create.run(async () => { const r = await api('/v1/research/alerts', { body: { kind: f.kind, cooldown_minutes: f.cooldown_minutes, ...(f.kind === 'source_unhealthy' ? { source_id: f.source_id } : { instrument_key: f.instrument_key }), ...(needsThreshold ? { threshold: f.threshold } : {}) } }); a.reload(); return r; })}>Create</button>
        </div>
        <p className="mu">{a.data?.definitions?.[f.kind]}</p>
        <Problem error={create.err} />
      </section>
      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}><h2>Your alerts</h2><button className="btn s" onClick={() => ev.run(async () => { const r = await api('/v1/research/alerts/evaluate', { body: {} }); a.reload(); return r; })}>Check now</button></div>
        {ev.data && <p className="mu">Checked {ev.data.evaluated} rule(s): {ev.data.triggered} triggered, {ev.data.errors} could not be evaluated.</p>}
        <p className="mu">{a.data?.delivery}</p>
        {a.loading ? <Loading /> : a.error ? <Problem error={a.error} /> : (
          <>
            {a.data.rules.length ? <div className="wrap"><table className="term-table"><thead><tr><th scope="col" style={{ textAlign: 'left' }}>Rule</th><th scope="col">Threshold</th><th scope="col">Last checked</th><th scope="col">Last triggered</th><th scope="col">Status</th><th scope="col" /></tr></thead>
              <tbody>{a.data.rules.map((r: any) => <tr key={r.rule_id}><td style={{ textAlign: 'left' }}>{r.kind.replace(/_/g, ' ')} · {r.instrument_key ?? r.source_id}</td><td className="num">{r.threshold ?? '—'}</td><td>{r.last_evaluated_at?.slice(0, 16) ?? 'never'}</td><td>{r.last_triggered_at?.slice(0, 16) ?? '—'}</td><td>{r.last_error ? <span className="t r" title={r.last_error}>error</span> : r.enabled ? <span className="t o">on</span> : <span className="t m">off</span>}</td><td><button className="link" onClick={async () => { await api(`/v1/research/alerts/${r.rule_id}`, { method: 'PATCH', body: { enabled: !r.enabled } }); a.reload(); }}>{r.enabled ? 'Disable' : 'Enable'}</button> · <button className="link" onClick={async () => { await api(`/v1/research/alerts/${r.rule_id}`, { method: 'DELETE' }); a.reload(); }}>Delete</button></td></tr>)}</tbody></table></div> : <p className="mu">No alerts.</p>}
            <h3>Recent triggers</h3>
            {a.data.events.length ? <ul>{a.data.events.map((e: any) => <li key={e.event_id}>{e.triggered_at.slice(0, 16)}: {e.message}</li>)}</ul> : <p className="mu">None yet.</p>}
          </>
        )}
      </section>
    </>
  );
}
