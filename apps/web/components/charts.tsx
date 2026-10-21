'use client';

import { useMemo, useState } from 'react';
import { formatIndianNumber } from '@/lib/format';

// Accessible SVG charts: labelled axes, legend, and a table view of the same data (NFR-06).

const PALETTE = ['var(--ac)', 'var(--wn)', 'var(--ok)', 'var(--rd)', 'var(--mu)'];
const colorOf = (s: { color?: string }, i: number) => s.color ?? PALETTE[i % PALETTE.length]!;

export interface Series {
  name: string;
  color?: string;
  points: { x: string; y: number | null }[];
  dashed?: boolean;
}

export function LineChart({ series, title, yLabel, xLabel = 'Date', height = 220, note, format = (v: number) => formatIndianNumber(v, 2) }: { series: Series[]; title: string; yLabel: string; xLabel?: string; height?: number; note?: string; format?: (v: number) => string }) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = height;
  const pad = { l: 64, r: 12, t: 12, b: 32 };
  const all = series.flatMap((s) => s.points.map((p) => p.y).filter((v): v is number => v !== null));
  const xs = series[0]?.points.map((p) => p.x) ?? [];
  const { min, max } = useMemo(() => {
    if (!all.length) return { min: 0, max: 1 };
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const p = (hi - lo || Math.abs(hi) || 1) * 0.06;
    return { min: lo - p, max: hi + p };
  }, [all]);
  if (!xs.length) return <p className="mu">No data to chart for this period.</p>;
  const X = (i: number) => pad.l + (i / Math.max(1, xs.length - 1)) * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - (v - min) / (max - min || 1)) * (H - pad.t - pad.b);
  const step = Math.max(1, Math.ceil(xs.length / 600));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * (max - min));
  const xt = [0, Math.floor(xs.length / 2), xs.length - 1];
  return (
    <figure className="chart" style={{ margin: 0 }}>
      <figcaption className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{title}</strong>
        <button className="link" onClick={() => setTable((t) => !t)}>{table ? 'Show chart' : 'Show as table'}</button>
      </figcaption>
      {table ? (
        <div className="wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
          <table>
            <caption>{title}</caption>
            <thead><tr><th scope="col">{xLabel}</th>{series.map((s) => <th key={s.name} scope="col">{s.name}</th>)}</tr></thead>
            <tbody>{xs.map((x, i) => (i % Math.max(1, Math.floor(xs.length / 120)) === 0 || i === xs.length - 1) && <tr key={x}><td>{x}</td>{series.map((s) => <td key={s.name}>{s.points[i]?.y === null || s.points[i]?.y === undefined ? '—' : format(s.points[i]!.y!)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${yLabel} against ${xLabel.toLowerCase()}. Use “Show as table” for the values.`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const vx = ((e.clientX - r.left) / r.width) * W;
            const i = Math.round(((vx - pad.l) / (W - pad.l - pad.r)) * Math.max(1, xs.length - 1));
            setHover(i < 0 || i >= xs.length ? null : i);
          }}>
          {ticks.map((t) => <g key={t}><line x1={pad.l} x2={W - pad.r} y1={Y(t)} y2={Y(t)} stroke="var(--ln)" /><text x={pad.l - 6} y={Y(t) + 4} fontSize="11" textAnchor="end" fill="var(--mu)">{format(t)}</text></g>)}
          {xt.map((i) => <text key={i} x={X(i)} y={H - 10} fontSize="11" textAnchor={i === 0 ? 'start' : i === xs.length - 1 ? 'end' : 'middle'} fill="var(--mu)">{xs[i]}</text>)}
          <text x={12} y={H / 2} fontSize="11" fill="var(--mu)" transform={`rotate(-90 12 ${H / 2})`} textAnchor="middle">{yLabel}</text>
          {series.map((s, si) => {
            let d = '';
            let pen = false;
            s.points.forEach((p, i) => {
              if (i % step && i !== s.points.length - 1) return;
              if (p.y === null) { pen = false; return; }
              d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`;
              pen = true;
            });
            return <path key={s.name} d={d} fill="none" stroke={colorOf(s, si)} strokeWidth={1.6} strokeDasharray={s.dashed ? '4 3' : undefined} />;
          })}
          {hover !== null && (() => {
            const vals = series.map((s, si) => ({ s, si, y: s.points[hover]?.y ?? null }));
            const bx = X(hover) > W - 200 ? X(hover) - 186 : X(hover) + 10;
            return (
              <g pointerEvents="none">
                <line x1={X(hover)} x2={X(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--mu)" strokeDasharray="3 3" />
                {vals.map((v) => v.y !== null && <circle key={v.s.name} cx={X(hover)} cy={Y(v.y)} r={4} fill={colorOf(v.s, v.si)} stroke="var(--sf)" strokeWidth={2} />)}
                <rect x={bx} y={pad.t} width={176} height={20 + vals.length * 16} rx={6} fill="var(--sf)" stroke="var(--ln)" />
                <text x={bx + 8} y={pad.t + 15} fontSize="11" fill="var(--mu)">{xs[hover]}</text>
                {vals.map((v, k) => <text key={v.s.name} x={bx + 8} y={pad.t + 31 + k * 16} fontSize="12" fill="var(--ink)">{v.s.name}: {v.y === null ? '—' : format(v.y)}</text>)}
              </g>
            );
          })()}
        </svg>
      )}
      <div className="legend">{series.map((s, i) => <span key={s.name}><i style={{ background: colorOf(s, i) }} />{s.name}</span>)}{note && <span>{note}</span>}</div>
    </figure>
  );
}

export function Bars({ items, title, unit = '%', format = (v: number) => `${formatIndianNumber(v, 2)}${unit}` }: { items: { label: string; value: number }[]; title: string; unit?: string; format?: (v: number) => string }) {
  const max = Math.max(1e-9, ...items.map((i) => Math.abs(i.value)));
  return (
    <figure className="chart" style={{ margin: 0 }}>
      <figcaption><strong>{title}</strong></figcaption>
      <table>
        <caption className="sr-only">{title}</caption>
        <tbody>
          {items.map((i) => (
            <tr key={i.label}>
              <th scope="row" style={{ textAlign: 'left', width: '30%' }}>{i.label}</th>
              <td style={{ width: '50%' }}><div aria-hidden="true" style={{ height: 10, width: `${(Math.abs(i.value) / max) * 100}%`, background: i.value >= 0 ? 'var(--ok)' : 'var(--rd)', borderRadius: 3 }} /></td>
              <td className={i.value >= 0 ? 'up' : 'dn'}>{format(i.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
