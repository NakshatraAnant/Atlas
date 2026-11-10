'use client';
import { useMemo, useRef, useState } from 'react';

// Interactive time-series chart for stored observations (one series, two with different units, or several
// in one unit sharing an axis, e.g. instruments rebased to 1.0).
// - Range presets (1M … Max) and a custom date range; drag across the plot to zoom, "Reset" to undo.
// - Hover (or arrow keys when focused) shows the date and each value; gaps stay gaps (no lines across
//   missing periods longer than `gapDays`).
// - Two series in different units get a right-hand axis each; series in one unit share the left axis;
//   CSV export of the visible range;
//   full screen; a table view for screen readers and keyboard users.

export interface TsSeries { label: string; unit: string; points: { t: string; v: number }[]; color?: string }

const RANGES: [string, number | null][] = [['1M', 31], ['3M', 92], ['6M', 183], ['1Y', 366], ['5Y', 1827], ['10Y', 3653], ['Max', null]];
const DAY = 86_400_000;
const fmtDefault = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : v.toLocaleString('en-IN', { maximumFractionDigits: Math.abs(v) < 10 ? 3 : 2 }));

export function TsChart({ series, title, defaultRange = '5Y', gapDays = 45, height = 300, zeroLine = false, note, format }: { series: TsSeries[]; title: string; defaultRange?: string; gapDays?: number; height?: number; zeroLine?: boolean; note?: string; format?: (v: number) => string }) {
  const fmt = format ?? fmtDefault;
  const unitOf = (u: string) => (u ? ` (${u})` : '');
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [range, setRange] = useState(defaultRange);
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const all = series.filter((s) => s.points.length);
  const tMax = Math.max(...all.map((s) => Date.parse(s.points[s.points.length - 1]!.t)));
  const tMinAll = Math.min(...all.map((s) => Date.parse(s.points[0]!.t)));
  const [x0, x1] = useMemo((): [number, number] => {
    if (zoom) return zoom;
    if (custom) return [Date.parse(custom.from), Date.parse(custom.to)];
    const days = RANGES.find(([k]) => k === range)?.[1] ?? null;
    return [days ? Math.max(tMinAll, tMax - days * DAY) : tMinAll, tMax];
  }, [zoom, custom, range, tMinAll, tMax]);
  const vis = all.map((s) => ({ ...s, pts: s.points.map((p) => ({ t: Date.parse(p.t), v: p.v, d: p.t })).filter((p) => p.t >= x0 && p.t <= x1) }));
  if (!all.length) return <p className="mu">No stored observations to chart.</p>;
  const W = 760;
  const H = height;
  // One shared axis when every series has the same unit (or there are more than two); otherwise a second
  // series gets its own right-hand axis.
  const shared = vis.length > 2 || new Set(vis.map((s) => s.unit)).size === 1;
  const pad = { l: 64, r: vis.length > 1 && !shared ? 64 : 14, t: 12, b: 26 };
  const X = (t: number) => pad.l + ((t - x0) / Math.max(1, x1 - x0)) * (W - pad.l - pad.r);
  const scaleOf = (vs: number[]) => {
    let lo = Math.min(...vs, ...(zeroLine ? [0] : []));
    let hi = Math.max(...vs, ...(zeroLine ? [0] : []));
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    const padV = (hi - lo || Math.abs(hi) || 1) * 0.06;
    return { lo: lo - padV, hi: hi + padV };
  };
  const sharedScale = shared ? scaleOf(vis.flatMap((s) => s.pts.map((p) => p.v))) : null;
  const scales = vis.map((s) => sharedScale ?? scaleOf(s.pts.map((p) => p.v)));
  const Y = (i: number, v: number) => pad.t + (1 - (v - scales[i]!.lo) / (scales[i]!.hi - scales[i]!.lo || 1)) * (H - pad.t - pad.b);
  const colors = vis.length > 2 ? ['var(--c1)', 'var(--c4)', 'var(--c2)', 'var(--c3)', 'var(--gold)', 'var(--mu)'] : ['var(--c1)', 'var(--c4)'];
  const path = (i: number) => {
    let d = '';
    let prev: number | null = null;
    for (const p of vis[i]!.pts) {
      const cmd = prev === null || p.t - prev > gapDays * DAY ? 'M' : 'L';
      d += `${cmd}${X(p.t).toFixed(1)},${Y(i, p.v).toFixed(1)}`;
      prev = p.t;
    }
    return d;
  };
  const tFromX = (px: number) => x0 + ((px - pad.l) / (W - pad.l - pad.r)) * (x1 - x0);
  const svgX = (e: React.MouseEvent) => { const r = svg.current!.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * W; };
  const nearest = (s: (typeof vis)[number], t: number) => s.pts.reduce<(typeof s.pts)[number] | null>((b, p) => (!b || Math.abs(p.t - t) < Math.abs(b.t - t) ? p : b), null);
  const hv = hover !== null ? vis.map((s) => nearest(s, hover)) : null;
  const csv = () => {
    const dates = [...new Set(vis.flatMap((s) => s.pts.map((p) => p.d)))].sort();
    const maps = vis.map((s) => new Map(s.pts.map((p) => [p.d, p.v])));
    const rows = [['date', ...vis.map((s) => `${s.label}${unitOf(s.unit)}`)], ...dates.map((d) => [d, ...maps.map((m) => (m.has(d) ? String(m.get(d)) : ''))])];
    const blob = new Blob([rows.map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[^\w]+/g, '_').slice(0, 60)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const ticks = [0, 0.5, 1].map((f) => x0 + f * (x1 - x0));
  const keyMove = (e: React.KeyboardEvent) => {
    const pts = vis[0]!.pts;
    if (!pts.length) return;
    const i = hover === null ? pts.length - 1 : pts.findIndex((p) => p.t >= hover);
    if (e.key === 'ArrowLeft') { e.preventDefault(); setHover(pts[Math.max(0, i - 1)]!.t); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setHover(pts[Math.min(pts.length - 1, i + 1)]!.t); }
    if (e.key === 'Escape') setHover(null);
  };
  return (
    <div ref={wrap} className="tsc" style={{ background: 'var(--sf)', padding: 4 }}>
      <div className="tsc-bar">
        <strong className="tsc-title">{title}</strong>
        <div role="group" aria-label="Time range" className="tsc-ranges">
          {RANGES.map(([k]) => <button key={k} className={`chip${!zoom && !custom && range === k ? ' on' : ''}`} aria-pressed={!zoom && !custom && range === k} onClick={() => { setRange(k); setZoom(null); setCustom(null); }}>{k}</button>)}
        </div>
        <details className="tsc-more">
          <summary>Custom range</summary>
          <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const from = String(f.get('from')); const to = String(f.get('to')); if (from && to && from < to) { setCustom({ from, to }); setZoom(null); } }}>
            <label>From <input type="date" name="from" defaultValue={new Date(x0).toISOString().slice(0, 10)} /></label>
            <label>To <input type="date" name="to" defaultValue={new Date(x1).toISOString().slice(0, 10)} /></label>
            <button className="chip">Apply</button>
          </form>
        </details>
        {(zoom || custom) && <button className="chip" onClick={() => { setZoom(null); setCustom(null); }}>Reset zoom</button>}
        <button className="chip" onClick={csv}>Export CSV</button>
        <button className="chip" onClick={() => setTable((v) => !v)} aria-pressed={table}>{table ? 'Chart' : 'Table'}</button>
        <button className="chip" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : wrap.current?.requestFullscreen?.())}>Full screen</button>
      </div>
      {table ? (
        <div className="wrap" style={{ maxHeight: 360, overflowY: 'auto' }}><table className="term-table"><caption className="sr-only">{title}</caption><thead><tr><th scope="col">Date</th>{vis.map((s) => <th scope="col" key={s.label}>{s.label}{unitOf(s.unit)}</th>)}</tr></thead>
          <tbody>{[...new Set(vis.flatMap((s) => s.pts.map((p) => p.d)))].sort().reverse().slice(0, 500).map((d) => <tr key={d}><td>{d}</td>{vis.map((s) => <td key={s.label} className="num">{(() => { const p = s.pts.find((x) => x.d === d); return p ? fmt(p.v) : '—'; })()}</td>)}</tr>)}</tbody></table></div>
      ) : (
        <svg ref={svg} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" tabIndex={0} onKeyDown={keyMove} style={{ touchAction: 'pan-y', cursor: 'crosshair' }}
          aria-label={`${title}. ${vis.map((s) => `${s.label}: ${s.pts.length} observations from ${s.pts[0]?.d ?? '—'} to ${s.pts[s.pts.length - 1]?.d ?? '—'}, last ${s.pts.length ? fmt(s.pts[s.pts.length - 1]!.v) : '—'} ${s.unit}`).join('; ')}. Use the arrow keys to read values.`}
          onMouseMove={(e) => { const x = svgX(e); setHover(tFromX(Math.min(W - pad.r, Math.max(pad.l, x)))); if (drag) setDrag([drag[0], x]); }}
          onMouseLeave={() => { setHover(null); setDrag(null); }}
          onMouseDown={(e) => setDrag([svgX(e), svgX(e)])}
          onMouseUp={() => { if (drag && Math.abs(drag[1] - drag[0]) > 8) { const a = tFromX(Math.min(...drag)); const b = tFromX(Math.max(...drag)); if (b - a > 3 * DAY) setZoom([a, b]); } setDrag(null); }}>
          {vis.map((_, i) => (shared && i > 0 ? [] : [0, 0.5, 1]).map((f) => { const v = scales[i]!.lo + f * (scales[i]!.hi - scales[i]!.lo); return <text key={`${i}-${f}`} x={i === 0 ? pad.l - 6 : W - pad.r + 6} y={Y(i, v) + 4} textAnchor={i === 0 ? 'end' : 'start'} fontSize="11" fill={vis.length > 1 && !shared ? colors[i] : 'var(--mu)'}>{fmt(v)}</text>; }))}
          {[0, 0.5, 1].map((f) => <line key={f} x1={pad.l} x2={W - pad.r} y1={pad.t + f * (H - pad.t - pad.b)} y2={pad.t + f * (H - pad.t - pad.b)} stroke="var(--ln)" strokeWidth="1" />)}
          {zeroLine && scales[0]!.lo < 0 && scales[0]!.hi > 0 && <line x1={pad.l} x2={W - pad.r} y1={Y(0, 0)} y2={Y(0, 0)} stroke="var(--mu)" strokeDasharray="4 3" />}
          {ticks.map((t, i) => <text key={i} x={X(t)} y={H - 6} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} fontSize="11" fill="var(--mu)">{new Date(t).toISOString().slice(0, 10)}</text>)}
          {vis.map((s, i) => <path key={s.label} d={path(i)} fill="none" stroke={s.color ?? colors[i % colors.length]} strokeWidth="1.8" />)}
          {drag && <rect x={Math.min(...drag)} y={pad.t} width={Math.abs(drag[1] - drag[0])} height={H - pad.t - pad.b} fill="var(--gold-soft)" stroke="var(--gold)" />}
          {hv && hover !== null && (
            <g pointerEvents="none">
              <line x1={X(hv[0]?.t ?? hover)} x2={X(hv[0]?.t ?? hover)} y1={pad.t} y2={H - pad.b} stroke="var(--mu)" strokeDasharray="3 3" />
              {hv.map((p, i) => p && <circle key={i} cx={X(p.t)} cy={Y(i, p.v)} r="3.5" fill={colors[i]} />)}
              <g transform={`translate(${Math.min(X(hv[0]?.t ?? hover) + 8, W - 220)}, ${pad.t + 4})`}>
                <rect width="210" height={18 + 16 * hv.length} rx="6" fill="var(--sf2)" stroke="var(--ln)" />
                <text x="8" y="15" fontSize="11" fill="var(--ink)">{hv[0]?.d ?? ''}</text>
                {hv.map((p, i) => <text key={i} x="8" y={31 + 16 * i} fontSize="11" fill={colors[i]}>{vis[i]!.label.slice(0, 22)}: {p ? `${fmt(p.v)} ${vis[i]!.unit.slice(0, 18)}` : '—'}</text>)}
              </g>
            </g>
          )}
        </svg>
      )}
      <p className="mu" style={{ margin: '4px 6px', fontSize: 12 }}>{vis.map((s, i) => <span key={s.label} style={{ marginRight: 12 }}><span aria-hidden="true" style={{ color: colors[i] }}>━</span> {s.label}{unitOf(s.unit)}</span>)}{note ? ` · ${note}` : ''} · drag across the chart to zoom</p>
    </div>
  );
}
