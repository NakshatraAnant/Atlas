'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from './providers';

// Follow a macro or commodity series: a notice arrives when a newer observation is stored
// (release notices can be turned off in Settings).

let cache: Promise<Set<string>> | null = null;
const followed = () => (cache ??= api<{ items: { key: string }[] }>('/v1/follows').then((r) => new Set(r.items.map((i) => i.key))).catch(() => new Set<string>()));

export function FollowButton({ seriesKey, label }: { seriesKey: string; label: string }) {
  const { toast } = useApp();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void followed().then((s) => setOn(s.has(seriesKey))); }, [seriesKey]);
  // While the current follows load, hold the space with a disabled button (no layout jump).
  if (on === null) return <button className="btn s" disabled aria-busy="true">+ Follow</button>;
  const flip = async () => {
    setBusy(true);
    try {
      await api('/v1/follows', { method: 'PUT', body: { key: seriesKey, follow: !on } });
      const s = await followed();
      if (on) s.delete(seriesKey); else s.add(seriesKey);
      setOn(!on);
      toast(on ? `Stopped following ${label}.` : `Following ${label}. You will get a notice when new data is stored.`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return <button className={on ? 'btn s' : 'btn'} aria-pressed={on} disabled={busy} onClick={flip}>{on ? '✓ Following' : '+ Follow'}</button>;
}
