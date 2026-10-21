'use client';

import { useEffect, useRef, useState } from 'react';

// Terminal building blocks. TickValue animates only when the value it is given changes (a new stored
// record), never on a timer, and not at all when the data is stale or the user prefers reduced motion.

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function TickValue({ value, format, stale = false, className = '' }: { value: number | null; format: (v: number) => string; stale?: boolean; className?: string }) {
  const [shown, setShown] = useState(value);
  const [flash, setFlash] = useState<'up' | 'dn' | null>(null);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (value === null || from === null || from === value || stale || reduced()) {
      setShown(value);
      return;
    }
    setFlash(value > from ? 'up' : 'dn');
    const start = performance.now();
    const dur = 650;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / dur);
      const e = 1 - (1 - k) ** 3;
      setShown(from + (value - from) * e);
      if (k < 1) raf = requestAnimationFrame(step);
      else setTimeout(() => setFlash(null), 900);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, stale]);
  return <span className={`tick ${flash ? `flash-${flash}` : ''} ${stale ? 'is-stale' : ''} ${className}`}>{shown === null ? '—' : format(shown)}</span>;
}

/** A small single-series line; the title or row label names it, so no legend is needed. */
export function Sparkline({ points, label, width = 120, height = 32 }: { points: number[]; label: string; width?: number; height?: number }) {
  if (points.length < 2) return <span className="mu">—</span>;
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const X = (i: number) => (i / (points.length - 1)) * (width - 2) + 1;
  const Y = (v: number) => height - 2 - ((v - lo) / (hi - lo || 1)) * (height - 4);
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const up = points[points.length - 1]! >= points[0]!;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: ${up ? 'higher' : 'lower'} over the period shown`}>
      <path d={d} fill="none" stroke={up ? 'var(--ok)' : 'var(--rd)'} strokeWidth={1.5} />
    </svg>
  );
}

/** Seconds since a timestamp, re-rendered every few seconds (presentation only; no data changes). */
export function Since({ at }: { at: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);
  const s = Math.round((Date.now() - at) / 1000);
  return <>{s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`}</>;
}
