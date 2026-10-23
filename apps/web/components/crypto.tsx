'use client';

import { usePathname } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';

// Building blocks for ATLAS Digital Assets. Every value shown carries its source and timestamp; data
// kinds (reference, venue, derived, on-chain, provider estimate, converted) are always labelled.

const SUBNAV: [string, string][] = [
  ['/app/crypto', 'Overview'], ['/app/crypto/assets', 'Explorer'], ['/app/crypto/research', 'Research'], ['/app/crypto/defi', 'DeFi'],
  ['/app/crypto/onchain', 'On-chain'], ['/app/crypto/events', 'Events'], ['/app/crypto/sources', 'Sources & health'],
];

export function CryptoNav() {
  const path = usePathname() ?? '';
  const active = (h: string) => (h === '/app/crypto' ? path === h : path.startsWith(h));
  return (
    <nav className="cx-nav" aria-label="Digital assets sections">
      {SUBNAV.map(([h, l]) => <a key={h} href={h} aria-current={active(h) ? 'page' : undefined}>{l}</a>)}
    </nav>
  );
}

const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

/** USD with precision that suits the magnitude (sub-dollar tokens need more digits). */
export function usd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1) return usdFmt.format(v);
  if (a === 0) return '$0';
  const digits = Math.min(10, Math.max(2, 2 - Math.floor(Math.log10(a)) + 2));
  return `$${v.toFixed(digits)}`;
}

export function compactUsd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const [d, s] = a >= 1e12 ? [1e12, 'T'] : a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'K'] : [1, ''];
  return `${v < 0 ? '−' : ''}$${(a / d).toFixed(a / d >= 100 ? 0 : 2)}${s}`;
}

export function compactNum(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v);
}

export function inr(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: Math.abs(v) >= 1 ? 2 : 6 }).format(v)}`;
}

/** Percent from a value already in percent units (CoinGecko). */
export const pctPts = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}%`);
/** Percent from a fraction (ATLAS calculations). */
export const pctFrac = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(d)}%`);
export const signCls = (v: number | null | undefined) => (v === null || v === undefined ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : '');

export function utc(ts: string | null | undefined, withTime = true): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return withTime ? `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC` : d.toISOString().slice(0, 10);
}

export function ago(ts: string | null | undefined): string {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - Date.parse(ts)) / 1000);
  if (s < 90) return `${Math.max(0, s)} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export interface Fresh { state: 'fresh' | 'stale' | 'missing'; age_minutes: number | null }

export function Freshness({ f, label }: { f: Fresh | null | undefined; label?: string }) {
  if (!f || f.state === 'missing') return <span className="t r">{label ? `${label}: ` : ''}no data yet</span>;
  const age = f.age_minutes === null ? '' : f.age_minutes < 90 ? `${f.age_minutes} min old` : f.age_minutes < 2880 ? `${Math.round(f.age_minutes / 60)} h old` : `${Math.round(f.age_minutes / 1440)} days old`;
  return <span className={`t ${f.state === 'fresh' ? 'o' : 'r'}`} title={f.state === 'stale' ? 'Older than this dataset\'s freshness target' : 'Within this dataset\'s freshness target'}>{label ? `${label}: ` : ''}{f.state === 'fresh' ? 'Fresh' : 'Stale'}{age ? ` · ${age}` : ''}</span>;
}

const KIND: Record<string, [string, string]> = {
  reference: ['c', 'Reference price'], venue: ['i', 'Venue-specific'], derived: ['o', 'Calculated by ATLAS'],
  onchain: ['c', 'On-chain'], provider_estimate: ['m', 'Provider estimate'], converted: ['i', 'Converted reference'], simulation: ['r', 'Simulation'],
};
export function Kind({ k, title }: { k: keyof typeof KIND | string; title?: string }) {
  const [c, l] = KIND[k] ?? ['m', k];
  return <span className={`t ${c}`} title={title}>{l}</span>;
}

export function SymbolBadge({ symbol }: { symbol: string }) {
  let h = 0;
  for (const ch of symbol) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return <span className="cx-sym" aria-hidden="true" style={{ background: `hsl(${h} 45% 42%)` }}>{symbol.slice(0, 4)}</span>;
}

export function Reason({ children }: { children: ReactNode }) {
  return <span className="mu" title="Not calculated">— <small>{children}</small></span>;
}

export interface Candle { t: string; open: number | null; high: number | null; low: number | null; close: number; volume: number | null; validation?: string }

/**
 * Daily price chart from stored observations: candlesticks when OHLC exists, a line otherwise, volume
 * bars underneath, hover read-out, and a table view. Gaps in the stored data are left as gaps.
 */
export function PriceChart({ data, title, note, quote = 'USD', height = 320 }: { data: Candle[]; title: string; note?: ReactNode; quote?: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 760;
  const H = height;
  const pad = { l: 70, r: 10, t: 10, b: 26 };
  const volH = 56;
  const priceH = H - pad.t - pad.b - volH - 8;
  const hasOhlc = data.some((d) => d.open !== null);
  const { lo, hi, vmax, t0, t1 } = useMemo(() => {
    const lows = data.map((d) => d.low ?? d.close);
    const highs = data.map((d) => d.high ?? d.close);
    const lo = Math.min(...lows);
    const hi = Math.max(...highs);
    const p = (hi - lo || hi || 1) * 0.04;
    return { lo: lo - p, hi: hi + p, vmax: Math.max(1e-12, ...data.map((d) => d.volume ?? 0)), t0: data.length ? Date.parse(data[0]!.t) : 0, t1: data.length ? Date.parse(data[data.length - 1]!.t) : 1 };
  }, [data]);
  if (!data.length) return <p className="mu">No stored observations for this period.</p>;
  const X = (t: string) => pad.l + ((Date.parse(t) - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * priceH;
  const volTop = pad.t + priceH + 8;
  const cw = Math.max(1, Math.min(9, ((W - pad.l - pad.r) / Math.max(1, (t1 - t0) / 86_400_000)) * 0.7));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo));
  const fmt = (v: number) => (quote === 'USD' || quote === 'USDT' ? usd(v) : quote === 'INR' ? `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : v.toPrecision(6));
  const xticks = [0, Math.floor(data.length / 3), Math.floor((2 * data.length) / 3), data.length - 1];
  let line = '';
  let pen = false;
  data.forEach((d, i) => {
    const gap = i > 0 && Date.parse(d.t) - Date.parse(data[i - 1]!.t) > 86_400_000;
    line += `${pen && !gap ? 'L' : 'M'}${X(d.t).toFixed(1)},${Y(d.close).toFixed(1)}`;
    pen = true;
  });
  const h = hover !== null ? data[hover] : null;
  return (
    <figure className="chart" style={{ margin: 0 }}>
      <figcaption className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{title}</strong>
        <button className="link" onClick={() => setTable((x) => !x)}>{table ? 'Show chart' : 'Show as table'}</button>
      </figcaption>
      {table ? (
        <div className="wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
          <table className="term-table">
            <caption className="sr-only">{title}</caption>
            <thead><tr><th scope="col" style={{ textAlign: 'left' }}>Date (UTC)</th>{hasOhlc && <><th scope="col">Open</th><th scope="col">High</th><th scope="col">Low</th></>}<th scope="col">Close</th><th scope="col">Volume</th></tr></thead>
            <tbody>{[...data].reverse().map((d) => <tr key={d.t}><td style={{ textAlign: 'left' }}>{d.t.slice(0, 10)}{d.validation === 'suspect' && <span className="t i" title="Extreme move kept and flagged for review"> flagged</span>}</td>{hasOhlc && <><td className="num">{d.open === null ? '—' : fmt(d.open)}</td><td className="num">{d.high === null ? '—' : fmt(d.high)}</td><td className="num">{d.low === null ? '—' : fmt(d.low)}</td></>}<td className="num">{fmt(d.close)}</td><td className="num">{compactNum(d.volume)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${data.length} daily observations from ${data[0]!.t.slice(0, 10)} to ${data[data.length - 1]!.t.slice(0, 10)}. Use Show as table for values.`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const vx = ((e.clientX - r.left) / r.width) * W;
            const t = t0 + ((vx - pad.l) / (W - pad.l - pad.r)) * (t1 - t0);
            let best = 0;
            for (let i = 1; i < data.length; i++) if (Math.abs(Date.parse(data[i]!.t) - t) < Math.abs(Date.parse(data[best]!.t) - t)) best = i;
            setHover(vx < pad.l || vx > W - pad.r ? null : best);
          }}>
          {ticks.map((t) => <g key={t}><line x1={pad.l} x2={W - pad.r} y1={Y(t)} y2={Y(t)} stroke="var(--ln)" /><text x={pad.l - 6} y={Y(t) + 4} fontSize="11" textAnchor="end" fill="var(--mu)">{fmt(t)}</text></g>)}
          {xticks.map((i, k) => data[i] && <text key={k} x={X(data[i]!.t)} y={H - 8} fontSize="11" textAnchor={k === 0 ? 'start' : k === xticks.length - 1 ? 'end' : 'middle'} fill="var(--mu)">{data[i]!.t.slice(0, 10)}</text>)}
          {hasOhlc && data.length <= 400 ? data.map((d) => {
            if (d.open === null || d.high === null || d.low === null) return null;
            const up = d.close >= d.open;
            const x = X(d.t);
            return <g key={d.t} stroke={up ? 'var(--ok)' : 'var(--rd)'} fill={up ? 'var(--ok)' : 'var(--rd)'}>
              <line x1={x} x2={x} y1={Y(d.high)} y2={Y(d.low)} strokeWidth={1} />
              <rect x={x - cw / 2} y={Math.min(Y(d.open), Y(d.close))} width={cw} height={Math.max(1, Math.abs(Y(d.open) - Y(d.close)))} fillOpacity={up ? 0.35 : 0.85} />
            </g>;
          }) : <path d={line} fill="none" stroke="var(--ac)" strokeWidth={1.6} />}
          {data.map((d) => d.volume !== null && <rect key={`v${d.t}`} x={X(d.t) - cw / 2} y={volTop + volH - (d.volume / vmax) * volH} width={cw} height={(d.volume / vmax) * volH} fill="var(--mu)" opacity={0.35} />)}
          <text x={pad.l - 6} y={volTop + 10} fontSize="10" textAnchor="end" fill="var(--mu)">Volume</text>
          {h && (() => {
            const x = X(h.t);
            const bx = x > W - 220 ? x - 206 : x + 10;
            const lines = [h.t.slice(0, 10) + ' (UTC day)', ...(h.open !== null ? [`O ${fmt(h.open)}  H ${fmt(h.high!)}`, `L ${fmt(h.low!)}  C ${fmt(h.close)}`] : [`Price ${fmt(h.close)}`]), `Volume ${compactNum(h.volume)}`];
            return <g pointerEvents="none">
              <line x1={x} x2={x} y1={pad.t} y2={volTop + volH} stroke="var(--mu)" strokeDasharray="3 3" />
              <rect x={bx} y={pad.t} width={196} height={14 + lines.length * 16} rx={6} fill="var(--sf)" stroke="var(--ln)" />
              {lines.map((l, k) => <text key={k} x={bx + 8} y={pad.t + 16 + k * 16} fontSize="12" fill={k ? 'var(--ink)' : 'var(--mu)'}>{l}</text>)}
            </g>;
          })()}
        </svg>
      )}
      {note && <div className="legend">{note}</div>}
    </figure>
  );
}

/** Minimal multi-series line for derived analytics (fractions shown as %). */
export function MiniLine({ points, title, format = (v: number) => `${(v * 100).toFixed(1)}%`, zero = false, height = 150 }: { points: { t: string; v: number }[]; title: string; format?: (v: number) => string; zero?: boolean; height?: number }) {
  if (points.length < 2) return <p className="mu">Not enough points to chart.</p>;
  const W = 760;
  const H = height;
  const pad = { l: 56, r: 8, t: 8, b: 22 };
  const vs = points.map((p) => p.v);
  const lo = Math.min(...vs, zero ? 0 : Infinity);
  const hi = Math.max(...vs, zero ? 0 : -Infinity);
  const X = (i: number) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  return (
    <figure className="chart" style={{ margin: 0 }}>
      <figcaption><strong>{title}</strong></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: from ${format(vs[0]!)} on ${points[0]!.t} to ${format(vs[vs.length - 1]!)} on ${points[points.length - 1]!.t}; range ${format(lo)} to ${format(hi)}.`}>
        {[lo, (lo + hi) / 2, hi].map((t) => <g key={t}><line x1={pad.l} x2={W - pad.r} y1={Y(t)} y2={Y(t)} stroke="var(--ln)" /><text x={pad.l - 6} y={Y(t) + 4} fontSize="11" textAnchor="end" fill="var(--mu)">{format(t)}</text></g>)}
        <path d={d} fill="none" stroke="var(--ac)" strokeWidth={1.5} />
        <text x={pad.l} y={H - 6} fontSize="11" fill="var(--mu)">{points[0]!.t}</text>
        <text x={W - pad.r} y={H - 6} fontSize="11" fill="var(--mu)" textAnchor="end">{points[points.length - 1]!.t}</text>
      </svg>
    </figure>
  );
}
