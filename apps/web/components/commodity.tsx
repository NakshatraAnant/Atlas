// Freshness label for commodity series (current / stale for its frequency / no data).
export function Fresh({ f }: { f: { state: string; age_days: number | null } }) {
  return f.state === 'current' ? <span className="t o">current</span> : f.state === 'stale' ? <span className="t r" title="Older than this frequency allows">stale ({f.age_days} days)</span> : <span className="t m">no data</span>;
}
