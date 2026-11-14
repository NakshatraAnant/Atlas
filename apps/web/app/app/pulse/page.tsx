'use client';
import { Loading, useApi } from '@/components/ui';
import { Reveal } from '@/components/motion';

// Market Pulse: what moved and what was published, from stored observations only. Every item states its
// timing (end of day, delayed, latest official observation); nothing here is live.

interface Attn { releases: { title: string; href: string; period: string; value: number; units: string | null; published: string }[]; moves: { title: string; href: string; date: string; value: number; unit: string; change: number }[] }
interface Eq { indices: { symbol: string; name: string | null; last_close: number | null; last_date: string | null; returns: Record<string, number | null> }[] }
interface Cr { majors: { canonical_key: string; name: string; price: number; change_24h_pct: number | null; provider_updated_at: string | null }[]; gainers?: { canonical_key: string; name: string; price: number | null; change_24h_pct: number | null }[]; losers?: { canonical_key: string; name: string; price: number | null; change_24h_pct: number | null }[] }
interface Move { label: string; href: string; change: number; period: string; when: string; timing: string }

const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

export default function Pulse() {
  const at = useApi<Attn>('/v1/home/attention');
  const eq = useApi<Eq>('/v1/equity/market');
  const cr = useApi<Cr>('/v1/crypto/overview');
  const moves: Move[] = [];
  for (const i of eq.data?.indices ?? []) if (i.returns.d1 !== null && i.returns.d1 !== undefined) moves.push({ label: i.name ?? i.symbol, href: `/app/equities/INDEX/${i.symbol}`, change: i.returns.d1, period: '1 session', when: i.last_date ?? '', timing: 'End of day' });
  for (const m of at.data?.moves ?? []) moves.push({ label: m.title.replace(/ \(.*\)$/, ''), href: m.href, change: m.change, period: 'about 1 month', when: m.date, timing: 'Latest official observation' });
  const seen = new Set<string>();
  for (const a of [...(cr.data?.majors ?? []), ...(cr.data?.gainers ?? []).slice(0, 3), ...(cr.data?.losers ?? []).slice(0, 3)]) {
    if (a.change_24h_pct === null || seen.has(a.canonical_key)) continue;
    seen.add(a.canonical_key);
    moves.push({ label: a.name, href: `/app/crypto/assets/${a.canonical_key}`, change: a.change_24h_pct / 100, period: '24 hours', when: 'latest snapshot', timing: 'Delayed about 15 minutes' });
  }
  const groups: [string, Move[]][] = [['End of day', []], ['Delayed about 15 minutes', []], ['Latest official observation', []]];
  for (const m of moves) groups.find((g) => g[0] === m.timing)![1].push(m);
  const max = Math.max(0.01, ...moves.map((m) => Math.abs(m.change)));
  const loading = at.loading || eq.loading || cr.loading;
  return (
    <div className="pulse">
      <header className="uni-hd">
        <p className="eyebrow">Market Pulse</p>
        <h1>What moved, and what was published.</h1>
        <p className="mu">Stored observations only, grouped by how current they are. Periods differ between groups, so compare within a group, not across.</p>
      </header>
      {loading && !moves.length ? <Loading lines={6} /> : (
        <div className="pulse-grid">
          {groups.filter((g) => g[1].length).map(([timing, list], gi) => (
            <Reveal key={timing} as="section" delay={gi * 80} className="card pulse-card">
              <h2>{timing === 'End of day' ? 'Indian indices' : timing.startsWith('Delayed') ? 'Digital assets' : 'Commodities'} <span className="t i">{timing}</span></h2>
              <p className="mu">Change over {list[0]!.period}</p>
              <ul className="pulse-list">
                {[...list].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 8).map((m, i) => (
                  <li key={m.href} style={{ ['--i' as string]: i }}>
                    <a href={m.href}>{m.label}</a>
                    <span className={`pulse-v ${m.change >= 0 ? 'up' : 'dn'}`}>{pct(m.change)}</span>
                    <span className="pulse-bar"><i className={m.change >= 0 ? 'up' : 'dn'} style={{ ['--w' as string]: `${(Math.abs(m.change) / max) * 100}%` }} /></span>
                    <span className="mu pulse-when">{m.when}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
          <Reveal as="section" delay={240} className="card pulse-card pulse-wide">
            <h2>Economic releases <span className="t i">Latest official observation</span></h2>
            <p className="mu">Monthly and slower series that published new data in the last 7 days.</p>
            {at.data?.releases.length ? (
              <ol className="pulse-timeline">
                {at.data.releases.map((r, i) => (
                  <li key={r.href} style={{ ['--i' as string]: i }}>
                    <span className="pt-date">{r.published}</span>
                    <a href={r.href}>{r.title}</a>
                    <span className="pt-val">{r.value.toLocaleString('en-IN', { maximumFractionDigits: 3 })} <span className="mu">{r.units ?? ''} · for {r.period}</span></span>
                  </li>
                ))}
              </ol>
            ) : <p className="mu">No monthly or slower series published new data in the last 7 days.</p>}
          </Reveal>
        </div>
      )}
      <p className="mu">Want the relationships behind the moves? <a href="/app/network">Open the Intelligence Network</a>.</p>
    </div>
  );
}
