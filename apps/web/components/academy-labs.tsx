'use client';

import {
  compound, costDragPct, dcf, dcfSensitivity, doublingYears, dupont, equalWeightVol, evBridge, indexReturns, maxDrawdown, multipleTesting, operatingCashFlow, overfitDemo, realReturnPct, roce, twoAssetVol,
} from '@atlas/shared';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ThreeStatementsScene } from './statements3d';
import { AmmPoolScene, ConsensusScene, DepthScene, QuantScene, SigningLab, TokenomicsScene, TxJourneyScene } from './crypto-scenes';

// Interactive labs for the four Academy courses. Every number comes from the tested simulations in
// @atlas/shared; every lab states its result in text (aria-live) so it works without the visual.

const fmt = (x: number | null | undefined, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? 'not meaningful' : x.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: 0 }));

function Num({ label, value, onChange, min, max, step = 1, suffix }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  return (
    <label className="field">{label}{suffix ? ` (${suffix})` : ''}
      <input type="number" value={Number.isFinite(value) ? value : ''} min={min} max={max} step={step} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(min !== undefined && v < min ? min : max !== undefined && v > max ? max : v); }} style={{ width: 120 }} />
    </label>
  );
}

function Slider({ label, value, onChange, min, max, step, suffix }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; suffix?: string }) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>{label}: <strong>{value}{suffix ?? ''}</strong>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Result({ children }: { children: ReactNode }) {
  return <p className="lab-result" aria-live="polite">{children}</p>;
}

function Bars({ items, unit = '' }: { items: { label: string; value: number }[]; unit?: string }) {
  const max = Math.max(1e-9, ...items.map((i) => Math.abs(i.value)));
  return (
    <div className="hbars" aria-hidden="true">
      {items.map((i) => (
        <div key={i.label} className="hbar"><span>{i.label}</span><i className={i.value < 0 ? 'neg' : ''} style={{ width: `${(Math.abs(i.value) / max) * 100}%` }} /><b>{fmt(i.value)}{unit}</b></div>
      ))}
    </div>
  );
}

function Line({ series, labels, height = 140 }: { series: { name: string; values: number[]; className?: string }[]; labels?: string; height?: number }) {
  const w = 360;
  const all = series.flatMap((s) => s.values).filter(Number.isFinite);
  const lo = Math.min(0, ...all);
  const hi = Math.max(...all, 1e-9);
  const n = Math.max(...series.map((s) => s.values.length));
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * w);
  const y = (v: number) => height - ((v - lo) / (hi - lo || 1)) * height;
  return (
    <svg viewBox={`-4 -4 ${w + 8} ${height + 8}`} className="pathsvg" role="img" aria-label={labels ?? 'Chart; values are given in the text below.'}>
      {series.map((s) => <polyline key={s.name} className={s.className} points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />)}
    </svg>
  );
}

// ───────────── Course 1 ─────────────

export function DiversificationLab() {
  const [sigma, setSigma] = useState(30);
  const [rho, setRho] = useState(0.3);
  const [n, setN] = useState(10);
  const ns = [1, 2, 5, 10, 20, 50, 100];
  const curve = ns.map((k) => equalWeightVol(sigma, k, rho));
  const v = equalWeightVol(sigma, n, rho);
  return (
    <div className="lab">
      <div className="row">
        <Slider label="Volatility of each share" value={sigma} onChange={setSigma} min={10} max={60} step={1} suffix="%" />
        <Slider label="Average correlation" value={rho} onChange={setRho} min={0} max={1} step={0.05} />
        <Slider label="Number of shares held equally" value={n} onChange={setN} min={1} max={100} step={1} />
      </div>
      <Line series={[{ name: 'vol', values: curve }]} labels={`Portfolio volatility for ${ns.join(', ')} shares: ${curve.map((c) => fmt(c)).join(', ')} percent.`} />
      <Result>With {n} share{n === 1 ? '' : 's'}, portfolio volatility is <strong>{fmt(v)}%</strong>. However many shares you add, it cannot fall below about {fmt(sigma * Math.sqrt(rho))}% (the shared market risk).</Result>
    </div>
  );
}

export function CompoundLab() {
  const [p, setP] = useState(10000);
  const [r, setR] = useState(10);
  const [years, setYears] = useState(20);
  const comp = Array.from({ length: years + 1 }, (_, t) => compound(p, r, t));
  const simple = Array.from({ length: years + 1 }, (_, t) => p * (1 + (r / 100) * t));
  return (
    <div className="lab">
      <div className="row">
        <Num label="Starting amount" suffix="₹" value={p} onChange={setP} min={1} />
        <Slider label="Yearly rate" value={r} onChange={setR} min={1} max={20} step={0.5} suffix="%" />
        <Slider label="Years" value={years} onChange={setYears} min={1} max={40} step={1} />
      </div>
      <Line series={[{ name: 'compound', values: comp }, { name: 'simple', values: simple, className: 'alt' }]} />
      <Result>After {years} years: compound <strong>₹{fmt(comp[years], 0)}</strong> versus simple ₹{fmt(simple[years], 0)}. Money doubles in about {fmt(doublingYears(r), 1)} years at {r}% (rule of 72: {fmt(72 / r, 1)}).</Result>
    </div>
  );
}

export function RealReturnLab() {
  const [nom, setNom] = useState(7);
  const [inf, setInf] = useState(5);
  const real = realReturnPct(nom, inf);
  const future = compound(100000, nom, 10);
  const todays = future / Math.pow(1 + inf / 100, 10);
  return (
    <div className="lab">
      <div className="row">
        <Slider label="Nominal return" value={nom} onChange={setNom} min={0} max={15} step={0.5} suffix="%" />
        <Slider label="Inflation" value={inf} onChange={setInf} min={0} max={12} step={0.5} suffix="%" />
      </div>
      <Bars items={[{ label: 'Future rupees', value: future }, { label: "Today's rupees", value: todays }]} />
      <Result>Real return: <strong>{fmt(real, 3)}%</strong> a year. ₹1,00,000 becomes ₹{fmt(future, 0)} in ten years, worth about ₹{fmt(todays, 0)} in today&apos;s rupees.</Result>
    </div>
  );
}

export function IndexWeightingLab() {
  const [big, setBig] = useState(10);
  const [small, setSmall] = useState(-10);
  const [bigShare, setBigShare] = useState(90);
  const r = indexReturns([{ name: 'Large company', price0: 100, price1: 100 * (1 + big / 100), shares: bigShare }, { name: 'Small company', price0: 100, price1: 100 * (1 + small / 100), shares: 100 - bigShare }]);
  return (
    <div className="lab">
      <div className="row">
        <Slider label="Large company's share of index value" value={bigShare} onChange={setBigShare} min={50} max={95} step={5} suffix="%" />
        <Slider label="Large company price change" value={big} onChange={setBig} min={-20} max={20} step={1} suffix="%" />
        <Slider label="Small company price change" value={small} onChange={setSmall} min={-20} max={20} step={1} suffix="%" />
      </div>
      <Bars items={[{ label: 'Cap-weighted', value: r.cap_weighted_pct }, { label: 'Equal-weighted', value: r.equal_weighted_pct }]} unit="%" />
      <Result>Cap-weighted index: <strong>{fmt(r.cap_weighted_pct)}%</strong>; equal-weighted: <strong>{fmt(r.equal_weighted_pct)}%</strong>.</Result>
    </div>
  );
}

// ───────────── Course 2 ─────────────

export function StatementFlowLab() {
  const [np, setNp] = useState(100);
  const [dep, setDep] = useState(20);
  const [rec, setRec] = useState(60);
  const [inv, setInv] = useState(30);
  const [pay, setPay] = useState(10);
  const r = operatingCashFlow({ netProfit: np, depreciation: dep, receivablesChange: rec, inventoryChange: inv, payablesChange: pay });
  return (
    <div className="lab">
      <div className="row">
        <Num label="Net profit" suffix="₹ crore" value={np} onChange={setNp} />
        <Num label="Depreciation" suffix="₹ crore" value={dep} onChange={setDep} min={0} />
        <Num label="Increase in receivables" suffix="₹ crore" value={rec} onChange={setRec} />
        <Num label="Increase in inventory" suffix="₹ crore" value={inv} onChange={setInv} />
        <Num label="Increase in payables" suffix="₹ crore" value={pay} onChange={setPay} />
      </div>
      <table><caption>Profit-to-cash bridge (₹ crore)</caption><tbody>
        <tr><th scope="row">Net profit</th><td>{fmt(np)}</td></tr>
        <tr><th scope="row">+ Depreciation (non-cash)</th><td>{fmt(dep)}</td></tr>
        <tr><th scope="row">− Increase in working capital</th><td>{fmt(-r.working_capital_change)}</td></tr>
        <tr><th scope="row"><strong>Operating cash flow</strong></th><td><strong>{fmt(r.ocf)}</strong></td></tr>
      </tbody></table>
      <Result>Operating cash flow is ₹{fmt(r.ocf)} crore; cash conversion is <strong>{r.cash_conversion_pct === null ? 'not meaningful (profit is not positive)' : `${fmt(r.cash_conversion_pct)}%`}</strong>.</Result>
    </div>
  );
}

export function DupontLab() {
  const [rev, setRev] = useState(1500);
  const [np, setNp] = useState(150);
  const [assets, setAssets] = useState(1000);
  const [equity, setEquity] = useState(500);
  const [ebit, setEbit] = useState(220);
  let d: ReturnType<typeof dupont> | null = null;
  try { d = dupont({ revenue: rev, netProfit: np, assets, equity }); } catch { d = null; }
  const debt = Math.max(0, assets - equity);
  const rc = roce(ebit, equity, debt);
  return (
    <div className="lab">
      <div className="row">
        <Num label="Revenue" suffix="₹ crore" value={rev} onChange={setRev} min={1} />
        <Num label="Net profit" suffix="₹ crore" value={np} onChange={setNp} />
        <Num label="EBIT" suffix="₹ crore" value={ebit} onChange={setEbit} />
        <Num label="Total assets" suffix="₹ crore" value={assets} onChange={setAssets} min={1} />
        <Num label="Equity" suffix="₹ crore" value={equity} onChange={setEquity} min={1} />
      </div>
      {d ? (
        <>
          <Bars items={[{ label: 'Net margin %', value: d.net_margin_pct }, { label: 'Asset turnover ×', value: d.asset_turnover }, { label: 'Equity multiplier ×', value: d.equity_multiplier }]} />
          <Result>ROE = {fmt(d.net_margin_pct)}% × {fmt(d.asset_turnover)} × {fmt(d.equity_multiplier)} = <strong>{fmt(d.roe_pct)}%</strong> (profit ÷ equity: {fmt(d.roe_direct_pct)}%). Treating assets beyond equity as debt (₹{fmt(debt)} crore), ROCE = <strong>{rc === null ? 'not meaningful' : `${fmt(rc)}%`}</strong> and debt-to-equity = {fmt(debt / equity)}.</Result>
        </>
      ) : <Result>Revenue, assets and equity must be positive.</Result>}
    </div>
  );
}

export function EvBridgeLab() {
  const [mcap, setMcap] = useState(1500);
  const [debt, setDebt] = useState(500);
  const [cash, setCash] = useState(200);
  const [ebitda, setEbitda] = useState(225);
  const [np, setNp] = useState(100);
  const r = evBridge({ marketCap: mcap, debt, cash, ebitda, netProfit: np });
  return (
    <div className="lab">
      <div className="row">
        <Num label="Market capitalisation" suffix="₹ crore" value={mcap} onChange={setMcap} min={0} />
        <Num label="Debt" suffix="₹ crore" value={debt} onChange={setDebt} min={0} />
        <Num label="Cash" suffix="₹ crore" value={cash} onChange={setCash} min={0} />
        <Num label="EBITDA" suffix="₹ crore" value={ebitda} onChange={setEbitda} />
        <Num label="Net profit" suffix="₹ crore" value={np} onChange={setNp} />
      </div>
      <Bars items={[{ label: 'Market cap', value: mcap }, { label: '+ Debt', value: debt }, { label: '− Cash', value: -cash }, { label: '= EV', value: r.ev }]} />
      <Result>Enterprise value <strong>₹{fmt(r.ev)} crore</strong>; EV/EBITDA {r.ev_ebitda === null ? 'not meaningful' : `${fmt(r.ev_ebitda)}×`}; P/E {r.pe === null ? 'not meaningful (no profit)' : `${fmt(r.pe)}×`}.</Result>
    </div>
  );
}

// ───────────── Course 3 ─────────────

export function DrawdownLab() {
  const [text, setText] = useState('100, 150, 90, 120');
  const values = text.split(/[,\s]+/).map(Number).filter((x) => Number.isFinite(x) && x > 0).slice(0, 60);
  const dd = values.length >= 2 ? maxDrawdown(values) : null;
  const peakLine = values.map((_, i) => Math.max(...values.slice(0, i + 1)));
  return (
    <div className="lab">
      <label className="field">Portfolio values over time (comma-separated, positive)
        <input value={text} onChange={(e) => setText(e.target.value)} style={{ width: '100%' }} />
      </label>
      {dd ? (
        <>
          <Line series={[{ name: 'value', values }, { name: 'peak', values: peakLine, className: 'alt' }]} labels={`Values: ${values.join(', ')}. Running peak shown as a second line.`} />
          <Result>Maximum drawdown <strong>{fmt(dd.max_drawdown_pct)}%</strong>, from value {values[dd.peak]} (point {dd.peak + 1}) to {values[dd.trough]} (point {dd.trough + 1}). Recovering needs a gain of {fmt(dd.max_drawdown_pct >= 100 ? Infinity : (1 / (1 - dd.max_drawdown_pct / 100) - 1) * 100)}%.</Result>
        </>
      ) : <Result>Enter at least two positive values.</Result>}
    </div>
  );
}

export function OverfitLab() {
  const [strategies, setStrategies] = useState(200);
  const [seed, setSeed] = useState(42);
  const r = useMemo(() => overfitDemo(strategies, 100, seed), [strategies, seed]);
  return (
    <div className="lab">
      <div className="row">
        <Slider label="Strategies tried (none has any edge)" value={strategies} onChange={setStrategies} min={1} max={1000} step={1} />
        <button type="button" className="btn s" onClick={() => setSeed((s) => s + 1)}>Run again with new random data</button>
      </div>
      <Bars items={[{ label: 'Best, in-sample', value: r.best_in_sample_pct }, { label: 'Same strategy, out-of-sample', value: r.same_strategy_out_of_sample_pct }, { label: 'Average, in-sample', value: r.average_in_sample_pct }]} unit="%" />
      <Result>The best of {strategies} no-edge strategies made <strong>{fmt(r.best_in_sample_pct)}%</strong> in-sample, then <strong>{fmt(r.same_strategy_out_of_sample_pct)}%</strong> out of sample. Run it several times: the out-of-sample result centres on zero.</Result>
    </div>
  );
}

export function CostDragLab() {
  const [gross, setGross] = useState(14);
  const [turnover, setTurnover] = useState(6);
  const [cost, setCost] = useState(0.25);
  const drag = costDragPct(turnover, cost);
  return (
    <div className="lab">
      <div className="row">
        <Slider label="Gross return" value={gross} onChange={setGross} min={0} max={30} step={0.5} suffix="%" />
        <Slider label="Turnover (value traded ÷ portfolio, per year)" value={turnover} onChange={setTurnover} min={0} max={30} step={0.5} suffix="×" />
        <Slider label="Cost per unit traded" value={cost} onChange={setCost} min={0} max={1} step={0.05} suffix="%" />
      </div>
      <Bars items={[{ label: 'Gross', value: gross }, { label: 'Cost drag', value: -drag }, { label: 'Net', value: gross - drag }]} unit="%" />
      <Result>Cost drag {fmt(drag)}% a year; net return <strong>{fmt(gross - drag)}%</strong>.</Result>
    </div>
  );
}

// ───────────── Course 4 ─────────────

export function DcfLab() {
  const [f, setF] = useState([100, 110, 121]);
  const [r, setR] = useState(12);
  const [g, setG] = useState(4);
  let v: ReturnType<typeof dcf> | null = null;
  try { v = dcf({ fcf: f, discountPct: r, terminalGrowthPct: g }); } catch { v = null; }
  return (
    <div className="lab">
      <div className="row">
        {f.map((x, i) => <Num key={i} label={`FCF year ${i + 1}`} suffix="₹ crore" value={x} onChange={(n) => setF(f.map((y, k) => (k === i ? n : y)))} />)}
        <Slider label="Discount rate" value={r} onChange={setR} min={6} max={20} step={0.5} suffix="%" />
        <Slider label="Terminal growth" value={g} onChange={setG} min={0} max={8} step={0.5} suffix="%" />
      </div>
      {v ? (
        <>
          <table><caption>Discounted cash flow (₹ crore)</caption><thead><tr><th>Item</th><th>Value</th><th>Present value</th></tr></thead><tbody>
            {f.map((x, i) => <tr key={i}><td>Year {i + 1} FCF</td><td>{fmt(x)}</td><td>{fmt(x / Math.pow(1 + r / 100, i + 1))}</td></tr>)}
            <tr><td>Terminal value (year {f.length})</td><td>{fmt((f[f.length - 1]! * (1 + g / 100)) / (r / 100 - g / 100))}</td><td>{fmt(v.pv_terminal)}</td></tr>
          </tbody></table>
          <Result>Value <strong>₹{fmt(v.value)} crore</strong>; the terminal value is <strong>{fmt(v.terminal_share_pct, 1)}%</strong> of it.</Result>
        </>
      ) : <Result>The discount rate must exceed terminal growth.</Result>}
    </div>
  );
}

const DISCOUNTS = [10, 11, 12, 13, 14];
const GROWTHS = [2, 3, 4, 5, 6];
const BASE_FCF = [100, 110, 121];

/** 3D sensitivity surface with an accessible table; 3D loads only when supported and motion is allowed. */
export function DcfSurface3D() {
  const grid = useMemo(() => dcfSensitivity(BASE_FCF, DISCOUNTS, GROWTHS), []);
  const host = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'loading' | '3d' | 'table'>('loading');
  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (reduce || !gl || !host.current) { setMode('table'); return; }
    let stop = () => undefined as void;
    let cancelled = false;
    void import('three').then((THREE) => {
      if (cancelled || !host.current) return;
      const el = host.current;
      const w = el.clientWidth || 480;
      const h = 300;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(2, devicePixelRatio));
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
      camera.position.set(6, 6, 8);
      camera.lookAt(0, 1, 0);
      const values = grid.flat().filter((x): x is number => x !== null);
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      const group = new THREE.Group();
      grid.forEach((row, i) => row.forEach((v, j) => {
        if (v === null) return;
        const height = 0.2 + ((v - lo) / (hi - lo)) * 3;
        const t = (v - lo) / (hi - lo);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, height, 0.8), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.58 - 0.45 * t, 0.65, 0.5) }));
        mesh.position.set((j - 2) * 1.1, height / 2, (i - 2) * 1.1);
        group.add(mesh);
      }));
      scene.add(group);
      scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const light = new THREE.DirectionalLight(0xffffff, 1);
      light.position.set(5, 10, 5);
      scene.add(light);
      let raf = 0;
      let angle = 0;
      let dragging = false;
      let lastX = 0;
      const onDown = (e: PointerEvent) => { dragging = true; lastX = e.clientX; };
      const onUp = () => { dragging = false; };
      const onMove = (e: PointerEvent) => { if (dragging) { angle += (e.clientX - lastX) * 0.01; lastX = e.clientX; } };
      renderer.domElement.addEventListener('pointerdown', onDown);
      addEventListener('pointerup', onUp);
      addEventListener('pointermove', onMove);
      const tick = () => {
        if (!dragging) angle += 0.003;
        group.rotation.y = angle;
        renderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
      };
      tick();
      setMode('3d');
      stop = () => {
        cancelAnimationFrame(raf);
        removeEventListener('pointerup', onUp);
        removeEventListener('pointermove', onMove);
        renderer.dispose();
        el.innerHTML = '';
      };
    }).catch(() => setMode('table'));
    return () => { cancelled = true; stop(); };
  }, [grid]);
  return (
    <div className="lab">
      <div ref={host} className="surface3d" role="img" aria-label="3D bars of DCF value: taller and warmer bars are higher values. The same values are in the table below." hidden={mode === 'table'} />
      {mode === '3d' && <p className="mu">Drag to rotate. Rows: discount rate; columns: terminal growth. Base case FCF ₹100, 110, 121 crore.</p>}
      <table><caption>DCF value (₹ crore) by discount rate and terminal growth (base FCF 100, 110, 121)</caption>
        <thead><tr><th scope="col">Discount \ growth</th>{GROWTHS.map((g) => <th key={g} scope="col">{g}%</th>)}</tr></thead>
        <tbody>{grid.map((row, i) => <tr key={i}><th scope="row">{DISCOUNTS[i]}%</th>{row.map((v, j) => <td key={j}>{v === null ? 'n/a' : fmt(v, 0)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function PortfolioRiskLab() {
  const [w, setW] = useState(60);
  const [s1, setS1] = useState(25);
  const [s2, setS2] = useState(15);
  const [rho, setRho] = useState(0.2);
  const curve = Array.from({ length: 11 }, (_, k) => twoAssetVol(k / 10, s1, s2, rho));
  const v = twoAssetVol(w / 100, s1, s2, rho);
  return (
    <div className="lab">
      <div className="row">
        <Slider label="Weight in asset A" value={w} onChange={setW} min={0} max={100} step={5} suffix="%" />
        <Slider label="Volatility A" value={s1} onChange={setS1} min={5} max={50} step={1} suffix="%" />
        <Slider label="Volatility B" value={s2} onChange={setS2} min={5} max={50} step={1} suffix="%" />
        <Slider label="Correlation" value={rho} onChange={setRho} min={-1} max={1} step={0.1} />
      </div>
      <Line series={[{ name: 'vol', values: curve }]} labels={`Portfolio volatility from 0% to 100% in asset A: ${curve.map((c) => fmt(c)).join(', ')} percent.`} />
      <Result>Portfolio volatility <strong>{fmt(v)}%</strong>, versus a weighted average of {fmt((w / 100) * s1 + (1 - w / 100) * s2)}%.</Result>
    </div>
  );
}

export function MultipleTestingLab() {
  const [tests, setTests] = useState(20);
  const [alpha, setAlpha] = useState(0.05);
  const m = multipleTesting(tests, alpha);
  return (
    <div className="lab">
      <div className="row">
        <Slider label="Independent tests" value={tests} onChange={setTests} min={1} max={500} step={1} />
        <Slider label="Significance level" value={alpha} onChange={setAlpha} min={0.01} max={0.1} step={0.01} />
      </div>
      <Result>Expected false positives: <strong>{fmt(m.expected_false_positives)}</strong>. Chance of at least one: <strong>{fmt(m.p_at_least_one_pct)}%</strong>. Bonferroni threshold per test: {fmt(m.bonferroni_alpha * 100, 4)}%.</Result>
    </div>
  );
}

export const COURSE_LABS: Record<string, () => ReactNode> = {
  diversification: DiversificationLab, compound_growth: CompoundLab, real_return: RealReturnLab, index_weighting: IndexWeightingLab,
  statement_flow: StatementFlowLab, dupont: DupontLab, ev_bridge: EvBridgeLab,
  drawdown: DrawdownLab, overfit: OverfitLab, cost_drag: CostDragLab,
  dcf: DcfLab, dcf_surface_3d: DcfSurface3D, portfolio_risk: PortfolioRiskLab, multiple_testing: MultipleTestingLab,
  statements_3d: ThreeStatementsScene,
  tx_journey_3d: TxJourneyScene, tokenomics_3d: TokenomicsScene, consensus_3d: ConsensusScene, signing: SigningLab, amm_pool_3d: AmmPoolScene, quant_3d: QuantScene, depth_3d: DepthScene,
};
