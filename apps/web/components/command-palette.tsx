'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

// Universal search (Ctrl/⌘+K or "/"): instruments, data series, Academy content and your own research,
// only from records ATLAS holds. Arrow keys move, Enter opens, Escape closes. Recent picks are kept in
// this browser only.

interface Hit { kind: string; title: string; subtitle: string; href: string }
const RECENT = 'atlas-recent-search';
const KIND: Record<string, string> = { index: 'Index', crypto: 'Crypto', commodity: 'Commodity', macro: 'Macro', course: 'Course', lesson: 'Lesson', research: 'Your research', page: 'Page' };

function readRecent(): Hit[] {
  try { return JSON.parse(localStorage.getItem(RECENT) ?? '[]') as Hit[]; } catch { return []; }
}
function remember(h: Hit) {
  try { localStorage.setItem(RECENT, JSON.stringify([h, ...readRecent().filter((r) => r.href !== h.href)].slice(0, 6))); } catch { /* storage unavailable */ }
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [gaps, setGaps] = useState<string[]>([]);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const recent = open && !q ? readRecent() : [];
  const list = q ? hits : [...recent.map((r) => ({ ...r, subtitle: `Recent · ${r.subtitle}` })), ...hits.filter((h) => !recent.some((r) => r.href === h.href))];

  useEffect(() => {
    if (!open) return;
    setSel(0);
    setTimeout(() => input.current?.focus(), 0);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await api<{ hits: Hit[]; gaps: string[] }>(`/v1/find?q=${encodeURIComponent(q)}`, { signal: ctl.signal });
        setHits(r.hits);
        setGaps(r.gaps);
        setSel(0);
      } catch { /* aborted or offline: keep the last results */ } finally {
        setBusy(false);
      }
    }, q ? 140 : 0);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, open]);

  if (!open) return null;
  const go = (h: Hit) => {
    remember(h);
    onClose();
    setQ('');
    router.push(h.href);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, list.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter' && list[sel]) { e.preventDefault(); go(list[sel]!); }
  };
  return (
    <>
      <div className="palette-back" onClick={onClose} aria-hidden="true" />
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search ATLAS">
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search indices, commodities, macro series, crypto, lessons, your research…"
          role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={list[sel] ? `pal-${sel}` : undefined} aria-autocomplete="list" />
        <ul id="palette-list" role="listbox" aria-label="Results">
          {gaps.map((g) => <li key={g} role="note" style={{ cursor: 'default' }}><span className="kind">Not available</span><span>{g}</span></li>)}
          {list.map((h, i) => (
            <li key={`${h.href}-${i}`} id={`pal-${i}`} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => go(h)}>
              <span className="kind">{KIND[h.kind] ?? h.kind}</span><span>{h.title}</span><span className="sub">{h.subtitle}</span>
            </li>
          ))}
          {!busy && q && !list.length && !gaps.length && <li role="note" style={{ cursor: 'default' }}><span className="kind">No match</span><span>Nothing ATLAS holds matches “{q}”. Try a broader word such as “oil”, “inflation” or “nifty”.</span></li>}
        </ul>
        <div className="hint"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span><span>Only data ATLAS actually stores is listed.</span></div>
      </div>
    </>
  );
}
