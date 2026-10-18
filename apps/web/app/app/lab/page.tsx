'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/components/providers';
import { Loading, Problem, useApi } from '@/components/ui';
import { dateOrDash, fmt, pct } from '@/lib/format';

interface Template { code: string; version: number; name: string; kind: string; description: string; rules: string; params: { key: string; label: string; default: number; min: number; max: number; step: number }[]; limitations: string[]; universeKinds: string[] }
interface Meta { templates: Template[]; cost_table: Record<string, number | string>; engine_version: string; indices: { index_code: string; name: string }[]; defaults: { slippage_bps: number; capital_inr: number; execution: string }; no_forward_signals: string }

export default function Lab() {
  const { me } = useApp();
  const meta = useApi<Meta>('/v1/backtests/templates');
  const runs = useApi<{ runs: { run_id: string; name: string | null; template_code: string; status: string; saved: boolean; created_at: string; total_return: number | null; benchmark_code: string | null }[] }>('/v1/backtests');
  const cov = useApi<{ companies: { company_id: string; short_name: string }[] }>('/v1/coverage');
  const screens = useApi<{ screens: { screen_id: string; name: string }[] }>('/v1/screens');
  const [tpl, setTpl] = useState('ma_crossover');
  const [params, setParams] = useState<Record<string, number>>({});
  const [uType, setUType] = useState<'security' | 'index' | 'screen'>('security');
  const [uRef, setURef] = useState('');
  const [from, setFrom] = useState('2019-01-01');
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [costs, setCosts] = useState(true);
  const [slip, setSlip] = useState(10);
  const [capital, setCapital] = useState(1_000_000);
  const [err, setErr] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);
  if (meta.loading) return <Loading lines={6} />;
  if (meta.error) return <Problem error={meta.error} retry={meta.reload} />;
  const m = meta.data!;
  const t = m.templates.find((x) => x.code === tpl)!;
  const universeOk = t.universeKinds.includes(uType);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const universe = uType === 'security' ? { type: 'security', company_id: uRef || cov.data?.companies[0]?.company_id } : uType === 'index' ? { type: 'index', index_code: uRef || m.indices[0]?.index_code } : { type: 'screen', screen_id: uRef || screens.data?.screens[0]?.screen_id };
      const p = Object.fromEntries(t.params.map((x) => [x.key, params[x.key] ?? x.default]));
      const r = await api<{ run_id: string; status: string }>('/v1/backtests', { body: { template: tpl, params: p, universe, period: { from, to }, costs: { included: costs, slippage_bps: slip }, capital_inr: capital }, headers: { 'idempotency-key': `bt-${Date.now()}` } });
      window.location.href = `/app/lab/runs/${r.run_id}`;
    } catch (e) {
      setErr(e as Error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h1>Quant Research Lab</h1>
      <p className="warn">{m.no_forward_signals} Backtests show how rules would have behaved on past data, with costs; past results do not predict future returns.</p>
      <div className="grid2">
        <section className="card stack" aria-labelledby="nb">
          <h2 id="nb">New backtest</h2>
          <label className="field">Strategy template
            <select value={tpl} onChange={(e) => { setTpl(e.target.value); setParams({}); }}>{m.templates.map((x) => <option key={x.code} value={x.code}>{x.name} (v{x.version})</option>)}</select>
          </label>
          <p>{t.description}</p>
          <p className="mu">Rules: {t.rules}</p>
          {t.params.map((p) => (
            <label key={p.key} className="field">{p.label} <span className="mu">({p.min}–{p.max})</span>
              <input type="number" min={p.min} max={p.max} step={p.step} value={params[p.key] ?? p.default} onChange={(e) => setParams({ ...params, [p.key]: Number(e.target.value) })} />
            </label>
          ))}
          <fieldset style={{ border: 0, padding: 0 }}><legend>Universe</legend>
            <div className="row">
              {(['security', 'index', 'screen'] as const).map((k) => <label key={k}><input type="radio" name="u" checked={uType === k} disabled={!t.universeKinds.includes(k)} onChange={() => { setUType(k); setURef(''); }} /> {k === 'security' ? 'One company' : k === 'index' ? 'Index constituents' : 'Saved screen'}</label>)}
            </div>
            {uType === 'security' && <select aria-label="Company" value={uRef} onChange={(e) => setURef(e.target.value)}>{cov.data?.companies.map((c) => <option key={c.company_id} value={c.company_id}>{c.short_name}</option>)}</select>}
            {uType === 'index' && <select aria-label="Index" value={uRef} onChange={(e) => setURef(e.target.value)}>{m.indices.map((i) => <option key={i.index_code} value={i.index_code}>{i.name}</option>)}</select>}
            {uType === 'screen' && (screens.data?.screens.length ? <select aria-label="Screen" value={uRef} onChange={(e) => setURef(e.target.value)}>{screens.data.screens.map((s) => <option key={s.screen_id} value={s.screen_id}>{s.name}</option>)}</select> : <p className="mu">Save a screen in the Screener first.</p>)}
            {uType !== 'security' && !me?.entitlements.backtest_universe_strategies && <p className="mu">Universe strategies are part of Pro Research.</p>}
          </fieldset>
          <div className="row">
            <label className="field">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="field">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          <div className="row">
            <label><input type="checkbox" checked={costs} onChange={(e) => setCosts(e.target.checked)} /> Include Indian delivery costs ({String(m.cost_table.version)})</label>
            <label className="field">Slippage (basis points)<input type="number" min={0} max={200} value={slip} onChange={(e) => setSlip(Number(e.target.value))} style={{ width: 90 }} /></label>
            <label className="field">Starting capital (₹)<input type="number" min={10000} step={10000} value={capital} onChange={(e) => setCapital(Number(e.target.value))} style={{ width: 140 }} /></label>
          </div>
          <p className="mu">Execution: {m.defaults.execution} Engine {m.engine_version}.</p>
          <details><summary>Template limitations</summary><ul>{t.limitations.map((l) => <li key={l}>{l}</li>)}</ul></details>
          <Problem error={err} />
          <button className="btn" onClick={submit} disabled={busy || !universeOk}>{busy ? 'Running…' : 'Run backtest'}</button>
          {me && <p className="mu">{me.usage.backtests} of {me.entitlements.backtests_per_month < 0 ? 'unlimited' : me.entitlements.backtests_per_month} backtests used this month.</p>}
        </section>
        <section className="card" aria-labelledby="rr">
          <h2 id="rr">Your runs</h2>
          {runs.loading ? <Loading /> : runs.error ? <Problem error={runs.error} /> : runs.data!.runs.length === 0 ? <p className="mu">No runs yet.</p> : (
            <>
              <div className="wrap"><table><caption className="sr-only">Runs</caption>
                <thead><tr><th scope="col"><span className="sr-only">Compare</span></th><th scope="col">Run</th><th scope="col">Status</th><th scope="col">Total return</th><th scope="col">Date</th></tr></thead>
                <tbody>{runs.data!.runs.map((r) => (
                  <tr key={r.run_id}>
                    <td><input type="checkbox" aria-label="Select to compare" checked={compare.includes(r.run_id)} disabled={!compare.includes(r.run_id) && compare.length >= 4} onChange={(e) => setCompare(e.target.checked ? [...compare, r.run_id] : compare.filter((x) => x !== r.run_id))} /></td>
                    <td><a href={`/app/lab/runs/${r.run_id}`}>{r.name ?? r.template_code}</a>{r.saved && <span className="t o">saved</span>}</td>
                    <td>{r.status}</td><td>{r.total_return === null ? '—' : pct(r.total_return, 1)}</td><td>{dateOrDash(r.created_at)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              <a className={`btn s`} aria-disabled={compare.length < 2} href={compare.length >= 2 ? `/app/lab/compare?ids=${compare.join(',')}` : undefined}>Compare selected ({compare.length})</a>
            </>
          )}
          <h3>Cost table</h3>
          <p className="mu">STT {fmt(Number(m.cost_table.stt_pct_buy) * 100)}% each side · stamp duty {(Number(m.cost_table.stamp_duty_pct_buy) * 100).toFixed(3)}% on buys · exchange, SEBI and GST included · DP charge ₹{String(m.cost_table.dp_charge_per_sell_inr)} per sell. <a href="/methodology/backtests">Methodology</a></p>
        </section>
      </div>
    </>
  );
}
