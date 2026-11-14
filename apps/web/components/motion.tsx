'use client';
import { useEffect, useRef, type ReactNode } from 'react';

// Small, purposeful motion: content fades up as it scrolls into view. One observer per element, removed
// after the first reveal; with prefers-reduced-motion everything is simply shown (globals.css).

export function Reveal({ children, delay = 0, as: Tag = 'div', className = '' }: { children: ReactNode; delay?: number; as?: 'div' | 'section' | 'li'; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { el.classList.add('in'); return; }
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { el.classList.add('in'); io.disconnect(); } }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref as never} className={`reveal ${className}`} style={{ ['--d' as string]: `${delay}ms` }}>{children}</Tag>;
}

import { useState } from 'react';

export type Mode = 'focus' | 'explore';
/** Focus (dense, quiet) or Explore (immersive). Stored on <html data-mode>; the header switch changes it. */
export function useMode(): Mode {
  const [m, setM] = useState<Mode>('focus');
  useEffect(() => {
    const read = () => setM(document.documentElement.dataset.mode === 'explore' ? 'explore' : 'focus');
    read();
    window.addEventListener('atlas-mode', read);
    return () => window.removeEventListener('atlas-mode', read);
  }, []);
  return m;
}

/** A number that counts up once when first shown (never loops; instant with reduced motion). */
export function CountUp({ value, format }: { value: number; format: (v: number) => string }) {
  const [v, setV] = useState(value);
  const done = useRef(false);
  useEffect(() => {
    if (done.current || matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(value); return; }
    done.current = true;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => { const k = Math.min(1, (t - t0) / 700); setV(value * (0.9 + 0.1 * (1 - (1 - k) ** 3))); if (k < 1) raf = requestAnimationFrame(step); else setV(value); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(v)}</>;
}

/** Pages and tools opened on this device (kept in the browser only). */
export function readRecent(key: 'atlas-recent' | 'atlas-tools'): { href: string; label: string }[] {
  try { return JSON.parse(localStorage.getItem(key) ?? '[]'); } catch { return []; }
}
