'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_STATEMENT_INPUTS, threeStatements, validateStatementInputs, type StatementInputs, type ThreeStatements } from '@atlas/shared';
import type * as ThreeNS from 'three';
import { Scene3DFrame, useScene3D, type LabelHandle } from './scene3d';
import { formatIndianNumber } from '@/lib/format';

// "Three statements in motion" (EQUITY DETECTIVE). A fictional company's profit and loss, cash flow
// and closing balance sheet in one scene, computed by the tested model in @atlas/shared. Each panel
// has its own height scale (stated in the scene); exact values are in labels and in the table.

const cr = (v: number) => `${v < 0 ? '−' : ''}₹${formatIndianNumber(Math.abs(v), 1)} cr`;
// Totals that always carry a label; other bars are labelled when their link is highlighted.
const KEY_BARS = new Set(['rev', 'pat', 'cf_ocf', 'cf_net', 'bs_cash', 'bs_eq']);
type Link = 'profit_to_cash' | 'cash_to_balance' | 'profit_to_equity';
const LINKS: Record<Link, { title: string; text: (s: ThreeStatements) => string }> = {
  profit_to_cash: { title: 'Profit → operating cash flow', text: (s) => `Operating cash flow starts from net profit (${cr(s.cashFlow.pat)}), adds back depreciation (${cr(s.cashFlow.depreciation)}, a cost that used no cash this year) and subtracts the money tied up in working capital (${cr(s.cashFlow.workingCapitalIncrease)}). Result: ${cr(s.cashFlow.operating)}.` },
  cash_to_balance: { title: 'Cash flow → cash on the balance sheet', text: (s) => `Opening cash ${cr(s.balanceSheet.opening.cash)} plus the year's net change ${cr(s.cashFlow.netChange)} (operating ${cr(s.cashFlow.operating)}, investing ${cr(s.cashFlow.investing)}, financing ${cr(s.cashFlow.financing)}) gives closing cash ${cr(s.balanceSheet.closing.cash)}.` },
  profit_to_equity: { title: 'Profit → equity', text: (s) => `Profit not paid out (${cr(s.income.pat)} − dividends ${cr(s.cashFlow.dividends)} = ${cr(s.links.retainedProfit)}) is added to equity: ${cr(s.balanceSheet.opening.equity)} → ${cr(s.balanceSheet.closing.equity)}. That is why assets (${cr(s.balanceSheet.closing.assets)}) still equal liabilities plus equity (${cr(s.balanceSheet.closing.liabilitiesAndEquity)}).` },
};

interface Bar { key: string; label: string; value: number; base: number; top: number; color: number; panel: 0 | 1 | 2; slot: number; links: Link[] }

function barsFor(s: ThreeStatements): Bar[] {
  const i = s.income;
  const c = s.cashFlow;
  const b = s.balanceSheet.closing;
  const out: Bar[] = [];
  // P&L waterfall: start at revenue and step down to profit.
  let lvl = i.revenue;
  const step = (key: string, label: string, delta: number, slot: number, links: Link[] = []) => {
    out.push({ key, label, value: delta, base: Math.min(lvl, lvl + delta), top: Math.max(lvl, lvl + delta), color: delta < 0 ? 0xd9776a : 0x4f9bd9, panel: 0, slot, links });
    lvl += delta;
  };
  out.push({ key: 'rev', label: 'Revenue', value: i.revenue, base: 0, top: i.revenue, color: 0x4f9bd9, panel: 0, slot: 0, links: [] });
  step('costs', 'Operating costs', -i.operatingCosts, 1);
  out.push({ key: 'ebitda', label: 'EBITDA', value: i.ebitda, base: Math.min(0, i.ebitda), top: Math.max(0, i.ebitda), color: 0x7aa9d6, panel: 0, slot: 2, links: [] });
  lvl = i.ebitda;
  step('dep', 'Depreciation', -i.depreciation, 3);
  step('int', 'Interest', -i.interest, 4);
  step('tax', 'Tax', -i.tax, 5);
  out.push({ key: 'pat', label: 'Net profit', value: i.pat, base: Math.min(0, i.pat), top: Math.max(0, i.pat), color: 0x47b07a, panel: 0, slot: 6, links: ['profit_to_cash', 'profit_to_equity'] });
  // Cash-flow bridge: profit → operating cash → free cash → net change.
  lvl = 0;
  const cstep = (key: string, label: string, delta: number, slot: number, links: Link[] = []) => {
    out.push({ key, label, value: delta, base: Math.min(lvl, lvl + delta), top: Math.max(lvl, lvl + delta), color: delta < 0 ? 0xd9776a : 0x47b07a, panel: 1, slot, links });
    lvl += delta;
  };
  cstep('cf_pat', 'Net profit', c.pat, 0, ['profit_to_cash']);
  cstep('cf_dep', '+ Depreciation', c.depreciation, 1, ['profit_to_cash']);
  cstep('cf_wc', '− Working capital', -c.workingCapitalIncrease, 2, ['profit_to_cash']);
  out.push({ key: 'cf_ocf', label: 'Operating cash flow', value: c.operating, base: Math.min(0, c.operating), top: Math.max(0, c.operating), color: 0x3f8f68, panel: 1, slot: 3, links: ['profit_to_cash', 'cash_to_balance'] });
  lvl = c.operating;
  cstep('cf_capex', '− Capex', -c.capex, 4, ['cash_to_balance']);
  cstep('cf_fin', 'Financing', c.financing, 5, ['cash_to_balance']);
  out.push({ key: 'cf_net', label: 'Net change in cash', value: c.netChange, base: Math.min(0, c.netChange), top: Math.max(0, c.netChange), color: 0x6c63c7, panel: 1, slot: 6, links: ['cash_to_balance'] });
  // Balance sheet: assets stack vs liabilities + equity stack (equal totals).
  let a = 0;
  for (const [key, label, v, links] of [['bs_cash', 'Cash', b.cash, ['cash_to_balance']], ['bs_fa', 'Fixed assets', b.fixedAssets, []], ['bs_wc', 'Working capital', b.workingCapital, []]] as const) {
    out.push({ key, label, value: v, base: a, top: a + Math.max(0, v), color: key === 'bs_cash' ? 0x6c63c7 : 0x4f9bd9, panel: 2, slot: 0, links: [...links] });
    a += Math.max(0, v);
  }
  let l = 0;
  for (const [key, label, v, links] of [['bs_debt', 'Debt', b.debt, []], ['bs_eq', 'Equity', b.equity, ['profit_to_equity']]] as const) {
    out.push({ key, label, value: v, base: l, top: l + Math.max(0, v), color: key === 'bs_eq' ? 0x47b07a : 0xc4a052, panel: 2, slot: 1, links: [...links] });
    l += Math.max(0, v);
  }
  return out;
}

const PANEL_X = [-6.4, 0, 5.6];
const PANEL_TITLES = ['Profit and loss (year)', 'Cash flow (year)', 'Balance sheet (closing)'];

export function ThreeStatementsScene() {
  const [inputs, setInputs] = useState<StatementInputs>(DEFAULT_STATEMENT_INPUTS);
  const [link, setLink] = useState<Link>('profit_to_cash');
  const errors = validateStatementInputs(inputs);
  const s = useMemo(() => (errors.length ? null : threeStatements(inputs)), [inputs, errors.length]);
  const host = useRef<HTMLDivElement>(null);
  const update = useRef<(s: ThreeStatements, link: Link) => void>(() => undefined);
  const { state, reset } = useScene3D(host, (api) => {
    const { THREE, scene } = api;
    const meshes = new Map<string, { mesh: ThreeNS.Mesh; label: LabelHandle; cur: { base: number; top: number }; target: { base: number; top: number }; bar: Bar }>();
    const unit = new THREE.BoxGeometry(1, 1, 1);
    // Floor and panel titles.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(22, 8), new THREE.MeshStandardMaterial({ color: 0x1b273b, transparent: true, opacity: 0.35 }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    PANEL_TITLES.forEach((t, p) => api.label(t, new THREE.Vector3(PANEL_X[p]!, -0.6, 1.8), 'title'));
    const scaleLabels = [0, 1, 2].map((p) => api.label('', new THREE.Vector3(PANEL_X[p]!, -1.2, 1.8), 'scale'));
    let scales = [1, 1, 1];
    const H = 5.2;
    const place = (m: ThreeNS.Mesh, bar: Bar, base: number, top: number) => {
      const k = scales[bar.panel]!;
      const h = Math.max(0.02, (top - base) * k);
      m.scale.set(bar.panel === 2 ? 1.6 : 0.62, h, 0.9);
      const x = bar.panel === 2 ? PANEL_X[2]! + (bar.slot === 0 ? -0.95 : 0.95) : PANEL_X[bar.panel]! + (bar.slot - 3) * 0.74;
      m.position.set(x, base * k + h / 2, 0);
    };
    update.current = (st, active) => {
      const bars = barsFor(st);
      const max = [
        Math.max(1, ...bars.filter((b) => b.panel === 0).map((b) => Math.abs(b.top))),
        Math.max(1, ...bars.filter((b) => b.panel === 1).map((b) => Math.max(Math.abs(b.top), Math.abs(b.base)))),
        Math.max(1, ...bars.filter((b) => b.panel === 2).map((b) => b.top)),
      ];
      scales = max.map((m) => H / m);
      max.forEach((m, p) => { scaleLabels[p]!.setText(`Scale: full height = ${cr(m)}`); });
      for (const bar of bars) {
        let e = meshes.get(bar.key);
        if (!e) {
          const mesh = new THREE.Mesh(unit, new THREE.MeshStandardMaterial({ color: bar.color, roughness: 0.55, metalness: 0.05, transparent: true }));
          scene.add(mesh);
          const label = api.label('', new THREE.Vector3(), 'bar');
          e = { mesh, label, cur: { base: bar.base, top: bar.top }, target: { base: bar.base, top: bar.top }, bar };
          meshes.set(bar.key, e);
        }
        e.bar = bar;
        e.target = { base: bar.base, top: bar.top };
        (e.mesh.material as ThreeNS.MeshStandardMaterial).color.setHex(bar.color);
        const on = bar.links.includes(active);
        (e.mesh.material as ThreeNS.MeshStandardMaterial).opacity = on ? 1 : 0.38;
        (e.mesh.material as ThreeNS.MeshStandardMaterial).emissive.setHex(on ? 0x223344 : 0x000000);
        e.label.setText(`${bar.label}: ${cr(bar.value)}`);
        e.label.el.style.display = on || KEY_BARS.has(bar.key) ? '' : 'none';
        e.label.el.classList.toggle('dim', !on);
      }
      api.animate((dt) => {
        let moving = false;
        const k = Math.min(1, dt * 9);
        for (const e2 of meshes.values()) {
          e2.cur.base += (e2.target.base - e2.cur.base) * k;
          e2.cur.top += (e2.target.top - e2.cur.top) * k;
          if (Math.abs(e2.cur.top - e2.target.top) > 0.05 || Math.abs(e2.cur.base - e2.target.base) > 0.05) moving = true;
          else e2.cur = { ...e2.target };
          place(e2.mesh, e2.bar, e2.cur.base, e2.cur.top);
          // Alternate label heights on neighbouring bars so equal-height bars do not collide.
          e2.label.moveTo(new THREE.Vector3(e2.mesh.position.x, e2.mesh.position.y + e2.mesh.scale.y / 2 + 0.35 + (e2.bar.panel < 2 && e2.bar.slot % 2 ? 0.55 : 0), 0.6));
        }
        return moving;
      });
    };
    return () => { unit.dispose(); };
  }, { height: 440, target: [-0.3, 2.3, 0], distance: 19, yaw: -0.16, pitch: 0.32 });

  useEffect(() => { if (s) update.current(s, link); }, [s, link, state]);

  const set = (k: keyof StatementInputs) => (e: React.ChangeEvent<HTMLInputElement>) => setInputs((p) => ({ ...p, [k]: Number(e.target.value) }));
  const sliders: [keyof StatementInputs, string, number, number, number, string][] = [
    ['revenue', 'Revenue', 200, 3000, 50, '₹ crore'],
    ['ebitdaMarginPct', 'EBITDA margin', -20, 40, 1, '%'],
    ['capexPct', 'Capex', 0, 30, 1, '% of revenue'],
    ['workingCapitalIncreasePct', 'Working capital increase', -10, 20, 1, '% of revenue'],
    ['payoutPct', 'Dividend payout', 0, 100, 5, '% of profit'],
    ['newBorrowing', 'New borrowing', -300, 400, 10, '₹ crore'],
  ];
  return (
    <div className="lab statements3d">
      <p className="mu"><strong>Illustrative Company (fictional).</strong> One year, ₹ crore. Opening balance sheet: cash 120, fixed assets 600, working capital 180, debt 300, equity 600. Depreciation 10% of opening fixed assets, interest 9% of opening debt, tax 25% of a profit. A teaching model, not any real company.</p>
      <div className="grid2">
        <fieldset className="sliders"><legend>Change the business</legend>
          {sliders.map(([k, label, min, max, stepv, unit]) => (
            <label key={k} className="field">{label}: <strong>{inputs[k]}</strong> {unit}
              <input type="range" min={min} max={max} step={stepv} value={inputs[k]} onChange={set(k)} />
            </label>
          ))}
          <button className="link" onClick={() => setInputs(DEFAULT_STATEMENT_INPUTS)}>Back to the base case</button>
        </fieldset>
        <div>
          <div role="group" aria-label="Highlight a link between the statements" className="seg wrapseg">
            {(Object.keys(LINKS) as Link[]).map((l) => <button key={l} aria-pressed={link === l} className={link === l ? 'on' : ''} onClick={() => setLink(l)}>{LINKS[l].title}</button>)}
          </div>
          {s && <p className="explain" aria-live="polite">{LINKS[link].text(s)}</p>}
          {s?.warnings.map((w) => <p key={w} className="warn">{w}</p>)}
          {errors.length > 0 && <p className="warn">{errors.join(' ')}</p>}
        </div>
      </div>
      <Scene3DFrame state={state} onReset={reset} title="Three statements in motion: bars for the profit and loss, cash flow and closing balance sheet of a fictional company" hint="Drag (or focus the scene and use the arrow keys) to orbit; Home resets. Each panel has its own scale, stated under it." fallback={s && <StatementsTable s={s} />}>
        <div ref={host} className="scene3d-host" tabIndex={0} aria-label="3D scene; the same figures are in the table below" />
      </Scene3DFrame>
    </div>
  );
}

function StatementsTable({ s }: { s: ThreeStatements }) {
  const rows: [string, number][] = [
    ['Revenue', s.income.revenue], ['Operating costs', -s.income.operatingCosts], ['EBITDA', s.income.ebitda], ['Depreciation', -s.income.depreciation], ['Interest', -s.income.interest], ['Tax', -s.income.tax], ['Net profit', s.income.pat],
  ];
  const cf: [string, number][] = [
    ['Net profit', s.cashFlow.pat], ['+ Depreciation', s.cashFlow.depreciation], ['− Increase in working capital', -s.cashFlow.workingCapitalIncrease], ['Operating cash flow', s.cashFlow.operating], ['Investing (capex)', s.cashFlow.investing], ['Financing (borrowing − dividends)', s.cashFlow.financing], ['Net change in cash', s.cashFlow.netChange],
  ];
  const bs = s.balanceSheet;
  return (
    <div className="grid3 stmt-tables">
      <table><caption>Profit and loss (₹ crore)</caption><tbody>{rows.map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{formatIndianNumber(v, 2)}</td></tr>)}</tbody></table>
      <table><caption>Cash flow (₹ crore)</caption><tbody>{cf.map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{formatIndianNumber(v, 2)}</td></tr>)}</tbody></table>
      <table><caption>Balance sheet (₹ crore)</caption>
        <thead><tr><th scope="col">Item</th><th scope="col">Opening</th><th scope="col">Closing</th></tr></thead>
        <tbody>
          {(['cash', 'fixedAssets', 'workingCapital', 'assets', 'debt', 'equity', 'liabilitiesAndEquity'] as const).map((k) => (
            <tr key={k}><th scope="row">{({ cash: 'Cash', fixedAssets: 'Fixed assets', workingCapital: 'Working capital', assets: 'Total assets', debt: 'Debt', equity: 'Equity', liabilitiesAndEquity: 'Liabilities + equity' })[k]}</th><td>{formatIndianNumber(bs.opening[k], 2)}</td><td>{formatIndianNumber(bs.closing[k], 2)}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="mu">Free cash flow (operating − capex): {formatIndianNumber(s.links.freeCashFlow, 2)}. Cash conversion (operating cash ÷ profit): {s.links.cashConversionPct === null ? 'not meaningful (loss)' : `${formatIndianNumber(s.links.cashConversionPct, 1)}%`}.</p>
    </div>
  );
}
