// Freshness label (lib/freshness.ts states): judged against each series' publication schedule.
const LABEL: Record<string, [string, string]> = { fresh: ['o', 'current'], current: ['o', 'current'], delayed: ['i', 'delayed'], stale: ['r', 'stale'], provider_error: ['r', 'update failed'], discontinued: ['m', 'discontinued'], unavailable: ['m', 'no data'], no_data: ['m', 'no data'] };
export function Fresh({ f }: { f: { state: string; age_days: number | null; rule?: string } }) {
  const [c, l] = LABEL[f.state] ?? ['m', f.state];
  return <span className={`t ${c}`} title={f.rule}>{l}{(f.state === 'stale' || f.state === 'delayed') && f.age_days !== null ? ` (${f.age_days} days)` : ''}</span>;
}
