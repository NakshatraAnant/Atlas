'use client';
import { use, useEffect, useState } from 'react';
import { LineChart, Bars } from '@/components/charts';
import { api, download } from '@/lib/api';
import { useApp } from '@/components/providers';
import { Loading, Problem, useApi } from '@/components/ui';
import { dateOrDash, fmt, formatDate, pct } from '@/lib/format';

interface Run {
  run: { run_id: string; name: string | null; status: string; progress: number; template_code: string; template_version: number; engine_version: string; cost_table_version: string; benchmark_code: string; snapshot_id: string; config: any; results_hash: string | null; saved: boolean; error: string | null; created_at: string; runtime_ms: number | null; rerun_of: string | null;
    metrics: null | { cagr: number; total_return: number; benchmark_return: number; excess_return: number; max_drawdown: number; max_drawdown_duration: number; volatility: number; sharpe: number | null; trades: number; win_rate: number | null; avg_gain: number | null; avg_loss: number | null; exposure: number; turnover: number; total_costs: number; doubled_costs_total_return: number; final_equity: number; skipped_trades: number; by_year: { year: string; return_pct: number }[]; by_regime: { regime: string; sessions: number; return_pct: number }[]; cost_breakdown: Record<string, number>; benchmark: { name: string; type: string }; universe: { type: string; securities_considered: number; delisted_in_universe: number; delisted_held: number }; period: { from: string; to: string; sessions: number } };
    warnings: { code: string; title: string; why: string; methodology: string }[] };
  definitions: { code: string; name: string; url: string }[]; methodology: string; watermark: string | null;
}

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { toast } = useApp();
  const r = useApi<Run>(`/v1/backtests/${id}`);
  const status = r.data?.run.status;
  const done = status === 'succeeded';
  const series = useApi<{ dates: string[]; equity: number[]; benchmark: number[]; drawdown: number[] }>(done ? `/v1/backtests/${id}/series` : null, [done]);
  const trades = useApi<{ total: number; trades: { seq: number; symbol: string; side: string; trade_date: string; price: number; quantity: number; gross_value: number; costs: { total: number }; pnl: number | null; reason: string }[] }>(done ? `/v1/backtests/${id}/trades` : null, [done]);
  const [name, setName] = useState('');
  useEffect(() => {
    if (status === 'queued' || status === 'running') {
      const t = setTimeout(() => r.reload(), 1500);
      return () => clearTimeout(t);
    }
  }, [status, r]);
  if (r.loading && !r.data) return <Loading lines={8} />;
  if (r.error) return <Problem error={r.error} retry={r.reload} />;
  const d = r.data!;
  const run = d.run;
  if (run.status === 'queued' || run.status === 'running') return <div className="card"><h1>Backtest {run.status}</h1><div className="meter" role="progressbar" aria-valuenow={run.progress} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${run.progress}%` }} /></div><p className="mu">Universe strategies run in a queue. You can leave this page; the run continues.</p></div>;
  if (run.status === 'failed') return <div className="card err"><h1>Backtest failed</h1><p>{run.error}</p><p>Failed runs do not count against your allowance.</p></div>;
  const m = run.metrics!;
  const s = series.data;
  const step = s ? Math.max(1, Math.floor(s.dates.length / 600)) : 1;
  const pts = (arr: number[]) => (s ? s.dates.filter((_, i) => i % step === 0).map((x, i) => ({ x, y: arr[i * step] ?? null })) : []);
  const save = async () => {
    await api(`/v1/backtests/${id}`, { method: 'PATCH', body: { saved: true, name: name || undefined } });
    toast('Run saved');
    r.reload();
  };
  const rerun = async () => {
    try {
      const x = await api<{ run_id: string }>(`/v1/backtests/${id}/rerun`, { body: {} });
      window.location.href = `/app/lab/runs/${x.run_id}`;
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const tiles: [string, string, string][] = [
    ['Total return', pct(m.total_return, 1), 'bt_total_return'], ['CAGR', pct(m.cagr, 1), 'bt_cagr'], [`Benchmark (${m.benchmark.type.toLowerCase()})`, pct(m.benchmark_return, 1), 'bt_benchmark_return'], ['Excess return', fmt(m.excess_return, 'pp'), 'bt_excess_return'],
    ['Maximum drawdown', pct(m.max_drawdown, 1), 'bt_max_drawdown'], ['Longest drawdown', `${m.max_drawdown_duration} sessions`, 'bt_max_drawdown_duration'], ['Volatility', fmt(m.volatility, 'percent'), 'bt_volatility'], ['Sharpe ratio', fmt(m.sharpe), 'bt_sharpe'],
    ['Trades', String(m.trades), 'bt_trades'], ['Win rate', m.win_rate === null ? '—' : fmt(m.win_rate, 'percent'), 'bt_win_rate'], ['Exposure', fmt(m.exposure, 'percent'), 'bt_exposure'], ['Total costs', fmt(m.total_costs, 'INR'), 'bt_total_costs'],
  ];
  return (
    <>
      <p><a href="/app/lab">← Quant Lab</a></p>
      <h1>{run.name ?? run.template_code.replace(/_/g, ' ')} {d.watermark && <span className="wm">{d.watermark}</span>}</h1>
      <p className="mu">{formatDate(m.period.from)} – {formatDate(m.period.to)} · {m.period.sessions} sessions · benchmark {m.benchmark.name} · template v{run.template_version} · {run.engine_version} · costs {run.cost_table_version} · run {dateOrDash(run.created_at)}{run.runtime_ms ? ` in ${run.runtime_ms} ms` : ''}</p>
      {run.warnings.length > 0 && <div className="warn" role="note"><strong>Read before relying on this result</strong><ul>{run.warnings.map((w) => <li key={w.code}><strong>{w.title}.</strong> {w.why} <a href={w.methodology}>Why this matters</a></li>)}</ul></div>}
      <div className="grid">{tiles.map(([l, v, code]) => <div key={l} className="card" style={{ margin: 0 }}><div className="mu"><a href={`/methodology/metrics/${code}`}>{l}</a></div><div className="big">{v}</div></div>)}</div>
      <p className="mu">With costs doubled, total return would be {pct(m.doubled_costs_total_return, 1)}. {m.skipped_trades > 0 && `${m.skipped_trades} trades were skipped by the liquidity rule.`} Universe: {m.universe.securities_considered} securities considered{m.universe.delisted_in_universe ? `, including ${m.universe.delisted_in_universe} later delisted (no survivorship bias)` : ''}.</p>
      <section className="card">
        {s ? <LineChart title="Strategy equity against benchmark" yLabel="Portfolio value (₹)" series={[{ name: 'Strategy', points: pts(s.equity) }, { name: m.benchmark.name, dashed: true, points: pts(s.benchmark) }]} /> : <Loading />}
        {s && <LineChart title="Drawdown" yLabel="Drawdown (%)" height={140} format={(v) => `${v.toFixed(0)}%`} series={[{ name: 'Drawdown', color: 'var(--rd)', points: pts(s.drawdown.map((x) => x * 100)) }]} />}
      </section>
      <div className="grid2">
        <section className="card"><Bars title="Return by calendar year" items={m.by_year.map((y) => ({ label: y.year, value: y.return_pct }))} /></section>
        <section className="card"><Bars title="Return by market regime" items={m.by_regime.map((y) => ({ label: `${y.regime} (${y.sessions})`, value: y.return_pct }))} />
          <h3>Cost breakdown</h3><ul className="mu">{Object.entries(m.cost_breakdown).map(([k, v]) => <li key={k}>{k}: {fmt(v, 'INR')}</li>)}</ul></section>
      </div>
      <section className="card"><h2>Trades {trades.data && <span className="mu">({trades.data.total})</span>}</h2>
        {trades.data && <div className="wrap"><table><caption className="sr-only">Trade list</caption>
          <thead><tr><th scope="col">#</th><th scope="col">Date</th><th scope="col">Security</th><th scope="col">Side</th><th scope="col">Price</th><th scope="col">Quantity</th><th scope="col">Value</th><th scope="col">Costs</th><th scope="col">P&amp;L</th><th scope="col">Reason</th></tr></thead>
          <tbody>{trades.data.trades.map((t) => <tr key={t.seq}><td>{t.seq}</td><td>{formatDate(t.trade_date)}</td><td>{t.symbol}</td><td>{t.side}</td><td>{fmt(t.price, 'INR')}</td><td>{fmt(t.quantity, 'count')}</td><td>{fmt(t.gross_value, 'INR')}</td><td>{fmt(t.costs.total, 'INR')}</td><td className={t.pnl === null ? '' : t.pnl >= 0 ? 'up' : 'dn'}>{t.pnl === null ? '—' : fmt(t.pnl, 'INR')}</td><td>{t.reason}</td></tr>)}</tbody>
        </table></div>}
      </section>
      <section className="card"><h2>Reproducibility</h2>
        <p className="mu">Data snapshot {run.snapshot_id} · results hash <code>{run.results_hash}</code>{run.rerun_of && <> · re-run of <a href={`/app/lab/runs/${run.rerun_of}`}>an earlier run</a></>}</p>
        <div className="row">
          {!run.saved && <><input aria-label="Run name" placeholder="Name (optional)" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /><button className="btn" onClick={save}>Save run</button></>}
          <button className="btn s" onClick={rerun}>Re-run on the same snapshot</button>
          <button className="btn s" onClick={async () => { try { await download(`/v1/backtests/${id}/export`, {}, `atlas-backtest-${id.slice(0, 8)}.pdf`); } catch (e) { toast((e as Error).message); } }}>Export PDF report</button>
          <a className="btn s" href={`/app/assistant?q=${encodeURIComponent('Explain the results of this backtest')}&run_id=${id}`}>Ask about this run</a>
        </div>
        <p><a href={d.methodology}>Backtest methodology</a></p>
      </section>
    </>
  );
}
